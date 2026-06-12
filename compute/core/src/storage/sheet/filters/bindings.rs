//! Yrs storage for durable runtime-to-lossless filter metadata bindings.

use std::sync::Arc;

use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_FILTER_METADATA_BINDINGS;
use compute_document::undo::{ORIGIN_BOOTSTRAP, ORIGIN_USER_EDIT};
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::FilterMetadataBinding;

const BINDING_JSON: &str = "json";

fn get_bindings_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_FILTER_METADATA_BINDINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

fn get_or_create_bindings_map(
    txn: &mut yrs::TransactionMut,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    if let Some(Out::YMap(m)) = sheet_map.get(txn, KEY_FILTER_METADATA_BINDINGS) {
        return Some(m);
    }
    sheet_map.insert(
        txn,
        KEY_FILTER_METADATA_BINDINGS,
        MapPrelim::from([] as [(&str, Any); 0]),
    );
    match sheet_map.get(txn, KEY_FILTER_METADATA_BINDINGS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

fn write_binding_entry(
    parent: &MapRef,
    txn: &mut yrs::TransactionMut,
    binding: &FilterMetadataBinding,
) {
    let Ok(json) = serde_json::to_string(binding) else {
        return;
    };
    parent.insert(
        txn,
        binding.filter_id.as_str(),
        MapPrelim::from([] as [(&str, Any); 0]),
    );
    let Some(Out::YMap(map)) = parent.get(txn, binding.filter_id.as_str()) else {
        return;
    };
    map.insert(txn, BINDING_JSON, Any::String(Arc::from(json.as_str())));
}

fn read_binding_entry<T: yrs::ReadTxn>(out: &Out, txn: &T) -> Option<FilterMetadataBinding> {
    let Out::YMap(map) = out else {
        return None;
    };
    let Some(Out::Any(Any::String(json))) = map.get(txn, BINDING_JSON) else {
        return None;
    };
    serde_json::from_str(&json).ok()
}

pub fn upsert_filter_metadata_binding_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    binding: &FilterMetadataBinding,
    origin: &'static [u8],
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(origin));
    let Some(bindings_map) = get_or_create_bindings_map(&mut txn, sheets, &sheet_hex) else {
        return;
    };
    write_binding_entry(&bindings_map, &mut txn, binding);
}

pub fn upsert_filter_metadata_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    binding: &FilterMetadataBinding,
) {
    upsert_filter_metadata_binding_with_origin(doc, sheets, sheet_id, binding, ORIGIN_USER_EDIT);
}

pub fn upsert_import_filter_metadata_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    binding: &FilterMetadataBinding,
) {
    upsert_filter_metadata_binding_with_origin(doc, sheets, sheet_id, binding, ORIGIN_BOOTSTRAP);
}

pub fn get_filter_metadata_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> Option<FilterMetadataBinding> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let bindings_map = get_bindings_map(&txn, sheets, &sheet_hex)?;
    let out = bindings_map.get(&txn, filter_id)?;
    read_binding_entry(&out, &txn)
}

pub fn get_filter_metadata_bindings_in_sheet(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<FilterMetadataBinding> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let Some(bindings_map) = get_bindings_map(&txn, sheets, &sheet_hex) else {
        return Vec::new();
    };
    bindings_map
        .iter(&txn)
        .filter_map(|(_, out)| read_binding_entry(&out, &txn))
        .collect()
}

pub fn delete_filter_metadata_binding_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
    origin: &'static [u8],
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(origin));
    let Some(bindings_map) = get_bindings_map(&txn, sheets, &sheet_hex) else {
        return false;
    };
    let existed = bindings_map.get(&txn, filter_id).is_some();
    bindings_map.remove(&mut txn, filter_id);
    existed
}

pub fn delete_filter_metadata_binding_in_txn(
    txn: &mut yrs::TransactionMut,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> bool {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let Some(bindings_map) = get_bindings_map(txn, sheets, &sheet_hex) else {
        return false;
    };
    let existed = bindings_map.get(txn, filter_id).is_some();
    bindings_map.remove(txn, filter_id);
    existed
}

pub fn delete_filter_metadata_binding(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    filter_id: &str,
) -> bool {
    delete_filter_metadata_binding_with_origin(doc, sheets, sheet_id, filter_id, ORIGIN_USER_EDIT)
}

pub fn delete_stale_filter_metadata_bindings_for_source_key_with_origin(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    binding: &FilterMetadataBinding,
    origin: &'static [u8],
) -> usize {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(origin));
    let Some(bindings_map) = get_bindings_map(&txn, sheets, &sheet_hex) else {
        return 0;
    };
    let stale_keys: Vec<String> = bindings_map
        .iter(&txn)
        .filter_map(|(key, out)| {
            read_binding_entry(&out, &txn)
                .filter(|existing| {
                    existing.filter_id != binding.filter_id
                        && existing.source_key == binding.source_key
                })
                .map(|_| key.to_string())
        })
        .collect();
    for key in &stale_keys {
        bindings_map.remove(&mut txn, key.as_str());
    }
    stale_keys.len()
}

pub fn clear_filter_metadata_bindings(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let Some(bindings_map) = get_bindings_map(&txn, sheets, &sheet_hex) else {
        return;
    };
    let keys: Vec<String> = bindings_map
        .iter(&txn)
        .map(|(key, _)| key.to_string())
        .collect();
    for key in keys {
        bindings_map.remove(&mut txn, key.as_str());
    }
}
