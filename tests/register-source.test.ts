/**
 * The register setting travels from a worklet "source" message to the engine: in head voice the
 * first harmonic stands well above the second (H1-H2 rises), as the folds close softly.
 */
import { describe, expect, test } from "bun:test";
import { wasmModule } from "./harness.ts";

type Proc = { port: { onmessage: ((e: { data: unknown }) => void) | null }; process: (i: unknown, o: Float32Array[][]) => boolean };

async function processorCtor(): Promise<new (o: unknown) => Proc> {
  let Ctor: (new (o: unknown) => Proc) | null = null;
  const g = globalThis as Record<string, unknown>;
  g.sampleRate = 48000;
  g.AudioWorkletProcessor = class {
    port = { onmessage: null as unknown, postMessage: () => {} };
  };
  g.registerProcessor = (_name: string, ctor: typeof Ctor) => (Ctor = ctor);
  await import("../src/worklet/processor.ts");
  return Ctor!;
}

/** One second of a held voice at 220 Hz with `extra` source values; returns the last half. */
function held(Ctor: new (o: unknown) => Proc, extra: Record<string, number>): Float32Array {
  const p = new Ctor({ processorOptions: { module: wasmModule } });
  const send = (data: unknown) => p.port.onmessage!({ data });
  send({ type: "source", values: { f0: 220, ...extra } });
  send({ type: "gate", level: 1 });
  const out = new Float32Array(48000);
  for (let i = 0; i < out.length; i += 128) {
    const b = new Float32Array(128);
    p.process([], [[b]]);
    out.set(b, i);
  }
  return out.subarray(24000);
}

/** level (dB) of the strongest component within 3 Hz of f, Hann-windowed */
function level(x: Float32Array, f: number): number {
  let best = 0;
  for (let g = f - 3; g <= f + 3; g += 0.5) {
    let re = 0, im = 0;
    for (let n = 0; n < x.length; n++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (x.length - 1));
      const ph = (2 * Math.PI * g * n) / 48000;
      re += x[n] * w * Math.cos(ph);
      im -= x[n] * w * Math.sin(ph);
    }
    best = Math.max(best, Math.hypot(re, im));
  }
  return 20 * Math.log10(best);
}

const h1h2 = (x: Float32Array) => level(x, 220) - level(x, 440);

describe("register over the worklet", () => {
  test("register 1 makes head voice; register 0 is the voice without it", async () => {
    const Ctor = await processorCtor();
    const without = held(Ctor, {});
    const chest = held(Ctor, { register: 0 });
    const head = held(Ctor, { register: 1 });
    expect(chest).toEqual(without);
    expect(h1h2(head)).toBeGreaterThan(h1h2(chest) + 6);
  });
});
