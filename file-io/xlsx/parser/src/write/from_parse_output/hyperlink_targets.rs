/// Whether a worksheet hyperlink target must be represented through a
/// relationship (`r:id`) rather than a plain worksheet `location` attribute.
///
/// Plain workbook anchors such as `Sheet1!A1` are written as `location`.
/// External URI schemes, file paths, and `#`-prefixed anchors preserve the
/// relationship-backed form used by Excel.
pub(super) fn needs_relationship(target: &str) -> bool {
    domain_types::domain::hyperlink::hyperlink_target_needs_relationship(target)
}

#[cfg(test)]
mod tests {
    use super::needs_relationship;

    #[test]
    fn parsed_relationship_location_is_written_once() {
        use super::relationship_target;
        assert_eq!(
            relationship_target("https://example.com#Sheet2!A1", Some("Sheet2!A1")),
            "https://example.com"
        );
        assert_eq!(
            relationship_target("https://example.com#Section", Some("#Section")),
            "https://example.com"
        );
        assert_eq!(
            relationship_target("https://example.com", Some("Section")),
            "https://example.com"
        );
        assert_eq!(
            relationship_target("#Sheet2!A1", Some("Sheet2!A1")),
            "#Sheet2!A1"
        );
        assert_eq!(
            relationship_target("https://example.com#Other", Some("Section")),
            "https://example.com#Other"
        );
    }

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

/// Parser targets include the location fragment; OPC stores that location on
/// the worksheet separately. Split it back out when serializing a parsed link.
pub(super) fn relationship_target<'a>(target: &'a str, location: Option<&str>) -> &'a str {
    if target.starts_with('#') {
        return target;
    }
    let Some(location) = location.filter(|value| !value.is_empty()) else {
        return target;
    };
    let fragment = location.strip_prefix('#').unwrap_or(location);
    target
        .strip_suffix(fragment)
        .and_then(|base| base.strip_suffix('#'))
        .unwrap_or(target)
}
