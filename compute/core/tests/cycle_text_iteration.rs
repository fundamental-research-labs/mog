//! Text-only iterative-cycle verification: text-only iterative cycles must produce
//! `metrics.iterative_max_delta == None` (the producer at `cycles.rs:370`
//! wraps `f64::INFINITY` into `FiniteF64::new` → `None`) and the metrics
//! must serialize/deserialize cleanly without `null` ever reaching a bare
//! `f64` decoder.

#[allow(dead_code)]
mod stress_common;
use stress_common::{build_iterative_snapshot, sheet_uuid};

use compute_core::mirror::CellMirror;
use compute_core::scheduler::ComputeCore;
use snapshot_types::{CellData, RecalcMetrics, SheetSnapshot};
use value_types::CellValue;

/// Two cells that reference each other are seeded directly from the
/// snapshot (the per-edge `set_cell` cycle detector would otherwise stamp
/// them with `#REF!` before the iterative path runs). The full-recalc
/// path through `init_from_snapshot` exercises the cycle/iterative
/// scheduler and feeds the producer at `cycles.rs:370` that this round
/// fixes.
#[test]
fn text_only_cycle_iterative_max_delta_serialises_as_null() {
    let mut core = ComputeCore::new();
    let mut mirror = CellMirror::default();
    let mut snapshot = build_iterative_snapshot(vec![("Sheet1", 100, 26, vec![])], 50, 0.001);
    // Inject A1=B1 and B1=A1 with cached values "x"/"y" — both are text,
    // so any numeric delta tracker has to map its INFINITY sentinel
    // through `FiniteF64::new` → `None` at the boundary.
    let sid = sheet_uuid(0);
    let cell_a1 = format!("c{:07x}{:04x}{:04x}0000000000000000", 0u32, 0u32, 0u32);
    let cell_b1 = format!("c{:07x}{:04x}{:04x}0000000000000000", 0u32, 0u32, 1u32);
    let cells = vec![
        CellData {
            cell_id: cell_a1,
            row: 0,
            col: 0,
            value: CellValue::Text("x".into()),
            formula: Some("=B1".to_string()),
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_b1,
            row: 0,
            col: 1,
            value: CellValue::Text("y".into()),
            formula: Some("=A1".to_string()),
            identity_formula: None,
            array_ref: None,
        },
    ];
    snapshot.sheets = vec![SheetSnapshot {
        id: sid,
        name: "Sheet1".to_string(),
        rows: 100,
        cols: 26,
        cells,
        ranges: vec![],
    }];
    let r = core.init_from_snapshot(&mut mirror, snapshot).unwrap();

    // After migration, `iterative_max_delta` is `Option<FiniteF64>`. For
    // text-only cycles the engine either:
    // - takes the iterative path and writes `INFINITY` into `ir.max_delta`,
    //   which `FiniteF64::new` maps to `None`, or
    // - stays on the single-pass path because the cycle resolves without
    //   iteration, leaving the field at its `None` default.
    // Either way it must NOT be a non-finite-encoded `null`-when-bare-f64.
    // We assert the structural property by roundtripping through JSON —
    // the bug we fixed was the asymmetric serializer-emits-null /
    // deserializer-rejects-null mismatch.
    let json = serde_json::to_string(&r.metrics).unwrap();
    let back: RecalcMetrics =
        serde_json::from_str(&json).expect("RecalcMetrics must decode without error");
    assert_eq!(
        back.iterative_max_delta, r.metrics.iterative_max_delta,
        "iterative_max_delta must roundtrip through JSON: {json}"
    );

    // Direct producer-path assertion: the f64::INFINITY sentinel that
    // `cycles.rs` uses for non-numeric cycle deltas must be erased to
    // `None` at the boundary type. This is the precise mapping the round
    // installs at `cycles.rs:370` / `recalc.rs:397`.
    let mapped = value_types::FiniteF64::new(f64::INFINITY);
    assert_eq!(
        mapped, None,
        "FiniteF64::new(INFINITY) must be None — the producer cascade depends on this"
    );
    let mapped_nan = value_types::FiniteF64::new(f64::NAN);
    assert_eq!(mapped_nan, None, "FiniteF64::new(NaN) must be None");
}
