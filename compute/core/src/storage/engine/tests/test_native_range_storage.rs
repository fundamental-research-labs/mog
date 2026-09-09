//! Native range snapshot and structural lifecycle coverage.

use super::super::*;
use crate::snapshot::{RangeData, SheetSnapshot};
use cell_types::{ColId, PayloadEncoding, RangeAnchor, RangeId, RangeKind, RowId, SheetPos};
use snapshot_types::WorkbookSnapshot;
use value_types::{CellValue, FiniteF64};

const SHEET_UUID: &str = "a0000000-0000-4000-8000-000000000001";
const RANGE_UUID: &str = "b0000000-0000-4000-8000-000000000001";

fn fixture_row_id(i: usize) -> RowId {
    RowId::from_raw((i + 1) as u128)
}

fn fixture_col_id(sheet_rows: usize, i: usize) -> ColId {
    ColId::from_raw((sheet_rows + i + 1) as u128)
}

fn test_sheet_id() -> SheetId {
    SheetId::from_uuid_str(SHEET_UUID).unwrap()
}

fn test_range_id() -> RangeId {
    RangeId::from_uuid_str(RANGE_UUID).unwrap()
}

fn range_backed_snapshot() -> WorkbookSnapshot {
    const SHEET_ROWS: usize = 10;
    const SHEET_COLS: usize = 5;
    const RANGE_ROWS: usize = 5;
    const RANGE_COLS: usize = 2;

    let mut payload = Vec::new();
    for row_vals in &[
        [1.0_f64, 10.0],
        [2.0, 20.0],
        [3.0, 30.0],
        [4.0, 40.0],
        [5.0, 50.0],
    ] {
        for &v in row_vals {
            payload.extend_from_slice(&v.to_le_bytes());
        }
    }

    let row_ids: Vec<RowId> = (0..RANGE_ROWS).map(fixture_row_id).collect();
    let col_ids: Vec<ColId> = (0..RANGE_COLS)
        .map(|i| fixture_col_id(SHEET_ROWS, i))
        .collect();

    WorkbookSnapshot {
        axis_run_high_water_mark: None,
        identity_high_water_mark: None,
        canonical_tables: Vec::new(),
        sheets: vec![SheetSnapshot {
            identities: Vec::new(),
            row_axis: None,
            col_axis: None,
            id: SHEET_UUID.to_string(),
            name: "Sheet1".to_string(),
            rows: SHEET_ROWS as u32,
            cols: SHEET_COLS as u32,
            cells: vec![],
            ranges: vec![RangeData {
                range_id: test_range_id(),
                kind: RangeKind::Data,
                anchor: RangeAnchor::Elastic {
                    start_row: row_ids[0],
                    end_row: row_ids[RANGE_ROWS - 1],
                    start_col: col_ids[0],
                    end_col: col_ids[RANGE_COLS - 1],
                },
                encoding: PayloadEncoding::F64Le,
                payload,
                row_axis: None,
                col_axis: None,
                row_ids,
                col_ids,
            }],
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

fn as_f64(val: Option<&CellValue>) -> Option<f64> {
    match val {
        Some(CellValue::Number(n)) => Some(f64::from(*n)),
        _ => None,
    }
}

#[test]
fn native_snapshot_preserves_compact_range_values_after_removed_axes() {
    let (mut engine, _) = ComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();
    engine
        .structure_change(
            &sid,
            &formula_types::StructureChange::DeleteRows {
                at: 1,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    engine
        .structure_change(
            &sid,
            &formula_types::StructureChange::DeleteCols {
                at: 0,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    let snap = construction::build_workbook_snapshot(&engine.stores, &engine.cell_store);
    assert_eq!(snap.sheets[0].ranges[0].row_ids.len(), 4);
    assert_eq!(snap.sheets[0].ranges[0].col_ids.len(), 1);
    let serialized_values = crate::cells::range_view::RangeView::decode_payload(
        snap.sheets[0].ranges[0].encoding,
        &snap.sheets[0].ranges[0].payload,
        4,
    );
    assert_eq!(
        &*serialized_values,
        &[10.0, 30.0, 40.0, 50.0].map(CellValue::from)
    );
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sid = reloaded.cell_store().sheet_by_name("Sheet1").unwrap();
    for (row, expected) in [10.0, 30.0, 40.0, 50.0].into_iter().enumerate() {
        assert_eq!(
            as_f64(
                reloaded
                    .cell_store()
                    .get_cell_value_at(&sid, SheetPos::new(row as u32, 0))
            ),
            Some(expected)
        );
    }
}

#[test]
fn native_data_range_has_no_duplicate_persisted_payload() {
    let (engine, _) = ComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sheet = engine.cell_store().get_sheet(&test_sheet_id()).unwrap();
    assert_eq!(sheet.iter_ranges().count(), 1);
    assert_eq!(
        sheet.cells_iter().count(),
        0,
        "compact values do not materialize authored cell entries"
    );
    assert_eq!(
        as_f64(
            engine
                .cell_store()
                .get_cell_value_at(&test_sheet_id(), SheetPos::new(4, 1))
        ),
        Some(50.0)
    );
}

#[test]
fn compact_csv_constructor_and_replacement_preserve_range_reads_and_edits() {
    fn csv(row_count: u32, multiplier: u32) -> String {
        use std::fmt::Write;

        let mut csv = String::new();
        for row in 1..=row_count {
            writeln!(csv, "{},{}", row * multiplier, row * multiplier * 2).unwrap();
        }
        csv
    }

    fn assert_import_and_edit(engine: &mut ComputeEngine, row_count: u32, multiplier: u32) {
        assert_eq!(engine.cell_store().sheet_count(), 1);
        let sid = *engine.cell_store().sheet_ids().next().unwrap();
        let sheet = engine.cell_store().get_sheet(&sid).unwrap();
        assert!(sheet.iter_ranges().count() > 0);
        assert_eq!(sheet.cells_iter().count(), 0);
        assert!(
            engine
                .cell_store()
                .get_cell_value_at(&sid, SheetPos::new(0, 2))
                .is_none(),
            "replacement must discard the previous workbook's formula"
        );
        for (row, col, expected) in [
            (0, 0, multiplier),
            (0, 1, multiplier * 2),
            (row_count - 1, 0, row_count * multiplier),
            (row_count - 1, 1, row_count * multiplier * 2),
        ] {
            assert_eq!(
                as_f64(
                    engine
                        .cell_store()
                        .get_cell_value_at(&sid, SheetPos::new(row, col))
                ),
                Some(f64::from(expected))
            );
        }

        let last_pos = SheetPos::new(row_count - 1, 0);
        let last_id = engine.cell_store().resolve_cell_id(&sid, last_pos).unwrap();
        engine
            .set_cell_value_parsed(&sid, 0, 2, &format!("=SUM(A1:A{row_count})"))
            .unwrap();
        let sum = row_count * (row_count + 1) / 2 * multiplier;
        assert_eq!(
            as_f64(
                engine
                    .cell_store()
                    .get_cell_value_at(&sid, SheetPos::new(0, 2))
            ),
            Some(f64::from(sum))
        );

        let edited = row_count * multiplier + 100;
        engine
            .set_cell_value_parsed(&sid, row_count - 1, 0, &edited.to_string())
            .unwrap();
        assert_eq!(
            engine.cell_store().resolve_cell_id(&sid, last_pos),
            Some(last_id)
        );
        assert_eq!(
            engine.cell_store().resolve_position(&last_id),
            Some(last_pos)
        );
        assert_eq!(
            as_f64(engine.cell_store().get_cell_value(&last_id)),
            Some(f64::from(edited))
        );
        assert_eq!(
            as_f64(
                engine
                    .cell_store()
                    .get_cell_value_at(&sid, SheetPos::new(0, 2))
            ),
            Some(f64::from(sum + 100))
        );
    }

    let (mut engine, _) =
        ComputeEngine::from_csv_bytes(csv(512, 1).as_bytes(), CsvImportOptions::default()).unwrap();
    assert_import_and_edit(&mut engine, 512, 1);

    engine
        .import_from_csv_bytes(csv(768, 3).as_bytes(), CsvImportOptions::default())
        .unwrap();
    assert_import_and_edit(&mut engine, 768, 3);
}

#[test]
fn copy_native_ranges_and_formulas_owns_distinct_axes_and_edits() {
    let (mut engine, _) = ComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let source = test_sheet_id();
    for (col, formula) in [(2, "=SUM(A1:A5)"), (3, "=SUM(A:A)"), (4, "='Sheet1'!A1")] {
        let id = engine.stores.grid_id_alloc.next_cell_id();
        engine
            .set_cell(&source, id, 0, col, formula.into())
            .unwrap();
    }
    engine.set_row_height(&source, 2, 42.0).unwrap();
    engine.set_col_width(&source, 1, 123.0).unwrap();
    engine.copy_sheet(&source, "Copy").unwrap();
    let copy = engine.cell_store().sheet_by_name("Copy").unwrap();
    assert_eq!(
        engine.get_row_height_query(&copy, 2),
        engine.get_row_height_query(&source, 2)
    );
    assert_eq!(
        engine.get_col_width_query(&copy, 1),
        engine.get_col_width_query(&source, 1)
    );
    let original = engine.cell_store().get_sheet(&source).unwrap();
    let copied = engine.cell_store().get_sheet(&copy).unwrap();
    assert!(
        original
            .row_axis
            .identities_in(original.id, 0, original.row_axis.len())
            .all(|id| copied.row_index_of(&id).is_none())
    );
    assert!(
        original
            .col_axis
            .identities_in(original.id, 0, original.col_axis.len())
            .all(|id| copied.col_index_of(&id).is_none())
    );
    let original_range = original.iter_ranges().next().unwrap().1;
    let copied_range = copied.iter_ranges().next().unwrap().1;
    assert_ne!(original_range.range_id, copied_range.range_id);
    assert!(std::sync::Arc::ptr_eq(
        &original_range.values,
        &copied_range.values
    ));
    let id = engine
        .cell_store()
        .resolve_cell_id(&copy, SheetPos::new(0, 0))
        .unwrap();
    engine.set_cell(&copy, id, 0, 0, "100".into()).unwrap();
    engine.recalculate().unwrap();
    for (sheet, col, expected) in [
        (source, 0, 1.0),
        (source, 2, 15.0),
        (copy, 0, 100.0),
        (copy, 2, 114.0),
        (copy, 3, 114.0),
        (copy, 4, 1.0),
    ] {
        assert_eq!(
            as_f64(
                engine
                    .cell_store()
                    .get_cell_value_at(&sheet, SheetPos::new(0, col))
            ),
            Some(expected),
            "sheet {sheet:?} column {col}"
        );
    }
    let original = engine
        .cell_store()
        .get_sheet(&source)
        .unwrap()
        .iter_ranges()
        .next()
        .unwrap()
        .1;
    assert_eq!(original.values[0], CellValue::from(1.0));
}

#[test]
fn native_snapshot_preserves_identity_only_range_positions_without_blank_overrides() {
    let (engine, _) = ComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let sid = test_sheet_id();
    let source = engine.cell_store.get_sheet(&sid).unwrap();
    assert_eq!(source.cells_iter().count(), 0);
    let row = source.row_id_at(0).unwrap();
    let col = source.col_id_at(0).unwrap();
    let snapshot = construction::build_workbook_snapshot(&engine.stores, &engine.cell_store);
    assert!(snapshot.sheets[0].cells.is_empty());
    assert!(!snapshot.sheets[0].identities.is_empty());
    let bytes = serde_json::to_vec(&snapshot).unwrap();
    let decoded = serde_json::from_slice(&bytes).unwrap();
    let (restored, _) = ComputeEngine::from_snapshot(decoded).unwrap();
    let sheet = restored.cell_store.get_sheet(&sid).unwrap();
    assert_eq!(sheet.cells_iter().count(), 0);
    assert_eq!(sheet.row_id_at(0), Some(row));
    assert_eq!(sheet.col_id_at(0), Some(col));
    assert_eq!(as_f64(sheet.value_at(SheetPos::new(0, 0))), Some(1.0));
    let grid = &restored.stores.grid_indexes[&sid];
    assert!(std::sync::Arc::ptr_eq(&sheet.row_axis, &grid.row_axis()));
    assert!(std::sync::Arc::ptr_eq(&sheet.col_axis, &grid.col_axis()));
}

#[test]
fn native_snapshot_does_not_reuse_deleted_axis_runs_or_cells() {
    let sid = test_sheet_id();
    let mut snapshot = range_backed_snapshot();
    snapshot.sheets[0].ranges.clear();
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    engine
        .structure_change(
            &sid,
            &formula_types::StructureChange::InsertRows {
                at: 1,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    let deleted_row = engine.stores.grid_indexes[&sid].row_id(1).unwrap();
    let deleted_cell = engine.stores.grid_id_alloc.next_cell_id();
    engine
        .set_cell(&sid, deleted_cell, 1, 0, "7".into())
        .unwrap();
    engine
        .structure_change(
            &sid,
            &formula_types::StructureChange::DeleteRows {
                at: 1,
                count: 1,
                deleted_cell_ids: Vec::new(),
            },
        )
        .unwrap();
    let snapshot = construction::build_workbook_snapshot(&engine.stores, &engine.cell_store);
    let counter = snapshot.identity_high_water_mark.unwrap();
    let run_counter = snapshot.axis_run_high_water_mark.unwrap();
    assert!(counter > deleted_cell.as_u128() as u64);
    assert!(run_counter > deleted_row.compact_axis_identity().unwrap().run_id.as_u64());
    let (mut restored, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    restored
        .structure_change(
            &sid,
            &formula_types::StructureChange::InsertRows {
                at: 1,
                count: 1,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    assert_ne!(
        restored.stores.grid_indexes[&sid].row_id(1),
        Some(deleted_row)
    );
    assert_ne!(restored.stores.grid_id_alloc.next_cell_id(), deleted_cell);
    assert_eq!(restored.cell_store.row_index_lookup(&deleted_row), None);
}

#[test]
fn metadata_only_growth_shares_native_axes_and_remains_value_sparse() {
    let sid = test_sheet_id();
    let (mut engine, _) = ComputeEngine::from_snapshot(range_backed_snapshot()).unwrap();
    let cell_id = services::cell_editing::ensure_cell_id(
        &mut engine.stores,
        &mut engine.cell_store,
        &sid,
        100_000,
        15,
    )
    .unwrap();
    let grid = &engine.stores.grid_indexes[&sid];
    let row_id = grid.row_id(100_000).unwrap();
    let col_id = grid.col_id(15).unwrap();
    let sheet = engine.cell_store.get_sheet(&sid).unwrap();
    assert!(std::sync::Arc::ptr_eq(&sheet.row_axis, &grid.row_axis()));
    assert!(std::sync::Arc::ptr_eq(&sheet.col_axis, &grid.col_axis()));
    assert_eq!(
        engine.cell_store.row_index_lookup(&row_id),
        Some((sid, 100_000))
    );
    assert_eq!(engine.cell_store.col_index_lookup(&col_id), Some((sid, 15)));
    assert_eq!(sheet.cells_iter().count(), 0);
    assert_eq!(
        sheet.position_of(&cell_id),
        Some(SheetPos::new(100_000, 15))
    );

    let snapshot = construction::build_workbook_snapshot(&engine.stores, &engine.cell_store);
    assert!(snapshot.sheets[0].cells.is_empty());
    let (restored, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    assert_eq!(
        restored.cell_store.row_index_lookup(&row_id),
        Some((sid, 100_000))
    );
    assert_eq!(
        restored.cell_store.col_index_lookup(&col_id),
        Some((sid, 15))
    );
    assert_eq!(
        as_f64(
            restored
                .cell_store
                .get_cell_value_at(&sid, SheetPos::new(0, 0))
        ),
        Some(1.0)
    );
}

#[test]
fn sparse_million_row_import_keeps_shared_compact_axes_and_snapshot_identities() {
    use cell_types::AxisIdentityStore;
    let mut engine = super::helpers::engine_from_parse_output_normal(&domain_types::ParseOutput {
        sheets: vec![domain_types::SheetData {
            name: "Sparse".into(),
            rows: 1_000_000,
            cols: 16_384,
            cells: vec![domain_types::CellData {
                row: 999_999,
                col: 16_383,
                value: CellValue::from(7.0),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    });
    let sid = engine.cell_store().sheet_by_name("Sparse").unwrap();
    let grid = &engine.stores.grid_indexes[&sid];
    let sheet = engine.cell_store().get_sheet(&sid).unwrap();
    assert!(std::sync::Arc::ptr_eq(&sheet.row_axis, &grid.row_axis()));
    assert!(std::sync::Arc::ptr_eq(&sheet.col_axis, &grid.col_axis()));
    let AxisIdentityStore::Runs(rows) = sheet.row_axis.store() else {
        panic!("expanded row identities");
    };
    let AxisIdentityStore::Runs(cols) = sheet.col_axis.store() else {
        panic!("expanded column identities");
    };
    assert_eq!(rows.segments().len(), 1);
    assert_eq!(cols.segments().len(), 1);
    assert_eq!(sheet.cells_iter().count(), 1);
    assert_eq!(sheet.cells().count(), 1);
    let last_row = sheet.row_axis.identity_at(sid, 999_999).unwrap();
    let snapshot = construction::build_workbook_snapshot(&engine.stores, &engine.cell_store);
    assert!(serde_json::to_vec(&snapshot).unwrap().len() < 10_000);
    let (restored, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    assert_eq!(
        restored
            .cell_store()
            .get_sheet(&sid)
            .unwrap()
            .row_axis
            .identity_at(sid, 999_999),
        Some(last_row)
    );
    engine
        .structure_change(
            &sid,
            &formula_types::StructureChange::InsertRows {
                at: 1,
                count: 2,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    let sheet = engine.cell_store().get_sheet(&sid).unwrap();
    assert_eq!(sheet.row_axis.position_of(sid, last_row), Some(1_000_001));
    let AxisIdentityStore::Runs(rows) = sheet.row_axis.store() else {
        panic!("expanded rows after insertion");
    };
    assert_eq!(rows.segments().len(), 3);
    assert_eq!(
        engine
            .cell_store()
            .get_cell_value_at(&sid, SheetPos::new(1_000_001, 16_383)),
        Some(&CellValue::from(7.0))
    );
}

#[test]
fn explicit_snapshot_axes_reserve_embedded_compact_runs_before_growth() {
    use cell_types::{AxisIdentitySeed, AxisIdentityStore, AxisRunId};
    let sid = test_sheet_id();
    let first = RowId::derive_compact(
        sid,
        AxisRunId::from_raw(81),
        AxisIdentitySeed::from_raw(0),
        0,
    );
    let second = RowId::derive_compact(
        sid,
        AxisRunId::from_raw(81),
        AxisIdentitySeed::from_raw(0),
        1,
    );
    let snapshot = WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sid.to_uuid_string(),
            name: "Explicit".into(),
            rows: 2,
            cols: 1,
            row_axis: Some(AxisIdentityStore::Explicit(vec![first, second])),
            col_axis: Some(AxisIdentityStore::Explicit(vec![ColId::from_raw(82)])),
            cells: Vec::new(),
            ranges: Vec::new(),
            identities: Vec::new(),
        }],
        ..Default::default()
    };
    assert_eq!(snapshot.next_axis_run_counter(), 82);
    let (mut engine, _) = ComputeEngine::from_snapshot(snapshot).unwrap();
    engine
        .structure_change(
            &sid,
            &formula_types::StructureChange::InsertRows {
                at: 0,
                count: 2,
                new_row_ids: Vec::new(),
            },
        )
        .unwrap();
    let sheet = engine.cell_store().get_sheet(&sid).unwrap();
    assert_eq!(sheet.row_axis.position_of(sid, first), Some(2));
    assert_eq!(sheet.row_axis.position_of(sid, second), Some(3));
    let inserted = sheet.row_axis.identity_at(sid, 0).unwrap();
    assert_ne!(inserted, first);
    assert_ne!(inserted, second);
    assert!(engine.stores.grid_id_alloc.next_axis_run(2).run_id.as_u64() > 81);
}
