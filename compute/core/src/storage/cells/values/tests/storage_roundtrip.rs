use super::support::{make_cell_id, make_grid_index, make_sheet_id, storage_with_sheet};
use super::*;

#[test]
fn test_set_cell_value_number() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    // Use the low-level set_cell to write, then use get_cell_count
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(100),
        0,
        0,
        CellValue::Number(FiniteF64::must(42.0)),
        None,
        None,
    );

    // Verify via mirror
    let val = mirror.get_cell_value_at(&sheet_id, cell_types::SheetPos::new(0, 0));
    assert!(val.is_some());
    assert_eq!(*val.unwrap(), CellValue::Number(FiniteF64::must(42.0)));
}

#[test]
fn test_set_cell_values_batch() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        set_cell_values(
            &storage,
            doc,
            sheets,
            mirror,
            &sheet_id,
            vec![
                (
                    0,
                    0,
                    CellInput::Parse {
                        text: "42".to_string(),
                    },
                ),
                (
                    0,
                    1,
                    CellInput::Parse {
                        text: "hello".to_string(),
                    },
                ),
                (
                    0,
                    2,
                    CellInput::Parse {
                        text: "TRUE".to_string(),
                    },
                ),
            ],
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    // Verify via get_cell_count (should be at least 3 from YRS cells)
    let count = get_cell_count(storage.doc(), storage.sheets(), &sheet_id);
    assert!(count >= 3);
}

// -----------------------------------------------------------------------
// Test: get_raw_value
// -----------------------------------------------------------------------

#[test]
fn test_get_raw_value_empty() {
    let (storage, mirror, sheet_id) = storage_with_sheet();
    let grid = make_grid_index(sheet_id);
    let raw = get_raw_value(
        &mirror,
        storage.doc(),
        storage.sheets(),
        &sheet_id,
        5,
        5,
        &grid,
    );
    assert_eq!(raw, "");
}

// -----------------------------------------------------------------------
// Test: get_effective_value
// -----------------------------------------------------------------------

#[test]
fn test_get_effective_value_number() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(300),
        0,
        0,
        CellValue::Number(FiniteF64::must(99.0)),
        None,
        None,
    );

    let eff = get_effective_value(&mirror, &sheet_id, 0, 0);
    assert!(eff.is_some());
    assert_eq!(eff.unwrap(), CellValue::Number(FiniteF64::must(99.0)));
}

#[test]
fn test_get_effective_value_empty() {
    let (storage, mirror, sheet_id) = storage_with_sheet();
    let eff = get_effective_value(&mirror, &sheet_id, 5, 5);
    assert!(eff.is_none());
}

// -----------------------------------------------------------------------
// Test: get_cell_count
// -----------------------------------------------------------------------

#[test]
fn test_get_cell_count_empty() {
    let (storage, mirror, sheet_id) = storage_with_sheet();
    assert_eq!(
        get_cell_count(storage.doc(), storage.sheets(), &sheet_id),
        0
    );
}

#[test]
fn test_get_cell_count_with_cells() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(400),
        0,
        0,
        CellValue::Number(FiniteF64::must(1.0)),
        None,
        None,
    );
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(401),
        0,
        1,
        CellValue::Number(FiniteF64::must(2.0)),
        None,
        None,
    );
    storage.set_cell(
        &mut mirror,
        &sheet_id,
        make_cell_id(402),
        1,
        0,
        CellValue::Text("hello".into()),
        None,
        None,
    );

    assert_eq!(
        get_cell_count(storage.doc(), storage.sheets(), &sheet_id),
        3
    );
}

#[test]
fn test_get_cell_count_nonexistent_sheet() {
    let storage = YrsStorage::new();
    assert_eq!(
        get_cell_count(storage.doc(), storage.sheets(), &make_sheet_id(999)),
        0
    );
}

// -----------------------------------------------------------------------
// Test: import_values
// -----------------------------------------------------------------------

#[test]
fn test_import_values_basic() {
    let (mut storage, mut mirror, sheet_id) = storage_with_sheet();
    let mut grid = make_grid_index(sheet_id);
    {
        let (doc, sheets, mirror) = (storage.doc(), storage.sheets(), &mut mirror);
        import_values(
            doc,
            sheets,
            mirror,
            &sheet_id,
            &[
                (0, 0, CellValue::Number(FiniteF64::must(42.0)), None),
                (0, 1, CellValue::Text("hello".into()), None),
                (
                    1,
                    0,
                    CellValue::Number(FiniteF64::must(100.0)),
                    Some("A1*2".to_string()),
                ),
            ],
            &*crate::storage::STORAGE_ID_ALLOC,
            &mut grid,
        );
    }
    // Verify cell count
    let count = get_cell_count(storage.doc(), storage.sheets(), &sheet_id);
    assert_eq!(count, 3);
}
