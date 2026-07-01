use compute_document::schema::KEY_TABLE_ANNOTATIONS;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapRef, Origin, Out, Transact};

use crate::engine_types::AnnotationRecord;

fn read_record(value: Out) -> Option<AnnotationRecord> {
    match value {
        Out::Any(Any::String(json)) => serde_json::from_str::<AnnotationRecord>(&json).ok(),
        _ => None,
    }
}

fn get_annotations_map<T: yrs::ReadTxn>(txn: &T, workbook: &MapRef) -> Option<MapRef> {
    match workbook.get(txn, KEY_TABLE_ANNOTATIONS) {
        Some(Out::YMap(map)) => Some(map),
        _ => None,
    }
}

pub(crate) fn set_table_annotation(
    doc: &Doc,
    workbook: &MapRef,
    table_id: &str,
    record: &AnnotationRecord,
) -> Result<(), ComputeError> {
    let json = serde_json::to_string(record).map_err(|err| ComputeError::Eval {
        message: format!("serialize table annotation: {}", err),
    })?;
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let annotations_map =
        crate::storage::ensure_workbook_child_map(workbook, &mut txn, KEY_TABLE_ANNOTATIONS);
    annotations_map.insert(&mut txn, table_id, Any::String(json.into()));
    Ok(())
}

pub(crate) fn get_table_annotation(
    doc: &Doc,
    workbook: &MapRef,
    table_id: &str,
) -> Option<AnnotationRecord> {
    let txn = doc.transact();
    let annotations_map = get_annotations_map(&txn, workbook)?;
    annotations_map.get(&txn, table_id).and_then(read_record)
}

pub(crate) fn remove_table_annotation(
    doc: &Doc,
    workbook: &MapRef,
    table_id: &str,
) -> Option<AnnotationRecord> {
    let existing = get_table_annotation(doc, workbook, table_id);
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(annotations_map) = get_annotations_map(&txn, workbook) {
        annotations_map.remove(&mut txn, table_id);
    }
    existing
}

pub(crate) fn list_table_annotations(doc: &Doc, workbook: &MapRef) -> Vec<AnnotationRecord> {
    let txn = doc.transact();
    let Some(annotations_map) = get_annotations_map(&txn, workbook) else {
        return Vec::new();
    };
    let mut records: Vec<AnnotationRecord> = annotations_map
        .iter(&txn)
        .filter_map(|(_key, value)| read_record(value))
        .collect();
    records.sort_by(|a, b| a.anchor_id.cmp(&b.anchor_id).then_with(|| a.id.cmp(&b.id)));
    records
}
