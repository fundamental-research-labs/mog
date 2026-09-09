use super::super::*;
use super::test_support::*;
use crate::storage::WorkbookStorage;

#[test]
fn test_get_group_in_sheet() {
    let (mut s, id) = storage_with_sheet();
    let g = group_rows(&mut s, &id, 2, 5).unwrap();
    assert!(get_group_in_sheet(&s, &id, &g.id).is_some());
    assert!(get_group_in_sheet(&s, &id, "x").is_none());
}

#[test]
fn test_get_group_across_sheets() {
    let mut s = WorkbookStorage::new();
    let mut m = crate::cells::CellStore::new();
    let a = make_sheet_id(1);
    let b = make_sheet_id(2);
    s.add_sheet(&mut m, a, "S1", 100, 26).unwrap();
    s.add_sheet(&mut m, b, "S2", 100, 26).unwrap();
    let g = group_rows(&mut s, &b, 0, 5).unwrap();
    assert!(get_group(&s, &[a, b], &g.id).is_some());
}

#[test]
fn test_get_groups_by_axis() {
    let (mut s, id) = storage_with_sheet();
    group_rows(&mut s, &id, 1, 5).unwrap();
    group_rows(&mut s, &id, 7, 10).unwrap();
    group_columns(&mut s, &id, 0, 3).unwrap();
    assert_eq!(get_groups(&s, &id, GroupAxis::Row).len(), 2);
    assert_eq!(get_groups(&s, &id, GroupAxis::Column).len(), 1);
}

#[test]
fn test_max_outline_level() {
    let (mut s, id) = storage_with_sheet();
    assert_eq!(get_max_outline_level(&s, &id, GroupAxis::Row), 0);
    group_rows(&mut s, &id, 1, 10).unwrap();
    group_rows(&mut s, &id, 3, 7).unwrap();
    assert_eq!(get_max_outline_level(&s, &id, GroupAxis::Row), 2);
}

#[test]
fn test_affected_rows() {
    let (mut s, id) = storage_with_sheet();
    let g = group_rows(&mut s, &id, 2, 5).unwrap();
    assert_eq!(get_affected_rows_by_group(&s, &id, &g.id), vec![2, 3, 4, 5]);
}

#[test]
fn test_affected_rows_summary_above() {
    let (mut s, id) = storage_with_sheet();
    set_outline_settings(
        &mut s,
        &id,
        &OutlineSettingsUpdate {
            summary_rows_below: Some(false),
            ..Default::default()
        },
    );
    let g = group_rows(&mut s, &id, 2, 5).unwrap();
    assert_eq!(get_affected_rows_by_group(&s, &id, &g.id), vec![2, 3, 4, 5]);
}

#[test]
fn test_affected_columns() {
    let (mut s, id) = storage_with_sheet();
    let g = group_columns(&mut s, &id, 1, 4).unwrap();
    assert_eq!(
        get_affected_columns_by_group(&s, &id, &g.id),
        vec![1, 2, 3, 4]
    );
}

#[test]
fn test_structural_hidden_rows_include_hidden_groups() {
    let (mut s, id) = storage_with_sheet();
    let mut config = get_sheet_grouping_config(&s, &id);
    config.row_groups.push(GroupDefinition {
        id: "hidden-row-group".to_string(),
        sheet_id: id.to_uuid_string(),
        axis: GroupAxis::Row,
        start: 2,
        end: 4,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: true,
        collapsed_on_member: false,
    });
    set_sheet_grouping_config(&mut s, &id, &config);

    assert_eq!(get_rows_hidden_by_structural_groups(&s, &id), vec![2, 3, 4]);
    assert!(!is_row_visible_by_groups(&s, &id, 3));
}

#[test]
fn test_structural_hidden_columns_include_hidden_groups() {
    let (mut s, id) = storage_with_sheet();
    let mut config = get_sheet_grouping_config(&s, &id);
    config.column_groups.push(GroupDefinition {
        id: "hidden-column-group".to_string(),
        sheet_id: id.to_uuid_string(),
        axis: GroupAxis::Column,
        start: 1,
        end: 2,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: true,
        collapsed_on_member: false,
    });
    set_sheet_grouping_config(&mut s, &id, &config);

    assert_eq!(get_columns_hidden_by_structural_groups(&s, &id), vec![1, 2]);
    assert!(!is_column_visible_by_groups(&s, &id, 1));
}
