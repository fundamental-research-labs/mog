use yrs::{Doc, Map, MapRef, Transact};

pub(super) fn setup() -> (Doc, MapRef) {
    let doc = Doc::new();
    let map = doc.get_or_insert_map("sheets");
    (doc, map)
}

pub(super) fn insert_with_origin(
    doc: &Doc,
    map: &MapRef,
    origin: &'static [u8],
    key: &str,
    value: &str,
) {
    let mut txn = doc.transact_mut_with(origin);
    map.insert(&mut txn, key, value);
}

pub(super) fn assert_present(doc: &Doc, map: &MapRef, key: &str) {
    let txn = doc.transact();
    assert!(map.get(&txn, key).is_some(), "{key} should exist");
}

pub(super) fn assert_missing(doc: &Doc, map: &MapRef, key: &str) {
    let txn = doc.transact();
    assert!(map.get(&txn, key).is_none(), "{key} should be absent");
}
