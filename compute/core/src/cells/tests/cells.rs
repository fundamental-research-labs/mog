use crate::cells::test_helpers::{make_cell_id, make_sheet_id, store_with_grid};
use crate::cells::{CellEdit, CellEntry, CellStore};
use cell_types::SheetPos;
use value_types::{CellValue, FiniteF64};

#[test]
fn test_get_cell_value_across_sheets() {
    let (cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(100); // row=0, col=0
    let val = cell_store.get_cell_value(&cell_id).unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(0.0)));
}
#[test]
fn test_get_cell_value_in_sheet() {
    let (cell_store, sheet_id) = store_with_grid();
    let cell_id = make_cell_id(111); // row=1, col=1
    let val = cell_store
        .get_cell_value_in_sheet(&sheet_id, &cell_id)
        .unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(11.0)));
}
#[test]
fn test_get_cell_value_nonexistent() {
    let (cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(999);
    assert!(cell_store.get_cell_value(&cell_id).is_none());
}
#[test]
fn test_set_value_mut() {
    let (mut cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(100);
    assert!(cell_store.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(999.0))));
    assert_eq!(
        *cell_store.get_cell_value(&cell_id).unwrap(),
        CellValue::Number(FiniteF64::must(999.0))
    );
}
#[test]
fn test_set_value_mut_nonexistent() {
    let (mut cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(999);
    assert!(!cell_store.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(1.0))));
}
#[test]
fn test_set_formula() {
    let (mut cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(100);
    // set_formula now accepts Option<IdentityFormula>; use None for clearing
    assert!(cell_store.set_formula(&cell_id, None));
    assert!(cell_store.get_formula(&cell_id).is_none());
}
#[test]
fn test_set_formula_nonexistent() {
    let (mut cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(999);
    assert!(!cell_store.set_formula(&cell_id, None));
}
#[test]
fn test_get_cell_value_at() {
    let (cell_store, sheet_id) = store_with_grid();
    let val = cell_store
        .get_cell_value_at(&sheet_id, SheetPos::new(2, 1))
        .unwrap();
    assert_eq!(*val, CellValue::Number(FiniteF64::must(21.0)));
}
#[test]
fn test_get_cell_value_at_empty() {
    let (cell_store, sheet_id) = store_with_grid();
    // row=5 is outside our 3x3 grid
    assert!(
        cell_store
            .get_cell_value_at(&sheet_id, SheetPos::new(5, 0))
            .is_none()
    );
}
#[test]
fn test_resolve_cell_id() {
    let (cell_store, sheet_id) = store_with_grid();
    let cell_id = cell_store
        .resolve_cell_id(&sheet_id, SheetPos::new(1, 2))
        .unwrap();
    assert_eq!(cell_id, make_cell_id(112));
}
#[test]
fn test_resolve_position() {
    let (cell_store, _) = store_with_grid();
    let cell_id = make_cell_id(121); // row=2, col=1
    let pos = cell_store.resolve_position(&cell_id).unwrap();
    assert_eq!(pos, SheetPos::new(2, 1));
}
#[test]
fn test_insert_cell() {
    let (mut cell_store, sheet_id) = store_with_grid();
    let cell_id = make_cell_id(500);
    let entry = CellEntry {
        value: CellValue::Text("new cell".into()),
    };
    cell_store.insert_cell(&sheet_id, cell_id, SheetPos::new(5, 5), entry);

    assert_eq!(
        *cell_store.get_cell_value(&cell_id).unwrap(),
        CellValue::Text("new cell".into())
    );
    assert_eq!(
        cell_store.resolve_position(&cell_id).unwrap(),
        SheetPos::new(5, 5)
    );
    assert_eq!(
        cell_store
            .resolve_cell_id(&sheet_id, SheetPos::new(5, 5))
            .unwrap(),
        cell_id
    );
}
#[test]
fn test_remove_cell() {
    let (mut cell_store, sheet_id) = store_with_grid();
    let cell_id = make_cell_id(100);
    assert!(cell_store.get_cell_value(&cell_id).is_some());
    assert!(cell_store.resolve_position(&cell_id).is_some());

    cell_store.remove_cell(&cell_id);

    assert!(cell_store.get_cell_value(&cell_id).is_none());
    assert!(cell_store.resolve_position(&cell_id).is_none());
    assert!(
        cell_store
            .resolve_cell_id(&sheet_id, SheetPos::new(0, 0))
            .is_none()
    );
}
#[test]
fn test_remove_cell_nonexistent() {
    let (mut cell_store, _) = store_with_grid();
    // Should not panic
    cell_store.remove_cell(&make_cell_id(999));
}
#[test]
fn test_apply_edit() {
    let (mut cell_store, sheet_id) = store_with_grid();
    let cell_id = make_cell_id(600);
    // apply_edit formula param is now Option<IdentityFormula>; use None
    cell_store.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(7, 3),
        CellValue::Boolean(true),
        None,
    );

    assert_eq!(
        *cell_store.get_cell_value(&cell_id).unwrap(),
        CellValue::Boolean(true)
    );
    assert!(cell_store.get_formula(&cell_id).is_none());
    assert_eq!(
        cell_store.resolve_position(&cell_id).unwrap(),
        SheetPos::new(7, 3)
    );
}
#[test]
fn test_apply_edits_batch() {
    let (mut cell_store, sheet_id) = store_with_grid();
    let edits = vec![
        CellEdit {
            sheet: sheet_id,
            cell: make_cell_id(700),
            pos: SheetPos::new(4, 0),
            value: CellValue::Number(FiniteF64::must(1.0)),
            formula: None,
        },
        CellEdit {
            sheet: sheet_id,
            cell: make_cell_id(701),
            pos: SheetPos::new(4, 1),
            value: CellValue::Number(FiniteF64::must(2.0)),
            formula: None,
        },
        CellEdit {
            sheet: sheet_id,
            cell: make_cell_id(702),
            pos: SheetPos::new(4, 2),
            value: CellValue::Number(FiniteF64::must(3.0)),
            // CellEdit.formula is now Option<IdentityFormula>; use None
            formula: None,
        },
    ];

    cell_store.apply_edits(&edits);

    assert_eq!(
        *cell_store.get_cell_value(&make_cell_id(700)).unwrap(),
        CellValue::Number(FiniteF64::must(1.0))
    );
    assert_eq!(
        *cell_store.get_cell_value(&make_cell_id(702)).unwrap(),
        CellValue::Number(FiniteF64::must(3.0))
    );
    // This snapshot supplies raw formula text, which ComputeCore compiles separately.
    assert!(cell_store.get_formula(&make_cell_id(702)).is_none());
}
#[test]
fn test_insert_cell_overwrites() {
    let (mut cell_store, sheet_id) = store_with_grid();
    let cell_id = make_cell_id(100); // Already at (0, 0)

    // Overwrite with new entry
    let entry = CellEntry {
        value: CellValue::Text("overwritten".into()),
    };
    cell_store.insert_cell(&sheet_id, cell_id, SheetPos::new(0, 0), entry);

    assert_eq!(
        *cell_store.get_cell_value(&cell_id).unwrap(),
        CellValue::Text("overwritten".into())
    );
    assert!(cell_store.get_formula(&cell_id).is_none());
}
#[test]
fn test_apply_edit_to_nonexistent_sheet() {
    let mut cell_store = CellStore::new();
    // Should not panic — edit is silently ignored since sheet doesn't exist
    cell_store.apply_edit(
        &make_sheet_id(999),
        make_cell_id(1),
        SheetPos::new(0, 0),
        CellValue::Null,
        None,
    );
    assert!(cell_store.get_cell_value(&make_cell_id(1)).is_none());
}
#[test]
fn test_insert_cell_to_nonexistent_sheet() {
    let mut cell_store = CellStore::new();
    let entry = CellEntry {
        value: CellValue::Null,
    };
    // Should not panic
    cell_store.insert_cell(
        &make_sheet_id(999),
        make_cell_id(1),
        SheetPos::new(0, 0),
        entry,
    );
    assert!(cell_store.get_cell_value(&make_cell_id(1)).is_none());
}
#[test]
fn test_default_trait() {
    let cell_store = CellStore::default();
    assert_eq!(cell_store.sheet_ids().count(), 0);
}
#[test]
fn formula_sidecar_distinguishes_null_results_from_ghosts() {
    let (mut store, sheet_id) = super::super::test_helpers::fresh_store_with_sheet(1, 1);
    let cell_id = make_cell_id(100);
    store.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 0),
        CellValue::Null,
        None,
    );
    assert!(store.get_sheet(&sheet_id).unwrap().is_ghost(&cell_id));
    let formula = formula_types::IdentityFormula {
        template: "1".to_string(),
        refs: vec![],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    };
    store.set_formula(&cell_id, Some(formula.clone()));
    assert!(!store.get_sheet(&sheet_id).unwrap().is_ghost(&cell_id));
    assert_eq!(store.get_formula(&cell_id), Some(&formula));
    store.apply_edit(
        &sheet_id,
        cell_id,
        SheetPos::new(0, 0),
        CellValue::Null,
        None,
    );
    assert!(store.get_sheet(&sheet_id).unwrap().is_ghost(&cell_id));
    store.set_value_mut(&cell_id, CellValue::Number(FiniteF64::must(0.0)));
    assert!(!store.get_sheet(&sheet_id).unwrap().is_ghost(&cell_id));
}
