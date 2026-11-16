/**
 * What the larynx and the mouth do during a sweep. Measured values come from the engine's
 * telemetry; schematic ones are authored rules of textbook physiology, drawn as such. Pure.
 */
import { bodyWeights, type BodyMix } from "../body.ts";
import type { SweepPlan } from "./plan.ts";
import type { HumanArtic } from "../../wasm/types.ts";

export type Source = "measured" | "schematic";
export interface Value<S extends Source> {
  /** null while the folds are not vibrating */
  value: number | null;
  source: S;
}
const measured = (value: number | null): Value<"measured"> => ({ value, source: "measured" });
const schematic = (value: number): Value<"schematic"> => ({ value, source: "schematic" });

export interface LarynxSnapshot {
  /** cricothyroid: stretches and thins the folds (0..1) */
  ct: Value<"schematic">;
  /** thyroarytenoid (vocalis): shortens and bulks the folds (0..1) */
  ta: Value<"schematic">;
  /** cm */
  foldLength: Value<"schematic">;
  /** vertical depth of the folds' contact (cm): thick in chest voice, thin in head voice */
  contactDepth: Value<"schematic">;
  /** the thyroid's forward tilt on the cricoid at the cricothyroid joint (degrees) */
  thyroidTilt: Value<"schematic">;
  /** posterior gap between the arytenoids (0..1), as the engine's register rule widens it */
  posteriorGap: Value<"schematic">;
  /** share of the cycle the folds are apart */
  openQuotient: Value<"measured">;
  /** first harmonic over the second in the glottal flow (dB) */
  h1h2: Value<"measured">;
  f0: Value<"measured">;
  /** cm, in the articulator's coordinate (up is positive) */
  larynxHeight: Value<"measured">;
  /** cm */
  jaw: Value<"measured">;
}

export interface LarynxInput {
  plan: SweepPlan;
  /** register sent to the engine, 0 chest … 1 head */
  r: number;
  body: BodyMix;
  /** the engine's telemetry now: two phase-locked glottal cycles in each scope */
  glottalArea: ArrayLike<number>;
  glottalFlow: ArrayLike<number>;
  f0: number;
  voicing: number;
  jaw: number;
  larynx: number;
}

/** resting fold length (cm, membranous and cartilaginous), per body */
const FOLD_CM = { male: 1.6, female: 1.1, child: 0.8 };

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** where f0 sits in the sweep's range, 0 at its start … 1 at its top */
const pitchPos = (plan: SweepPlan, f0: number) => clamp(Math.log(f0 / plan.fromHz) / Math.log(plan.toHz / plan.fromHz), 0, 1);

/** Share of the scope's points where the folds are apart: above 5 % of the vibratory excursion
 *  over the closed-phase minimum (the posterior gap stays open through closure, so it is the floor). */
export function openQuotient(area: ArrayLike<number>): number | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < area.length; i++) (lo = Math.min(lo, area[i])), (hi = Math.max(hi, area[i]));
  if (!(hi - lo > 1e-5)) return null;
  const th = lo + 0.05 * (hi - lo);
  let open = 0;
  for (let i = 0; i < area.length; i++) if (area[i] > th) open++;
  return open / area.length;
}

/** H1 − H2 (dB) of a scope holding exactly two cycles: harmonics 1 and 2 are DFT bins 2 and 4. */
export function h1h2(flow: ArrayLike<number>): number | null {
  const bin = (k: number) => {
    let re = 0, im = 0;
    for (let n = 0; n < flow.length; n++) {
      const ph = (2 * Math.PI * k * n) / flow.length;
      re += flow[n] * Math.cos(ph);
      im -= flow[n] * Math.sin(ph);
    }
    return Math.hypot(re, im);
  };
  const h1 = bin(2), h2 = bin(4);
  return h1 > 0 && h2 > 0 ? 20 * Math.log10(h1 / h2) : null;
}

export function deriveLarynx(i: LarynxInput): LarynxSnapshot {
  const voiced = i.voicing > 0.2;
  const p = pitchPos(i.plan, i.f0);
  const r = i.r;
  const rest = bodyWeights(i.body).reduce((s, [n, w]) => s + w * FOLD_CM[n], 0);
  // CT activity rises with pitch in both registers; the TA carries chest voice and lets go in
  // head voice, where the CT alone stretches the folds (Hirano 1981; Titze 1994)
  const ct = 0.15 + 0.75 * p;
  const ta = (1 - r) * (0.35 + 0.55 * p) + r * 0.08;
  const depth = (rest / FOLD_CM.male) * ((1 - r) * (0.45 - 0.13 * p) + r * 0.11);
  return {
    ct: schematic(ct),
    ta: schematic(ta),
    foldLength: schematic(rest * (1 + 0.3 * ct - 0.1 * ta)),
    contactDepth: schematic(depth),
    thyroidTilt: schematic(10 * ct),
    posteriorGap: schematic(0.2 + 0.8 * r),
    openQuotient: measured(voiced ? openQuotient(i.glottalArea) : null),
    h1h2: measured(voiced ? h1h2(i.glottalFlow) : null),
    f0: measured(voiced ? i.f0 : null),
    larynxHeight: measured(i.larynx),
    jaw: measured(i.jaw),
  };
}

/** the larynx's range (crates/chimera/src/control/articulators.rs) */
const LARYNX = [-1.6, 1.6] as const;
/** how far the larynx rises per octave of the sweep (cm) */
const LARYNX_PER_OCTAVE = { untrained: 0.35, trained: 0.1 };
/** the articulators that open the mouth toward /a/ */
const OPENING = ["jaw", "tbX", "tbY", "root", "lipAp", "lipProt", "lipWidth"] as const;
/** share of the way toward /a/ per octave of pitch above the vowel's threshold, and at most */
const OPEN_PER_OCTAVE = 0.6;
const OPEN_MAX = 0.8;

export type Posture = Pick<HumanArtic, (typeof OPENING)[number] | "larynx">;

export interface VowelAdjust {
  artic: Posture;
  /** 0 the vowel as calibrated … OPEN_MAX of the way to /a/ */
  opening: number;
  /** the mouth is opening to keep F1 above the pitch */
  modifying: boolean;
}

/**
 * The vowel's posture at this pitch (schematic). Once the pitch nears the vowel's first formant
 * a singer opens the jaw and lets the tongue and lips go with it, toward /a/, so F1 rises to stay
 * above f0 (Sundberg 1987). The jaw alone would not do it here: the model places the tongue body
 * and lips on their own, and opening only the jaw leaves F1 where it was. An untrained larynx
 * climbs with the pitch, a trained one stays nearly put.
 * `vowel` is the calibrated posture and `f1` its first formant (Hz); `open` is /a/'s posture.
 */
export function vowelAdjust(plan: SweepPlan, vowel: Posture, f1: number, open: Posture, f0: number): VowelAdjust {
  const over = Math.log2(f0 / (0.85 * f1));
  const modifying = plan.modifyVowel && over > 0;
  const u = modifying ? Math.min(OPEN_MAX, OPEN_PER_OCTAVE * over) : 0;
  const artic = { ...vowel };
  for (const k of OPENING) artic[k] = vowel[k] + (open[k] - vowel[k]) * u;
  artic.larynx = clamp(vowel.larynx + LARYNX_PER_OCTAVE[plan.training] * Math.max(0, Math.log2(f0 / plan.fromHz)), LARYNX[0], LARYNX[1]);
  return { artic, opening: u, modifying };
}
