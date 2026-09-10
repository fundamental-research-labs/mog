//! Shared test helpers for storage engine tests.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot};
use domain_types::ParseOutput;
use value_types::{CellValue, FiniteF64};

// -------------------------------------------------------------------
// Snapshot Builders
// -------------------------------------------------------------------

pub(super) fn num(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

pub(super) fn cell_value_at(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellValue {
    engine
        .cell_store()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

pub(super) fn empty_bulk_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Build a simple snapshot with one sheet and a few cells.
pub(super) fn simple_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(20.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub(super) fn sheet_id() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
}

pub(super) fn cell_id_a1() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap()
}

pub(super) fn cell_id_b1() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").unwrap()
}

pub(super) fn cell_id_a2() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap()
}

pub(super) fn assemble_engine_from_parse_output_storage(
    storage: crate::storage::WorkbookStorage,
    workbook_snap: WorkbookSnapshot,
) -> ComputeEngine {
    let mut cell_store =
        crate::cells::CellStore::from_snapshot(workbook_snap.clone()).expect("cell_store");
    let mut compute = crate::scheduler::ComputeCore::new();
    compute
        .init_from_snapshot_no_recalc(&mut cell_store, workbook_snap.clone())
        .expect("compute init");
    super::super::construction::assemble_engine(storage, cell_store, compute, &workbook_snap)
        .expect("assemble engine")
}

pub(super) fn engine_from_parse_output_normal(output: &ParseOutput) -> ComputeEngine {
    let mut allocator = crate::storage::infra::hydration::DefaultIdAllocator::new();
    let mut storage = crate::storage::WorkbookStorage::new();
    let id_map = storage
        .hydrate_from_parse_output(output, &mut allocator)
        .expect("hydrate parse output");
    let workbook_snap = crate::import::parse_output_to_snapshot::parse_output_to_workbook_snapshot(
        output,
        Some(&id_map),
        &mut allocator,
    );

    let formats =
        super::super::construction::collect_imported_formats(output, &id_map.sheet_ids, &[]);
    let mut engine = assemble_engine_from_parse_output_storage(storage, workbook_snap);
    super::super::construction::install_imported_formats(
        &mut engine.cell_store,
        &engine.stores.storage.metadata.style_palette,
        &formats,
    );
    engine
}

pub(super) fn archive_text(bytes: &[u8], path: &str) -> Option<String> {
    let archive =
        xlsx_parser::zip::XlsxArchive::new(bytes).expect("exported XLSX should be readable");
    archive
        .read_file(path)
        .ok()
        .map(|bytes| String::from_utf8(bytes).expect("XML part should be UTF-8"))
}

// -------------------------------------------------------------------
// CopyRange snapshot builder
// -------------------------------------------------------------------

/// Snapshot with values A1=10, B1=20, A2=30, B2=40 and formula C1=A1+B1 (=30).
pub(super) fn copy_range_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(20.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(30.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440005".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(40.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Reconstruct runtime calculation state from the native snapshot and metadata.
/// Native storage owns imported workbook/cell metadata; the snapshot owns cells,
/// formulas and stable identities. Both participate in an engine rebuild.
pub(super) fn rebuild_native_engine(source: &ComputeEngine) -> ComputeEngine {
    let snapshot = construction::build_workbook_snapshot(&source.stores, &source.cell_store);
    let (mut rebuilt, _) = ComputeEngine::from_snapshot(snapshot).expect("native snapshot");
    rebuilt.stores.storage = source.stores.storage.clone();
    rebuilt
        .rebuild_compute_core()
        .expect("native metadata rebuild");
    rebuilt
}
