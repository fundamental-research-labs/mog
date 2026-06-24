use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_PROPERTIES;
use domain_types::{SheetCommentPackageInfo, SheetDrawingPackageInfo};
use serde::de::DeserializeOwned;
use yrs::{Any, Map, MapRef, Out, ReadTxn, Transact};

use crate::storage::engine::stores::EngineStores;

pub(in crate::storage::engine) fn export_comment_package_metadata(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> (
    Vec<String>,
    Option<SheetCommentPackageInfo>,
    Option<SheetDrawingPackageInfo>,
) {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = stores.storage.doc().transact();
    let sheet_map = match stores.storage.sheets().get(&txn, &sheet_hex) {
        Some(Out::YMap(sheet_map)) => Some(sheet_map),
        _ => None,
    };
    let meta_map = sheet_map
        .as_ref()
        .and_then(|sheet| match sheet.get(&txn, KEY_PROPERTIES) {
            Some(Out::YMap(meta)) => Some(meta),
            _ => None,
        });

    (
        read_json_from_map(meta_map.as_ref(), &txn, "legacyCommentAuthors")
            .or_else(|| read_json_from_map(sheet_map.as_ref(), &txn, "legacyCommentAuthors"))
            .unwrap_or_default(),
        read_json_from_map(meta_map.as_ref(), &txn, "commentPackage")
            .or_else(|| read_json_from_map(sheet_map.as_ref(), &txn, "commentPackage")),
        read_json_from_map(meta_map.as_ref(), &txn, "drawingPackage")
            .or_else(|| read_json_from_map(sheet_map.as_ref(), &txn, "drawingPackage")),
    )
}

fn read_json_from_map<T, R>(map: Option<&MapRef>, txn: &R, key: &str) -> Option<T>
where
    T: DeserializeOwned,
    R: ReadTxn,
{
    match map?.get(txn, key) {
        Some(Out::Any(Any::String(json))) => serde_json::from_str(&json).ok(),
        _ => None,
    }
}
