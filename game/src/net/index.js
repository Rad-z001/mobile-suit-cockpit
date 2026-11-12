// CR-003 network layer (owner: manager). Lobby, peers, host election, clock, and the frame hooks
// net.receive() (before sim) and net.send() (after sim). Knows nothing about game content: it moves
// state.netOut to the wire and wire messages into state.net.inbox. See docs/PLAN-multiplayer.md.
//
// API for the lobby UI (src/ui/lobby.js):
//   net.host()                    -> Promise<code>     create a room and become host (P2P only)
//   net.join(code)                -> Promise<void>
//   net.leave()                   back to offline
//   net.setProfile({ name, suit, team, ready })
//   net.setSettings({ mode, ai, scoreLimit, timeLimit, respawn })   host only
//   net.canStart()                -> { ok, reason }  host only
//   net.startMatch()              host only (also used for rematch)
//   net.onChange(fn)              -> unsubscribe; fn() after any state.net change worth redrawing
import { NET_SNAP_HZ, MAX_PLAYERS, SUITS_UNLOCKED } from '../state.js';
import { createP2PTransport } from './p2p.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PING_EVERY = 2;      // s
const LOBBY_EVERY = 3;     // s, profile re-announce (late joiners, lossy transports)

export function makeRoomCode() {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => CODE_CHARS[v % CODE_CHARS.length]).join('');
}

export function cleanName(s) {
  return String(s || '').replace(/[^A-Za-z0-9 _\-.]/g, '').trim().slice(0, 12) || 'PILOT';
}

export function createNet(state) {
  const N = state.net;
  let tr = null;
  let queue = [];                 // incoming wire messages waiting for receive()
  let offset = 0;                 // shared clock = localNow + offset
  let snapAcc = 0, pingAcc = 0, lobbyAcc = 0;
  let lastSentSnap = null;
  const pingSent = new Map();     // id -> local time
  const listeners = new Set();
  const local = () => performance.now() / 1000;
  const changed = () => { for (const f of listeners) { try { f(); } catch (e) { console.error(e); } } };

  function peer(id) { return N.peers.find((p) => p.id === id); }
  function profileMsg() { return { ...N.profile, h: N.hostId, set: N.isHost ? N.settings : undefined }; }

  function electHost() {
    // Keep the current host while present; otherwise the lowest id among connected (self included).
    const ids = [N.selfId, ...N.peers.map((p) => p.id)];
    if (!N.hostId || !ids.includes(N.hostId)) {
      const was = N.isHost;
      N.hostId = ids.sort()[0];
      N.isHost = N.hostId === N.selfId;
      queue.push({ from: N.selfId, kind: 'sys', data: { type: 'host', id: N.hostId } });
      if (N.isHost !== was) changed();
    }
    N.isHost = N.hostId === N.selfId;
  }

  function onMessage(kind, data, from) {
    if (!tr) return;
    switch (kind) {
      case 'snap': case 'ev':
        queue.push({ from, kind, data });
        break;
      case 'lobby': {
        if (!data || typeof data !== 'object') return;
        let p = peer(from);
        const fresh = !p;
        if (!p) { p = { id: from, name: 'PILOT', suit: 'gustav', team: 0, ready: false, ping: 0 }; N.peers.push(p); }
        p.name = cleanName(data.name);
        p.suit = SUITS_UNLOCKED.includes(data.suit) ? data.suit : 'gustav';
        p.team = data.team === 1 ? 1 : 0;
        p.ready = !!data.ready;
        // A joiner adopts the host the room already has (only a host that is actually present).
        if (!N.isHostCreator && !N.hostId && typeof data.h === 'string'
            && (data.h === N.selfId || N.peers.some((q) => q.id === data.h))) {
          N.hostId = data.h; N.isHost = N.hostId === N.selfId;
          queue.push({ from, kind: 'sys', data: { type: 'host', id: N.hostId } });
        }
        if (from === N.hostId && data.set && !N.isHost) Object.assign(N.settings, data.set);
        if (fresh) {
          queue.push({ from, kind: 'sys', data: { type: 'join', id: from, name: p.name } });
          tr.send('lobby', profileMsg(), from);
          if (N.isHost && N.mode === 'match' && N.start) {   // late joiner: hand over the running match
            N.start.roster.push(rosterEntry(p, N.start.roster.length));
            tr.send('start', N.start);
          }
        }
        changed();
        break;
      }
      case 'start':
        if (from !== N.hostId || !data || !Array.isArray(data.roster)) return;
        N.start = data;
        Object.assign(N.settings, data.settings || {});
        N.mode = 'match';
        changed();
        break;
      case 'lobbyReturn':
        if (from !== N.hostId) return;
        N.mode = 'lobby'; N.start = null; N.profile.ready = false;
        changed();
        break;
      case 'ping':
        tr.send('pong', { t: data && data.t, c: local() + offset }, from);
        break;
      case 'pong': {
        if (!data || typeof data.t !== 'number') return;
        const rtt = Math.max(0, local() - data.t);
        const p = peer(from);
        if (p) p.ping = Math.round(rtt * 1000);
        if (from === N.hostId && !N.isHost && typeof data.c === 'number') {
          const est = data.c + rtt / 2 - local();
          offset = Math.abs(est - offset) > 1 ? est : offset + (est - offset) * 0.2;
        }
        break;
      }
      default: break;
    }
  }

  function onJoin(id) {
    if (!tr) return;
    tr.send('lobby', profileMsg(), id);
  }

  function onLeave(id) {
    const p = peer(id);
    if (!p) return;
    N.peers = N.peers.filter((q) => q.id !== id);
    queue.push({ from: id, kind: 'sys', data: { type: 'leave', id, name: p.name } });
    electHost();
    changed();
  }

  function rosterEntry(p, slot) { return { id: p.id, name: p.name, suit: p.suit, team: p.team, slot }; }

  async function open(code, creator) {
    leave();
    N.status = 'connecting'; N.error = ''; N.roomCode = code; N.transport = 'p2p';
    N.mode = 'lobby'; N.peers = []; N.start = null; N.hostId = ''; N.isHost = false; N.isHostCreator = creator;
    N.profile.ready = false;
    changed();
    tr = createP2PTransport();
    tr.onMessage(onMessage); tr.onJoin(onJoin); tr.onLeave(onLeave);
    try {
      await tr.connect(code);
    } catch (e) {
      N.status = 'error'; N.error = String(e && e.message || e); tr = null; N.mode = 'offline';
      changed();
      throw e;
    }
    N.selfId = tr.selfId;
    if (creator) { N.hostId = N.selfId; N.isHost = true; }
    N.status = 'connected';
    tr.send('lobby', profileMsg());
    changed();
  }

  function leave() {
    if (tr) { try { tr.leave(); } catch (e) { /* ignore */ } }
    tr = null;
    Object.assign(N, { mode: 'offline', transport: null, status: 'idle', error: '', roomCode: '', hostId: '',
      isHost: false, isHostCreator: false, peers: [], start: null });
    queue = []; N.inbox = [];
    changed();
  }

  return {
    async host() { const code = makeRoomCode(); await open(code, true); return code; },
    async join(code) {
      code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 6) throw new Error('Room code must be 6 characters');
      await open(code, false);
    },
    leave,
    setProfile(patch) {
      if (patch.name !== undefined) N.profile.name = cleanName(patch.name);
      if (patch.suit !== undefined && SUITS_UNLOCKED.includes(patch.suit)) N.profile.suit = patch.suit;
      if (patch.team !== undefined) N.profile.team = patch.team === 1 ? 1 : 0;
      if (patch.ready !== undefined) N.profile.ready = !!patch.ready;
      if (tr) tr.send('lobby', profileMsg());
      changed();
    },
    setSettings(patch) {
      if (!N.isHost) return;
      const s = N.settings;
      if (['ffa', 'team', 'coop'].includes(patch.mode)) s.mode = patch.mode;
      if (patch.ai !== undefined) s.ai = !!patch.ai;
      if (patch.scoreLimit > 0) s.scoreLimit = Math.min(50, Math.round(patch.scoreLimit));
      if (patch.timeLimit > 0) s.timeLimit = Math.min(1800, Math.round(patch.timeLimit));
      if (patch.respawn > 0) s.respawn = Math.min(30, Math.round(patch.respawn));
      if (tr) tr.send('lobby', profileMsg());
      changed();
    },
    canStart() {
      if (!N.isHost) return { ok: false, reason: 'Only the host can start' };
      if (N.status !== 'connected') return { ok: false, reason: 'Not connected' };
      const total = 1 + N.peers.length;
      if (total > MAX_PLAYERS) return { ok: false, reason: `Max ${MAX_PLAYERS} pilots` };
      if (N.settings.mode !== 'coop' && total < 2) return { ok: false, reason: 'PvP needs at least 2 pilots' };
      if (N.peers.some((p) => !p.ready)) return { ok: false, reason: 'Waiting for everyone to be ready' };
      return { ok: true, reason: '' };
    },
    startMatch() {
      if (!N.isHost || !tr) return false;
      const all = [{ id: N.selfId, ...N.profile }, ...N.peers].sort((a, b) => (a.id < b.id ? -1 : 1));
      const seed = (Math.random() * 0x7fffffff) | 0;
      N.start = { seed, at: local() + offset + 5, settings: { ...N.settings }, roster: all.map(rosterEntry) };
      N.mode = 'match';
      tr.send('start', N.start);
      changed();
      return true;
    },
    returnToLobby() {
      if (!N.isHost || !tr) return;
      tr.send('lobbyReturn', {});
      N.mode = 'lobby'; N.start = null; N.profile.ready = false;
      changed();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    // ---- frame hooks (main.js) --------------------------------------------------------------------
    receive(dt) {
      N.clock = local() + offset;
      N.inbox = queue;
      queue = [];
      if (!tr || N.status !== 'connected') return;
      pingAcc += dt; lobbyAcc += dt;
      if (pingAcc >= PING_EVERY) {
        pingAcc = 0;
        for (const p of N.peers) tr.send('ping', { t: local() }, p.id);
      }
      if (lobbyAcc >= LOBBY_EVERY && N.mode === 'lobby') { lobbyAcc = 0; tr.send('lobby', profileMsg()); }
    },
    send(dt) {
      const out = state.netOut;
      if (!tr || N.status !== 'connected') { out.events.length = 0; return; }
      if (out.events.length) { tr.send('ev', out.events.slice()); out.events.length = 0; }
      snapAcc += dt;
      if (out.snap && out.snap !== lastSentSnap && snapAcc >= 1 / NET_SNAP_HZ) {
        snapAcc = 0; lastSentSnap = out.snap;
        tr.send('snap', out.snap);
      }
    },
  };
}
