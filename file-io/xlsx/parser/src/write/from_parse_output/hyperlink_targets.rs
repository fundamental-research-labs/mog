/// Whether a worksheet hyperlink target must be represented through a
/// relationship (`r:id`) rather than a plain worksheet `location` attribute.
///
/// Plain workbook anchors such as `Sheet1!A1` are written as `location`.
/// External URI schemes, file paths, and `#`-prefixed anchors preserve the
/// relationship-backed form used by Excel.
pub(super) fn needs_relationship(target: &str) -> bool {
    target.starts_with('#')
        || target.contains("://")
        || target
            .split_once(':')
            .is_some_and(|(scheme, _)| is_uri_scheme(scheme))
        || target.starts_with("\\\\")
        || looks_like_external_file_path(target)
}

fn is_uri_scheme(scheme: &str) -> bool {
    !scheme.is_empty()
        && scheme
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'-' | b'.'))
}

fn looks_like_external_file_path(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.ends_with(".xlsx")
        || lower.ends_with(".xlsm")
        || lower.ends_with(".xls")
        || lower.ends_with(".csv")
        || lower.starts_with("../")
        || lower.starts_with("./")
        || lower.contains('\\')
}

#[cfg(test)]
mod tests {
    use super::needs_relationship;

    #[test]
    fn external_uri_schemes_need_relationships() {
        assert!(needs_relationship("https://example.com"));
        assert!(needs_relationship("mailto:test@example.com"));
        assert!(needs_relationship("tel:+15551234567"));
    }

    #[test]
    fn workbook_locations_do_not_need_relationships() {
        assert!(!needs_relationship("Sheet2!A1"));
        assert!(!needs_relationship("'Sheet 2'!A1"));
    }

    #[test]
    fn relationship_backed_internal_and_file_targets_need_relationships() {
        assert!(needs_relationship("#Sheet2!A1"));
        assert!(needs_relationship("../other.xlsx"));
        assert!(needs_relationship(r"C:\Docs\book.xlsx"));
    }
}
