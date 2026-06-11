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
fn test_group_creation_avoids_existing_ids_across_axes() {
    let (s, id) = storage_with_sheet();
    let mut config = SheetGroupingConfig::default();
    for n in 1..=8 {
        let group_id = format!("group-{n}");
        if n % 2 == 0 {
            config
                .column_groups
                .push(test_group(&group_id, GroupAxis::Column, 100 + n, 100 + n));
        } else {
            config
                .row_groups
                .push(test_group(&group_id, GroupAxis::Row, 100 + n, 100 + n));
        }
    }
    let existing_ids: std::collections::HashSet<String> = config
        .row_groups
        .iter()
        .chain(config.column_groups.iter())
        .map(|group| group.id.clone())
        .collect();
    set_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id, &config);

    let row = group_rows(s.doc(), &s.sheets_ref(), &id, 2, 5).unwrap();
    let column = group_columns(s.doc(), &s.sheets_ref(), &id, 1, 3).unwrap();

    assert!(!existing_ids.contains(&row.id));
    assert!(!existing_ids.contains(&column.id));
    assert_ne!(row.id, column.id);

    set_group_collapsed(s.doc(), &s.sheets_ref(), &id, &row.id, true);
    let toggled = get_group_in_sheet(s.doc(), &s.sheets_ref(), &id, &row.id).unwrap();
    assert_eq!(toggled.axis, GroupAxis::Row);
    assert_eq!((toggled.start, toggled.end), (2, 5));
    assert!(toggled.collapsed);
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
fn test_ungroup_rows_split_allocates_unique_residual_ids() {
    let (s, id) = storage_with_sheet();
    let config = SheetGroupingConfig {
        row_groups: vec![test_group("group-1", GroupAxis::Row, 1, 10)],
        column_groups: vec![test_group("group-2", GroupAxis::Column, 2, 4)],
        ..SheetGroupingConfig::default()
    };
    set_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id, &config);

    ungroup_rows(s.doc(), &s.sheets_ref(), &id, 4, 6);

    let config = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
    assert!(
        config
            .row_groups
            .iter()
            .any(|group| (group.start, group.end) == (1, 3))
    );
    assert!(
        config
            .row_groups
            .iter()
            .any(|group| (group.start, group.end) == (7, 10))
    );

    let mut ids = std::collections::HashSet::new();
    for group in config.row_groups.iter().chain(config.column_groups.iter()) {
        assert!(
            ids.insert(group.id.clone()),
            "duplicate group id {}",
            group.id
        );
    }
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

fn test_group(id: &str, axis: GroupAxis, start: u32, end: u32) -> GroupDefinition {
    GroupDefinition {
        id: id.to_string(),
        sheet_id: "s".into(),
        axis,
        start,
        end,
        level: 1,
        collapsed: false,
        parent_id: None,
        hidden: false,
        collapsed_on_member: false,
    }
}
