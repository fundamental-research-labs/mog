// -------------------------------------------------------------------
// Attachment key helpers
// -------------------------------------------------------------------

/// Derive a stable workbook-level table attachment key for a table ID.
///
/// Convention: `"table:<table_id>"` — allows `workbook.rangeBindings` to
/// distinguish table attachments from future workbook-level attachment kinds.
pub(in crate::storage::engine) fn table_attachment_key(table_id: &str) -> String {
    format!("table:{}", table_id)
}

/// Extract the table ID from an attachment key with the `"table:<table_id>"` convention.
pub(in crate::storage::engine) fn table_id_from_attachment_key(
    attachment_key: &str,
) -> Option<&str> {
    attachment_key.strip_prefix("table:")
}
