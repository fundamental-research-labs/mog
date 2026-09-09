use super::super::*;
use super::support::*;

#[test]
fn test_add_and_get_sparkline() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);
    let sp = make_sparkline("sp-1", &hex, 0, 0);

    add_sparkline(&mut storage, &sid, &sp);

    let retrieved = get_sparkline(&storage, &sid, "sp-1");
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.id, "sp-1");
    assert_eq!(retrieved.cell.row, 0);
    assert_eq!(retrieved.cell.col, 0);
    assert_eq!(retrieved.sparkline_type, SparklineType::Line);
}

#[test]
fn test_get_sparkline_at_cell() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);
    let sp = make_sparkline("sp-1", &hex, 3, 5);

    add_sparkline(&mut storage, &sid, &sp);

    let at_cell = get_sparkline_at_cell(&storage, &sid, 3, 5);
    assert!(at_cell.is_some());
    assert_eq!(at_cell.unwrap().id, "sp-1");
    assert!(get_sparkline_at_cell(&storage, &sid, 0, 0).is_none());
}

#[test]
fn test_get_sparklines_in_sheet() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    add_sparkline(&mut storage, &sid, &make_sparkline("sp-1", &hex, 0, 0));
    add_sparkline(&mut storage, &sid, &make_sparkline("sp-2", &hex, 1, 0));
    add_sparkline(&mut storage, &sid, &make_sparkline("sp-3", &hex, 2, 0));

    let sparklines = get_sparklines_in_sheet(&storage, &sid);
    assert_eq!(sparklines.len(), 3);
}

#[test]
fn test_update_sparkline_position_change() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);
    let sp = make_sparkline("sp-1", &hex, 0, 0);
    add_sparkline(&mut storage, &sid, &sp);

    let update = SparklineUpdate {
        cell: Some(SparklineCellAddress {
            sheet_id: hex.clone(),
            row: 5,
            col: 3,
        }),
        updated_at: Some(2000),
        ..Default::default()
    };

    let result = update_sparkline(&mut storage, &sid, "sp-1", &update);
    assert!(result);
    assert!(get_sparkline_at_cell(&storage, &sid, 0, 0).is_none());

    let at_new = get_sparkline_at_cell(&storage, &sid, 5, 3);
    assert!(at_new.is_some());
    let at_new = at_new.unwrap();
    assert_eq!(at_new.id, "sp-1");
    assert_eq!(at_new.updated_at, Some(2000));
}

#[test]
fn test_delete_sparkline_removes_from_group() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(&mut storage, &sid, &group);

    let result = delete_sparkline(&mut storage, &sid, "sp-1");
    assert!(result);

    assert!(get_sparkline(&storage, &sid, "sp-1").is_none());
    assert!(get_sparkline_at_cell(&storage, &sid, 0, 0).is_none());

    let g = get_sparkline_group(&storage, &sid, "g-1").unwrap();
    assert_eq!(g.sparkline_ids, vec!["sp-2".to_string()]);
}

#[test]
fn test_has_sparkline() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    assert!(!has_sparkline(&storage, &sid, 0, 0));

    add_sparkline(&mut storage, &sid, &make_sparkline("sp-1", &hex, 0, 0));

    assert!(has_sparkline(&storage, &sid, 0, 0));
    assert!(!has_sparkline(&storage, &sid, 1, 1));
}

#[test]
fn test_multiple_sparklines_different_cells() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    add_sparkline(&mut storage, &sid, &make_sparkline("sp-a", &hex, 0, 0));
    add_sparkline(&mut storage, &sid, &make_sparkline("sp-b", &hex, 0, 1));
    add_sparkline(&mut storage, &sid, &make_sparkline("sp-c", &hex, 1, 0));
    add_sparkline(&mut storage, &sid, &make_sparkline("sp-d", &hex, 1, 1));

    assert!(has_sparkline(&storage, &sid, 0, 0));
    assert!(has_sparkline(&storage, &sid, 0, 1));
    assert!(has_sparkline(&storage, &sid, 1, 0));
    assert!(has_sparkline(&storage, &sid, 1, 1));
    assert!(!has_sparkline(&storage, &sid, 2, 0));

    assert_eq!(
        get_sparkline_at_cell(&storage, &sid, 0, 0).unwrap().id,
        "sp-a"
    );
    assert_eq!(
        get_sparkline_at_cell(&storage, &sid, 0, 1).unwrap().id,
        "sp-b"
    );
    assert_eq!(
        get_sparkline_at_cell(&storage, &sid, 1, 0).unwrap().id,
        "sp-c"
    );
    assert_eq!(
        get_sparkline_at_cell(&storage, &sid, 1, 1).unwrap().id,
        "sp-d"
    );
}

#[test]
fn test_empty_sheet_returns_empty() {
    let (mut storage, sid) = storage_with_sheet();

    assert!(get_sparklines_in_sheet(&storage, &sid).is_empty());
    assert!(get_sparkline_groups_in_sheet(&storage, &sid).is_empty());
    assert!(get_sparkline(&storage, &sid, "nonexistent").is_none());
    assert!(get_sparkline_at_cell(&storage, &sid, 0, 0).is_none());
    assert!(!has_sparkline(&storage, &sid, 0, 0));
}

#[test]
fn test_update_sparkline_no_position_change() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp = make_sparkline("sp-1", &hex, 0, 0);
    add_sparkline(&mut storage, &sid, &sp);

    let update = SparklineUpdate {
        sparkline_type: Some(SparklineType::Column),
        visual: Some(SparklineVisualSettings {
            color: "#FF0000".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };

    let result = update_sparkline(&mut storage, &sid, "sp-1", &update);
    assert!(result);

    let retrieved = get_sparkline(&storage, &sid, "sp-1").unwrap();
    assert_eq!(retrieved.sparkline_type, SparklineType::Column);
    assert_eq!(retrieved.visual.color, "#FF0000");
    assert!(has_sparkline(&storage, &sid, 0, 0));
    assert_eq!(
        get_sparkline_at_cell(&storage, &sid, 0, 0).unwrap().id,
        "sp-1"
    );
}

#[test]
fn test_update_nonexistent_sparkline() {
    let (mut storage, sid) = storage_with_sheet();

    let update = SparklineUpdate {
        visual: Some(SparklineVisualSettings {
            color: "#FF0000".to_string(),
            ..Default::default()
        }),
        ..Default::default()
    };

    let result = update_sparkline(&mut storage, &sid, "sp-1", &update);
    assert!(!result);
}

#[test]
fn test_delete_nonexistent_sparkline() {
    let (mut storage, sid) = storage_with_sheet();

    let result = delete_sparkline(&mut storage, &sid, "nonexistent");
    assert!(!result);
}

#[test]
fn test_nonexistent_sheet_operations() {
    let mut storage = crate::storage::WorkbookStorage::new();
    let sid = make_sheet_id(999);

    assert!(get_sparkline(&storage, &sid, "sp-1").is_none());
    assert!(get_sparkline_at_cell(&storage, &sid, 0, 0).is_none());
    assert!(get_sparklines_in_sheet(&storage, &sid).is_empty());
    assert!(get_sparkline_groups_in_sheet(&storage, &sid).is_empty());
    assert!(!has_sparkline(&storage, &sid, 0, 0));
    assert!(!delete_sparkline(&mut storage, &sid, "sp-1"));
    assert!(!delete_sparkline_group(&mut storage, &sid, "g-1", true));
    assert!(!update_sparkline(
        &mut storage,
        &sid,
        "sp-1",
        &SparklineUpdate::default()
    ));

    let range = CellRange::new(0, 0, 5, 5);
    clear_sparklines_in_range(&mut storage, &sid, &range);
    clear_sparklines_for_sheet(&mut storage, &sid);
}
