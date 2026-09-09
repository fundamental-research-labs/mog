use super::support::{make_cell_id, make_sheet_id, storage_with_sheet};
use super::*;

#[test]
fn test_set_cell_value_number() {
    let (_, mut cell_store, sheet_id) = storage_with_sheet();
    // Use the low-level set_cell to write, then use get_cell_count
    cell_store.apply_edit(
        &sheet_id,
        make_cell_id(100),
        cell_types::SheetPos::new(0, 0),
        CellValue::Number(FiniteF64::must(42.0)),
        None,
    );

    // Verify via cell store
    let val = cell_store.get_cell_value_at(&sheet_id, cell_types::SheetPos::new(0, 0));
    assert!(val.is_some());
    assert_eq!(*val.unwrap(), CellValue::Number(FiniteF64::must(42.0)));
}

// -----------------------------------------------------------------------
// Test: get_effective_value
// -----------------------------------------------------------------------

#[test]
fn test_get_effective_value_number() {
    let (_, mut cell_store, sheet_id) = storage_with_sheet();
    cell_store.apply_edit(
        &sheet_id,
        make_cell_id(300),
        cell_types::SheetPos::new(0, 0),
        CellValue::Number(FiniteF64::must(99.0)),
        None,
    );

    let eff = get_effective_value(&cell_store, &sheet_id, 0, 0);
    assert!(eff.is_some());
    assert_eq!(eff.unwrap(), CellValue::Number(FiniteF64::must(99.0)));
}

#[test]
fn test_get_effective_value_empty() {
    let (_, cell_store, sheet_id) = storage_with_sheet();
    let eff = get_effective_value(&cell_store, &sheet_id, 5, 5);
    assert!(eff.is_none());
}

// -----------------------------------------------------------------------
// Test: get_cell_count
// -----------------------------------------------------------------------

#[test]
fn test_get_cell_count_empty() {
    let (_, cell_store, sheet_id) = storage_with_sheet();
    assert_eq!(get_cell_count(&cell_store, &sheet_id), 0);
}

#[test]
fn test_get_cell_count_with_cells() {
    let (_, mut cell_store, sheet_id) = storage_with_sheet();
    cell_store.apply_edit(
        &sheet_id,
        make_cell_id(400),
        cell_types::SheetPos::new(0, 0),
        CellValue::Number(FiniteF64::must(1.0)),
        None,
    );
    cell_store.apply_edit(
        &sheet_id,
        make_cell_id(401),
        cell_types::SheetPos::new(0, 1),
        CellValue::Number(FiniteF64::must(2.0)),
        None,
    );
    cell_store.apply_edit(
        &sheet_id,
        make_cell_id(402),
        cell_types::SheetPos::new(1, 0),
        CellValue::Text("hello".into()),
        None,
    );

    assert_eq!(get_cell_count(&cell_store, &sheet_id), 3);
}

#[test]
fn test_get_cell_count_nonexistent_sheet() {
    assert_eq!(get_cell_count(&CellStore::new(), &make_sheet_id(999)), 0);
}
