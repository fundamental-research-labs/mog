use std::sync::Arc;

use super::super::*;
use super::fixtures::*;
use crate::storage::infra::grid_helpers::{get_cells_map, get_properties_map};
use compute_document::hex::id_to_hex;
use compute_document::schema::{KEY_ARRAY_REF, KEY_FORMULA_METADATA};
use value_types::CellValue;
use yrs::{Any, Map, MapPrelim, Out, Transact};

fn put_marker(
    storage: &crate::storage::YrsStorage,
    sheet_id: cell_types::SheetId,
    cell_id: cell_types::CellId,
    formula_metadata: &str,
    array_ref: Option<&str>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let mut txn = storage.doc().transact_mut();
    let cells = get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    let cell = match cells.get(&txn, &cell_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("cell map missing"),
    };
    cell.insert(
        &mut txn,
        KEY_FORMULA_METADATA,
        Any::String(Arc::from(formula_metadata)),
    );
    if let Some(array_ref) = array_ref {
        cell.insert(&mut txn, KEY_ARRAY_REF, Any::String(Arc::from(array_ref)));
    }
}

fn cell_map_at<'a, T: yrs::ReadTxn>(
    txn: &'a T,
    storage: &'a crate::storage::YrsStorage,
    sheet_id: cell_types::SheetId,
    cell_id: cell_types::CellId,
) -> yrs::MapRef {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let cell_hex = id_to_hex(cell_id.as_u128());
    let cells = get_cells_map(txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    match cells.get(txn, &cell_hex) {
        Some(Out::YMap(map)) => map,
        _ => panic!("cell map missing"),
    }
}

#[test]
fn remove_duplicates_moves_full_cell_metadata_and_replaces_stale_target() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    let target_id = seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));
    let source_id = seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("C".into()));

    // Row 1 is the existing compaction target. Its marker must not survive
    // when row 2 is copied over it.
    put_marker(
        &storage,
        sid,
        target_id,
        r#"{"t":"normal","text":"stale-target"}"#,
        None,
    );
    put_marker(
        &storage,
        sid,
        source_id,
        r#"{"t":"normal","text":"","ca":true}"#,
        Some("A3:B3"),
    );

    let sheet_hex = id_to_hex(sid.as_u128());
    let source_hex = id_to_hex(source_id.as_u128());
    let target_hex = id_to_hex(target_id.as_u128());
    {
        let mut txn = storage.doc().transact_mut();
        let props = get_properties_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
        props.insert(
            &mut txn,
            target_hex.as_str(),
            Any::String(Arc::from(r#"{"style_id":99}"#)),
        );
        props.insert(
            &mut txn,
            source_hex.as_str(),
            MapPrelim::from([("style_id", Any::Number(7.0))]),
        );
    }

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );
    assert_eq!(result.duplicates_removed, 1);
    assert_eq!(grid.cell_id_at(1, 0), Some(target_id));
    assert!(grid.cell_id_at(2, 0).is_none());

    let txn = storage.doc().transact();
    let target = cell_map_at(&txn, &storage, sid, target_id);
    let source_marker =
        match cell_map_at(&txn, &storage, sid, target_id).get(&txn, KEY_FORMULA_METADATA) {
            Some(Out::Any(Any::String(value))) => value.to_string(),
            other => panic!("formula metadata missing after compaction: {other:?}"),
        };
    assert!(source_marker.contains("ca"));
    assert_eq!(
        target
            .get(&txn, KEY_ARRAY_REF)
            .and_then(|value| match value {
                Out::Any(Any::String(value)) => Some(value.to_string()),
                _ => None,
            })
            .as_deref(),
        None
    );
    let props = get_properties_map(&txn, &storage.sheets_ref(), &sheet_hex).unwrap();
    assert!(props.get(&txn, source_hex.as_str()).is_none());
    assert!(matches!(
        props.get(&txn, target_hex.as_str()),
        Some(Out::YMap(_))
    ));
    assert!(
        get_cells_map(&txn, &storage.sheets_ref(), &sheet_hex)
            .unwrap()
            .get(&txn, source_hex.as_str())
            .is_none()
    );
}

#[test]
fn remove_duplicates_invalidates_coordinate_formula_markers_on_compaction() {
    let (storage, sid, mut grid) = storage_with_sheet();
    seed_cell(&storage, &mut grid, sid, 0, 0, CellValue::Text("A".into()));
    let _duplicate_id = seed_cell(&storage, &mut grid, sid, 1, 0, CellValue::Text("A".into()));
    let source_id = seed_cell(&storage, &mut grid, sid, 2, 0, CellValue::Text("B".into()));

    // These are intentionally coordinate-bearing imported markers. A row
    // compaction does not prove that the complete shared/array range moved,
    // so the executable marker and CSE extent must not be copied to the new
    // coordinate. The formula/body itself remains cell-owned and is still
    // available for ordinary recalculation.
    put_marker(
        &storage,
        sid,
        source_id,
        r#"{"text":"SUM(A1)","t":"shared","si":8,"ref":"A3:A3","aca":false,"dt2d":false,"del1":false,"del2":false,"ca":false,"bx":false,"dtr":false}"#,
        Some("A3:A3"),
    );

    let result = remove_duplicates(
        storage.doc(),
        &storage.sheets_ref(),
        sid,
        &mut grid,
        0,
        0,
        2,
        0,
        &RemoveDuplicatesOptions {
            has_headers: false,
            columns_to_compare: vec![],
            case_sensitive: true,
        },
    );
    assert_eq!(result.duplicates_removed, 1);

    let destination_id = grid.cell_id_at(1, 0).unwrap();
    let txn = storage.doc().transact();
    let destination = cell_map_at(&txn, &storage, sid, destination_id);
    assert!(destination.get(&txn, KEY_FORMULA_METADATA).is_none());
    assert!(destination.get(&txn, KEY_ARRAY_REF).is_none());
}
