use super::*;
use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::units::{CharWidth, Points};
use std::sync::Arc;

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn setup() -> (WorkbookStorage, SheetId, GridIndex) {
    let mut storage = WorkbookStorage::new();
    let mut mirror = crate::mirror::CellMirror::new();
    let sid = make_sheet_id(1);
    storage
        .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
        .unwrap();
    let id_alloc = Arc::new(cell_types::IdAllocator::new());
    let gi = GridIndex::new(sid, 100, 26, id_alloc);
    (storage, sid, gi)
}

#[test]
fn test_set_custom_row_height_and_get() {
    let (mut storage, sid, gi) = setup();
    set_row_height(&mut storage, &sid, 0, Points(30.0), Some(&gi)).unwrap();
    assert_eq!(get_row_height(&storage, &sid, 0, Some(&gi)), Points(30.0));
}

#[test]
fn test_get_default_row_height() {
    let (storage, sid, gi) = setup();
    assert_eq!(
        get_row_height(&storage, &sid, 0, Some(&gi)),
        DEFAULT_ROW_HEIGHT
    );
}

#[test]
fn test_reset_row_height_to_default_removes_entry() {
    let (mut storage, sid, gi) = setup();
    set_row_height(&mut storage, &sid, 0, Points(50.0), Some(&gi)).unwrap();
    set_row_height(&mut storage, &sid, 0, DEFAULT_ROW_HEIGHT, Some(&gi)).unwrap();
    assert_eq!(
        get_row_height(&storage, &sid, 0, Some(&gi)),
        DEFAULT_ROW_HEIGHT
    );
}

#[test]
fn test_set_custom_col_width_and_get() {
    let (mut storage, sid, gi) = setup();
    set_col_width(&mut storage, &sid, 0, CharWidth(120.0), Some(&gi)).unwrap();
    assert_eq!(
        get_col_width(&storage, &sid, 0, Some(&gi)),
        CharWidth(120.0)
    );
}

#[test]
fn test_get_default_col_width() {
    let (storage, sid, gi) = setup();
    assert_eq!(
        get_col_width(&storage, &sid, 0, Some(&gi)),
        DEFAULT_COL_WIDTH
    );
}

#[test]
fn test_reset_col_width_to_default_removes_entry() {
    let (mut storage, sid, gi) = setup();
    set_col_width(&mut storage, &sid, 0, CharWidth(200.0), Some(&gi)).unwrap();
    set_col_width(&mut storage, &sid, 0, DEFAULT_COL_WIDTH, Some(&gi)).unwrap();
    assert_eq!(
        get_col_width(&storage, &sid, 0, Some(&gi)),
        DEFAULT_COL_WIDTH
    );
}

#[test]
fn test_hide_row_and_is_row_hidden() {
    let (mut storage, sid, gi) = setup();
    assert!(!is_row_hidden(&storage, &sid, 3, Some(&gi)));
    hide_manual_rows(&mut storage, &sid, &[3], Some(&gi));
    assert!(is_row_hidden(&storage, &sid, 3, Some(&gi)));
}

#[test]
fn test_hide_already_hidden_row_no_duplicate() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[5], Some(&gi));
    hide_manual_rows(&mut storage, &sid, &[5], Some(&gi));
    assert_eq!(get_hidden_rows(&storage, &sid, Some(&gi)), vec![5]);
}

#[test]
fn test_unhide_row() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[3], Some(&gi));
    unhide_manual_rows(&mut storage, &sid, &[3], Some(&gi));
    assert!(!is_row_hidden(&storage, &sid, 3, Some(&gi)));
}

#[test]
fn test_unhide_non_hidden_row_is_noop() {
    let (mut storage, sid, gi) = setup();
    unhide_manual_rows(&mut storage, &sid, &[99], Some(&gi));
    assert!(!is_row_hidden(&storage, &sid, 99, Some(&gi)));
}

#[test]
fn test_get_hidden_rows_sorted() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[10, 3, 7, 1], Some(&gi));
    assert_eq!(
        get_hidden_rows(&storage, &sid, Some(&gi)),
        vec![1, 3, 7, 10]
    );
}

#[test]
fn test_hide_column_and_is_column_hidden() {
    let (mut storage, sid, gi) = setup();
    assert!(!is_column_hidden(&storage, &sid, 2, Some(&gi)));
    hide_columns(&mut storage, &sid, &[2], Some(&gi));
    assert!(is_column_hidden(&storage, &sid, 2, Some(&gi)));
}

#[test]
fn test_unhide_column() {
    let (mut storage, sid, gi) = setup();
    hide_columns(&mut storage, &sid, &[4], Some(&gi));
    unhide_columns(&mut storage, &sid, &[4], Some(&gi));
    assert!(!is_column_hidden(&storage, &sid, 4, Some(&gi)));
}

#[test]
fn test_get_hidden_columns_sorted() {
    let (mut storage, sid, gi) = setup();
    hide_columns(&mut storage, &sid, &[8, 2, 5, 0], Some(&gi));
    assert_eq!(
        get_hidden_columns(&storage, &sid, Some(&gi)),
        vec![0, 2, 5, 8]
    );
}

#[test]
fn test_hidden_row_returns_zero_height() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[3], Some(&gi));
    assert_eq!(get_row_height(&storage, &sid, 3, Some(&gi)), Points(0.0));
}

#[test]
fn test_hidden_column_returns_zero_width() {
    let (mut storage, sid, gi) = setup();
    hide_columns(&mut storage, &sid, &[2], Some(&gi));
    assert_eq!(get_col_width(&storage, &sid, 2, Some(&gi)), CharWidth(0.0));
}

#[test]
fn test_multiple_rows_hidden_and_unhidden() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[1, 3, 5, 7], Some(&gi));
    unhide_manual_rows(&mut storage, &sid, &[3, 7], Some(&gi));
    assert_eq!(get_hidden_rows(&storage, &sid, Some(&gi)), vec![1, 5]);
}

#[test]
fn test_custom_height_hidden_then_unhidden() {
    let (mut storage, sid, gi) = setup();
    set_row_height(&mut storage, &sid, 2, Points(45.0), Some(&gi)).unwrap();
    hide_manual_rows(&mut storage, &sid, &[2], Some(&gi));
    assert_eq!(get_row_height(&storage, &sid, 2, Some(&gi)), Points(0.0));
    unhide_manual_rows(&mut storage, &sid, &[2], Some(&gi));
    assert_eq!(get_row_height(&storage, &sid, 2, Some(&gi)), Points(45.0));
}

#[test]
fn test_nonexistent_sheet_returns_defaults() {
    let storage = WorkbookStorage::new();
    let sid = make_sheet_id(999);
    assert_eq!(get_row_height(&storage, &sid, 0, None), DEFAULT_ROW_HEIGHT);
    assert_eq!(get_col_width(&storage, &sid, 0, None), DEFAULT_COL_WIDTH);
    assert!(!is_row_hidden(&storage, &sid, 0, None));
    assert!(!is_column_hidden(&storage, &sid, 0, None));
    assert!(get_hidden_rows(&storage, &sid, None).is_empty());
    assert!(get_hidden_columns(&storage, &sid, None).is_empty());
}

#[test]
fn test_set_height_for_row_in_range() {
    let (mut storage, sid, gi) = setup();
    set_row_height(&mut storage, &sid, 50, Points(25.0), Some(&gi)).unwrap();
    assert_eq!(get_row_height(&storage, &sid, 50, Some(&gi)), Points(25.0));
}

#[test]
fn test_set_width_for_col_in_range() {
    let (mut storage, sid, gi) = setup();
    set_col_width(&mut storage, &sid, 20, CharWidth(100.0), Some(&gi)).unwrap();
    assert_eq!(
        get_col_width(&storage, &sid, 20, Some(&gi)),
        CharWidth(100.0)
    );
}

#[test]
fn test_hide_unhide_empty_array_noop() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[], Some(&gi));
    unhide_manual_rows(&mut storage, &sid, &[], Some(&gi));
    hide_columns(&mut storage, &sid, &[], Some(&gi));
    unhide_columns(&mut storage, &sid, &[], Some(&gi));
    assert!(get_hidden_rows(&storage, &sid, Some(&gi)).is_empty());
    assert!(get_hidden_columns(&storage, &sid, Some(&gi)).is_empty());
}

#[test]
fn test_custom_width_hidden_then_unhidden() {
    let (mut storage, sid, gi) = setup();
    set_col_width(&mut storage, &sid, 3, CharWidth(150.0), Some(&gi)).unwrap();
    hide_columns(&mut storage, &sid, &[3], Some(&gi));
    assert_eq!(get_col_width(&storage, &sid, 3, Some(&gi)), CharWidth(0.0));
    unhide_columns(&mut storage, &sid, &[3], Some(&gi));
    assert_eq!(
        get_col_width(&storage, &sid, 3, Some(&gi)),
        CharWidth(150.0)
    );
}

#[test]
fn test_multiple_columns_hidden_and_unhidden() {
    let (mut storage, sid, gi) = setup();
    hide_columns(&mut storage, &sid, &[0, 2, 4, 6], Some(&gi));
    unhide_columns(&mut storage, &sid, &[2, 6], Some(&gi));
    assert_eq!(get_hidden_columns(&storage, &sid, Some(&gi)), vec![0, 4]);
}

#[test]
fn test_set_row_height_nonexistent_sheet() {
    let mut storage = WorkbookStorage::new();
    let sid = make_sheet_id(999);
    let result = set_row_height(&mut storage, &sid, 0, Points(30.0), None);
    assert!(result.is_err());
}

#[test]
fn test_set_col_width_nonexistent_sheet() {
    let mut storage = WorkbookStorage::new();
    let sid = make_sheet_id(999);
    let result = set_col_width(&mut storage, &sid, 0, CharWidth(100.0), None);
    assert!(result.is_err());
}

#[test]
fn test_hide_rows_nonexistent_sheet_noop() {
    let mut storage = WorkbookStorage::new();
    let sid = make_sheet_id(999);
    hide_manual_rows(&mut storage, &sid, &[0, 1, 2], None);
    assert!(get_hidden_rows(&storage, &sid, None).is_empty());
}

#[test]
fn test_reset_default_on_unmaterialized_row_noop() {
    let (mut storage, sid, gi) = setup();
    set_row_height(&mut storage, &sid, 99, DEFAULT_ROW_HEIGHT, Some(&gi)).unwrap();
    assert_eq!(
        get_row_height(&storage, &sid, 99, Some(&gi)),
        DEFAULT_ROW_HEIGHT
    );
}

#[test]
fn test_manual_and_filter_row_hide_composition() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[4], Some(&gi));
    let transitions =
        set_filter_hidden_rows(&mut storage, &sid, "filter-a", &[4, 5], &[], Some(&gi));
    assert_eq!(transitions, vec![(5, true)]);
    assert!(is_row_hidden(&storage, &sid, 4, Some(&gi)));
    assert!(is_row_hidden(&storage, &sid, 5, Some(&gi)));
}

#[test]
fn test_manual_unhide_leaves_filter_hidden_row_hidden() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[4], Some(&gi));
    set_filter_hidden_rows(&mut storage, &sid, "filter-a", &[4], &[], Some(&gi));
    let transitions = unhide_manual_rows(&mut storage, &sid, &[4], Some(&gi));
    assert!(transitions.is_empty());
    assert!(is_row_hidden(&storage, &sid, 4, Some(&gi)));
}

#[test]
fn test_clear_filter_restores_rows_still_manually_hidden() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[4], Some(&gi));
    set_filter_hidden_rows(&mut storage, &sid, "filter-a", &[4, 5], &[], Some(&gi));
    let transitions = clear_filter_hidden_rows(&mut storage, &sid, "filter-a", Some(&gi));
    assert_eq!(transitions, vec![(5, false)]);
    assert!(is_row_hidden(&storage, &sid, 4, Some(&gi)));
    assert!(!is_row_hidden(&storage, &sid, 5, Some(&gi)));
}

#[test]
fn test_clear_filter_hidden_rows_absent_owner_noop() {
    let (mut storage, sid, gi) = setup();
    let transitions = clear_filter_hidden_rows(&mut storage, &sid, "missing", Some(&gi));
    assert!(transitions.is_empty());
}

#[test]
fn test_imported_filter_normalization_claims_only_excluded_rows() {
    let (mut storage, sid, gi) = setup();
    hide_manual_rows(&mut storage, &sid, &[2, 3], Some(&gi));

    let transitions = normalize_imported_filter_hidden_rows(
        &mut storage,
        &sid,
        "filter-a",
        &[2],
        &[3],
        Some(&gi),
    );

    assert!(transitions.is_empty());
    assert!(is_row_hidden_by_filter(
        &storage,
        &sid,
        2,
        "filter-a",
        Some(&gi)
    ));
    assert!(!is_row_manually_hidden(&storage, &sid, 2, Some(&gi)));
    assert!(is_row_manually_hidden(&storage, &sid, 3, Some(&gi)));
    assert!(!is_row_hidden_by_filter(
        &storage,
        &sid,
        3,
        "filter-a",
        Some(&gi)
    ));

    let clear_transitions = clear_filter_hidden_rows(&mut storage, &sid, "filter-a", Some(&gi));
    assert_eq!(clear_transitions, vec![(2, false)]);
    assert!(!is_row_hidden(&storage, &sid, 2, Some(&gi)));
    assert!(is_row_hidden(&storage, &sid, 3, Some(&gi)));
}

#[test]
fn test_stored_sizes_preserved_while_hidden() {
    let (mut storage, sid, gi) = setup();
    set_row_height(&mut storage, &sid, 3, Points(44.0), Some(&gi)).unwrap();
    set_col_width(&mut storage, &sid, 3, CharWidth(12.0), Some(&gi)).unwrap();
    hide_manual_rows(&mut storage, &sid, &[3], Some(&gi));
    hide_columns(&mut storage, &sid, &[3], Some(&gi));
    assert_eq!(
        get_row_height_stored(&storage, &sid, 3, Some(&gi)),
        Points(44.0)
    );
    assert_eq!(
        get_col_width_stored(&storage, &sid, 3, Some(&gi)),
        CharWidth(12.0)
    );
    assert_eq!(
        get_col_width_explicit(&storage, &sid, 3, Some(&gi)),
        Some(CharWidth(12.0))
    );
}

#[test]
fn test_column_visibility_duplicate_hide_and_absent_unhide_noops() {
    let (mut storage, sid, gi) = setup();
    hide_columns(&mut storage, &sid, &[4, 4, 2], Some(&gi));
    unhide_columns(&mut storage, &sid, &[8], Some(&gi));
    assert_eq!(get_hidden_columns(&storage, &sid, Some(&gi)), vec![2, 4]);
}

#[test]
fn imported_row_height_presence_is_independent_of_other_row_metadata() {
    let (_, _, grid) = setup();
    let dimensions = domain_types::SheetDimensions {
        row_heights: vec![
            domain_types::RowDimension {
                row: 0,
                descent: Some(0.3),
                ..Default::default()
            },
            domain_types::RowDimension {
                row: 1,
                hidden: true,
                ..Default::default()
            },
            domain_types::RowDimension {
                row: 2,
                height: 15.0,
                ..Default::default()
            },
            domain_types::RowDimension {
                row: 3,
                height: 22.0,
                custom_height: true,
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let sheet = domain_types::SheetData {
        dimensions,
        ..Default::default()
    };
    let state = super::state::DimensionState::from_import(
        &sheet,
        |row| grid.row_id(row),
        |col| grid.col_id(col),
    );
    for (row, expected_height) in [(0, 0.0), (1, 0.0), (2, 15.0), (3, 22.0)] {
        let id = grid.row_id(row).unwrap();
        let record = &state.rows[&id];
        assert_eq!(record.height.is_some(), row >= 2);
        assert_eq!(
            record
                .to_domain(row, Points(15.0), state.row_hidden(&id))
                .height,
            expected_height
        );
    }
}
