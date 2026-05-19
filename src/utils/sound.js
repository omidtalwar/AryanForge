/**
 * sound.js — Procedural Web Audio API sound system.
 * All sounds are synthesized at runtime — no audio files required.
 * Must call resumeAudio() on first user gesture to unblock the AudioContext.
 */

let ctx = null;
let masterGain = null;
let ambientNode = null;
let ambientGain = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

/** Call once on first user click to unblock iOS/Chrome autoplay policy. */
export function resumeAudio() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

// ── One-shot event sounds ──────────────────────────────────────────────────────

/** Short thud + white-noise burst for agent death. Rate-limited internally. */
let lastDeathAt = 0;
export function playDeath() {
  const now = performance.now();
  if (now - lastDeathAt < 80) return; // max ~12/sec to avoid cacophony
  lastDeathAt = now;
  const c = getCtx();
  const t = c.currentTime;

  // Low thud
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  env.gain.setValueAtTime(0.35, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(env); env.connect(masterGain);
  osc.start(t); osc.stop(t + 0.3);

  // Noise crackle
  const buf = c.createBuffer(1, c.sampleRate * 0.12, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
  const noise = c.createBufferSource();
  noise.buffer = buf;
  const nf = c.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 800;
  nf.Q.value = 0.8;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.25, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  noise.connect(nf); nf.connect(ng); ng.connect(masterGain);
  noise.start(t);
}

/** Metallic clank for melee hit. Rate-limited. */
let lastHitAt = 0;
export function playHit() {
  const now = performance.now();
  if (now - lastHitAt < 60) return;
  lastHitAt = now;
  const c = getCtx();
  const t = c.currentTime;

  const osc1 = c.createOscillator();
  const osc2 = c.createOscillator();
  const env  = c.createGain();

  // Two slightly detuned partials = metallic ring
  osc1.type = 'triangle';
  osc2.type = 'triangle';
  osc1.frequency.value = 1800 + Math.random() * 400;
  osc2.frequency.value = osc1.frequency.value * 1.41; // inharmonic ratio
  env.gain.setValueAtTime(0.18, t);
  env.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

  osc1.connect(env); osc2.connect(env); env.connect(masterGain);
  osc1.start(t); osc1.stop(t + 0.14);
  osc2.start(t); osc2.stop(t + 0.14);
}

/** Splash sound when an agent drowns. */
export function playSplash() {
  const c = getCtx();
  const t = c.currentTime;

  const buf = c.createBuffer(1, c.sampleRate * 0.4, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const env = Math.exp(-i / (c.sampleRate * 0.15));
    d[i] = (Math.random() * 2 - 1) * env;
  }
  const src = c.createBufferSource();
  src.buffer = buf;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;

  const g = c.createGain();
  g.gain.value = 0.4;
  src.connect(lp); lp.connect(g); g.connect(masterGain);
  src.start(t);
}

/** Short fanfare sting for scenario end. */
export function playVictory() {
  const c = getCtx();
  const t = c.currentTime;
  const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const st = t + i * 0.12;
    env.gain.setValueAtTime(0, st);
    env.gain.linearRampToValueAtTime(0.3, st + 0.04);
    env.gain.exponentialRampToValueAtTime(0.001, st + 0.5);
    osc.connect(env); env.connect(masterGain);
    osc.start(st); osc.stop(st + 0.5);
  });
}

// ── Continuous ambient sounds ──────────────────────────────────────────────────

/** Start a looping water/flood ambient (filtered noise + low rumble). */
export function startWaterAmbient() {
  stopAmbient();
  const c = getCtx();

  // White noise source
  const bufLen = c.sampleRate * 2;
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  // Bandpass → sounds like rushing water
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 400;
  bp.Q.value = 0.4;

  // Low rumble oscillator
  const rumble = c.createOscillator();
  rumble.type = 'sine';
  rumble.frequency.value = 55;

  ambientGain = c.createGain();
  ambientGain.gain.value = 0;
  noise.connect(bp); bp.connect(ambientGain);
  rumble.connect(ambientGain);
  ambientGain.connect(masterGain);

  noise.start();
  rumble.start();
  ambientGain.gain.linearRampToValueAtTime(0.22, c.currentTime + 2);
  ambientNode = [noise, rumble];
}

/** Start looping wind ambient for endurance scenario. */
export function startWindAmbient() {
  stopAmbient();
  const c = getCtx();

  const bufLen = c.sampleRate * 2;
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
  const noise = c.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 180;

  ambientGain = c.createGain();
  ambientGain.gain.value = 0;
  noise.connect(lp); lp.connect(ambientGain);
  ambientGain.connect(masterGain);
  noise.start();
  ambientGain.gain.linearRampToValueAtTime(0.18, c.currentTime + 2);
  ambientNode = [noise];
}

/** Start looping battle drum ambient. */
export function startBattleAmbient() {
  stopAmbient();
  const c = getCtx();

  // Repeating low drum hit
  function drum() {
    if (!ambientGain) return;
    const t = c.currentTime;
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    env.gain.setValueAtTime(0.28, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.connect(env); env.connect(masterGain);
    osc.start(t); osc.stop(t + 0.22);
  }

  ambientGain = c.createGain(); // sentinel so stopAmbient clears it
  ambientGain.connect(masterGain);

  let running = true;
  const drumLoop = setInterval(() => {
    if (!running || !ambientGain) { clearInterval(drumLoop); return; }
    drum();
  }, 480);
  ambientNode = { running, drumLoop, stop() { running = false; clearInterval(drumLoop); } };
}

/** Fade out and stop any running ambient. */
export function stopAmbient() {
  if (ambientGain) {
    ambientGain.gain.linearRampToValueAtTime(0, getCtx().currentTime + 0.8);
    ambientGain = null;
  }
  if (ambientNode) {
    if (Array.isArray(ambientNode)) {
      ambientNode.forEach(n => { try { n.stop(); } catch (_) {} });
    } else if (ambientNode.stop) {
      ambientNode.stop();
    }
    ambientNode = null;
  }
}
