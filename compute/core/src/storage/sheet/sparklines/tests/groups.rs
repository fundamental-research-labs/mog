use super::super::*;
use super::support::*;

#[test]
fn test_add_and_get_group() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(&mut storage, &sid, &group);

    let retrieved = get_sparkline_group(&storage, &sid, "g-1");
    assert!(retrieved.is_some());
    let retrieved = retrieved.unwrap();
    assert_eq!(retrieved.id, "g-1");
    assert_eq!(retrieved.sparkline_ids.len(), 2);

    let sp = get_sparkline(&storage, &sid, "sp-1").unwrap();
    assert_eq!(sp.group_id, Some("g-1".to_string()));
}

#[test]
fn test_add_group_ignores_missing_members() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    add_sparkline(&mut storage, &sid, &make_sparkline("sp-1", &hex, 0, 0));

    let group = make_group("g-1", &hex, vec!["sp-1", "missing"]);
    add_sparkline_group(&mut storage, &sid, &group);

    let stored_group = get_sparkline_group(&storage, &sid, "g-1").expect("group should be stored");
    assert_eq!(stored_group.sparkline_ids, vec!["sp-1", "missing"]);
    assert_eq!(
        get_sparkline(&storage, &sid, "sp-1").unwrap().group_id,
        Some("g-1".to_string())
    );
}

#[test]
fn test_delete_group_with_sparklines() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(&mut storage, &sid, &group);

    let result = delete_sparkline_group(&mut storage, &sid, "g-1", true);
    assert!(result);

    assert!(get_sparkline_group(&storage, &sid, "g-1").is_none());
    assert!(get_sparkline(&storage, &sid, "sp-1").is_none());
    assert!(get_sparkline(&storage, &sid, "sp-2").is_none());
    assert!(!has_sparkline(&storage, &sid, 0, 0));
    assert!(!has_sparkline(&storage, &sid, 1, 0));
}

#[test]
fn test_delete_group_with_sparklines_ignores_missing_members() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    add_sparkline(&mut storage, &sid, &make_sparkline("sp-1", &hex, 0, 0));
    let group = make_group("g-1", &hex, vec!["sp-1", "missing"]);
    add_sparkline_group(&mut storage, &sid, &group);

    assert!(delete_sparkline_group(&mut storage, &sid, "g-1", true));
    assert!(get_sparkline(&storage, &sid, "sp-1").is_none());
    assert!(get_sparkline_group(&storage, &sid, "g-1").is_none());
}

#[test]
fn test_delete_group_keep_sparklines() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(&mut storage, &sid, &group);

    let result = delete_sparkline_group(&mut storage, &sid, "g-1", false);
    assert!(result);

    assert!(get_sparkline_group(&storage, &sid, "g-1").is_none());
    assert!(
        get_sparkline(&storage, &sid, "sp-1")
            .unwrap()
            .group_id
            .is_none()
    );
    assert!(
        get_sparkline(&storage, &sid, "sp-2")
            .unwrap()
            .group_id
            .is_none()
    );
    assert!(has_sparkline(&storage, &sid, 0, 0));
    assert!(has_sparkline(&storage, &sid, 1, 0));
}

#[test]
fn test_sparkline_group_membership() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    let sp3 = make_sparkline("sp-3", &hex, 2, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);
    add_sparkline(&mut storage, &sid, &sp3);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(&mut storage, &sid, &group);

    assert_eq!(
        get_sparkline(&storage, &sid, "sp-1").unwrap().group_id,
        Some("g-1".to_string())
    );
    assert_eq!(
        get_sparkline(&storage, &sid, "sp-2").unwrap().group_id,
        Some("g-1".to_string())
    );
    assert!(
        get_sparkline(&storage, &sid, "sp-3")
            .unwrap()
            .group_id
            .is_none()
    );
}

#[test]
fn test_delete_last_sparkline_in_group_removes_group() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    add_sparkline(&mut storage, &sid, &sp1);

    let group = make_group("g-1", &hex, vec!["sp-1"]);
    add_sparkline_group(&mut storage, &sid, &group);

    assert!(get_sparkline_group(&storage, &sid, "g-1").is_some());
    delete_sparkline(&mut storage, &sid, "sp-1");
    assert!(get_sparkline_group(&storage, &sid, "g-1").is_none());
}

#[test]
fn test_delete_nonexistent_group() {
    let (mut storage, sid) = storage_with_sheet();

    let result = delete_sparkline_group(&mut storage, &sid, "nonexistent", true);
    assert!(!result);
}

#[test]
fn test_get_sparkline_groups_in_sheet() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    let sp3 = make_sparkline("sp-3", &hex, 2, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);
    add_sparkline(&mut storage, &sid, &sp3);

    let g1 = make_group("g-1", &hex, vec!["sp-1"]);
    let g2 = make_group("g-2", &hex, vec!["sp-2", "sp-3"]);
    add_sparkline_group(&mut storage, &sid, &g1);
    add_sparkline_group(&mut storage, &sid, &g2);

    let groups = get_sparkline_groups_in_sheet(&storage, &sid);
    assert_eq!(groups.len(), 2);
}
