/* Som de fundo lo-fi por jogo — sintetizado no próprio navegador (Web Audio API), sem arquivos de áudio.
   Cada jogo tem um "clima" próprio (andamento, tonalidade, progressão, timbres e densidade da melodia), mas
   todos seguem o mesmo padrão relaxante: pads suaves, baixo redondo, melodia esparsa, percussão discreta e um
   chiado de vinil. O áudio só começa depois do primeiro gesto do usuário (política de autoplay dos navegadores)
   e a preferência de mudo fica salva em `wmg.muted`; o volume do regulador fica em `wmg.music.volume`. O botão
   (`musicSwitch`) aparece ao lado do tema e só em páginas de jogo (quando `Music.play(id)` é chamado). */
import { store } from "./storage.js";

const KEY = "wmg.muted";
const VOL_KEY = "wmg.music.volume";
const MAX_GAIN = 1.5;      // teto do regulador (permite subir bem acima do padrão antigo)
const DEFAULT_VOL = 0.8;   // volume inicial: mais alto que antes (0,8 × 1,5 = 1,2)
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a, b) => a + Math.random() * (b - a);
const chance = p => Math.random() < p;

/* Cada jogo tem uma progressão e um timbre próprios. Offsets em semitons a partir de `root` (nota MIDI). */
const MOODS = {
  arrows: {
    bpm: 68, root: 45, scale: [0, 2, 3, 5, 7, 10], pad: "triangle", lead: "sine",
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 8]],
    melody: 0.15, kick: 0.05, hat: 0.05, swing: 0.14,
  },
  zip: {
    bpm: 76, root: 48, scale: [0, 2, 4, 7, 9], pad: "sine", lead: "triangle",
    chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
    melody: 0.15, kick: 0.05, hat: 0.05, swing: 0.10,
  },
  patches: {
    bpm: 72, root: 50, scale: [0, 2, 3, 5, 7, 9], pad: "triangle", lead: "sine",
    chords: [[0, 3, 7, 10], [-4, 0, 3, 7], [-7, -3, 0, 3], [-5, -1, 2, 5]],
    melody: 0.15, kick: 0.05, hat: 0.05, swing: 0.12,
  },
  sudoku: {
    bpm: 62, root: 52, scale: [0, 2, 3, 5, 7, 9], pad: "sine", lead: "sine",
    chords: [[0, 3, 7, 10], [-4, 0, 4, 7], [-7, -3, 0, 3], [-5, -1, 2, 5]],
    melody: 0.10, kick: 0.03, hat: 0.03, swing: 0.18,
  },
  sopa: {
    bpm: 84, root: 53, scale: [0, 2, 4, 7, 9], pad: "triangle", lead: "triangle",
    chords: [[0, 4, 7, 11], [-3, 0, 3, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
    melody: 0.15, kick: 0.05, hat: 0.05, swing: 0.08,
  },
  canos: {
    bpm: 74, root: 55, scale: [0, 2, 4, 6, 7, 9], pad: "sine", lead: "triangle",
    chords: [[0, 4, 7, 11], [-3, 0, 3, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
    melody: 0.15, kick: 0.05, hat: 0.05, swing: 0.10,
  },
  cruzadas: {
    bpm: 78, root: 46, scale: [0, 2, 3, 5, 7, 9], pad: "triangle", lead: "sine",
    chords: [[0, 4, 7, 11], [-3, 0, 3, 7], [-7, -3, 0, 4], [-5, -1, 2, 5]],
    melody: 0.15, kick: 0.05, hat: 0.05, swing: 0.12,
  },
  queens: {
    bpm: 66, root: 54, scale: [0, 2, 3, 5, 7, 10], pad: "sine", lead: "triangle",
    chords: [[0, 3, 7, 10], [-5, 0, 3, 7], [-2, 2, 5, 8], [-4, 0, 4, 7]],
    melody: 0.13, kick: 0.04, hat: 0.04, swing: 0.16,
  },
  tango: {
    bpm: 62, root: 50, scale: [0, 2, 3, 6, 7, 10], pad: "triangle", lead: "sine",
    chords: [[0, 3, 7, 10], [-2, 2, 5, 9], [-4, 0, 3, 8], [-7, -3, 0, 5]],
    melody: 0.12, kick: 0.04, hat: 0.05, swing: 0.20,
  },
};

let ctx = null, master = null, bus = null, noise = null, timer = null, bar = 0, nextBar = 0;
let game = null, muted = store.get(KEY) === "1", armed = false;
const readVolume = () => {
  const v = parseFloat(store.get(VOL_KEY));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_VOL;
};
let volume = readVolume();
const gainFor = () => (muted ? 0 : volume * MAX_GAIN);

const emit = () => { try { dispatchEvent(new CustomEvent("musicstate")); } catch { /* fora do navegador */ } };

/* ---------- grafo ---------- */
function build() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = gainFor();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
  master.connect(comp).connect(ctx.destination);

  const len = Math.floor(ctx.sampleRate * 2);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.4;
  const g = ctx.createGain(); g.gain.value = 0.018;                 // chiado de vinil bem baixo
  src.connect(lp).connect(g).connect(master); src.start();
  return true;
}

/* ---------- vozes ---------- */
function voice(freq, t, dur, { type = "sine", gain = 0.05, attack = 0.01, release = 0.18, filter = 1200, pan = 0, detune = 0 } = {}) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  f.type = "lowpass"; f.frequency.value = filter; f.Q.value = 0.5;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, Math.max(t + attack, t + dur - release));
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(f).connect(g);
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(bus); }
  else g.connect(bus);
  o.start(t); o.stop(t + dur + 0.05);
}
const pad = (freq, t, dur, wave) => {
  voice(freq, t, dur, { type: wave, gain: 0.026, attack: 0.9, release: 0.9, filter: 780, detune: -4, pan: -0.25 });
  voice(freq, t, dur, { type: wave, gain: 0.020, attack: 1.1, release: 1.0, filter: 900, detune: 4, pan: 0.25 });
};
const bass = (freq, t, dur) => voice(freq, t, dur, { type: "sine", gain: 0.075, attack: 0.03, release: 0.28, filter: 260 });
const lead = (freq, t, dur, wave) => voice(freq, t, dur, { type: wave, gain: 0.018, attack: 0.05, release: 0.5, filter: 900, pan: rand(-0.15, 0.15) });

function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
  g.gain.setValueAtTime(0.085, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g).connect(bus); o.start(t); o.stop(t + 0.25);
}
function noiseHit(t, { gain = 0.02, hp = 6000, dur = 0.05, pan = 0 } = {}) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
  s.buffer = noise; f.type = "highpass"; f.frequency.value = hp; p.pan.value = pan;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f).connect(g).connect(p).connect(bus);
  s.start(t); s.stop(t + dur + 0.02);
}

/* ---------- agendamento ---------- */
function scheduleBar(i, t) {
  const m = MOODS[game];
  if (!m) return;
  const beat = 60 / m.bpm, dur = beat * 4, chord = m.chords[i % m.chords.length];
  for (const off of chord) pad(midiHz(m.root + 12 + off), t, dur, m.pad);
  bass(midiHz(m.root + chord[0]), t, beat * 1.4);
  bass(midiHz(m.root + chord[0]), t + beat * 2, beat * 1.4);
  for (let s = 0; s < 8; s++) {
    if (!chance(m.melody * (s % 2 ? 0.6 : 0.35))) continue;
    const sw = s % 2 ? m.swing * beat : 0;
    const note = m.scale[(Math.random() * m.scale.length) | 0];
    lead(midiHz(m.root + 24 + note + (chance(0.25) ? 12 : 0)), t + (s * beat) / 2 + sw, beat * rand(0.6, 1.1), m.lead);
  }
  if (chance(m.kick)) kick(t);
  if (chance(m.kick * 0.7)) kick(t + beat * 2);
  for (const s of [1, 3, 5, 7]) if (chance(m.hat)) noiseHit(t + (s * beat) / 2 + m.swing * beat, { gain: 0.006, hp: 3500, dur: 0.04, pan: rand(-0.3, 0.3) });
}
function tick() {
  if (!ctx || muted || !game) return;
  const m = MOODS[game];
  if (!m) return;
  const dur = (60 / m.bpm) * 4;
  while (nextBar < ctx.currentTime + 0.8) { scheduleBar(bar, nextBar); bar++; nextBar += dur; }
}

/* ---------- controle ---------- */
function start() {
  if (!game || muted) return;
  if (!build()) return;
  if (ctx.state === "suspended") ctx.resume();
  if (timer) return;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(gainFor(), now + 0.25);
  bus = ctx.createGain(); bus.gain.value = 1; bus.connect(master);   // cada sessão tem seu barramento
  bar = 0; nextBar = now + 0.08;
  tick();
  timer = setInterval(tick, 150);
  emit();
}
/** Para o som; `hard` também silencia o chiado de vinil (usado no mudo). */
function stop(hard = false) {
  if (timer) { clearInterval(timer); timer = null; }
  if (!ctx) return;
  const now = ctx.currentTime;
  if (bus) {
    const old = bus; bus = null;
    old.gain.cancelScheduledValues(now);
    old.gain.setValueAtTime(old.gain.value, now);
    old.gain.linearRampToValueAtTime(0, now + 0.12);
    setTimeout(() => { try { old.disconnect(); } catch { /* já desconectado */ } }, 300);
  }
  if (hard) {
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.12);
  }
}

/** O áudio só pode começar num gesto do usuário; arma uma única escuta para o primeiro clique/tecla. */
function arm() {
  if (armed || muted || !game) return;
  armed = true;
  const on = () => { if (!muted) start(); };
  addEventListener("pointerdown", on, { once: true, capture: true });
  addEventListener("keydown", on, { once: true, capture: true });
}

function setMuted(v) {
  muted = !!v;
  store.set(KEY, muted ? "1" : "0");
  if (muted) stop(true); else start();
  emit();
}

/** Regulador de volume (0 a 1). Aplicado na hora, salvo entre visitas. */
function setVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0));
  store.set(VOL_KEY, String(volume));
  if (ctx && master) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(gainFor(), now + 0.08);
  }
  if (!muted) { if (volume === 0) stop(false); else start(); }
  emit();
}

export const Music = {
  /** Jogo atual (null fora das páginas de jogo). */
  get game() { return game; },
  get muted() { return muted; },
  get volume() { return volume; },
  /** Liga o som de fundo deste jogo (o botão ao lado do tema passa a aparecer). */
  play(id) {
    if (game === id) return;
    game = id;
    emit();
    arm();
  },
  toggle() { setMuted(!muted); },
  setMuted,
  setVolume,
};

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) { stop(false); ctx.suspend?.(); }
    else if (game && !muted) { ctx.resume?.(); start(); }
  });
}

const ICON_ON = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_OFF = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

/** Botão de mudo (alto-falante) + regulador de volume. Fica escondido fora das páginas de jogo. */
export function musicSwitch() {
  const ctl = document.createElement("div");
  ctl.className = "music-ctl";

  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "music-switch";
  btn.onclick = () => Music.toggle();

  const pop = document.createElement("div");
  pop.className = "music-pop";
  const row = document.createElement("label");
  const name = document.createElement("span"); name.textContent = "Volume";
  const range = document.createElement("input");
  range.type = "range"; range.min = "0"; range.max = "100"; range.step = "1";
  range.setAttribute("aria-label", "Volume da música");
  const out = document.createElement("output");
  range.addEventListener("input", () => Music.setVolume(Number(range.value) / 100));
  row.append(name, range, out);
  pop.append(row);

  const sync = () => {
    ctl.hidden = !Music.game;
    btn.innerHTML = Music.muted ? ICON_OFF : ICON_ON;
    btn.setAttribute("aria-pressed", String(Music.muted));
    const label = Music.muted ? "Ativar som de fundo" : "Silenciar som de fundo";
    btn.setAttribute("aria-label", label); btn.title = label;
    const pct = Math.round(Music.volume * 100);
    range.value = String(pct); out.textContent = `${pct}%`;
  };
  addEventListener("musicstate", sync);
  sync();

  ctl.append(btn, pop);
  return ctl;
}
