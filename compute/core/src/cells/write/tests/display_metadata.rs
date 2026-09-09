use super::helpers::make_store;

#[test]
fn insert_rows_remaps_hidden_rows() {
    use formula_types::StructureChange;

    let (mut cell_store, sheet_id) = make_store();
    cell_store.set_row_hidden(&sheet_id, 5, true);
    cell_store.set_row_hidden(&sheet_id, 8, true);

    // Insert 3 rows at position 6
    let change = StructureChange::InsertRows {
        at: 6,
        count: 3,
        new_row_ids: vec![],
    };
    cell_store.apply_structure_change(&sheet_id, &change);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    // Row 5 (before insertion) should still be hidden
    assert!(sheet.hidden_rows.contains(&5));
    // Row 8 should have shifted to row 11
    assert!(!sheet.hidden_rows.contains(&8));
    assert!(sheet.hidden_rows.contains(&11));
}

#[test]
fn structure_change_updates_identity_extent() {
    use formula_types::StructureChange;

    let (mut cell_store, sheet_id) = make_store();
    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.identity_rows, 100);

    let change = StructureChange::InsertRows {
        at: 50,
        count: 5,
        new_row_ids: vec![],
    };
    cell_store.apply_structure_change(&sheet_id, &change);

    let sheet = cell_store.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 105);
    assert_eq!(sheet.identity_rows, 105);
}
