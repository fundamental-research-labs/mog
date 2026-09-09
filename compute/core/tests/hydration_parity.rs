//! Native values, formulas, merges, hyperlinks and formatting survive an XLSX roundtrip.

use compute_core::storage::engine::ComputeEngine;
use compute_core::test_support::native_canonical::canonicalize;
use domain_types::CellFormat;
use snapshot_types::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

fn value_cell(uuid_suffix: u32, row: u32, col: u32, n: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(n)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn text_cell(uuid_suffix: u32, row: u32, col: u32, s: &str) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Text(std::sync::Arc::from(s)),
        formula: None,
        identity_formula: None,
        array_ref: None,
    }
}

fn formula_cell(uuid_suffix: u32, row: u32, col: u32, formula: &str, cached: f64) -> CellData {
    CellData {
        cell_id: format!("a0000000-0000-0000-0000-{:012x}", uuid_suffix),
        row,
        col,
        value: CellValue::Number(FiniteF64::must(cached)),
        formula: Some(formula.to_string()),
        identity_formula: None,
        array_ref: None,
    }
}

const SHEET1_ID: &str = "550e8400-e29b-41d4-a716-446655440001";
const SHEET2_ID: &str = "550e8400-e29b-41d4-a716-446655440002";
const SHEET3_ID: &str = "550e8400-e29b-41d4-a716-446655440003";

fn rich_fixture() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: SHEET1_ID.to_string(),
                name: "Sheet1".to_string(),
                rows: 20,
                cols: 10,
                cells: vec![
                    value_cell(1, 0, 0, 1.0),                    // A1 = 1
                    value_cell(2, 0, 1, 2.0),                    // B1 = 2
                    text_cell(3, 1, 0, "hello"),                 // A2 = "hello"
                    formula_cell(4, 2, 0, "=A1+B1", 3.0),        // A3 = =A1+B1
                    formula_cell(5, 3, 0, "=Sheet2!A1*2", 20.0), // A4 = cross-sheet
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: SHEET2_ID.to_string(),
                name: "Sheet2".to_string(),
                rows: 10,
                cols: 5,
                cells: vec![
                    value_cell(11, 0, 0, 10.0), // A1 = 10
                    value_cell(12, 1, 1, 5.0),  // B2 = 5
                ],
                ranges: vec![],
            },
            SheetSnapshot {
                identities: Vec::new(),
                row_axis: None,
                col_axis: None,
                id: SHEET3_ID.to_string(),
                name: "Sheet3".to_string(),
                rows: 10,
                cols: 5,
                cells: vec![
                    value_cell(21, 0, 0, 100.0), // A1 = 100
                    value_cell(22, 0, 1, 200.0), // B1 = 200
                    value_cell(23, 0, 2, 300.0), // C1 = 300
                ],
                ranges: vec![],
            },
        ],
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

#[test]
fn snapshot_and_xlsx_paths_preserve_native_authored_state() {
    use cell_types::{CellId, SheetId};

    // -----------------------------------------------------------------
    // Path 1: from_snapshot hydration + engine-API mutations (merge,
    // hyperlink, cell format) that the snapshot struct can't express.
    // -----------------------------------------------------------------
    let (mut engine_snap, _) = ComputeEngine::from_snapshot(rich_fixture()).expect("from_snapshot");

    let sheet1 = SheetId::from_uuid_str(SHEET1_ID).expect("sheet1 id");
    let sheet2 = SheetId::from_uuid_str(SHEET2_ID).expect("sheet2 id");
    let sheet3 = SheetId::from_uuid_str(SHEET3_ID).expect("sheet3 id");

    // Sheet1: merge A6:C6 (row=5, cols 0..=2)
    engine_snap
        .merge_range(&sheet1, 5, 0, 5, 2)
        .expect("merge_range A6:C6");

    // Sheet2: hyperlink at A4 (row=3, col=0)
    engine_snap
        .set_hyperlink(&sheet2, 3, 0, "https://example.com")
        .expect("set_hyperlink A4");

    // Sheet3: bold format on A1. Look up the CellId the engine gave A1.
    let a1_hex = engine_snap
        .get_cell_id_at(&sheet3, 0, 0)
        .expect("Sheet3 A1 cell id hex");
    let a1_cell_id =
        CellId::from_raw(u128::from_str_radix(&a1_hex, 16).expect("cell id hex parses"));
    let bold = CellFormat {
        bold: Some(true),
        ..Default::default()
    };
    engine_snap
        .set_cell_format(&sheet3, &a1_cell_id, &bold)
        .expect("set_cell_format A1 bold");

    // -----------------------------------------------------------------
    // Path 2: round-trip the post-mutation engine through XLSX.
    // -----------------------------------------------------------------
    let bytes = engine_snap
        .export_to_xlsx_bytes()
        .expect("export_to_xlsx_bytes");
    let (engine_xlsx, _) = ComputeEngine::from_xlsx_bytes(&bytes).expect("from_xlsx_bytes");

    // -----------------------------------------------------------------
    // Canonicalize both engines and compare the full recursive trees.
    // -----------------------------------------------------------------
    let canon_snap = canonicalize(&engine_snap);
    let canon_xlsx = canonicalize(&engine_xlsx);

    // Sheet set must match first (clearer diagnostic than a tree diff).
    let snap_sheets: Vec<&String> = canon_snap.keys().collect();
    let xlsx_sheets: Vec<&String> = canon_xlsx.keys().collect();
    assert_eq!(
        snap_sheets, xlsx_sheets,
        "sheet set differs between hydration paths"
    );

    // Per-sheet structural comparison — cheaper-to-read failure output
    // than one giant `assert_eq!` when only one sheet diverges.
    for name in canon_snap.keys() {
        let s = canon_snap.get(name).unwrap();
        let x = canon_xlsx.get(name).unwrap();
        assert_eq!(
            s, x,
            "sheet '{}' canonical native state differs between from_snapshot and from_xlsx_bytes paths",
            name
        );
    }

    assert_eq!(canon_snap.len(), 3);
    for sheet in canon_snap.values() {
        assert!(!sheet.cells.is_empty());
    }
    assert_eq!(canon_snap["Sheet1"].merges.len(), 1);
    assert_eq!(canon_snap["Sheet2"].hyperlinks.len(), 1);
    let reloaded_sheet3 = *engine_xlsx
        .mirror()
        .sheet_ids()
        .find(|id| engine_xlsx.mirror().get_sheet(id).unwrap().name == "Sheet3")
        .unwrap();
    let id = engine_xlsx.get_cell_id_at(&reloaded_sheet3, 0, 0).unwrap();
    let id = CellId::from_uuid_str(&id).unwrap();
    assert_eq!(
        engine_xlsx
            .get_cell_format(&reloaded_sheet3, &id, 0, 0)
            .bold,
        Some(true)
    );
}
