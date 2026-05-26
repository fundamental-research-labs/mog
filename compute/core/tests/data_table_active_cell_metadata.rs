//! Stream D3 — `get_active_cell` populates `metadata.region` for Data
//! Table cells.
//!
//! `RegionMeta` is the unified region-membership shape on the wire:
//! `{ kind, is_anchor, anchor_row, anchor_col, bounds }`. For Data
//! Tables, `kind = DataTable`, and `bounds` describes the region
//! rectangle (rows × cols). Back-compat flags (`is_array_formula`,
//! `is_cse_anchor`, `is_array_member`) are derived from `region`.
//!
//! **No `source` field on `RegionMeta`.** Formula text stays on
//! `cellData.formula`.
//!
//! Run:
//!   cargo test -p compute-core --test data_table_active_cell_metadata

use compute_core::storage::engine::YrsComputeEngine;
use formula_types::CellRef;
use snapshot_types::properties::{CellMetadata, RegionKind, RegionMeta};
use snapshot_types::{CellData, DataTableRegionDef, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

// ---------------------------------------------------------------------------
// Fixed UUIDs — simple (no-dash) format matches XLSX importer output and
// the runtime `to_uuid_string()` lookup in `region_at`.
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

fn data_table_workbook() -> WorkbookSnapshot {
    let cells = vec![
        number_cell(1, 0, 0, 2.0), // A1
        number_cell(2, 1, 0, 3.0), // A2
        number_cell(3, 0, 1, 5.0), // B1
        number_cell(4, 0, 2, 7.0), // C1
        // B2 master — cached value only. The Data Table region owns the
        // formula text; readback must synthesize it from DataTableRegionDef.
        CellData {
            cell_id: cell_uuid(5),
            row: 1,
            col: 1,
            value: CellValue::Number(FiniteF64::must(0.0)),
            formula: None,
            identity_formula: None,
            array_ref: None,
        },
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

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let region = DataTableRegionDef {
        sheet: SHEET_UUID.to_string(),
        start_row: 1,
        start_col: 1,
        end_row: 2,
        end_col: 2,
        row_input_ref: Some(CellRef::Positional {
            sheet: sheet_id,
            row: 1,
            col: 0,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: sheet_id,
            row: 0,
            col: 0,
        }),
        ooxml_flags: None,
    };

    WorkbookSnapshot {
        sheets: vec![sheet],
        data_table_regions: vec![region],
        ..Default::default()
    }
}

fn parse_metadata(active: &compute_core::snapshot::ActiveCellData) -> CellMetadata {
    serde_json::from_value(
        active
            .metadata
            .as_ref()
            .expect("metadata must be populated for region cells")
            .clone(),
    )
    .expect("metadata must deserialize into CellMetadata")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn data_table_master_active_cell_metadata_has_region_anchor() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let b2_id = cell_types::CellId::from_uuid_str(&cell_uuid(5)).unwrap();

    let active = engine.get_active_cell(&sheet_id, &b2_id);
    let meta = parse_metadata(&active);

    let region = meta.region.expect(
        "Data Table master must surface `region` in active-cell metadata; \
         get_active_cell did not populate region from cell_render_at.",
    );
    assert_eq!(
        region,
        RegionMeta {
            kind: RegionKind::DataTable,
            is_anchor: true,
            anchor_row: 1,
            anchor_col: 1,
            bounds: snapshot_types::properties::RegionBounds { rows: 2, cols: 2 },
        }
    );

    // Back-compat flags: derived from `region`.
    assert!(
        meta.is_array_formula,
        "is_array_formula must follow region.is_some()"
    );
    assert!(
        !meta.is_cse_anchor,
        "is_cse_anchor must be false for DataTable kind"
    );
    assert!(!meta.is_array_member, "master is the anchor, not a member");

    // Source text stays on the existing `formula` field — no `region.source`.
    assert_eq!(
        active.formula.as_deref(),
        Some("=TABLE($A$2,$A$1)"),
        "formula text must live on cellData.formula, not on region.source"
    );
}

#[test]
fn data_table_body_active_cell_metadata_has_region_member() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let c3_id = cell_types::CellId::from_uuid_str(&cell_uuid(8)).unwrap();

    let active = engine.get_active_cell(&sheet_id, &c3_id);
    let meta = parse_metadata(&active);

    let region = meta
        .region
        .expect("body cells must surface region metadata");
    assert_eq!(
        region,
        RegionMeta {
            kind: RegionKind::DataTable,
            is_anchor: false,
            anchor_row: 1,
            anchor_col: 1,
            bounds: snapshot_types::properties::RegionBounds { rows: 2, cols: 2 },
        }
    );
    assert!(meta.is_array_formula);
    assert!(!meta.is_cse_anchor);
    assert!(meta.is_array_member, "body cell must be an array member");

    assert_eq!(
        active.formula.as_deref(),
        Some("=TABLE($A$2,$A$1)"),
        "body cell formula text must be synthesized from DataTableRegionDef"
    );
}

#[test]
fn cell_outside_data_table_has_no_region_metadata() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    let a1_id = cell_types::CellId::from_uuid_str(&cell_uuid(1)).unwrap();

    let active = engine.get_active_cell(&sheet_id, &a1_id);
    // A1 has no region — metadata may be None entirely (empty), or
    // present with region=None. Both shapes satisfy the contract:
    // back-compat flags must be false.
    if let Some(meta_value) = &active.metadata {
        let meta: CellMetadata =
            serde_json::from_value(meta_value.clone()).expect("metadata deserializes");
        assert!(
            meta.region.is_none(),
            "A1 outside region must have region=None"
        );
        assert!(!meta.is_array_formula);
        assert!(!meta.is_cse_anchor);
        assert!(!meta.is_array_member);
    }
}

#[test]
fn data_table_formula_readback_is_synthesized_across_query_surfaces() {
    let snap = data_table_workbook();
    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");

    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    let raw = engine
        .get_raw_cell_data(&sheet_id, 2, 2, true)
        .expect("C3 raw data");
    assert_eq!(raw.formula.as_deref(), Some("=TABLE($A$2,$A$1)"));

    let info = engine.get_cell_info(&sheet_id, 2, 2).expect("C3 cell info");
    assert_eq!(info.formula.as_deref(), Some("=TABLE($A$2,$A$1)"));

    assert_eq!(engine.get_raw_value(&sheet_id, 2, 2), "=TABLE($A$2,$A$1)");

    let cell_data = engine.get_cell_data(&sheet_id, 2, 2).expect("C3 cell data");
    assert_eq!(
        cell_data.get("formula").and_then(|v| v.as_str()),
        Some("TABLE($A$2,$A$1)"),
        "get_cell_data formula convention omits the leading equals"
    );
}

#[test]
fn data_table_formula_preserves_omitted_one_variable_arguments() {
    let mut row_input_snap = data_table_workbook();
    row_input_snap.data_table_regions[0].col_input_ref = None;
    let (row_engine, _) = YrsComputeEngine::from_snapshot(row_input_snap).expect("row engine");
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();
    assert_eq!(row_engine.get_raw_value(&sheet_id, 2, 2), "=TABLE($A$2,)");

    let mut col_input_snap = data_table_workbook();
    col_input_snap.data_table_regions[0].row_input_ref = None;
    let (col_engine, _) = YrsComputeEngine::from_snapshot(col_input_snap).expect("col engine");
    assert_eq!(col_engine.get_raw_value(&sheet_id, 2, 2), "=TABLE(,$A$1)");
}

#[test]
fn data_table_formula_treats_sheet_zero_positional_refs_as_current_sheet() {
    let mut snap = data_table_workbook();
    snap.data_table_regions[0].row_input_ref = Some(CellRef::Positional {
        sheet: cell_types::SheetId::from_raw(0),
        row: 1,
        col: 0,
    });
    snap.data_table_regions[0].col_input_ref = Some(CellRef::Positional {
        sheet: cell_types::SheetId::from_raw(0),
        row: 0,
        col: 0,
    });

    let (engine, _) = YrsComputeEngine::from_snapshot(snap).expect("engine");
    let sheet_id = cell_types::SheetId::from_uuid_str(SHEET_UUID).unwrap();

    assert_eq!(
        engine.get_raw_value(&sheet_id, 2, 2),
        "=TABLE($A$2,$A$1)",
        "parser-current-sheet sentinel must not render as an empty sheet prefix"
    );
}
