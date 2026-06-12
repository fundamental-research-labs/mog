use super::*;

pub(in crate::storage::engine) fn legacy_full_table_from_attachment_entry(
    attachment_key: &str,
    json: &str,
) -> Option<CanonicalTable> {
    table_id_from_attachment_key(attachment_key)?;
    compute_document::range::legacy_full_table_from_workbook_binding_json(json)
}
