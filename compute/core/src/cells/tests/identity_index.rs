use super::super::test_helpers::fresh_store_with_sheet;
use crate::cells::{CellEntry, CellStore, SheetStore};
use cell_types::{CellId, SheetId, SheetPos};
use formula_types::{IdentityFormula, StructureChange};
use value_types::CellValue;

fn assert_bijection(store: &CellStore, sheet: SheetId) {
    let source = store.get_sheet(&sheet).unwrap();
    let cells: Vec<_> = source.cells().collect();
    assert_eq!(cells.len(), source.axes_by_cell.len());
    assert_eq!(cells.len(), source.cell_by_axes.len());
    for (cell, row, col) in cells {
        assert_eq!(
            source.authored_cell_id_at(SheetPos::new(row, col)),
            Some(cell)
        );
        assert_eq!(store.resolve_position(&cell), Some(SheetPos::new(row, col)));
        assert_eq!(store.sheet_for_cell(&cell), Some(sheet));
    }
}

#[test]
fn identities_survive_mixed_axis_mutations_and_keep_sparse_axis_keys() {
    let (mut store, sheet) = fresh_store_with_sheet(5, 5);
    let mut ids = Vec::new();
    for row in 0..5 {
        ids.push(
            store
                .ensure_identity_at(&sheet, SheetPos::new(row, row))
                .unwrap(),
        );
    }
    let bindings = store.get_sheet(&sheet).unwrap().axes_by_cell.clone();
    let new_row = store.id_alloc.next_row_id();
    store.apply_structure_change(
        &sheet,
        &StructureChange::InsertRows {
            at: 2,
            count: 1,
            new_row_ids: vec![new_row],
        },
    );
    assert_eq!(store.get_sheet(&sheet).unwrap().axes_by_cell, bindings);
    assert_bijection(&store, sheet);
    assert_eq!(store.resolve_position(&ids[4]), Some(SheetPos::new(5, 4)));

    let deleted = store.cells_in_row_range(&sheet, 0, 1);
    assert_eq!(deleted, vec![(ids[0], 0, 0)]);
    store.apply_structure_change(
        &sheet,
        &StructureChange::DeleteRows {
            at: 0,
            count: 1,
            deleted_cell_ids: deleted.iter().map(|(id, _, _)| *id).collect(),
        },
    );
    assert_bijection(&store, sheet);
    let new_col = store.id_alloc.next_col_id();
    store.apply_structure_change(
        &sheet,
        &StructureChange::InsertCols {
            at: 1,
            count: 1,
            new_col_ids: vec![new_col],
        },
    );
    assert_bijection(&store, sheet);
    assert_eq!(store.resolve_position(&ids[4]), Some(SheetPos::new(4, 5)));
    let deleted = store.cells_in_col_range(&sheet, 2, 1);
    store.apply_structure_change(
        &sheet,
        &StructureChange::DeleteCols {
            at: 2,
            count: 1,
            deleted_cell_ids: deleted.iter().map(|(id, _, _)| *id).collect(),
        },
    );
    assert_bijection(&store, sheet);
    assert_eq!(store.resolve_position(&ids[4]), Some(SheetPos::new(4, 4)));
    let replacement = store
        .ensure_identity_at(&sheet, SheetPos::new(0, 0))
        .unwrap();
    assert!(!ids.contains(&replacement));
    assert_bijection(&store, sheet);
}

#[test]
fn sparse_queries_and_relocation_use_the_same_identity_owner() {
    let (mut store, sheet) = fresh_store_with_sheet(1, 1);
    let a = store
        .ensure_identity_at(&sheet, SheetPos::new(3, 4))
        .unwrap();
    let b = store
        .ensure_identity_at(&sheet, SheetPos::new(7, 8))
        .unwrap();
    assert_eq!(
        store.ensure_identity_at(&sheet, SheetPos::new(3, 4)),
        Some(a)
    );
    assert_eq!(
        store.cells_in_range(&sheet, 3, 4, 7, 7).collect::<Vec<_>>(),
        vec![(a, 3, 4)]
    );
    let row_id = store.get_sheet(&sheet).unwrap().row_id_at(7).unwrap();
    let col_id = store.get_sheet(&sheet).unwrap().col_id_at(8).unwrap();
    assert_eq!(store.row_index_lookup(&row_id), Some((sheet, 7)));
    assert_eq!(store.col_index_lookup(&col_id), Some((sheet, 8)));
    store.apply_structure_change(
        &sheet,
        &StructureChange::RemapPositions {
            updates: vec![(a, 7, 8), (b, 3, 4)],
        },
    );
    assert_eq!(store.resolve_position(&a), Some(SheetPos::new(7, 8)));
    assert_eq!(store.resolve_position(&b), Some(SheetPos::new(3, 4)));
    assert_bijection(&store, sheet);
    store.remove_cell(&a);
    assert_bijection(&store, sheet);
    assert_eq!(store.cells(&sheet).collect::<Vec<_>>(), vec![(b, 3, 4)]);
}

#[test]
fn formula_sidecar_moves_across_sheets_and_value_replacement_clears_it() {
    let (mut store, source) = fresh_store_with_sheet(2, 2);
    let destination = SheetId::from_raw(2);
    store.add_sheet_store(
        destination,
        "Destination".into(),
        SheetStore::new(destination, "Destination".into(), 2, 2),
    );
    let formula = IdentityFormula {
        template: "1".into(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    let cell = CellId::from_raw(100);
    store.apply_edit(
        &source,
        cell,
        SheetPos::new(0, 0),
        CellValue::number(1.0),
        Some(formula.clone()),
    );
    assert!(store.move_cell(&cell, &destination, SheetPos::new(1, 1)));
    assert_eq!(store.get_formula(&cell), Some(&formula));
    assert_eq!(store.get_cell_value(&cell), Some(&CellValue::number(1.0)));
    assert_bijection(&store, source);
    assert_bijection(&store, destination);
    store.insert_cell(
        &destination,
        cell,
        SheetPos::new(1, 1),
        CellEntry {
            value: CellValue::number(9.0),
        },
    );
    assert_eq!(store.get_formula(&cell), None);
    assert_eq!(store.get_cell_value(&cell), Some(&CellValue::number(9.0)));
}

#[test]
fn imported_id_replacement_and_subsequent_allocation_preserve_bijection() {
    let (mut store, sheet) = fresh_store_with_sheet(1, 1);
    let old = store
        .ensure_identity_at(&sheet, SheetPos::new(0, 0))
        .unwrap();
    let imported = CellId::from_raw(10_000);
    store.insert_cell(
        &sheet,
        imported,
        SheetPos::new(0, 0),
        CellEntry {
            value: CellValue::number(2.0),
        },
    );
    let fresh = store
        .ensure_identity_at(&sheet, SheetPos::new(0, 1))
        .unwrap();
    assert!(fresh.as_u128() > imported.as_u128());
    assert_eq!(store.resolve_position(&old), None);
    assert_eq!(store.sheet_for_cell(&old), None);
    assert_bijection(&store, sheet);
}

#[test]
fn overlapping_batch_move_keeps_every_value_and_formula() {
    let (mut store, sheet) = fresh_store_with_sheet(2, 2);
    let a = CellId::from_raw(101);
    let b = CellId::from_raw(102);
    let formula = IdentityFormula {
        template: "1".into(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    store.apply_edit(
        &sheet,
        a,
        SheetPos::new(0, 0),
        CellValue::number(1.0),
        Some(formula.clone()),
    );
    store.apply_edit(&sheet, b, SheetPos::new(0, 1), CellValue::number(2.0), None);
    store.move_cells(&[
        (a, sheet, SheetPos::new(0, 1)),
        (b, sheet, SheetPos::new(0, 0)),
    ]);
    assert_eq!(
        store.get_cell_value_at(&sheet, SheetPos::new(0, 0)),
        Some(&CellValue::number(2.0))
    );
    assert_eq!(
        store.get_cell_value_at(&sheet, SheetPos::new(0, 1)),
        Some(&CellValue::number(1.0))
    );
    assert_eq!(store.get_formula(&a), Some(&formula));
    assert_bijection(&store, sheet);
}

#[test]
fn metadata_only_moves_and_remaps_replace_target_identity_and_value() {
    for remap in [false, true] {
        let (mut store, sheet) = fresh_store_with_sheet(1, 2);
        let anchor = store
            .ensure_identity_at(&sheet, SheetPos::new(0, 0))
            .unwrap();
        let target = CellId::from_raw(100);
        store.apply_edit(
            &sheet,
            target,
            SheetPos::new(0, 1),
            CellValue::number(9.0),
            None,
        );
        if remap {
            store.apply_structure_change(
                &sheet,
                &StructureChange::RemapPositions {
                    updates: vec![(anchor, 0, 1)],
                },
            );
        } else {
            assert!(store.move_cell(&anchor, &sheet, SheetPos::new(0, 1)));
        }
        assert_eq!(
            store.resolve_cell_id(&sheet, SheetPos::new(0, 1)),
            Some(anchor)
        );
        assert_eq!(store.get_cell_value(&target), None);
        assert_eq!(store.sheet_for_cell(&target), None);
        assert_bijection(&store, sheet);
    }
}

#[test]
fn sharing_an_allocator_retains_deleted_identity_and_axis_history() {
    let (mut store, sheet) = fresh_store_with_sheet(1, 1);
    let removed = store
        .ensure_identity_at(&sheet, SheetPos::new(0, 0))
        .unwrap();
    store.remove_cell(&removed);
    let unused_run = store.id_alloc.next_axis_run(3).run_id;
    let allocator = std::sync::Arc::new(cell_types::IdAllocator::new());
    store.set_id_alloc(allocator.clone());
    let fresh = store
        .ensure_identity_at(&sheet, SheetPos::new(0, 0))
        .unwrap();
    assert!(fresh.as_u128() > removed.as_u128());
    assert!(allocator.next_axis_run(3).run_id.as_u64() > unused_run.as_u64());
}
