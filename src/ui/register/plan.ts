/**
 * A register sweep: one vowel glided upward from chest voice into head voice. Pure; no engine.
 */
import { defaultF0, type BodyMix } from "../body.ts";

export type Vowel = "a" | "e" | "i" | "o" | "u";
export const VOWELS: readonly Vowel[] = ["a", "e", "i", "o", "u"];

/** Untrained voices break between registers; trained ones blend across the passaggio. */
export type Training = "untrained" | "trained";

export interface Thresholds {
  /** an untrained voice flips up to head voice above this pitch (Hz) */
  upHz: number;
  /** and back down to chest voice only below this one: the break's hysteresis */
  downHz: number;
  /** a trained voice blends chest into head voice across this range (Hz) */
  blendLo: number;
  blendHi: number;
}

export interface SweepPlan {
  vowel: Vowel;
  fromHz: number;
  toHz: number;
  seconds: number;
  training: Training;
  modifyVowel: boolean;
  thresholds: Thresholds;
}

export const THRESHOLDS: Thresholds = { upHz: 370, downHz: 310, blendLo: 300, blendHi: 400 };

/**
 * Two octaves from a little above the body's speaking pitch, so a sweep starts well under the
 * passaggio and ends well above it: male 130 to 520 Hz, female and child 240 to 960 Hz.
 */
export function defaultPlan(vowel: Vowel, body: BodyMix, training: Training, modifyVowel: boolean): SweepPlan {
  const fromHz = Math.round(Math.min(1.18 * defaultF0(body), 0.8 * THRESHOLDS.blendLo));
  return { vowel, fromHz, toHz: 4 * fromHz, seconds: 8, training, modifyVowel, thresholds: THRESHOLDS };
}

/** The commanded pitch at t seconds into the sweep: a straight line in log frequency. */
export function planF0(plan: SweepPlan, t: number): number {
  const x = Math.min(1, Math.max(0, t / plan.seconds));
  return plan.fromHz * Math.pow(plan.toHz / plan.fromHz, x);
}
