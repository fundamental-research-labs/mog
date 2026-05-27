use super::super::ids::{hex_to_sheet_id, sheet_id_to_hex};
use super::super::*;
use super::test_support::*;
use crate::storage::YrsStorage;
use cell_types::SheetId;

#[test]
fn test_default_config() {
    let (s, id) = storage_with_sheet();
    let c = get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &id);
    assert_eq!(c, SheetGroupingConfig::default());
}

#[test]
fn test_serde_roundtrip() {
    let c = SheetGroupingConfig {
        row_groups: vec![GroupDefinition {
            id: "g".into(),
            sheet_id: "s".into(),
            axis: GroupAxis::Row,
            start: 0,
            end: 5,
            level: 1,
            collapsed: false,
            parent_id: None,
            hidden: false,
            collapsed_on_member: false,
        }],
        ..Default::default()
    };
    assert_eq!(
        c,
        serde_json::from_str::<SheetGroupingConfig>(&serde_json::to_string(&c).unwrap()).unwrap()
    );
}

#[test]
fn test_axis_serde() {
    assert_eq!(serde_json::to_string(&GroupAxis::Row).unwrap(), "\"row\"");
    assert_eq!(
        serde_json::from_str::<GroupAxis>("\"column\"").unwrap(),
        GroupAxis::Column
    );
}

#[test]
fn test_multi_sheet_isolation() {
    let mut s = YrsStorage::new();
    let mut m = crate::mirror::CellMirror::new();
    let a = make_sheet_id(10);
    let b = make_sheet_id(20);
    s.add_sheet(&mut m, a, "S1", 100, 26).unwrap();
    s.add_sheet(&mut m, b, "S2", 100, 26).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &a, 1, 5).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &b, 10, 20).unwrap();
    group_rows(s.doc(), &s.sheets_ref(), &b, 12, 15).unwrap();
    assert_eq!(
        get_groups(s.doc(), &s.sheets_ref(), &a, GroupAxis::Row).len(),
        1
    );
    assert_eq!(
        get_groups(s.doc(), &s.sheets_ref(), &b, GroupAxis::Row).len(),
        2
    );
}

#[test]
fn test_nonexistent_sheet() {
    let s = YrsStorage::new();
    assert_eq!(
        get_sheet_grouping_config(s.doc(), &s.sheets_ref(), &make_sheet_id(999)),
        SheetGroupingConfig::default()
    );
}

#[test]
fn test_hex_helpers() {
    let sid = SheetId::from_raw(42);
    let h = sheet_id_to_hex(&sid);
    assert_eq!(h, "0000000000000000000000000000002a");
    assert_eq!(hex_to_sheet_id(&h).unwrap(), sid);
}
