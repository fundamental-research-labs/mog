use super::helpers::make_mirror;

#[test]
fn insert_rows_remaps_row_heights() {
    use formula_types::StructureChange;

    let (mut mirror, sheet_id) = make_mirror();
    // Set custom height at row 5
    mirror.set_row_height(&sheet_id, 5, 30.0);
    mirror.set_row_height(&sheet_id, 2, 20.0);

    // Insert 2 rows at position 3
    let change = StructureChange::InsertRows {
        at: 3,
        count: 2,
        new_row_ids: vec![],
    };
    mirror.apply_structure_change(&sheet_id, &change);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    // Row 2 (before insertion point) should be unchanged
    assert_eq!(sheet.row_heights.get(&2), Some(&20.0));
    // Row 5 should have shifted to row 7
    assert!(!sheet.row_heights.contains_key(&5));
    assert_eq!(sheet.row_heights.get(&7), Some(&30.0));
}

#[test]
fn delete_rows_remaps_row_heights() {
    use formula_types::StructureChange;

    let (mut mirror, sheet_id) = make_mirror();
    mirror.set_row_height(&sheet_id, 3, 20.0);
    mirror.set_row_height(&sheet_id, 5, 30.0);
    mirror.set_row_height(&sheet_id, 8, 40.0);

    // Delete 2 rows starting at position 3 (deletes rows 3 and 4)
    let change = StructureChange::DeleteRows {
        at: 3,
        count: 2,
        deleted_cell_ids: vec![],
    };
    mirror.apply_structure_change(&sheet_id, &change);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    // Row 5 should shift to row 3 (shifted down by 2), replacing the deleted row 3
    assert_eq!(sheet.row_heights.get(&3), Some(&30.0));
    // Original row 5 key should be gone
    assert!(!sheet.row_heights.contains_key(&5));
    // Row 8 should shift to row 6
    assert_eq!(sheet.row_heights.get(&6), Some(&40.0));
}

#[test]
fn insert_rows_remaps_hidden_rows() {
    use formula_types::StructureChange;

    let (mut mirror, sheet_id) = make_mirror();
    mirror.set_row_hidden(&sheet_id, 5, true);
    mirror.set_row_hidden(&sheet_id, 8, true);

    // Insert 3 rows at position 6
    let change = StructureChange::InsertRows {
        at: 6,
        count: 3,
        new_row_ids: vec![],
    };
    mirror.apply_structure_change(&sheet_id, &change);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    // Row 5 (before insertion) should still be hidden
    assert!(sheet.hidden_rows.contains(&5));
    // Row 8 should have shifted to row 11
    assert!(!sheet.hidden_rows.contains(&8));
    assert!(sheet.hidden_rows.contains(&11));
}

#[test]
fn insert_cols_remaps_col_widths() {
    use formula_types::StructureChange;

    let (mut mirror, sheet_id) = make_mirror();
    mirror.set_col_width(&sheet_id, 3, 150.0);

    let change = StructureChange::InsertCols {
        at: 2,
        count: 1,
        new_col_ids: vec![],
    };
    mirror.apply_structure_change(&sheet_id, &change);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert!(!sheet.col_widths.contains_key(&3));
    assert_eq!(sheet.col_widths.get(&4), Some(&150.0));
}

#[test]
fn structure_change_updates_identity_extent() {
    use formula_types::StructureChange;

    let (mut mirror, sheet_id) = make_mirror();
    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.identity_rows, 100);

    let change = StructureChange::InsertRows {
        at: 50,
        count: 5,
        new_row_ids: vec![],
    };
    mirror.apply_structure_change(&sheet_id, &change);

    let sheet = mirror.get_sheet(&sheet_id).unwrap();
    assert_eq!(sheet.rows, 105);
    assert_eq!(sheet.identity_rows, 105);
}
