const NAMES: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Scientific pitch ("A4", "C#5") → frequency in Hz, equal temperament, A4 = 440. */
export function noteToFreq(note: string): number {
  const m = /^([A-G][#b]?)(-?\d)$/.exec(note);
  if (!m) throw new Error(`bad note ${note}`);
  const semis = NAMES[m[1]!]!;
  const octave = parseInt(m[2]!, 10);
  const midi = (octave + 1) * 12 + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchClass(note: string): string {
  return note.replace(/-?\d$/, '');
}
