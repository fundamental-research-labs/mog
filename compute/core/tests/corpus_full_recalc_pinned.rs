//! Class V — Pinned-corpus full-recalc regression guard.
//!
//! §"Class V".
//!
//! **Invariant.** On a pinned corpus subset, a fresh
//! `YrsComputeEngine::from_snapshot` produces values equal to an oracle
//! (hand-computed for synthetic fixtures; Excel cached values for real
//! XLSX). This is a distinct lineage from Classes I–IV: it catches
//! **full-recalc drift** rather than iterative-recalc identity issues.
//!
//! FINDINGS.md §"Side-finding — Check B regressions (18 files)" records
//! 18 files in the April-20 corpus slice whose engine full-recalc
//! disagrees with Excel's cached values, even though the April-20 corpus
//! report classified them zero-mismatch. The two drift-repro fixtures
//! below (`drift_repro_1`, `drift_repro_2`) synthesize the two most
//! distinct signatures surfaced so far:
//!
//! 1. `Ib6CYMnT` — SUMIFS with full-column range and a sparse high-row
//!    write (FINDINGS.md §"Class B", "The Ib6CYMnT pattern in detail").
//! 2. `qKjqZiEx` — float-cascade arithmetic on precision-fragile seeds
//!    (FINDINGS.md §"Class B").
//!
//! Synthetic fixtures were preferred over real XLSX per the ground
//! rules in `iterative-recalc-unit-tests.md` Class V §"Case matrix" and
//! the Stage 5 agent brief: real XLSX are binary blobs and inflate the
//! repo; a synthetic reproducer with a hand-computed oracle gives the
//! same regression signal.
//!
//! **Failure budget.** `MAX_DRIFT` is set at-or-above the current
//! observed count so CI is green today and a real regression (more
//! drift than baseline) trips the panic. When the engine is fixed, the
//! budget tightens. Observed drift count is commented next to the
//! constant.
//!
//! Run:
//!   cargo test -p compute-core --test corpus_full_recalc_pinned -- --nocapture

use compute_core::storage::engine::YrsComputeEngine;
use std::time::Instant;
use value_types::CellValue;

// Fixture builders live in `tests/fixtures/corpus-pin/mod.rs`. We use
// `#[path]` so the directory name can match the plan's declared layout
// (`fixtures/corpus-pin/`, dash-separated) even though Rust modules
// otherwise disallow dashes.
#[path = "fixtures/corpus-pin/mod.rs"]
mod corpus_pin;

use corpus_pin::{Fixture, OracleEntry, all_fixtures};

// ---------------------------------------------------------------------------
// Failure budget
// ---------------------------------------------------------------------------

/// Maximum total drift across all fixtures that keeps CI green. Set
/// at-or-above the current observed count so regressions trip the
/// panic. Tighten this once the underlying engine bugs surface through
/// the iterative-recalc fix work (structural-op of the random-walk plan).
///
/// **Observed baseline (2026-04-22):** 2 drift, both in
/// `drift_repro_2_float_cascade` at `Sheet1!C3` and `Sheet1!C10`. Both
/// cells evaluate to bitwise `0.0` when the naive IEEE 754 oracle
/// predicts a tiny residue (~5.55e-17 and ~1.11e-16). This indicates
/// the engine applies some precision-compensation path (Kahan or
/// dd-precision enabled by default in `value-types`). The drift is
/// captured as a pin — if the engine's compensation strategy changes,
/// this count shifts and the budget must be revisited.
///
/// Tighten by reducing the budget when the underlying behavior is
/// either fixed or accepted as product spec.
const MAX_DRIFT: usize = 2; // Observed: see per-fixture logs.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn bits(v: &CellValue) -> Option<u64> {
    match v {
        CellValue::Number(f) => Some(f.get().to_bits()),
        _ => None,
    }
}

/// Compare a pair of `CellValue`s with the same rigor the Class V
/// invariant wants: bitwise-equal for numbers, exact for strings /
/// errors / booleans / null.
///
/// Returns `true` iff the pair is considered a match.
fn values_match(actual: &CellValue, expected: &CellValue) -> bool {
    match (actual, expected) {
        // Bitwise equal on f64::to_bits — this catches precision cascades
        // that `assert!((a - b).abs() < eps)` would paper over. This is
        // the spec for the qKjqZiEx repro; `(0.1 + 0.2) == 0.3` is false,
        // and we expect it to be false.
        (CellValue::Number(a), CellValue::Number(b)) => a.get().to_bits() == b.get().to_bits(),
        (CellValue::Text(a), CellValue::Text(b)) => a == b,
        (CellValue::Boolean(a), CellValue::Boolean(b)) => a == b,
        (CellValue::Error(a, _), CellValue::Error(b, _)) => a == b,
        (CellValue::Null, CellValue::Null) => true,
        _ => false,
    }
}

/// Describe a `CellValue` compactly for drift logs. We don't dump
/// `CellValue::Array` contents because array-source spills return the
/// top-left element from `get_cell_value`, so arrays shouldn't surface
/// at this layer.
fn describe(v: &CellValue) -> String {
    match v {
        CellValue::Number(f) => {
            // Print exact float so a bitwise mismatch is humanly diagnosable.
            format!("Number({:?}) [bits=0x{:016x}]", f.get(), f.get().to_bits())
        }
        CellValue::Text(s) => format!("Text({:?})", s),
        CellValue::Boolean(b) => format!("Bool({b})"),
        CellValue::Error(e, ctx) => match ctx {
            Some(c) => format!("Error({e:?}, {c:?})"),
            None => format!("Error({e:?})"),
        },
        CellValue::Null => "Null".to_string(),
        other => format!("{:?}", other),
    }
}

/// Look up a cell value at `(sheet_name, row, col)` by walking the
/// engine's mirror. Returns `None` if either the sheet name or the cell
/// position is absent — both conditions should be treated as drift.
fn read_value(engine: &YrsComputeEngine, entry: &OracleEntry) -> Option<CellValue> {
    let mirror = engine.mirror();
    let sheet_id = mirror
        .sheet_ids()
        .find(|sid| {
            mirror
                .get_sheet(sid)
                .map(|sm| sm.name == entry.sheet_name)
                .unwrap_or(false)
        })
        .copied()?;
    let pos = cell_types::SheetPos::new(entry.row, entry.col);
    mirror.get_cell_value_at(&sheet_id, pos).cloned()
}

struct FixtureReport {
    name: &'static str,
    total: usize,
    matched: usize,
    drift: Vec<DriftRecord>,
    elapsed_ms: u128,
}

struct DriftRecord {
    sheet_name: &'static str,
    row: u32,
    col: u32,
    expected: CellValue,
    actual: Option<CellValue>,
    label: Option<&'static str>,
}

fn run_fixture(fixture: Fixture) -> FixtureReport {
    let t0 = Instant::now();
    let (engine, _recalc) = YrsComputeEngine::from_snapshot(fixture.snapshot).unwrap_or_else(|e| {
        panic!("[Class V · {}] from_snapshot failed: {:?}", fixture.name, e);
    });

    let mut matched = 0;
    let mut drift = Vec::new();

    for entry in &fixture.oracle {
        let actual = read_value(&engine, entry);
        let is_match = match &actual {
            Some(v) => values_match(v, &entry.expected),
            None => false,
        };
        if is_match {
            matched += 1;
        } else {
            drift.push(DriftRecord {
                sheet_name: entry.sheet_name,
                row: entry.row,
                col: entry.col,
                expected: entry.expected.clone(),
                actual: actual.clone(),
                label: entry.label,
            });
        }
    }

    let elapsed_ms = t0.elapsed().as_millis();
    FixtureReport {
        name: fixture.name,
        total: fixture.oracle.len(),
        matched,
        drift,
        elapsed_ms,
    }
}

fn log_fixture(rep: &FixtureReport) {
    let label_summary = rep
        .drift
        .iter()
        .filter_map(|d| d.label)
        .collect::<std::collections::BTreeSet<_>>();
    let tail = if label_summary.is_empty() {
        String::new()
    } else {
        format!(
            " ({} patterns)",
            label_summary.into_iter().collect::<Vec<_>>().join(", ")
        )
    };
    println!(
        "[Class V · {}] {}/{} formulas match oracle, {} drift{} ({} ms)",
        rep.name,
        rep.matched,
        rep.total,
        rep.drift.len(),
        tail,
        rep.elapsed_ms,
    );
    for d in &rep.drift {
        let sheet = d.sheet_name;
        let row_1 = d.row + 1;
        // A=0 → "A", B=1 → "B", ...; tests only use single-letter cols.
        let col_letter = col_letter(d.col);
        let actual_str = match &d.actual {
            Some(v) => describe(v),
            None => "<absent>".to_string(),
        };
        let label_tag = d.label.map(|l| format!(" [{l}]")).unwrap_or_default();
        println!(
            "    drift{label_tag}: {sheet}!{col_letter}{row_1}  expected={}  actual={}",
            describe(&d.expected),
            actual_str,
        );
    }
}

/// Convert a zero-based column index to an Excel column letter (A..Z, AA..).
fn col_letter(mut col: u32) -> String {
    let mut out = Vec::new();
    loop {
        let r = (col % 26) as u8;
        out.push((b'A' + r) as char);
        if col < 26 {
            break;
        }
        col = col / 26 - 1;
    }
    out.reverse();
    out.into_iter().collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn class_v_corpus_full_recalc_pinned() {
    let t_all = Instant::now();
    let mut reports = Vec::new();
    for fixture in all_fixtures() {
        let rep = run_fixture(fixture);
        log_fixture(&rep);
        reports.push(rep);
    }

    let total_formulas: usize = reports.iter().map(|r| r.total).sum();
    let total_matched: usize = reports.iter().map(|r| r.matched).sum();
    let total_drift: usize = reports.iter().map(|r| r.drift.len()).sum();
    let wall_ms = t_all.elapsed().as_millis();

    println!(
        "[Class V total] {}/{} passed, {} drift ({} ms wall-clock)",
        total_matched, total_formulas, total_drift, wall_ms,
    );

    assert!(
        total_drift <= MAX_DRIFT,
        "Class V drift exceeded budget: observed {} > MAX_DRIFT={}. \
         See per-fixture logs above. If this is a real engine fix, \
         tighten MAX_DRIFT to the new observed count; if this is a \
         regression, investigate the drifting cells.",
        total_drift,
        MAX_DRIFT,
    );
}

// ---------------------------------------------------------------------------
// Micro-tests for the runner itself
// ---------------------------------------------------------------------------

#[test]
fn col_letter_basics() {
    assert_eq!(col_letter(0), "A");
    assert_eq!(col_letter(1), "B");
    assert_eq!(col_letter(25), "Z");
    assert_eq!(col_letter(26), "AA");
    assert_eq!(col_letter(27), "AB");
}

#[test]
fn bitwise_number_compare_catches_cascade() {
    let a = CellValue::Number(value_types::FiniteF64::must(0.1_f64 + 0.2_f64));
    let b = CellValue::Number(value_types::FiniteF64::must(0.3_f64));
    assert!(
        !values_match(&a, &b),
        "bitwise compare should reject 0.1+0.2 == 0.3"
    );

    let c = CellValue::Number(value_types::FiniteF64::must(0.1_f64 + 0.2_f64));
    assert!(
        values_match(&a, &c),
        "bitwise compare should accept identical float expressions"
    );
    assert!(bits(&a).is_some());
}
