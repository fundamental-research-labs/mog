use super::super::*;
use super::test_support::*;
use crate::storage::YrsStorage;

#[test]
fn test_get_group_in_sheet() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert!(get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &g.id).is_some());
    assert!(get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, "x").is_none());
}

#[test]
fn test_get_group_across_sheets() {
    let mut s = YrsStorage::new();
    let mut m = crate::mirror::CellMirror::new();
    let a = make_sheet_id(1);
    let b = make_sheet_id(2);
    s.add_sheet(&mut m, a, "S1", 100, 26).unwrap();
    s.add_sheet(&mut m, b, "S2", 100, 26).unwrap();
    let g = group_rows(s.doc(), &s.sheets_ref(), &b, 0, 5).unwrap();
    assert!(get_group(s.doc(), &s.sheets_ref(), &[a, b], &g.id).is_some());
}

#[test]
fn test_get_groups_by_axis() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &id, 7, 10).unwrap();
    group_columns(s.doc(), &s.sheets_ref(), &id, 0, 3).unwrap();
    assert_eq!(
        get_groups(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row).len(),
        2
    );
    assert_eq!(
        get_groups(s.doc(), &s.sheets_ref(), &id, GroupAxis::Column).len(),
        1
    );
}

#[test]
fn test_max_outline_level() {
    let (s, id) = storage_with_sheet();
    assert_eq!(
        get_max_outline_level(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row),
        0
    );
    group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
    assert_eq!(
        get_max_outline_level(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row),
        2
    );
}

#[test]
fn test_affected_rows() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert_eq!(
        get_affected_rows_by_group(s.doc(), &s.sheets_ref(), &id, &g.id),
        vec![2, 3, 4]
    );
}

#[test]
fn test_affected_rows_summary_above() {
    let (s, id) = storage_with_sheet();
    set_outline_settings(
        s.doc(),
        &s.sheets_ref(),
        &id,
        &OutlineSettingsUpdate {
            summary_rows_below: Some(false),
            ..Default::default()
        },
    );
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert_eq!(
        get_affected_rows_by_group(s.doc(), &s.sheets_ref(), &id, &g.id),
        vec![3, 4, 5]
    );
}

#[test]
fn test_affected_columns() {
    let (s, id) = storage_with_sheet();
    let g = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 4).unwrap();
    assert_eq!(
        get_affected_columns_by_group(s.doc(), &s.sheets_ref(), &id, &g.id),
        vec![1, 2, 3]
    );
}
