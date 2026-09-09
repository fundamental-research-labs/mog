use super::super::*;
use super::test_support::*;

#[test]
fn test_set_group_collapsed() {
    let (mut s, id) = storage_with_sheet();
    let g = group_rows(&mut s, &id, 2, 5).unwrap();
    set_group_collapsed(&mut s, &id, &g.id, true);
    assert!(get_group_in_sheet(&s, &id, &g.id).unwrap().collapsed);
    set_group_collapsed(&mut s, &id, &g.id, false);
    assert!(!get_group_in_sheet(&s, &id, &g.id).unwrap().collapsed);
}

#[test]
fn test_toggle_collapsed() {
    let (mut s, id) = storage_with_sheet();
    let g = group_rows(&mut s, &id, 2, 5).unwrap();
    assert_eq!(toggle_group_collapsed(&mut s, &id, &g.id), Some(true));
    assert_eq!(toggle_group_collapsed(&mut s, &id, &g.id), Some(false));
}

#[test]
fn test_expanding_imported_hidden_group_clears_hidden_flag() {
    let (mut s, id) = storage_with_sheet();
    let mut config = get_sheet_grouping_config(&s, &id);
    config.column_groups.push(GroupDefinition {
        id: "imported-hidden-column-group".to_string(),
        sheet_id: id.to_uuid_string(),
        axis: GroupAxis::Column,
        start: 2,
        end: 5,
        level: 1,
        collapsed: true,
        parent_id: None,
        hidden: true,
        collapsed_on_member: false,
    });
    set_sheet_grouping_config(&mut s, &id, &config);

    set_group_collapsed(&mut s, &id, "imported-hidden-column-group", false);

    let group = get_group_in_sheet(&s, &id, "imported-hidden-column-group").unwrap();
    assert!(!group.collapsed);
    assert!(!group.hidden);
    assert!(is_column_visible_by_groups(&s, &id, 3));
}

#[test]
fn test_toggle_imported_hidden_group_expands_effective_collapsed_state() {
    let (mut s, id) = storage_with_sheet();
    let mut config = get_sheet_grouping_config(&s, &id);
    config.column_groups.push(GroupDefinition {
        id: "imported-hidden-column-group".to_string(),
        sheet_id: id.to_uuid_string(),
        axis: GroupAxis::Column,
        start: 2,
        end: 5,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: true,
        collapsed_on_member: false,
    });
    set_sheet_grouping_config(&mut s, &id, &config);

    assert_eq!(
        toggle_group_collapsed(&mut s, &id, "imported-hidden-column-group",),
        Some(false)
    );

    let group = get_group_in_sheet(&s, &id, "imported-hidden-column-group").unwrap();
    assert!(!group.collapsed);
    assert!(!group.hidden);
    assert!(is_column_visible_by_groups(&s, &id, 3));
}

#[test]
fn test_set_level_collapsed() {
    let (mut s, id) = storage_with_sheet();
    group_rows(&mut s, &id, 1, 10).unwrap();
    let i = group_rows(&mut s, &id, 3, 7).unwrap();
    set_level_collapsed(&mut s, &id, GroupAxis::Row, 2, true);
    assert!(get_group_in_sheet(&s, &id, &i.id).unwrap().collapsed);
}

#[test]
fn test_expand_all_clears_imported_hidden_group_without_collapsed_flag() {
    let (mut s, id) = storage_with_sheet();
    let mut config = get_sheet_grouping_config(&s, &id);
    config.column_groups.push(GroupDefinition {
        id: "imported-hidden-column-group".to_string(),
        sheet_id: id.to_uuid_string(),
        axis: GroupAxis::Column,
        start: 2,
        end: 5,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: true,
        collapsed_on_member: false,
    });
    set_sheet_grouping_config(&mut s, &id, &config);

    expand_all(&mut s, &id, Some(GroupAxis::Column));

    let group = get_group_in_sheet(&s, &id, "imported-hidden-column-group").unwrap();
    assert!(!group.collapsed);
    assert!(!group.hidden);
    assert!(is_column_visible_by_groups(&s, &id, 3));
}

#[test]
fn test_expand_all() {
    let (mut s, id) = storage_with_sheet();
    let a = group_rows(&mut s, &id, 1, 5).unwrap();
    let b = group_rows(&mut s, &id, 7, 10).unwrap();
    set_group_collapsed(&mut s, &id, &a.id, true);
    set_group_collapsed(&mut s, &id, &b.id, true);
    expand_all(&mut s, &id, Some(GroupAxis::Row));
    assert!(!get_group_in_sheet(&s, &id, &a.id).unwrap().collapsed);
}

#[test]
fn test_collapse_all() {
    let (mut s, id) = storage_with_sheet();
    let a = group_rows(&mut s, &id, 1, 5).unwrap();
    let b = group_rows(&mut s, &id, 7, 10).unwrap();
    collapse_all(&mut s, &id, Some(GroupAxis::Row));
    assert!(get_group_in_sheet(&s, &id, &a.id).unwrap().collapsed);
    assert!(get_group_in_sheet(&s, &id, &b.id).unwrap().collapsed);
}

#[test]
fn test_expand_both_axes() {
    let (mut s, id) = storage_with_sheet();
    let r = group_rows(&mut s, &id, 1, 5).unwrap();
    let c = group_columns(&mut s, &id, 0, 3).unwrap();
    set_group_collapsed(&mut s, &id, &r.id, true);
    set_group_collapsed(&mut s, &id, &c.id, true);
    expand_all(&mut s, &id, None);
    assert!(!get_group_in_sheet(&s, &id, &r.id).unwrap().collapsed);
    assert!(!get_group_in_sheet(&s, &id, &c.id).unwrap().collapsed);
}
