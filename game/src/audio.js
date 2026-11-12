// Audio layer (owner: audio). Recorded samples (src/sfx/sfxData.js, built by tools/prepare-audio.mjs)
// are used wherever present; every cue falls back to the Web Audio synthesis below.
// Reads state only; never writes to it. Every state read is guarded.
import { SFX } from './sfx/sfxData.js';

const TC = 0.1;                                   // time constant for continuous layers (s)
const DB = (d) => Math.pow(10, d / 20);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

function newGate() {
  return { running: false, on: false, next: 0 };
}

// Schedules a square-wave gate ahead of time. rate = full cycles per second.
// step(time, on) is called for each half-cycle; stop() runs once when the gate turns off.
function gateTick(g, t, active, rate, step, stop) {
  if (!active) {
    if (g.running) {
      g.running = false;
      stop();
    }
    return;
  }
  if (!g.running) {
    g.running = true;
    g.on = true;
    g.next = t + 0.01;
  }
  if (g.next < t) g.next = t;
  const half = 0.5 / rate;
  while (g.next < t + 0.2) {
    step(g.next, g.on);
    g.on = !g.on;
    g.next += half;
  }
}

export function createAudio(state) {
  let ctx = null;
  let master = null;
  let masterLP = null;
  let extIn = null;                               // head of the exterior 24 dB/oct lowpass chain
  const bus = {};                                 // alarms | comms | combat | ambience
  let L = null;                                   // continuous-layer nodes
  const noiseCache = {};
  const gates = { lock: newGate() };
  const hb = { running: false, next: 0 };         // heartbeat scheduler
  let combatLast = -10;                           // last one-shot combat sound (s)
  let commsUntil = -10;
  let concussionUntil = -10;
  let lastVulcan = -10;
  let lastEnemyFire = -10;
  let lastRemoteFire = -10;                       // CR-003: rate limit for other pilots' shots
  let lastMsg = '';
  let warned = false;
  let boostWas = 0;                               // last frame's boost input (rising-edge burst)
  let strainWas = false;                          // last frame's high-g state (edge)
  let lastWindThump = -10;                        // CR-004: last hatchWind buffet (s)

  const now = () => (ctx ? ctx.currentTime : 0);

  // ---- recorded samples (optional) ----------------------------------------------
  // samples: id -> AudioBuffer, decoded on unlock. loops: key -> live looped voice.
  const samples = {};
  const loops = {};

  // ---- alarm arbitration ------------------------------------------------------
  // One alarm sounds at a time. Priority: PULL UP (4) > missile inbound (3) > warning (2) > caution (1).
  // A higher priority cuts a lower one. An equal or lower one is dropped while a higher sound is still playing.
  // Continuous alarms (PULL UP, missile) follow a burst pattern; chimes are one-shots.
  const PRIO = { PULL: 4, MISSILE: 3, WARN: 2, CAUTION: 1 };
  const MISSILE_URGENT_TTI = 3.0;                 // s: faster bursts below this time-to-impact
  const PULL_FAST_TTI = 1.5;                      // s: 4 beats per second below this
  const CHIME_REPEAT_S = 5;                       // s: same alert id is not re-chimed within this time
  const MISSILE_PULSE_S = 0.42;                   // one pulse group (length of the cut sample)
  const PULL_LEN = 0.18;                          // s: one PULL UP beat
  const cont = { key: null, prio: 0, next: 0, idx: 0, voices: [] };  // continuous alarm
  const one = { prio: 0, until: -10, voices: [] };                   // current one-shot chime
  const alertChimed = {};                         // alert id -> time of last chime (s)
  let alarmLive = false;                          // true only while flying (or disabled) and not paused

  // Voice registry: finished voices are pruned so the list stays short.
  function track(list, v) {
    const t = now();
    for (let i = list.length - 1; i >= 0; i--) if (list[i].end < t) list.splice(i, 1);
    list.push(v);
  }

  function stopVoices(list) {
    for (const v of list) v.stop();
    list.length = 0;
  }

  function alarmTone(list, o) {
    const v = blip('alarms', o);
    if (v) track(list, v);
  }

  function alarmSample(list, id, o) {
    const v = playSample(id, Object.assign({}, o, { bus: 'alarms' }));
    if (!v) return false;
    track(list, v);
    return true;
  }

  // Plays a one-shot alarm unless an equal or higher alarm is still sounding.
  function oneShot(prio, dur, play) {
    const t = now();
    if (cont.key && cont.prio >= prio) return false;
    if (t < one.until && one.prio >= prio) return false;
    stopVoices(one.voices);
    one.prio = prio;
    one.until = t + dur;
    play(t + 0.005);
    return true;
  }

  // Burst patterns. count pulses, spaced by spacing; after the last pulse, silence s (from its end) before the next burst.
  function missilePattern(tti) {
    return tti < MISSILE_URGENT_TTI
      ? { count: 3, spacing: 0.46, silence: 1.0, len: MISSILE_PULSE_S }
      : { count: 2, spacing: 0.5, silence: 1.4, len: MISSILE_PULSE_S };
  }

  function pullPattern(tti) {
    const beat = tti < PULL_FAST_TTI ? 0.25 : 0.5;  // 4 or 2 beats per second
    return { count: 1, spacing: beat, silence: beat - PULL_LEN, len: PULL_LEN };
  }

  // Runs the continuous alarm for this frame (key: 'pull', 'missile' or null) and schedules its pulses ~0.15 s ahead.
  function driveAlarm(t, key, tti) {
    if (cont.key !== key) {
      stopVoices(cont.voices);
      cont.key = key;
      cont.prio = key === 'pull' ? PRIO.PULL : key === 'missile' ? PRIO.MISSILE : 0;
      cont.next = t + 0.02;
      cont.idx = 0;
      if (key) stopVoices(one.voices);            // a continuous alarm cuts any chime
    }
    if (!alarmLive) stopVoices(one.voices);       // paused, dead, ejected or victory: nothing keeps sounding
    if (!key) return;
    if (cont.next < t) cont.next = t + 0.02;
    const pat = key === 'pull' ? pullPattern(tti) : missilePattern(tti);
    while (cont.next < t + 0.15) {
      const tt = cont.next;
      if (key === 'missile') {
        // Recorded pulse group if loaded; otherwise a soft, low-passed sine (never with the sample: one pulse per slot).
        if (!alarmSample(cont.voices, 'missile_warning', { at: tt, gain: 0.7 })) {
          alarmTone(cont.voices, { type: 'sine', freq: 1500, freqEnd: 1250, duration: MISSILE_PULSE_S, gain: 0.05,
            attack: 0.03, at: tt, filterType: 'lowpass', filterFreq: 2200, q: 0.5 });
        }
      } else if (!alarmSample(cont.voices, 'pull_up', { at: tt, gain: 0.6 })) {
        alarmTone(cont.voices, { type: 'sine', freq: 880, freqEnd: 780, duration: PULL_LEN, gain: 0.05,
          attack: 0.02, at: tt, filterType: 'lowpass', filterFreq: 2400, q: 0.5 });
      }
      const last = cont.idx === pat.count - 1;
      cont.next = tt + (last ? pat.len + pat.silence : pat.spacing);
      cont.idx = last ? 0 : cont.idx + 1;
    }
  }

  // Short chime for a new alert: warning = two rising soft notes, caution = one soft note.
  function chime(tt, warn) {
    if (warn) {
      alarmTone(one.voices, { type: 'sine', freq: 988, duration: 0.16, gain: 0.07, attack: 0.02, at: tt,
        filterType: 'lowpass', filterFreq: 2600, q: 0.5 });
      alarmTone(one.voices, { type: 'sine', freq: 1319, duration: 0.22, gain: 0.07, attack: 0.02, at: tt + 0.17,
        filterType: 'lowpass', filterFreq: 2600, q: 0.5 });
    } else {
      alarmTone(one.voices, { type: 'sine', freq: 740, duration: 0.22, gain: 0.04, attack: 0.02, at: tt,
        filterType: 'lowpass', filterFreq: 2400, q: 0.5 });
    }
  }

  function decodeSamples(c) {
    for (const id of Object.keys(SFX || {})) {
      try {
        const uri = SFX[id];
        const bin = atob(uri.slice(uri.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ok = (buf) => { samples[id] = buf; };
        const fail = () => { /* this cue keeps its synth fallback */ };
        const p = c.decodeAudioData(bytes.buffer, ok, fail);
        if (p && typeof p.then === 'function') p.then(ok, fail);
      } catch (e) {
        /* sample unavailable: synth fallback */
      }
    }
  }

  // One-shot (or looped) voice on a bus. o.at = start time (s, context clock). Returns {gain, stop, end},
  // or null when the sample is not loaded. stop() silences the voice at once, even before it starts.
  function playSample(id, o = {}) {
    const buf = samples[id];
    if (!ctx || !buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!o.loop;
    src.playbackRate.value = clamp(num(o.rate, 1), 0.25, 4);
    const g = ctx.createGain();
    g.gain.value = clamp(num(o.gain, 1), 0, 4);
    const out = o.exterior ? extIn : (bus[o.bus] || bus.combat);
    let pan = null;
    src.connect(g);
    if (ctx.createStereoPanner && typeof o.pan === 'number') {
      pan = ctx.createStereoPanner();
      pan.pan.value = clamp(o.pan, -1, 1);
      g.connect(pan);
      pan.connect(out);
    } else {
      g.connect(out);
    }
    src.onended = () => {
      try {
        src.disconnect();
        g.disconnect();
        if (pan) pan.disconnect();
      } catch (e) {
        /* already gone */
      }
    };
    const t0 = typeof o.at === 'number' ? Math.max(o.at, now()) : now() + 0.005;
    src.start(t0);
    const stop = () => {
      try {
        g.gain.cancelScheduledValues(now());
        g.gain.setValueAtTime(0, now());
        src.stop();
      } catch (e) {
        /* already stopped */
      }
    };
    const end = o.loop ? Infinity : t0 + buf.duration / src.playbackRate.value;
    return { gain: g, stop, end };
  }

  // Plays a one-shot sample if it is loaded. Returns true when it played, so the caller skips its synth.
  function sample(id, o) {
    return playSample(id, o) !== null;
  }

  // Keeps a looped sample running while want is true, with its gain set every frame.
  // Returns true when the sample is loaded, so the caller mutes its synth version.
  function loopSample(key, id, want, gain, busName) {
    const cur = loops[key];
    if (!want || !samples[id]) {
      if (cur) {
        cur.stop();
        loops[key] = null;
      }
      return false;
    }
    if (!cur) loops[key] = playSample(id, { loop: true, gain: 0, bus: busName });
    if (loops[key]) setP(loops[key].gain.gain, gain, 0.1);
    return !!loops[key];
  }

  function setP(param, value, tc = TC) {
    if (param && typeof value === 'number' && isFinite(value)) {
      param.setTargetAtTime(value, now(), tc);
    }
  }

  // ---- helpers --------------------------------------------------------------

  function noiseBuffer(kind) {
    if (noiseCache[kind]) return noiseCache[kind];
    const n = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    noiseCache[kind] = buf;
    return buf;
  }

  function noiseSource(kind, loop) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(kind);
    s.loop = loop;
    return s;
  }

  // Exterior sounds go through the lowpass chain; interior sounds are crisp.
  function outputFor(o, busName) {
    return o.exterior ? extIn : (bus[busName] || bus.combat);
  }

  function startTime(o) {
    if (typeof o.at === 'number') return Math.max(o.at, now());
    return now() + 0.01 + (o.delay || 0);
  }

  // blip(bus, {type, freq, freqEnd, duration, gain, attack, delay, at, exterior,
  //            filterType, filterFreq, filterFreqEnd, q})   filter* is optional
  function blip(busName, o) {
    if (!ctx) return;
    const t = startTime(o);
    const dur = o.duration || 0.1;
    const peak = Math.max(o.gain == null ? 0.1 : o.gain, 0.0002);
    const att = o.attack || 0.005;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(Math.max(o.freq || 440, 1), t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(o.freqEnd, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let f = null;
    if (o.filterType) {
      f = ctx.createBiquadFilter();
      f.type = o.filterType;
      f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(Math.max(o.filterFreq || 1000, 10), t);
      if (o.filterFreqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(o.filterFreqEnd, 10), t + dur);
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(outputFor(o, busName));
    osc.onended = () => {
      try {
        osc.disconnect();
        if (f) f.disconnect();
        g.disconnect();
      } catch (e) {
        /* already gone */
      }
    };
    osc.start(t);
    osc.stop(t + dur + 0.05);
    if (busName === 'combat') combatLast = now();
    // stop() silences the tone at once (alarm arbitration); end is when it finishes on its own.
    const stop = () => {
      try {
        g.gain.cancelScheduledValues(now());
        g.gain.setValueAtTime(0, now());
        osc.stop();
      } catch (e) {
        /* already stopped */
      }
    };
    return { stop, end: t + dur + 0.05 };
  }

  // noiseBurst(bus, {duration, gain, filterType, filterFreq, filterFreqEnd, q, attack, delay, at, exterior})
  function noiseBurst(busName, o) {
    if (!ctx) return;
    const t = startTime(o);
    const dur = o.duration || 0.1;
    const peak = Math.max(o.gain == null ? 0.1 : o.gain, 0.0002);
    const src = noiseSource('white', true);
    const f = ctx.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(Math.max(o.filterFreq || 1000, 10), t);
    if (o.filterFreqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(o.filterFreqEnd, 10), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(outputFor(o, busName));
    src.onended = () => {
      try {
        src.disconnect();
        f.disconnect();
        g.disconnect();
      } catch (e) {
        /* already gone */
      }
    };
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    if (busName === 'combat') combatLast = now();
  }

  function squelch() {
    noiseBurst('comms', { filterType: 'bandpass', filterFreq: 2000, duration: 0.12, gain: 0.12, q: 1.5 });
    blip('comms', { freq: 880, duration: 0.08, gain: 0.06, delay: 0.08 });
    blip('comms', { freq: 660, duration: 0.12, gain: 0.06, delay: 0.18 });
    commsUntil = now() + 1.2;
  }

  function switchClick() {
    if (sample('ui_click', { bus: 'combat', gain: 0.8 })) return;
    noiseBurst('combat', { filterType: 'highpass', filterFreq: 4000, duration: 0.008, gain: 0.15, q: 0.7 });
    blip('combat', { type: 'sine', freq: 2000, duration: 0.03, gain: 0.05 });
  }

  function heartbeat(t, s) {
    const interval = 60 / (60 + 70 * s);          // 60 BPM at rest, 130 BPM at full stress
    if (!hb.running) {
      hb.running = true;
      hb.next = t + 0.05;
    }
    if (hb.next < t) hb.next = t + 0.02;
    const dubOffset = Math.min(0.3, interval * 0.35);
    while (hb.next < t + 0.25) {
      blip('ambience', { type: 'sine', freq: 55, freqEnd: 40, duration: 0.14, gain: 0.15 + 0.3 * s, attack: 0.01, at: hb.next });
      blip('ambience', { type: 'sine', freq: 50, freqEnd: 38, duration: 0.12, gain: 0.1 + 0.2 * s, attack: 0.01, at: hb.next + dubOffset });
      hb.next += interval;
    }
  }

  // ---- one-shot events --------------------------------------------------------

  function startupSound(stage, I) {
    if (stage === 1) {
      noiseBurst('combat', { filterType: 'highpass', filterFreq: 2000, duration: 0.012, gain: 0.35, q: 0.7 });
      noiseBurst('combat', { filterType: 'highpass', filterFreq: 2000, duration: 0.012, gain: 0.35, q: 0.7, delay: 0.12 });
      noiseBurst('combat', { filterType: 'bandpass', filterFreq: 300, filterFreqEnd: 700, duration: 0.6, gain: 0.05, q: 2, delay: 0.2 });
    } else if (stage === 2) {
      blip('combat', { type: 'sine', freq: 600, freqEnd: 1600, duration: 0.12, gain: 0.08, delay: 0 });
      blip('combat', { type: 'sine', freq: 600, freqEnd: 1600, duration: 0.12, gain: 0.08, delay: 0.15 });
      blip('combat', { type: 'sine', freq: 600, freqEnd: 1600, duration: 0.12, gain: 0.08, delay: 0.3 });
    } else if (stage === 3) {
      blip('combat', { type: 'triangle', freq: 220, freqEnd: 440, duration: 1.6, gain: 0.09, attack: 0.7 });
      blip('combat', { type: 'sine', freq: 330, freqEnd: 660, duration: 1.6, gain: 0.05, attack: 0.8, delay: 0.1 });
    } else if (stage === 4) {
      blip('combat', { type: 'sine', freq: 1320, duration: 0.5, gain: 0.12 });
      blip('combat', { type: 'sine', freq: 1760, duration: 0.6, gain: 0.1, delay: 0.18 });
    }
  }

  // Door servo whine for the hatch (1.7 s). Opening rises in pitch, closing falls.
  function hatchServo(closing) {
    const f0 = closing ? 1400 : 500, f1 = closing ? 500 : 1400;
    blip('combat', { type: 'sawtooth', freq: f0, freqEnd: f1, duration: 1.7, gain: 0.025, attack: 0.1,
      filterType: 'bandpass', filterFreq: 1200, q: 4 });
    blip('combat', { type: 'sine', freq: f0 * 0.5, freqEnd: f1 * 0.5, duration: 1.7, gain: 0.02, attack: 0.1 });
    noiseBurst('combat', { filterType: 'highpass', filterFreq: 2500, duration: 0.05, gain: 0.12, q: 0.7 });
  }

  function handleEvent(ev, t, S) {
    switch (ev.type) {
      case 'startupStage':
        if (num(ev.stage, 0) === 3 && sample('startup_stage', { bus: 'combat' })) break;
        startupSound(num(ev.stage, 0), S.input || {});
        break;

      case 'rifleFire': {
        if (sample('rifle_fire', { bus: 'combat' })) break;
        // Heavy beam, about 1.6 s. Pre-charge whine first, then the body, tearing, roar and tail.
        const charge = 0.12;
        blip('combat', { type: 'triangle', freq: 400, freqEnd: 1800, duration: charge, gain: 0.08, attack: 0.01 });
        // (b) deep body: hard attack, about 1.2 s decay
        blip('combat', { type: 'sine', freq: 48, duration: 1.2, gain: 0.45, attack: 0.002, delay: charge });
        blip('combat', { type: 'triangle', freq: 96, duration: 1.2, gain: 0.15, attack: 0.002, delay: charge });
        // (c) mid tearing layer: sawtooth sweep through a bandpass
        blip('combat', {
          type: 'sawtooth', freq: 900, freqEnd: 140, duration: 1.1, gain: 0.2, attack: 0.005, delay: charge,
          filterType: 'bandpass', filterFreq: 900, filterFreqEnd: 140, q: 1.5,
        });
        // (d) roar and sizzle: noise bandpass sweeping down
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 2500, filterFreqEnd: 300, duration: 1.3, gain: 0.22, q: 1.2, attack: 0.003, delay: charge });
        // (e) faint long tail hum
        blip('combat', { type: 'sine', freq: 70, duration: 1.5, gain: 0.05, attack: 0.1, delay: charge });
        break;
      }

      case 'enemyFire': {
        // Distant, exterior version of the beam. power 1 ~0.9 s, power 0.45 ~0.35 s at half gain.
        if (t - lastEnemyFire < 0.08) break;      // rate limit: one per 80 ms
        lastEnemyFire = t;
        const p = clamp(num(ev.power, 1), 0.2, 1);
        const dur = p - 0.1;
        const g = 0.3 * (p + 0.1) / 1.1;
        if (sample('enemy_beam', { bus: 'combat', exterior: true, gain: 0.4 + 0.6 * p })) break;
        blip('combat', { type: 'sine', freq: 70, freqEnd: 35, duration: dur, gain: g, attack: 0.005, exterior: true });
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 900, filterFreqEnd: 300, duration: dur * 0.8, gain: g * 0.8, q: 1, attack: 0.005, exterior: true });
        break;
      }

      case 'vulcanFire':
        if (t - lastVulcan < 0.06) break;           // rate limit: one tick per 60 ms
        lastVulcan = t;
        if (sample('vulcan', { bus: 'combat', gain: 0.8, rate: 0.95 + 0.1 * Math.random() })) break;
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 3000, duration: 0.02, gain: 0.12, q: 0.7 });
        break;

      case 'funnelLaunch':
        if (sample('missile_launch', { bus: 'combat' })) break;
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 300, filterFreqEnd: 3000, duration: 0.8, gain: 0.2, q: 1.2 });
        blip('combat', { type: 'sine', freq: 880, duration: 0.12, gain: 0.08, delay: 0.1 });
        blip('combat', { type: 'sine', freq: 1174, duration: 0.12, gain: 0.08, delay: 0.2 });
        blip('combat', { type: 'sine', freq: 1568, duration: 0.12, gain: 0.08, delay: 0.3 });
        break;

      case 'flareDeploy':
        if (sample('flare_deploy', { bus: 'combat' })) break;
        blip('combat', { type: 'sine', freq: 260, freqEnd: 120, duration: 0.08, gain: 0.18 });
        blip('combat', { type: 'sine', freq: 260, freqEnd: 120, duration: 0.08, gain: 0.18, delay: 0.12 });
        break;

      case 'lockConfirmed':
      case 'syncLocked':          // SPEED SYNC matched Gawman's fall (sim/missions/gawman.js)
        if (sample('lock_chime', { bus: 'combat', gain: 0.9 })) break;
        blip('combat', { type: 'sine', freq: 1760, duration: 0.07, gain: 0.08 });
        blip('combat', { type: 'sine', freq: 1760, duration: 0.07, gain: 0.08, delay: 0.1 });
        break;

      case 'lockLost':
        if (sample('lock_lost', { bus: 'combat' })) break;
        blip('combat', { type: 'sine', freq: 880, freqEnd: 440, duration: 0.3, gain: 0.08 });
        break;

      case 'sensorMode':
      case 'zoom':
      case 'uiClick':
        switchClick();
        break;

      case 'flightMode':
        switchClick();
        blip('combat', { type: 'sawtooth', freq: 300, freqEnd: 900, duration: 0.35, gain: 0.025, delay: 0.02 });
        break;

      case 'sonicBoom':
        if (sample('sonic_boom', { bus: 'combat', exterior: true })) break;
        blip('combat', { type: 'sine', freq: 80, freqEnd: 40, duration: 0.5, gain: 0.6, exterior: true });
        blip('combat', { type: 'sine', freq: 80, freqEnd: 40, duration: 0.5, gain: 0.45, delay: 0.18, exterior: true });
        noiseBurst('combat', { filterType: 'lowpass', filterFreq: 300, duration: 0.9, gain: 0.5, exterior: true });
        break;

      case 'explosion': {
        const size = clamp(num(ev.size, 2), 1, 3);
        const g = 0.2 + 0.15 * size;
        if (sample(size >= 2 ? 'explosion_large' : 'explosion_small', { bus: 'combat', exterior: true, gain: 0.5 + 0.2 * size })) break;
        blip('combat', { type: 'sine', freq: 70, freqEnd: 30, duration: 0.6 + 0.2 * size, gain: g, exterior: true });
        noiseBurst('combat', { filterType: 'lowpass', filterFreq: 260, filterFreqEnd: 120, duration: 0.9 + 0.2 * size, gain: g * 1.2, exterior: true });
        break;
      }

      case 'playerHit': {
        const damage = Math.max(0, num(ev.damage, 0));
        const sev = clamp(0.4 + 1.2 * damage, 0.4, 1);
        if (!sample('hull_clash', { bus: 'combat', gain: 0.5 + 0.5 * sev })) {
          blip('combat', { type: 'sine', freq: 90, freqEnd: 50, duration: 0.3, gain: 0.3 + 0.35 * sev, attack: 0.003 });
          [317, 521, 743, 911].forEach((f, i) => {
            blip('combat', { type: 'sine', freq: f, duration: 0.6, gain: 0.03 * sev, attack: 0.002, delay: 0.005 * i });
          });
          noiseBurst('combat', { filterType: 'highpass', filterFreq: 2500, duration: 0.03, gain: 0.25 * sev, q: 0.7 });
        }
        if (damage > 0) concussionUntil = t + 1.5;
        try {
          if (S.input && typeof S.input.rumble === 'function') S.input.rumble(1, 0.5, 300);
        } catch (e) {
          /* rumble optional */
        }
        break;
      }

      case 'sectorLost':
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 2000, filterFreqEnd: 500, duration: 0.35, gain: 0.2, q: 2 });
        blip('combat', { type: 'sawtooth', freq: 1200, freqEnd: 200, duration: 0.15, gain: 0.05, delay: 0.02 });
        break;

      case 'gDamper':
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 1500, duration: 0.35, gain: 0.08, q: 0.7 });
        blip('combat', { type: 'sine', freq: 110, freqEnd: 55, duration: 0.25, gain: 0.35 });
        break;

      case 'enemyHit':
      case 'enemyPartDamaged':
        blip('combat', { type: 'sine', freq: 120, freqEnd: 60, duration: 0.15, gain: 0.15, exterior: true });
        break;

      case 'kill':
        blip('combat', { type: 'sine', freq: 60, freqEnd: 30, duration: 0.6, gain: 0.3, exterior: true });
        noiseBurst('combat', { filterType: 'lowpass', filterFreq: 300, duration: 0.7, gain: 0.2, exterior: true });
        blip('combat', { type: 'sine', freq: 1046, duration: 0.15, gain: 0.06, delay: 0.25 });
        blip('combat', { type: 'sine', freq: 1318, duration: 0.2, gain: 0.06, delay: 0.35 });
        break;

      case 'waveStart':
      case 'laneDuel':            // Chapter 1: Gawman is safe, Lane Aim attacks
      case 'homecoming':          // CR-014 the Xi comes home to Seawrack
      case 'chapterStart':        // CR-013 story Chapter 2: radio squelch on the hand-over, the ship found, the landing
      case 'seawrackFound':
      case 'strikeCleared':
      case 'landed':
        squelch();
        break;
      case 'codex':               // CR-014: a Codex entry learned aboard Seawrack
        blip('combat', { type: 'sine', freq: 880, duration: 0.08, gain: 0.05 });
        blip('combat', { type: 'sine', freq: 1320, duration: 0.12, gain: 0.05, delay: 0.09 });
        break;
      case 'radarPaint':          // CR-013: a picket's radar sweeps over the suit: two short high pips (radar warning receiver)
        blip('combat', { type: 'square', freq: 2100, duration: 0.05, gain: 0.05 });
        blip('combat', { type: 'square', freq: 2100, duration: 0.05, gain: 0.05, delay: 0.09 });
        break;
      case 'radarDetected':
        for (let i = 0; i < 4; i++) blip('combat', { type: 'square', freq: i % 2 ? 1500 : 2200, duration: 0.09, gain: 0.07, delay: i * 0.12 });
        break;
      case 'seawrackHit':
        blip('combat', { type: 'sine', freq: 70, freqEnd: 35, duration: 0.5, gain: 0.12, exterior: true });
        break;

      case 'alert': {
        // Sent once when an alert id first appears. One chime; not re-chimed for the same id within 5 s.
        // Missile and PULL UP have their own burst patterns (driveAlarm), so they stay silent here.
        const id = String(ev.id || '');
        if (!alarmLive || id === 'missile' || id === 'pullup') break;
        if (t - (alertChimed[id] ?? -1e9) < CHIME_REPEAT_S) break;
        alertChimed[id] = t;
        if (ev.level === 'warning') oneShot(PRIO.WARN, 0.45, (tt) => chime(tt, true));
        else oneShot(PRIO.CAUTION, 0.25, (tt) => chime(tt, false));
        break;
      }

      case 'ejectLever':
        for (let i = 0; i < 5; i++) {
          noiseBurst('combat', { filterType: 'bandpass', filterFreq: 800, duration: 0.04, gain: 0.25, q: 3, delay: i * 0.07 });
        }
        blip('combat', { type: 'sine', freq: 70, freqEnd: 45, duration: 0.2, gain: 0.35, delay: 0.35 });
        break;

      case 'hatchBlow':
        if (sample('hatch_blow', { bus: 'combat' })) break;
        blip('combat', { type: 'sine', freq: 120, freqEnd: 40, duration: 0.5, gain: 0.5 });
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 3000, filterFreqEnd: 8000, duration: 2, gain: 0.35, q: 0.7, attack: 0.01 });
        break;

      // ---- CR-002 events (each falls back to a short synth cue) ----
      case 'rifleEmpty':
        if (sample('rifle_empty', { bus: 'combat' })) break;
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 3000, duration: 0.02, gain: 0.25, q: 0.7 });
        blip('combat', { type: 'square', freq: 1200, duration: 0.03, gain: 0.04 });
        break;

      case 'reloadStart':
        if (sample('reload_start', { bus: 'combat' })) break;
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 1800, duration: 0.05, gain: 0.25, q: 2 });
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 900, duration: 0.08, gain: 0.25, q: 2, delay: 0.45 });
        break;

      case 'reloadEnd':
        if (sample('reload_end', { bus: 'combat' })) break;
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 2200, duration: 0.06, gain: 0.25, q: 2 });
        blip('combat', { type: 'sine', freq: 1400, duration: 0.05, gain: 0.05, delay: 0.06 });
        break;

      case 'weaponSwap':
        if (sample('weapon_swap', { bus: 'combat' })) break;
        switchClick();
        blip('combat', { type: 'sawtooth', freq: 500, freqEnd: 250, duration: 0.25, gain: 0.03, delay: 0.02 });
        break;

      case 'saberSlash':
        if (sample('saber_swing', { bus: 'combat' })) break;
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 1200, filterFreqEnd: 3000, duration: 0.25, gain: 0.15, q: 1.5 });
        break;

      case 'saberHit':
        if (sample('saber_hit', { bus: 'combat' })) break;
        blip('combat', { type: 'sawtooth', freq: 300, freqEnd: 80, duration: 0.18, gain: 0.2 });
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 1000, duration: 0.15, gain: 0.15, q: 1 });
        break;

      case 'shieldUp':
        if (sample('shield_up', { bus: 'combat' })) break;
        blip('combat', { type: 'sine', freq: 400, freqEnd: 1200, duration: 0.25, gain: 0.08 });
        break;

      case 'shieldDown':
        if (sample('shield_down', { bus: 'combat' })) break;
        blip('combat', { type: 'sine', freq: 1000, freqEnd: 300, duration: 0.3, gain: 0.08 });
        break;

      case 'shieldBlock': {
        const dmg = clamp(num(ev.damage, 0.5), 0, 1);
        if (sample('shield_block', { bus: 'combat', gain: 0.5 + 0.5 * dmg })) break;
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 2000, duration: 0.12, gain: 0.2, q: 1 });
        blip('combat', { type: 'sine', freq: 1500, freqEnd: 800, duration: 0.15, gain: 0.08 });
        break;
      }

      case 'partDamaged':
        if (sample('part_damaged', { bus: 'combat' })) break;
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 1800, duration: 0.15, gain: 0.15, q: 0.7 });
        blip('combat', { type: 'sine', freq: 200, freqEnd: 120, duration: 0.15, gain: 0.1 });
        break;

      case 'partDestroyed':
        // The LOST warning alert (sent right after) brings the chime. A recorded alarm, if loaded, replaces it.
        if (samples.part_destroyed) {
          oneShot(PRIO.WARN, samples.part_destroyed.duration, (tt) => alarmSample(one.voices, 'part_destroyed', { at: tt, gain: 0.8 }));
          break;
        }
        noiseBurst('combat', { filterType: 'lowpass', filterFreq: 400, duration: 0.6, gain: 0.25 });
        break;

      case 'enemyPartDestroyed':
        if (sample('enemy_part_destroyed', { bus: 'combat', exterior: true })) break;
        blip('combat', { type: 'sine', freq: 90, freqEnd: 35, duration: 0.5, gain: 0.3, exterior: true });
        noiseBurst('combat', { filterType: 'lowpass', filterFreq: 400, duration: 0.4, gain: 0.2, exterior: true });
        break;

      case 'missileShotDown':
        if (sample('missile_shot_down', { bus: 'combat', exterior: true })) break;
        blip('combat', { type: 'sine', freq: 1400, freqEnd: 300, duration: 0.25, gain: 0.12, exterior: true });
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 2000, duration: 0.15, gain: 0.15, exterior: true });
        break;

      case 'flightTransformStart':
        if (sample('servo', { bus: 'ambience', gain: 0.8 })) break;
        blip('combat', { type: 'sawtooth', freq: 120, freqEnd: 600, duration: 1.0, gain: 0.06 });
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 600, filterFreqEnd: 1800, duration: 1.0, gain: 0.08, q: 2 });
        break;

      case 'flightTransformEnd':
        if (sample('transform_latch', { bus: 'combat' })) break;
        blip('combat', { type: 'sine', freq: 80, freqEnd: 45, duration: 0.25, gain: 0.4 });
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 2500, duration: 0.03, gain: 0.2, q: 0.7, delay: 0.01 });
        break;

      case 'flightRefused':
        oneShot(PRIO.WARN, 0.6, (tt) => {
          if (alarmSample(one.voices, 'flight_refused', { at: tt, gain: 0.8 })) return;
          alarmTone(one.voices, { type: 'sine', freq: 330, freqEnd: 300, duration: 0.2, gain: 0.07, attack: 0.02,
            at: tt, filterType: 'lowpass', filterFreq: 2000, q: 0.5 });
          alarmTone(one.voices, { type: 'sine', freq: 330, freqEnd: 300, duration: 0.2, gain: 0.07, attack: 0.02,
            at: tt + 0.3, filterType: 'lowpass', filterFreq: 2000, q: 0.5 });
        });
        break;

      case 'pullUp':
        // PULL UP is a repeating burst while active (driveAlarm); no extra chime on entry.
        break;

      // ---- CR-004 cockpit hatch and Gawman retrieval. Synth only, on the combat and comms buses: these are
      // mechanical cues and radio traffic, not alarms, so none of them goes through oneShot or the alarm bus.
      case 'hatchUnlock':
        // Locks release: heavy clunk, then the seal hiss.
        blip('combat', { type: 'sine', freq: 90, freqEnd: 40, duration: 0.35, gain: 0.45, attack: 0.002 });
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 3500, duration: 0.6, gain: 0.12, q: 0.7, attack: 0.05, delay: 0.1 });
        break;

      case 'hatchOpen':
        hatchServo(false);
        break;

      case 'hatchClose':
        hatchServo(true);
        break;

      case 'hatchOpened':
        // Air rush as the doors clear: a hiss that rises as the tunnel opens.
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 1500, filterFreqEnd: 6000, duration: 1.4, gain: 0.18, q: 0.7, attack: 0.15 });
        break;

      case 'hatchLocked':
        // Double clunk as the doors seat, then the seal hiss.
        blip('combat', { type: 'sine', freq: 110, freqEnd: 50, duration: 0.22, gain: 0.45 });
        blip('combat', { type: 'sine', freq: 90, freqEnd: 40, duration: 0.25, gain: 0.4, delay: 0.2 });
        noiseBurst('combat', { filterType: 'highpass', filterFreq: 4000, duration: 0.5, gain: 0.12, q: 0.7, attack: 0.05, delay: 0.42 });
        break;

      case 'hatchWind': {
        // Buffeting thumps with the hatch open above the safe speed. Harder with speed; rate limited.
        if (t - lastWindThump < 0.3) break;
        lastWindThump = t;
        const k = clamp((num(ev.speed, 150) - 120) / 120, 0, 1);
        blip('combat', { type: 'sine', freq: 70, freqEnd: 30, duration: 0.3, gain: 0.12 + 0.3 * k, attack: 0.005 });
        noiseBurst('combat', { filterType: 'lowpass', filterFreq: 400, duration: 0.2, gain: 0.05 + 0.15 * k, q: 0.7, attack: 0.005 });
        break;
      }

      case 'gawmanJump':
        // Radio click, then a short burst of static as his handset comes up.
        blip('comms', { type: 'square', freq: 2200, duration: 0.012, gain: 0.05, attack: 0.001 });
        noiseBurst('comms', { filterType: 'bandpass', filterFreq: 2500, duration: 0.35, gain: 0.1, q: 1.2, attack: 0.01, delay: 0.03 });
        break;

      case 'gawmanCaught':
        // Soft thud as he lands in the tunnel, then a relieved radio chirp.
        blip('combat', { type: 'sine', freq: 90, freqEnd: 45, duration: 0.3, gain: 0.35 });
        blip('comms', { type: 'sine', freq: 990, freqEnd: 1480, duration: 0.14, gain: 0.07, attack: 0.01, delay: 0.25 });
        blip('comms', { type: 'sine', freq: 1480, freqEnd: 1760, duration: 0.14, gain: 0.06, attack: 0.01, delay: 0.4 });
        break;

      case 'gawmanLost':
        // Radio static, then the signal drops out.
        noiseBurst('comms', { filterType: 'bandpass', filterFreq: 2000, duration: 0.5, gain: 0.14, q: 1, attack: 0.005 });
        blip('comms', { type: 'sine', freq: 600, freqEnd: 200, duration: 0.25, gain: 0.05, attack: 0.005, delay: 0.1 });
        break;

      // ---- CR-003 multiplayer events. None of these use the alarm bus (no oneShot): they are cues, not alarms.
      case 'remoteFire': {
        // Another pilot's shot: exterior and quieter than our own weapons. Vulcan and pods are rate limited.
        const w = String(ev.weapon || 'rifle');
        if (w === 'vulcan') {
          if (t - lastRemoteFire < 0.06) break;
          lastRemoteFire = t;
          if (sample('vulcan', { bus: 'combat', exterior: true, gain: 0.25, rate: 0.9 + 0.1 * Math.random() })) break;
          noiseBurst('combat', { filterType: 'highpass', filterFreq: 3000, duration: 0.02, gain: 0.04, q: 0.7, exterior: true });
          break;
        }
        if (t - lastRemoteFire < 0.08) break;
        lastRemoteFire = t;
        if (w === 'pods') {
          if (sample('missile_launch', { bus: 'combat', exterior: true, gain: 0.3 })) break;
          noiseBurst('combat', { filterType: 'bandpass', filterFreq: 300, filterFreqEnd: 2000, duration: 0.6, gain: 0.07, q: 1.2, exterior: true });
          break;
        }
        if (w === 'saber') {
          blip('combat', { type: 'sine', freq: 500, freqEnd: 250, duration: 0.15, gain: 0.03, exterior: true });
          break;
        }
        // rifle: distant beam, about 0.6 s
        if (sample('enemy_beam', { bus: 'combat', exterior: true, gain: 0.2 })) break;
        blip('combat', { type: 'sine', freq: 70, freqEnd: 35, duration: 0.6, gain: 0.1, attack: 0.005, exterior: true });
        noiseBurst('combat', { filterType: 'bandpass', filterFreq: 900, filterFreqEnd: 300, duration: 0.5, gain: 0.06, q: 1, attack: 0.005, exterior: true });
        break;
      }

      case 'hitConfirm':
        // Our shot hit a remote suit or AI: a short crisp tick, a double tick on a kill.
        blip('combat', { type: 'sine', freq: 2400, duration: 0.03, gain: 0.08, attack: 0.001 });
        if (ev.kill) blip('combat', { type: 'sine', freq: 1800, duration: 0.04, gain: 0.08, attack: 0.001, delay: 0.07 });
        break;

      case 'killFeed':
        break;                                      // no sound: the feed is read, not heard

      case 'matchCountdown':
        // One beep per second; the last seconds are the same beep, the match start has its own.
        if (num(ev.seconds, 0) > 0) blip('comms', { type: 'sine', freq: 660, duration: 0.12, gain: 0.07, attack: 0.005 });
        break;

      case 'matchStart':
        blip('comms', { type: 'sine', freq: 1320, duration: 0.35, gain: 0.1, attack: 0.005 });
        blip('comms', { type: 'sine', freq: 1760, duration: 0.45, gain: 0.08, attack: 0.005, delay: 0.18 });
        break;

      case 'respawn':
        // Systems-online sweep as the suit comes back up.
        blip('combat', { type: 'triangle', freq: 300, freqEnd: 1200, duration: 0.9, gain: 0.08, attack: 0.05 });
        blip('combat', { type: 'sine', freq: 600, freqEnd: 1800, duration: 0.8, gain: 0.04, attack: 0.08, delay: 0.1 });
        break;

      case 'matchEnd':
        // Calm: a rising major triad, no alarm.
        blip('comms', { type: 'sine', freq: 523, duration: 0.5, gain: 0.06, attack: 0.02 });
        blip('comms', { type: 'sine', freq: 659, duration: 0.7, gain: 0.06, attack: 0.02, delay: 0.3 });
        blip('comms', { type: 'sine', freq: 784, duration: 1.0, gain: 0.06, attack: 0.02, delay: 0.6 });
        break;

      case 'peerJoined':
        blip('comms', { type: 'sine', freq: 880, duration: 0.25, gain: 0.04, attack: 0.02 });
        blip('comms', { type: 'sine', freq: 1174, duration: 0.3, gain: 0.03, attack: 0.02, delay: 0.12 });
        break;

      case 'peerLeft':
        blip('comms', { type: 'sine', freq: 740, duration: 0.25, gain: 0.04, attack: 0.02 });
        blip('comms', { type: 'sine', freq: 554, duration: 0.3, gain: 0.035, attack: 0.02, delay: 0.14 });
        break;

      default:
        break;                                      // unknown event types are ignored
    }
  }

  // ---- graph construction ----------------------------------------------------

  function lowpass(f, q) {
    const b = ctx.createBiquadFilter();
    b.type = 'lowpass';
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  function buildLayers() {
    const c = ctx;
    const osc = (type, f) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      return o;
    };
    const gain = (v) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    const bandpass = (f, q) => {
      const b = c.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };

    L = {};
    // 1. Minovsky drive whine
    L.whineSaw = osc('sawtooth', 1200);
    L.whineSine = osc('sine', 600);
    L.whineBP = bandpass(1200, 2.5);
    L.whineGain = gain(0);
    L.whineSaw.connect(L.whineBP);
    L.whineSine.connect(L.whineBP);
    L.whineBP.connect(L.whineGain);
    L.whineGain.connect(bus.ambience);

    // 2. Reactor / cabin hum
    L.hum60 = osc('sine', 60);
    L.hum120 = osc('sine', 120);
    L.humGain = gain(0);
    const hum120Level = gain(0.4);
    L.hum60.connect(L.humGain);
    L.hum120.connect(hum120Level);
    hum120Level.connect(L.humGain);
    L.humGain.connect(bus.ambience);

    // 3. Wind rumble and boost roar
    L.windNoise = noiseSource('pink', true);
    L.windLP = lowpass(200, 0.5);
    L.windGain = gain(0);
    L.roarLP = lowpass(1200, 0.5);
    L.roarGain = gain(0);
    L.windNoise.connect(L.windLP);
    L.windLP.connect(L.windGain);
    L.windGain.connect(bus.ambience);
    L.windNoise.connect(L.roarLP);
    L.roarLP.connect(L.roarGain);
    L.roarGain.connect(bus.ambience);

    // 3b. CR-004 open-hatch wind roar: pink noise in the tunnel, only while the hatch is open (see frame()).
    L.hatchNoise = noiseSource('pink', true);
    L.hatchBP = bandpass(700, 0.8);
    L.hatchGain = gain(0);
    L.hatchNoise.connect(L.hatchBP);
    L.hatchBP.connect(L.hatchGain);
    L.hatchGain.connect(bus.ambience);

    // 4. Lock tones (combat bus)
    L.acqOsc = osc('sine', 880);
    L.acqGain = gain(0);                            // scheduled 4 Hz gate while acquiring
    L.acqOsc.connect(L.acqGain);
    L.acqGain.connect(bus.combat);
    L.lockOsc1 = osc('sine', 880);
    L.lockOsc2 = osc('sine', 1760);
    L.lockGain = gain(0);
    L.lockOsc1.connect(L.lockGain);
    L.lockOsc2.connect(L.lockGain);
    L.lockGain.connect(bus.combat);

    // 5-6. Alarms (missile, PULL UP, chimes) are scheduled one-shots, see driveAlarm; no continuous alarm nodes.

    // 7. Breathing: pink noise through 500 Hz bandpass, swelling via an LFO
    L.breathNoise = noiseSource('pink', true);
    L.breathBP = bandpass(500, 1.2);
    L.breathAmp = gain(0);
    L.breathLfo = osc('sine', 0.4);
    L.breathDepth = gain(0);
    L.breathLfo.connect(L.breathDepth);
    L.breathDepth.connect(L.breathAmp.gain);
    L.breathNoise.connect(L.breathBP);
    L.breathBP.connect(L.breathAmp);
    L.breathAmp.connect(bus.ambience);

    // 8. Thruster bursts: soft noise under 500 Hz, follows requested movement
    L.thrNoise = noiseSource('white', true);
    L.thrLP = lowpass(500, 0.5);
    L.thrGain = gain(0);
    L.thrNoise.connect(L.thrLP);
    L.thrLP.connect(L.thrGain);
    L.thrGain.connect(bus.ambience);

    // 9. Body servo whirr: turning toward the crosshair (quiet)
    L.servoOsc = osc('sawtooth', 180);
    L.servoLP = lowpass(600, 0.7);
    L.servoGain = gain(0);
    L.servoOsc.connect(L.servoLP);
    L.servoLP.connect(L.servoGain);
    L.servoGain.connect(bus.ambience);

    for (const n of [L.whineSaw, L.whineSine, L.hum60, L.hum120, L.windNoise, L.hatchNoise, L.acqOsc,
      L.lockOsc1, L.lockOsc2, L.breathNoise, L.breathLfo,
      L.thrNoise, L.servoOsc]) {
      n.start();
    }
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const c = ctx;

    master = c.createGain();
    master.gain.value = 0;                          // fades up to 0.8 on first update
    masterLP = c.createBiquadFilter();
    masterLP.type = 'lowpass';
    masterLP.frequency.value = 18000;
    masterLP.Q.value = 0.5;
    const comp = c.createDynamicsCompressor();
    master.connect(masterLP);
    masterLP.connect(comp);
    comp.connect(c.destination);

    for (const name of ['alarms', 'comms', 'combat', 'ambience']) {
      const g = c.createGain();
      // Alarms sit at half the level they had, so they stay under weapons and explosions.
      g.gain.value = name === 'alarms' ? 0.5 : 1;
      g.connect(master);
      bus[name] = g;
    }

    // Exterior chain: two cascaded 400 Hz lowpass filters, feeding the combat bus.
    const e1 = c.createBiquadFilter();
    const e2 = c.createBiquadFilter();
    for (const f of [e1, e2]) {
      f.type = 'lowpass';
      f.frequency.value = 400;
      f.Q.value = 0.707;
    }
    e1.connect(e2);
    e2.connect(bus.combat);
    extIn = e1;

    buildLayers();
    decodeSamples(c);
  }

  // ---- per-frame --------------------------------------------------------------

  function frame(dt, S) {
    const t = now();
    const P = S.player || {};
    const I = S.input || {};
    const stage = num((S.startup || {}).stage, 0);
    const inStartup = S.phase === 'startup';
    const stress = clamp(num(P.stress, 0), 0, 1);
    const hull = num(P.hull, 1);
    const gLoad = num(P.gLoad, 1);
    const throttleAbs = clamp(Math.abs(num(P.throttle, 0)), 0, 1);
    const boost = clamp(num(I.boost, 0), 0, 1);
    const speed = num(P.speed, 0);
    const lockState = (P.lock && P.lock.state) || 'none';
    const inbound = !!(P.threat && P.threat.missileInbound);
    const blackout = clamp(num(P.blackout, 0), 0, 1);
    const pullUpOn = !!(P.pullUp && P.pullUp.active);
    const inc = P.threat && Array.isArray(P.threat.incoming) ? P.threat.incoming : [];
    let missileTti = Infinity;                      // soonest time-to-impact among incoming missiles
    for (const m of inc) if (m && typeof m.tti === 'number' && m.tti < missileTti) missileTti = m.tti;
    const pullTti = P.pullUp && typeof P.pullUp.tti === 'number' ? P.pullUp.tti : Infinity;

    // Master: fade out while paused, otherwise up to 0.8 (safe ceiling).
    setP(master.gain, dt === 0 ? 0 : 0.8, 0.1);

    // Alarms sound only while flying (or disabled and falling), never when paused, dead, ejected or after victory.
    // dt is 0 while paused or before start (main.js), so that also silences them.
    alarmLive = dt > 0 && S.paused !== true && (S.phase === 'flight' || S.phase === 'disabled');
    const pullOn = alarmLive && S.phase === 'flight' && pullUpOn;
    const missileOn = alarmLive && S.phase === 'flight' && (inbound || inc.length > 0);
    driveAlarm(t, pullOn ? 'pull' : missileOn ? 'missile' : null, pullOn ? pullTti : missileTti);

    // One-shot events (main clears the queue after this call).
    const events = Array.isArray(S.events) ? S.events : [];
    for (const ev of events) {
      if (ev && typeof ev.type === 'string') handleEvent(ev, t, S);
    }

    // Radio line: squelch when the message text changes to a new non-empty value.
    const msg = S.mission && S.mission.message ? S.mission.message.text : undefined;
    if (typeof msg === 'string') {
      if (msg !== '' && msg !== lastMsg) squelch();
      lastMsg = msg;
    }

    // Ducking: a continuous alarm (PULL UP, missile) ducks the radio; weapons and explosions are not ducked by alarms.
    const commsActive = t < commsUntil;
    const combatRecent = t < combatLast + 0.3;
    setP(bus.comms.gain, cont.key ? DB(-6) : 1, 0.05);
    setP(bus.combat.gain, commsActive ? DB(-4) : 1, 0.05);
    setP(bus.ambience.gain, combatRecent ? DB(-8) : 1, 0.05);

    // 1. Minovsky whine: silent during cold start until stage 3.
    const mach01 = clamp(num(P.mach, 0) / 2.2, 0, 1);
    const whineF = 1200 + 2600 * mach01;
    const silentStartup = inStartup && stage < 3;
    setP(L.whineSaw.frequency, whineF);
    setP(L.whineSine.frequency, whineF * 0.5);
    setP(L.whineBP.frequency, whineF);
    const minovSample = loopSample('minovsky', 'minovsky_drive_loop', !silentStartup, 0.02 + 0.06 * throttleAbs, 'ambience');
    setP(L.whineGain.gain, (silentStartup || minovSample) ? 0 : 0.008 + 0.03 * throttleAbs);

    // 2. Hum: on from harness stage 1 onward.
    const powered = !inStartup || stage >= 1;
    setP(L.humGain.gain, powered ? 0.012 : 0);

    // 3. Wind and boost roar.
    // CR-004: the night mission lowers the wind bed a little; with the hatch open the tunnel takes over part of
    // the outside rumble.
    const spd = clamp(speed / 600, 0, 1);
    const hatchOpen = clamp(num((P.hatch || {}).open, 0), 0, 1);
    const bed = (S.world && S.world.night ? 0.8 : 1) * (1 - 0.5 * hatchOpen);
    setP(L.windLP.frequency, 200 + 400 * spd);
    const windSample = loopSample('wind', 'wind_loop', !inStartup, (0.03 + 0.25 * spd) * bed, 'ambience');
    setP(L.windGain.gain, windSample ? 0 : (0.02 + 0.1 * spd) * bed);
    // CR-004 wind roar through the open hatch: scales with speed and with how far the doors are apart; loud above 120 m/s.
    const hatchSpd = clamp(speed / 200, 0, 1);
    const hatchLoud = clamp((speed - 120) / 80, 0, 1);
    setP(L.hatchBP.frequency, 300 + 900 * hatchSpd);
    setP(L.hatchGain.gain, hatchOpen * (0.01 + 0.08 * hatchSpd + 0.2 * hatchLoud));
    const engineSample = loopSample('engine', 'engine_loop', !inStartup, 0.02 + 0.06 * throttleAbs + 0.08 * boost, 'ambience');
    setP(L.roarGain.gain, engineSample ? 0 : 0.07 * boost);
    if (boost > 0.5 && boostWas <= 0.5) sample('boost', { bus: 'ambience', gain: 0.9 });
    boostWas = boost;

    // Thruster bursts follow the strongest requested axis, so strafing and climbing are audible.
    const thrustReq = clamp(Math.max(Math.abs(num(I.moveX, 0)), Math.abs(num(I.moveY, 0)), Math.abs(num(I.moveZ, 0))), 0, 1);
    setP(L.thrGain.gain, inStartup ? 0 : 0.025 * thrustReq, 0.05);

    // Servo whirr: follows how hard the body is turning toward the crosshair.
    const turning = clamp(num((P.aim || {}).turning, 0), 0, 1);
    setP(L.servoGain.gain, inStartup ? 0 : 0.02 * turning, 0.05);

    // 4. Lock tones. Acquiring: 880 Hz gated at 4 Hz. Locked: 880 + 1760 Hz continuous.
    const acquiring = lockState === 'acquiring';
    gateTick(gates.lock, t, acquiring, 4,
      (tt, on) => L.acqGain.gain.setValueAtTime(on ? 0.05 : 0, tt),
      () => {
        L.acqGain.gain.cancelScheduledValues(t);
        L.acqGain.gain.setValueAtTime(0, t);
      });
    setP(L.lockGain.gain, lockState === 'locked' ? 0.05 : 0);

    // 5-6. Missile warning and PULL UP: driveAlarm (burst patterns). Chimes: alert events above.

    // 7. Heartbeat and breathing.
    const sEff = hull < 0.25 ? Math.max(stress, 0.6) : stress;
    const hbOn = stress > 0.3 || hull < 0.25;
    if (hbOn) heartbeat(t, sEff);
    else hb.running = false;
    const strain = gLoad > 4.5;
    if (strain && !strainWas) sample('high_g_strain', { bus: 'ambience', gain: 0.7 });
    strainWas = strain;
    const brOn = hbOn || strain;
    const brBase = brOn ? 0.015 + 0.06 * sEff + (strain ? 0.03 : 0) : 0;
    setP(L.breathAmp.gain, brBase, 0.2);
    setP(L.breathDepth.gain, brBase, 0.2);
    setP(L.breathLfo.frequency, 0.25 + 0.75 * sEff + (strain ? 0.5 : 0), 0.3);

    // 8. Blackout muffles the master output; concussion briefly drops it to 900 Hz.
    let cut = 18000 * Math.pow(500 / 18000, blackout);
    if (t < concussionUntil) cut = Math.min(cut, 900);
    setP(masterLP.frequency, cut, 0.05);
  }

  // ---- public API --------------------------------------------------------------

  function resume() {
    try {
      if (!ctx) build();
      if (ctx.state === 'suspended') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) {
      console.warn('[audio] unavailable', e);
    }
  }

  function update(dt) {
    if (!ctx || !L) return;
    try {
      frame(Number(dt) || 0, state || {});
    } catch (e) {
      if (!warned) {
        warned = true;
        console.warn('[audio] frame error', e);
      }
    }
  }

  return { resume, update };
}
