//! Stream D1 — `cell_render_at` consults Data Table region storage.
//!
//! These tests pin the chokepoint extension: the unified `cell_render_at`
//! lookup (which already handles CSE / dynamic-array projection via
//! `projection_registry`) now also surfaces Data Table region membership
//! via `mirror.data_table_regions`. Both sources flow through ONE
//! `CellRender` enum — there is no parallel `data_table_at` accessor in
//! the render path.
//!
//! Fixture: a 2×2 Data Table region B2:C3 with master at B2. The region
//! definition is loaded via the `data_table_regions` field on
//! `WorkbookSnapshot` (the same path the XLSX importer uses for
//! `<f t="dataTable">` regions).
//!
//! Run:
//!   cargo test -p compute-core --test data_table_region_membership

use compute_core::projection::{CellRender, RegionKind};
use compute_core::storage::engine::YrsComputeEngine;
use snapshot_types::{CellData, DataTableRegionDef, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Fixed UUIDs so the snapshot is deterministic.
//
// `SheetId::to_uuid_string()` produces the simple (no-dash) format —
// matching what the XLSX importer writes into `SheetSnapshot.id`. The
// test fixture uses the same shape so `data_table_regions[i].sheet`
// matches the runtime `sheet.to_uuid_string()` lookup at `region_at`.
// ---------------------------------------------------------------------------

const SHEET_UUID: &str = "000000000000000000000000000000aa";

fn cell_uuid(suffix: u32) -> String {
    format!("{:020x}{:012x}", 0u128, suffix)
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
/// - A1 = 2,  A2 = 3 (header / input cells)
/// - B1 = 5,  C1 = 7 (top-row header values)
/// - B2 = master (TABLE formula text — body content depends on Stream E)
/// - B3, C2, C3 = body cells with cached values
/// - data_table_regions: B2:C3 covers the master + body rectangle
///
/// The TABLE formula on B2 is left as a stub (`Some("TABLE($A$2,$A$1)")`)
/// — Stream D1 only cares about region membership, not evaluation. The
/// test asserts the `RegionRef` shape returned by `cell_render_at` for
/// master, body, and outside-region positions.
fn data_table_workbook() -> WorkbookSnapshot {
    let cells = vec![
        // A column — input cells for TABLE
        number_cell(1, 0, 0, 2.0), // A1 = top-row anchor (referenced by r1)
        number_cell(2, 1, 0, 3.0), // A2 = left-col anchor (referenced by r2)
        // Top-row headers (column inputs)
        number_cell(3, 0, 1, 5.0), // B1
        number_cell(4, 0, 2, 7.0), // C1
        // Master cell B2 — carries the TABLE formula
        CellData {
            cell_id: cell_uuid(5),
            row: 1,
            col: 1,
            value: CellValue::Number(FiniteF64::must(0.0)), // placeholder
            formula: Some("TABLE($A$2,$A$1)".to_string()),
            identity_formula: None,
            array_ref: None,
        },
        // Body cells with cached values (would be computed by TABLE eval).
        number_cell(6, 1, 2, 14.0), // C2
        number_cell(7, 2, 1, 15.0), // B3
        number_cell(8, 2, 2, 21.0), // C3
    ];

    let sheet = SheetSnapshot {
        id: SHEET_UUID.to_string(),
        name: "Sheet1".to_string(),
        rows: 50,
        cols: 10,
        cells,
        ranges: vec![],
    };

    let region = DataTableRegionDef {
        sheet: SHEET_UUID.to_string(),
        start_row: 1, // B2
        start_col: 1,
        end_row: 2, // C3
        end_col: 2,
        row_input_ref: None,
        col_input_ref: None,
        ooxml_flags: None,
    };

    WorkbookSnapshot {
        sheets: vec![sheet],
        data_table_regions: vec![region],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn data_table_master_reports_anchor_region() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let mirror = engine.mirror();

    // B2 = (row=1, col=1) — the master cell. Should be a Plain view
    // with a region tagged `is_anchor: true`.
    let render = mirror.cell_render_at(&sheet_id, 1, 1);
    match render {
        CellRender::Plain(view) => {
            let region = view.region.expect(
                "B2 (Data Table master) must report a region; cell_render_at \
                 did not consult mirror.data_table_regions",
            );
            assert!(
                matches!(region.kind, RegionKind::DataTable),
                "expected RegionKind::DataTable, got {:?}",
                region.kind,
            );
            assert!(
                region.is_anchor,
                "B2 is the master — is_anchor must be true"
            );
            assert_eq!(region.anchor_row, 1, "anchor_row mismatch");
            assert_eq!(region.anchor_col, 1, "anchor_col mismatch");
        }
        other => panic!(
            "expected CellRender::Plain at the Data Table master, got {:?}",
            other
        ),
    }
}

#[test]
fn data_table_body_reports_member_region() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let mirror = engine.mirror();

    // C3 = (row=2, col=2) — body cell. Region with is_anchor=false,
    // but anchor coords pointing back to B2.
    let render = mirror.cell_render_at(&sheet_id, 2, 2);
    match render {
        CellRender::Plain(view) => {
            let region = view.region.expect(
                "C3 (Data Table body) must report a region; cell_render_at \
                 did not consult mirror.data_table_regions",
            );
            assert!(
                matches!(region.kind, RegionKind::DataTable),
                "expected RegionKind::DataTable for body cell"
            );
            assert!(
                !region.is_anchor,
                "C3 is a body cell — is_anchor must be false"
            );
            assert_eq!(
                region.anchor_row, 1,
                "body cell must point back to master row"
            );
            assert_eq!(
                region.anchor_col, 1,
                "body cell must point back to master col"
            );
        }
        other => panic!(
            "expected CellRender::Plain at a Data Table body cell, got {:?}",
            other
        ),
    }
}

#[test]
fn data_table_outside_returns_no_region() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let mirror = engine.mirror();

    // A1 = (row=0, col=0) — outside the B2:C3 region. Should be Plain
    // with region == None.
    let render = mirror.cell_render_at(&sheet_id, 0, 0);
    match render {
        CellRender::Plain(view) => {
            assert!(
                view.region.is_none(),
                "A1 lies outside B2:C3 — region must be None, got {:?}",
                view.region.map(|r| r.kind)
            );
        }
        other => panic!(
            "expected CellRender::Plain for plain cell A1, got {:?}",
            other
        ),
    }

    // D5 — outside region and no CellId. Should be Empty (no region).
    let render = mirror.cell_render_at(&sheet_id, 4, 3);
    assert!(
        matches!(render, CellRender::Empty),
        "D5 (no CellId, outside region) should be Empty, got {:?}",
        render,
    );
}
