/**
 * The Register mode's rules: the untrained voice breaks with hysteresis, the trained one blends,
 * and the mouth opens for the close vowels first, as their first formant is lowest.
 */
import { describe, expect, test } from "bun:test";
import { initEngine } from "./harness.ts";
import { defaultPlan, planF0, VOWELS, type SweepPlan, type Training } from "../src/ui/register/plan.ts";
import { initialRegister, stepRegister, BREAK_S, type RegisterMachine } from "../src/ui/register/machine.ts";
import { h1h2, vowelAdjust, type Posture } from "../src/ui/register/derive.ts";

await initEngine();
const { VOWEL_TARGETS } = await import("../src/wasm/engine.ts");
const MALE = { female: 0, child: 0 };
const FEMALE = { female: 1, child: 0 };
const DT = 1 / 60;

/** each frame's f0 and machine, over pitches `f0s` */
function run(f0s: number[], training: Training, plan: SweepPlan): { f0: number; m: RegisterMachine }[] {
  let m = initialRegister();
  return f0s.map((f0) => ((m = stepRegister(m, f0, DT, training, plan.thresholds)), { f0, m }));
}

const frames = (from: number, to: number, seconds: number) => Array.from({ length: Math.round(seconds / DT) + 1 }, (_, i) => from * Math.pow(to / from, (i * DT) / seconds));

describe("register machine", () => {
  const plan = defaultPlan("a", MALE, "untrained", true);
  const up = frames(130, 520, 8);

  test("the same sweep steps to the same states", () => {
    expect(run(up, "untrained", plan)).toEqual(run(up, "untrained", plan));
  });

  test("an untrained voice flips up just above upHz, within the break time", () => {
    const out = run(up, "untrained", plan);
    const flip = out.findIndex((o) => o.m.state.kind !== "M1");
    expect(out[flip - 1].f0).toBeLessThanOrEqual(plan.thresholds.upHz);
    expect(out[flip].f0).toBeGreaterThan(plan.thresholds.upHz);
    const done = out.findIndex((o) => o.m.r === 1);
    expect((done - flip) * DT).toBeLessThanOrEqual(BREAK_S + DT);
    expect(out[done].m.state.kind).toBe("M2");
  });

  test("falling, it stays in head voice through the band and flips back only below downHz", () => {
    const head = run([...up, ...frames(520, 130, 8)], "untrained", plan).slice(up.length);
    const flip = head.findIndex((o) => o.m.state.kind !== "M2");
    expect(head.slice(0, flip).every((o) => o.m.r === 1)).toBe(true);
    expect(head[flip - 1].f0).toBeGreaterThanOrEqual(plan.thresholds.downHz);
    expect(head[flip].f0).toBeLessThan(plan.thresholds.downHz);
    expect(head.at(-1)!.m.state.kind).toBe("M1");
  });

  test("a trained voice blends without a step: chest below the band, head above, monotonic between", () => {
    const out = run(up, "trained", plan);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].m.r).toBeGreaterThanOrEqual(out[i - 1].m.r);
      expect(out[i].m.r - out[i - 1].m.r).toBeLessThan(0.05);
    }
    for (const o of out) {
      if (o.f0 <= plan.thresholds.blendLo) expect(o.m.r).toBe(0);
      if (o.f0 >= plan.thresholds.blendHi) expect(o.m.r).toBe(1);
      expect(o.m.state.kind === "breakingUp" || o.m.state.kind === "breakingDown").toBe(false);
    }
  });

  test("the sweep starts in chest voice and ends in head voice for each body", () => {
    for (const body of [MALE, FEMALE, { female: 0, child: 1 }]) {
      const p = defaultPlan("a", body, "trained", true);
      expect(planF0(p, 0)).toBeLessThan(p.thresholds.blendLo);
      expect(planF0(p, p.seconds)).toBeGreaterThan(p.thresholds.blendHi);
    }
  });
});

describe("vowel modification", () => {
  const posture = (body: "male" | "female", v: string) => VOWEL_TARGETS[body][v].artic as Posture;
  const f1 = (body: "male" | "female", v: string) => VOWEL_TARGETS[body][v].formants[0];

  /** the pitch at which the mouth starts to open for a vowel on the body's sweep, or Infinity */
  function onset(body: "male" | "female", vowel: (typeof VOWELS)[number], modifyVowel = true): number {
    const plan = defaultPlan(vowel, body === "male" ? MALE : FEMALE, "untrained", modifyVowel);
    for (let s = 0; s <= plan.seconds; s += DT) {
      const f0 = planF0(plan, s);
      if (vowelAdjust(plan, posture(body, vowel), f1(body, vowel), posture(body, "a"), f0).modifying) return f0;
    }
    return Infinity;
  }

  test("the close vowels /i/ and /u/ open at a lower pitch than /e/ and /o/; /a/ last or never", () => {
    for (const body of ["male", "female"] as const) {
      const at = Object.fromEntries(VOWELS.map((v) => [v, onset(body, v)]));
      expect(Math.max(at.i, at.u)).toBeLessThan(Math.min(at.e, at.o));
      expect(at.a).toBeGreaterThan(Math.max(at.e, at.o));
    }
  });

  test("the opening grows with pitch, stops short of /a/, and is off without vowel modification", () => {
    expect(onset("male", "i", false)).toBe(Infinity);
    const plan = defaultPlan("i", MALE, "untrained", true);
    const at = (f0: number) => vowelAdjust(plan, posture("male", "i"), f1("male", "i"), posture("male", "a"), f0);
    expect(at(400).artic.jaw).toBeGreaterThan(at(300).artic.jaw);
    expect(at(400).artic.tbY).toBeLessThan(at(300).artic.tbY);
    expect(at(4000).opening).toBeLessThan(1);
    expect(at(4000).artic.jaw).toBeLessThan(posture("male", "a").jaw);
  });

  test("an untrained larynx climbs more over the sweep than a trained one, within its range", () => {
    const v = { ...posture("male", "a"), larynx: 0 };
    const rise = (tr: Training, f0 = 520) => vowelAdjust(defaultPlan("a", MALE, tr, false), v, 725, v, f0).artic.larynx;
    expect(rise("untrained")).toBeCloseTo(0.7, 2);
    expect(rise("trained")).toBeCloseTo(0.2, 2);
    expect(rise("untrained", 1e6)).toBe(1.6);
  });
});

test("H1-H2 reads harmonics 1 and 2 from a two-cycle scope", () => {
  const n = 256;
  const flow = Array.from({ length: n }, (_, i) => 1 + Math.sin((2 * Math.PI * 2 * i) / n) + 0.5 * Math.sin((2 * Math.PI * 4 * i) / n + 1));
  expect(h1h2(flow)!).toBeCloseTo(20 * Math.log10(2), 6);
});
