use super::*;
use crate::identity::GridIndex;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use domain_types::units::{CharWidth, Points};
use std::sync::Arc;

fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

fn setup() -> (YrsStorage, SheetId, GridIndex) {
    let mut storage = YrsStorage::new();
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
    let (storage, sid, gi) = setup();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        Points(30.0),
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
        Points(30.0)
    );
}

#[test]
fn test_get_default_row_height() {
    let (storage, sid, gi) = setup();
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
        DEFAULT_ROW_HEIGHT
    );
}

#[test]
fn test_reset_row_height_to_default_removes_entry() {
    let (storage, sid, gi) = setup();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        Points(50.0),
        Some(&gi),
    )
    .unwrap();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        DEFAULT_ROW_HEIGHT,
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
        DEFAULT_ROW_HEIGHT
    );
}

#[test]
fn test_set_custom_col_width_and_get() {
    let (storage, sid, gi) = setup();
    set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        CharWidth(120.0),
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
        CharWidth(120.0)
    );
}

#[test]
fn test_get_default_col_width() {
    let (storage, sid, gi) = setup();
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
        DEFAULT_COL_WIDTH
    );
}

#[test]
fn test_reset_col_width_to_default_removes_entry() {
    let (storage, sid, gi) = setup();
    set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        CharWidth(200.0),
        Some(&gi),
    )
    .unwrap();
    set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        DEFAULT_COL_WIDTH,
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 0, Some(&gi)),
        DEFAULT_COL_WIDTH
    );
}

#[test]
fn test_hide_row_and_is_row_hidden() {
    let (storage, sid, _gi) = setup();
    assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
    hide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
    assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
}

#[test]
fn test_hide_already_hidden_row_no_duplicate() {
    let (storage, sid, _gi) = setup();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[5]);
    hide_rows(storage.doc(), storage.sheets(), &sid, &[5]);
    assert_eq!(
        get_hidden_rows(storage.doc(), storage.sheets(), &sid),
        vec![5]
    );
}

#[test]
fn test_unhide_row() {
    let (storage, sid, _gi) = setup();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
    unhide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
    assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 3));
}

#[test]
fn test_unhide_non_hidden_row_is_noop() {
    let (storage, sid, _gi) = setup();
    unhide_rows(storage.doc(), storage.sheets(), &sid, &[99]);
    assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 99));
}

#[test]
fn test_get_hidden_rows_sorted() {
    let (storage, sid, _gi) = setup();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[10, 3, 7, 1]);
    assert_eq!(
        get_hidden_rows(storage.doc(), storage.sheets(), &sid),
        vec![1, 3, 7, 10]
    );
}

#[test]
fn test_hide_column_and_is_column_hidden() {
    let (storage, sid, _gi) = setup();
    assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 2));
    hide_columns(storage.doc(), storage.sheets(), &sid, &[2]);
    assert!(is_column_hidden(storage.doc(), storage.sheets(), &sid, 2));
}

#[test]
fn test_unhide_column() {
    let (storage, sid, _gi) = setup();
    hide_columns(storage.doc(), storage.sheets(), &sid, &[4]);
    unhide_columns(storage.doc(), storage.sheets(), &sid, &[4]);
    assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 4));
}

#[test]
fn test_get_hidden_columns_sorted() {
    let (storage, sid, _gi) = setup();
    hide_columns(storage.doc(), storage.sheets(), &sid, &[8, 2, 5, 0]);
    assert_eq!(
        get_hidden_columns(storage.doc(), storage.sheets(), &sid),
        vec![0, 2, 5, 8]
    );
}

#[test]
fn test_hidden_row_returns_zero_height() {
    let (storage, sid, gi) = setup();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[3]);
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
        Points(0.0)
    );
}

#[test]
fn test_hidden_column_returns_zero_width() {
    let (storage, sid, gi) = setup();
    hide_columns(storage.doc(), storage.sheets(), &sid, &[2]);
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
        CharWidth(0.0)
    );
}

#[test]
fn test_multiple_rows_hidden_and_unhidden() {
    let (storage, sid, _gi) = setup();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[1, 3, 5, 7]);
    unhide_rows(storage.doc(), storage.sheets(), &sid, &[3, 7]);
    assert_eq!(
        get_hidden_rows(storage.doc(), storage.sheets(), &sid),
        vec![1, 5]
    );
}

#[test]
fn test_custom_height_hidden_then_unhidden() {
    let (storage, sid, gi) = setup();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        2,
        Points(45.0),
        Some(&gi),
    )
    .unwrap();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[2]);
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
        Points(0.0)
    );
    unhide_rows(storage.doc(), storage.sheets(), &sid, &[2]);
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 2, Some(&gi)),
        Points(45.0)
    );
}

#[test]
fn test_nonexistent_sheet_returns_defaults() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 0, None),
        DEFAULT_ROW_HEIGHT
    );
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 0, None),
        DEFAULT_COL_WIDTH
    );
    assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 0));
    assert!(!is_column_hidden(storage.doc(), storage.sheets(), &sid, 0));
    assert!(get_hidden_rows(storage.doc(), storage.sheets(), &sid).is_empty());
    assert!(get_hidden_columns(storage.doc(), storage.sheets(), &sid).is_empty());
}

#[test]
fn test_set_height_for_row_in_range() {
    let (storage, sid, gi) = setup();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        50,
        Points(25.0),
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 50, Some(&gi)),
        Points(25.0)
    );
}

#[test]
fn test_set_width_for_col_in_range() {
    let (storage, sid, gi) = setup();
    set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        20,
        CharWidth(100.0),
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 20, Some(&gi)),
        CharWidth(100.0)
    );
}

#[test]
fn test_hide_unhide_empty_array_noop() {
    let (storage, sid, _gi) = setup();
    hide_rows(storage.doc(), storage.sheets(), &sid, &[]);
    unhide_rows(storage.doc(), storage.sheets(), &sid, &[]);
    hide_columns(storage.doc(), storage.sheets(), &sid, &[]);
    unhide_columns(storage.doc(), storage.sheets(), &sid, &[]);
    assert!(get_hidden_rows(storage.doc(), storage.sheets(), &sid).is_empty());
    assert!(get_hidden_columns(storage.doc(), storage.sheets(), &sid).is_empty());
}

#[test]
fn test_custom_width_hidden_then_unhidden() {
    let (storage, sid, gi) = setup();
    set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        3,
        CharWidth(150.0),
        Some(&gi),
    )
    .unwrap();
    hide_columns(storage.doc(), storage.sheets(), &sid, &[3]);
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
        CharWidth(0.0)
    );
    unhide_columns(storage.doc(), storage.sheets(), &sid, &[3]);
    assert_eq!(
        get_col_width(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
        CharWidth(150.0)
    );
}

#[test]
fn test_multiple_columns_hidden_and_unhidden() {
    let (storage, sid, _gi) = setup();
    hide_columns(storage.doc(), storage.sheets(), &sid, &[0, 2, 4, 6]);
    unhide_columns(storage.doc(), storage.sheets(), &sid, &[2, 6]);
    assert_eq!(
        get_hidden_columns(storage.doc(), storage.sheets(), &sid),
        vec![0, 4]
    );
}

#[test]
fn test_set_row_height_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let result = set_row_height(storage.doc(), storage.sheets(), &sid, 0, Points(30.0), None);
    assert!(result.is_err());
}

#[test]
fn test_set_col_width_nonexistent_sheet() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    let result = set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        0,
        CharWidth(100.0),
        None,
    );
    assert!(result.is_err());
}

#[test]
fn test_hide_rows_nonexistent_sheet_noop() {
    let storage = YrsStorage::new();
    let sid = make_sheet_id(999);
    hide_rows(storage.doc(), storage.sheets(), &sid, &[0, 1, 2]);
    assert!(get_hidden_rows(storage.doc(), storage.sheets(), &sid).is_empty());
}

#[test]
fn test_reset_default_on_unmaterialized_row_noop() {
    let (storage, sid, gi) = setup();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        99,
        DEFAULT_ROW_HEIGHT,
        Some(&gi),
    )
    .unwrap();
    assert_eq!(
        get_row_height(storage.doc(), storage.sheets(), &sid, 99, Some(&gi)),
        DEFAULT_ROW_HEIGHT
    );
}

#[test]
fn test_manual_and_filter_row_hide_composition() {
    let (storage, sid, gi) = setup();
    hide_manual_rows(storage.doc(), storage.sheets(), &sid, &[4], Some(&gi));
    let transitions = set_filter_hidden_rows(
        storage.doc(),
        storage.sheets(),
        &sid,
        "filter-a",
        &[4, 5],
        &[],
        Some(&gi),
    );
    assert_eq!(transitions, vec![(5, true)]);
    assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 4));
    assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 5));
}

#[test]
fn test_manual_unhide_leaves_filter_hidden_row_hidden() {
    let (storage, sid, gi) = setup();
    hide_manual_rows(storage.doc(), storage.sheets(), &sid, &[4], Some(&gi));
    set_filter_hidden_rows(
        storage.doc(),
        storage.sheets(),
        &sid,
        "filter-a",
        &[4],
        &[],
        Some(&gi),
    );
    let transitions = unhide_manual_rows(storage.doc(), storage.sheets(), &sid, &[4], Some(&gi));
    assert!(transitions.is_empty());
    assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 4));
}

#[test]
fn test_clear_filter_restores_rows_still_manually_hidden() {
    let (storage, sid, gi) = setup();
    hide_manual_rows(storage.doc(), storage.sheets(), &sid, &[4], Some(&gi));
    set_filter_hidden_rows(
        storage.doc(),
        storage.sheets(),
        &sid,
        "filter-a",
        &[4, 5],
        &[],
        Some(&gi),
    );
    let transitions =
        clear_filter_hidden_rows(storage.doc(), storage.sheets(), &sid, "filter-a", Some(&gi));
    assert_eq!(transitions, vec![(5, false)]);
    assert!(is_row_hidden(storage.doc(), storage.sheets(), &sid, 4));
    assert!(!is_row_hidden(storage.doc(), storage.sheets(), &sid, 5));
}

#[test]
fn test_clear_filter_hidden_rows_absent_owner_noop() {
    let (storage, sid, gi) = setup();
    let transitions =
        clear_filter_hidden_rows(storage.doc(), storage.sheets(), &sid, "missing", Some(&gi));
    assert!(transitions.is_empty());
}

#[test]
fn test_stored_sizes_preserved_while_hidden() {
    let (storage, sid, gi) = setup();
    set_row_height(
        storage.doc(),
        storage.sheets(),
        &sid,
        3,
        Points(44.0),
        Some(&gi),
    )
    .unwrap();
    set_col_width(
        storage.doc(),
        storage.sheets(),
        &sid,
        3,
        CharWidth(12.0),
        Some(&gi),
    )
    .unwrap();
    hide_manual_rows(storage.doc(), storage.sheets(), &sid, &[3], Some(&gi));
    hide_columns(storage.doc(), storage.sheets(), &sid, &[3]);
    assert_eq!(
        get_row_height_stored(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
        Points(44.0)
    );
    assert_eq!(
        get_col_width_stored(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
        CharWidth(12.0)
    );
    assert_eq!(
        get_col_width_explicit(storage.doc(), storage.sheets(), &sid, 3, Some(&gi)),
        Some(CharWidth(12.0))
    );
}

#[test]
fn test_get_col_width_with_default_uses_supplied_default() {
    let (storage, sid, gi) = setup();
    assert_eq!(
        get_col_width_with_default(
            storage.doc(),
            storage.sheets(),
            &sid,
            80,
            CharWidth(17.0),
            Some(&gi),
        ),
        CharWidth(17.0)
    );
    assert_eq!(
        get_col_width_with_default(
            storage.doc(),
            storage.sheets(),
            &sid,
            3,
            CharWidth(17.0),
            Some(&gi),
        ),
        CharWidth(17.0)
    );
}

#[test]
fn test_column_visibility_duplicate_hide_and_absent_unhide_noops() {
    let (storage, sid, _gi) = setup();
    hide_columns(storage.doc(), storage.sheets(), &sid, &[4, 4, 2]);
    unhide_columns(storage.doc(), storage.sheets(), &sid, &[8]);
    assert_eq!(
        get_hidden_columns(storage.doc(), storage.sheets(), &sid),
        vec![2, 4]
    );
}
