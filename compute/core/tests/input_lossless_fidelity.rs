//! End-to-end fidelity tests for the value-typed input path.
//!
//! Exercises fill / flash-fill / move / paste through the full engine API,
//! asserting that `CellValue::Error(..)` and `CellValue::Array(..)` survive
//! the write paths without being silently dropped.
//!
//! Before lossless import's `set_cells_raw` landed, each of these paths rendered
//! typed values via `cell_value_to_input_string` (Error → "", Array → "")
//! and then re-parsed the rendered string through the scheduler. That
//! round-trip produced `CellValue::Null` at the target — a silent data loss.
//!
//! These tests pin the lossless contract. A regression shows up as a
//! target-cell type mismatch, not an inscrutable formula-engine bug.

use cell_types::SheetId;
use compute_core::bridge_types::{BridgeSortCriterion, BridgeSortMode, BridgeSortOptions};
use compute_core::engine_types::fill::{BridgeAutoFillRequest, BridgeFillRangeSpec};
use compute_core::storage::engine::ComputeEngine;
use domain_types::domain::copy::CopyType;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellArray, CellError, CellValue};

const SHEET_UUID: &str = "00000000000000000000000000000001";

fn cell_uuid(row: u32, col: u32) -> String {
    format!("000000000000000000000000{:04x}{:04x}", row, col)
}

fn make_cell(row: u32, col: u32, value: CellValue) -> CellData {
    CellData {
        cell_id: cell_uuid(row, col),
        row,
        col,
        value,
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn engine_with(cells: Vec<CellData>) -> (ComputeEngine, SheetId) {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = ComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet uuid");
    (engine, sheet_id)
}

fn cell_value_at(engine: &ComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
    // Position-based lookup — after relocate or paste, the cell at (row, col)
    // may have a cell_id that differs from the seed uuid.
    engine
        .mirror()
        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

fn div_zero_error() -> CellValue {
    CellValue::Error(CellError::Div0, None)
}

fn ref_error() -> CellValue {
    CellValue::Error(CellError::Ref, None)
}

fn two_by_two_array() -> CellValue {
    // Simulate an already-spilled 2x2 array value. Array cells don't arise
    // from user typing, but they can sit in the mirror as formula outputs —
    // the write path must not flatten them to Null on sync.
    let rows = vec![
        vec![CellValue::number(1.0), CellValue::number(2.0)],
        vec![CellValue::number(3.0), CellValue::number(4.0)],
    ];
    CellValue::Array(CellArray::from_rows(rows).into())
}

// ---------------------------------------------------------------------------
// Copy/paste (range_operations.rs sites 8, 9)
// ---------------------------------------------------------------------------

/// Paste (CopyType::Values) of a `#DIV/0!` error cell. Target must hold the
/// same error, not `Null`.
#[test]
fn paste_values_preserves_error() {
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, div_zero_error())]);

    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            0,
            &sheet_id,
            2,
            0,
            CopyType::Values,
            false,
            false,
        )
        .expect("copy_range values");

    let got = cell_value_at(&engine, &sheet_id, 2, 0);
    assert_eq!(
        got,
        div_zero_error(),
        "paste (Values) must preserve the Error; got {:?}",
        got,
    );
}

/// Paste (CopyType::All) of a `#REF!` error cell. Target must hold the same
/// error, not `Null`.
#[test]
fn paste_all_preserves_error() {
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, ref_error())]);

    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            0,
            &sheet_id,
            2,
            0,
            CopyType::All,
            false,
            false,
        )
        .expect("copy_range all");

    let got = cell_value_at(&engine, &sheet_id, 2, 0);
    assert_eq!(
        got,
        ref_error(),
        "paste (All) must preserve the Error; got {:?}",
        got,
    );
}

/// Source cell holds a pre-spilled `CellValue::Array(..)`. The engine may
/// split this into scalar cells at hydration (Excel-style spill), so what
/// actually lives at A1 after snapshot load depends on internal semantics.
///
/// The invariant this test pins is narrower than "paste copies the array
/// verbatim": whatever the source cell actually holds at the time of paste,
/// the paste target holds the same thing. No silent Null substitution.
#[test]
fn paste_values_preserves_source_cell_verbatim_for_array() {
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, two_by_two_array())]);

    // Read the post-hydration state of A1 — that's the source ground truth.
    let source_before_paste = cell_value_at(&engine, &sheet_id, 0, 0);
    // It must not have been silently nulled out at hydration — the Array
    // either survives intact or spills into scalar cells.
    assert_ne!(
        source_before_paste,
        CellValue::Null,
        "hydration must not drop Array to Null; got Null",
    );

    engine
        .copy_range(
            &sheet_id,
            0,
            0,
            0,
            0,
            &sheet_id,
            10,
            0,
            CopyType::Values,
            false,
            false,
        )
        .expect("copy_range values");

    let got = cell_value_at(&engine, &sheet_id, 10, 0);
    assert_eq!(
        got, source_before_paste,
        "paste (Values) must preserve the source cell verbatim; got {:?} want {:?}",
        got, source_before_paste,
    );
}

// ---------------------------------------------------------------------------
// Move / relocate (range_operations.rs sites 6, 7)
// ---------------------------------------------------------------------------

/// Relocate a `#N/A` error cell. Target must hold the error.
#[test]
fn relocate_preserves_error() {
    let err = CellValue::Error(CellError::Na, None);
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, err.clone())]);

    // Sanity: A1 holds the Error after snapshot hydration.
    let before = cell_value_at(&engine, &sheet_id, 0, 0);
    assert_eq!(
        before, err,
        "pre-relocate A1 must hold the Error; got {:?}",
        before
    );

    engine
        .relocate_values(&sheet_id, 0, 0, 0, 0, 4, 0)
        .expect("relocate_cells");

    let got_source = cell_value_at(&engine, &sheet_id, 0, 0);
    let got_target = cell_value_at(&engine, &sheet_id, 4, 0);
    eprintln!("after relocate: A1={:?}, A5={:?}", got_source, got_target);

    assert_eq!(
        got_target, err,
        "relocate must preserve the Error at target; got A1={:?} A5={:?}",
        got_source, got_target,
    );
}

// ---------------------------------------------------------------------------
// Auto-fill (fill.rs site 4)
// ---------------------------------------------------------------------------

/// Drag-fill an error cell downward. Every filled target cell must hold
/// the same error — the pre-fix path rendered Error → "" → Null.
#[test]
fn autofill_down_preserves_error() {
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, div_zero_error())]);

    let request = BridgeAutoFillRequest {
        source_range: BridgeFillRangeSpec {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
        },
        target_range: BridgeFillRangeSpec {
            start_row: 1,
            start_col: 0,
            end_row: 3,
            end_col: 0,
        },
        direction: "down".to_string(),
        mode: "auto".to_string(),
        include_formulas: true,
        include_values: true,
        include_formats: true,
        step_value: 1.0,
    };

    engine
        .auto_fill(&sheet_id, request)
        .expect("auto_fill down");

    for row in 1..=3 {
        let got = cell_value_at(&engine, &sheet_id, row, 0);
        assert_eq!(
            got,
            div_zero_error(),
            "autofill target at row {row} must preserve the Error; got {:?}",
            got,
        );
    }
}

// ---------------------------------------------------------------------------
// Native sort formula source preservation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// mutation_relocate_cells (range_operations.rs) — distinct from
// engine.relocate_cells (structural.rs, already covered by
// relocate_preserves_error). `relocate_cells` is the entry that routes
// through EngineMutation::RelocateCells → mutation_relocate_cells, which has
// its own typed-edits vector and its own set_cells_raw call.
// ---------------------------------------------------------------------------

/// `#DIV/0!` in the source must land intact at the target position after a
/// `relocate_cells` mutation (distinct from the structural
/// relocate already covered).
#[test]
fn relocate_cells_preserves_error() {
    let err = CellValue::Error(CellError::Div0, None);
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, err.clone())]);

    engine
        .relocate_cells(&sheet_id, 0, 0, 0, 0, &sheet_id, 4, 0)
        .expect("relocate_cells");

    let got = cell_value_at(&engine, &sheet_id, 4, 0);
    assert_eq!(
        got, err,
        "relocate_cells must preserve the Error at target; got {:?}",
        got,
    );
}

// ---------------------------------------------------------------------------
// Duplicate removal must preserve typed values in every surviving row.
// ---------------------------------------------------------------------------

/// Removing duplicates from a range must not silently wipe errors in the
/// surviving rows. Values stay typed throughout the operation; converting
/// an error through an empty input string would incorrectly produce Null.
#[test]
fn remove_duplicates_preserves_error_in_surviving_rows() {
    // Column A: two duplicate "x" rows that will be deduped, plus a third
    // unique row holding an Error. Column B: the row-level error marker we
    // want to see survive the resync.
    let (mut engine, sheet_id) = engine_with(vec![
        make_cell(0, 0, CellValue::Text("x".into())),
        make_cell(0, 1, CellValue::Error(CellError::Value, None)),
        make_cell(1, 0, CellValue::Text("x".into())),
        make_cell(1, 1, CellValue::number(2.0)),
        make_cell(2, 0, CellValue::Text("y".into())),
        make_cell(2, 1, CellValue::Error(CellError::Div0, None)),
    ]);

    // Dedup on column A. The first "x" row survives (row 0) with its Error
    // in B, and "y" survives (slides up into row 1) with its Error in B.
    engine
        .remove_duplicates(&sheet_id, 0, 0, 2, 1, vec![0], false)
        .expect("remove_duplicates");

    // Row 0 (surviving "x" row) must still have #VALUE! in column B.
    let b0 = cell_value_at(&engine, &sheet_id, 0, 1);
    assert_eq!(
        b0,
        CellValue::Error(CellError::Value, None),
        "surviving row 0 must keep #VALUE! in col B; got {:?}",
        b0,
    );

    // Row 1 (originally row 2, "y") must still have #DIV/0! in column B
    // after being compacted into the dedup-vacated slot.
    let b1 = cell_value_at(&engine, &sheet_id, 1, 1);
    assert_eq!(
        b1,
        CellValue::Error(CellError::Div0, None),
        "compacted row 1 must keep #DIV/0! in col B; got {:?}",
        b1,
    );
}

/// An unparsed formula must retain its authored source when its cell moves.
#[test]
fn sort_preserves_unparsed_formula_source() {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: cell_uuid(0, 0),
                    row: 0,
                    col: 0,
                    value: CellValue::number(2.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_uuid(1, 0),
                    row: 1,
                    col: 0,
                    value: CellValue::number(1.0),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_uuid(0, 1),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("x".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: cell_uuid(1, 1),
                    row: 1,
                    col: 1,
                    // The scheduler preserves this unparseable authored source.
                    value: CellValue::Error(CellError::Name, None),
                    formula: Some("1+".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet uuid");

    assert_eq!(engine.get_raw_value(&sheet_id, 1, 1), "=1+");

    // Sort A1:B2 ascending by column A — flips rows so the bad-formula cell
    // lands in row 0.
    let opts = BridgeSortOptions {
        criteria: vec![BridgeSortCriterion {
            column: 0,
            direction: SortOrder::Asc,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }],
        has_headers: false,
        visible_rows_only: false,
    };
    engine
        .sort_range(&sheet_id, 0, 0, 1, 1, opts)
        .expect("sort_range");

    assert_eq!(engine.get_raw_value(&sheet_id, 0, 1), "=1+");
}
