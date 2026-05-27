use super::super::*;
use super::test_support::*;

#[test]
fn test_row_outline_levels() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    let l = get_row_outline_levels(s.doc(), &s.sheets_ref(), &id, 0, 7);
    assert_eq!(l[0].level, 0);
    assert_eq!(l[2].level, 1);
    assert!(l[5].is_summary);
    assert_eq!(l[6].level, 0);
}

#[test]
fn test_row_visibility_collapsed() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
    let l = get_row_outline_levels(s.doc(), &s.sheets_ref(), &id, 2, 5);
    assert!(!l[0].visible);
    assert!(!l[1].visible);
    assert!(l[3].visible);
}

#[test]
fn test_column_outline_levels() {
    let (s, id) = storage_with_sheet();
    group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
    let l = get_column_outline_levels(s.doc(), &s.sheets_ref(), &id, 0, 4);
    assert_eq!(l[0].level, 0);
    assert_eq!(l[1].level, 1);
    assert!(l[3].is_summary);
}

#[test]
fn test_is_row_visible() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert!(is_row_visible_by_groups(s.doc(), &s.sheets_ref(), &id, 3));
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
    assert!(!is_row_visible_by_groups(s.doc(), &s.sheets_ref(), &id, 3));
    assert!(is_row_visible_by_groups(s.doc(), &s.sheets_ref(), &id, 5));
}

#[test]
fn test_is_col_visible() {
    let (s, id) = storage_with_sheet();
    let g = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
    assert!(!is_column_visible_by_groups(
        s.doc(),
        &s.sheets_ref(),
        &id,
        2
    ));
    assert!(is_column_visible_by_groups(
        s.doc(),
        &s.sheets_ref(),
        &id,
        3
    ));
}
