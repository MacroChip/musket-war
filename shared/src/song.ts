// Music for the musicians, Guitar-Hero-easy-mode style: scrolling notes are
// sparse, and every successful hit plays a whole PHRASE of the tune (several
// segments scheduled back-to-back), so the song sounds smooth even though the
// musician takes few actions. All clients derive the phrase from the note
// index, so everyone hears the same performance.

export interface FifeNote {
  /** frequencies in Hz played in quick succession for this segment */
  freqs: number[];
}

const N: Record<string, number> = {
  G3: 196.0, A3: 220.0, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25,
};

function seg(...names: string[]): FifeNote {
  return { freqs: names.map((n) => (N[n] ?? 440) * 2) }; // fife plays an octave up
}

// Yankee Doodle, phrase by phrase, split into one-or-two note segments.
export const FIFE_SONG: FifeNote[] = [
  seg('C4'), seg('C4'), seg('D4'), seg('E4'),
  seg('C4'), seg('E4'), seg('D4'), seg('G3'),
  seg('C4'), seg('C4'), seg('D4'), seg('E4'),
  seg('C4', 'B3'), seg('G3'),
  seg('C4'), seg('C4'), seg('D4'), seg('E4'),
  seg('F4'), seg('E4'), seg('D4'), seg('C4'),
  seg('B3'), seg('G3'), seg('A3'), seg('B3'),
  seg('C4', 'C4'), seg('C4'),
  // "Yankee Doodle keep it up" refrain
  seg('A3', 'B3'), seg('A3'), seg('G3'), seg('A3'), seg('B3'), seg('C4'),
  seg('G3'), seg('A3'), seg('G3'), seg('F4', 'E4'), seg('G3'),
  seg('A3', 'B3'), seg('A3'), seg('G3'), seg('A3'), seg('B3'), seg('C4'),
  seg('A3'), seg('G3'), seg('C4'), seg('B3'), seg('D4'), seg('C4', 'C4'),
];

// Drum cadence: k = deep field drum, s = snare tap, f = flam (both).
export type DrumHit = 'k' | 's' | 'f';
export const DRUM_SONG: DrumHit[] = [
  'k', 'k', 's', 'k', 's', 's', 'k', 'f',
  'k', 's', 'k', 's', 'k', 'k', 's', 'f',
  'k', 'k', 's', 's', 'k', 's', 'k', 'f',
];

// Easy mode: how much of the song one hit plays, and the beat between
// segments within a phrase. Hit N covers segments [N*len, (N+1)*len), so the
// tune stays in sync across clients no matter whose hit triggered it.
export const PHRASE_SEGMENTS = { fife: 7, drum: 8 } as const;
export const PHRASE_STEP_MS = { fife: 280, drum: 240 } as const;

// Rhythm lane tuning (client-side minigame; results are reported to the
// server). Notes are spaced so that one phrase ends roughly as the next
// note reaches the ring — keep hitting and the song never stops.
export const NOTE_TRAVEL_MS = 2400; // time a note takes to cross the lane
export const NOTE_SPACING_MS_MIN = 1500;
export const NOTE_SPACING_MS_MAX = 2300;
export const HIT_WINDOW_GOOD_MS = 150;
export const HIT_WINDOW_PERFECT_MS = 65;
