use crate::engine_types::AnnotationRecord;
use crate::storage::WorkbookStorage;
use cell_types::{CellId, SheetId};
use value_types::ComputeError;

fn wire(record: &AnnotationRecord<CellId>) -> AnnotationRecord {
    record
        .clone()
        .map_anchor(|id| compute_document::hex::id_to_hex(id.as_u128()).to_string())
}

pub(crate) fn set_cell_annotation(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    cell: &str,
    record: &AnnotationRecord,
) -> Result<(), ComputeError> {
    let id = CellId::from_uuid_str(cell).map_err(|_| ComputeError::InvalidInput {
        message: format!("Invalid annotation cell identity: {cell}"),
    })?;
    let metadata =
        storage
            .sheet_metadata
            .get_mut(sheet)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet.to_uuid_string(),
            })?;
    metadata
        .cell_annotations
        .insert(id, record.clone().map_anchor(|_| id));
    Ok(())
}
pub(crate) fn get_cell_annotation(
    storage: &WorkbookStorage,
    sheet: &SheetId,
    cell: &str,
) -> Option<AnnotationRecord> {
    let id = CellId::from_uuid_str(cell).ok()?;
    storage
        .sheet_metadata
        .get(sheet)?
        .cell_annotations
        .get(&id)
        .map(wire)
}
pub(crate) fn remove_cell_annotation(
    storage: &mut WorkbookStorage,
    sheet: &SheetId,
    cell: &str,
) -> Option<AnnotationRecord> {
    let id = CellId::from_uuid_str(cell).ok()?;
    storage
        .sheet_metadata
        .get_mut(sheet)?
        .cell_annotations
        .remove(&id)
        .as_ref()
        .map(wire)
}
pub(crate) fn list_cell_annotations(
    storage: &WorkbookStorage,
    sheet: &SheetId,
) -> Vec<AnnotationRecord> {
    let mut records: Vec<_> = storage
        .sheet_metadata
        .get(sheet)
        .into_iter()
        .flat_map(|metadata| metadata.cell_annotations.values())
        .map(wire)
        .collect();
    records.sort_by(|a, b| a.anchor_id.cmp(&b.anchor_id).then_with(|| a.id.cmp(&b.id)));
    records
}
