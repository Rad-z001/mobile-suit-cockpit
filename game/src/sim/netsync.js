// CR-003 multiplayer sync (owner: sim). Everything game-related that crosses the network:
//   - own snapshot  -> state.netOut.snap, reliable messages -> state.netOut.events
//   - state.net.inbox -> remote pilot entities (type 'remote'), mirrored AI ships / missiles, remote shots, hits
// Authority (docs/PLAN-multiplayer.md): every client owns its suit; the host owns AI, waves and the match; shooters
// decide their hits (-> `hit`), AI shots are hit-tested by the victim client.
//
// Wire format (all plain JSON). Snapshot (own suit, every frame; net sends it at <= 20 Hz):
//   { t, ph:0|1(dead), su:0 gustav|1 penelope|2 xi, fm:0|1 (flight form), p:[x,y,z] (cm), q:[x,y,z,w], v:[x,y,z], hull:0..100,
//     parts:'999999' (head,rArm,lArm,legs,pack,pods; 0..9), sh:0|1, w:0 rifle|1 saber, sp:0|1 spawn shield,
//     m:[[id,x,y,z,tg]] own homing missiles (tg: pilot slot+1, -nid for AI, 0 none),
//     host only: ai:[[nid,type,x,y,z,qx,qy,qz,qw,hp%,'parts',state]], am:[[nid,x,y,z,tg]] AI missiles }
// Messages (state.netOut.events items, `t` = type):
//   fire {w:'r'|'v'|'s'|'p', o, d, n?}           shot fired (visual for everyone else)
//   hit {to, p, dmg, d, w}                        to = peer id (pilot) | number (AI nid, host applies);
//                                                 p = victim part ('core' ok) or AI part name; dmg = hull fraction for a
//                                                 pilot / hp for AI; d = unit vector victim -> shooter; w = weapon
//   died {by, w}                                  by = peer id | 'ai' | ''
//   shotDown {k:'a'|'p', id, o?}                  a missile was destroyed by someone else (owner removes it)
//   host only: aiFire {n,o,d,sp,dm,pw,rad,tg}, aiDied {n,by,p,w,ty}, feed {k,v,w}, match {...} (see match.js)
import * as THREE from 'three';
import { NET_INTERP_DELAY, MODEL_SCALE } from '../state.js';
import { ENEMY, ENEMY_PARTS, WEAPONS, PVP, MATCH, PARTS } from './tuning.js';
import { makeEntity, pushEvent, lookQuat, getEntity } from './util.js';
import { pickEnemyPart, applyEnemyHit, defaultEnemyMods, applyEnemyMods } from './enemies.js';
import { damagePlayer } from './damage.js';
import { clearTargeting } from './sensors.js';

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const v3 = (v, f) => [f(v.x), f(v.y), f(v.z)];

const PART_ORDER = ['head', 'rArm', 'lArm', 'legs', 'pack', 'pods'];
const AI_STATES = ['approach', 'strafe', 'break', 'circle', 'pass', 'extend', 'ram', 'flee', ''];
const WEAPON_NAME = { r: 'rifle', v: 'vulcan', p: 'pods', s: 'saber' };
const SRC_TO_W = { beam: 'rifle', vulcan: 'vulcan', funnel: 'pods', saber: 'saber' };
const W_TO_SRC = { rifle: 'beam', vulcan: 'vulcan', pods: 'funnel', saber: 'saber' };
const PVP_OF = { beam: PVP.rifle, saber: PVP.saber, vulcan: PVP.vulcan, funnel: PVP.funnel };
// remote part name (render shape) -> the victim's own part name
const PART_BACK = {
  gustav: { head: 'head', gunArm: 'rArm', pod: 'pods', thrusters: 'legs' },
  penelope: { head: 'head', rifleArm: 'rArm', salvoArm: 'pods', wingPack: 'pack' },
  xi: { head: 'head', rArm: 'rArm', lArm: 'lArm', legs: 'legs', pack: 'pack', pods: 'pods' },   // CR-005: remote Xi uses the player part names
};
const SUIT_CODE = { gustav: 0, penelope: 1, xi: 2 };
const SUIT_OF = ['gustav', 'penelope', 'xi'];

const _v = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();

export function createNetSync(S, rt) {
  const nt = rt.nt = {
    selfId: '', hostId: '', isHost: false, clock: 0, time: 0,
    seed: null, state: 'none', roster: [], settings: S.net.settings, left: new Set(),
    scores: [], teamScores: [0, 0], nextNid: 1,
    peers: new Map(),            // peer id -> { id, ent, buf, skew }
    aiMir: new Map(),            // nid -> mirrored AI ship
    amMir: new Map(),            // nid -> mirrored AI missile
    podMir: new Map(),           // 'peer:id' -> mirrored pod missile of another pilot
    aiSkew: null,
    killer: null, killerW: 'rifle', lastHit: null,
    vul: null, vulAcc: new Map(),
    m: null,                     // match.js hooks
  };
  const send = (m) => { S.netOut.events.push(m); };
  nt.send = send;
  const entryOf = (id) => nt.roster.find((r) => r.id === id) || null;
  const slotOf = (id) => nt.roster.findIndex((r) => r.id === id);
  const codeOf = (id) => (id ? slotOf(id) + 1 : 0);
  const idOfCode = (c) => (c > 0 && nt.roster[c - 1] ? nt.roster[c - 1].id : '');
  nt.entryOf = entryOf; nt.slotOf = slotOf;
  nt.nameOf = (id) => { const r = entryOf(id); return r ? r.name : ''; };
  nt.victimOf = (tg) => (tg === S.player ? nt.selfId : tg.peerId);
  const factionFor = (entry) => {
    const mode = nt.settings.mode;
    if (mode === 'coop') return 'ally';
    if (mode === 'team') return entry.team === nt.myTeam ? 'ally' : 'enemy';
    return 'enemy';
  };

  // ---------------------------------------------------------------- buffers / interpolation
  function pushSample(buf, t, p, q, v) {
    const last = buf[buf.length - 1];
    if (last && t <= last.t) return;
    if (!v) {
      v = [0, 0, 0];
      if (last && t > last.t) {
        const k = 1 / (t - last.t);
        v = [(p[0] - last.p[0]) * k, (p[1] - last.p[1]) * k, (p[2] - last.p[2]) * k];
      }
    }
    buf.push({ t, p, q, v });
    if (buf.length > 40) buf.shift();
  }
  function sampleBuf(buf, rtime, e) {
    const n = buf.length;
    if (!n) return;
    let a;
    let b;
    let f = 0;
    if (rtime <= buf[0].t) { a = b = buf[0]; } else if (rtime >= buf[n - 1].t) {
      a = b = buf[n - 1];
      const ex = Math.min(rtime - a.t, 0.3); // extrapolate briefly on a gap
      e.position.set(a.p[0] + a.v[0] * ex, a.p[1] + a.v[1] * ex, a.p[2] + a.v[2] * ex);
      e.quaternion.set(a.q[0], a.q[1], a.q[2], a.q[3]);
      e.velocity.set(a.v[0], a.v[1], a.v[2]);
      return;
    } else {
      let i = 0;
      while (i < n - 2 && buf[i + 1].t <= rtime) i++;
      a = buf[i]; b = buf[i + 1];
      f = (rtime - a.t) / (b.t - a.t);
    }
    e.position.set(a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f);
    _qa.set(a.q[0], a.q[1], a.q[2], a.q[3]);
    _qb.set(b.q[0], b.q[1], b.q[2], b.q[3]);
    e.quaternion.copy(_qa).slerp(_qb, f);
    e.velocity.set(a.v[0] + (b.v[0] - a.v[0]) * f, a.v[1] + (b.v[1] - a.v[1]) * f, a.v[2] + (b.v[2] - a.v[2]) * f);
    while (buf.length > 3 && buf[1].t < rtime - 1) buf.shift();
  }

  // ---------------------------------------------------------------- remote pilots
  function partsShape(suit) {
    const mk = () => ({ hp: 1, maxHp: 1, status: 'ok' });
    if (suit === 'xi') return { head: mk(), rArm: mk(), lArm: mk(), legs: mk(), pack: mk(), pods: mk() };
    return suit === 'penelope'
      ? { head: mk(), rifleArm: mk(), salvoArm: mk(), wingPack: mk() }
      : { head: mk(), gunArm: mk(), pod: mk(), thrusters: mk() };
  }
  function setPart(part, hp) {
    part.hp = hp;
    part.status = hp <= 0 ? 'destroyed' : hp < PARTS.damagedAt ? 'damaged' : 'ok';
  }
  function applyRemoteParts(e, str) {
    if (typeof str !== 'string' || str.length < 6) return;
    const d = (i) => Math.max(0, Math.min(9, str.charCodeAt(i) - 48)) / 9;
    const P = e.parts;
    setPart(P.head, d(0));
    if (e.suit === 'xi') {
      setPart(P.rArm, d(1)); setPart(P.lArm, d(2)); setPart(P.legs, d(3)); setPart(P.pack, d(4)); setPart(P.pods, d(5));
    } else if (e.suit === 'penelope') {
      setPart(P.rifleArm, d(1));
      setPart(P.salvoArm, Math.min(d(2), d(5)));
      setPart(P.wingPack, Math.min(d(3), d(4)));
    } else {
      setPart(P.gunArm, d(1));
      setPart(P.pod, d(5));
      setPart(P.thrusters, Math.min(d(3), d(4)));
    }
  }
  function shapeRemote(e, suit) {
    e.suit = suit;
    e.radius = ENEMY[suit === 'penelope' || suit === 'xi' ? suit : 'gustav'].radius * MODEL_SCALE;
    e.parts = partsShape(suit);
  }
  function makeRemote(id, entry) {
    const e = makeEntity(S, {
      type: 'remote', faction: factionFor(entry), name: entry.name, radius: 1, hp: 100, maxHp: 100, heat: 0.5,
      ttl: Infinity,
    });
    e.peerId = id; e.team = entry.team; e.owner = id;
    e.shield = false; e.weapon = 'rifle'; e.spawnShield = false; e.dead = false; e.form = 'ms';
    shapeRemote(e, SUIT_CODE[entry.suit] !== undefined ? entry.suit : 'gustav');
    e.sim = { mirror: true, remote: true };
    return e;
  }
  function ingestSnap(from, s) {
    if (from === nt.selfId || !s || typeof s.t !== 'number' || !Array.isArray(s.p) || !Array.isArray(s.q)) return;
    const entry = entryOf(from);
    if (!entry) return;
    let pr = nt.peers.get(from);
    if (!pr) { pr = { id: from, ent: makeRemote(from, entry), buf: [], skew: null }; nt.peers.set(from, pr); }
    const sk = nt.clock - s.t;
    pr.skew = pr.skew === null ? sk : pr.skew + (sk - pr.skew) * 0.1;
    pushSample(pr.buf, s.t, s.p, s.q, Array.isArray(s.v) ? s.v : null);
    const e = pr.ent;
    const suit = SUIT_OF[s.su] || 'gustav';
    if (suit !== e.suit) shapeRemote(e, suit);
    e.hp = Number.isFinite(s.hull) ? s.hull : 100;
    applyRemoteParts(e, s.parts);
    e.shield = !!s.sh;
    e.weapon = s.w ? 'saber' : 'rifle';
    e.spawnShield = !!s.sp;
    e.form = s.fm ? 'flight' : 'ms';
    const dead = s.ph === 1;
    if (dead && !e.dead) pushEvent(S, 'explosion', { position: e.position.clone(), size: 3 });
    e.dead = dead;
    if (from === nt.hostId) {
      nt.aiSkew = pr.skew;
      if (!nt.isHost) { ingestAi(s); }
    }
    ingestPods(from, s);
  }

  // ---------------------------------------------------------------- mirrored AI (host snapshots)
  function makeMirrorAi(nid, typeCode) {
    const type = typeCode === 1 ? 'penelope' : 'gustav';
    const c = ENEMY[type];
    const e = makeEntity(S, {
      type, faction: 'enemy', name: c.name, radius: c.radius * MODEL_SCALE, hp: c.hp, maxHp: c.hp, heat: c.heat,
      ttl: Infinity, targetId: null,
    });
    e.parts = {};
    for (const [name, hp] of Object.entries(ENEMY_PARTS.hp[type])) e.parts[name] = { hp, maxHp: hp, status: 'ok' };
    e.owner = nt.hostId;
    e.nid = nid;
    e.sim = { mirror: true, buf: [], seen: nt.time, stationary: true, tgt: null };
    return e;
  }
  function ingestAi(s) {
    for (const a of s.ai || []) {
      if (!Array.isArray(a) || a.length < 12) continue;
      let e = nt.aiMir.get(a[0]);
      if (!e) { e = makeMirrorAi(a[0], a[1]); nt.aiMir.set(a[0], e); }
      e.sim.seen = nt.time;
      pushSample(e.sim.buf, s.t, [a[2], a[3], a[4]], [a[5], a[6], a[7], a[8]], null);
      e.hp = (a[9] / 100) * e.maxHp;
      const str = String(a[10]);
      let i = 0;
      for (const name of Object.keys(e.parts)) {
        const pt = e.parts[name];
        pt.hp = Math.max(0, Math.min(9, str.charCodeAt(i++) - 48)) / 9 * pt.maxHp;
        pt.status = pt.hp <= 0 ? 'destroyed' : pt.hp < pt.maxHp * ENEMY_PARTS.damagedAt ? 'damaged' : 'ok';
      }
      e.state = AI_STATES[a[11]] || '';
    }
    for (const a of s.am || []) {
      if (!Array.isArray(a)) continue;
      mirrorMissile(nt.amMir, a[0], s.t, a, 'ai', idOfCode(a[4]), 'enemy');
    }
  }
  // dead-reckoned mirror of a homing missile owned elsewhere (AI missile of the host, or a pilot's pod missile)
  function mirrorMissile(map, key, t, a, kind, victimId, faction, ownerId) {
    let e = map.get(key);
    if (!e) {
      e = makeEntity(S, {
        type: 'missile', faction, name: kind === 'ai' ? ENEMY.missile.name : 'MISSILE', radius: 3 * MODEL_SCALE,
        hp: ENEMY.missile.hp, maxHp: ENEMY.missile.hp, heat: 0.9, ttl: 3, targetId: null,
      });
      e.owner = ownerId || nt.hostId;
      e.nid = a[0];
      // an AI missile damages only its victim's client; a pilot's pod missile never damages locally (its hit is a message)
      e.sim = { mirror: true, srcId: a[0], kind, dmg: ENEMY.missile.damage, victim: kind === 'ai' ? victimId : '-', lastT: 0, rep: null };
      map.set(key, e);
    }
    const sm = e.sim;
    sm.seen = nt.time;
    sm.victimId = victimId;
    e.targetId = victimId === nt.selfId ? 'player' : null;
    if (kind === 'ai') sm.victim = victimId;
    const x = a[1], y = a[2], z = a[3];
    if (sm.rep && t > sm.lastT) {
      const k = 1 / (t - sm.lastT);
      e.velocity.set((x - sm.rep[0]) * k, (y - sm.rep[1]) * k, (z - sm.rep[2]) * k);
    }
    sm.rep = [x, y, z]; sm.lastT = t;
    e.position.set(x, y, z);
    e.ttl = 3;
    const sp = e.velocity.length();
    if (sp > 1) { _v.copy(e.velocity).divideScalar(sp); lookQuat(e.quaternion, _v); }
  }
  function ingestPods(from, s) {
    const pr = nt.peers.get(from);
    if (!pr) return;
    const fac = pr.ent.faction;
    for (const a of s.m || []) {
      if (!Array.isArray(a)) continue;
      const key = from + ':' + a[0];
      mirrorMissile(nt.podMir, key, s.t, a, 'pod', a[4] > 0 ? idOfCode(a[4]) : '', fac, from);
    }
  }

  function dropMirrors() {
    for (const [k, e] of nt.aiMir) if (!e.alive || nt.time - e.sim.seen > MATCH.mirrorGrace) { e.alive = false; nt.aiMir.delete(k); }
    for (const map of [nt.amMir, nt.podMir]) {
      for (const [k, e] of map) if (!e.alive || nt.time - e.sim.seen > 0.35) { e.alive = false; map.delete(k); }
    }
  }

  // ---------------------------------------------------------------- inbound messages
  function spawnRemoteShot(e, type, o, d, speed, ttl, radius, name, power) {
    const b = makeEntity(S, { type, faction: e.faction, name, radius, hp: 1, heat: 1, ttl, power });
    b.position.set(o[0], o[1], o[2]);
    _v.set(d[0], d[1], d[2]).normalize();
    b.velocity.copy(_v).multiplyScalar(speed);
    lookQuat(b.quaternion, _v);
    b.owner = e.peerId;
    b.sim = { dmg: 0, victim: '-', visual: true };
    if (power === undefined) delete b.power;
    return b;
  }
  function onFire(from, m) {
    const pr = nt.peers.get(from);
    if (!pr || !Array.isArray(m.o) || !Array.isArray(m.d)) return;
    const e = pr.ent;
    if (m.w === 'r') spawnRemoteShot(e, 'beam', m.o, m.d, WEAPONS.beamSpeed, WEAPONS.beamTtl, WEAPONS.beamRadius, 'BEAM RIFLE', 1);
    else if (m.w === 'v') {
      const n = Math.max(1, Math.min(8, m.n | 0));
      for (let k = 0; k < n; k++) {
        const o = [m.o[0] + m.d[0] * 55 * k, m.o[1] + m.d[1] * 55 * k, m.o[2] + m.d[2] * 55 * k];
        spawnRemoteShot(e, 'tracer', o, m.d, WEAPONS.vulcanSpeed, WEAPONS.vulcanTtl, 0.4, 'VULCAN');
      }
    }
    const weapon = WEAPON_NAME[m.w];
    if (weapon) pushEvent(S, 'remoteFire', { id: e.id, weapon });
  }
  function onHit(from, m) {
    if (typeof m.to === 'number') { // a pilot hit the host's AI
      if (!nt.isHost) return;
      const ai = rt.ships.find((s) => s.nid === m.to && s.alive);
      if (!ai) return;
      const part = m.p && ai.parts[m.p] ? m.p : null;
      nt.killer = from; nt.killerW = m.w || 'rifle';
      applyEnemyHit(S, ai, Math.max(0, Math.min(400, +m.dmg || 0)), part, null, 0, W_TO_SRC[m.w] || 'beam');
      nt.killer = null; nt.killerW = 'rifle';
      return;
    }
    if (m.to !== nt.selfId || S.phase !== 'flight' || !Array.isArray(m.d)) return;
    const pr = nt.peers.get(from);
    if (pr && pr.ent.faction === 'ally') return; // friendly fire is off
    nt.lastHit = { by: from, w: m.w || 'rifle' };
    _v.set(m.d[0], m.d[1], m.d[2]);
    if (_v.lengthSq() < 1e-9) _v.set(0, 0, -1);
    _v.normalize();
    const part = m.p === 'core' || (m.p && S.player.parts[m.p]) ? m.p : undefined;
    damagePlayer(S, Math.max(0, Math.min(1, +m.dmg || 0)), _v, part ? { part } : undefined);
  }
  function onShotDown(from, m) {
    let hit = null;
    if (m.k === 'a') {
      if (!nt.isHost) return;
      for (const e of S.entities) if (e.alive && e.type === 'missile' && !e.owner && e.nid === m.id) { hit = e; break; }
    } else {
      if (m.o !== nt.selfId) return;
      for (const e of S.entities) if (e.alive && e.type === 'funnelMissile' && !e.owner && e.id === m.id) { hit = e; break; }
    }
    if (!hit) return;
    hit.alive = false;
    pushEvent(S, 'explosion', { position: hit.position.clone(), size: 1 });
  }
  function onAiFire(m) {
    if (nt.isHost || !Array.isArray(m.o) || !Array.isArray(m.d)) return;
    const b = makeEntity(S, {
      type: 'beam', faction: 'enemy', name: m.pw >= 0.7 ? 'ENEMY HEAVY BEAM' : 'ENEMY BEAM', radius: m.rad || 2, hp: 1, heat: 1,
      ttl: 9, targetId: 'player', power: m.pw,
    });
    b.position.set(m.o[0], m.o[1], m.o[2]);
    _v.set(m.d[0], m.d[1], m.d[2]).normalize();
    b.velocity.copy(_v).multiplyScalar(m.sp || ENEMY.beamSpeedLight);
    lookQuat(b.quaternion, _v);
    b.owner = nt.hostId;
    b.sim = { dmg: m.dm, victim: idOfCode(m.tg) };
    const src = nt.aiMir.get(m.n);
    pushEvent(S, 'enemyFire', { id: src ? src.id : 0, power: m.pw });
  }
  function onAiDied(from, m) {
    if (from !== nt.hostId || nt.isHost) return;
    const e = nt.aiMir.get(m.n);
    const name = (m.ty === 1 ? ENEMY.penelope : ENEMY.gustav).name;
    if (e) { e.alive = false; nt.aiMir.delete(m.n); }
    if (Array.isArray(m.p)) pushEvent(S, 'explosion', { position: new THREE.Vector3(m.p[0], m.p[1], m.p[2]), size: 3 });
    if (m.by === nt.selfId) { S.mission.kills++; pushEvent(S, 'kill', { id: e ? e.id : 0, name }); }
    nt.m.feedNames(nt.nameOf(m.by) || 'AI', name, m.w || 'rifle');
  }
  function handle(from, m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'fire': onFire(from, m); break;
      case 'hit': onHit(from, m); break;
      case 'died': if (nt.isHost) nt.m.hostDied(from, m.by, m.w); break;
      case 'shotDown': onShotDown(from, m); break;
      case 'aiFire': if (from === nt.hostId) onAiFire(m); break;
      case 'aiDied': onAiDied(from, m); break;
      case 'feed': if (from === nt.hostId && !nt.isHost) nt.m.feedNames(nt.nameOf(m.k) || (m.k === 'ai' ? 'AI' : ''), nt.nameOf(m.v), m.w); break;
      case 'match': nt.m.onMatchMsg(from, m); break;
      default: break;
    }
  }

  function removePeer(id) {
    const pr = nt.peers.get(id);
    if (pr) { pr.ent.alive = false; nt.peers.delete(id); }
    for (const [k, e] of nt.podMir) if (e.owner === id) { e.alive = false; nt.podMir.delete(k); }
  }
  nt.removePeer = removePeer;

  function receive(dt) {
    nt.time += dt;
    nt.clock = S.net.clock;
    for (const msg of S.net.inbox) {
      if (!msg) continue;
      if (msg.kind === 'snap') ingestSnap(msg.from, msg.data);
      else if (msg.kind === 'ev') { if (Array.isArray(msg.data)) for (const m of msg.data) handle(msg.from, m); }
      else if (msg.kind === 'sys' && msg.data) {
        const d = msg.data;
        if (d.type === 'join') pushEvent(S, 'peerJoined', { name: d.name || nt.nameOf(d.id) || 'PILOT' });
        else if (d.type === 'leave') {
          pushEvent(S, 'peerLeft', { name: d.name || nt.nameOf(d.id) || 'PILOT' });
          nt.left.add(d.id);
          removePeer(d.id);
        }
      }
    }
    // interpolate remote pilots and mirrored AI
    for (const pr of nt.peers.values()) {
      sampleBuf(pr.buf, nt.clock - (pr.skew || 0) - NET_INTERP_DELAY, pr.ent);
    }
    const aiSk = nt.aiSkew || 0;
    for (const e of nt.aiMir.values()) sampleBuf(e.sim.buf, nt.clock - aiSk - NET_INTERP_DELAY, e);
    dropMirrors();
  }

  // ---------------------------------------------------------------- host changes
  function convertAi(e) {
    const rng = rt.rng;
    e.owner = '';
    e.sim = {
      state: 'approach', t: 0, side: rng.sign(), vert: 0, fireT: rng.range(2, 5), burst: 0, burstT: 0,
      missileT: rng.range(6, 12), canMissile: S.mission.wave >= 2, salvo: 0, salvoT: 0, salvoCd: rng.range(4, 8),
      decoyT: 0, extendT: 0, passFired: false, dodgeDelay: 0, dodgeT: 0, dodgeDir: new THREE.Vector3(), ramCd: 0,
      stationary: false, mods: defaultEnemyMods(), fled: false, fleePhase: null, tgt: null,
    };
    applyEnemyMods(e);
    e.state = 'approach';
    nt.nextNid = Math.max(nt.nextNid, e.nid + 1);
  }
  function convertMissile(e) {
    e.owner = '';
    const victim = e.sim.victimId || '';
    const tp = victim && victim !== nt.selfId ? nt.peers.get(victim) : null;
    e.targetId = victim === nt.selfId ? 'player' : tp ? tp.ent.id : null;
    e.sim = { dmg: ENEMY.missile.damage, speedMax: ENEMY.missile.speedMax, accel: ENEMY.missile.accel, turn: ENEMY.missile.turn, lost: e.targetId === null, victim };
    nt.nextNid = Math.max(nt.nextNid, e.nid + 1);
  }
  nt.hostChanged = (was) => {
    if (nt.isHost && !was) {
      for (const e of nt.aiMir.values()) if (e.alive) convertAi(e);
      nt.aiMir.clear();
      for (const e of nt.amMir.values()) if (e.alive) convertMissile(e);
      nt.amMir.clear();
      if (nt.m) nt.m.becomeHost();
    } else if (!nt.isHost) {
      for (const e of nt.aiMir.values()) { e.owner = nt.hostId; e.sim.seen = nt.time; }
      for (const e of nt.amMir.values()) { e.owner = nt.hostId; e.sim.seen = nt.time; }
      nt.aiSkew = null;
    }
    pushEvent(S, 'hostChanged', { isHost: nt.isHost });
  };
  // match start / leave: forget every network object
  nt.clearAll = () => {
    for (const e of S.entities) e.alive = false;
    nt.peers.clear(); nt.aiMir.clear(); nt.amMir.clear(); nt.podMir.clear(); nt.vulAcc.clear();
    nt.vul = null; nt.killer = null; nt.lastHit = null; nt.aiSkew = null;
    nt.left.clear();
  };

  // ---------------------------------------------------------------- outbound hooks (called by the weapon / AI code)
  rt.onFire = (kind, o, d, n) => {
    if (!rt.netOn) return;
    if (kind === 'v') {
      const v = nt.vul || (nt.vul = { n: 0, first: nt.time, o: new THREE.Vector3(), d: new THREE.Vector3(), last: nt.time });
      if (v.n === 0) v.first = nt.time;
      v.n++; v.last = nt.time; v.o.copy(o); v.d.copy(d);
      return;
    }
    const msg = { t: 'fire', w: kind, o: v3(o, r1), d: v3(d, r3) };
    if (kind === 'p') msg.n = n;
    send(msg);
  };
  function flushVulcan(force) {
    const v = nt.vul;
    if (!v || v.n === 0) return;
    if (force || nt.time - v.first >= 0.25 || nt.time - v.last >= 0.08) {
      send({ t: 'fire', w: 'v', o: v3(v.o, r1), d: v3(v.d, r3), n: v.n });
      v.n = 0;
    }
  }
  rt.netAiFire = (b, e, speed, dmg, power, radius) => {
    _v.copy(b.velocity).normalize();
    send({
      t: 'aiFire', n: e.nid, o: v3(b.position, r1), d: v3(_v, r3), sp: speed, dm: dmg, pw: power, rad: radius,
      tg: codeOf(b.sim.victim),
    });
  };
  rt.netShotDown = (m) => {
    if (m.sim.kind === 'ai') send({ t: 'shotDown', k: 'a', id: m.sim.srcId });
    else send({ t: 'shotDown', k: 'p', o: m.owner, id: m.sim.srcId });
  };
  rt.netAiKilled = (S2, e) => {
    const by = nt.killer || nt.selfId;
    pushEvent(S, 'explosion', { position: e.position.clone(), size: 3 });
    if (by === nt.selfId) { S.mission.kills++; pushEvent(S, 'kill', { id: e.id, name: e.name }); }
    if (nt.isHost) {
      const w = nt.killerW || 'rifle';
      if (nt.settings.mode === 'coop') nt.m.addKill(by);
      send({ t: 'aiDied', n: e.nid, by, p: v3(e.position, r1), w, ty: e.type === 'penelope' ? 1 : 0 });
      nt.m.feedNames(nt.nameOf(by) || 'AI', e.name, w);
    }
  };
  // shooter-side hit on a remote pilot or a mirrored AI -> message (never damages the mirror here)
  rt.netHit = (S2, s, dmg, hitPos, size, src, ro, rd, rlen) => {
    const w = SRC_TO_W[src] || 'rifle';
    let part = null;
    if (s.type === 'remote') {
      if (s.spawnShield || s.dead) return;
      if (ro) part = pickEnemyPart(s, ro, rd, rlen).part;
    } else if (ro && s.parts) part = pickEnemyPart(s, ro, rd, rlen).part;
    const isPilot = s.type === 'remote';
    const to = isPilot ? s.peerId : s.nid;
    const amount = isPilot ? PVP_OF[src] : dmg;
    const mapped = isPilot ? (part ? (PART_BACK[s.suit] || PART_BACK.gustav)[part] || 'core' : 'core') : part;
    if (rd) _v.copy(rd).negate(); else _v.copy(S.player.position).sub(s.position);
    if (_v.lengthSq() < 1e-9) _v.set(0, 0, 1);
    _v.normalize();
    if (src === 'vulcan') {
      const key = String(to);
      let acc = nt.vulAcc.get(key);
      if (!acc) { acc = { to, dmg: 0, t: nt.time }; nt.vulAcc.set(key, acc); }
      acc.dmg += amount; acc.p = mapped; acc.d = v3(_v, r3);
    } else {
      send({ t: 'hit', to, p: mapped, dmg: r3(amount), d: v3(_v, r3), w });
    }
    pushEvent(S, 'hitConfirm', { id: s.id, part, kill: false });
    pushEvent(S, 'enemyHit', { id: s.id, part });
    if (size > 0 && hitPos) pushEvent(S, 'explosion', { position: hitPos.clone(), size });
  };
  function flushHits() {
    for (const [k, acc] of nt.vulAcc) {
      if (nt.time - acc.t < MATCH.hitFlushVulcan) continue;
      send({ t: 'hit', to: acc.to, p: acc.p, dmg: r3(acc.dmg), d: acc.d, w: 'vulcan' });
      nt.vulAcc.delete(k);
    }
  }
  rt.netDie = (S2, how) => {
    if (S.phase !== 'flight') return;
    const p = S.player;
    const lh = nt.lastHit;
    const by = how === 'sea' ? '' : lh ? lh.by : '';
    const w = how === 'sea' ? 'sea' : lh ? lh.w : 'sea';
    S.phase = 'respawn';
    p.hull = 0;
    p.shield.up = false;
    p.velocity.set(0, 0, 0);
    S.match.respawnIn = nt.settings.respawn;
    S.match.spawnShield = 0;
    pushEvent(S, 'explosion', { position: p.position.clone(), size: 3 });
    clearTargeting(S);
    S.player.weapons.saber.slash = 0;
    send({ t: 'died', by, w });
    if (nt.isHost) nt.m.hostDied(nt.selfId, by, w);
    nt.lastHit = null;
  };

  // ---------------------------------------------------------------- snapshot
  function aiParts(e) {
    let s = '';
    for (const name of Object.keys(e.parts)) { const pt = e.parts[name]; s += Math.round((pt.hp / pt.maxHp) * 9); }
    return s;
  }
  function targetCode(m) {
    const t = getEntity(S, m.targetId);
    if (!t) return 0;
    if (t.type === 'remote') return codeOf(t.peerId);
    if (t.nid !== undefined) return -t.nid;
    return 0;
  }
  function buildSnap() {
    const p = S.player;
    const xf = p.flightTransition;
    let fl = p.flightMode === 'minovsky';
    if (xf.state === 'toFlight' && xf.t > 0.5) fl = true;
    if (xf.state === 'toHover' && xf.t > 0.5) fl = false;
    let parts = '';
    for (const n of PART_ORDER) parts += Math.round(Math.max(0, Math.min(1, p.parts[n].hp)) * 9);
    const snap = {
      t: r3(nt.clock), ph: S.phase === 'respawn' ? 1 : 0, su: SUIT_CODE[p.suit] || 0, fm: fl ? 1 : 0,
      p: v3(p.position, r2), q: [r4(p.quaternion.x), r4(p.quaternion.y), r4(p.quaternion.z), r4(p.quaternion.w)],
      v: v3(p.velocity, r1), hull: Math.round(p.hull * 100), parts,
      sh: p.shield.up ? 1 : 0, w: p.weapons.active === 'saber' ? 1 : 0,
      sp: S.match.spawnShield > 0 || nt.state === 'countdown' ? 1 : 0,
    };
    const m = [];
    for (const e of S.entities) {
      if (e.alive && e.type === 'funnelMissile' && !e.owner) m.push([e.id, r1(e.position.x), r1(e.position.y), r1(e.position.z), targetCode(e)]);
    }
    if (m.length) snap.m = m;
    if (nt.isHost) {
      const ai = [];
      for (const e of rt.ships) {
        if (!e.alive) continue;
        const q = e.quaternion;
        ai.push([e.nid, e.type === 'penelope' ? 1 : 0, r1(e.position.x), r1(e.position.y), r1(e.position.z),
          r3(q.x), r3(q.y), r3(q.z), r3(q.w), Math.round((e.hp / e.maxHp) * 100), aiParts(e),
          Math.max(0, AI_STATES.indexOf(e.state))]);
      }
      const am = [];
      for (const e of S.entities) {
        if (!e.alive || e.type !== 'missile' || e.owner || e.faction !== 'enemy') continue;
        const v = e.sim.victim;
        am.push([e.nid, r1(e.position.x), r1(e.position.y), r1(e.position.z), v ? codeOf(v) : 0]);
      }
      if (ai.length) snap.ai = ai;
      if (am.length) snap.am = am;
    }
    S.netOut.snap = snap;
  }
  function post() {
    flushVulcan(false);
    flushHits();
    buildSnap();
  }

  return { receive, post };
}
