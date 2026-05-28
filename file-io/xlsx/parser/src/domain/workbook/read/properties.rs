use super::xml::extract_attr_value_in_range;
use crate::infra::scanner::{find_gt_simd, find_tag_simd};

/// Parse the workbook root `conformance` attribute.
pub fn parse_workbook_conformance(xml: &[u8]) -> Option<String> {
    let tag_start = find_tag_simd(xml, b"workbook", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    extract_attr_value_in_range(elem, b"conformance=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(ToOwned::to_owned)
}

/// Parse the `<workbookPr>` element from workbook.xml.
pub fn parse_workbook_properties(
    xml: &[u8],
) -> Option<domain_types::domain::workbook::WorkbookProperties> {
    let tag_start = find_tag_simd(xml, b"workbookPr", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_bool = |attr: &[u8], default: bool| -> bool {
        extract_attr_value_in_range(elem, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
            .unwrap_or(default)
    };
    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };
    let parse_u32 = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };

    let ooxml_pr = ooxml_types::workbook::WorkbookPr {
        date1904: parse_bool(b"date1904=\"", false),
        show_objects: extract_attr_value_in_range(elem, b"showObjects=\"")
            .map(ooxml_types::workbook::ObjectDisplayMode::from_bytes)
            .unwrap_or_default(),
        show_border_unselected_tables: parse_bool(b"showBorderUnselectedTables=\"", true),
        filter_privacy: parse_bool(b"filterPrivacy=\"", false),
        prompted_solutions: parse_bool(b"promptedSolutions=\"", false),
        show_ink_annotation: parse_bool(b"showInkAnnotation=\"", true),
        backup_file: parse_bool(b"backupFile=\"", false),
        save_external_link_values: parse_bool(b"saveExternalLinkValues=\"", true),
        update_links: extract_attr_value_in_range(elem, b"updateLinks=\"")
            .map(ooxml_types::workbook::UpdateLinks::from_bytes)
            .unwrap_or_default(),
        code_name: parse_str(b"codeName=\""),
        hide_pivot_field_list: parse_bool(b"hidePivotFieldList=\"", false),
        show_pivot_chart_filter: parse_bool(b"showPivotChartFilter=\"", false),
        allow_refresh_query: parse_bool(b"allowRefreshQuery=\"", false),
        publish_items: parse_bool(b"publishItems=\"", false),
        check_compatibility: parse_bool(b"checkCompatibility=\"", false),
        auto_compress_pictures: parse_bool(b"autoCompressPictures=\"", true),
        refresh_all_connections: parse_bool(b"refreshAllConnections=\"", false),
        default_theme_version: parse_u32(b"defaultThemeVersion=\""),
    };

    Some(ooxml_pr.into())
}

/// Parse the `<fileVersion>` element from workbook.xml.
pub fn parse_file_version(xml: &[u8]) -> Option<domain_types::domain::workbook::FileVersion> {
    let tag_start = find_tag_simd(xml, b"fileVersion", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };

    let ooxml_fv = ooxml_types::workbook::FileVersion {
        app_name: parse_str(b"appName=\""),
        last_edited: parse_str(b"lastEdited=\""),
        lowest_edited: parse_str(b"lowestEdited=\""),
        rup_build: parse_str(b"rupBuild=\""),
        code_name: parse_str(b"codeName=\""),
    };

    Some(ooxml_fv.into())
}

/// Parse the `<fileSharing>` element from workbook.xml.
pub fn parse_file_sharing(xml: &[u8]) -> Option<domain_types::domain::workbook::FileSharing> {
    let tag_start = find_tag_simd(xml, b"fileSharing", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_bool = |attr: &[u8], default: bool| -> bool {
        extract_attr_value_in_range(elem, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
            .unwrap_or(default)
    };
    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(|s| s.to_string())
    };
    let parse_u32 = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };

    let ooxml_fs = ooxml_types::workbook::FileSharing {
        read_only_recommended: parse_bool(b"readOnlyRecommended=\"", false),
        user_name: parse_str(b"userName=\""),
        reservation_password: parse_str(b"reservationPassword=\""),
        algorithm_name: parse_str(b"algorithmName=\""),
        hash_value: parse_str(b"hashValue=\""),
        salt_value: parse_str(b"saltValue=\""),
        spin_count: parse_u32(b"spinCount=\""),
    };

    Some(ooxml_fs.into())
}

/// Parse the `<webPublishing>` element from workbook.xml.
pub fn parse_web_publishing(
    xml: &[u8],
) -> Option<domain_types::domain::workbook::WorkbookWebPublishing> {
    let tag_start = find_tag_simd(xml, b"webPublishing", 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let elem = &xml[tag_start..tag_end];

    let parse_bool = |attr: &[u8]| -> Option<bool> {
        extract_attr_value_in_range(elem, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
    };
    let parse_u32 = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };
    let parse_str = |attr: &[u8]| -> Option<String> {
        extract_attr_value_in_range(elem, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .map(ToOwned::to_owned)
    };
    let target_screen_size = extract_attr_value_in_range(elem, b"targetScreenSize=\"")
        .and_then(|v| std::str::from_utf8(v).ok())
        .map(ooxml_types::web_publish::TargetScreenSize::from_ooxml);

    Some(domain_types::domain::workbook::WorkbookWebPublishing {
        css: parse_bool(b"css=\""),
        thicket: parse_bool(b"thicket=\""),
        long_file_names: parse_bool(b"longFileNames=\""),
        vml: parse_bool(b"vml=\""),
        allow_png: parse_bool(b"allowPng=\""),
        target_screen_size,
        dpi: parse_u32(b"dpi=\""),
        code_page: parse_u32(b"codePage=\""),
        character_set: parse_str(b"characterSet=\""),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_web_publishing() {
        let xml = br#"<?xml version="1.0"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <webPublishing css="1" thicket="0" longFileNames="1" vml="0" allowPng="1" targetScreenSize="1280x1024" dpi="150"/>
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;

        let web = parse_web_publishing(xml).expect("webPublishing should parse");
        assert_eq!(web.css, Some(true));
        assert_eq!(web.thicket, Some(false));
        assert_eq!(web.long_file_names, Some(true));
        assert_eq!(web.vml, Some(false));
        assert_eq!(web.allow_png, Some(true));
        assert_eq!(
            web.target_screen_size,
            Some(ooxml_types::web_publish::TargetScreenSize::Size1280x1024)
        );
        assert_eq!(web.dpi, Some(150));
    }

    #[test]
    fn parse_workbook_root_conformance() {
        let xml = br#"<workbook conformance="strict"><sheets/></workbook>"#;
        assert_eq!(parse_workbook_conformance(xml).as_deref(), Some("strict"));
    }

    #[test]
    fn workbook_properties_preserve_defaults_and_fields() {
        let xml =
            br#"<workbook><workbookPr date1904="1" defaultThemeVersion="166925"/></workbook>"#;

        let props = parse_workbook_properties(xml).expect("workbookPr should parse");
        assert!(props.date1904);
        assert_eq!(
            props.show_objects,
            domain_types::domain::workbook::ObjectDisplayMode::All
        );
        assert_eq!(
            props.update_links,
            domain_types::domain::workbook::UpdateLinks::UserSet
        );
        assert_eq!(props.default_theme_version, Some(166925));
        assert!(props.show_border_unselected_tables);
        assert!(props.show_ink_annotation);
        assert!(props.save_external_link_values);
        assert!(props.auto_compress_pictures);
    }

    #[test]
    fn file_version_maps_all_five_fields() {
        let xml = br#"<workbook><fileVersion appName="xl" lastEdited="7" lowestEdited="6" rupBuild="12345" codeName="ThisWorkbook"/></workbook>"#;

        let file_version = parse_file_version(xml).expect("fileVersion should parse");
        assert_eq!(file_version.app_name.as_deref(), Some("xl"));
        assert_eq!(file_version.last_edited.as_deref(), Some("7"));
        assert_eq!(file_version.lowest_edited.as_deref(), Some("6"));
        assert_eq!(file_version.rup_build.as_deref(), Some("12345"));
        assert_eq!(file_version.code_name.as_deref(), Some("ThisWorkbook"));
    }

    #[test]
    fn file_sharing_hash_fields_and_invalid_spin_count() {
        let xml = br#"<workbook><fileSharing readOnlyRecommended="1" userName="Ada" reservationPassword="ABCD" algorithmName="SHA-512" hashValue="hash" saltValue="salt" spinCount="invalid"/></workbook>"#;

        let sharing = parse_file_sharing(xml).expect("fileSharing should parse");
        assert!(sharing.read_only_recommended);
        assert_eq!(sharing.user_name.as_deref(), Some("Ada"));
        assert_eq!(sharing.reservation_password.as_deref(), Some("ABCD"));
        assert_eq!(sharing.algorithm_name.as_deref(), Some("SHA-512"));
        assert_eq!(sharing.hash_value.as_deref(), Some("hash"));
        assert_eq!(sharing.salt_value.as_deref(), Some("salt"));
        assert_eq!(sharing.spin_count, None);
    }

    #[test]
    fn web_publishing_absent_and_invalid_dpi() {
        assert_eq!(parse_web_publishing(b"<workbook/>"), None);

        let xml = br#"<workbook><webPublishing dpi="invalid" css="true"/></workbook>"#;
        let web = parse_web_publishing(xml).expect("webPublishing should parse");
        assert_eq!(web.css, Some(true));
        assert_eq!(web.dpi, None);
    }
}
