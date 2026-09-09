use std::sync::Arc;

use super::{make_sheet_id, seed_cell, set_cell_property};
use crate::storage::YrsStorage;
use crate::storage::infra::grid_helpers::{get_cells_map, get_properties_map};
use cell_types::{IdAllocator, RangePos, SheetId};
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::{KEY_ARRAY_REF, KEY_FORMULA_METADATA};
use value_types::CellValue;
use yrs::{Any, Map, MapPrelim, Out, Transact};

fn storage_with_two_grids() -> (YrsStorage, SheetId, GridIndex, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let source_sheet = make_sheet_id(1);
    let target_sheet = make_sheet_id(2);
    storage
        .add_sheet(&mut mirror, source_sheet, "Source", 100, 26)
        .expect("source sheet should succeed");
    storage
        .add_sheet(&mut mirror, target_sheet, "Target", 100, 26)
        .expect("target sheet should succeed");

    let source_grid = GridIndex::new(source_sheet, 100, 26, Arc::new(IdAllocator::new()));
    let target_grid = GridIndex::new(target_sheet, 100, 26, Arc::new(IdAllocator::new()));
    (
        storage,
        source_sheet,
        source_grid,
        target_sheet,
        target_grid,
    )
}

#[test]
fn cross_sheet_relocate_preserves_structured_cell_metadata_and_properties() {
    let (storage, source_sheet, mut source_grid, target_sheet, mut target_grid) =
        storage_with_two_grids();
    let source_id = seed_cell(
        &storage,
        source_sheet,
        &mut source_grid,
        0,
        0,
        CellValue::Null,
    );
    set_cell_property(&storage, source_sheet, source_id, "{\"s\":7}");

    // These keys cover the imported OOXML formula marker, CSE extent, and a
    // nested structured value.  The relocation implementation must transfer
    // the map as a whole instead of reconstructing only `v`/`f`.
    let source_hex = id_to_hex(source_sheet.as_u128());
    let source_cell_hex = id_to_hex(source_id.as_u128());
    {
        let mut txn = storage.doc().transact_mut();
        let cells_map = get_cells_map(&txn, &storage.sheets_ref(), &source_hex).unwrap();
        let cell_map = match cells_map.get(&txn, &source_cell_hex) {
            Some(Out::YMap(map)) => map,
            _ => panic!("source cell map missing"),
        };
        cell_map.insert(
            &mut txn,
            KEY_FORMULA_METADATA,
            Any::String(Arc::from(r#"{"text":"","t":"normal","ca":true}"#)),
        );
        cell_map.insert(&mut txn, KEY_ARRAY_REF, Any::String(Arc::from("A1:B2")));
        cell_map.insert(
            &mut txn,
            "structured",
            MapPrelim::from([("nested", Any::String(Arc::from("kept")))]),
        );
    }

    let source_range = RangePos::new(source_sheet, 0, 0, 0, 0);
    let result = super::super::relocate_cells(
        storage.doc(),
        storage.sheets(),
        source_sheet,
        &source_range,
        target_sheet,
        4,
        5,
        &mut source_grid,
        Some(&mut target_grid),
    );
    assert!(result.success);
    assert_eq!(result.moved_cell_ids, vec![source_id]);
    assert!(source_grid.cell_id_at(0, 0).is_none());
    assert_eq!(target_grid.cell_id_at(4, 5), Some(source_id));

    let target_hex = id_to_hex(target_sheet.as_u128());
    let txn = storage.doc().transact();
    let source_cells = get_cells_map(&txn, &storage.sheets_ref(), &source_hex).unwrap();
    assert!(source_cells.get(&txn, &source_cell_hex).is_none());
    let target_cells = get_cells_map(&txn, &storage.sheets_ref(), &target_hex).unwrap();
    let target_map = match target_cells.get(&txn, &source_cell_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("moved target cell map missing"),
    };
    assert!(target_map.get(&txn, KEY_FORMULA_METADATA).is_some());
    // The source operation moved one cell while the authored CSE range spans
    // A1:B2.  The range was not moved as a complete unit, so `ar` is cleared
    // instead of replaying stale geometry at E5.
    assert!(target_map.get(&txn, KEY_ARRAY_REF).is_none());
    assert!(matches!(
        target_map.get(&txn, "structured"),
        Some(Out::YMap(_))
    ));

    let target_props = get_properties_map(&txn, &storage.sheets_ref(), &target_hex).unwrap();
    assert!(target_props.get(&txn, &source_cell_hex).is_some());
    let source_props = get_properties_map(&txn, &storage.sheets_ref(), &source_hex).unwrap();
    assert!(source_props.get(&txn, &source_cell_hex).is_none());
}
