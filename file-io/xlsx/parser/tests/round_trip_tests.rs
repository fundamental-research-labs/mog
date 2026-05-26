//! Round-trip fidelity tests for XLSX files.
//!
//! These tests verify that XLSX files can be parsed and re-serialized with
//! minimal changes, preserving unknown elements, attribute order, and namespaces.

use xlsx_parser::{
    roundtrip::attr_order::{AttributeOrder, AttributeWriter},
    roundtrip::namespaces::{
        NS_RELATIONSHIPS, NS_SPREADSHEET_ML, NS_X14, NamespaceMap, NamespaceWriter,
    },
    roundtrip::unknown_elements::{PreservedElements, PreservedPosition, PreservedXml},
};

// ============================================================================
// Attribute Order Round-Trip Tests
// ============================================================================

mod attr_order_round_trip {
    use super::*;

    #[test]
    fn test_cell_attributes_preserved() {
        // Parse cell with unknown attributes
        let mut order = AttributeOrder::new();
        order.register_known("c", &["r", "s", "t"]);

        let cell_tag = br#"<c r="A1" x14:dyDescent="0.25" s="1" t="s">"#;
        order.capture_from_tag("worksheet/sheetData/row/c[A1]", cell_tag);

        // Verify unknown attribute preserved
        let unknown = order.get_unknown("worksheet/sheetData/row/c[A1]");
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].name, "dyDescent");
        assert_eq!(unknown[0].namespace_prefix, Some("x14".to_string()));

        // Re-emit with unknown attributes
        let mut writer = AttributeWriter::new();
        writer.write_with_unknown(
            &[("r", "A1"), ("s", "1"), ("t", "s")],
            &unknown.iter().map(|a| *a).collect::<Vec<_>>(),
        );

        let result = writer.finish();
        assert!(result.contains("x14:dyDescent=\"0.25\""));
    }

    #[test]
    fn test_row_attributes_preserved() {
        let mut order = AttributeOrder::new();
        order.register_known("row", &["r", "spans", "ht", "customHeight"]);

        let row_tag = br#"<row r="1" spans="1:10" x14ac:dyDescent="0.3" customHeight="1" ht="15">"#;
        order.capture_from_tag("worksheet/sheetData/row[1]", row_tag);

        let attrs = order.get("worksheet/sheetData/row[1]").unwrap();

        // Verify all attributes captured in order
        assert_eq!(attrs.ordered().len(), 5);
        assert_eq!(attrs.ordered()[0].name, "r");
        assert_eq!(attrs.ordered()[1].name, "spans");
        assert_eq!(attrs.ordered()[2].name, "dyDescent"); // x14ac namespace stripped

        // Verify unknown attribute
        let unknown = attrs.unknown();
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].full_name(), "x14ac:dyDescent");
    }

    #[test]
    fn test_sheet_view_attributes_preserved() {
        let mut order = AttributeOrder::new();
        order.register_known("sheetView", &["tabSelected", "workbookViewId", "zoomScale"]);

        let tag = br#"<sheetView tabSelected="1" customView="myView" workbookViewId="0" zoomScale="100">"#;
        order.capture_from_tag("worksheet/sheetViews/sheetView", tag);

        let unknown = order.get_unknown("worksheet/sheetViews/sheetView");
        assert_eq!(unknown.len(), 1);
        assert_eq!(unknown[0].name, "customView");
        assert_eq!(unknown[0].value, "myView");
    }
}

// ============================================================================
// Namespace Round-Trip Tests
// ============================================================================

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
    fn test_custom_namespace_preserved() {
        let mut ns = NamespaceMap::new();

        // Google Sheets adds custom namespaces
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

        // Verify all namespaces emitted
        assert!(result.contains(NS_SPREADSHEET_ML));
        assert!(result.contains(NS_RELATIONSHIPS));
        assert!(result.contains("http://example.com/custom"));
    }

    #[test]
    fn test_namespace_prefixes_preserved() {
        let mut ns = NamespaceMap::new();

        // LibreOffice might use different prefix conventions
        let xml = br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships">"#;

        ns.capture_from_element(xml);

        // Even though "rel" is non-standard prefix for relationships, it should be preserved
        assert!(ns.has_prefix("rel"));
        assert_eq!(ns.get_uri("rel"), Some(NS_RELATIONSHIPS));
    }
}

// ============================================================================
// Unknown Element Round-Trip Tests
// ============================================================================

mod unknown_elements_round_trip {
    use super::*;

    #[test]
    fn test_extension_list_preserved() {
        let mut preserved = PreservedElements::new();

        // Excel adds extLst elements with extensions
        let ext_xml = r#"<extLst><ext xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"><x14:conditionalFormattings><x14:conditionalFormatting/></x14:conditionalFormattings></ext></extLst>"#;

        preserved.add(PreservedXml::new(
            "worksheet",
            ext_xml,
            PreservedPosition::Last,
        ));

        assert_eq!(preserved.element_count(), 1);

        let last = preserved.get_last("worksheet");
        assert_eq!(last.len(), 1);
        assert!(last[0].raw_xml.contains("conditionalFormattings"));
    }

    #[test]
    fn test_sparklines_preserved() {
        let mut preserved = PreservedElements::new();

        let sparklines_xml = r#"<x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><x14:sparklineGroup/></x14:sparklineGroups>"#;

        preserved.add(PreservedXml::new(
            "worksheet/extLst/ext",
            sparklines_xml,
            PreservedPosition::First,
        ));

        let first = preserved.get_first("worksheet/extLst/ext");
        assert_eq!(first.len(), 1);
        assert!(first[0].raw_xml.contains("sparklineGroups"));
    }

    #[test]
    fn test_legacy_drawing_preserved() {
        let mut preserved = PreservedElements::new();

        // VML drawing reference (legacy comments)
        let vml_xml = r#"<legacyDrawing r:id="rId2"/>"#;

        preserved.add(PreservedXml::new(
            "worksheet",
            vml_xml,
            PreservedPosition::AfterElement("sheetData".to_string()),
        ));

        let after = preserved.get_after("worksheet", "sheetData");
        assert_eq!(after.len(), 1);
        assert!(after[0].raw_xml.contains("legacyDrawing"));
    }

    #[test]
    fn test_multiple_unknown_elements_at_positions() {
        let mut preserved = PreservedElements::new();

        // Header element
        preserved.add(PreservedXml::new(
            "worksheet",
            "<customHeader version=\"1\"/>",
            PreservedPosition::First,
        ));

        // Extension after sheetData
        preserved.add(PreservedXml::new(
            "worksheet",
            "<x14:dataValidations/>",
            PreservedPosition::AfterElement("sheetData".to_string()),
        ));

        // Footer element
        preserved.add(PreservedXml::new(
            "worksheet",
            "<customFooter/>",
            PreservedPosition::Last,
        ));

        assert_eq!(preserved.get_first("worksheet").len(), 1);
        assert_eq!(preserved.get_after("worksheet", "sheetData").len(), 1);
        assert_eq!(preserved.get_last("worksheet").len(), 1);
    }

    #[test]
    fn test_workbook_unknown_elements() {
        let mut preserved = PreservedElements::new();

        // Custom workbook properties
        preserved.add(PreservedXml::new(
            "workbook",
            "<customWorkbookProperties><prop name=\"author\" value=\"Test\"/></customWorkbookProperties>",
            PreservedPosition::Last,
        ));

        let elements = preserved.get_last("workbook");
        assert_eq!(elements.len(), 1);
        assert!(elements[0].raw_xml.contains("customWorkbookProperties"));
    }
}

// ============================================================================
// Integration Round-Trip Tests
// ============================================================================

mod integration_round_trip {
    use super::*;

    #[test]
    fn test_full_worksheet_round_trip() {
        // Simulate full worksheet parsing and re-serialization

        // 1. Parse namespaces
        let mut ns = NamespaceMap::new();
        ns.capture_from_element(
            br#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:custom="http://example.com/custom">"#,
        );

        // 2. Parse and preserve unknown elements
        let mut preserved = PreservedElements::new();
        preserved.add(PreservedXml::new(
            "worksheet",
            r#"<extLst><ext uri="{custom}"><custom:data/></ext></extLst>"#,
            PreservedPosition::Last,
        ));

        // 3. Parse attributes with unknown attrs
        let mut attr_order = AttributeOrder::new();
        attr_order.register_known("row", &["r", "spans", "ht"]);
        attr_order.capture_from_tag(
            "worksheet/sheetData/row[1]",
            b"<row r=\"1\" spans=\"1:5\" x14ac:dyDescent=\"0.25\">",
        );

        // 4. Re-emit worksheet
        let mut output = String::new();

        // Emit opening tag with namespaces
        output.push_str("<worksheet");
        let mut ns_writer = NamespaceWriter::new();
        ns_writer.write_all(&ns);
        output.push_str(&ns_writer.finish());
        output.push('>');

        // Emit sheetData with preserved attributes
        output.push_str("<sheetData>");
        output.push_str("<row");

        let row_attrs = attr_order.get("worksheet/sheetData/row[1]").unwrap();
        let unknown_attrs = row_attrs.unknown();

        let mut attr_writer = AttributeWriter::new();
        attr_writer.write_with_unknown(
            &[("r", "1"), ("spans", "1:5")],
            &unknown_attrs.iter().map(|a| *a).collect::<Vec<_>>(),
        );
        output.push_str(&attr_writer.finish());
        output.push_str("/>");

        output.push_str("</sheetData>");

        // Emit preserved elements at the end
        for elem in preserved.get_last("worksheet") {
            output.push_str(&elem.raw_xml);
        }

        output.push_str("</worksheet>");

        // Verify output contains all preserved content
        assert!(
            output.contains("xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"")
        );
        assert!(output.contains("xmlns:custom=\"http://example.com/custom\""));
        assert!(output.contains("x14ac:dyDescent=\"0.25\""));
        assert!(output.contains("<extLst>"));
        assert!(output.contains("<custom:data/>"));
    }

    #[test]
    fn test_styles_round_trip() {
        // Simulate styles.xml preservation

        let mut ns = NamespaceMap::new();
        ns.capture_from_element(
            br#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">"#,
        );

        let mut preserved = PreservedElements::new();
        preserved.add(PreservedXml::new(
            "styleSheet",
            r#"<x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1"/>"#,
            PreservedPosition::Last,
        ));

        // Verify namespace and element preserved
        assert!(ns.has_prefix("x14"));
        assert_eq!(preserved.element_count(), 1);
    }

    #[test]
    fn test_content_types_round_trip() {
        let mut ns = NamespaceMap::new();
        ns.capture_from_element(
            br#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#,
        );

        assert_eq!(
            ns.default_namespace(),
            Some("http://schemas.openxmlformats.org/package/2006/content-types")
        );
    }
}

// ============================================================================
// Edge Case Tests
// ============================================================================

mod edge_cases {
    use super::*;

    #[test]
    fn test_empty_unknown_elements() {
        let preserved = PreservedElements::new();
        assert!(preserved.get_first("worksheet").is_empty());
        assert!(preserved.get_last("worksheet").is_empty());
        assert!(preserved.get_after("worksheet", "sheetData").is_empty());
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
    fn test_attribute_order_no_known() {
        let mut order = AttributeOrder::new();
        // Don't register any known attributes

        order.capture_from_tag("element", b"<element a=\"1\" b=\"2\" c=\"3\">");

        let attrs = order.get("element").unwrap();

        // All attributes are unknown
        assert_eq!(attrs.unknown().len(), 3);
        assert_eq!(attrs.known().len(), 0);
    }

    #[test]
    fn test_special_characters_in_values() {
        let mut order = AttributeOrder::new();
        order.capture_from_tag("element", b"<element value=\"&lt;test&gt;\">");

        let attrs = order.get("element").unwrap();
        assert_eq!(attrs.get_value("value"), Some("<test>"));

        // Re-emit with encoding
        let mut writer = AttributeWriter::new();
        writer.write("value", "<test>");

        let result = writer.finish();
        assert!(result.contains("&lt;test&gt;"));
    }

    #[test]
    fn test_deeply_nested_paths() {
        let mut preserved = PreservedElements::new();
        preserved.add(PreservedXml::new(
            "workbook/sheets/sheet/extLst/ext/customData",
            "<nested/>",
            PreservedPosition::First,
        ));

        let elements = preserved.get_first("workbook/sheets/sheet/extLst/ext/customData");
        assert_eq!(elements.len(), 1);
    }

    #[test]
    fn test_unicode_in_namespace_uri() {
        let mut ns = NamespaceMap::new();
        ns.add_prefixed("utf8", "http://example.com/你好世界");

        assert_eq!(ns.get_uri("utf8"), Some("http://example.com/你好世界"));
    }
}
