//! Round-trip behavior tests for reusable XLSX namespace infrastructure.
//!
//! Raw workbook/worksheet XML replay helpers were intentionally removed. This
//! file now covers the shared namespace helper that remains part of current
//! writer behavior.

use xlsx_parser::{NS_RELATIONSHIPS, NS_SPREADSHEET_ML, NS_X14, NamespaceMap, NamespaceWriter};

mod namespace_round_trip {
    use super::*;

    #[test]
    fn test_worksheet_namespaces_captured() {
        let mut ns = NamespaceMap::new();

        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">"#;

        ns.capture_from_element(xml);

        assert_eq!(ns.default_namespace(), Some(NS_SPREADSHEET_ML));
        assert_eq!(ns.get_uri("r"), Some(NS_RELATIONSHIPS));
        assert_eq!(ns.get_uri("x14"), Some(NS_X14));
        assert!(ns.has_prefix("mc"));
    }

    #[test]
    fn test_custom_namespace_preserved_as_root_metadata() {
        let mut ns = NamespaceMap::new();

        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:gs="http://www.google.com/sheets/extensibility">"#;

        ns.capture_from_element(xml);

        let custom = ns.custom();
        assert_eq!(custom.len(), 1);
        assert_eq!(custom[0].prefix, Some("gs".to_string()));
        assert_eq!(custom[0].uri, "http://www.google.com/sheets/extensibility");
    }

    #[test]
    fn test_all_namespaces_emitted() {
        let mut ns = NamespaceMap::new();
        ns.capture_from_element(
            br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:custom="http://example.com/custom">"#,
        );

        let mut writer = NamespaceWriter::new();
        writer.write_all(&ns);

        let result = writer.finish();

        assert!(result.contains(NS_SPREADSHEET_ML));
        assert!(result.contains(NS_RELATIONSHIPS));
        assert!(result.contains("http://example.com/custom"));
    }

    #[test]
    fn test_namespace_prefixes_preserved_as_root_metadata() {
        let mut ns = NamespaceMap::new();

        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#;

        ns.capture_from_element(xml);

        assert!(ns.has_prefix("rel"));
        assert_eq!(ns.get_uri("rel"), Some(NS_RELATIONSHIPS));
    }

    #[test]
    fn test_empty_namespace_map() {
        let ns = NamespaceMap::new();
        assert!(ns.is_empty());
        assert_eq!(ns.default_namespace(), None);

        let mut writer = NamespaceWriter::new();
        writer.write_all(&ns);
        assert!(writer.finish().is_empty());
    }

    #[test]
    fn test_unicode_in_namespace_uri() {
        let mut ns = NamespaceMap::new();
        ns.add_prefixed("utf8", "http://example.com/hello");

        assert_eq!(ns.get_uri("utf8"), Some("http://example.com/hello"));
    }
}
