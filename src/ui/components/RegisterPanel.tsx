import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useStore } from "../store.ts";
import { engine } from "../../audio/AudioEngine.ts";
import { sameBody } from "../body.ts";
import { useModel } from "../useModel.ts";
import { usePhosphor } from "../usePhosphor.ts";
import { V } from "../colors.ts";
import { Chip, Screen } from "./Screen.tsx";
import { ActionBar, PrimaryButton } from "./ActionBar.tsx";
import { Stroboscope } from "./Stroboscope.tsx";
import type { InfoFn, SlotsFn } from "./AnatomyView.tsx";
import { drawCoronal, drawLateral, drawSweepChart } from "../render/larynx.ts";
import { defaultPlan, VOWELS, type SweepPlan, type Training, type Vowel } from "../register/plan.ts";
import { larynxNow, startSweep, stopSweep, subscribeSweep, sweeping, sweepNow } from "../register/sweep.ts";
import type { RegisterKind } from "../register/machine.ts";

const KIND: Record<RegisterKind, string> = { M1: "Chest (M1)", breakingUp: "Breaking up", M2: "Head (M2)", breakingDown: "Breaking down", mixed: "Mixed" };
/** the same, short enough for a readout under the chin */
const KIND_SHORT: Record<RegisterKind, string> = { M1: "M1", breakingUp: "Break", M2: "M2", breakingDown: "Break", mixed: "Mix" };

/** the next sweep's plan, as the controls set it */
let shownPlan: SweepPlan | null = null;
const samePlan = (a: SweepPlan, b: SweepPlan) => a.vowel === b.vowel && a.training === b.training && a.modifyVowel === b.modifyVowel && a.fromHz === b.fromHz;

/** the plan the screens show: the sweep's own while it runs, or after it until a control changes */
function planShown(): SweepPlan {
  const live = sweepNow();
  const next = shownPlan ?? defaultPlan("a", useStore.getState().body, "untrained", true);
  return live && (sweeping() || samePlan(live.plan, next)) ? live.plan : next;
}

const hz = (f: number | null | undefined) => (f ? `${Math.round(f)} Hz` : "-");

/** the readouts under the chin: the mechanism, then the jaw, larynx and pitch the engine has */
export const registerSlots: SlotsFn = (_m, a, _f, _formants, tele) => {
  const live = sweepNow();
  return [
    { label: "Register", value: live && sweeping() ? KIND_SHORT[live.m.state.kind] : "M1", color: V.green },
    { label: "Jaw", value: a.jaw.toFixed(2), unit: "cm", color: V.red },
    { label: "Larynx", value: a.larynx.toFixed(2), unit: "cm", color: V.pink },
    { label: "Pitch", value: tele && tele.t.voicing > 0.2 ? tele.t.f0.toFixed(0) : "-", unit: "Hz", color: V.white },
  ];
};

export const registerInfo: InfoFn = () => {
  const s = larynxNow(planShown(), useStore.getState().body);
  if (!s || s.f0.value === null) return ["Jaw and larynx move as simulated"];
  return [`OQ ${s.openQuotient.value?.toFixed(2) ?? "-"} measured`, `H1-H2 ${s.h1h2.value?.toFixed(1) ?? "-"} dB measured`];
};

function LateralView() {
  const ref = usePhosphor(({ ctx, w, h }) => drawLateral(ctx, w, h, larynxNow(planShown(), useStore.getState().body)));
  return <canvas ref={ref} className="instrument-canvas" aria-label="The larynx from the side, schematic: the thyroid tilting on the cricoid as the cricothyroid contracts" role="img" />;
}

function CoronalView() {
  const phase = useRef(0);
  const ref = usePhosphor(({ ctx, w, h, dt }) => {
    const body = useStore.getState().body;
    const tele = engine.latest && sameBody(engine.latest.body, body) ? engine.latest.t : null;
    phase.current = (phase.current + dt / 1.8) % 1;
    const area = tele && tele.voicing > 0.2 ? tele.glottalArea[Math.floor(phase.current * tele.glottalArea.length) % tele.glottalArea.length] : null;
    drawCoronal(ctx, w, h, larynxNow(planShown(), body), area);
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="The vocal folds in coronal section, schematic shape, opening by the measured glottal area" role="img" />;
}

function SweepChart() {
  const ref = usePhosphor(({ ctx, w, h }) => {
    const live = sweepNow();
    const plan = planShown();
    drawSweepChart(ctx, w, h, plan, live && live.plan === plan ? live.hist : []);
  });
  return <canvas ref={ref} className="instrument-canvas" aria-label="Pitch against time over the sweep, with the register thresholds and the first formant" role="img" />;
}

function Readouts() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  const live = sweepNow();
  const s = larynxNow(planShown(), useStore.getState().body);
  const rows: [string, string][] = [
    ["Register", live && sweeping() ? KIND[live.m.state.kind] : "-"],
    ["Left chest at", hz(live?.breakHz)],
    ["Mouth opened at", hz(live?.openHz)],
    ["Pitch (engine)", hz(s?.f0.value)],
    ["F1 (computed)", hz(live?.f1)],
    ["Open quotient (measured)", s?.openQuotient.value?.toFixed(2) ?? "-"],
    ["H1-H2 (measured)", s?.h1h2.value != null ? `${s.h1h2.value.toFixed(1)} dB` : "-"],
  ];
  return (
    <div className="reg-read">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="reg-row">
            <dt>{k}</dt>
            <dd data-readout={k}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="reg-note">
        Schematic: the muscles, the folds' length, thickness and tilt, and the posterior gap follow textbook rules; the engine does not simulate them. The register is an authored
        blend of glottal pulse shapes. Measured from the running voice: pitch, opening, open quotient, H1-H2, jaw and larynx.
      </p>
    </div>
  );
}

export function RegisterRight() {
  const body = useStore((s) => s.body);
  const model = useModel();
  const [vowel, setVowel] = useState<Vowel>("a");
  const [training, setTraining] = useState<Training>("untrained");
  const [modify, setModify] = useState(true);
  const playing = useSyncExternalStore(subscribeSweep, sweeping);
  shownPlan = defaultPlan(vowel, body, training, modify);
  useEffect(() => stopSweep, []);

  const press = async () => {
    if (sweeping()) return stopSweep();
    const st = useStore.getState();
    await st.start();
    if (!useStore.getState().started || useStore.getState().mode !== "register" || !model.current) return;
    startSweep(defaultPlan(vowel, useStore.getState().body, training, modify), model.current, () => {
      const s = useStore.getState();
      return { f0: s.source.f0, glide: s.source.glide, artic: s.artic, tipFree: s.tipFree };
    });
  };

  return (
    <div className="right right-register">
      <ActionBar label="Register sweep" onSpace={() => void press()}>
        <PrimaryButton label="Sweep" playing={playing} onClick={() => void press()} />
        <div className="vowel-pick" role="group" aria-label="Vowel">
          {VOWELS.map((v) => (
            <Chip key={v} on={vowel === v} onClick={() => setVowel(v)} className="ipa-chip">
              {v}
            </Chip>
          ))}
        </div>
        <div className="vowel-pick" role="group" aria-label="Singer">
          <Chip on={training === "untrained"} onClick={() => setTraining("untrained")}>
            Untrained (break)
          </Chip>
          <Chip on={training === "trained"} onClick={() => setTraining("trained")}>
            Trained (blend)
          </Chip>
        </div>
        <Chip on={modify} onClick={() => setModify(!modify)}>
          Vowel modification
        </Chip>
      </ActionBar>
      <Screen className="s-lat" title="Larynx" sub="Side, schematic">
        <LateralView />
      </Screen>
      <Screen className="s-cor" title="Folds" sub="Coronal section">
        <CoronalView />
      </Screen>
      <Screen className="s-sweep" title="Sweep" sub={`${hz(shownPlan.fromHz)} to ${hz(shownPlan.toHz)}`}>
        <SweepChart />
      </Screen>
      <Screen className="s-read" title="Readouts">
        <Readouts />
      </Screen>
      <Screen className="s-folds" title="Vocal folds" sub="From above, slowed 100×">
        <Stroboscope />
      </Screen>
    </div>
  );
}
