/**
 * The Register mode's drawings: the laryngeal skeleton from the side, the folds in coronal
 * section, and the sweep chart. The skeleton and the folds' shape are schematic (authored rules,
 * labelled so on screen); the opening, f0, OQ and H1-H2 are measured from the engine.
 */
import { TEXT, V, mix } from "../colors.ts";
import { beam, beamPts, label, pathOf, ring, seg, type Pt } from "./vector.ts";
import type { LarynxSnapshot } from "../register/derive.ts";
import type { SweepPlan } from "../register/plan.ts";
import type { Sample } from "../register/sweep.ts";

const tag = (ctx: CanvasRenderingContext2D, text: string, w: number) => label(ctx, text, w - 8, 14, { size: 8, color: V.pink, align: "right", ls: 0.16 });

const rot = (p: Pt, c: Pt, a: number): Pt => {
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)];
};

/**
 * The larynx from the left side, front to the left: the cricoid ring, the thyroid tilting
 * forward on it at the cricothyroid joint, an arytenoid on the cricoid's back, and the vocal fold
 * from the thyroid's inner angle to the arytenoid. CT (green) and TA (red) glow with activation.
 */
export function drawLateral(ctx: CanvasRenderingContext2D, w: number, h: number, s: LarynxSnapshot | null): void {
  tag(ctx, "SCHEMATIC", w);
  const u = Math.min(w / 8.2, h / 9.4);
  const ox = (w - 6.4 * u) / 2, oy = (h - 8.6 * u) / 2 + 4;
  const P = (x: number, y: number): Pt => [ox + x * u, oy + y * u];
  const tilt = ((s?.thyroidTilt.value ?? 0) * Math.PI) / 180;
  const joint = P(4.5, 6.2);
  const T = (x: number, y: number) => rot(P(x, y), joint, -tilt);

  const cricoid = [P(0.2, 7.9), P(0.4, 7.2), P(2.6, 7.5), P(4.4, 7.0), P(5.0, 4.6), P(5.9, 4.4), P(6.2, 5.0), P(6.0, 8.3), P(3.2, 8.4)];
  beam(ctx, pathOf(cricoid, true), V.blue, 1.3);
  const thyroid = [T(0.3, 1.4), T(1.6, 1.0), T(3.0, 0.9), T(5.0, 0.2), T(4.9, 1.4), T(4.7, 4.4), T(4.5, 6.2), T(3.6, 5.2), T(1.4, 5.5), T(0.1, 5.7), T(-0.2, 3.4)];
  beam(ctx, pathOf(thyroid, true), V.blue, 1.3);
  ring(ctx, joint[0], joint[1], 3, V.white, 1.1);
  const ary = [P(4.9, 4.6), P(5.9, 4.4), P(5.5, 3.2), P(5.0, 3.4)];
  beam(ctx, pathOf(ary, true), V.blueMid, 1.2);
  const vocalProcess = P(4.8, 4.2);
  const commissure = T(0.4, 3.4);
  const ta = s?.ta.value ?? 0, ct = s?.ct.value ?? 0;
  seg(ctx, commissure[0], commissure[1] + 5, vocalProcess[0], vocalProcess[1] + 5, mix(V.frame, V.red, Math.min(1, 0.25 + ta)), 1 + 3 * ta, { hot: ta > 0.5 });
  seg(ctx, commissure[0], commissure[1], vocalProcess[0], vocalProcess[1], V.white, 1.8, { hot: true });
  for (const [a, b] of [[P(0.6, 7.5), T(0.9, 5.65)], [P(1.6, 7.6), T(2.0, 5.45)], [P(2.6, 7.5), T(3.1, 5.35)]] as [Pt, Pt][])
    seg(ctx, a[0], a[1], b[0], b[1], mix(V.frame, V.green, Math.min(1, 0.25 + ct)), 1 + 3 * ct, { hot: ct > 0.5 });

  label(ctx, "< FRONT", 8, 14, { size: 8, color: TEXT.secondary, ls: 0.16 });
  label(ctx, "THYROID", T(2.4, 2.6)[0], T(2.4, 2.6)[1], { size: 8, color: TEXT.secondary, align: "center", ls: 0.14 });
  label(ctx, "CRICOID", P(4.6, 8.0)[0], P(4.6, 8.0)[1], { size: 8, color: TEXT.secondary, align: "center", ls: 0.14 });
  const lx = 8, ly = h - 8;
  label(ctx, `CT ${pct(ct)}`, lx, ly - 24, { size: 9, color: V.green, ls: 0.14 });
  label(ctx, `TA ${pct(ta)}`, lx, ly - 12, { size: 9, color: V.red, ls: 0.14 });
  label(ctx, `FOLD ${(s?.foldLength.value ?? 0).toFixed(2)} CM · TILT ${(s?.thyroidTilt.value ?? 0).toFixed(0)}°`, lx, ly, { size: 9, color: TEXT.secondary, ls: 0.12 });
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The two folds in coronal section (cut from side to side, seen from behind): thick with a deep
 * contact in chest voice, thin in head voice (schematic), parted by the measured glottal area now.
 * `area` is the glottal area now (cm²).
 */
export function drawCoronal(ctx: CanvasRenderingContext2D, w: number, h: number, s: LarynxSnapshot | null, area: number | null): void {
  tag(ctx, "SHAPE SCHEMATIC · OPENING MEASURED", w);
  const cx = w / 2, cy = (h - 30) / 2 + 12;
  const k = Math.min((h - 44) / 1.3, w / 2.4);
  const depth = (s?.contactDepth.value ?? 0.35) * k;
  const len = s?.foldLength.value ?? 1.6;
  // a slit's mean width: the area over the fold's length, with its elliptic opening (π/4)
  const gap = area !== null ? Math.min(0.5 * k, ((area / len) * k * 4) / Math.PI) : 0;
  const W = 0.9 * k, top = 0.18 * k;
  const ta = s?.ta.value ?? 0;
  for (const sg of [-1, 1]) {
    const x = (d: number) => cx + sg * d;
    const edge = gap / 2 + 1;
    const fold: Pt[] = [[x(W), cy - top - 0.1 * k], [x(edge + 0.12 * k), cy - depth / 2 - 2], [x(edge), cy - depth / 2], [x(edge), cy + depth / 2], [x(edge + 0.5 * k), cy + depth / 2 + 0.45 * k], [x(W), cy + 0.6 * k]];
    beamPts(ctx, fold, V.white, 1.6, { hot: true });
    const vocalis: Pt[] = [[x(W - 0.04 * k), cy - 0.08 * k], [x(edge + 0.2 * k), cy - depth / 4], [x(edge + 0.2 * k), cy + depth / 4], [x(W - 0.04 * k), cy + 0.25 * k]];
    beamPts(ctx, vocalis, mix(V.frame, V.red, Math.min(1, 0.25 + ta)), 1 + 2 * ta);
    const falseFold: Pt[] = [[x(W), cy - 0.55 * k], [x(0.32 * k), cy - 0.42 * k], [x(0.3 * k), cy - 0.34 * k], [x(W), cy - 0.26 * k]];
    beamPts(ctx, falseFold, V.blueDim, 1);
  }
  seg(ctx, cx - W, cy - depth / 2, cx + W, cy - depth / 2, V.frame, 1, { dash: [2, 4] });
  seg(ctx, cx - W, cy + depth / 2, cx + W, cy + depth / 2, V.frame, 1, { dash: [2, 4] });
  label(ctx, `CONTACT ${(s?.contactDepth.value ?? 0).toFixed(2)} CM`, 8, h - 20, { size: 9, color: TEXT.secondary, ls: 0.12 });
  label(ctx, area !== null ? `OPEN ${(area * 100).toFixed(1)} MM² (MEASURED)` : "MAKE A SOUND TO SEE THEM PART", 8, h - 8, { size: 9, color: V.amber, ls: 0.12 });
}

/**
 * The sweep: commanded (white, dashed) and the engine's f0 (amber) against time on a log axis,
 * the register's thresholds, F1 of the posture the engine has (pink), and the mechanism as a strip.
 */
export function drawSweepChart(ctx: CanvasRenderingContext2D, w: number, h: number, plan: SweepPlan, hist: readonly Sample[]): void {
  const x0 = 44, x1 = w - 10, y0 = 18, y1 = h - 30;
  if (x1 - x0 < 60 || y1 - y0 < 40) return;
  const fLo = plan.fromHz / 1.15;
  const fHi = Math.max(plan.toHz, ...hist.map((s) => s.f1 ?? 0)) * 1.15;
  const X = (t: number) => x0 + ((x1 - x0) * Math.max(0, Math.min(plan.seconds, t))) / plan.seconds;
  const Y = (f: number) => y1 - ((y1 - y0) * Math.log(f / fLo)) / Math.log(fHi / fLo);
  seg(ctx, x0, y1, x1, y1, V.frame, 1);
  seg(ctx, x0, y0, x0, y1, V.frame, 1);
  for (let f = 100; f < fHi; f *= 2) if (f > fLo) label(ctx, `${f}`, x0 - 4, Y(f) + 3, { size: 8, color: TEXT.secondary, align: "right", ls: 0.1 });
  label(ctx, "HZ", x0 - 4, y0 - 6, { size: 8, color: TEXT.secondary, align: "right" });
  const th = plan.thresholds;
  const line = (f: number, color: string, text: string) => {
    seg(ctx, x0, Y(f), x1, Y(f), color, 1, { dash: [3, 4], alpha: 0.8 });
    label(ctx, text, x1, Y(f) - 3, { size: 8, color, align: "right", ls: 0.12 });
  };
  if (plan.training === "untrained") {
    line(th.upHz, V.red, `BREAKS UP ${th.upHz}`);
    line(th.downHz, V.green, `BACK DOWN ${th.downHz}`);
  } else {
    line(th.blendHi, V.red, `BLEND ${th.blendLo}-${th.blendHi}`);
    line(th.blendLo, V.red, "");
  }
  const cmd: Pt[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (plan.seconds * i) / 64;
    cmd.push([X(t), Y(plan.fromHz * Math.pow(plan.toHz / plan.fromHz, t / plan.seconds))]);
  }
  beamPts(ctx, cmd, V.white, 1, { dash: [4, 4], alpha: 0.6 });
  const runs = (pick: (s: Sample) => number | null, color: string, width: number) => {
    let pts: Pt[] = [];
    for (const s of hist) {
      const v = pick(s);
      if (v === null) {
        if (pts.length > 1) beamPts(ctx, pts, color, width, { hot: true });
        pts = [];
      } else pts.push([X(s.t), Y(Math.max(fLo, Math.min(fHi, v)))]);
    }
    if (pts.length > 1) beamPts(ctx, pts, color, width, { hot: true });
  };
  runs((s) => s.f1, V.pink, 1.2);
  runs((s) => s.act, V.amber, 1.6);
  const sy = h - 18;
  for (let i = 1; i < hist.length; i++) seg(ctx, X(hist[i - 1].t), sy, X(hist[i].t) + 0.5, sy, mix(V.blueMid, V.white, hist[i].r), 6);
  label(ctx, "M1 CHEST", x0, h - 4, { size: 8, color: V.blueMid, ls: 0.14 });
  label(ctx, "M2 HEAD", x1, h - 4, { size: 8, color: V.white, align: "right", ls: 0.14 });
  label(ctx, "F0 SET", x0 + 6, y0 + 2, { size: 8, color: V.white, ls: 0.12 });
  label(ctx, "F0 ENGINE", x0 + 54, y0 + 2, { size: 8, color: V.amber, ls: 0.12 });
  label(ctx, "F1 COMPUTED", x0 + 120, y0 + 2, { size: 8, color: V.pink, ls: 0.12 });
}
