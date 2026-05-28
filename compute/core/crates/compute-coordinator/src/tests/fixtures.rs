use crate::{PushError, SyncCoordinator};
use cell_types::SheetId;
use yrs::{Doc, Map, MapRef, Transact};

pub(super) fn join(coord: &mut SyncCoordinator, name: &str) -> crate::JoinResult {
    coord.join(name.to_string())
}

pub(super) fn client_doc_from_join(jr: &crate::JoinResult) -> Doc {
    let doc = Doc::new();
    compute_collab::apply_update(&doc, &jr.full_state).unwrap();
    doc
}

pub(super) fn insert_into_map(doc: &Doc, map_name: &str, key: &str, value: &str) {
    let map: MapRef = doc.get_or_insert_map(map_name);
    let mut txn = doc.transact_mut();
    map.insert(&mut txn, key, value);
}

pub(super) fn read_map_key(doc: &Doc, map_name: &str, key: &str) -> Option<String> {
    let map: MapRef = doc.get_or_insert_map(map_name);
    let txn = doc.transact();
    map.get(&txn, key).map(|v| v.to_string(&txn))
}

pub(super) fn do_push(
    coord: &mut SyncCoordinator,
    participant: &str,
    client_doc: &Doc,
    touched_sheets: &[SheetId],
) -> Result<crate::PushResult, PushError> {
    let sv = compute_collab::encode_state_vector(client_doc);
    let server_sv = coord.state_vector();
    let diff = compute_collab::encode_diff(client_doc, &server_sv).unwrap();
    coord.push(&participant.to_string(), &diff, touched_sheets, &sv)
}

pub(super) fn do_pull(coord: &SyncCoordinator, participant: &str, client_doc: &Doc) {
    let sv = compute_collab::encode_state_vector(client_doc);
    let diff = coord.pull(&participant.to_string(), &sv).unwrap();
    compute_collab::apply_update(client_doc, &diff).unwrap();
}
