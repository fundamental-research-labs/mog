use super::super::*;
use super::support::*;

#[test]
fn test_clear_sparklines_in_range() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    for i in 0..5 {
        add_sparkline(
            &mut storage,
            &sid,
            &make_sparkline(&format!("sp-{}", i), &hex, i, 0),
        );
    }

    let range = CellRange::new(1, 0, 3, 0);
    clear_sparklines_in_range(&mut storage, &sid, &range);

    assert!(get_sparkline(&storage, &sid, "sp-0").is_some());
    assert!(get_sparkline(&storage, &sid, "sp-4").is_some());
    assert!(get_sparkline(&storage, &sid, "sp-1").is_none());
    assert!(get_sparkline(&storage, &sid, "sp-2").is_none());
    assert!(get_sparkline(&storage, &sid, "sp-3").is_none());
    assert_eq!(get_sparklines_in_sheet(&storage, &sid).len(), 2);
}

#[test]
fn test_clear_sparklines_for_sheet() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    add_sparkline(&mut storage, &sid, &make_sparkline("sp-1", &hex, 0, 0));
    add_sparkline(&mut storage, &sid, &make_sparkline("sp-2", &hex, 1, 0));

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(&mut storage, &sid, &group);

    clear_sparklines_for_sheet(&mut storage, &sid);

    assert!(get_sparklines_in_sheet(&storage, &sid).is_empty());
    assert!(get_sparkline_groups_in_sheet(&storage, &sid).is_empty());
    assert!(!has_sparkline(&storage, &sid, 0, 0));
}

#[test]
fn test_clear_range_cleans_group() {
    let (mut storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    let sp3 = make_sparkline("sp-3", &hex, 2, 0);
    add_sparkline(&mut storage, &sid, &sp1);
    add_sparkline(&mut storage, &sid, &sp2);
    add_sparkline(&mut storage, &sid, &sp3);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2", "sp-3"]);
    add_sparkline_group(&mut storage, &sid, &group);

    let range = CellRange::new(0, 0, 0, 0);
    clear_sparklines_in_range(&mut storage, &sid, &range);

    let g = get_sparkline_group(&storage, &sid, "g-1").unwrap();
    assert_eq!(g.sparkline_ids.len(), 2);
    assert!(!g.sparkline_ids.contains(&"sp-1".to_string()));
}
