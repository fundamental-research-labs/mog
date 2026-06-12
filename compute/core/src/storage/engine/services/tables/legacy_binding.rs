use super::*;

pub(in crate::storage::engine) fn legacy_full_table_from_range_binding_entry(
    range_id: &str,
    json: &str,
) -> Option<CanonicalTable> {
    table_id_from_range_id(range_id)?;
    compute_document::range::legacy_full_table_from_workbook_binding_json(json)
}
