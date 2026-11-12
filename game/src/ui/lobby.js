// CR-003 lobby (owner: Haiku). The start overlay: single player, multiplayer setup, room, match start,
// return after Esc, results. Reads state.net / state.match and calls the net API (src/net/index.js) only.
//
// board() must run inside a click handler (main.js starts audio and pointer lock). unboard() shows the
// overlay again and releases the mouse. Keys pressed inside the overlay stop here: input.js would
// otherwise swallow typed letters and Enter, and this overlay needs them for the callsign and room code.

import { SUITS_UNLOCKED } from '../state.js';
import { CODEX } from '../sim/missions/aboardScript.js';

const NAME_KEY = 'ironCoffin.callsign';
const MODE_LABEL = { ffa: 'Free-for-all', team: 'Team', coop: 'Co-op vs AI' };
// Picker order. Locked state comes from SUITS_UNLOCKED in state.js, not from this list.
const SUITS = [
  { id: 'gustav', name: 'GUSTAV KARL', loadout: 'Shield · missile pods · no flight form' },
  { id: 'xi', name: 'XI GUNDAM', loadout: 'Flight form · funnel missiles · shield' },
  { id: 'penelope', name: 'PENELOPE', loadout: 'Flight form · funnel missiles · no shield' },
].map((s) => ({ ...s, locked: !SUITS_UNLOCKED.includes(s.id) }));
const SUIT_NAME = Object.fromEntries(SUITS.map((s) => [s.id, s.name]));
const TEAM_NAME = ['TEAM A', 'TEAM B'];

// CR-004 single-player missions. state.setup.mission is written here, before boarding.
// CR-013: the menu is the story. Chapter 1 runs straight on into Chapter 2; 'story2' restarts at the Chapter 2
// checkpoint and is listed once one is saved. Intercept ('waves') and Gawman Retrieval ('gawman') are off the menu; their
// code stays and '#mission=waves' / '#mission=gawman' links still start them.
const MISSIONS = [
  { id: 'story1', name: 'STORY — CHAPTER 1: MIDAIR HANDOVER', desc: 'Start in the airlock of the cargo that carries the Xi. Walk the gangway, start it up, release and fight two waves at dusk. Then the Penelope comes, with one of your own in her hand — then Chapter 2 follows without a break.' },
  { id: 'story2', name: 'CONTINUE — CHAPTER 2: RETURN TO SEAWRACK', desc: 'From the checkpoint: fly home to Seawrack past three radar pickets. Stay low inside their radar circles, never lead the enemy to the ship, then report to Command aboard.', needsCheckpoint: true },
  // CR-014: the Gawman retrieval mission is Chapter 3, unlocked by the briefing aboard Seawrack
  { id: 'gawman', name: 'CHAPTER 3: GAWMAN RETRIEVAL', desc: 'Night. Circe moves Gawman on a carrier escorted by the Penelope. When it is close he goes over the side: open the hatch [H] and match his fall.', needsFlag: 'ironCoffin.unlock3' },
];
const HIDDEN_MISSIONS = [
  { id: 'waves', name: 'INTERCEPT', desc: '3 waves at dusk' },
  // RETRY after Chapter 1 failed once the Penelope had arrived: restarts there (sim/missions/lane.js, chapter 1 checkpoint)
  { id: 'story1p', name: 'STORY — CHAPTER 1: THE PENELOPE', desc: 'From the checkpoint: the Penelope arrives with Gawman.' },
];
const hasFlag = (k) => { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } };
const setFlag = (k) => { try { localStorage.setItem(k, '1'); } catch (e) { /* storage blocked */ } };
const CODEX_KEY = 'ironCoffin.codex';
function loadCodex() { try { const v = JSON.parse(localStorage.getItem(CODEX_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function saveCodex(ids) { try { localStorage.setItem(CODEX_KEY, JSON.stringify(ids)); } catch (e) { /* storage blocked */ } }
const memFlags = new Set();
const unlocked = (m) => (!m.needsCheckpoint || loadCheckpoint() || memCheckpoint) && (!m.needsFlag || hasFlag(m.needsFlag) || memFlags.has(m.needsFlag));
const MISSION_BY_ID = Object.fromEntries([...MISSIONS, ...HIDDEN_MISSIONS].map((m) => [m.id, m]));
const MISSION_KEY = 'ironCoffin.mission';
const CHECKPOINT_KEY = 'ironCoffin.checkpoint.ch2';
const CHECKPOINT1_KEY = 'ironCoffin.checkpoint.ch1';   // Chapter 1: when the Penelope arrives
const FAIL_REASON = {
  sea: 'Gawman was lost to the sea',
  hull: 'Gawman hit the hull — too fast or hatch closed',
  seawrack: 'Seawrack was sunk',
  ejected: 'The Xi was lost',
};

function loadMission() {
  try {
    const v = localStorage.getItem(MISSION_KEY);
    return v === 'waves' || v === 'gawman' || v === 'story1' || v === 'story2' || v === 'story1p' ? v : null;
  } catch (e) { return null; }
}
function saveMission(id) {
  try { localStorage.setItem(MISSION_KEY, id); } catch (e) { /* storage blocked: the pick lasts for this page only */ }
}
// CR-013: the Chapter 2 checkpoint (written by sim into state.story.checkpoint)
function loadCheckpoint() {
  try { const v = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null'); return v && v.chapter === 2 ? v : null; } catch (e) { return null; }
}
function saveCheckpoint(ck) {
  const key = ck && ck.chapter === 1 ? CHECKPOINT1_KEY : CHECKPOINT_KEY;
  try { localStorage.setItem(key, JSON.stringify(ck)); } catch (e) { /* storage blocked: the checkpoint lasts for this page only */ }
}
function loadCheckpoint1() {
  try { const v = JSON.parse(localStorage.getItem(CHECKPOINT1_KEY) || 'null'); return v && v.chapter === 1 ? v : null; } catch (e) { return null; }
}
let memCheckpoint = null;   // fallback when storage is blocked
let memCheckpoint1 = null;
// RETRY and direct links use '#mission=story1', '#mission=story2' (checkpoint), '#mission=gawman' or '#mission=waves'.
function hashMission() {
  const m = /(?:^#|&)mission=(waves|gawman|story1p|story1|story2)(?:&|$)/.exec(location.hash || '');
  return m ? m[1] : null;
}

function loadName() {
  try { return (localStorage.getItem(NAME_KEY) || 'PILOT').slice(0, 12); } catch (e) { return 'PILOT'; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage blocked: keep it for this page only */ }
}

// Small DOM helper. Props: class, text, on<event>, data-*/aria-*/any attribute; null/false skips.
// Children may be nodes, strings, numbers, null or arrays of those.
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = String(v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function createLobby({ state, net, root, board, unboard }) {
  const N = state.net;
  const M = state.match;

  // The intro and controls text live in <template> elements in index.html / artifact-template.html.
  const tplIntro = root.querySelector('template#intro');
  const tplControls = root.querySelector('template#controls');
  const introHTML = tplIntro ? tplIntro.innerHTML : '';
  const controlsHTML = tplControls ? tplControls.innerHTML : '';

  // CR-004: a '#mission=' hash (RETRY, direct link) preselects the mission and opens the board screen.
  // The hash is then cleared, so a plain reload starts at the menu.
  const hashPick = hashMission();
  if (hashPick) {
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* not fatal */ }
  }
  let pick = hashPick || loadMission() || 'story1';
  if (pick === 'story2' && !loadCheckpoint() && !hashPick) pick = 'story1';
  if (pick === 'story1p' && !hashPick) pick = 'story1';   // only RETRY restarts at the Penelope
  state.setup.mission = pick;
  if (pick === 'story2') state.setup.checkpoint = loadCheckpoint();
  if (pick === 'story1p') state.setup.checkpoint = loadCheckpoint1();
  let savedCk = null, savedCodexN = 0, ejectT = 0;

  const ui = {
    view: hashPick ? 'soloboard' : 'main',  // 'main' | 'mp' | 'solo' (mission pick) | 'soloboard' (outside a room and a match)
    solo: false,           // single player started: the overlay stays hidden
    mission: pick,         // CR-004: 'waves' | 'gawman'
    end: null,             // CR-004: { victory, mission, result } once a single-player mission has ended
    name: loadName(),
    suit: 'gustav',
    code: '',
    err: '',               // local validation message
    busy: false,           // host/join in flight
    p2pOff: typeof RTCPeerConnection === 'undefined',   // no WebRTC in this browser
    lastMode: null,
    boarded: false,        // board() called for this match
    needReturn: false,     // pointer lock lost during a match
    overShown: false,      // results shown (overlay unboarded) for this match
    seenLive: false,       // this match was seen not 'over' (ignores a stale 'over' from the last match)
  };
  let dirty = true;
  let sigAcc = 0, pingAcc = 0;
  let shownSig = null;

  // ---- 3D suit preview (CR-005) -----------------------------------------------------------------
  // One canvas, kept across re-renders. It is live only on the multiplayer suit screen and the single-player
  // mission screen. Any other screen, and a board, disposes it. A missing preview.js or no WebGL hides it silently.
  const pv = { canvas: null, handle: null, loading: false, failed: false, suit: null, wantSuit: null, gen: 0 };
  pv.canvas = el('canvas', { class: 'preview', role: 'img', 'aria-label': 'Suit preview' });

  function disposePreview() {
    pv.gen++;                                    // a load still in flight disposes its own handle
    if (pv.handle) { try { pv.handle.dispose(); } catch (e) { /* already gone */ } }
    pv.handle = null;
    pv.suit = null;
  }

  function failPreview() {
    pv.failed = true;
    pv.canvas.style.display = 'none';
  }

  async function loadPreview() {
    pv.loading = true;
    const gen = pv.gen;
    const suitAtStart = pv.wantSuit;
    let handle = null;
    try {
      if (!window.WebGLRenderingContext) throw new Error('no WebGL');
      const mod = await import('../render/preview.js');
      if (typeof mod.createSuitPreview !== 'function') throw new Error('no createSuitPreview');
      handle = mod.createSuitPreview(pv.canvas, { suit: suitAtStart });
      if (!handle) throw new Error('no preview');
    } catch (e) {
      pv.loading = false;
      if (handle) { try { handle.dispose(); } catch (e2) { /* ignore */ } }
      failPreview();
      return;
    }
    pv.loading = false;
    if (gen !== pv.gen || !root.contains(pv.canvas)) {   // the screen changed while loading
      try { handle.dispose(); } catch (e) { /* ignore */ }
      return;
    }
    pv.handle = handle;
    pv.suit = suitAtStart;
    if (pv.wantSuit !== pv.suit) {
      pv.suit = pv.wantSuit;
      try { handle.setSuit(pv.suit); } catch (e) { disposePreview(); failPreview(); }
    }
  }

  // Called after every render: the canvas is in the DOM only on the suit-preview screens.
  function syncPreview() {
    if (!root.contains(pv.canvas)) { disposePreview(); return; }
    pv.wantSuit = pv.canvas.getAttribute('data-preview') || 'xi';
    if (pv.failed || pv.loading) return;
    if (!pv.handle) { loadPreview(); return; }
    if (pv.suit !== pv.wantSuit) {
      pv.suit = pv.wantSuit;
      try { pv.handle.setSuit(pv.suit); } catch (e) { disposePreview(); failPreview(); }
    }
  }

  const refresh = () => { dirty = true; };
  const saveIfNeeded = () => saveName(ui.name);

  net.onChange(refresh);

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) ui.needReturn = false;
    else if (N.mode === 'match' && ui.boarded && M.state !== 'over') ui.needReturn = true;
    refresh();
  });
  document.addEventListener('pointerlockerror', () => {
    if (N.mode === 'match' && ui.boarded) { ui.needReturn = true; refresh(); }
  });
  root.addEventListener('keydown', (e) => e.stopPropagation());
  root.addEventListener('keyup', (e) => e.stopPropagation());

  // ---- state machine -------------------------------------------------------------------------------

  function syncMode() {
    if (N.mode !== ui.lastMode) {
      ui.lastMode = N.mode;
      Object.assign(ui, { boarded: false, needReturn: false, overShown: false, seenLive: false });
    }
    if (N.mode === 'match' && M.state !== 'over') ui.seenLive = true;
  }

  function screenKey() {
    if (ui.end) return 'end';
    if (ui.solo) return 'hidden';
    if (N.mode === 'match') {
      if (M.state === 'over' && ui.seenLive) return 'results';
      if (!ui.boarded) return 'board';
      return ui.needReturn ? 'return' : 'hidden';
    }
    if (N.mode === 'lobby' && N.status === 'connected') return 'room';
    return ui.view;
  }

  // Signature of what a screen shows. The DOM is rebuilt only when it changes, so typing is not interrupted.
  function signature(key) {
    switch (key) {
      case 'mp':
        return JSON.stringify([N.status, N.error, ui.err, ui.busy, ui.suit]);
      case 'room':
        return JSON.stringify([N.roomCode, N.transport, N.hostId, N.isHost, N.settings, N.profile,
          N.peers.map((p) => [p.id, p.name, p.suit, p.team, p.ready]), N.status, N.error, net.canStart()]);
      case 'board':
        return JSON.stringify([N.settings.mode]);
      case 'solo':
      case 'soloboard':
        return ui.mission;
      case 'end':
        return JSON.stringify([ui.end.victory, ui.end.mission, ui.end.result]);
      case 'results':
        return JSON.stringify([M.type, M.winner, M.teamScores, (M.scores || []).map((s) => [s.name, s.team, s.kills, s.deaths, s.isSelf]),
          N.isHost, net.canStart()]);
      default:
        return '';
    }
  }

  // ---- DOM ------------------------------------------------------------------------------------------

  function render(key) {
    const body = {
      main: mainBody, mp: mpBody, room: roomBody, board: boardBody, return: returnBody, results: resultsBody,
      solo: soloBody, soloboard: soloBoardBody, end: endBody, codex: codexBody,
    }[key];
    if (!body) return;
    // Keep keyboard focus on the same control across a rebuild.
    const active = document.activeElement;
    const focusKey = active && active.getAttribute ? active.getAttribute('data-fk') : null;

    const intro = el('div', { class: 'intro' });
    intro.innerHTML = introHTML;
    const controlsBody = el('div');
    controlsBody.innerHTML = controlsHTML;
    const controls = el('details', { class: 'controls' }, el('summary', { text: 'Controls' }), controlsBody);
    root.replaceChildren(el('div', { class: 'lobby' }, el('h1', { text: 'IRON COFFIN' }), intro, body(), controls));
    syncPreview();

    if (focusKey) {
      const again = root.querySelector(`[data-fk="${CSS.escape(focusKey)}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function refreshPings() {
    for (const node of root.querySelectorAll('[data-ping]')) {
      const p = N.peers.find((q) => q.id === node.getAttribute('data-ping'));
      node.textContent = p && p.ping ? `${p.ping} ms` : '-- ms';
    }
  }

  // ---- main menu --------------------------------------------------------------------------------------

  function mainBody() {
    return el('div', { class: 'sec' },
      el('div', { class: 'row-actions' },
        el('button', { class: 'big go', 'data-fk': 'solo', text: '[ SINGLE PLAYER ]',
          onclick: () => { ui.view = 'solo'; ui.err = ''; refresh(); } }),
        el('button', { class: 'big', 'data-fk': 'mp', text: '[ MULTIPLAYER ]',
          onclick: () => { ui.view = 'mp'; ui.err = ''; refresh(); } })));
  }

  // ---- single player: mission pick, board, end ----------------------------------------------------

  // Picking a card sets the mission and boards from the same click (pointer lock and audio need a gesture).
  function pickMission(id) {
    ui.mission = id;
    state.setup.mission = id;
    state.setup.checkpoint = id === 'story2' ? (loadCheckpoint() || memCheckpoint) : id === 'story1p' ? (loadCheckpoint1() || memCheckpoint1) : null;
    saveMission(id);
    ui.solo = true;
    disposePreview();
    board();
    refresh();
  }

  function soloBody() {
    pv.canvas.setAttribute('data-preview', 'xi');   // single player is always Xi
    return el('div', { class: 'sec' },
      el('h2', { text: 'SINGLE PLAYER' }),
      pv.canvas,
      el('div', { class: 'lbl', text: 'CHOOSE A MISSION' }),
      el('div', { class: 'cards', role: 'radiogroup', 'aria-label': 'Mission' },
        MISSIONS.filter(unlocked).map((m) => el('button', { class: 'card' + (ui.mission === m.id ? ' sel' : ''), role: 'radio',
          'data-fk': 'mission-' + m.id, 'aria-checked': ui.mission === m.id ? 'true' : 'false',
          onclick: () => pickMission(m.id) },
        el('div', { class: 'card-name', text: m.name }),
        el('div', { class: 'lbl', text: m.desc })))),
      el('div', { class: 'row-actions' },
        el('button', { 'data-fk': 'codex', text: `CODEX (${allCodex().length})`, onclick: () => { ui.view = 'codex'; refresh(); } }),
        el('button', { 'data-fk': 'back', text: 'BACK', onclick: () => { ui.view = 'main'; ui.err = ''; refresh(); } })));
  }

  // CR-014: the Codex — what the pilot has learned aboard Seawrack (entries in sim/missions/aboardScript.js)
  function allCodex() {
    const ids = new Set(loadCodex());
    for (const id of (state.story && state.story.codex) || []) ids.add(id);
    return [...ids].filter((id) => CODEX[id]);
  }
  function codexBody() {
    const ids = allCodex();
    return el('div', { class: 'sec' },
      el('h2', { text: 'CODEX' }),
      ids.length ? null : el('p', { class: 'note', text: 'Nothing yet. Talk to the crew and read the notices aboard Seawrack at the end of Chapter 2.' }),
      ...ids.map((id) => el('div', { class: 'card' }, el('div', { class: 'card-name', text: CODEX[id].title.toUpperCase() }), el('div', { class: 'lbl', text: CODEX[id].text }))),
      el('div', { class: 'row-actions' },
        el('button', { 'data-fk': 'back', text: 'BACK', onclick: () => { ui.view = 'solo'; refresh(); } })));
  }

  // Reached from a '#mission=' link (RETRY): the mission is already chosen, one click boards it.
  function soloBoardBody() {
    const m = MISSION_BY_ID[ui.mission] || MISSIONS[0];
    return el('div', { class: 'sec' },
      el('div', { class: 'lbl', text: 'MISSION' }),
      el('div', { class: 'headline', text: m.name }),
      el('p', { class: 'note', text: m.desc }),
      el('div', { class: 'row-actions' },
        el('button', { class: 'big go', 'data-fk': 'solo-board', text: '[ CLICK TO BOARD ]',
          onclick: () => pickMission(ui.mission) }),
        el('button', { 'data-fk': 'change', text: 'CHANGE MISSION', onclick: () => { ui.view = 'solo'; refresh(); } })));
  }

  // Shown once when a single-player mission reaches 'failed' or 'victory'. RETRY reloads into the same mission.
  function endBody() {
    const e = ui.end;
    const r = e.result || {};
    const m = MISSION_BY_ID[e.mission] || MISSIONS[0];
    const reason = e.victory ? '' : (FAIL_REASON[r.reason] || r.reason || '');
    const secs = typeof r.elapsed === 'number' ? Math.round(r.elapsed) : null;
    const stats = [
      typeof r.kills === 'number' ? `KILLS ${r.kills}` : null,
      secs != null ? `TIME ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : null,
      typeof r.detections === 'number' ? `TIMES DETECTED ${r.detections}` : null,
      typeof r.shipHull === 'number' ? `SEAWRACK HULL ${Math.round(r.shipHull * 100)}%` : null,
    ].filter(Boolean).join('  |  ');
    const head = e.victory ? (e.mission === 'story1' || e.mission === 'story1p' ? 'CHAPTER 1 COMPLETE' : e.mission === 'story2' ? 'CHAPTER 2 COMPLETE' : e.mission === 'gawman' ? 'CHAPTER 3 COMPLETE' : 'MISSION COMPLETE') : 'MISSION FAILED';
    const ch3 = e.victory && e.mission === 'story2' && state.story && state.story.unlock === 3;
    return el('div', { class: 'sec' },
      el('div', { class: 'lbl', text: m.name }),
      el('div', { class: 'headline', text: head }),
      ch3 ? el('p', { class: 'note', text: `Chapter 3 unlocked: Gawman Retrieval.  Codex: ${allCodex().length} entries.` }) : null,
      ch3 ? el('div', { class: 'row-actions' }, el('button', { class: 'big go', 'data-fk': 'ch3', text: '[ CHAPTER 3 ]', onclick: () => { location.hash = '#mission=gawman'; location.reload(); } })) : null,
      !e.victory && e.mission === 'story2' ? el('p', { class: 'lbl', text: 'RETRY restarts at the Chapter 2 checkpoint.' }) : null,
      !e.victory && e.mission === 'story1p' ? el('p', { class: 'lbl', text: 'RETRY restarts when the Penelope arrives.' }) : null,
      reason ? el('p', { class: 'err', role: 'status', text: reason }) : null,
      stats ? el('p', { class: 'lbl', text: stats }) : null,
      el('div', { class: 'row-actions' },
        el('button', { class: 'big go', 'data-fk': 'retry', text: '[ RETRY ]',
          onclick: () => { location.hash = '#mission=' + e.mission; location.reload(); } }),
        el('button', { 'data-fk': 'menu', text: 'MENU',
          onclick: () => { location.hash = ''; location.reload(); } })));
  }

  // ---- multiplayer setup ------------------------------------------------------------------------------

  function mpBody() {
    const p2pOff = ui.p2pOff;
    const busy = ui.busy || N.status === 'connecting';

    async function connect(go) {
      if (ui.busy) return;
      ui.err = '';
      ui.busy = true;
      net.setProfile({ name: ui.name, suit: ui.suit });
      refresh();
      try { await go(); } catch (e) { /* net sets N.error; shown below */ }
      ui.busy = false;
      refresh();
    }
    const hostGame = () => connect(() => net.host());
    const joinGame = () => {
      if (ui.code.length !== 6) { ui.err = 'Room code is 6 characters.'; refresh(); return undefined; }
      return connect(() => net.join(ui.code));
    };

    pv.canvas.setAttribute('data-preview', ui.suit);
    const cards = el('div', { class: 'cards', role: 'radiogroup', 'aria-label': 'Suit' },
      SUITS.map((s) => (s.locked
        ? el('div', { class: 'card locked', 'aria-disabled': 'true' },
          el('div', { class: 'card-name' }, el('span', { class: 'lock', 'aria-hidden': 'true' }), s.name),
          el('div', { class: 'lbl', text: 'LOCKED' }))
        : el('button', { class: 'card' + (ui.suit === s.id ? ' sel' : ''), role: 'radio', 'data-fk': 'suit-' + s.id,
          'aria-checked': ui.suit === s.id ? 'true' : 'false',
          onclick: () => { ui.suit = s.id; refresh(); } },
        el('div', { class: 'card-name', text: s.name }),
        el('div', { class: 'lbl', text: s.loadout }),
        ui.suit === s.id ? el('div', { class: 'tag', text: 'SELECTED' }) : null))));

    const status = [];
    if (busy) status.push(el('p', { class: 'note', role: 'status' }, el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Connecting to the room…'));
    const errText = ui.err || (N.status === 'error' ? N.error : '');
    if (errText) status.push(el('p', { class: 'err', role: 'alert', text: errText }));

    return el('div', { class: 'sec' },
      el('h2', { text: 'MULTIPLAYER' }),
      el('div', { class: 'field' },
        el('label', { class: 'lbl', for: 'ic-callsign', text: 'CALLSIGN' }),
        el('input', { id: 'ic-callsign', type: 'text', maxlength: 12, value: ui.name, autocomplete: 'off',
          spellcheck: 'false', 'data-fk': 'name',
          oninput: (e) => { ui.name = e.target.value; saveIfNeeded(); } })),
      pv.canvas,
      el('div', { class: 'lbl', text: 'SUIT' }),
      cards,
      p2pOff ? el('p', { class: 'err', role: 'alert', text: 'This browser has no WebRTC, so online play is unavailable.' }) : null,
      el('div', { class: 'row-actions' },
        el('button', { class: 'big go', 'data-fk': 'host', text: '[ HOST GAME ]', disabled: busy || p2pOff, onclick: hostGame })),
      el('div', { class: 'lbl', text: 'OR JOIN A ROOM' }),
      el('form', { class: 'join', onsubmit: (e) => { e.preventDefault(); joinGame(); } },
        el('label', { class: 'lbl', for: 'ic-code', text: 'ROOM CODE' }),
        el('input', { id: 'ic-code', type: 'text', maxlength: 6, value: ui.code, autocomplete: 'off', spellcheck: 'false',
          'data-fk': 'code', 'aria-label': 'Room code', 'aria-describedby': 'ic-code-help',
          oninput: (e) => {
            const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
            e.target.value = v;
            ui.code = v;
          } }),
        el('button', { type: 'submit', 'data-fk': 'join', text: 'JOIN', disabled: busy || p2pOff })),
      el('p', { class: 'lbl', id: 'ic-code-help', text: 'Six letters or digits, from the host.' }),
      ...status,
      el('div', { class: 'row-actions' },
        el('button', { 'data-fk': 'back', text: 'BACK', onclick: () => { ui.view = 'main'; ui.err = ''; refresh(); } })));
  }

  // ---- room -------------------------------------------------------------------------------------------

  function roomBody() {
    const s = N.settings;
    const host = N.isHost;
    const can = net.canStart();
    const transportLabel = 'Online (free P2P)';
    const rows = [
      { id: N.selfId, name: N.profile.name, suit: N.profile.suit, team: N.profile.team, ready: N.profile.ready, self: true },
      ...N.peers,
    ];

    async function copyCode(e) {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(N.roomCode);
        btn.textContent = 'COPIED';
      } catch (err) {
        btn.textContent = 'COPY FAILED';
      }
      setTimeout(() => { if (btn.isConnected) btn.textContent = 'COPY CODE'; }, 1500);
    }

    const setS = (patch) => { net.setSettings(patch); refresh(); };
    const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v))));
    const numField = (label, key, value, lo, hi, unit, apply) => el('label', { class: 'opt' },
      label, ' ',
      el('input', { type: 'number', class: 'num', min: lo, max: hi, value, 'data-fk': 'n-' + key,
        onchange: (e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) apply(clampNum(v, lo, hi));
          refresh();
        } }),
      ' ' + unit);

    const settings = host
      ? el('div', { class: 'settings' },
        el('div', { class: 'row-actions', role: 'radiogroup', 'aria-label': 'Mode' },
          ['ffa', 'team', 'coop'].map((m) => el('label', { class: 'opt' },
            el('input', { type: 'radio', name: 'ic-mode', value: m, checked: s.mode === m,
              'data-fk': 'mode-' + m, onchange: () => setS({ mode: m }) }),
            ' ' + MODE_LABEL[m]))),
        s.mode !== 'coop'
          ? el('label', { class: 'opt' },
            el('input', { type: 'checkbox', checked: !!s.ai, 'data-fk': 'ai',
              onchange: (e) => setS({ ai: e.target.checked }) }),
            ' AI enemies in the field')
          : el('p', { class: 'lbl', text: 'Co-op always fights AI waves.' }),
        el('div', { class: 'row-actions' },
          numField('SCORE LIMIT', 'score', s.scoreLimit, 1, 50, 'kills', (v) => setS({ scoreLimit: v })),
          numField('TIME LIMIT', 'time', Math.round(s.timeLimit / 60), 1, 30, 'min', (v) => setS({ timeLimit: v * 60 })),
          numField('RESPAWN', 'respawn', s.respawn, 1, 30, 's', (v) => setS({ respawn: v }))))
      : el('p', { class: 'note', text: `Mode: ${MODE_LABEL[s.mode]}  |  AI in the field: ${s.mode === 'coop' ? 'waves' : s.ai ? 'on' : 'off'}  |  Score limit: ${s.scoreLimit}  |  Time limit: ${Math.round(s.timeLimit / 60)} min  |  Respawn: ${s.respawn} s` });

    return el('div', { class: 'sec' },
      el('div', { class: 'lbl', text: `ROOM · ${transportLabel}` }),
      el('div', { class: 'code', text: N.roomCode }),
      el('div', { class: 'row-actions' },
        el('button', { 'data-fk': 'copy', text: 'COPY CODE', onclick: copyCode })),
      el('div', { class: 'lbl', text: `PILOTS (${rows.length}/4)` }),
      el('div', { class: 'rows' },
        rows.map((p) => {
          const isHost = p.id === N.hostId;
          return el('div', { class: 'row' },
            el('span', { class: 'pname', text: p.name }),
            el('span', { class: 'lbl', text: SUIT_NAME[p.suit] || p.suit }),
            s.mode === 'team' ? el('span', { class: 'lbl', text: TEAM_NAME[p.team === 1 ? 1 : 0] }) : null,
            !isHost ? el('span', { class: p.ready ? 'ready' : 'lbl', text: p.ready ? 'READY' : 'NOT READY' }) : null,
            p.self ? null : el('span', { class: 'lbl', 'data-ping': p.id, text: p.ping ? `${p.ping} ms` : '-- ms' }),
            isHost ? el('span', { class: 'tag', text: 'HOST' }) : null,
            p.self ? el('span', { class: 'lbl', text: '(you)' }) : null);
        })),
      s.mode === 'team' || !host
        ? el('div', { class: 'row-actions' },
          s.mode === 'team' ? el('span', { class: 'lbl', text: 'YOUR TEAM' }) : null,
          s.mode === 'team' ? [0, 1].map((t) => el('button', {
            'data-fk': 'team' + t, class: N.profile.team === t ? 'sel' : '',
            'aria-pressed': N.profile.team === t ? 'true' : 'false', text: TEAM_NAME[t],
            onclick: () => { net.setProfile({ team: t }); refresh(); },
          })) : null,
          !host ? el('button', {
            'data-fk': 'ready', class: N.profile.ready ? 'sel' : '', 'aria-pressed': N.profile.ready ? 'true' : 'false',
            text: N.profile.ready ? 'READY' : 'NOT READY',
            onclick: () => { net.setProfile({ ready: !N.profile.ready }); refresh(); },
          }) : null)
        : null,
      el('div', { class: 'lbl', text: host ? 'MATCH SETTINGS (HOST)' : 'MATCH SETTINGS (SET BY HOST)' }),
      settings,
      host
        ? el('div', { class: 'sec-inner' },
          el('button', { class: 'big go', 'data-fk': 'start', text: '[ START MATCH ]', disabled: !can.ok,
            onclick: () => { net.startMatch(); refresh(); } }),
          !can.ok ? el('p', { class: 'warn', text: can.reason }) : null)
        : el('p', { class: 'note', text: 'Waiting for the host to start the match.' }),
      el('div', { class: 'row-actions' },
        el('button', { 'data-fk': 'leave', text: 'LEAVE', onclick: () => { net.leave(); ui.view = 'mp'; refresh(); } })));
  }

  // ---- match: board, return, results ----------------------------------------------------------------

  function boardBody() {
    return el('div', { class: 'sec' },
      el('div', { class: 'lbl', text: `MATCH READY · ${MODE_LABEL[N.settings.mode] || ''}` }),
      el('p', { class: 'note', text: 'The host started the match. The cold start runs by itself during the countdown.' }),
      el('div', { class: 'row-actions' },
        el('button', { class: 'big go', 'data-fk': 'board', text: '[ CLICK TO BOARD ]',
          onclick: () => { ui.boarded = true; board(); refresh(); } })));
  }

  function returnBody() {
    return el('div', { class: 'sec' },
      el('p', { class: 'warn', text: 'Pointer released. The match is still running.' }),
      el('div', { class: 'row-actions' },
        el('button', { class: 'big go', 'data-fk': 'return', text: '[ CLICK TO RETURN ]',
          onclick: () => { ui.needReturn = false; board(); refresh(); } }),
        el('button', { 'data-fk': 'leavematch', text: 'LEAVE MATCH',
          onclick: () => { net.leave(); ui.view = 'main'; refresh(); } })));
  }

  function resultsBody() {
    const w = M.winner;
    let headline = 'DRAW';
    if (w) {
      if ('coop' in w) headline = w.coop ? 'ALL WAVES CLEARED' : 'CO-OP LOST';
      else if ('team' in w) headline = `${TEAM_NAME[w.team === 1 ? 1 : 0]} WINS`;
      else if (w.name) headline = `${w.name} WINS`;
    }
    const host = N.isHost;
    const can = net.canStart();
    const scores = M.scores || [];
    return el('div', { class: 'sec' },
      el('h2', { text: 'MATCH OVER' }),
      el('div', { class: 'headline', text: headline }),
      N.settings.mode === 'team'
        ? el('p', { class: 'note', text: `${TEAM_NAME[0]} ${M.teamScores[0] || 0}  -  ${TEAM_NAME[1]} ${M.teamScores[1] || 0}` })
        : null,
      el('div', { class: 'rows' },
        scores.map((s) => el('div', { class: 'row' },
          el('span', { class: 'pname', text: s.name + (s.isSelf ? ' (you)' : '') }),
          el('span', { class: 'lbl', text: `KILLS ${s.kills}` }),
          el('span', { class: 'lbl', text: `DEATHS ${s.deaths}` })))),
      host
        ? el('div', { class: 'row-actions' },
          el('button', { 'data-fk': 'rematch', text: '[ REMATCH ]', disabled: !can.ok,
            onclick: () => { net.startMatch(); refresh(); } }),
          el('button', { 'data-fk': 'backlobby', text: 'BACK TO LOBBY',
            onclick: () => { net.returnToLobby(); refresh(); } }))
        : el('div', { class: 'row-actions' },
          el('p', { class: 'note', text: 'Waiting for the host…' }),
          el('button', { 'data-fk': 'leavematch', text: 'LEAVE',
            onclick: () => { net.leave(); ui.view = 'main'; refresh(); } })),
      host && !can.ok ? el('p', { class: 'warn', text: can.reason }) : null);
  }

  // ---- per frame --------------------------------------------------------------------------------------

  return {
    update(dt) {
      syncMode();
      // CR-013: keep the Chapter 2 checkpoint the sim took (Chapter 1 -> 2 hand-over, or a checkpoint restart)
      const ck = state.story && state.story.checkpoint;
      if (ck && ck !== savedCk) { savedCk = ck; if (ck.chapter === 1) memCheckpoint1 = ck; else memCheckpoint = ck; saveCheckpoint(ck); }
      // CR-014: Chapter 3 unlock and the Codex
      if (state.story && state.story.unlock === 3 && !memFlags.has('ironCoffin.unlock3')) { memFlags.add('ironCoffin.unlock3'); setFlag('ironCoffin.unlock3'); }
      const cx = state.story && state.story.codex;
      if (Array.isArray(cx) && cx.length !== savedCodexN) { savedCodexN = cx.length; saveCodex([...new Set([...loadCodex(), ...cx])]); }
      // CR-004 single player: the mission has ended. Free the mouse once and show the result panel.
      // An ejection or a crash ('ejected') ends a single-player run too: after its own scene has played (monitor card at
      // about 2.3-3.5 s), the result panel offers RETRY like any other failure.
      ejectT = state.phase === 'ejected' ? ejectT + dt : 0;
      const ended = state.phase === 'failed' || state.phase === 'victory' || (state.phase === 'ejected' && ejectT > 4.5);
      if (ui.solo && !ui.end && N.mode === 'offline' && ended) {
        const mission = state.mission || {};
        // CR-008: the story chapter runs the 'waves' battle, so the picked card (ui.mission) names the run, not mission.id.
        // CR-013: once Chapter 2 has begun, the run is 'story2' (RETRY restarts at its checkpoint); once the Penelope has
        // arrived in Chapter 1, 'story1p' (RETRY restarts there).
        const st = state.story || {};
        const run = st.chapter === 2 ? 'story2' : st.chapter === 1 && st.lane ? 'story1p' : ui.mission === 'story1' ? 'story1' : (mission.id || ui.mission);
        const result = { ...(mission.result || {}) };
        if (state.phase === 'ejected' && !result.reason) result.reason = 'ejected';
        ui.end = { victory: state.phase === 'victory', mission: run, result };
        unboard();
      }
      const key = screenKey();
      if (key === 'results' && !ui.overShown) { ui.overShown = true; unboard(); }
      if (key === 'hidden' && (pv.handle || pv.loading)) disposePreview();   // never runs during play
      root.style.display = key === 'hidden' ? 'none' : '';
      if (key !== 'hidden') {
        sigAcc += dt;
        if (dirty || sigAcc >= 0.25) {
          dirty = false;
          sigAcc = 0;
          const sig = key + '|' + signature(key);
          if (sig !== shownSig) { shownSig = sig; render(key); }
        }
      } else {
        dirty = false;
      }
      pingAcc += dt;
      if (pingAcc >= 0.5) { pingAcc = 0; refreshPings(); }
    },
  };
}
