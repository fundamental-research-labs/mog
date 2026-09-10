use cell_types::{CellId, SheetPos};
use std::sync::Arc;
use value_types::CellValue;

use crate::cells::types::CellEntry;

use super::helpers::make_store;

#[test]
fn insert_cell_expands_identity_extent() {
    let (mut cell_store, sheet_id) = make_store();
    // Initial: rows=100, cols=10, identity_rows=100, identity_cols=10
    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.identity_rows, 100);
    assert_eq!(sheet.identity_cols, 10);

    // Insert cell beyond current extent
    let cell_id = CellId::from_raw(200);
    cell_store.insert_cell(
        &sheet_id,
        cell_id,
        SheetPos::new(150, 20),
        CellEntry {
            value: CellValue::number(1.0),
        },
    );

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 151);
    assert_eq!(sheet.cols, 21);
    assert_eq!(sheet.identity_rows, 151);
    assert_eq!(sheet.identity_cols, 21);
}

#[test]
fn ensure_cell_id_identity_only_expands_identity_extent() {
    let (mut cell_store, sheet_id) = make_store();
    let id_alloc = cell_types::IdAllocator::new();

    // Use ensure_cell_id_identity_only at a position beyond current extent
    cell_store.ensure_cell_id_identity_only(&sheet_id, SheetPos::new(200, 30), &id_alloc);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    // Data extent should NOT change (identity-only path)
    assert_eq!(sheet.rows, 100);
    assert_eq!(sheet.cols, 10);
    // Identity extent SHOULD expand
    assert_eq!(sheet.identity_rows, 201);
    assert_eq!(sheet.identity_cols, 31);
}

#[test]
fn register_identity_only_does_not_write_column_values() {
    let (mut cell_store, sheet_id) = make_store();
    let cell_id = CellId::from_raw(900);

    // Position beyond row extent (row 200 vs base rows=100); col=5
    // sits inside the base cols=10 so `identity_cols` doesn't grow.
    // What's tested here is "no column_values write" + "identity extent
    // grows on row" + "data extent unchanged".
    cell_store.register_identity_only(&sheet_id, SheetPos::new(200, 5), cell_id);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    // Identity mappings present.
    assert_eq!(
        sheet.authored_cell_id_at(SheetPos::new(200, 5)).as_ref(),
        Some(&cell_id)
    );
    assert_eq!(
        sheet.position_of(&cell_id).as_ref(),
        Some(&SheetPos::new(200, 5))
    );
    assert!(sheet.cells.contains_key(&cell_id));
    // column_values must NOT have been touched at column 5 (no Null write).
    // The original sheet has no column_values for col 5 -> still none.
    assert!(!sheet.get_column_view(5).is_some());
    // Data extent stays put; identity rows extent grows past base 100.
    assert_eq!(sheet.rows, 100);
    assert_eq!(sheet.cols, 10);
    assert_eq!(sheet.identity_rows, 201);
    // col 5 < base cols 10, so identity_cols stays at 10.
    assert_eq!(sheet.identity_cols, 10);
}

#[test]
fn register_identity_only_grows_identity_cols_when_outside_base() {
    // Companion test: when the position's col is past the base
    // sheet's cols, identity_cols grows but data cols does not.
    let (mut cell_store, sheet_id) = make_store();
    let cell_id = CellId::from_raw(901);

    cell_store.register_identity_only(&sheet_id, SheetPos::new(50, 25), cell_id);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.get_column_view(25).is_some());
    // Data cols stays at base 10.
    assert_eq!(sheet.cols, 10);
    // Identity cols grows to 26 (= 25 + 1).
    assert_eq!(sheet.identity_cols, 26);
    // Data rows stays at base 100.
    assert_eq!(sheet.rows, 100);
    // Identity rows stays at base 100 too - row 50 < 100.
    assert_eq!(sheet.identity_rows, 100);
}

#[test]
fn register_identity_only_is_noop_when_cell_already_present() {
    let (mut cell_store, sheet_id) = make_store();
    let real_id = CellId::from_raw(1);
    let pos = SheetPos::new(0, 0);
    cell_store.insert_cell(
        &sheet_id,
        real_id,
        pos,
        CellEntry {
            value: CellValue::number(42.0),
        },
    );

    // Try to register a *different* CellId at the same position. Must be a
    // no-op - the existing real cell wins.
    let phantom = CellId::from_raw(999);
    cell_store.register_identity_only(&sheet_id, pos, phantom);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.authored_cell_id_at(pos).as_ref(), Some(&real_id));
    // Phantom must not have been registered.
    assert!(!sheet.cells.contains_key(&phantom));
}

#[test]
fn register_ghost_cell_writes_null_into_column_values_outside_projections() {
    // Lock in the *contrast* with register_identity_only: the existing
    // register_ghost_cell path still writes Null into column_values when no
    // projection covers the position. This is correct for the parallel-
    // init path (positions back real XLSX data) but wrong for filter
    // corners - that's exactly why register_identity_only exists.
    let (mut cell_store, sheet_id) = make_store();
    let cell_id = CellId::from_raw(123);
    let pos = SheetPos::new(50, 7);

    cell_store.register_ghost_cell(&sheet_id, pos, cell_id);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert!(sheet.get_column_view(7).is_some());
    assert_eq!(sheet.get_column_view(7).unwrap()[50], CellValue::Null);
}

#[test]
fn register_ghost_cell_preserves_projected_column_values() {
    let (mut cell_store, sheet_id) = make_store();
    let source_id = CellId::from_raw(124);
    cell_store
        .projection_registry
        .register(source_id, sheet_id, 1, 1, 2, 2);
    cell_store.materialize_projection(
        &sheet_id,
        1,
        1,
        &CellValue::Array(Arc::new(value_types::CellArray::from_rows(vec![
            vec![CellValue::from("origin"), CellValue::from("right")],
            vec![CellValue::from("down"), CellValue::from("diag")],
        ]))),
    );

    cell_store.register_ghost_cell(&sheet_id, SheetPos::new(2, 2), CellId::from_raw(125));

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(
        sheet.get_column_view(2).unwrap()[2],
        CellValue::from("diag")
    );
}

#[test]
fn ensure_cell_id_preserves_projected_column_values() {
    let (mut cell_store, sheet_id) = make_store();
    let source_id = CellId::from_raw(126);
    cell_store
        .projection_registry
        .register(source_id, sheet_id, 3, 3, 1, 2);
    cell_store.materialize_projection(
        &sheet_id,
        3,
        3,
        &CellValue::Array(Arc::new(value_types::CellArray::from_rows(vec![vec![
            CellValue::from("origin"),
            CellValue::from("right"),
        ]]))),
    );
    let id_alloc = cell_types::IdAllocator::new();

    cell_store.ensure_cell_id(&sheet_id, SheetPos::new(3, 4), &id_alloc);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(
        sheet.get_column_view(4).unwrap()[3],
        CellValue::from("right")
    );
}
