//! Class IV — integration mirror of the parse/render round-trip.
//!
//! Shares the case table from `compute_core::test_support::class_iv` and
//! exercises the full engine surface:
//!
//!   `engine.set_cell(C, render(v))` (production input-parser path)
//!     vs.
//!   `engine.import_values(C, v)` (raw CellValue path)
//!
//! For the `set_cell` path (`mod engine_mirror`), `RoundTrips` cases
//! assert the mirror value equals the original input and `CoercesTo(v')`
//! cases assert it equals `v'`. For the `import_values` path
//! (`mod import_lossless`), every non-deferred case asserts the mirror
//! value equals the original input regardless of declared expectation —
//! the import path is nominally raw, so any divergence is a Finding-2
//! structural bug. `Deferred` cases are inspection-only and do not have
//! per-case tests.
//!
//! **Fixture layout.** The target cell sits at B2 (`row=1, col=1`) and
//! A1 is pre-allocated as an empty placeholder. This lets `=A1` formula
//! cases evaluate to `Number(0)` (Excel's reference-to-empty semantics)
//! rather than self-referencing the cell being written to. The case
//! table's `wouldbe_cellref_formula` expectation depends on this layout
//! — keep them in sync if the target moves.
//!
//! **Each non-deferred case is its own `#[test]`** — see `mod engine_mirror`
//! and `mod import_lossless` below. Known bugs surface as named failing
//! tests; failing tests ARE the bug tracker. Do NOT silence with
//! `#[ignore]` or failure budgets — fix the bug or leave the test red.
//!
//! Run:
//!   cargo test -p compute-core --test cell_value_round_trip_via_engine -- --nocapture

use cell_types::{CellId, SheetId};
use compute_core::storage::engine::YrsComputeEngine;
use compute_core::test_support::cell_value_to_input_string;
use compute_core::test_support::class_iv::{Expectation, cases, describe_value};
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
#[cfg(feature = "perf-tests")]
use std::time::Instant;
use value_types::CellValue;

// Force compilation of the shared support scaffolding. Stage 2+ test
// files will import the matrix/fixtures/assertions helpers directly;
// referencing them here keeps `cargo check -p compute-core --tests`
// honest before those tests land.
#[path = "support/mod.rs"]
mod support;
#[allow(dead_code)]
fn _support_smoke() -> usize {
    support::matrix::smoke_check()
}

// Stage-1 Track-4a — also reference the 5-ary / 6-ary smoke helpers so
// their assertions compile alongside the 4-ary form.
#[allow(dead_code)]
fn _support_smoke5() -> usize {
    support::matrix::smoke_check5()
}
#[allow(dead_code)]
fn _support_smoke6() -> usize {
    support::matrix::smoke_check6()
}

const SHEET_UUID: &str = "a0000000000000000000000000000001";
const TARGET_CELL_UUID: &str = "c0000000000000000000000000000001";
const A1_CELL_UUID: &str = "c0000000000000000000000000000002";
const TARGET_ROW: u32 = 1;
const TARGET_COL: u32 = 1;

fn empty_target_snapshot() -> WorkbookSnapshot {
    // Two pre-allocated cells: the target at B2 where each case writes
    // its rendered input, and A1 as an empty placeholder so would-be
    // formula cases like `=A1` have a clean empty reference rather than
    // self-referencing the target.
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 10,
            cells: vec![
                CellData {
                    cell_id: A1_CELL_UUID.to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Null,
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: TARGET_CELL_UUID.to_string(),
                    row: TARGET_ROW,
                    col: TARGET_COL,
                    value: CellValue::Null,
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        ..Default::default()
    }
}

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet uuid")
}

fn target_cell_id() -> CellId {
    CellId::from_uuid_str(TARGET_CELL_UUID).expect("valid cell uuid")
}

/// Build a fresh engine and return it with the target cell's id.
fn fresh_engine() -> (YrsComputeEngine, SheetId, CellId) {
    let (engine, _init) =
        YrsComputeEngine::from_snapshot(empty_target_snapshot()).expect("from_snapshot");
    (engine, sheet_id(), target_cell_id())
}

/// Apply `set_cell` with the rendered input string; return the resulting
/// mirror value.
fn value_via_set_cell(input: &CellValue) -> Result<CellValue, String> {
    let (mut engine, sid, cid) = fresh_engine();
    let rendered = cell_value_to_input_string(input);
    engine
        .set_cell(&sid, cid, TARGET_ROW, TARGET_COL, rendered.as_str().into())
        .map_err(|e| format!("set_cell err: {:?}", e))?;
    Ok(engine
        .mirror()
        .get_cell_value(&cid)
        .cloned()
        .unwrap_or(CellValue::Null))
}

/// Apply `import_values` with the raw CellValue; return the resulting
/// mirror value.
fn value_via_import(input: &CellValue) -> Result<CellValue, String> {
    let (mut engine, sid, cid) = fresh_engine();
    engine
        .import_values(&sid, vec![(TARGET_ROW, TARGET_COL, input.clone(), None)])
        .map_err(|e| format!("import_values err: {:?}", e))?;
    Ok(engine
        .mirror()
        .get_cell_value(&cid)
        .cloned()
        .unwrap_or(CellValue::Null))
}

/// Per-case runner used by `mod engine_mirror`. Each non-deferred case in
/// `cases()` becomes one `#[test]` that asserts the mirror value after
/// `engine.set_cell(render(v))` matches the case's declared expectation
/// (`RoundTrips(v)` = `v`, `CoercesTo(v')` = `v'`).
///
/// Failures surface by name in `cargo test` output — they are the bug
/// tracker. Cases that currently fail represent either engine bugs or
/// case-table drift where the declared expectation needs a product call.
fn run_engine_mirror_case(name: &str) {
    let case = cases()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("unknown class_iv case: {name}"));
    let expected = match &case.expected {
        Expectation::RoundTrips => case.input.clone(),
        Expectation::CoercesTo(v) => v.clone(),
        Expectation::Deferred => {
            panic!("deferred cases must not be registered as per-case tests: {name}");
        }
    };
    let got = match value_via_set_cell(&case.input) {
        Ok(v) => v,
        Err(e) => panic!("[{}] set_cell error: {}", case.name, e),
    };
    assert_eq!(
        got,
        expected,
        "\n[{}] set_cell mirror mismatch: input={} rendered={:?} got={} want={}",
        case.name,
        describe_value(&case.input),
        cell_value_to_input_string(&case.input),
        describe_value(&got),
        describe_value(&expected),
    );
}

/// One `#[test]` per non-deferred Class IV case, asserting that
/// `engine.set_cell(render(v))` produces the declared expected mirror
/// value. Case list mirrors `mod import_lossless` below — the two modules
/// exercise different production paths over the same case table.
mod engine_mirror {
    macro_rules! case {
        ($name:ident) => {
            #[test]
            fn $name() {
                super::run_engine_mirror_case(stringify!($name));
            }
        };
    }

    // whitespace
    case!(ws_single_space);
    case!(ws_two_spaces);
    case!(ws_tab);
    case!(ws_newline);
    case!(ws_crlf);
    case!(ws_surrounded);
    case!(ws_trailing);
    case!(ws_leading_newline);
    case!(ws_leading_space_trailing_newline);

    // leading apostrophe
    case!(apos_text);
    case!(apos_wrapped);
    case!(apos_double);
    case!(apos_would_be_bool);
    case!(apos_would_be_number);
    case!(apos_would_be_float);
    case!(apos_would_be_formula);

    // would-be formula
    case!(wouldbe_cellref_formula);
    case!(wouldbe_arith_formula);
    case!(wouldbe_bad_function_formula);
    case!(wouldbe_double_eq_formula);

    // type-coercing literals
    case!(literal_bool_true_upper);
    case!(literal_bool_true_lower);
    case!(literal_bool_false_upper);
    case!(literal_bool_false_mixed);
    case!(literal_int_42);
    case!(literal_float_point_four);
    case!(literal_scientific);
    case!(literal_currency_dollar);
    case!(literal_percent);
    case!(literal_fraction_slash);
    case!(literal_iso_date);
    case!(literal_time);
    case!(literal_empty_string);

    // null + errors
    case!(null);
    case!(err_div0);
    case!(err_na);
    case!(err_name);
    case!(err_null);
    case!(err_num);
    case!(err_ref);
    case!(err_value);
    case!(err_spill);
    case!(err_calc);
    case!(err_getting_data);
    case!(err_circ);
    case!(err_value_with_msg);

    // numeric edges
    case!(num_neg_zero);
    case!(num_zero);
    case!(num_point_one);
    case!(num_point_two);
    case!(num_point_three);
    case!(num_point_seven);
    case!(num_one_third);
    case!(num_2pow53);
    case!(num_2pow53_plus_one);
    case!(num_epsilon);
    case!(num_f64_max);
    case!(num_f64_min_positive);
    case!(num_subnormal);
}

/// Per-case runner used by `mod import_lossless`. `import_values` should
/// be the *raw* path — values go in, values come back out, no coercion.
/// For every non-Deferred case, the mirror value after `import_values(v)`
/// must equal `v`. Each case in `cases()` becomes one `#[test]` that
/// calls this with its name. Known bugs (FINDINGS.md Class-A: whitespace
/// collapse, leading apostrophe stripping, type coercion on strings,
/// error values dropped to Null) surface as named failing tests. The fix
/// direction is for `import_values` to skip render+reparse.
fn run_import_lossless_case(name: &str) {
    let case = cases()
        .into_iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("unknown class_iv case: {name}"));
    if matches!(case.expected, Expectation::Deferred) {
        panic!("deferred cases must not be registered as per-case tests: {name}");
    }
    let got = match value_via_import(&case.input) {
        Ok(v) => v,
        Err(e) => panic!("[{}] import_values error: {}", case.name, e),
    };
    assert_eq!(
        got,
        case.input,
        "\n[{}] import_values lost fidelity: input={} got={}",
        case.name,
        describe_value(&case.input),
        describe_value(&got),
    );
}

/// One `#[test]` per non-deferred Class IV case, asserting
/// `import_values(v) == v`. Failures surface by name in `cargo test`
/// output.
mod import_lossless {
    macro_rules! case {
        ($name:ident) => {
            #[test]
            fn $name() {
                super::run_import_lossless_case(stringify!($name));
            }
        };
    }

    // whitespace
    case!(ws_single_space);
    case!(ws_two_spaces);
    case!(ws_tab);
    case!(ws_newline);
    case!(ws_crlf);
    case!(ws_surrounded);
    case!(ws_trailing);
    case!(ws_leading_newline);
    case!(ws_leading_space_trailing_newline);

    // leading apostrophe
    case!(apos_text);
    case!(apos_wrapped);
    case!(apos_double);
    case!(apos_would_be_bool);
    case!(apos_would_be_number);
    case!(apos_would_be_float);
    case!(apos_would_be_formula);

    // would-be formula
    case!(wouldbe_cellref_formula);
    case!(wouldbe_arith_formula);
    case!(wouldbe_bad_function_formula);
    case!(wouldbe_double_eq_formula);

    // type-coercing literals
    case!(literal_bool_true_upper);
    case!(literal_bool_true_lower);
    case!(literal_bool_false_upper);
    case!(literal_bool_false_mixed);
    case!(literal_int_42);
    case!(literal_float_point_four);
    case!(literal_scientific);
    case!(literal_currency_dollar);
    case!(literal_percent);
    case!(literal_fraction_slash);
    case!(literal_iso_date);
    case!(literal_time);
    case!(literal_empty_string);

    // null + errors
    case!(null);
    case!(err_div0);
    case!(err_na);
    case!(err_name);
    case!(err_null);
    case!(err_num);
    case!(err_ref);
    case!(err_value);
    case!(err_spill);
    case!(err_calc);
    case!(err_getting_data);
    case!(err_circ);
    case!(err_value_with_msg);

    // numeric edges
    case!(num_neg_zero);
    case!(num_zero);
    case!(num_point_one);
    case!(num_point_two);
    case!(num_point_three);
    case!(num_point_seven);
    case!(num_one_third);
    case!(num_2pow53);
    case!(num_2pow53_plus_one);
    case!(num_epsilon);
    case!(num_f64_max);
    case!(num_f64_min_positive);
    case!(num_subnormal);
}

/// Runtime probe for the integration surface.
///
/// Plan: under 6 s for ~150 cases → ~60 s for 1500.
/// Print to stderr so `--nocapture` surfaces it; no assertion on timing
/// (perf budgets belong to CI infrastructure, not a correctness test).
#[cfg(feature = "perf-tests")]
#[test]
fn class_iv_runtime_probe_engine() {
    let cases = cases();
    let start = Instant::now();
    for case in &cases {
        if matches!(case.expected, Expectation::Deferred) {
            continue;
        }
        let _ = value_via_set_cell(&case.input);
        let _ = value_via_import(&case.input);
    }
    let elapsed = start.elapsed();
    eprintln!(
        "[Class IV engine runtime probe] {} non-deferred cases in {:?} ({:.3} ms/case)",
        cases
            .iter()
            .filter(|c| !matches!(c.expected, Expectation::Deferred))
            .count(),
        elapsed,
        elapsed.as_secs_f64() * 1e3 / cases.len().max(1) as f64,
    );
}

/// Stage-1 Track-4a — ensures the 5-ary and 6-ary cartesian combiners
/// produce the expected case counts with unique, well-shaped slugs.
///
/// The helpers `smoke_check5` / `smoke_check6` in `support/matrix.rs`
/// carry the real assertions (count, uniqueness, slug-segment shape).
/// This `#[test]` is the entry point that makes `cargo test` actually
/// fire them — `_support_smoke{,5,6}` alone are dead-code helpers that
/// only prove compilation.
#[test]
fn matrix_support_smoke_higher_arity() {
    let n5 = support::matrix::smoke_check5();
    let n6 = support::matrix::smoke_check6();
    assert!(n5 > 0, "cartesian5 smoke produced no cases");
    assert!(n6 > 0, "cartesian6 smoke produced no cases");
    eprintln!(
        "[matrix smoke] cartesian5 cases = {}, cartesian6 cases = {}",
        n5, n6,
    );
}
