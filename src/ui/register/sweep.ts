/**
 * The sweep sounding now: each animation frame it sets the pitch, the register and the vowel's
 * posture, and keeps what happened for the chart. No store import (the store stops it on a tab
 * switch): whoever starts it says what the voice goes back to.
 */
import { engine } from "../../audio/AudioEngine.ts";
import { VoiceModel } from "../analysis.ts";
import { NEUTRAL } from "../../wasm/engine.ts";
import { sameBody, type BodyMix } from "../body.ts";
import type { HumanArtic } from "../../wasm/types.ts";
import { planF0, type SweepPlan } from "./plan.ts";
import { initialRegister, stepRegister, type RegisterKind, type RegisterMachine } from "./machine.ts";
import { deriveLarynx, vowelAdjust, type LarynxSnapshot, type Posture } from "./derive.ts";

export interface Sample {
  /** s since the sweep began */
  t: number;
  /** commanded f0 (Hz) */
  cmd: number;
  /** the engine's f0, null while unvoiced */
  act: number | null;
  r: number;
  kind: RegisterKind;
  /** first formant of the posture the engine has now (Hz) */
  f1: number | null;
}

export interface Live {
  plan: SweepPlan;
  body: BodyMix;
  m: RegisterMachine;
  hist: Sample[];
  f1: number | null;
  /** pitch at which the register left chest voice, and at which the mouth began to open */
  breakHz: number | null;
  openHz: number | null;
}

/** time on the starting pitch before the glide, for the vowel's posture to settle (s) */
const LEAD = 0.35;
/** time held on the top pitch before the sweep ends (s) */
const TAIL = 0.4;

let live: Live | null = null;
/** the voice's own settings, restored when a sweep ends */
export type Restore = () => { f0: number; glide: number; artic: HumanArtic; tipFree: boolean };

let run: { startAt: number; last: number; f1At: number; model: VoiceModel; vowel: Posture; f1v: number; open: Posture; restore: Restore; raf: number } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const sweepNow = (): Live | null => live;
export const sweeping = (): boolean => run !== null;
export function subscribeSweep(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const postureOf = (m: VoiceModel, ipa: string): Posture => ({ ...NEUTRAL, ...m.vowels.find((v) => v.ipa === ipa)?.artic });

/** Start the sweep on an engine that is already running. */
export function startSweep(plan: SweepPlan, model: VoiceModel, restore: Restore): void {
  if (run) cancelAnimationFrame(run.raf);
  const v = model.vowels.find((x) => x.ipa === plan.vowel);
  const vowel = postureOf(model, plan.vowel);
  const now = performance.now();
  run = { startAt: now, last: now, f1At: 0, model, vowel, f1v: v?.F1 ?? 500, open: postureOf(model, "a"), restore, raf: requestAnimationFrame(tick) };
  live = { plan, body: model.body, m: initialRegister(), hist: [], f1: null, breakHz: null, openHz: null };
  engine.setSource({ f0: plan.fromHz, register: 0, glide: 0.03 });
  engine.setArtic(vowel, true);
  engine.gate(1);
  notify();
}

function tick(now: number): void {
  if (!run || !live) return;
  const dt = Math.min(0.05, (now - run.last) / 1000);
  run.last = now;
  const plan = live.plan;
  const t = (now - run.startAt) / 1000 - LEAD;
  const f0 = planF0(plan, Math.max(0, t));
  live.m = t < 0 ? live.m : stepRegister(live.m, f0, dt, plan.training, plan.thresholds);
  const adj = vowelAdjust(plan, run.vowel, run.f1v, run.open, f0);
  engine.setSource({ f0, register: live.m.r, glide: 0.03 });
  engine.setArtic(adj.artic, true);
  const tele = engine.latest && sameBody(engine.latest.body, live.body) ? engine.latest.t : null;
  if (tele && now - run.f1At > 100) {
    run.f1At = now;
    live.f1 = run.model.transfer(VoiceModel.articFromArray(tele.artic)).formants[0] ?? null;
  }
  if (t >= 0) {
    const kind = live.m.state.kind;
    live.hist.push({ t, cmd: f0, act: tele && tele.voicing > 0.2 ? tele.f0 : null, r: live.m.r, kind, f1: live.f1 });
    if (live.breakHz === null && kind !== "M1") live.breakHz = f0;
    if (live.openHz === null && adj.modifying) live.openHz = f0;
  }
  if (t > plan.seconds + TAIL) return stopSweep();
  run.raf = requestAnimationFrame(tick);
}

/** Stop the sweep (if any): breath off, chest voice, and the voice's own pitch and posture back. */
export function stopSweep(): void {
  if (!run) return;
  cancelAnimationFrame(run.raf);
  const to = run.restore();
  run = null;
  engine.gate(0);
  engine.setSource({ register: 0, f0: to.f0, glide: to.glide });
  engine.setArtic(to.artic, to.tipFree);
  notify();
}

/** the larynx now, for the drawings: from the engine's telemetry and the sweep's register */
export function larynxNow(plan: SweepPlan, body: BodyMix): LarynxSnapshot | null {
  const tele = engine.latest && sameBody(engine.latest.body, body) ? engine.latest.t : null;
  if (!tele) return null;
  const a = VoiceModel.articFromArray(tele.artic);
  const r = run && live ? live.m.r : 0;
  return deriveLarynx({ plan, r, body, glottalArea: tele.glottalArea, glottalFlow: tele.glottalFlow, f0: tele.f0, voicing: tele.voicing, jaw: a.jaw, larynx: a.larynx });
}
