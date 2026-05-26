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
use compute_core::storage::engine::YrsComputeEngine;
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_CELLS, KEY_FORMULA};
use domain_types::domain::copy::CopyType;
use domain_types::domain::filter::SortOrder;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellArray, CellError, CellValue};
use yrs::{Map, Out, Transact};

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

fn engine_with(cells: Vec<CellData>) -> (YrsComputeEngine, SheetId) {
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells,
            ranges: vec![],
        }],
        ..Default::default()
    };
    let (engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet uuid");
    (engine, sheet_id)
}

fn cell_value_at(engine: &YrsComputeEngine, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
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
        .relocate_cells(&sheet_id, 0, 0, 0, 0, 4, 0)
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
// Sort (range_operations.rs) — yrs KEY_FORMULA storage contract
// ---------------------------------------------------------------------------

/// Read the raw `KEY_FORMULA` string stored in yrs for the cell at `(row, col)`
/// on `sheet_id`. Unlike `YrsStorage::read_cell_from_yrs`, this does NOT
/// re-prepend `=` — it returns the body exactly as it sits in the Yrs document,
/// which is the contract `KEY_FORMULA` has been documented to satisfy (body
/// without leading `=`). Used to detect bugs that round-trip formulas through
/// the yrs layer with the leading `=` incorrectly preserved.
fn read_raw_key_formula(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let cell_id = engine
        .grid_index(sheet_id)
        .and_then(|g| g.cell_id_at(row, col))?;
    let storage = engine.storage();
    let doc = storage.doc();
    let sheets = storage.sheets();
    let txn = doc.transact();
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());

    let sheet_map = match sheets.get(&txn, &sheet_hex)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    let cells_map = match sheet_map.get(&txn, KEY_CELLS)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    let cell_map = match cells_map.get(&txn, &*cell_hex)? {
        Out::YMap(m) => m,
        _ => return None,
    };
    match cell_map.get(&txn, KEY_FORMULA)? {
        Out::Any(yrs::Any::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// mutation_relocate_cells (range_operations.rs) — distinct from
// engine.relocate_cells (structural.rs, already covered by
// relocate_preserves_error). `relocate_cells_yrs` is the entry that routes
// through EngineMutation::RelocateCells → mutation_relocate_cells, which has
// its own typed-edits vector and its own set_cells_raw call.
// ---------------------------------------------------------------------------

/// `#DIV/0!` in the source must land intact at the target position after a
/// `relocate_cells_yrs` (the yrs-routed relocate, distinct from the structural
/// relocate already covered).
#[test]
fn relocate_cells_yrs_preserves_error() {
    let err = CellValue::Error(CellError::Div0, None);
    let (mut engine, sheet_id) = engine_with(vec![make_cell(0, 0, err.clone())]);

    engine
        .relocate_cells_yrs(&sheet_id, 0, 0, 0, 0, &sheet_id, 4, 0)
        .expect("relocate_cells_yrs");

    let got = cell_value_at(&engine, &sheet_id, 4, 0);
    assert_eq!(
        got, err,
        "relocate_cells_yrs must preserve the Error at target; got {:?}",
        got,
    );
}

// ---------------------------------------------------------------------------
// mutation_remove_duplicates (range_operations.rs) — the "sibling resync"
// site that reads surviving cells from yrs and pushes typed (value, formula)
// tuples through set_cells_raw.
// ---------------------------------------------------------------------------

/// Removing duplicates from a range must not silently wipe errors in the
/// surviving rows. The sibling-resync loop reads post-dedup cells from yrs
/// and funnels them through `set_cells_raw`; before lossless import, that loop
/// rendered typed values via `cell_value_to_input_string` (Error → "") and
/// re-parsed through the string-typed scheduler, silently replacing the
/// error with Null.
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

/// After `sort_range` rewrites the yrs `KEY_FORMULA` sub-key post-sort, the
/// body MUST NOT start with `=`. The storage contract is "formula body only"
/// (`read_cell_from_yrs` re-prepends `=` on read; writing the `=`-prefixed
/// string back would double-prefix on the next read).
///
/// This test hits the fallback branch in `mutation_sort_range` where the
/// mirror has no `IdentityFormula` (because the formula was unparseable, so
/// `parse_and_register_formula` left `IdentityFormula = None` in the
/// `CellEntry`). In that branch, `formula_body` comes from
/// `read_cell_from_yrs` which *has* re-prepended `=`, and the rewrite loop
/// previously wrote the `=`-prefixed body straight into `KEY_FORMULA`.
#[test]
fn sort_preserves_key_formula_body_contract_on_fallback() {
    // Build the snapshot with a cell that has a formula body the parser
    // cannot recover even after `normalize_formula_input` (which auto-closes
    // parens and quotes sheet names). A trailing operator is unparseable —
    // `bulk_parse_and_register` will fail and leave the mirror without an
    // IdentityFormula for this cell, while yrs still stores the raw body.
    // That's the ONLY state in which `mutation_sort_range` hits the
    // fallback branch we're testing.
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
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
                    // `=1+` — trailing operator, unparseable. No IdentityFormula lands
                    // in the mirror; yrs stores the body verbatim.
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
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
    let sheet_id = SheetId::from_uuid_str(SHEET_UUID).expect("valid sheet uuid");

    // Confirm pre-sort invariant: KEY_FORMULA stored without leading `=`.
    let pre_sort = read_raw_key_formula(&engine, &sheet_id, 1, 1);
    assert_eq!(
        pre_sort.as_deref(),
        Some("1+"),
        "pre-sort KEY_FORMULA must be the body without `=`",
    );

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

    // Post-sort: the cell that had the bad formula is now at (0, 1). Its
    // KEY_FORMULA must STILL be the body without leading `=`.
    let post_sort = read_raw_key_formula(&engine, &sheet_id, 0, 1);
    assert!(
        post_sort.is_some(),
        "post-sort KEY_FORMULA must still be present",
    );
    let body = post_sort.unwrap();
    assert!(
        !body.starts_with('='),
        "sort rewrite must not leave a `=` prefix in yrs KEY_FORMULA; got {:?}",
        body,
    );
}
