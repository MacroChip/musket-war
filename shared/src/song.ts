// Music for the musicians. Every successful rhythm note plays the NEXT
// segment of the tune, so the song only advances as well as the fifer plays.
// All clients derive the segment from the note index, so everyone hears the
// same performance.

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

// Rhythm lane tuning (client-side minigame; results are reported to the server).
export const NOTE_TRAVEL_MS = 2400; // time a note takes to cross the lane
export const NOTE_SPACING_MS_MIN = 550;
export const NOTE_SPACING_MS_MAX = 950;
export const HIT_WINDOW_GOOD_MS = 150;
export const HIT_WINDOW_PERFECT_MS = 65;
