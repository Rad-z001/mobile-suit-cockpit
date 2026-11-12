// CR-003 match lifecycle (owner: sim): start / countdown / live / respawn / over, score + timer + winner (host),
// co-op waves and PvP AI upkeep (host), spawn points, leaving a room (back to a calm single-player startup).
// Messages owned here (host only): match {st:'live'|'over', win, sc:[[kills,deaths] by roster index], ts:[a,b], wv, wc},
// feed {k, v, w} (kill feed). Winner shapes: ffa {name}, {name:'DRAW',draw:true}; team {team:0|1|-1 (tie)}; coop {coop:bool}.
import * as THREE from 'three';
import { WAVES, MISSION, ENEMY, MATCH, WEAPONS } from './tuning.js';
import { createRng } from './rng.js';
import { pushEvent, clamp } from './util.js';
import { spawnEnemy } from './enemies.js';
import { updateParts } from './damage.js';
import { clearTargeting } from './sensors.js';
import { initStartup } from './mission.js';
import { resetHatch } from './hatch.js';
import { resetGawman } from './missions/gawman.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export function createMatch(S, rt) {
  const nt = rt.nt;
  const M = S.match;
  const host = { waveState: 'prep', timer: 0, wave: 0, waveStart: 0, aiQueue: [], aiFilled: false, dirty: true, msgT: 0 };
  nt.startRef = null; nt.rosterLen = 0; nt.spawn = new THREE.Vector3(); nt.late = false; nt.lastSec = 0; nt.suit = 'gustav';

  const me = () => nt.entryOf(nt.selfId);
  const pilotsPresent = () => nt.roster.filter((r) => !nt.left.has(r.id)).length;

  // ---------------------------------------------------------------- player reset / placement
  function resetPilot(suit) {
    const p = S.player;
    p.suit = suit;
    p.hull = 1;
    for (const k of Object.keys(p.parts)) { p.parts[k].hp = 1; p.parts[k].status = 'ok'; }
    p.shield.up = false; p.shield.raise = 0;
    const w = p.weapons;
    w.rifle.shots = w.rifle.perPack; w.rifle.reloading = false; w.rifle.reload = 0; w.rifle.cooldown = 0;
    w.active = 'rifle'; w.saber.slash = 0; w.saber.cooldown = 0;
    const fmax = suit === 'gustav' ? WEAPONS.podMax : 24;
    w.funnel.count = fmax; w.funnel.max = fmax;
    w.vulcan.ammo = w.vulcan.max; w.flares.count = w.flares.max;
    p.flightMode = 'hover';
    p.flightTransition.state = 'idle'; p.flightTransition.t = 0; p.flightTransition.cooldown = 0;
    p.weaponsLocked = false;
    p.barrier.active = false; p.barrier.integrity = 1;
    p.thrusterHeat = 0; p.stress = 0; p.blackout = 0; p.throttle = 0;
    p.sensors.mode = 'optical'; p.sensors.zoom = 1;
    p.pullUp.active = false; p.pullUp.tti = Infinity;
    p.aim.yaw = 0; p.aim.pitch = 0; p.aim.turning = 0; p.aim.centring = false; p.aim.limited = false;
    clearTargeting(S);
    rt.rate.pitch = 0; rt.rate.yaw = 0; rt.rate.roll = 0;
    rt.aimRaw.yaw = 0; rt.aimRaw.pitch = 0;
    rt.funnelCd = 0; rt.funnelRegen = 0; rt.vulcanT = 0; rt.prevTrigger = false; rt.saberHit = false;
    rt.overheated = false; rt.boosting = false; rt.flightLaunched = false; rt.tumble.set(0, 0, 0);
    rt.barrierDown = false; rt.barrierHitT = 0; rt.ejectProgress = 0; rt.ejectHeld = false; rt.seaContact = false;
    rt.bias.yaw = 0; rt.bias.roll = 0; rt.sonicCd = 0; rt.gImpulse.set(0, 0, 0); rt.gDamperCd = 0;
    for (const s of rt.sector) { s.base = 1; s.recoverAt = Infinity; s.recoverTo = 1; s.flickT = 0; s.flick = 1; }
    S.alerts.length = 0;
    updateParts(S);
  }
  function place(pos) {
    const p = S.player;
    p.position.copy(pos);
    _e.set(0, Math.atan2(pos.x, pos.z), 0, 'YXZ'); // -Z faces the centre
    p.quaternion.setFromEuler(_e);
    p.velocity.set(0, 0, 0);
    rt.prevVel.set(0, 0, 0);
    rt.gSm.set(0, 1, 0); rt.gSlow.set(0, 1, 0);
  }
  function slotSpawn() {
    const R = MATCH.spawnRadius;
    const n = Math.max(1, nt.roster.length);
    const slot = Math.max(0, nt.slotOf(nt.selfId));
    const mode = nt.settings.mode;
    let a;
    if (mode === 'team') {
      const mate = nt.roster.filter((r) => r.team === nt.myTeam);
      const idx = Math.max(0, mate.findIndex((r) => r.id === nt.selfId));
      a = nt.myTeam * Math.PI + (idx - (mate.length - 1) / 2) * 0.35;
    } else if (mode === 'coop') a = (slot - (n - 1) / 2) * 0.35;
    else a = (slot / n) * Math.PI * 2;
    return new THREE.Vector3(R * Math.cos(a), MATCH.spawnAlt, R * Math.sin(a));
  }
  // respawn / late join: the point on the spawn circle farthest from every hostile
  function farSpawn() {
    const R = MATCH.spawnRadius;
    const base = rt.rng.range(0, Math.PI * 2);
    let best = null;
    let bd = -1;
    for (let i = 0; i < 12; i++) {
      const a = base + (i / 12) * Math.PI * 2;
      const pos = new THREE.Vector3(R * Math.cos(a), MATCH.spawnAlt, R * Math.sin(a));
      let d = Infinity;
      for (const t of rt.targets) if (t.alive) d = Math.min(d, t.position.distanceTo(pos));
      if (d > bd) { bd = d; best = pos; }
    }
    return best;
  }

  // ---------------------------------------------------------------- start / leave
  function resetMatchState() {
    M.type = nt.settings.mode; M.state = 'countdown'; M.countdown = 0; M.timeLeft = 0; M.respawnIn = 0; M.spawnShield = 0;
    M.selfTeam = nt.settings.mode === 'team' ? nt.myTeam : null;
    M.scores.length = 0; M.teamScores[0] = 0; M.teamScores[1] = 0; M.feed.length = 0; M.winner = null;
  }
  function syncRoster(start) {
    nt.roster = start.roster;
    nt.settings = start.settings || S.net.settings;
    const mine = me();
    nt.myTeam = mine ? mine.team : S.net.profile.team;
    while (nt.scores.length < nt.roster.length) nt.scores.push({ k: 0, d: 0 });
    nt.startRef = start; nt.rosterLen = start.roster.length;
  }
  function begin(start) {
    nt.clearAll();
    rt.netOn = true;
    nt.seed = start.seed;
    nt.hostId = S.net.hostId; nt.isHost = S.net.isHost; nt.selfId = S.net.selfId;
    nt.clock = S.net.clock; nt.time = 0;
    nt.scores = []; nt.teamScores = [0, 0];
    syncRoster(start);
    rt.rng = createRng((start.seed ^ Math.imul(nt.slotOf(nt.selfId) + 1, 0x9e3779b1)) >>> 0);
    host.waveState = 'prep'; host.timer = 0; host.wave = 0; host.aiQueue = []; host.aiFilled = false; host.dirty = true; host.msgT = 0;
    resetMatchState();
    nt.suit = me() && (me().suit === 'penelope' || me().suit === 'xi') ? me().suit : 'gustav';
    resetPilot(nt.suit);
    nt.spawn.copy(slotSpawn());
    nt.late = nt.clock >= start.at + 0.5;
    nt.state = 'countdown'; nt.lastSec = 0;
    S.phase = 'startup';
    S.startup.stage = 0; S.startup.progress = 0;
    rt.startupBusy = false; rt.startupDone = false; rt.startupClosing = false;
    // CR-004: a match is always the plain mission; the cold start begins with the hatch open and closes by itself
    resetGawman(S); S.mission.id = 'waves'; S.mission.rescue = null; S.world.night = false; rt.missionId = 'waves';
    resetHatch(S, true);
    S.mission.wave = 0; S.mission.waveCount = 3; S.mission.kills = 0; S.mission.elapsed = 0; S.mission.result = null;
    S.mission.objective = 'STAND BY';
    place(nt.spawn);
    S.netOut.snap = null;
  }
  function leave() {
    nt.clearAll();
    rt.netOn = false; nt.state = 'none'; nt.seed = null; nt.startRef = null; nt.roster = [];
    const p = S.player;
    resetPilot('xi');
    p.position.set(0, 4800, 0); p.quaternion.identity(); p.velocity.set(0, 0, -250);
    rt.prevVel.copy(p.velocity);
    S.phase = 'startup'; S.startup.stage = 0; S.startup.progress = 0;
    rt.startupBusy = false; rt.startupDone = false; rt.waveState = 'startup'; rt.waveTimer = 0;
    rt.shotsFired = 0; rt.hits = 0;
    Object.assign(S.mission, { wave: 0, waveCount: 3, kills: 0, elapsed: 0, result: null });
    S.mission.message.text = ''; S.mission.message.ttl = 0;
    S.world.minovskyDensity = 0.35;
    Object.assign(M, { type: 'single', state: 'none', countdown: 0, timeLeft: 0, respawnIn: 0, spawnShield: 0, selfTeam: null, winner: null });
    M.scores.length = 0; M.feed.length = 0; M.teamScores[0] = 0; M.teamScores[1] = 0;
    S.netOut.snap = null; S.netOut.events.length = 0;
    initStartup(S);
  }
  function goLive() {
    nt.state = 'live'; M.state = 'live';
    S.phase = 'flight';
    S.startup.stage = 4; S.startup.progress = 1; rt.startupDone = true;
    resetHatch(S, false); // sealed, whatever the cold start managed
    place(nt.late ? farSpawn() : nt.spawn);
    M.spawnShield = MATCH.spawnShield;
    M.timeLeft = nt.settings.mode === 'coop' ? 0 : nt.settings.timeLimit;
    host.waveState = 'prep'; host.timer = MISSION.firstWaveDelay;
    pushEvent(S, 'matchStart');
  }
  function doRespawn() {
    resetPilot(nt.suit);
    resetHatch(S, false);
    place(farSpawn());
    S.phase = 'flight';
    M.respawnIn = 0; M.spawnShield = MATCH.spawnShield;
    pushEvent(S, 'respawn');
  }

  // ---------------------------------------------------------------- score / feed / end
  const WEAPON_LABEL = { rifle: 'BEAM RIFLE', saber: 'SABER', vulcan: 'VULCAN', pods: 'MISSILE', ai: 'AI', missile: 'AI MISSILE', sea: 'SEA' };
  function feedNames(killer, victim, weapon) {
    M.feed.push({ killer, victim, weapon: WEAPON_LABEL[weapon] || weapon || '', ttl: MATCH.feedTtl });
    while (M.feed.length > 6) M.feed.shift();
    pushEvent(S, 'killFeed', { killer, victim, weapon: WEAPON_LABEL[weapon] || weapon || '' });
  }
  function hostDied(victimId, byId, w) {
    const vi = nt.slotOf(victimId);
    if (vi < 0) return;
    while (nt.scores.length < nt.roster.length) nt.scores.push({ k: 0, d: 0 });
    nt.scores[vi].d++;
    const ki = byId && byId !== victimId ? nt.slotOf(byId) : -1;
    if (ki >= 0 && nt.settings.mode !== 'coop') {
      nt.scores[ki].k++;
      if (nt.settings.mode === 'team' && nt.roster[ki].team !== nt.roster[vi].team) nt.teamScores[nt.roster[ki].team === 1 ? 1 : 0]++;
    }
    const killer = ki >= 0 ? nt.roster[ki].name : byId === 'ai' ? 'AI' : '';
    feedNames(killer, nt.roster[vi].name, w);
    nt.send({ t: 'feed', k: ki >= 0 ? byId : byId === 'ai' ? 'ai' : '', v: victimId, w });
    host.dirty = true;
  }
  function addKill(byId) {
    const i = nt.slotOf(byId);
    if (i < 0) return;
    while (nt.scores.length < nt.roster.length) nt.scores.push({ k: 0, d: 0 });
    nt.scores[i].k++;
    host.dirty = true;
  }
  function matchMsg() {
    return {
      t: 'match', st: nt.state === 'over' ? 'over' : 'live', win: M.winner, sc: nt.scores.map((s) => [s.k, s.d]),
      ts: nt.teamScores.slice(), wv: host.wave, wc: 3,
    };
  }
  function endMatch(winner) {
    if (nt.state === 'over') return;
    nt.state = 'over'; M.state = 'over'; M.winner = winner;
    S.phase = 'matchOver';
    M.respawnIn = 0; M.spawnShield = 0; M.timeLeft = Math.max(0, M.timeLeft);
    pushEvent(S, 'matchEnd', { winner });
    if (nt.isHost) nt.send(matchMsg());
  }
  function onMatchMsg(from, m) {
    if (from !== nt.hostId || nt.isHost) return;
    if (Array.isArray(m.sc)) {
      while (nt.scores.length < m.sc.length) nt.scores.push({ k: 0, d: 0 });
      m.sc.forEach((a, i) => { nt.scores[i].k = a[0] | 0; nt.scores[i].d = a[1] | 0; });
    }
    if (Array.isArray(m.ts)) nt.teamScores = [m.ts[0] | 0, m.ts[1] | 0];
    if (typeof m.wv === 'number') { host.wave = m.wv; S.mission.wave = m.wv; }
    if (m.st === 'over' && nt.state === 'live') endMatch(m.win || null);
  }
  function becomeHost() {
    let alive = 0;
    for (const e of rt.ships) if (e.alive) alive++;
    host.wave = S.mission.wave;
    host.waveState = alive > 0 ? 'active' : 'prep';
    host.waveStart = rt.time;
    host.timer = MISSION.betweenWaves;
    host.aiFilled = true;
    host.dirty = true;
  }

  // ---------------------------------------------------------------- host: AI / waves / win checks
  function centre(out) {
    out.set(0, MATCH.spawnAlt, 0);
    let n = 0;
    const acc = new THREE.Vector3();
    if (S.phase === 'flight') { acc.add(S.player.position); n++; }
    for (const r of rt.remotes) { acc.add(r.position); n++; }
    if (n) out.copy(acc).divideScalar(n);
    return out;
  }
  const _c = new THREE.Vector3();
  const _pos = new THREE.Vector3();
  function spawnAi(type, ang, opts) {
    centre(_c);
    const dist = rt.rng.range(ENEMY.spawnDistMin, ENEMY.spawnDistMax);
    _pos.set(_c.x + Math.cos(ang) * dist, clamp(_c.y + rt.rng.range(-300, 500), 900, 9000), _c.z + Math.sin(ang) * dist);
    spawnEnemy(S, type, _pos, opts);
  }
  function aliveAi() {
    let n = 0;
    for (const e of rt.ships) if (e.alive) n++;
    return n;
  }
  function hostCoop(dt) {
    switch (host.waveState) {
      case 'prep':
        host.timer -= dt;
        if (host.timer <= 0) {
          const idx = Math.min(host.wave, WAVES.length - 1);
          const w = WAVES[idx];
          const scale = 1 + MATCH.coopScale * (pilotsPresent() - 1);
          const ng = Math.ceil(w.gustav * scale - 1e-9);
          const np = Math.ceil(w.penelope * scale - 1e-9);
          const base = rt.rng.range(0, Math.PI * 2);
          const total = ng + np;
          let i = 0;
          for (let k = 0; k < ng; k++) spawnAi('gustav', base + (total > 1 ? (i++ / (total - 1) - 0.5) * 1.2 : 0), { missiles: w.missiles });
          for (let k = 0; k < np; k++) spawnAi('penelope', base + (total > 1 ? (i++ / (total - 1) - 0.5) * 1.2 : 0), { missiles: w.missiles });
          host.wave = idx + 1;
          S.mission.wave = host.wave;
          host.waveState = 'active'; host.waveStart = rt.time; host.dirty = true;
          pushEvent(S, 'waveStart', { wave: host.wave });
        }
        break;
      case 'active':
        if (aliveAi() === 0 && rt.time - host.waveStart > 0.5) {
          if (host.wave >= WAVES.length) endMatch({ coop: true });
          else { host.waveState = 'clear'; host.timer = MISSION.clearDelay; }
        }
        break;
      default: // clear
        host.timer -= dt;
        if (host.timer <= 0) { host.waveState = 'prep'; host.timer = MISSION.betweenWaves; host.dirty = true; }
        break;
    }
    // every pilot down at once = loss
    if (nt.state === 'live' && S.phase === 'respawn') {
      let allDead = true;
      for (const r of nt.roster) {
        if (r.id === nt.selfId || nt.left.has(r.id)) continue;
        const pr = nt.peers.get(r.id);
        if (!pr || !pr.ent.dead) { allDead = false; break; }
      }
      if (allDead) endMatch({ coop: false });
    }
  }
  function hostPvpAi(dt) {
    const n = pilotsPresent();
    const want = nt.settings.ai ? 2 + (n > 2 ? 1 : 0) : 0;
    if (!host.aiFilled) {
      host.aiFilled = true;
      for (let i = 0; i < want; i++) host.aiQueue.push(MATCH.aiFirst + i * 0.5);
    } else {
      const missing = want - aliveAi() - host.aiQueue.length;
      for (let i = 0; i < missing; i++) host.aiQueue.push(MATCH.aiRespawn);
    }
    for (let i = host.aiQueue.length - 1; i >= 0; i--) {
      host.aiQueue[i] -= dt;
      if (host.aiQueue[i] <= 0) { host.aiQueue.splice(i, 1); spawnAi('gustav', rt.rng.range(0, Math.PI * 2), { missiles: false }); }
    }
  }
  function decideTimeUp() {
    const mode = nt.settings.mode;
    if (mode === 'team') {
      const [a, b] = nt.teamScores;
      return { team: a === b ? -1 : a > b ? 0 : 1 };
    }
    let best = -1;
    let tie = false;
    nt.roster.forEach((r, i) => {
      if (nt.left.has(r.id)) return;
      const s = nt.scores[i];
      if (best < 0) { best = i; return; }
      const b = nt.scores[best];
      if (s.k > b.k || (s.k === b.k && s.d < b.d)) { best = i; tie = false; } else if (s.k === b.k && s.d === b.d) tie = true;
    });
    if (best < 0 || tie) return { name: 'DRAW', draw: true };
    return { name: nt.roster[best].name };
  }
  function hostStep(dt) {
    if (nt.state !== 'live') return;
    const mode = nt.settings.mode;
    if (mode === 'coop') hostCoop(dt);
    else {
      hostPvpAi(dt);
      const limit = nt.settings.scoreLimit;
      if (mode === 'team') {
        if (nt.teamScores[0] >= limit || nt.teamScores[1] >= limit) endMatch({ team: nt.teamScores[0] >= limit ? 0 : 1 });
      } else {
        for (let i = 0; i < nt.roster.length; i++) {
          if (nt.scores[i] && nt.scores[i].k >= limit) { endMatch({ name: nt.roster[i].name }); break; }
        }
      }
      if (nt.state === 'live' && M.timeLeft <= 0) endMatch(decideTimeUp());
    }
    host.msgT += dt;
    if (nt.state === 'live' && (host.dirty || host.msgT >= MATCH.matchMsgEvery)) {
      host.dirty = false; host.msgT = 0;
      nt.send(matchMsg());
    }
  }

  // ---------------------------------------------------------------- scoreboard / objective
  function buildBoard() {
    const peers = S.net.peers;
    const list = [];
    nt.roster.forEach((r, i) => {
      if (nt.left.has(r.id)) return;
      const s = nt.scores[i] || { k: 0, d: 0 };
      const pe = peers.find((q) => q.id === r.id);
      list.push({
        id: r.id, name: r.name, team: r.team, kills: s.k, deaths: s.d, isSelf: r.id === nt.selfId,
        isHost: r.id === nt.hostId, ping: r.id === nt.selfId ? 0 : pe ? pe.ping : 0,
      });
    });
    list.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (a.name < b.name ? -1 : 1));
    M.scores.length = 0;
    for (const x of list) M.scores.push(x);
    M.teamScores[0] = nt.teamScores[0]; M.teamScores[1] = nt.teamScores[1];
  }
  function objective() {
    const mode = nt.settings.mode;
    if (nt.state === 'countdown') return 'STAND BY';
    if (nt.state === 'over') return 'MATCH OVER';
    if (mode === 'coop') {
      let left = 0;
      for (const e of S.entities) if (e.alive && (e.type === 'gustav' || e.type === 'penelope')) left++;
      return left > 0 ? `DESTROY HOSTILES — WAVE ${S.mission.wave}/${S.mission.waveCount} (${left} LEFT)` : 'STAND BY — NEXT CONTACT';
    }
    return mode === 'team' ? `TEAM DEATHMATCH — FIRST TO ${nt.settings.scoreLimit}` : `FIRST TO ${nt.settings.scoreLimit} KILLS`;
  }

  // ---------------------------------------------------------------- per-frame hooks
  function pre() {
    const N = S.net;
    const want = N.mode === 'match' && !!N.start;
    if (!want) { if (rt.netOn) leave(); return; }
    nt.clock = N.clock;
    if (!rt.netOn || N.start.seed !== nt.seed) begin(N.start);
    else if (N.start !== nt.startRef || N.start.roster.length !== nt.rosterLen) syncRoster(N.start);
    nt.selfId = N.selfId;
    if (N.hostId !== nt.hostId || N.isHost !== nt.isHost) {
      const was = nt.isHost;
      nt.hostId = N.hostId; nt.isHost = N.isHost;
      nt.hostChanged(was);
    }
  }
  // cold start inside the container: stay on the spawn point, facing the centre
  function hold() {
    if (nt.state !== 'countdown') return;
    const p = S.player;
    p.position.copy(nt.spawn);
    p.velocity.set(0, 0, 0);
    _e.set(0, Math.atan2(nt.spawn.x, nt.spawn.z), 0, 'YXZ');
    p.quaternion.premultiply(_q.setFromEuler(_e));
  }
  function post(dt) {
    nt.clock = S.net.clock;
    if (nt.state === 'countdown') {
      const cd = nt.startRef.at - nt.clock;
      M.countdown = Math.max(0, cd);
      const sec = Math.ceil(cd);
      if (sec > 0 && sec !== nt.lastSec) { nt.lastSec = sec; pushEvent(S, 'matchCountdown', { seconds: sec }); }
      if (cd <= 0) goLive();
    } else if (nt.state === 'live') {
      M.timeLeft = nt.settings.mode === 'coop' ? 0 : Math.max(0, nt.settings.timeLimit - (nt.clock - nt.startRef.at));
      if (S.phase === 'flight' && M.spawnShield > 0) M.spawnShield = Math.max(0, M.spawnShield - dt);
      if (S.phase === 'respawn') {
        M.respawnIn = Math.max(0, M.respawnIn - dt);
        if (M.respawnIn <= 0) doRespawn();
      }
    }
    for (let i = M.feed.length - 1; i >= 0; i--) { M.feed[i].ttl -= dt; if (M.feed[i].ttl <= 0) M.feed.splice(i, 1); }
    if (nt.isHost) hostStep(dt);
    buildBoard();
    S.mission.objective = objective();
  }

  nt.m = { hostDied, addKill, feedNames, onMatchMsg, becomeHost };
  return { pre, post, hold };
}
