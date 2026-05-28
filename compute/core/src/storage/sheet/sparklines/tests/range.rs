use std::sync::Arc;

use yrs::{Any, Map, Transact};

use super::super::*;
use super::support::*;

#[test]
fn test_clear_sparklines_in_range() {
    let (storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    for i in 0..5 {
        add_sparkline(
            storage.doc(),
            &storage.sheets_ref(),
            &sid,
            &make_sparkline(&format!("sp-{}", i), &hex, i, 0),
        );
    }

    let range = CellRange::new(1, 0, 3, 0);
    clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);

    assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-0").is_some());
    assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-4").is_some());
    assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").is_none());
    assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-2").is_none());
    assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-3").is_none());
    assert_eq!(
        get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).len(),
        2
    );
}

#[test]
fn test_clear_sparklines_for_sheet() {
    let (storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    add_sparkline(
        storage.doc(),
        &storage.sheets_ref(),
        &sid,
        &make_sparkline("sp-1", &hex, 0, 0),
    );
    add_sparkline(
        storage.doc(),
        &storage.sheets_ref(),
        &sid,
        &make_sparkline("sp-2", &hex, 1, 0),
    );

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2"]);
    add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

    clear_sparklines_for_sheet(storage.doc(), &storage.sheets_ref(), &sid);

    assert!(get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty());
    assert!(get_sparkline_groups_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty());
    assert!(!has_sparkline(
        storage.doc(),
        &storage.sheets_ref(),
        &sid,
        0,
        0
    ));
}

#[test]
fn test_clear_range_cleans_group() {
    let (storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp1 = make_sparkline("sp-1", &hex, 0, 0);
    let sp2 = make_sparkline("sp-2", &hex, 1, 0);
    let sp3 = make_sparkline("sp-3", &hex, 2, 0);
    add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp1);
    add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp2);
    add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp3);

    let group = make_group("g-1", &hex, vec!["sp-1", "sp-2", "sp-3"]);
    add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

    let range = CellRange::new(0, 0, 0, 0);
    clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);

    let g = get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").unwrap();
    assert_eq!(g.sparkline_ids.len(), 2);
    assert!(!g.sparkline_ids.contains(&"sp-1".to_string()));
}

#[test]
fn test_clear_range_deduplicates_duplicate_indexed_ids() {
    let (storage, sid) = storage_with_sheet();
    let hex = sheet_hex(1);

    let sp = make_sparkline("sp-1", &hex, 0, 0);
    add_sparkline(storage.doc(), &storage.sheets_ref(), &sid, &sp);
    let group = make_group("g-1", &hex, vec!["sp-1"]);
    add_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, &group);

    let mut txn = storage.doc().transact_mut();
    let sp_map =
        super::super::yrs_io::get_sheet_sparklines_map(&txn, &storage.sheets_ref(), &sid).unwrap();
    sp_map.insert(&mut txn, "idx:0,1", Any::String(Arc::from("sp-1")));
    drop(txn);

    let range = CellRange::new(0, 0, 0, 1);
    clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);

    assert!(get_sparkline(storage.doc(), &storage.sheets_ref(), &sid, "sp-1").is_none());
    assert!(get_sparkline_group(storage.doc(), &storage.sheets_ref(), &sid, "g-1").is_none());
}

#[test]
fn test_clear_range_ignores_malformed_index_entries() {
    let (storage, sid) = storage_with_sheet();
    let mut txn = storage.doc().transact_mut();
    let sp_map =
        super::super::yrs_io::get_sheet_sparklines_map(&txn, &storage.sheets_ref(), &sid).unwrap();
    sp_map.insert(&mut txn, "idx:0,0", Any::Bool(true));
    sp_map.insert(&mut txn, "idx:0,1", Any::String(Arc::from("missing")));
    drop(txn);

    let range = CellRange::new(0, 0, 0, 1);
    clear_sparklines_in_range(storage.doc(), &storage.sheets_ref(), &sid, &range);
    assert!(get_sparklines_in_sheet(storage.doc(), &storage.sheets_ref(), &sid).is_empty());
}
