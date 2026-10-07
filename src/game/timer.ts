/** A stopwatch that can be paused and restored from a saved value. */
export class Timer {
  private base = 0;
  private since: number | null = null;
  private readonly clock: () => number;

  constructor(clock: () => number = () => performance.now()) {
    this.clock = clock;
  }

  get ms(): number {
    return this.base + (this.since === null ? 0 : this.clock() - this.since);
  }

  get running(): boolean {
    return this.since !== null;
  }

  start(): void {
    if (this.since === null) this.since = this.clock();
  }

  stop(): void {
    if (this.since === null) return;
    this.base += this.clock() - this.since;
    this.since = null;
  }

  set(ms: number): void {
    this.base = ms;
    if (this.since !== null) this.since = this.clock();
  }
}

/** m:ss, or h:mm:ss past an hour. */
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Countdown like 5:07:09 (hours always shown). */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
