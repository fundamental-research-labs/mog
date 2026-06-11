use super::super::*;
use super::test_support::*;

#[test]
fn test_set_group_collapsed() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, true);
    assert!(
        get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &g.id)
            .unwrap()
            .collapsed
    );
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id, false);
    assert!(
        !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &g.id)
            .unwrap()
            .collapsed
    );
}

#[test]
fn test_toggle_collapsed() {
    let (s, id) = storage_with_sheet();
    let g = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    assert_eq!(
        toggle_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id),
        Some(true)
    );
    assert_eq!(
        toggle_group_collapsed(s.doc(), &s.sheets_ref(), &id, &g.id),
        Some(false)
    );
}

#[test]
fn test_expanding_imported_hidden_group_clears_hidden_flag() {
    let (s, id) = storage_with_sheet();
    let mut config = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
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
    set_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id, &config);

    set_group_collapsed(
        s.doc(),
        &s.sheets_ref(),
        &id,
        "imported-hidden-column-group",
        false,
    );

    let group = get_group_in_sheet(
        s.doc(),
        &s.sheets_ref(),
        &id,
        "imported-hidden-column-group",
    )
    .unwrap();
    assert!(!group.collapsed);
    assert!(!group.hidden);
    assert!(is_column_visible_by_groups(
        s.doc(),
        &s.sheets_ref(),
        &id,
        3
    ));
}

#[test]
fn test_set_level_collapsed() {
    let (s, id) = storage_with_sheet();
    group_rows(s.doc(), &s.sheets_ref(), &id, 1, 10).unwrap();
    let i = group_rows(s.doc(), &s.sheets_ref(), &id, 3, 7).unwrap();
    set_level_collapsed(s.doc(), &s.sheets_ref(), &id, GroupAxis::Row, 2, true);
    assert!(
        get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &i.id)
            .unwrap()
            .collapsed
    );
}

#[test]
fn test_expand_all() {
    let (s, id) = storage_with_sheet();
    let a = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    let b = group_rows(s.doc(), &s.sheets_ref(), &id, 7, 10).unwrap();
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &a.id, true);
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &b.id, true);
    expand_all(s.doc(), &s.sheets_ref(), &id, Some(GroupAxis::Row));
    assert!(
        !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &a.id)
            .unwrap()
            .collapsed
    );
}

#[test]
fn test_collapse_all() {
    let (s, id) = storage_with_sheet();
    let a = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    let b = group_rows(s.doc(), &s.sheets_ref(), &id, 7, 10).unwrap();
    collapse_all(s.doc(), &s.sheets_ref(), &id, Some(GroupAxis::Row));
    assert!(
        get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &a.id)
            .unwrap()
            .collapsed
    );
    assert!(
        get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &b.id)
            .unwrap()
            .collapsed
    );
}

#[test]
fn test_expand_both_axes() {
    let (s, id) = storage_with_sheet();
    let r = group_rows(s.doc(), &s.sheets_ref(), &id, 1, 5).unwrap();
    let c = group_columns(s.doc(), &s.sheets_ref(), &id, 0, 3).unwrap();
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &r.id, true);
    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &c.id, true);
    expand_all(s.doc(), &s.sheets_ref(), &id, None);
    assert!(
        !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &r.id)
            .unwrap()
            .collapsed
    );
    assert!(
        !get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &c.id)
            .unwrap()
            .collapsed
    );
}
