/**
 * The laryngeal mechanism over a sweep, as one state machine stepped by (f0, dt). An authored
 * rule, not simulated: the engine's folds do not choose their register; this tells them which.
 */
import type { Thresholds, Training } from "./plan.ts";

export type RegisterState =
  | { kind: "M1" }
  | { kind: "breakingUp"; t0: number }
  | { kind: "M2" }
  | { kind: "breakingDown"; t0: number }
  /** a trained voice between the registers (mixed voice): no break, a blend */
  | { kind: "mixed" };

export type RegisterKind = RegisterState["kind"];

export interface RegisterMachine {
  /** time since the sweep began (s) */
  t: number;
  state: RegisterState;
  /** 0 chest voice … 1 head voice, as sent to the engine */
  r: number;
}

/** how long an untrained voice takes to flip from one register to the other (s) */
export const BREAK_S = 0.03;

export const initialRegister = (): RegisterMachine => ({ t: 0, state: { kind: "M1" }, r: 0 });

const smoothstep = (lo: number, hi: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return u * u * (3 - 2 * u);
};

export function stepRegister(m: RegisterMachine, f0: number, dt: number, training: Training, th: Thresholds): RegisterMachine {
  const t = m.t + dt;
  if (training === "trained") {
    const r = smoothstep(th.blendLo, th.blendHi, f0);
    return { t, r, state: { kind: r === 0 ? "M1" : r === 1 ? "M2" : "mixed" } };
  }
  const s = m.state;
  switch (s.kind) {
    case "M1":
    case "mixed":
      return f0 > th.upHz ? { t, r: 0, state: { kind: "breakingUp", t0: t } } : { t, r: 0, state: { kind: "M1" } };
    case "M2":
      return f0 < th.downHz ? { t, r: 1, state: { kind: "breakingDown", t0: t } } : { t, r: 1, state: s };
    case "breakingUp": {
      const r = smoothstep(0, BREAK_S, t - s.t0);
      return { t, r, state: r === 1 ? { kind: "M2" } : s };
    }
    case "breakingDown": {
      const r = 1 - smoothstep(0, BREAK_S, t - s.t0);
      return { t, r, state: r === 0 ? { kind: "M1" } : s };
    }
  }
}
