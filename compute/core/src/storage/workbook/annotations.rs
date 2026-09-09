use crate::engine_types::AnnotationRecord;
use crate::storage::WorkbookStorage;
use value_types::ComputeError;

pub(crate) fn set_table_annotation(
    storage: &mut WorkbookStorage,
    table: &str,
    record: &AnnotationRecord,
) -> Result<(), ComputeError> {
    crate::storage::engine::history::metadata::capture_workbook_entry!(
        storage,
        table_annotations,
        table
    );

    storage
        .metadata
        .table_annotations
        .insert(table.to_owned(), record.clone());
    Ok(())
}
pub(crate) fn get_table_annotation(
    storage: &WorkbookStorage,
    table: &str,
) -> Option<AnnotationRecord> {
    storage.metadata.table_annotations.get(table).cloned()
}
pub(crate) fn remove_table_annotation(
    storage: &mut WorkbookStorage,
    table: &str,
) -> Option<AnnotationRecord> {
    crate::storage::engine::history::metadata::capture_workbook_entry!(
        storage,
        table_annotations,
        table
    );

    storage.metadata.table_annotations.remove(table)
}
pub(crate) fn list_table_annotations(storage: &WorkbookStorage) -> Vec<AnnotationRecord> {
    let mut records: Vec<_> = storage
        .metadata
        .table_annotations
        .values()
        .cloned()
        .collect();
    records.sort_by(|a, b| a.anchor_id.cmp(&b.anchor_id).then_with(|| a.id.cmp(&b.id)));
    records
}
