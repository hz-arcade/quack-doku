import { audio } from './context';
import { noteToFreq } from './notes';

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, slideTo?: number, when = 0): void {
  const ctx = audio.ctx;
  const out = audio.sfx;
  if (!ctx || !out) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, type: BiquadFilterType = 'bandpass', when = 0, slideTo?: number): void {
  const ctx = audio.ctx;
  const out = audio.sfx;
  if (!ctx || !out) return;
  const t0 = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
}

/**
 * A rubber-duck squeak: a buzzy sawtooth through two vocal-ish formant filters, pitch
 * rising then falling, with a little wobble. `pitch` scales the whole thing.
 */
function squeak(pitch = 1, when = 0, vol = 0.32): void {
  const ctx = audio.ctx;
  const out = audio.sfx;
  if (!ctx || !out) return;
  const t0 = ctx.currentTime + when;
  const dur = 0.2;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(560 * pitch, t0);
  o.frequency.linearRampToValueAtTime(760 * pitch, t0 + 0.05);
  o.frequency.exponentialRampToValueAtTime(430 * pitch, t0 + dur);
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 32;
  lfoGain.gain.value = 22 * pitch;
  lfo.connect(lfoGain).connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.setValueAtTime(vol, t0 + 0.09);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  for (const [f, q, v] of [
    [1150, 5, 1],
    [2600, 7, 0.55],
  ] as const) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * Math.sqrt(pitch);
    bp.Q.value = q;
    const mix = ctx.createGain();
    mix.gain.value = v;
    o.connect(bp).connect(mix).connect(g);
  }
  g.connect(out);
  o.start(t0);
  lfo.start(t0);
  o.stop(t0 + dur + 0.02);
  lfo.stop(t0 + dur + 0.02);
}

function jingle(tokens: string, unit: number, type: OscillatorType = 'triangle', vol = 0.22): void {
  let t = 0;
  for (const tok of tokens.split(/\s+/)) {
    const [n, l] = tok.split(':');
    const len = Number(l ?? 1) * unit;
    if (n && n !== '-') {
      tone(noteToFreq(n), len * 0.95, type, vol, undefined, t);
      tone(noteToFreq(n) * 2, len * 0.5, 'sine', vol * 0.3, undefined, t);
    }
    t += len;
  }
}

export const sfx = {
  /** A duck lands; each one squeaks at a slightly different pitch. */
  duck(): void {
    squeak(0.94 + Math.random() * 0.14);
    noise(0.08, 0.12, 900, 'lowpass');
  },
  x(): void {
    noise(0.035, 0.18, 3200, 'bandpass');
    tone(1500, 0.03, 'triangle', 0.05);
  },
  erase(): void {
    noise(0.05, 0.12, 1400, 'bandpass', 0, 700);
  },
  clash(): void {
    squeak(0.7, 0, 0.26);
    tone(180, 0.18, 'square', 0.12, 110);
  },
  undo(): void {
    tone(880, 0.06, 'sine', 0.1, 600);
  },
  click(): void {
    tone(1250, 0.03, 'triangle', 0.08);
  },
  hint(): void {
    tone(noteToFreq('E6'), 0.14, 'sine', 0.16);
    tone(noteToFreq('B6'), 0.22, 'sine', 0.12, undefined, 0.09);
  },
  bubble(): void {
    tone(380 + Math.random() * 220, 0.07, 'sine', 0.12, 1300);
  },
  win(): void {
    jingle('C5:1 E5:1 G5:1 C6:2 G5:1 C6:3', 0.09);
    squeak(1.15, 0.62);
    squeak(1.3, 0.8);
  },
};
