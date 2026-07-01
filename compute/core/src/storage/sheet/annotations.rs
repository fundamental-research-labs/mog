use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::schema::KEY_CELL_ANNOTATIONS;
use compute_document::undo::ORIGIN_USER_EDIT;
use value_types::ComputeError;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use crate::engine_types::AnnotationRecord;

fn read_record(value: Out) -> Option<AnnotationRecord> {
    match value {
        Out::Any(Any::String(json)) => serde_json::from_str::<AnnotationRecord>(&json).ok(),
        _ => None,
    }
}

fn get_annotations_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets.get(txn, sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_CELL_ANNOTATIONS) {
        Some(Out::YMap(map)) => Some(map),
        _ => None,
    }
}

fn ensure_annotations_map(
    txn: &mut yrs::TransactionMut<'_>,
    sheets: &MapRef,
    sheet_hex: &str,
) -> Result<MapRef, ComputeError> {
    let sheet_map = match sheets.get(txn, sheet_hex) {
        Some(Out::YMap(map)) => map,
        _ => {
            return Err(ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            });
        }
    };
    Ok(match sheet_map.get(txn, KEY_CELL_ANNOTATIONS) {
        Some(Out::YMap(map)) => map,
        _ => sheet_map.insert(txn, KEY_CELL_ANNOTATIONS, MapPrelim::default()),
    })
}

pub(crate) fn set_cell_annotation(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
    record: &AnnotationRecord,
) -> Result<(), ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let json = serde_json::to_string(record).map_err(|err| ComputeError::Eval {
        message: format!("serialize cell annotation: {}", err),
    })?;
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let annotations_map = ensure_annotations_map(&mut txn, sheets, &sheet_hex)?;
    annotations_map.insert(&mut txn, cell_id, Any::String(json.into()));
    Ok(())
}

pub(crate) fn get_cell_annotation(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<AnnotationRecord> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let annotations_map = get_annotations_map(&txn, sheets, &sheet_hex)?;
    annotations_map.get(&txn, cell_id).and_then(read_record)
}

pub(crate) fn remove_cell_annotation(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<AnnotationRecord> {
    let existing = get_cell_annotation(doc, sheets, sheet_id, cell_id);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(annotations_map) = get_annotations_map(&txn, sheets, &sheet_hex) {
        annotations_map.remove(&mut txn, cell_id);
    }
    existing
}

pub(crate) fn list_cell_annotations(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<AnnotationRecord> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let txn = doc.transact();
    let Some(annotations_map) = get_annotations_map(&txn, sheets, &sheet_hex) else {
        return Vec::new();
    };
    let mut records: Vec<AnnotationRecord> = annotations_map
        .iter(&txn)
        .filter_map(|(_key, value)| read_record(value))
        .collect();
    records.sort_by(|a, b| a.anchor_id.cmp(&b.anchor_id).then_with(|| a.id.cmp(&b.id)));
    records
}
