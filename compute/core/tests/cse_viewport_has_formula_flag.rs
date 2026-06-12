//! Failing regression test: CSE projection members lose `HAS_FORMULA` in the
//! viewport-rendered cell flags.
//!
//! ## Bug
//!
//! `compute/core/src/storage/engine/viewport/functions.rs` (the per-cell render
//! path inside `build_viewport_render_data_inner`) computes `HAS_FORMULA` as:
//!
//! ```ignore
//! let has_formula =
//!     formula_str.is_some() || mirror.get_formula(&cell_id).is_some();
//! if has_formula { flags |= render_flags::HAS_FORMULA; }
//! ```
//!
//! This ignores CSE (Ctrl+Shift+Enter) array-formula projection membership.
//! For a multi-cell CSE formula entered with anchor `D1` and projection range
//! `D1:D3`, only the anchor cell carries entries in `formula_strings` /
//! `mirror.get_formula(...)`. The spilled-into projection members `D2` and
//! `D3` are members of the same array formula — their value comes from the
//! anchor's formula text — but the per-cell render flag computation never
//! consults projection state, so only `D1` lights up `HAS_FORMULA` in the
//! viewport bytes the UI consumes.
//!
//! ## Why a test
//!
//! When a user clicks D2 or D3 the toolbar should treat them as formula
//! cells (formula bar shows the array formula, edit guards activate, etc.).
//! The viewport flag is what downstream UI code keys off of, so the regression
//! is user-visible.
//!
//! ## Expected state
//!
//! This test must FAIL on `origin/dev` and PASS once the per-cell render
//! path consults CSE / projection membership when computing `has_formula`.
//!
//! Run:
//!   cargo test -p compute-core --test cse_viewport_has_formula_flag -- --nocapture

use compute_core::storage::engine::YrsComputeEngine;
use compute_wire::flags as render_flags;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Fixed UUIDs so the snapshot is deterministic.
// ---------------------------------------------------------------------------

const SHEET_UUID: &str = "00000000-0000-0000-0000-0000000000aa";

fn cell_uuid(suffix: u32) -> String {
    format!("00000000-0000-0000-0000-{:012x}", suffix)
}

fn number_cell(id_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: cell_uuid(id_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

/// Build a snapshot with:
///   A1:A3 = [10, 20, 30]
///   B1:B3 = [1, 2, 3]
///   D1   = `=A1:A3*B1:B3` with `array_ref="D1:D3"` (multi-cell CSE)
///
/// Only the anchor `D1` is materialized as a `CellData`; D2/D3 are reached
/// via the projection registry that snapshot loading pre-registers from the
/// anchor's `array_ref`.
fn cse_workbook() -> WorkbookSnapshot {
    let cells = vec![
        // A column
        number_cell(1, 0, 0, 10.0),
        number_cell(2, 1, 0, 20.0),
        number_cell(3, 2, 0, 30.0),
        // B column
        number_cell(4, 0, 1, 1.0),
        number_cell(5, 1, 1, 2.0),
        number_cell(6, 2, 1, 3.0),
        // D1: CSE anchor, formula =A1:A3*B1:B3 spilling D1:D3
        CellData {
            cell_id: cell_uuid(7),
            row: 0,
            col: 3,
            // Cached value of the top-left element only (the rest are filled
            // by recalc). Set to the correct first element so this isn't a
            // setup hint when comparing against the expected values.
            value: CellValue::Number(FiniteF64::must(10.0)),
            formula: Some("A1:A3*B1:B3".to_string()),
            identity_formula: None,
            array_ref: Some("D1:D3".to_string()),
        },
    ];

    let sheet = SheetSnapshot {
        id: SHEET_UUID.to_string(),
        name: "Sheet1".to_string(),
        rows: 50,
        cols: 10,
        cells,
        ranges: vec![],
    };

    WorkbookSnapshot {
        sheets: vec![sheet],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Baseline: the anchor `D1` should have `HAS_FORMULA` set. This is the
/// behavior already on dev — included as a positive control so a failure of
/// the main test (below) clearly distinguishes "anchor lost its flag" from
/// "projection members never gained one".
#[test]
fn cse_anchor_has_formula_flag_is_set() {
    let snap = cse_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // Render D1:D3 (rows 0..3, cols 3..4)
    let data = engine.build_viewport_render_data(&sheet_id, 0, 3, 3, 4);

    // Find the cell at (0, 3) — the anchor D1.
    let anchor = data
        .cells
        .iter()
        .find(|c| c.row == 0 && c.col == 3)
        .expect("anchor cell D1 present in viewport");

    assert_ne!(
        anchor.flags & render_flags::HAS_FORMULA,
        0,
        "D1 (CSE anchor) should have HAS_FORMULA set; flags=0x{:04x}",
        anchor.flags,
    );
}

/// Regression test (failing on dev): all three cells of the CSE projection
/// `D1:D3` must carry `HAS_FORMULA`, because they all belong to the same
/// array formula even though the formula text is stored only on the anchor.
#[test]
fn cse_projection_members_have_formula_flag() {
    let snap = cse_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // Render the projection rectangle D1:D3 (rows 0..3, cols 3..4).
    let data = engine.build_viewport_render_data(&sheet_id, 0, 3, 3, 4);

    // Collect projection cells by position.
    let mut cells_by_row: std::collections::HashMap<u32, &compute_wire::ViewportRenderCell> =
        std::collections::HashMap::new();
    for c in &data.cells {
        if c.col == 3 {
            cells_by_row.insert(c.row, c);
        }
    }

    let d1 = *cells_by_row.get(&0).expect("D1 in viewport");
    let d2 = *cells_by_row.get(&1).expect("D2 in viewport");
    let d3 = *cells_by_row.get(&2).expect("D3 in viewport");

    // Primary assertions: HAS_FORMULA must be set on every CSE member.
    // Run flag assertions first so the failure message points at the
    // documented bug (per-cell render path ignores CSE / projection
    // membership) rather than at any incidental value-side regression.
    assert_ne!(
        d1.flags & render_flags::HAS_FORMULA,
        0,
        "D1 (CSE anchor) missing HAS_FORMULA: flags=0x{:04x}",
        d1.flags,
    );
    assert_ne!(
        d2.flags & render_flags::HAS_FORMULA,
        0,
        "D2 (CSE projection member) missing HAS_FORMULA: flags=0x{:04x}; \
         per-cell render path in viewport/functions.rs doesn't consult \
         CSE / projection membership when computing has_formula. The \
         array formula text lives only on the anchor D1 — the spilled \
         members D2/D3 must inherit HAS_FORMULA by virtue of belonging \
         to the same projection.",
        d2.flags,
    );
    assert_ne!(
        d3.flags & render_flags::HAS_FORMULA,
        0,
        "D3 (CSE projection member) missing HAS_FORMULA: flags=0x{:04x}; \
         per-cell render path in viewport/functions.rs doesn't consult \
         CSE / projection membership when computing has_formula.",
        d3.flags,
    );

    // Optional value sanity: when CSE entry itself works the projected
    // values are [10, 40, 90]. Asserted *after* the flag check so a
    // value regression doesn't mask the flag bug, but useful to catch
    // a regression on the CSE evaluation path itself.
    let approx = |got: f64, want: f64| (got - want).abs() < 1e-9;
    assert!(
        approx(d1.number_value, 10.0),
        "D1 expected 10.0, got {} (flags=0x{:04x})",
        d1.number_value,
        d1.flags,
    );
    assert!(
        approx(d2.number_value, 40.0),
        "D2 expected 40.0, got {} (flags=0x{:04x})",
        d2.number_value,
        d2.flags,
    );
    assert!(
        approx(d3.number_value, 90.0),
        "D3 expected 90.0, got {} (flags=0x{:04x})",
        d3.number_value,
        d3.flags,
    );
}

// ---------------------------------------------------------------------------
// Dynamic-array spill: SEQUENCE(3) at A1 must spill into A1:A3. Only the
// anchor owns formula text; non-anchor spill members carry IS_SPILL_MEMBER
// without HAS_FORMULA. A1's number_value must be 1.0 (NOT NaN).
//
// The latent NaN bug: the per-cell render path's `_ => f64::NAN` arm fires
// for `CellValue::Array(..)` if the anchor's value isn't dereferenced before
// the type match. The unified `cell_render_at` path indexes the array at
// (0,0) for the anchor, eliminating that arm by construction.
// ---------------------------------------------------------------------------

fn dynamic_spill_workbook() -> WorkbookSnapshot {
    // A1: =SEQUENCE(3) — anchor of a 3-row dynamic-array spill.
    let cells = vec![CellData {
        cell_id: cell_uuid(101),
        row: 0,
        col: 0,
        value: CellValue::Number(FiniteF64::must(1.0)),
        formula: Some("SEQUENCE(3)".to_string()),
        identity_formula: None,
        array_ref: None,
    }];

    let sheet = SheetSnapshot {
        id: SHEET_UUID.to_string(),
        name: "Sheet1".to_string(),
        rows: 50,
        cols: 10,
        cells,
        ranges: vec![],
    };

    WorkbookSnapshot {
        sheets: vec![sheet],
        ..Default::default()
    }
}

#[test]
fn dynamic_spill_anchor_has_formula_flag_and_number_value() {
    let snap = dynamic_spill_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // A1:A3 — rows 0..3, cols 0..1
    let data = engine.build_viewport_render_data(&sheet_id, 0, 0, 3, 1);

    let cell_at = |row: u32| -> &compute_wire::ViewportRenderCell {
        data.cells
            .iter()
            .find(|c| c.row == row && c.col == 0)
            .unwrap_or_else(|| panic!("cell (row={row}, col=0) missing from viewport"))
    };

    let a1 = cell_at(0);
    let a2 = cell_at(1);
    let a3 = cell_at(2);

    // HAS_FORMULA lights up only on the formula-owning anchor. Non-anchor
    // dynamic spill members are projected values, not formula owners.
    assert_ne!(
        a1.flags & compute_wire::flags::HAS_FORMULA,
        0,
        "A1 (SEQUENCE anchor) missing HAS_FORMULA: flags=0x{:04x}",
        a1.flags,
    );
    assert_eq!(
        a2.flags & compute_wire::flags::HAS_FORMULA,
        0,
        "A2 (SEQUENCE spill member) must not carry HAS_FORMULA: flags=0x{:04x}",
        a2.flags,
    );
    assert_eq!(
        a3.flags & compute_wire::flags::HAS_FORMULA,
        0,
        "A3 (SEQUENCE spill member) must not carry HAS_FORMULA: flags=0x{:04x}",
        a3.flags,
    );
    assert_ne!(
        a2.flags & compute_wire::flags::IS_SPILL_MEMBER,
        0,
        "A2 (SEQUENCE spill member) missing IS_SPILL_MEMBER: flags=0x{:04x}",
        a2.flags,
    );
    assert_ne!(
        a3.flags & compute_wire::flags::IS_SPILL_MEMBER,
        0,
        "A3 (SEQUENCE spill member) missing IS_SPILL_MEMBER: flags=0x{:04x}",
        a3.flags,
    );

    // Anchor value: 1.0, NOT NaN. The pre-fix path falls through to the
    // catch-all NaN arm because `CellValue::Array(..)` is not dereferenced.
    let approx = |got: f64, want: f64| (got - want).abs() < 1e-9;
    assert!(
        approx(a1.number_value, 1.0),
        "A1 expected 1.0, got {} (flags=0x{:04x})",
        a1.number_value,
        a1.flags,
    );
    assert!(
        approx(a2.number_value, 2.0),
        "A2 expected 2.0, got {} (flags=0x{:04x})",
        a2.number_value,
        a2.flags,
    );
    assert!(
        approx(a3.number_value, 3.0),
        "A3 expected 3.0, got {} (flags=0x{:04x})",
        a3.number_value,
        a3.flags,
    );
}

// ---------------------------------------------------------------------------
// Stream D3 — `get_active_cell` populates `metadata.region` for CSE
// projection cells. The region shape is the same enum that surfaces
// Data Table cells; D5 will deprecate the back-compat flags
// (`isArrayFormula`, `isCseAnchor`) in favor of `region.kind`.
// ---------------------------------------------------------------------------

#[test]
fn cse_anchor_active_cell_metadata_has_region_with_cse_kind() {
    use snapshot_types::properties::{CellMetadata, RegionBounds, RegionKind, RegionMeta};

    let snap = cse_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let d1_id = cell_types::CellId::from_uuid_str(&cell_uuid(7)).unwrap();

    let active = engine.get_active_cell(&sheet_id, &d1_id);
    let meta_value = active
        .metadata
        .as_ref()
        .expect("CSE anchor must surface metadata");
    let meta: CellMetadata =
        serde_json::from_value(meta_value.clone()).expect("metadata deserializes");

    let region = meta
        .region
        .expect("CSE anchor must surface region metadata");
    assert_eq!(
        region,
        RegionMeta {
            kind: RegionKind::CseArray,
            is_anchor: true,
            anchor_row: 0,
            anchor_col: 3,
            bounds: RegionBounds { rows: 3, cols: 1 },
        }
    );

    // Back-compat flags follow `region` — these are what the formula
    // bar reads today. Source text stays on the existing `formula`
    // field; there is no `region.source`.
    assert!(meta.is_array_formula);
    assert!(meta.is_cse_anchor);
    assert!(!meta.is_array_member);
    assert_eq!(active.formula.as_deref(), Some("=A1:A3*B1:B3"));
}

#[test]
fn dynamic_spill_anchor_active_cell_metadata_has_region_with_array_spill_kind() {
    use snapshot_types::properties::{CellMetadata, RegionKind};

    let snap = dynamic_spill_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let a1_id = cell_types::CellId::from_uuid_str(&cell_uuid(101)).unwrap();

    let active = engine.get_active_cell(&sheet_id, &a1_id);
    let meta_value = active
        .metadata
        .as_ref()
        .expect("dynamic-spill anchor must surface metadata");
    let meta: CellMetadata =
        serde_json::from_value(meta_value.clone()).expect("metadata deserializes");

    let region = meta
        .region
        .expect("dynamic-spill anchor must surface region metadata");
    // Modern dynamic-array spill uses `arraySpill` kind, NO braces in
    // the formula bar (D5 will use this discriminant for brace policy).
    assert!(matches!(region.kind, RegionKind::ArraySpill));
    assert!(region.is_anchor);
    // Bounds reflect the SEQUENCE(3) result.
    assert_eq!(region.bounds.rows, 3);
    assert_eq!(region.bounds.cols, 1);

    // Back-compat: array_formula true, but cse_anchor false (this is
    // dynamic spill, not CSE).
    assert!(meta.is_array_formula);
    assert!(!meta.is_cse_anchor);
    assert!(!meta.is_array_member);
}

// ---------------------------------------------------------------------------
// Interactive CSE entry: `set_array_formula` (the Ctrl+Shift+Enter path)
// must preserve the full array result and register projections, not collapse
// to a scalar via implicit intersection.
//
// Bug: before the fix, `set_array_formula` unmarked the CSE anchor before
// evaluation, so the spill handler saw `is_cse_single=false` AND
// `is_dynamic_array=false` and applied implicit intersection, collapsing the
// array to a scalar. Projection members rendered as empty cells.
// ---------------------------------------------------------------------------

/// Build a snapshot with only plain source data (no CSE formula in snapshot).
/// The CSE formula will be entered interactively via `set_array_formula`.
fn interactive_cse_source_workbook() -> WorkbookSnapshot {
    let cells = vec![
        // A column: [10, 20, 30]
        number_cell(20, 0, 0, 10.0),
        number_cell(21, 1, 0, 20.0),
        number_cell(22, 2, 0, 30.0),
        // B column: [1, 2, 3]
        number_cell(23, 0, 1, 1.0),
        number_cell(24, 1, 1, 2.0),
        number_cell(25, 2, 1, 3.0),
        // Blank cells in the target CSE range, matching UI-created grids
        // where covered cells can already have identities before CSE entry.
        CellData {
            cell_id: cell_uuid(26),
            row: 1,
            col: 3,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
        CellData {
            cell_id: cell_uuid(27),
            row: 2,
            col: 3,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
    ];

    let sheet = SheetSnapshot {
        id: SHEET_UUID.to_string(),
        name: "Sheet1".to_string(),
        rows: 50,
        cols: 10,
        cells,
        ranges: vec![],
    };

    WorkbookSnapshot {
        sheets: vec![sheet],
        ..Default::default()
    }
}

#[test]
fn cse_set_array_formula_preserves_array_value_and_projection() {
    // 1. Create engine with source data A1:A3=[10,20,30], B1:B3=[1,2,3]
    //    via snapshot (no CSE formula — just plain number cells).
    let snap = interactive_cse_source_workbook();
    let (mut engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    // 2. Interactively enter CSE array formula on D1:D3 (rows 0..2, col 3).
    //    This is the Ctrl+Shift+Enter path.
    engine
        .set_array_formula(
            &sheet_id,
            /* top_row */ 0,
            /* left_col */ 3,
            /* bottom_row */ 2,
            /* right_col */ 3,
            "=A1:A3*B1:B3".to_string(),
        )
        .expect("set_array_formula should succeed");

    // 3. Build viewport for D1:D3 (rows 0..3, cols 3..4).
    let data = engine.build_viewport_render_data(&sheet_id, 0, 3, 3, 4);

    // Collect cells by row in col 3.
    let mut cells_by_row: std::collections::HashMap<u32, &compute_wire::ViewportRenderCell> =
        std::collections::HashMap::new();
    for c in &data.cells {
        if c.col == 3 {
            cells_by_row.insert(c.row, c);
        }
    }

    let d1 = *cells_by_row.get(&0).expect("D1 in viewport");
    let d2 = *cells_by_row.get(&1).expect("D2 in viewport");
    let d3 = *cells_by_row.get(&2).expect("D3 in viewport");

    // 4. Assert values: D1=10, D2=40, D3=90 with HAS_FORMULA on all three.
    let approx = |got: f64, want: f64| (got - want).abs() < 1e-9;

    // Value assertions — the core bug: without the fix, D2 and D3 are empty
    // (number_value=0 or NaN) because the array was collapsed to a scalar.
    assert!(
        approx(d1.number_value, 10.0),
        "D1 expected 10.0, got {}",
        d1.number_value,
    );
    assert!(
        approx(d2.number_value, 40.0),
        "D2 expected 40.0, got {} — array collapsed to scalar via implicit intersection",
        d2.number_value,
    );
    assert!(
        approx(d3.number_value, 90.0),
        "D3 expected 90.0, got {} — array collapsed to scalar via implicit intersection",
        d3.number_value,
    );

    // HAS_FORMULA flag assertions.
    assert_ne!(
        d1.flags & render_flags::HAS_FORMULA,
        0,
        "D1 (CSE anchor) missing HAS_FORMULA: flags=0x{:04x}",
        d1.flags,
    );
    assert_ne!(
        d2.flags & render_flags::HAS_FORMULA,
        0,
        "D2 (CSE projection member) missing HAS_FORMULA: flags=0x{:04x}",
        d2.flags,
    );
    assert_ne!(
        d3.flags & render_flags::HAS_FORMULA,
        0,
        "D3 (CSE projection member) missing HAS_FORMULA: flags=0x{:04x}",
        d3.flags,
    );

    // Read APIs should expose the formula-owning anchor's formula for covered
    // CSE members. The formula remains stored on the anchor, but formula-bar
    // consumers must see the same authored formula at every cell in the CSE
    // rectangle.
    let d2_id = cell_types::CellId::from_uuid_str(
        &engine
            .get_cell_id_at(&sheet_id, 1, 3)
            .expect("D2 CSE member should have a cell id"),
    )
    .expect("D2 cell id should parse");
    let d2_active = engine.get_active_cell(&sheet_id, &d2_id);
    assert_eq!(
        d2_active.formula.as_deref(),
        Some("=A1:A3*B1:B3"),
        "D2 active-cell read should expose the CSE anchor formula"
    );

    let metadata: snapshot_types::properties::CellMetadata = serde_json::from_value(
        d2_active
            .metadata
            .clone()
            .expect("D2 active cell should expose CSE metadata"),
    )
    .expect("D2 metadata should deserialize");
    assert!(metadata.is_array_formula);
    assert!(metadata.is_array_member);
    assert!(matches!(
        metadata.region.as_ref().map(|region| region.kind),
        Some(snapshot_types::properties::RegionKind::CseArray)
    ));

    let d2_raw = engine
        .get_raw_cell_data(&sheet_id, 1, 3, true)
        .expect("D2 raw cell data should exist");
    assert_eq!(
        d2_raw.formula.as_deref(),
        Some("=A1:A3*B1:B3"),
        "D2 raw-cell-data read should expose the CSE anchor formula"
    );
    assert!(matches!(
        d2_raw.computed,
        Some(value_types::CellValue::Number(n)) if (n.get() - 40.0).abs() < 1e-9
    ));

    let d2_cell_data = engine
        .get_cell_data(&sheet_id, 1, 3)
        .expect("D2 cell data should exist");
    assert_eq!(
        d2_cell_data.get("formula").and_then(|value| value.as_str()),
        Some("A1:A3*B1:B3"),
        "D2 cell-data read should expose the CSE anchor formula body"
    );

    // 5. Assert partial write to D2 returns PartialArrayWrite error.
    let result = engine.set_cell_value_parsed(&sheet_id, 1, 3, "test");
    match result {
        Err(value_types::ComputeError::PartialArrayWrite { .. }) => {
            // Expected — writing to a CSE projection member is rejected.
        }
        Err(other) => panic!(
            "expected PartialArrayWrite for write to D2, got {:?}",
            other
        ),
        Ok(_) => {
            panic!("expected PartialArrayWrite for write to D2 (CSE projection member), got Ok")
        }
    }
}
