/** Shared lazily-created AudioContext with master / music / sfx buses. Mute state persists. */
const MUTE_KEY = 'quack-doku.muted';

class AudioBus {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  music: GainNode | null = null;
  sfx: GainNode | null = null;
  muted = false;
  private noise: AudioBuffer | null = null;
  private listeners = new Set<(muted: boolean) => void>();

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* ignore */
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend();
        else if (!this.muted) void this.ctx.resume();
      });
    }
  }

  /** Must be called from a user gesture on iOS/Chrome before sound can play. */
  unlock(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return true;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 0.6;
    this.sfx.connect(this.master);
    return true;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03);
    }
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    for (const l of this.listeners) l(m);
  }

  onMuteChange(fn: (muted: boolean) => void): void {
    this.listeners.add(fn);
  }

  /** One second of white noise, shared by the drum and pop sounds. */
  noiseBuffer(): AudioBuffer {
    if (!this.ctx) throw new Error('audio not unlocked');
    if (!this.noise) {
      const sr = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, sr, sr);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }
}

export const audio = new AudioBus();
