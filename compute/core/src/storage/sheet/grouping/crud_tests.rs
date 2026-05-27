use super::super::*;
use super::test_support::*;

#[test]
fn test_group_rows_basic() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert_eq!(g.start, 2);
    assert_eq!(g.end, 5);
    assert_eq!(g.level, 1);
    assert!(!g.collapsed);
}

#[test]
fn test_group_rows_reversed() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 5, 2).unwrap();
    assert_eq!(g.start, 2);
    assert_eq!(g.end, 5);
}

#[test]
fn test_nested_groups() {
    let (s, id) = storage_with_sheet();
    let o = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
    let i = group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
    assert_eq!(o.level, 1);
    assert_eq!(i.level, 2);
    assert_eq!(i.parent_id, Some(o.id));
}

#[test]
fn test_max_level_exceeded() {
    let (s, id) = storage_with_sheet();
    for i in 0..8u32 {
        group_rows(s.doc(), &s.sheets_ref(), &id, i, 20 - i).unwrap();
    }
    assert!(group_rows(s.doc(), &s.sheets_ref(), &id, 4, 16).is_err());
}

#[test]
fn test_ungroup_rows() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &id, 3, 4).unwrap();
    ungroup_rows(s.doc(), &s.sheets_ref(), &id, 3, 4);
    assert_eq!(
        get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
            .row_groups
            .len(),
        1
    );
}

#[test]
fn test_clear_row_grouping() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &id, 3, 4).unwrap();
    clear_row_grouping(s.doc(), &s.sheets_ref(), &id, 2, 5);
    assert!(
        get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
            .row_groups
            .is_empty()
    );
}

#[test]
fn test_group_columns_basic() {
    let (s, id) = storage_with_sheet();
    let g = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();
    assert_eq!(g.axis, GroupAxis::Column);
    assert_eq!(g.level, 1);
}

#[test]
fn test_ungroup_columns() {
    let (s, id) = storage_with_sheet();
    group_columns(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    group_columns(s.doc(), &s.sheets_ref(), &id, 2, 3).unwrap();
    ungroup_columns(s.doc(), &s.sheets_ref(), &id, 2, 3);
    assert_eq!(
        get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
            .column_groups
            .len(),
        1
    );
}

#[test]
fn test_clear_column_grouping() {
    let (s, id) = storage_with_sheet();
    group_columns(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    clear_column_grouping(s.doc(), &s.sheets_ref(), &id, 1, 5);
    assert!(
        get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id)
            .column_groups
            .is_empty()
    );
}

#[test]
fn test_clear_all() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    group_columns(s.doc(), &s.sheets_ref(), &id, 0, 3).unwrap();
    clear_all_grouping(s.doc(), &s.sheets_ref(), &id);
    let c = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
    assert!(c.row_groups.is_empty() && c.column_groups.is_empty());
}

#[test]
fn test_calc_level_non_overlap() {
    let e = vec![GroupDefinition {
        id: "g".into(),
        sheet_id: "s".into(),
        axis: GroupAxis::Row,
        start: 10,
        end: 20,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: false,
        collapsed_on_member: false,
    }];
    assert_eq!(calculate_group_level(&e, 0, 5).unwrap(), 1);
}

#[test]
fn test_find_parent() {
    let e = vec![GroupDefinition {
        id: "p".into(),
        sheet_id: "s".into(),
        axis: GroupAxis::Row,
        start: 0,
        end: 10,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: false,
        collapsed_on_member: false,
    }];
    assert_eq!(find_parent_group(&e, 2, 8, 2), Some("p".into()));
    assert_eq!(find_parent_group(&e, 2, 8, 1), None);
}
