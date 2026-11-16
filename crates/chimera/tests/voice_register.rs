//! The register control: chest voice (M1) at 0, head voice (M2) at 1.
use chimera::analysis::fft::{Fft, hann, power_spectrum_db};
use chimera::analysis::pitch::{YinOpts, yin_pitch};
use chimera::anatomy::human::BodyMix;
use chimera::phonetics::planner::vowel_artic;
use chimera::voice::human_voice::{HumanVoice, SourcePatch, VoiceTelemetry};

const FS: f64 = 48000.0;
const N: usize = 8192;

struct Held {
    out: Vec<f32>,
    open_quotient: f64,
    peak_area: f64,
}

/// A held /a/ for 1.5 s at `f0`, with `patch` on top.
fn held_a(fs: f64, f0: f64, patch: SourcePatch) -> Held {
    let mut v = HumanVoice::with_defaults(fs);
    v.set_articulation(&vowel_artic("a", BodyMix::MALE).unwrap(), None);
    let mut p = SourcePatch::f0(f0);
    p.merge(&patch);
    v.set_source(&p);
    v.set_gate(1.0);
    let mut out = vec![0.0f32; (1.5 * fs) as usize];
    let mut t = VoiceTelemetry::default();
    let mut peak_area = 0.0f64;
    for (i, c) in out.chunks_mut(128).enumerate() {
        v.render(c);
        if i % 16 == 0 && (i * 128) as f64 > fs {
            v.telemetry(&mut t);
            peak_area = peak_area.max(t.glottal_area.iter().fold(0.0f32, |m, a| m.max(*a)) as f64);
        }
    }
    Held { out, open_quotient: v.glottis.params.open_quotient, peak_area }
}

fn tail(out: &[f32], n: usize) -> Vec<f64> {
    out[out.len() - n..].iter().map(|x| *x as f64).collect()
}

/// H1 − H2 (dB) of the output's last `N` samples: the first harmonic over the second.
fn h1_h2(out: &[f32], f0: f64) -> f64 {
    let db = power_spectrum_db(&tail(out, N), &Fft::new(N), &hann(N));
    let df = FS / N as f64;
    let peak = |f: f64| (((f - 15.0) / df) as usize..=((f + 15.0) / df) as usize).map(|b| db[b]).fold(f64::MIN, f64::max);
    peak(f0) - peak(2.0 * f0)
}

fn head() -> SourcePatch {
    SourcePatch { register: Some(1.0), ..Default::default() }
}

#[test]
fn register_zero_is_the_voice_without_it() {
    let without = held_a(FS, 220.0, SourcePatch::default());
    let zero = held_a(FS, 220.0, SourcePatch { register: Some(0.0), ..Default::default() });
    assert!(without.out == zero.out, "register 0 changed the sound");
}

#[test]
fn head_voice_opens_longer_and_softer_than_chest_voice() {
    let (chest, head) = (held_a(FS, 220.0, SourcePatch::default()), held_a(FS, 220.0, head()));
    let (h_chest, h_head) = (h1_h2(&chest.out, 220.0), h1_h2(&head.out, 220.0));
    println!(
        "OQ {:.3} -> {:.3}; H1-H2 {:.1} -> {:.1} dB; peak area {:.4} -> {:.4} cm2",
        chest.open_quotient, head.open_quotient, h_chest, h_head, chest.peak_area, head.peak_area
    );
    assert!(head.open_quotient - chest.open_quotient >= 0.15);
    assert!(h_head - h_chest > 6.0, "H1-H2 {h_chest:.1} -> {h_head:.1} dB");
    assert!(head.peak_area < 0.9 * chest.peak_area);
}

#[test]
fn the_register_keeps_the_pitch() {
    for (name, patch) in [("chest", SourcePatch::default()), ("head", head())] {
        let held = held_a(FS, 220.0, patch);
        let p = yin_pitch(&tail(&held.out, 4096), FS, YinOpts { min_f0: Some(80.0), max_f0: Some(800.0), ..Default::default() });
        let err = (p.f0 / 220.0 - 1.0).abs();
        println!("{name}: {:.2} Hz", p.f0);
        assert!(err < 0.005, "{name}: {:.2} Hz", p.f0);
    }
}

#[test]
fn a_register_step_settles_within_40_ms() {
    let mut v = HumanVoice::with_defaults(FS);
    v.set_source(&SourcePatch::f0(220.0));
    v.set_gate(1.0);
    let mut buf = [0.0f32; 48];
    for _ in 0..1000 {
        v.render(&mut buf);
    }
    let chest = v.glottis.params.open_quotient;
    v.set_source(&head());
    let mut t = 0.0;
    let mut settled_at = None;
    while t < 0.2 {
        v.render(&mut buf);
        t += buf.len() as f64 / FS;
        let oq = v.glottis.params.open_quotient;
        if settled_at.is_none() && (oq - 0.85).abs() < 0.02 * (0.85 - chest) {
            settled_at = Some(t);
        }
    }
    let at = settled_at.expect("never reached head voice");
    println!("settled (2 %) after {:.1} ms", at * 1000.0);
    assert!(at < 0.040, "{:.1} ms", at * 1000.0);
    assert_eq!(v.glottis.params.open_quotient, 0.90 - 0.10 * 0.5);
}

#[test]
fn head_voice_holds_at_a_bluetooth_headsets_sample_rate() {
    let reference = held_a(FS, 330.0, head());
    let low = held_a(16000.0, 330.0, head());
    assert!(low.out.iter().all(|x| x.is_finite()), "head voice went NaN at 16 kHz");
    let rms = |o: &[f32]| (tail(o, o.len() / 3).iter().map(|x| x * x).sum::<f64>() / (o.len() / 3) as f64).sqrt();
    let (r, r48) = (rms(&low.out), rms(&reference.out));
    assert!(r > 0.5 * r48 && r < 2.0 * r48, "16 kHz RMS {r:.3}, 48 kHz {r48:.3}");
}
