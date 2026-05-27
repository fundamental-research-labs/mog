use super::styles::hex_to_color_def;
use super::*;
use crate::domain::content_types::write::{CT_PIVOT_CACHE, CT_PIVOT_TABLE};
use crate::domain::styles::write::ColorDef;
use crate::infra::package_integrity::validate_archive_package_integrity;
use crate::write::REL_PIVOT_TABLE;
use domain_types::domain::workbook::{FileSharing, FileVersion, WorkbookProperties};
use domain_types::{
    AlignmentFormat, AnchorPosition, AuthoredStyleRun, BorderFormat,
    BorderSide as DomainBorderSide, CFCellRange, CFRule, CFStyle, CellData as DomainCellData,
    CellValue as DomainValue, ChartSpec, ChartType, ColDimension, ColStyleEntry, Comment,
    CommentType, ConditionalFormat, DataTableOoxmlFlags, DataTableRegion, DocumentFormat,
    DocumentProperties, FillFormat, FontFormat, FrozenPane, Hyperlink, MergeRegion, NamedRange,
    ObjectSize, ParseOutput, PersonInfo, RowDimension, SheetData, SheetDimensions, TableColumnSpec,
    TableSpec, WorkbookView,
};
use formula_types::CellRef;
use ooxml_types::cond_format::CfOperator;
use std::sync::Arc;
use value_types::{CellError, FiniteF64};

const CT_PIVOT_CACHE_RECORDS: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml";

fn make_parse_output(sheets: Vec<SheetData>) -> ParseOutput {
    ParseOutput {
        sheets,
        ..Default::default()
    }
}

#[test]
fn raw_doc_props_do_not_override_modeled_document_properties() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.properties = Some(DocumentProperties {
        title: Some("Modeled Title".to_string()),
        creator: Some("Modeled Creator".to_string()),
        custom: vec![("ReviewStatus".to_string(), "Modeled".to_string())],
        ..Default::default()
    });
    let ctx = domain_types::RoundTripContext {
        raw_doc_props_core_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Stale Title</dc:title><dc:creator>Stale Creator</dc:creator></cp:coreProperties>"#
                .to_vec(),
        ),
        raw_doc_props_app_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Excel</Application><Company>Stale Company</Company></Properties>"#
                .to_vec(),
        ),
        raw_doc_props_custom_xml: Some(
            br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="ReviewStatus"><vt:lpwstr>Stale</vt:lpwstr></property></Properties>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let core_xml = String::from_utf8(archive.read_file("docProps/core.xml").unwrap()).unwrap();
    let app_xml = String::from_utf8(archive.read_file("docProps/app.xml").unwrap()).unwrap();
    let custom_xml = String::from_utf8(archive.read_file("docProps/custom.xml").unwrap()).unwrap();

    assert!(core_xml.contains("Modeled Title"));
    assert!(core_xml.contains("Modeled Creator"));
    assert!(!core_xml.contains("Stale Title"));
    assert!(!app_xml.contains("Stale Company"));
    assert!(custom_xml.contains(r#"name="ReviewStatus""#));
    assert!(custom_xml.contains(">Modeled<"));
    assert!(!custom_xml.contains(">Stale<"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_doc_props_are_dropped_when_document_properties_are_unmodeled() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_doc_props_core_xml: Some(b"<cp:coreProperties/>".to_vec()),
        raw_doc_props_app_xml: Some(b"<Properties/>".to_vec()),
        raw_doc_props_custom_xml: Some(b"<Properties/>".to_vec()),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("docProps/core.xml"));
    assert!(!archive.contains("docProps/app.xml"));
    assert!(!archive.contains("docProps/custom.xml"));
    assert!(!root_rels.contains("docProps/"));
    assert!(!content_types.contains("docProps/"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn workbook_views_are_exported_from_modeled_state_not_roundtrip_context() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.workbook_views = vec![WorkbookView {
        active_tab: 0,
        first_sheet: 0,
        tab_ratio: Some(700.0),
        window_width: Some(12345),
        ..Default::default()
    }];
    let ctx = domain_types::RoundTripContext {
        workbook_views: vec![WorkbookView {
            active_tab: 0,
            first_sheet: 0,
            tab_ratio: Some(300.0),
            window_width: Some(999),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"tabRatio="700""#));
    assert!(workbook_xml.contains(r#"windowWidth="12345""#));
    assert!(!workbook_xml.contains(r#"tabRatio="300""#));
    assert!(!workbook_xml.contains(r#"windowWidth="999""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn workbook_metadata_is_exported_from_modeled_state_not_preserved_xml() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.file_version = Some(FileVersion {
        app_name: Some("xl".to_string()),
        last_edited: Some("7".to_string()),
        lowest_edited: Some("7".to_string()),
        rup_build: Some("28130".to_string()),
        code_name: Some("ModeledVersion".to_string()),
    });
    output.file_sharing = Some(FileSharing {
        read_only_recommended: true,
        user_name: Some("Modeled User".to_string()),
        reservation_password: Some("ABCD".to_string()),
        ..Default::default()
    });
    output.workbook_properties = Some(WorkbookProperties {
        date1904: true,
        code_name: Some("ModeledCode".to_string()),
        default_theme_version: Some(166925),
        ..Default::default()
    });
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![
            (
                "workbook\0first\0\0fileVersion".to_string(),
                r#"<fileVersion appName="StaleApp" codeName="StaleVersion"/>"#.to_string(),
            ),
            (
                "workbook\0after\0fileVersion\0fileSharing".to_string(),
                r#"<fileSharing readOnlyRecommended="0" userName="Stale User"/>"#.to_string(),
            ),
            (
                "workbook\0after\0fileVersion\0workbookPr".to_string(),
                r#"<workbookPr codeName="StaleCode" defaultThemeVersion="1"/>"#.to_string(),
            ),
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"<fileVersion appName="xl" lastEdited="7""#));
    assert!(workbook_xml.contains(r#"codeName="ModeledVersion""#));
    assert!(workbook_xml.contains(r#"<fileSharing readOnlyRecommended="1""#));
    assert!(workbook_xml.contains(r#"userName="Modeled User""#));
    assert!(workbook_xml.contains(r#"<workbookPr date1904="1""#));
    assert!(workbook_xml.contains(r#"codeName="ModeledCode""#));
    assert!(workbook_xml.contains(r#"defaultThemeVersion="166925""#));
    assert!(!workbook_xml.contains("StaleApp"));
    assert!(!workbook_xml.contains("StaleVersion"));
    assert!(!workbook_xml.contains("Stale User"));
    assert!(!workbook_xml.contains("StaleCode"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_preserved_known_children_are_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![
            (
                "workbook\0after\0workbookPr\0bookViews".to_string(),
                r#"<bookViews><workbookView activeTab="9" windowWidth="999"/></bookViews>"#
                    .to_string(),
            ),
            (
                "workbook\0after\0sheets\0workbookProtection".to_string(),
                r#"<workbookProtection lockStructure="1"/>"#.to_string(),
            ),
            (
                "workbook\0after\0workbookProtection\0definedNames".to_string(),
                r#"<definedNames><definedName name="StaleName">Sheet1!$A$1</definedName></definedNames>"#
                    .to_string(),
            ),
            (
                "workbook\0after\0definedNames\0calcPr".to_string(),
                r#"<calcPr calcId="999999"/>"#.to_string(),
            ),
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("activeTab=\"9\""));
    assert!(!workbook_xml.contains("windowWidth=\"999\""));
    assert!(!workbook_xml.contains("<workbookProtection"));
    assert!(!workbook_xml.contains("StaleName"));
    assert!(!workbook_xml.contains("999999"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_sheet_drawing_relationship_without_modeled_or_opaque_drawing_is_ignored() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing1.xml".to_string(),
                target_mode: None,
            }],
            original_drawing_path: Some("xl/drawings/drawing1.xml".to_string()),
            drawing_anchor_passthroughs: vec![(
                0,
                r#"<xdr:twoCellAnchor><xdr:graphicFrame><a:graphic><a:graphicData><cx:chart r:id="rId99"/></a:graphicData></a:graphic></xdr:graphicFrame></xdr:twoCellAnchor>"#
                    .to_string(),
            )],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/drawings/drawing1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_workbook_relationship_uses_graph_resolved_id() {
    let modeled_link = domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "externalLinks/externalLink9.xml".to_string(),
                external_book_rid: None,
                target: Some("externalLinks/externalLink9.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    };
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![modeled_link.clone()];
    let ctx = domain_types::RoundTripContext {
        external_links: vec![modeled_link],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"<externalReference r:id="rId20"/>"#));
    assert!(workbook_rels.contains(r#"Id="rId20""#));
    assert!(workbook_rels.contains(r#"Target="externalLinks/externalLink9.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/externalLinks/externalLink9.xml""#));
    assert!(archive.contains("xl/externalLinks/externalLink9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn external_link_owned_relationships_use_graph_resolved_ids() {
    let modeled_link = domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        file_path: Some("file:///workbook.xlsx".to_string()),
        file_path_rid: Some("rId1".to_string()),
        alternate_url: Some("https://example.com/workbook.xlsx".to_string()),
        alternate_url_rid: Some("rId1".to_string()),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "externalLinks/externalLink9.xml".to_string(),
                external_book_rid: Some("rId1".to_string()),
                target: Some("externalLinks/externalLink9.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    };
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![modeled_link];

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let link_xml = String::from_utf8(
        archive
            .read_file("xl/externalLinks/externalLink9.xml")
            .unwrap(),
    )
    .unwrap();
    let link_rels = String::from_utf8(
        archive
            .read_file("xl/externalLinks/_rels/externalLink9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(link_xml.contains(r#"<externalBook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1">"#));
    assert!(link_xml.contains(r#"<xxl21:absoluteUrl r:id="rId2"/>"#));
    assert!(link_rels.contains(r#"Id="rId1""#));
    assert!(link_rels.contains(r#"Target="file:///workbook.xlsx""#));
    assert!(link_rels.contains(r#"Id="rId2""#));
    assert!(link_rels.contains(r#"Target="https://example.com/workbook.xlsx""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_roundtrip_external_links_do_not_export_without_modeled_links() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        external_links: vec![domain_types::domain::external_link::ExternalLink {
            id: "1".to_string(),
            imported_identity: Some(
                domain_types::domain::external_link::ImportedExternalLinkIdentity {
                    excel_ordinal: 1,
                    workbook_rel_id: "rId20".to_string(),
                    part_name: "externalLinks/externalLink9.xml".to_string(),
                    external_book_rid: None,
                    target: Some("externalLinks/externalLink9.xml".to_string()),
                    target_mode: None,
                },
            ),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!workbook_xml.contains("<externalReferences"));
    assert!(!workbook_rels.contains(crate::write::relationships::REL_EXTERNAL_LINK));
    assert!(!content_types.contains("/xl/externalLinks/"));
    assert!(!archive.contains("xl/externalLinks/externalLink9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_workbook_external_references_do_not_override_modeled_external_links() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.external_links = vec![domain_types::domain::external_link::ExternalLink {
        id: "1".to_string(),
        imported_identity: Some(
            domain_types::domain::external_link::ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId20".to_string(),
                part_name: "externalLinks/externalLink9.xml".to_string(),
                external_book_rid: None,
                target: Some("externalLinks/externalLink9.xml".to_string()),
                target_mode: None,
            },
        ),
        ..Default::default()
    }];
    let ctx = domain_types::RoundTripContext {
        workbook_preserved_elements: vec![(
            "workbook\0after\0workbookProtection\0externalReferences".to_string(),
            r#"<externalReferences><externalReference r:id="rIdStale"/></externalReferences>"#
                .to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert_eq!(workbook_xml.matches("<externalReferences>").count(), 1);
    assert!(workbook_xml.contains(r#"<externalReference r:id="rId20"/>"#));
    assert!(!workbook_xml.contains("rIdStale"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn persons_are_exported_from_modeled_state_not_raw_person_xml() {
    let mut output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    output.persons = vec![PersonInfo {
        id: "{MODELED-PERSON}".to_string(),
        display_name: "Modeled Person".to_string(),
        user_id: Some("S::modeled@example.com::1".to_string()),
        provider_id: Some("AD".to_string()),
    }];
    let ctx = domain_types::RoundTripContext {
        raw_persons_xml: Some(
            br#"<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Stale Person" id="{STALE-PERSON}" userId="stale"/></personList>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let persons_xml =
        String::from_utf8(archive.read_file("xl/persons/person.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(persons_xml.contains("Modeled Person"));
    assert!(persons_xml.contains("{MODELED-PERSON}"));
    assert!(!persons_xml.contains("Stale Person"));
    assert!(!persons_xml.contains("{STALE-PERSON}"));
    assert!(workbook_rels.contains("persons/person.xml"));
    assert!(content_types.contains(r#"PartName="/xl/persons/person.xml""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_raw_person_xml_is_dropped_without_modeled_persons() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_persons_xml: Some(
            br#"<personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Stale Person" id="{STALE-PERSON}"/></personList>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/persons/person.xml"));
    assert!(!workbook_rels.contains("persons/person.xml"));
    assert!(!content_types.contains("/xl/persons/person.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_doc_metadata_label_info_is_not_emitted_as_raw_sidecar() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        doc_metadata_label_info: Some(
            br#"<clbl:labelList xmlns:clbl="http://schemas.microsoft.com/office/2020/mipLabelMetadata"><clbl:label id="stale"/></clbl:labelList>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("docMetadata/LabelInfo.xml"));
    assert!(!content_types.contains("/docMetadata/LabelInfo.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_raw_metadata_xml_is_dropped_without_current_cell_metadata_references() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Text(Arc::from("ordinary cell")),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_metadata_xml: Some(
            br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/metadata.xml"));
    assert!(!workbook_rels.contains(crate::write::relationships::REL_METADATA));
    assert!(!content_types.contains("/xl/metadata.xml"));
    assert!(!sheet_xml.contains(r#" vm="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_metadata_xml_is_not_replayed_for_current_cell_metadata_references() {
    let mut metadata_cell = make_cell(0, 0, DomainValue::Text(Arc::from("dynamic")));
    metadata_cell.cm = true;
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![metadata_cell],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_metadata_xml: Some(
            br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/metadata.xml"));
    assert!(!workbook_rels.contains(crate::write::relationships::REL_METADATA));
    assert!(!content_types.contains("/xl/metadata.xml"));
    assert!(!sheet_xml.contains(r#" cm="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_raw_worksheet_ext_lst_modeled_extensions_are_dropped() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            ext_lst_xml: Some(
                r#"<extLst><ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"/></ext></extLst>"#
                    .to_string(),
            ),
            sheet_preserved_elements: vec![(
                "worksheet\0after\0tableParts\0extLst".to_string(),
                r#"<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}"><x14:conditionalFormattings count="1"/></ext></extLst>"#
                    .to_string(),
            )],
            has_empty_ext_lst: true,
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<extLst"));
    assert!(!sheet_xml.contains("dataValidations"));
    assert!(!sheet_xml.contains("conditionalFormattings"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_sheet_preserved_known_children_are_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_preserved_elements: vec![
                (
                    "worksheet\0after\0sheetData\0sheetProtection".to_string(),
                    r#"<sheetProtection sheet="1" password="STALE"/>"#.to_string(),
                ),
                (
                    "worksheet\0after\0sheetData\0autoFilter".to_string(),
                    r#"<autoFilter ref="A1:Z99"/>"#.to_string(),
                ),
                (
                    "worksheet\0after\0mergeCells\0dataValidations".to_string(),
                    r#"<dataValidations count="1"><dataValidation sqref="A1"/></dataValidations>"#
                        .to_string(),
                ),
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<sheetProtection"));
    assert!(!sheet_xml.contains("<autoFilter"));
    assert!(!sheet_xml.contains("<dataValidations"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unknown_raw_worksheet_ext_lst_is_preserved_without_modeled_owner() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            ext_lst_xml: Some(r#"<extLst><ext uri="{vendor-extension}"/></extLst>"#.to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<extLst><ext uri="{vendor-extension}"/></extLst>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_original_dimension_is_dropped_when_cells_change() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(1.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            original_dimension: Some("A1:Z99".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<dimension ref="A1:A1"/>"#));
    assert!(!sheet_xml.contains("A1:Z99"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn matching_original_dimension_remains_as_identity_hint() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(2.0).unwrap())),
        ],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            original_dimension: Some("A1:B2".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<dimension ref="A1:B2"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_row_roundtrip_hints_do_not_create_deleted_rows() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            row_spans: [(9, "1:99".to_string())].into_iter().collect(),
            row_thick_bot: vec![9],
            row_thick_top: vec![9],
            row_collapsed: [(9, true)].into_iter().collect(),
            row_hidden_explicit_false: vec![9],
            row_outline_level_zero: vec![9],
            bare_empty_rows: vec![9],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains(r#"<row r="10""#));
    assert!(!sheet_xml.contains("spans=\"1:99\""));
    assert!(!sheet_xml.contains("thickBot"));
    assert!(!sheet_xml.contains("thickTop"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn row_roundtrip_hints_decorate_current_modeled_rows() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(1.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            row_spans: [(0, "1:1".to_string())].into_iter().collect(),
            row_thick_bot: vec![0],
            row_thick_top: vec![0],
            row_collapsed: [(0, false)].into_iter().collect(),
            row_hidden_explicit_false: vec![0],
            row_outline_level_zero: vec![0],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    let row_xml = sheet_xml
        .split("<row ")
        .find(|row| row.contains(r#"r="1""#))
        .expect("modeled row should be emitted");
    assert!(row_xml.contains(r#"spans="1:1""#));
    assert!(row_xml.contains(r#"hidden="0""#));
    assert!(row_xml.contains(r#"outlineLevel="0""#));
    assert!(row_xml.contains(r#"collapsed="0""#));
    assert!(row_xml.contains(r#"thickTop="1""#));
    assert!(row_xml.contains(r#"thickBot="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn dirty_typed_opaque_subgraph_suppresses_legacy_custom_xml_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let custom_part = domain_types::BlobPart {
        path: "customXml/item1.xml".to_string(),
        data: b"<stale/>".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        content_type_overrides: vec![(
            "/customXml/item1.xml".to_string(),
            "application/xml".to_string(),
        )],
        custom_xml_parts: vec![custom_part.clone()],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Workbook,
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Workbook,
                relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                        .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: custom_part.path.clone(),
                },
                relationship_id_hint: Some("rId99".to_string()),
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: custom_part,
                content_type: Some("application/xml".to_string()),
                default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                ownership: domain_types::OpaquePackageOwnership::DirtyImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::DirtyImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/item1.xml"));
    assert!(!workbook_rels.contains("customXml"));
    assert!(!content_types.contains("/customXml/item1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_and_deleted_typed_opaque_subgraphs_are_not_raw_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let generated_part = domain_types::BlobPart {
        path: "customXml/generated.xml".to_string(),
        data: b"<generated/>".to_vec(),
    };
    let deleted_part = domain_types::BlobPart {
        path: "customXml/deleted.xml".to_string(),
        data: b"<deleted/>".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        custom_xml_parts: vec![generated_part.clone(), deleted_part.clone()],
        opaque_package_subgraphs: vec![
            domain_types::OpaquePackageSubgraph {
                owner: domain_types::OpaquePackageOwner::Workbook,
                owner_relationship: domain_types::OpaquePackageRelationship {
                    owner: domain_types::OpaquePackageOwner::Workbook,
                    relationship_type:
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                            .to_string(),
                    target: domain_types::OpaqueRelationshipTarget::InternalPart {
                        path: generated_part.path.clone(),
                    },
                    relationship_id_hint: Some("rIdGenerated".to_string()),
                },
                parts: vec![domain_types::OpaquePackagePart {
                    part: generated_part,
                    content_type: Some("application/xml".to_string()),
                    default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                    ownership: domain_types::OpaquePackageOwnership::Generated,
                }],
                relationships: Vec::new(),
                ownership: domain_types::OpaquePackageOwnership::Generated,
            },
            domain_types::OpaquePackageSubgraph {
                owner: domain_types::OpaquePackageOwner::Workbook,
                owner_relationship: domain_types::OpaquePackageRelationship {
                    owner: domain_types::OpaquePackageOwner::Workbook,
                    relationship_type:
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                            .to_string(),
                    target: domain_types::OpaqueRelationshipTarget::InternalPart {
                        path: deleted_part.path.clone(),
                    },
                    relationship_id_hint: Some("rIdDeleted".to_string()),
                },
                parts: vec![domain_types::OpaquePackagePart {
                    part: deleted_part,
                    content_type: Some("application/xml".to_string()),
                    default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                    ownership: domain_types::OpaquePackageOwnership::Deleted,
                }],
                relationships: Vec::new(),
                ownership: domain_types::OpaquePackageOwnership::Deleted,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/generated.xml"));
    assert!(!archive.contains("customXml/deleted.xml"));
    assert!(!workbook_rels.contains("rIdGenerated"));
    assert!(!workbook_rels.contains("rIdDeleted"));
    assert!(!content_types.contains("/customXml/generated.xml"));
    assert!(!content_types.contains("/customXml/deleted.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_typed_opaque_subgraph_with_missing_owner_target_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Workbook,
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Workbook,
                relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                        .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: "customXml/missing.xml".to_string(),
                },
                relationship_id_hint: Some("rIdMissing".to_string()),
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "customXml/itemProps1.xml".to_string(),
                    data: b"<props/>".to_vec(),
                },
                content_type: Some(
                    "application/vnd.openxmlformats-officedocument.customXmlProperties+xml"
                        .to_string(),
                ),
                default_extension: Some(("xml".to_string(), "application/xml".to_string())),
                ownership: domain_types::OpaquePackageOwnership::CleanImported,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::CleanImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/missing.xml"));
    assert!(!archive.contains("customXml/itemProps1.xml"));
    assert!(!workbook_rels.contains("rIdMissing"));
    assert!(!content_types.contains("/customXml/itemProps1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_custom_xml_with_dangling_sidecar_relationship_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        custom_xml_parts: vec![
            domain_types::BlobPart {
                path: "customXml/item1.xml".to_string(),
                data: b"<item/>".to_vec(),
            },
            domain_types::BlobPart {
                path: "customXml/_rels/item1.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="missingItemProps.xml"/></Relationships>"#.to_vec(),
            },
        ],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId9".to_string(),
            rel_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                    .to_string(),
            target: "../customXml/item1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!archive.contains("customXml/item1.xml"));
    assert!(!archive.contains("customXml/_rels/item1.xml.rels"));
    assert!(!workbook_rels.contains("customXml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_custom_xml_without_workbook_owner_relationship_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        custom_xml_parts: vec![
            domain_types::BlobPart {
                path: "customXml/item1.xml".to_string(),
                data: b"<item/>".to_vec(),
            },
            domain_types::BlobPart {
                path: "customXml/itemProps1.xml".to_string(),
                data: b"<props/>".to_vec(),
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("customXml/item1.xml"));
    assert!(!archive.contains("customXml/itemProps1.xml"));
    assert!(!workbook_rels.contains("customXml"));
    assert!(!content_types.contains("/customXml/item"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_legacy_web_extension_package_is_emitted_as_structured_opaque_subgraph() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        root_relationships: vec![domain_types::OpcRelationship {
            id: "rIdWeb".to_string(),
            rel_type: crate::domain::web_extensions::read::REL_WEB_EXTENSION_TASKPANES.to_string(),
            target: "/xl/webextensions/taskpanes.xml".to_string(),
            target_mode: None,
        }],
        web_extension_parts: vec![
            domain_types::BlobPart {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                data: br#"<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane><wetp:webextensionref r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></wetp:taskpane></wetp:taskpanes>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/_rels/taskpanes.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/webextension1.xml".to_string(),
                data: br#"<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"/>"#.to_vec(),
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let taskpanes_rels = String::from_utf8(
        archive
            .read_file("xl/webextensions/_rels/taskpanes.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/webextensions/taskpanes.xml"));
    assert!(archive.contains("xl/webextensions/webextension1.xml"));
    assert!(root_rels.contains("webextensiontaskpanes"));
    assert!(root_rels.contains("Target=\"/xl/webextensions/taskpanes.xml\""));
    assert!(taskpanes_rels.contains("webextension1.xml"));
    assert!(content_types.contains("/xl/webextensions/taskpanes.xml"));
    assert!(content_types.contains("/xl/webextensions/webextension1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_web_extension_without_root_owner_relationship_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        web_extension_parts: vec![
            domain_types::BlobPart {
                path: "xl/webextensions/taskpanes.xml".to_string(),
                data: br#"<wetp:taskpanes xmlns:wetp="http://schemas.microsoft.com/office/webextensions/taskpanes/2010/11"><wetp:taskpane><wetp:webextensionref r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></wetp:taskpane></wetp:taskpanes>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/_rels/taskpanes.xml.rels".to_string(),
                data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2011/relationships/webextension" Target="webextension1.xml"/></Relationships>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/webextensions/webextension1.xml".to_string(),
                data: br#"<we:webextension xmlns:we="http://schemas.microsoft.com/office/webextensions/webextension/2010/11"/>"#.to_vec(),
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/webextensions/taskpanes.xml"));
    assert!(!archive.contains("xl/webextensions/webextension1.xml"));
    assert!(!root_rels.contains("webextensiontaskpanes"));
    assert!(!content_types.contains("/xl/webextensions/"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn typed_orphan_clean_binary_blob_is_emitted_without_blanket_binary_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let clean_orphan = domain_types::BlobPart {
        path: "xl/printerSettings/printerSettings1.bin".to_string(),
        data: b"clean printer settings".to_vec(),
    };
    let stale_blob = domain_types::BlobPart {
        path: "xl/media/stale.bin".to_string(),
        data: b"stale media".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        content_type_defaults: vec![("bin".to_string(), "application/octet-stream".to_string())],
        binary_blobs: vec![clean_orphan.clone(), stale_blob],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: clean_orphan.path.clone(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: clean_orphan.path.clone(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: clean_orphan,
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    "application/octet-stream".to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/printerSettings/printerSettings1.bin"));
    assert!(!archive.contains("xl/media/stale.bin"));
    assert!(content_types.contains("Extension=\"bin\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn legacy_untyped_binary_blob_is_not_emitted_by_blanket_passthrough() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        content_type_defaults: vec![("bin".to_string(), "application/octet-stream".to_string())],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/media/stale.bin".to_string(),
            data: b"stale media".to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/media/stale.bin"));
    assert!(!content_types.contains("application/octet-stream"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn raw_metadata_xml_is_dropped_when_current_value_metadata_refs_are_unsupported() {
    let mut metadata_cell = make_cell(0, 0, DomainValue::Text(Arc::from("rich value")));
    metadata_cell.vm = Some(1);
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![metadata_cell],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        raw_metadata_xml: Some(
            br#"<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes><cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/metadata.xml"));
    assert!(!workbook_rels.contains(crate::write::relationships::REL_METADATA));
    assert!(!content_types.contains("/xl/metadata.xml"));
    assert!(!sheet_xml.contains(r#" vm="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn test_api_created_data_range_chart_exports_valid_chart_xml() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
            make_cell(2, 0, DomainValue::Text(Arc::from("Q2"))),
            make_cell(2, 1, DomainValue::Number(FiniteF64::new(200.0).unwrap())),
            make_cell(3, 0, DomainValue::Text(Arc::from("Q3"))),
            make_cell(3, 1, DomainValue::Number(FiniteF64::new(300.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B4")],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels_bytes = archive
        .read_file("xl/drawings/_rels/drawing1.xml.rels")
        .unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let chart_rel = drawing_rels
        .iter()
        .find(|rel| rel.rel_type == REL_CHART && rel.target == "../charts/chart1.xml")
        .expect("drawing should relate to generated chart part");

    assert!(chart_xml.contains("<c:barChart>"));
    assert_eq!(chart_xml.matches("<c:ser>").count(), 1);
    assert!(chart_xml.contains("<c:f>Data!A2:A4</c:f>"));
    assert!(chart_xml.contains("<c:f>Data!B2:B4</c:f>"));
    assert!(chart_xml.contains("<c:catAx>"));
    assert!(chart_xml.contains("<c:valAx>"));
    assert_eq!(
        content_types
            .matches("PartName=\"/xl/drawings/drawing1.xml\"")
            .count(),
        1
    );
    assert_eq!(
        content_types
            .matches("PartName=\"/xl/charts/chart1.xml\"")
            .count(),
        1
    );
    assert!(drawing_xml.contains(&format!(r#"r:id="{}""#, chart_rel.id)));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn make_cell(row: u32, col: u32, value: DomainValue) -> DomainCellData {
    DomainCellData {
        row,
        col,
        value,
        ..Default::default()
    }
}

fn make_text_cell_with_original_sst(row: u32, col: u32, value: &str, index: u32) -> DomainCellData {
    DomainCellData {
        row,
        col,
        value: DomainValue::Text(Arc::from(value)),
        original_sst_index: Some(index),
        original_value: Some(index.to_string()),
        ..Default::default()
    }
}

fn rich_text_run(text: &str) -> domain_types::RichTextRun {
    domain_types::RichTextRun {
        text: text.to_string(),
        font_name: Some("Calibri".to_string()),
        font_size: Some(11.0),
        bold: true,
        italic: false,
        underline: false,
        strikethrough: false,
        color: Some("FFFF0000".to_string()),
        color_indexed: None,
        color_theme: None,
        color_tint: None,
        charset: None,
        family: None,
        scheme: None,
        vert_align: None,
        preserve_space: false,
    }
}

#[test]
fn authored_non_finite_numeric_lexeme_roundtrips_through_domain_cell_metadata() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Error(CellError::Num, None),
            original_value: Some("NaN".to_string()),
            ..Default::default()
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        sheet_xml.contains(r#"<c r="A1"><v>NaN</v></c>"#),
        "authored numeric lexeme must be emitted as an untyped numeric cell:\n{sheet_xml}"
    );
    assert!(
        !sheet_xml.contains(r#"<c r="A1" t="e"><v>#NUM!</v></c>"#),
        "authored numeric lexeme must not be rewritten as an OOXML error cell:\n{sheet_xml}"
    );
}

#[test]
fn authored_style_runs_stream_blank_cells_and_style_overlapping_values() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        rows: 2,
        cols: 2,
        cells: vec![make_cell(
            0,
            1,
            DomainValue::Number(FiniteF64::new(42.0).unwrap()),
        )],
        authored_style_runs: vec![AuthoredStyleRun {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 1,
            style_id: 2,
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert_eq!(sheet_xml.matches(r#"r="A1""#).count(), 1);
    assert_eq!(sheet_xml.matches(r#"r="B1""#).count(), 1);
    assert_eq!(sheet_xml.matches(r#"r="A2""#).count(), 1);
    assert_eq!(sheet_xml.matches(r#"r="B2""#).count(), 1);
    assert!(sheet_xml.contains(r#"<c r="A1" s="3"/>"#));
    assert!(sheet_xml.contains(r#"<c r="B1" s="3"><v>42</v></c>"#));
    assert!(sheet_xml.contains(r#"<c r="A2" s="3"/>"#));
    assert!(sheet_xml.contains(r#"<c r="B2" s="3"/>"#));
}

#[test]
fn center_continuous_style_run_exports_styled_blanks_without_merges() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 1,
            cols: 4,
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Text(Arc::from("CENTERED HEADER")),
            )],
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 3,
                style_id: 0,
            }],
            ..Default::default()
        }],
        style_palette: vec![DocumentFormat {
            alignment: Some(AlignmentFormat {
                horizontal: Some("centerContinuous".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(
        styles_xml.contains(r#"horizontal="centerContinuous""#),
        "styles.xml should contain the centerContinuous alignment:\n{styles_xml}"
    );
    assert!(
        styles_xml.contains(r#"applyAlignment="1""#),
        "generated centerContinuous styles must set applyAlignment:\n{styles_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="A1" s="1""#),
        "sheet XML should apply the centered style to A1:\n{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="B1" s="1"/>"#),
        "sheet XML should apply the centered style to B1:\n{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="C1" s="1"/>"#),
        "sheet XML should apply the centered style to C1:\n{sheet_xml}"
    );
    assert!(
        sheet_xml.contains(r#"<c r="D1" s="1"/>"#),
        "sheet XML should apply the centered style to D1:\n{sheet_xml}"
    );
    assert!(!sheet_xml.contains("<mergeCells"));
    assert!(!sheet_xml.contains("<mergeCell"));
}

#[test]
fn stale_calc_chain_round_trip_metadata_is_not_exported_without_calc_chain_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_CALC_CHAIN.to_string(),
                target: "calcChain.xml".to_string(),
                target_mode: None,
            },
        ],
        content_type_overrides: vec![(
            "/xl/calcChain.xml".to_string(),
            crate::write::CT_CALC_CHAIN.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/calcChain.xml"));
    assert!(!workbook_rels.contains("relationships/calcChain"));
    assert!(!content_types.contains("/xl/calcChain.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_rels_without_shared_strings_are_repaired_when_text_cells_emit_sst() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello")))],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: crate::write::REL_WORKSHEET.to_string(),
            target: "worksheets/sheet1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/sharedStrings.xml"));
    assert!(workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(workbook_rels.contains("Target=\"sharedStrings.xml\""));
    assert!(content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_original_sst_count_does_not_override_generated_counts() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_text_cell_with_original_sst(0, 0, "old", 0),
            make_cell(1, 0, DomainValue::Text(Arc::from("new"))),
        ],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        original_sst_count: Some(99),
        shared_strings_list: vec!["old".to_string()],
        raw_shared_strings_xml: Some(
            br#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="99" uniqueCount="1"><si><t>old</t></si></sst>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("count=\"2\""));
    assert!(shared_strings.contains("uniqueCount=\"2\""));
    assert!(!shared_strings.contains("count=\"99\""));
    assert!(shared_strings.contains("<t>old</t>"));
    assert!(shared_strings.contains("<t>new</t>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_unused_shared_strings_do_not_force_sst_part_rel_or_content_type() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        original_sst_count: Some(3),
        shared_strings_list: vec!["stale".to_string()],
        raw_shared_strings_xml: Some(
            br#"<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="1"><si><t>stale</t></si></sst>"#
                .to_vec(),
        ),
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId9".to_string(),
            rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
            target: "sharedStrings.xml".to_string(),
            target_mode: None,
        }],
        content_type_overrides: vec![(
            "/xl/sharedStrings.xml".to_string(),
            crate::write::CT_SHARED_STRINGS.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/sharedStrings.xml"));
    assert!(!workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(!content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unchanged_imported_rich_text_hint_is_preserved_per_cell() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_text_cell_with_original_sst(0, 0, "Rich", 0)],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        shared_strings_list: vec!["Rich".to_string()],
        shared_strings_rich_runs: vec![Some(vec![rich_text_run("Rich")])],
        shared_strings_phonetic_xml: vec![Some(
            b"<rPh sb=\"0\" eb=\"4\"><t>phonetic</t></rPh>".to_vec(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("<rPr><b/>"));
    assert!(shared_strings.contains("<rPh sb=\"0\" eb=\"4\"><t>phonetic</t></rPh>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn edited_imported_rich_text_cell_drops_stale_hint() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_text_cell_with_original_sst(0, 0, "Edited", 0)],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        shared_strings_list: vec!["Rich".to_string()],
        shared_strings_rich_runs: vec![Some(vec![rich_text_run("Rich")])],
        shared_strings_phonetic_xml: vec![Some(
            b"<rPh sb=\"0\" eb=\"4\"><t>phonetic</t></rPh>".to_vec(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("<t>Edited</t>"));
    assert!(!shared_strings.contains("<rPr><b/>"));
    assert!(!shared_strings.contains("<rPh"));
    assert!(!shared_strings.contains("phonetic"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_content_type_override_for_missing_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        content_type_defaults: vec![("missing".to_string(), "application/x-missing".to_string())],
        content_type_overrides: vec![(
            "/xl/missingModeledPart.xml".to_string(),
            crate::write::CT_WORKSHEET.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/missingModeledPart.xml"));
    assert!(!content_types.contains("missingModeledPart.xml"));
    assert!(!content_types.contains("Extension=\"missing\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_root_relationship_to_missing_part_is_not_exported_or_reserved() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        root_relationships: vec![domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: "http://example.invalid/relationships/privateRootFeature".to_string(),
            target: "/xl/private/rootFeature.xml".to_string(),
            target_mode: None,
        }],
        content_type_overrides: vec![(
            "/xl/private/rootFeature.xml".to_string(),
            "application/vnd.example.private+xml".to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let root_rels_bytes = archive.read_file("_rels/.rels").unwrap();
    let root_rels_xml = String::from_utf8(root_rels_bytes.clone()).unwrap();
    let root_rels = crate::domain::workbook::read::parse_all_rels(&root_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/private/rootFeature.xml"));
    assert!(!root_rels_xml.contains("privateRootFeature"));
    assert!(!root_rels_xml.contains("/xl/private/rootFeature.xml"));
    assert!(!content_types.contains("/xl/private/rootFeature.xml"));
    assert_eq!(
        root_rels
            .iter()
            .filter(|rel| rel.id == "rId1" && rel.rel_type == crate::write::REL_OFFICE_DOCUMENT)
            .count(),
        1,
        "stale root relationship ID must not reserve rId1 away from the generated officeDocument relationship",
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_workbook_relationship_to_missing_modeled_part_is_not_exported() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId8".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/sharedStrings.xml"));
    assert!(!workbook_rels.contains(crate::write::REL_SHARED_STRINGS));
    assert!(!workbook_rels.contains("Target=\"sharedStrings.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/sharedStrings.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_sheet_workbook_relationship_ids_do_not_reserve_ids_or_change_sheet_paths() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId44".to_string()],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId44".to_string(),
            rel_type: crate::write::REL_WORKSHEET.to_string(),
            target: "worksheets/sheet44.xml".to_string(),
            target_mode: None,
        }],
        content_type_overrides: vec![(
            "/xl/worksheets/sheet44.xml".to_string(),
            crate::write::CT_WORKSHEET.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels_bytes = archive.read_file("xl/_rels/workbook.xml.rels").unwrap();
    let workbook_rels_xml = String::from_utf8(workbook_rels_bytes.clone()).unwrap();
    let workbook_rels = crate::domain::workbook::read::parse_all_rels(&workbook_rels_bytes);
    let worksheet_rel = workbook_rels
        .iter()
        .find(|rel| rel.rel_type == crate::write::REL_WORKSHEET)
        .expect("generated workbook relationships should include Sheet1");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/worksheets/sheet1.xml"));
    assert!(!archive.contains("xl/worksheets/sheet44.xml"));
    assert_eq!(worksheet_rel.target, "worksheets/sheet1.xml");
    assert_ne!(worksheet_rel.id, "rId44");
    assert!(!workbook_rels_xml.contains("worksheets/sheet44.xml"));
    assert!(!content_types.contains("/xl/worksheets/sheet44.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unmanaged_original_workbook_relationship_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId99".to_string(),
            rel_type: "http://example.invalid/relationships/privateFeature".to_string(),
            target: "private/privateFeature.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!workbook_rels.contains("privateFeature"));
    assert!(!archive.contains("xl/private/privateFeature.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unmanaged_original_worksheet_relationship_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: "http://example.invalid/relationships/privateSheetFeature".to_string(),
                target: "../private/privateSheetFeature.xml".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    if archive.contains("xl/worksheets/_rels/sheet1.xml.rels") {
        let sheet_rels = String::from_utf8(
            archive
                .read_file("xl/worksheets/_rels/sheet1.xml.rels")
                .unwrap(),
        )
        .unwrap();
        assert!(!sheet_rels.contains("privateSheetFeature"));
    }
    assert!(!archive.contains("xl/private/privateSheetFeature.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn unmanaged_original_drawing_relationship_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing1.xml".to_string(),
                target_mode: None,
            }],
            original_drawing_path: Some("xl/drawings/drawing1.xml".to_string()),
            drawing_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: "http://example.invalid/relationships/privateDrawingFeature".to_string(),
                target: "../private/privateDrawingFeature.xml".to_string(),
                target_mode: None,
            }],
            has_drawing_rels_file: true,
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    if archive.contains("xl/drawings/_rels/drawing1.xml.rels") {
        let drawing_rels = String::from_utf8(
            archive
                .read_file("xl/drawings/_rels/drawing1.xml.rels")
                .unwrap(),
        )
        .unwrap();
        assert!(!drawing_rels.contains("privateDrawingFeature"));
    }
    assert!(!archive.contains("xl/private/privateDrawingFeature.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_drawing_relationship_uses_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B2")],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId9".to_string(),
                rel_type: REL_DRAWING.to_string(),
                target: "../drawings/drawing9.xml".to_string(),
                target_mode: None,
            }],
            imported_drawing: Some(domain_types::ImportedDrawingPart {
                path: "xl/drawings/drawing9.xml".to_string(),
                data: br#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><rawSentinel/></xdr:wsDr>"#.to_vec(),
                rels: Some(domain_types::BlobPart {
                    path: "xl/drawings/_rels/drawing9.xml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId99" Type="http://example.invalid/privateDrawingFeature" Target="https://example.invalid/private" TargetMode="External"/></Relationships>"#.to_vec(),
                }),
            }),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/drawings/drawing9.xml".to_string(),
            crate::write::CT_DRAWING.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let drawing_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_DRAWING && rel.target == "../drawings/drawing1.xml")
        .expect("generated drawing relationship should target the graph-registered part");

    assert!(archive.contains("xl/drawings/drawing1.xml"));
    assert!(!archive.contains("xl/drawings/drawing9.xml"));
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    assert!(sheet_rels.contains("Target=\"../drawings/drawing1.xml\""));
    assert!(!sheet_rels.contains("drawing9.xml"));
    assert!(sheet_xml.contains(&format!(r#"<drawing r:id="{}"/>"#, drawing_rel.id)));
    assert!(!drawing_xml.contains("rawSentinel"));
    assert!(!drawing_rels.contains("privateDrawingFeature"));
    assert!(!drawing_rels.contains("rId99"));
    assert!(content_types.contains("PartName=\"/xl/drawings/drawing1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/drawings/drawing9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_worksheet_relationship_to_missing_modeled_part_is_not_exported_or_referenced() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table9.xml".to_string(),
                target_mode: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("r:id=\"rId4\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_preserved_table_parts_are_not_replayed_when_modeled_tables_are_deleted() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table9.xml".to_string(),
                target_mode: None,
            }],
            sheet_preserved_elements: vec![(
                "worksheet\0after\0legacyDrawing\0tableParts".to_string(),
                r#"<tableParts count="1"><tablePart r:id="rId4"/></tableParts>"#.to_string(),
            )],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/tables/table9.xml".to_string(),
            crate::write::CT_TABLE.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_xml.contains("<tableParts"));
    assert!(!sheet_xml.contains("rId4"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(!content_types.contains("PartName=\"/xl/tables/table9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_preserved_relationship_bearing_sheet_xml_is_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rIdCustom".to_string(),
                rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customProperty"
                    .to_string(),
                target: "../customProperty/item1.xml".to_string(),
                target_mode: None,
            }],
            sheet_preserved_elements: vec![(
                "worksheet\0after\0colBreaks\0customProperties".to_string(),
                r#"<customProperties><customPr r:id="rIdCustom" name="StaleProperty"/></customProperties>"#
                    .to_string(),
            )],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/customProperty/item1.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.customProperty+xml"
                .to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/customProperty/item1.xml".to_string(),
            data: b"<customProperty/>".to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(!sheet_xml.contains("<customProperties"));
    assert!(!sheet_xml.contains("rIdCustom"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!archive.contains("xl/customProperty/item1.xml"));
    assert!(!content_types.contains("/xl/customProperty/item1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_table_relationship_uses_graph_registered_part_and_resolved_id() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:B2".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:B2".to_string()),
            columns: vec![
                TableColumnSpec {
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    name: "B".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId4".to_string(),
                    rel_type: crate::write::REL_TABLE.to_string(),
                    target: "../tables/table1.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: crate::write::REL_TABLE.to_string(),
                    target: "../tables/table9.xml".to_string(),
                    target_mode: None,
                },
            ],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/tables/table9.xml".to_string(),
            crate::write::CT_TABLE.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(archive.contains("xl/tables/table1.xml"));
    assert!(!archive.contains("xl/tables/table9.xml"));
    assert!(sheet_xml.contains("<tablePart r:id=\"rId4\"/>"));
    assert!(sheet_rels.contains("Id=\"rId4\""));
    assert!(sheet_rels.contains("Target=\"../tables/table1.xml\""));
    assert!(!sheet_rels.contains("table9.xml"));
    assert!(content_types.contains("PartName=\"/xl/tables/table1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/tables/table9.xml\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn duplicate_original_worksheet_relationship_ids_do_not_leak_to_generated_relationships() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:B2".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:B2".to_string()),
            columns: vec![
                TableColumnSpec {
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    name: "B".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId4".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments1.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId5".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing1.vml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId4".to_string(),
                    rel_type: REL_TABLE.to_string(),
                    target: "../tables/table1.xml".to_string(),
                    target_mode: None,
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let comments_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_COMMENTS && rel.target == "../comments1.xml")
        .expect("comments relationship should be emitted");
    let vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING && rel.target == "../drawings/vmlDrawing1.vml")
        .expect("VML relationship should be emitted");
    let table_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_TABLE && rel.target == "../tables/table1.xml")
        .expect("table relationship should be emitted");
    let unique_ids: std::collections::BTreeSet<_> = rels.iter().map(|rel| &rel.id).collect();

    assert_eq!(unique_ids.len(), rels.len());
    assert_eq!(comments_rel.id, "rId4");
    assert_ne!(table_rel.id, comments_rel.id);
    assert!(sheet_xml.contains(&format!("<legacyDrawing r:id=\"{}\"/>", vml_rel.id)));
    assert!(sheet_xml.contains(&format!("<tablePart r:id=\"{}\"/>", table_rel.id)));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_table_sidecar_relationships_are_not_replayed() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        tables: vec![TableSpec {
            id: 1,
            name: "Table1".to_string(),
            display_name: "Table1".to_string(),
            range_ref: "A1:B2".to_string(),
            has_headers: true,
            auto_filter_ref: Some("A1:B2".to_string()),
            columns: vec![
                TableColumnSpec {
                    name: "A".to_string(),
                    ..Default::default()
                },
                TableColumnSpec {
                    name: "B".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId4".to_string(),
                rel_type: crate::write::REL_TABLE.to_string(),
                target: "../tables/table1.xml".to_string(),
                target_mode: None,
            }],
            table_xml_passthroughs: vec![domain_types::BlobPart {
                path: "xl/tables/_rels/table1.xml.rels".to_string(),
                data: br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/queryTable" Target="../queryTables/queryTable1.xml"/>
</Relationships>"#
                    .to_vec(),
            }],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/queryTables/queryTable1.xml".to_string(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.queryTable+xml"
                .to_string(),
        )],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/queryTables/queryTable1.xml".to_string(),
            data: b"stale query table".to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types = String::from_utf8(archive.read_file("[Content_Types].xml").unwrap())
        .expect("content types should be UTF-8");

    assert!(archive.contains("xl/tables/table1.xml"));
    assert!(!archive.contains("xl/tables/_rels/table1.xml.rels"));
    assert!(!archive.contains("xl/queryTables/queryTable1.xml"));
    assert!(sheet_xml.contains("<tablePart r:id=\"rId4\"/>"));
    assert!(sheet_rels.contains("Target=\"../tables/table1.xml\""));
    assert!(!content_types.contains("queryTable+xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_comment_relationships_use_graph_registered_parts_and_resolved_ids() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments1.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId8".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing1.vml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments9.xml".to_string(),
                    target_mode: None,
                },
            ],
            legacy_drawing_r_id: Some("rId8".to_string()),
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing1.vml".to_string(),
                data: b"<xml><rawVmlSentinel/></xml>".to_vec(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing1.vml.rels".to_string(),
                    data: b"<Relationships><rawVmlRelsSentinel/></Relationships>".to_vec(),
                }),
            }],
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/comments9.xml".to_string(),
            crate::write::CT_COMMENTS.to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap()).unwrap();

    assert!(archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(!archive.contains("xl/drawings/_rels/vmlDrawing1.vml.rels"));
    assert!(!archive.contains("xl/comments9.xml"));
    assert!(sheet_rels.contains("Id=\"rId7\""));
    assert!(sheet_rels.contains("Target=\"../comments1.xml\""));
    assert!(sheet_rels.contains("Id=\"rId8\""));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing1.vml\""));
    assert!(!sheet_rels.contains("comments9.xml"));
    assert!(sheet_xml.contains("<legacyDrawing r:id=\"rId8\"/>"));
    assert!(content_types.contains("PartName=\"/xl/comments1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/comments9.xml\""));
    assert!(vml_xml.contains("ObjectType=\"Note\""));
    assert!(!vml_xml.contains("rawVmlSentinel"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_comment_does_not_reuse_stale_comment_sidecar_identity_by_sheet_index() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Fresh Author".to_string(),
            content: Some("Fresh note".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_COMMENTS.to_string(),
                    target: "../comments7.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId8".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing9.vml".to_string(),
                    target_mode: None,
                },
            ],
            legacy_drawing_r_id: Some("rId8".to_string()),
            comments_root_namespace_attrs: vec![
                (
                    "xmlns".to_string(),
                    "http://schemas.openxmlformats.org/spreadsheetml/2006/main".to_string(),
                ),
                (
                    "xmlns:stale".to_string(),
                    "http://example.invalid/stale-comments".to_string(),
                ),
                ("mc:Ignorable".to_string(), "stale".to_string()),
            ],
            comment_authors: vec!["Stale Author".to_string()],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: b"<xml><staleCommentVml/></xml>".to_vec(),
                rels: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let comments_xml = String::from_utf8(archive.read_file("xl/comments1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(comments_xml.contains("<author>Fresh Author</author>"));
    assert!(!comments_xml.contains("Stale Author"));
    assert!(!comments_xml.contains("stale-comments"));
    assert!(!comments_xml.contains("mc:Ignorable=\"stale\""));
    assert!(archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(sheet_rels.contains("Target=\"../comments1.xml\""));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing1.vml\""));
    assert!(!sheet_rels.contains("comments7.xml"));
    assert!(!sheet_rels.contains("vmlDrawing9.vml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_hyperlink_relationship_uses_graph_resolved_id() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hyperlinks: vec![
            Hyperlink {
                cell_ref: "A1".to_string(),
                target: Some("https://example.com".to_string()),
                display: Some("Example".to_string()),
                ..Default::default()
            },
            Hyperlink {
                cell_ref: "A2".to_string(),
                target: Some("https://example.org".to_string()),
                display: Some("Example Org".to_string()),
                ..Default::default()
            },
        ],
        comments: vec![Comment {
            cell_ref: "B1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId5".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://example.com".to_string(),
                    target_mode: Some("External".to_string()),
                },
                domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: REL_HYPERLINK.to_string(),
                    target: "https://stale.example".to_string(),
                    target_mode: Some("External".to_string()),
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(sheet_rels.contains("Id=\"rId5\""));
    assert!(sheet_rels.contains("Target=\"https://example.com\""));
    assert!(sheet_xml.contains("<hyperlink ref=\"A1\" r:id=\"rId5\""));
    assert!(sheet_rels.contains("Target=\"https://example.org\""));
    assert!(!sheet_rels.contains("stale.example"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn generated_control_property_relationship_uses_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![domain_types::domain::floating_object::FloatingObject {
            common: domain_types::domain::floating_object::FloatingObjectCommon {
                name: "Check Box 1".to_string(),
                anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    end_row: Some(2),
                    end_col: Some(2),
                    ..Default::default()
                },
                ..Default::default()
            },
            data: domain_types::domain::floating_object::FloatingObjectData::FormControl(
                domain_types::domain::floating_object::FormControlData {
                    control_type: "CheckBox".to_string(),
                    cell_link: Some("$A$1".to_string()),
                    input_range: None,
                    ooxml: Some(
                        domain_types::domain::floating_object::FormControlOoxmlProps {
                            shape_id: 1025,
                            checked: Some("Checked".to_string()),
                            anchor_source: "Modern".to_string(),
                            ..Default::default()
                        },
                    ),
                },
            ),
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: REL_CTRL_PROP.to_string(),
                    target: "../ctrlProps/ctrlProp9.xml".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId10".to_string(),
                    rel_type: REL_VML_DRAWING.to_string(),
                    target: "../drawings/vmlDrawing9.vml".to_string(),
                    target_mode: None,
                },
            ],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing1.vml".to_string(),
                data: b"<xml><rawFormControlVmlSentinel/></xml>".to_vec(),
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing1.vml.rels".to_string(),
                    data: b"<Relationships><rawFormControlVmlRelsSentinel/></Relationships>"
                        .to_vec(),
                }),
            }],
            worksheet_controls_xml: Some(
                r#"<mc:AlternateContent><controls><control shapeId="1025" r:id="rId99" name="Raw Control"/></controls><rawControlsSentinel/></mc:AlternateContent>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        content_type_overrides: vec![(
            "/xl/ctrlProps/ctrlProp9.xml".to_string(),
            "application/vnd.ms-excel.controlproperties+xml".to_string(),
        )],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap()).unwrap();
    let ctrl_prop_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_CTRL_PROP && rel.target == "../ctrlProps/ctrlProp1.xml")
        .expect("generated ctrlProp relationship should target the graph-registered part");
    let vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING && rel.target == "../drawings/vmlDrawing1.vml")
        .expect("generated form-control VML relationship should target the graph-registered part");

    assert!(archive.contains("xl/ctrlProps/ctrlProp1.xml"));
    assert!(!archive.contains("xl/ctrlProps/ctrlProp9.xml"));
    assert!(archive.contains("xl/drawings/vmlDrawing1.vml"));
    assert!(!archive.contains("xl/drawings/_rels/vmlDrawing1.vml.rels"));
    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(sheet_rels.contains("Target=\"../ctrlProps/ctrlProp1.xml\""));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing1.vml\""));
    assert!(!sheet_rels.contains("ctrlProp9.xml"));
    assert!(!sheet_rels.contains("vmlDrawing9.vml"));
    assert!(sheet_xml.contains(&format!(r#"r:id="{}""#, ctrl_prop_rel.id)));
    assert!(!sheet_xml.contains("rawControlsSentinel"));
    assert!(!sheet_xml.contains("r:id=\"rId99\""));
    assert!(sheet_xml.contains(&format!(r#"<legacyDrawing r:id="{}"/>"#, vml_rel.id)));
    assert!(content_types.contains("PartName=\"/xl/ctrlProps/ctrlProp1.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/ctrlProps/ctrlProp9.xml\""));
    assert!(!vml_xml.contains("rawFormControlVmlSentinel"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn comments_and_form_controls_share_generated_vml_without_raw_replay() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        comments: vec![Comment {
            cell_ref: "A1".to_string(),
            author: "Tester".to_string(),
            content: Some("Header comment".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        floating_objects: vec![domain_types::domain::floating_object::FloatingObject {
            common: domain_types::domain::floating_object::FloatingObjectCommon {
                name: "Check Box 1".to_string(),
                anchor: domain_types::domain::floating_object::FloatingObjectAnchor {
                    anchor_row: 1,
                    anchor_col: 1,
                    end_row: Some(3),
                    end_col: Some(3),
                    ..Default::default()
                },
                ..Default::default()
            },
            data: domain_types::domain::floating_object::FloatingObjectData::FormControl(
                domain_types::domain::floating_object::FormControlData {
                    control_type: "CheckBox".to_string(),
                    cell_link: Some("$B$2".to_string()),
                    input_range: None,
                    ooxml: Some(
                        domain_types::domain::floating_object::FormControlOoxmlProps {
                            shape_id: 1025,
                            checked: Some("Checked".to_string()),
                            anchor_source: "Modern".to_string(),
                            ..Default::default()
                        },
                    ),
                },
            ),
        }],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId9".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: b"<xml><rawCombinedVmlSentinel/></xml>".to_vec(),
                rels: None,
            }],
            worksheet_controls_xml: Some(
                r#"<mc:AlternateContent><controls><control shapeId="1025" r:id="rId99" name="Raw Control"/></controls><rawControlsSentinel/></mc:AlternateContent>"#
                    .to_string(),
            ),
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING)
        .expect("shared VML relationship should be emitted");
    let vml_xml =
        String::from_utf8(archive.read_file("xl/drawings/vmlDrawing1.vml").unwrap()).unwrap();

    assert_eq!(
        rels.iter()
            .filter(|rel| rel.rel_type == REL_VML_DRAWING)
            .count(),
        1
    );
    assert!(sheet_xml.contains(&format!(r#"<legacyDrawing r:id="{}"/>"#, vml_rel.id)));
    assert!(sheet_xml.contains(r#"shapeId="1026""#));
    assert!(!sheet_xml.contains("rawControlsSentinel"));
    assert!(!sheet_xml.contains(r#"shapeId="1025" r:id="rId99""#));
    assert!(vml_xml.contains("ObjectType=\"Note\""));
    assert!(vml_xml.contains("ObjectType=\"Checkbox\""));
    assert!(vml_xml.contains("id=\"_x0000_s1025\""));
    assert!(vml_xml.contains("id=\"_x0000_s1026\""));
    assert!(!vml_xml.contains("rawCombinedVmlSentinel"));
    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn header_footer_vml_relationship_uses_graph_registered_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        hf_images: vec![domain_types::domain::print::HeaderFooterImageInfo {
            position: domain_types::domain::print::HfImagePosition::LeftHeader,
            src: "../media/image1.png".to_string(),
            title: "LH".to_string(),
            width_pt: 46.0,
            height_pt: 46.0,
        }],
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing8.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml,
                rels: Some(domain_types::VmlRels {
                    path: "xl/drawings/_rels/vmlDrawing9.vml.rels".to_string(),
                    data: br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#
                        .to_vec(),
                }),
            }],
            ..Default::default()
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: "xl/media/image1.png".to_string(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: "xl/media/image1.png".to_string(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: domain_types::BlobPart {
                    path: "xl/media/image1.png".to_string(),
                    data: b"png bytes".to_vec(),
                },
                content_type: None,
                default_extension: Some(("png".to_string(), "image/png".to_string())),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels_bytes = archive
        .read_file("xl/worksheets/_rels/sheet1.xml.rels")
        .unwrap();
    let sheet_rels = String::from_utf8(sheet_rels_bytes.clone()).unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&sheet_rels_bytes);
    let hf_vml_rel = rels
        .iter()
        .find(|rel| rel.rel_type == REL_VML_DRAWING && rel.target == "../drawings/vmlDrawing9.vml")
        .expect("header/footer VML relationship should target the emitted VML part");
    let vml_rels = String::from_utf8(
        archive
            .read_file("xl/drawings/_rels/vmlDrawing9.vml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(archive.contains("xl/media/image1.png"));
    assert!(!archive.contains("xl/drawings/vmlDrawing8.vml"));
    assert!(sheet_rels.contains("Target=\"../drawings/vmlDrawing9.vml\""));
    assert!(!sheet_rels.contains("vmlDrawing8.vml"));
    assert!(vml_rels.contains("Id=\"rId1\""));
    assert!(vml_rels.contains("Target=\"../media/image1.png\""));
    assert!(sheet_xml.contains(&format!(r#"<legacyDrawingHF r:id="{}"/>"#, hf_vml_rel.id)));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_header_footer_vml_is_dropped_without_modeled_hf_images() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let hf_image = crate::domain::print::hf_images::HeaderFooterImage {
        position: crate::domain::print::hf_images::HfImagePosition::LeftHeader,
        image_rel_id: "rId1".to_string(),
        title: "LH".to_string(),
        width_pt: 46.0,
        height_pt: 46.0,
    };
    let hf_vml = crate::domain::print::hf_images::write_hf_images_vml(&[hf_image], "1", 13313);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![domain_types::OpcRelationship {
                id: "rId7".to_string(),
                rel_type: REL_VML_DRAWING.to_string(),
                target: "../drawings/vmlDrawing9.vml".to_string(),
                target_mode: None,
            }],
            raw_vml_drawings: vec![domain_types::VmlDrawingPart {
                path: "xl/drawings/vmlDrawing9.vml".to_string(),
                data: hf_vml,
                rels: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!archive.contains("xl/drawings/vmlDrawing9.vml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet1.xml.rels"));
    assert!(!sheet_xml.contains("legacyDrawingHF"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn printer_settings_relationship_requires_graph_registered_binary_part() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        print_settings: Some(domain_types::PrintSettings {
            r_id: Some("rId7".to_string()),
            has_page_setup: true,
            paper_size: Some(9),
            ..Default::default()
        }),
        ..Default::default()
    }]);
    let clean_printer_settings = domain_types::BlobPart {
        path: "xl/printerSettings/printerSettings1.bin".to_string(),
        data: b"clean printer settings".to_vec(),
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            sheet_opc_rels: vec![
                domain_types::OpcRelationship {
                    id: "rId7".to_string(),
                    rel_type: REL_PRINTER_SETTINGS.to_string(),
                    target: "../printerSettings/printerSettings1.bin".to_string(),
                    target_mode: None,
                },
                domain_types::OpcRelationship {
                    id: "rId9".to_string(),
                    rel_type: REL_PRINTER_SETTINGS.to_string(),
                    target: "../printerSettings/printerSettings9.bin".to_string(),
                    target_mode: None,
                },
            ],
            ..Default::default()
        }],
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/printerSettings/printerSettings9.bin".to_string(),
            data: b"stale printer settings".to_vec(),
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Part {
                path: clean_printer_settings.path.clone(),
            },
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Part {
                    path: clean_printer_settings.path.clone(),
                },
                relationship_type: String::new(),
                target: domain_types::OpaqueRelationshipTarget::InternalPath {
                    target: String::new(),
                },
                relationship_id_hint: None,
            },
            parts: vec![domain_types::OpaquePackagePart {
                part: clean_printer_settings,
                content_type: None,
                default_extension: Some((
                    "bin".to_string(),
                    "application/octet-stream".to_string(),
                )),
                ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
            }],
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::OrphanCleanPackageData,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/printerSettings/printerSettings1.bin"));
    assert!(!archive.contains("xl/printerSettings/printerSettings9.bin"));
    assert!(sheet_xml.contains("<pageSetup"));
    assert!(sheet_xml.contains("r:id=\"rId7\""));
    assert!(sheet_rels.contains("Id=\"rId7\""));
    assert!(sheet_rels.contains("Target=\"../printerSettings/printerSettings1.bin\""));
    assert!(!sheet_rels.contains("printerSettings9.bin"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn duplicate_original_workbook_relationship_ids_do_not_leak_to_generated_relationships() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello")))],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_SHARED_STRINGS.to_string(),
                target: "sharedStrings.xml".to_string(),
                target_mode: None,
            },
        ],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_rels = archive.read_file("xl/_rels/workbook.xml.rels").unwrap();
    let rels = crate::domain::workbook::read::parse_all_rels(&workbook_rels);
    let mut ids = std::collections::HashSet::new();

    for rel in rels {
        assert!(ids.insert(rel.id), "relationship IDs must be unique");
    }
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn make_formula_cell(row: u32, col: u32, formula: &str, cached: DomainValue) -> DomainCellData {
    DomainCellData {
        row,
        col,
        value: cached,
        formula: Some(formula.to_string()),
        ..Default::default()
    }
}

fn make_pivot_config(
    id: &str,
    name: &str,
    source_sheet_name: &str,
    source_range: cell_types::SheetRange,
    output_sheet_name: &str,
    cache_id: Option<u32>,
) -> pivot_types::PivotTableConfig {
    pivot_types::PivotTableConfig {
        schema_version: pivot_types::PIVOT_CONFIG_SCHEMA_VERSION,
        id: id.to_string(),
        name: name.to_string(),
        source_sheet_id: None,
        source_sheet_name: source_sheet_name.to_string(),
        source_range,
        output_sheet_name: output_sheet_name.to_string(),
        output_location: pivot_types::OutputLocation { row: 0, col: 0 },
        fields: Vec::new(),
        placements: Vec::new(),
        filters: Vec::new(),
        layout: None,
        style: None,
        data_options: None,
        created_at: None,
        updated_at: None,
        calculated_fields: None,
        allow_multiple_filters_per_field: None,
        auto_format: None,
        preserve_formatting: None,
        cache_id,
        ref_range: None,
        first_data_row: None,
        first_data_col: None,
        row_items: Vec::new(),
        col_items: Vec::new(),
    }
}

fn pivot_package_output(pivots: Vec<pivot_types::PivotTableConfig>) -> ParseOutput {
    let mut output = make_parse_output(vec![
        SheetData {
            name: "Data".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Text(Arc::from("Category"))),
                make_cell(0, 1, DomainValue::Text(Arc::from("Amount"))),
                make_cell(1, 0, DomainValue::Text(Arc::from("A"))),
                make_cell(1, 1, DomainValue::Number(FiniteF64::new(10.0).unwrap())),
                make_cell(2, 0, DomainValue::Text(Arc::from("B"))),
                make_cell(2, 1, DomainValue::Number(FiniteF64::new(20.0).unwrap())),
                make_cell(4, 0, DomainValue::Text(Arc::from("Category"))),
                make_cell(4, 1, DomainValue::Text(Arc::from("Amount"))),
                make_cell(5, 0, DomainValue::Text(Arc::from("C"))),
                make_cell(5, 1, DomainValue::Number(FiniteF64::new(30.0).unwrap())),
            ],
            ..Default::default()
        },
        SheetData {
            name: "Pivot".to_string(),
            ..Default::default()
        },
    ]);
    output.pivot_tables = pivots
        .into_iter()
        .map(|config| domain_types::domain::pivot::ParsedPivotTable {
            config,
            initial_expansion_state: None,
        })
        .collect();
    output
}

#[test]
fn pivot_package_generation_filters_stale_original_parts_and_rels() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: vec![
            (
                "/xl/pivotTables/pivotTable7.xml".to_string(),
                CT_PIVOT_TABLE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                CT_PIVOT_CACHE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                CT_PIVOT_CACHE_RECORDS.to_string(),
            ),
        ],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: b"stale pivot table".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"stale cache".to_vec(),
            },
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![
        domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: REL_HYPERLINK.to_string(),
            target: "https://example.com".to_string(),
            target_mode: Some("External".to_string()),
        },
        domain_types::OpcRelationship {
            id: "rId7".to_string(),
            rel_type: REL_PIVOT_TABLE.to_string(),
            target: "../pivotTables/pivotTable7.xml".to_string(),
            target_mode: None,
        },
    ];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains("<pivotCaches>"));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(!workbook_rels.contains("pivotCacheDefinition7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    assert!(!sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    let pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!("<pivotTableDefinition r:id=\"{pivot_r_id}\"/>")));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\""));
    assert!(!content_types.contains("pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn workbook_pivot_caches_are_not_replayed_twice() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_preserved_elements: vec![(
            "workbook\0after\0calcPr\0pivotCaches".to_string(),
            r#"<pivotCaches><pivotCache cacheId="999" r:id="rIdOld"/></pivotCaches>"#.to_string(),
        )],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId99".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="77"/>"#.to_vec(),
        }],
        opaque_package_subgraphs: vec![domain_types::OpaquePackageSubgraph {
            owner: domain_types::OpaquePackageOwner::Workbook,
            owner_relationship: domain_types::OpaquePackageRelationship {
                owner: domain_types::OpaquePackageOwner::Workbook,
                relationship_type:
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
                        .to_string(),
                target: domain_types::OpaqueRelationshipTarget::InternalPart {
                    path: "customXml/dirty.xml".to_string(),
                },
                relationship_id_hint: Some("rIdDirty".to_string()),
            },
            parts: Vec::new(),
            relationships: Vec::new(),
            ownership: domain_types::OpaquePackageOwnership::DirtyImported,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert_eq!(workbook_xml.matches("<pivotCaches>").count(), 1);
    assert!(workbook_xml.contains("cacheId=\"77\" r:id=\"rId99\""));
    assert!(!workbook_xml.contains("cacheId=\"999\""));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
}

#[test]
fn pivot_package_preserves_orphan_workbook_cache_relationships_for_clean_parts() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId40".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string()],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 999,
                relationship_id: "rId40".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 999,
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(workbook_rels.contains("Id=\"rId40\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition5.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition5.xml"));
}

#[test]
fn pivot_cache_relationship_requires_typed_pivot_package_entry() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext::default()],
        workbook_relationships: vec![domain_types::OpcRelationship {
            id: "rId40".to_string(),
            rel_type: REL_PIVOT_CACHE.to_string(),
            target: "pivotCache/pivotCacheDefinition5.xml".to_string(),
            target_mode: None,
        }],
        pivot_package: domain_types::PivotPackageRoundTrip {
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 999,
                definition_path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                definition_rels_path: None,
                source_kind: domain_types::PivotCacheSourceKind::Worksheet,
                raw_definition_xml: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
                raw_relationships: Vec::new(),
                records_relationship_id: None,
                records_relationship_target: None,
                records_path: None,
                raw_records_xml: None,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: vec![domain_types::PivotPackageContentType {
                part_name: "/xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
                content_type: CT_PIVOT_CACHE.to_string(),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            ..Default::default()
        },
        binary_blobs: vec![domain_types::BlobPart {
            path: "xl/pivotCache/pivotCacheDefinition5.xml".to_string(),
            data: br#"<pivotCacheDefinition cacheId="999"/>"#.to_vec(),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();

    assert!(!workbook_xml.contains("<pivotCaches"));
    assert!(!workbook_rels.contains("Id=\"rId40\""));
    assert!(!workbook_rels.contains("pivotCache/pivotCacheDefinition5.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition5.xml"));
}

#[test]
fn generated_pivot_preserves_clean_imported_pivot_package_contract() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-generated",
        "GeneratedPivot",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Pivot",
        Some(11),
    )]);
    let imported_content_types = vec![
        (
            "/xl/pivotTables/pivotTable7.xml".to_string(),
            CT_PIVOT_TABLE.to_string(),
        ),
        (
            "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
            CT_PIVOT_CACHE.to_string(),
        ),
        (
            "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
            CT_PIVOT_CACHE_RECORDS.to_string(),
        ),
    ];
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: imported_content_types.clone(),
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: br#"<pivotTableDefinition name="ImportedPivot" cacheId="77"/>"#.to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotTables/_rels/pivotTable7.xml.rels".to_string(),
                data: b"imported pivot table rels".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"imported cache definition".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                data: b"imported cache rels".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                data: b"imported cache records".to_vec(),
            },
        ],
        pivot_package: domain_types::PivotPackageRoundTrip {
            workbook_cache_entries: vec![domain_types::PivotWorkbookCacheEntry {
                cache_id: 77,
                relationship_id: "rId99".to_string(),
                relationship_target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            cache_definitions: vec![domain_types::PivotCacheDefinitionPackage {
                cache_id: 77,
                definition_path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                definition_rels_path: Some(
                    "xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels".to_string(),
                ),
                source_kind: domain_types::PivotCacheSourceKind::External,
                raw_definition_xml: b"imported cache definition".to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords".to_string(),
                    target: "pivotCacheRecords7.xml".to_string(),
                    target_mode: None,
                }],
                records_relationship_id: Some("rId1".to_string()),
                records_relationship_target: Some("pivotCacheRecords7.xml".to_string()),
                records_path: Some("xl/pivotCache/pivotCacheRecords7.xml".to_string()),
                raw_records_xml: Some(b"imported cache records".to_vec()),
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            pivot_tables: vec![domain_types::PivotTablePackage {
                sheet_index: 1,
                sheet_name: "Pivot".to_string(),
                sheet_relationship_id: "rId7".to_string(),
                sheet_relationship_target: "../pivotTables/pivotTable7.xml".to_string(),
                table_path: "xl/pivotTables/pivotTable7.xml".to_string(),
                table_rels_path: Some("xl/pivotTables/_rels/pivotTable7.xml.rels".to_string()),
                pivot_name: Some("ImportedPivot".to_string()),
                raw_table_xml: br#"<pivotTableDefinition name="ImportedPivot" cacheId="77"/>"#
                    .to_vec(),
                raw_relationships: vec![domain_types::OpcRelationship {
                    id: "rId1".to_string(),
                    rel_type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition".to_string(),
                    target: "../pivotCache/pivotCacheDefinition7.xml".to_string(),
                    target_mode: None,
                }],
                referenced_cache_id: 77,
                order: 0,
                ownership: domain_types::PivotPackageOwnership::CleanImported,
            }],
            content_type_overrides: imported_content_types
                .iter()
                .map(|(part_name, content_type)| domain_types::PivotPackageContentType {
                    part_name: part_name.clone(),
                    content_type: content_type.clone(),
                    ownership: domain_types::PivotPackageOwnership::CleanImported,
                })
                .collect(),
            orphan_parts: Vec::new(),
        },
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![
        domain_types::OpcRelationship {
            id: "rId1".to_string(),
            rel_type: REL_HYPERLINK.to_string(),
            target: "https://example.com".to_string(),
            target_mode: Some("External".to_string()),
        },
        domain_types::OpcRelationship {
            id: "rId7".to_string(),
            rel_type: REL_PIVOT_TABLE.to_string(),
            target: "../pivotTables/pivotTable7.xml".to_string(),
            target_mode: None,
        },
    ];
    ctx.sheets[1].sheet_preserved_elements = vec![(
        "worksheet\0after\0sheetData\0pivotTableDefinition".to_string(),
        r#"<pivotTableDefinition r:id="rId7"/>"#.to_string(),
    )];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let sheet_rels = String::from_utf8(
        archive
            .read_file("xl/worksheets/_rels/sheet2.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet2.xml").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(workbook_xml.contains("cacheId=\"77\" r:id=\"rId99\""));
    assert!(workbook_xml.contains("cacheId=\"11\""));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(workbook_rels.contains("pivotCache/pivotCacheDefinition1.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable7.xml"));
    assert!(sheet_rels.contains("../pivotTables/pivotTable1.xml"));
    assert!(sheet_xml.contains("<pivotTableDefinition r:id=\"rId7\"/>"));
    let generated_pivot_r_id = sheet_rels
        .split("<Relationship ")
        .find(|rel| rel.contains("../pivotTables/pivotTable1.xml"))
        .and_then(|rel| rel.split("Id=\"").nth(1))
        .and_then(|rel| rel.split('"').next())
        .expect("generated pivot relationship should have an r:id");
    assert!(sheet_xml.contains(&format!(
        "<pivotTableDefinition r:id=\"{generated_pivot_r_id}\"/>"
    )));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotTables/pivotTable1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition1.xml\""));
    assert!(content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords1.xml\""));
    assert!(archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(archive.contains("xl/pivotTables/_rels/pivotTable7.xml.rels"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition7.xml.rels"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn skipped_generated_pivot_does_not_replay_legacy_pivot_package_metadata() {
    let output = pivot_package_output(vec![make_pivot_config(
        "pivot-1",
        "PivotTable1",
        "Data",
        cell_types::SheetRange::new(0, 0, 2, 1),
        "Missing Pivot Sheet",
        Some(11),
    )]);
    let mut ctx = domain_types::RoundTripContext {
        sheets: vec![
            domain_types::SheetRoundTripContext::default(),
            domain_types::SheetRoundTripContext::default(),
        ],
        content_type_overrides: vec![
            (
                "/xl/pivotTables/pivotTable7.xml".to_string(),
                CT_PIVOT_TABLE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                CT_PIVOT_CACHE.to_string(),
            ),
            (
                "/xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                CT_PIVOT_CACHE_RECORDS.to_string(),
            ),
        ],
        workbook_relationships: vec![
            domain_types::OpcRelationship {
                id: "rId1".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet1.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId2".to_string(),
                rel_type: crate::write::REL_WORKSHEET.to_string(),
                target: "worksheets/sheet2.xml".to_string(),
                target_mode: None,
            },
            domain_types::OpcRelationship {
                id: "rId99".to_string(),
                rel_type: REL_PIVOT_CACHE.to_string(),
                target: "pivotCache/pivotCacheDefinition7.xml".to_string(),
                target_mode: None,
            },
        ],
        sheet_workbook_r_ids: vec!["rId1".to_string(), "rId2".to_string()],
        binary_blobs: vec![
            domain_types::BlobPart {
                path: "xl/pivotTables/pivotTable7.xml".to_string(),
                data: b"original pivot table".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheDefinition7.xml".to_string(),
                data: b"original cache definition".to_vec(),
            },
            domain_types::BlobPart {
                path: "xl/pivotCache/pivotCacheRecords7.xml".to_string(),
                data: b"original cache records".to_vec(),
            },
        ],
        ..Default::default()
    };
    ctx.sheets[1].sheet_opc_rels = vec![domain_types::OpcRelationship {
        id: "rId7".to_string(),
        rel_type: REL_PIVOT_TABLE.to_string(),
        target: "../pivotTables/pivotTable7.xml".to_string(),
        target_mode: None,
    }];

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_rels =
        String::from_utf8(archive.read_file("xl/_rels/workbook.xml.rels").unwrap()).unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(!workbook_rels.contains("pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/worksheets/_rels/sheet2.xml.rels"));
    assert!(!content_types.contains("PartName=\"/xl/pivotTables/pivotTable7.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/pivotCache/pivotCacheDefinition7.xml\""));
    assert!(!content_types.contains("PartName=\"/xl/pivotCache/pivotCacheRecords7.xml\""));
    assert!(!archive.contains("xl/pivotTables/pivotTable7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition7.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords7.xml"));
    assert!(!archive.contains("xl/pivotTables/pivotTable1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheDefinition1.xml"));
    assert!(!archive.contains("xl/pivotCache/pivotCacheRecords1.xml"));
}

#[test]
fn missing_pivot_cache_ids_are_grouped_by_source_contract() {
    let output = pivot_package_output(vec![
        make_pivot_config(
            "pivot-1",
            "PivotTable1",
            "Data",
            cell_types::SheetRange::new(0, 0, 2, 1),
            "Pivot",
            None,
        ),
        make_pivot_config(
            "pivot-2",
            "PivotTable2",
            "Data",
            cell_types::SheetRange::new(4, 0, 5, 1),
            "Pivot",
            None,
        ),
    ]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).unwrap();
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let pivot_table_1 =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable1.xml").unwrap()).unwrap();
    let pivot_table_2 =
        String::from_utf8(archive.read_file("xl/pivotTables/pivotTable2.xml").unwrap()).unwrap();
    let pivot_table_1_rels = String::from_utf8(
        archive
            .read_file("xl/pivotTables/_rels/pivotTable1.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let pivot_table_2_rels = String::from_utf8(
        archive
            .read_file("xl/pivotTables/_rels/pivotTable2.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert_eq!(workbook_xml.matches("<pivotCache ").count(), 2);
    assert!(workbook_xml.contains("cacheId=\"1\""));
    assert!(workbook_xml.contains("cacheId=\"2\""));
    assert!(pivot_table_1.contains("cacheId=\"1\""));
    assert!(pivot_table_2.contains("cacheId=\"2\""));
    assert!(pivot_table_1_rels.contains("../pivotCache/pivotCacheDefinition1.xml"));
    assert!(pivot_table_2_rels.contains("../pivotCache/pivotCacheDefinition2.xml"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels"));
    assert!(archive.contains("xl/pivotCache/_rels/pivotCacheDefinition2.xml.rels"));
}

#[test]
fn data_table_regions_drive_ooxml_formula_export_with_flags() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(0, 1, DomainValue::Number(FiniteF64::new(2.0).unwrap())),
            make_formula_cell(
                1,
                1,
                "TABLE($A$1,$B$1)",
                DomainValue::Number(FiniteF64::new(3.0).unwrap()),
            ),
            make_formula_cell(
                1,
                2,
                "TABLE($A$1,$B$1)",
                DomainValue::Number(FiniteF64::new(4.0).unwrap()),
            ),
        ],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 1,
        start_col: 1,
        end_row: 1,
        end_col: 2,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 1,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 0,
            col: 0,
        }),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: None,
            r2: None,
            aca: true,
            ca: true,
            bx: true,
            dt2d: true,
            dtr: true,
            del1: true,
            del2: true,
        }),
    });

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"B2:C2\""));
    assert!(sheet_xml.contains("r1=\"$A$1\""));
    assert!(sheet_xml.contains("r2=\"$B$1\""));
    assert!(sheet_xml.contains("aca=\"1\""));
    assert!(sheet_xml.contains("ca=\"1\""));
    assert!(sheet_xml.contains("bx=\"1\""));
    assert!(sheet_xml.contains("dt2D=\"1\""));
    assert!(sheet_xml.contains("dtr=\"1\""));
    assert!(sheet_xml.contains("del1=\"1\""));
    assert!(sheet_xml.contains("del2=\"1\""));
}

#[test]
fn data_table_regions_preserve_authored_r1_r2_spelling_when_present() {
    let mut output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            6,
            7,
            "TABLE($C$21,$C$8)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);
    output.data_table_regions.push(DataTableRegion {
        sheet_index: 0,
        start_row: 6,
        start_col: 7,
        end_row: 10,
        end_col: 11,
        row_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 20,
            col: 2,
        }),
        col_input_ref: Some(CellRef::Positional {
            sheet: cell_types::SheetId::from_raw(0),
            row: 7,
            col: 2,
        }),
        ooxml_flags: Some(DataTableOoxmlFlags {
            r1: Some("C8".to_string()),
            r2: Some("C21".to_string()),
            dt2d: true,
            dtr: true,
            ca: true,
            ..Default::default()
        }),
    });

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f t=\"dataTable\""));
    assert!(sheet_xml.contains("ref=\"H7:L11\""));
    assert!(sheet_xml.contains("r1=\"C8\""));
    assert!(sheet_xml.contains("r2=\"C21\""));
    assert!(!sheet_xml.contains("r1=\"$C$8\""));
    assert!(!sheet_xml.contains("r2=\"$C$21\""));
}

#[test]
fn table_formula_body_cells_export_as_cached_values_only() {
    let output = make_parse_output(vec![SheetData {
        name: "DataTable".to_string(),
        cells: vec![make_formula_cell(
            6,
            8,
            "TABLE($C$21,$C$8)",
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<c r=\"I7\""));
    assert!(sheet_xml.contains("<v>3</v>"));
    assert!(!sheet_xml.contains("<f>TABLE("));
}

fn chart_auxiliary_data(chart_num: usize) -> domain_types::ChartAuxiliaryData {
    domain_types::ChartAuxiliaryData {
        auxiliary_files: vec![
            domain_types::BlobPart {
                path: format!("xl/charts/style{chart_num}.xml"),
                data: b"<c:styleSheet xmlns:c=\"http://schemas.microsoft.com/office/drawing/2012/chartStyle\"/>"
                    .to_vec(),
            },
            domain_types::BlobPart {
                path: format!("xl/charts/vendor{chart_num}.xml"),
                data: b"<vendor:chartSidecar/>".to_vec(),
            },
        ],
        chart_rels: Some(
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style{chart_num}.xml"/><Relationship Id="rId10" Type="http://example.com/vendorChartSidecar" Target="vendor{chart_num}.xml"/></Relationships>"#
            )
            .into_bytes(),
        ),
        original_path: Some(format!("xl/charts/chart{chart_num}.xml")),
    }
}

fn chart_auxiliary_roundtrip_context() -> domain_types::RoundTripContext {
    domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            chart_auxiliary_data: vec![chart_auxiliary_data(9)],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn chart_auxiliary_roundtrip_context_with_charts(
    chart_nums: &[usize],
) -> domain_types::RoundTripContext {
    domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            chart_auxiliary_data: chart_nums
                .iter()
                .copied()
                .map(chart_auxiliary_data)
                .collect(),
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn with_chart_identity(mut chart: ChartSpec, target: &str) -> ChartSpec {
    chart.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            relationship_target: Some(target.to_string()),
            relationship_id: Some("rId9".to_string()),
            ..Default::default()
        },
    );
    chart
}

#[test]
fn generated_chart_does_not_inherit_stale_auxiliary_parts_by_local_index() {
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![make_chart(ChartType::Column, "Data!A1:B2")],
        ..Default::default()
    }]);
    let ctx = chart_auxiliary_roundtrip_context();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(!archive.contains("xl/charts/chart9.xml"));
    assert!(!archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart1.xml.rels"));
    assert!(!content_types.contains("/xl/charts/style9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_with_modeled_state_does_not_replay_stale_raw_chart_xml() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Stale Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains("Modeled Revenue"));
    assert!(!chart_xml.contains("Stale Revenue"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn modeled_chart_ignores_stale_chart_frame_relationship_target() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = Some("Modeled Revenue".to_string());
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Stale Revenue</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let imported_chart = with_chart_identity(imported_chart, "../charts/chart9.xml");
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_rels_bytes = archive
        .read_file("xl/drawings/_rels/drawing1.xml.rels")
        .unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_bytes);
    let drawing_rel = drawing_rels
        .iter()
        .find(|rel| rel.rel_type == REL_CHART)
        .expect("modeled chart should have a drawing relationship");

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(!archive.contains("xl/charts/chart9.xml"));
    assert_eq!(drawing_rel.target, "../charts/chart1.xml");
    assert_ne!(drawing_rel.id, "rId9");
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_with_modeled_chart_property_does_not_replay_stale_raw_chart_xml() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.gap_width = Some(75);
    imported_chart.definition = Some(domain_types::ChartDefinition::Chart(
        ooxml_types::charts::ChartSpace::default(),
    ));
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:gapWidth val="222"/></c:barChart></c:plotArea></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let chart_xml = String::from_utf8(archive.read_file("xl/charts/chart1.xml").unwrap()).unwrap();

    assert!(chart_xml.contains(r#"<c:gapWidth val="75"/>"#));
    assert!(!chart_xml.contains(r#"<c:gapWidth val="222"/>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_parts_replay_only_with_imported_chart_identity() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let imported_chart = with_chart_identity(imported_chart, "../charts/chart9.xml");
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);
    let ctx = chart_auxiliary_roundtrip_context();

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/vendor9.xml"));
    assert!(content_types.contains("/xl/charts/style9.xml"));
    assert!(!content_types.contains("/xl/charts/vendor9.xml"));
    assert!(chart_rels.contains(r#"Id="rId9""#));
    assert!(chart_rels.contains(r#"Target="style9.xml""#));
    assert!(!chart_rels.contains("vendor9.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn imported_chart_auxiliary_parts_follow_original_chart_identity_after_deleting_prior_chart() {
    let mut imported_chart = make_chart(ChartType::Column, "Data!A1:B2");
    imported_chart.title = None;
    imported_chart.data_range = None;
    imported_chart.preserved_chart_xml = Some(
        r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>"#
            .to_string(),
    );
    let imported_chart = with_chart_identity(imported_chart, "../charts/chart9.xml");
    let output = make_parse_output(vec![SheetData {
        name: "Data".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Text(Arc::from("Quarter"))),
            make_cell(0, 1, DomainValue::Text(Arc::from("Revenue"))),
            make_cell(1, 0, DomainValue::Text(Arc::from("Q1"))),
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(100.0).unwrap())),
        ],
        charts: vec![imported_chart],
        ..Default::default()
    }]);
    let ctx = chart_auxiliary_roundtrip_context_with_charts(&[5, 9]);

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    let chart_rels = String::from_utf8(
        archive
            .read_file("xl/charts/_rels/chart9.xml.rels")
            .unwrap(),
    )
    .unwrap();

    assert!(archive.contains("xl/charts/chart9.xml"));
    assert!(archive.contains("xl/charts/style9.xml"));
    assert!(!archive.contains("xl/charts/chart5.xml"));
    assert!(!archive.contains("xl/charts/style5.xml"));
    assert!(content_types.contains("/xl/charts/style9.xml"));
    assert!(!content_types.contains("/xl/charts/style5.xml"));
    assert!(chart_rels.contains(r#"Target="style9.xml""#));
    assert!(!chart_rels.contains("style5.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

fn make_chart(chart_type: ChartType, data_range: &str) -> ChartSpec {
    ChartSpec {
        chart_type,
        title: Some("Revenue".to_string()),
        position: AnchorPosition {
            anchor_row: 0,
            anchor_col: 0,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: Some(15),
            end_col: Some(8),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: None,
            extent_cy: None,
        },
        size: ObjectSize {
            width: 640.0,
            height: 300.0,
            height_pt: None,
            width_pt: None,
            left_pt: None,
            top_pt: None,
        },
        z_index: 0,
        definition: None,
        preserved_chart_xml: None,
        series: Vec::new(),
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: Some(data_range.to_string()),
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        data_table: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        split_type: None,
        split_value: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        rt: None,
        chart_frame: None,
        is_chart_ex: false,
        cnv_pr_name: Some("Revenue Chart".to_string()),
        cnv_pr_id: Some(2),
        cnv_pr_descr: None,
        cnv_pr_title: None,
        cnv_pr_hidden: false,
        no_change_aspect: None,
        has_graphic_frame_locks: false,
        xfrm_off_x: 0,
        xfrm_off_y: 0,
        xfrm_ext_cx: 0,
        xfrm_ext_cy: 0,
        cnv_pr_ext_lst: None,
        anchor_edit_as: None,
        macro_name: None,
        client_data_locks_with_sheet: None,
        client_data_prints_with_sheet: None,
        anchor_index: None,
        import_status: None,
    }
}

#[test]
fn test_empty_workbook() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_number_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(42.0).unwrap())),
            make_cell(0, 1, DomainValue::Number(FiniteF64::new(3.14).unwrap())),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_string_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("hello world")))],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_formula_cells() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(A2:A10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn matching_roundtrip_formula_metadata_decorates_current_formula_cell() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(A2:A10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let imported_formula = ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        r#ref: Some("A1:A1".to_string()),
        text: "SUM(A2:A10)".to_string(),
        ..Default::default()
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            cell_formulas: vec![((0, 0), imported_formula)],
            xml_space_formula_cells: vec![(0, 0)],
            force_recalc_cells: vec![(0, 0)],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<f t="shared" si="7" ref="A1:A1""#));
    assert!(sheet_xml.contains(r#"ca="1""#));
    assert!(sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn imported_shared_formula_range_is_not_replayed_without_modeled_group() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(A2:A10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let imported_formula = ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        r#ref: Some("A1:A2".to_string()),
        text: "SUM(A2:A10)".to_string(),
        ..Default::default()
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            cell_formulas: vec![((0, 0), imported_formula)],
            xml_space_formula_cells: vec![(0, 0)],
            force_recalc_cells: vec![(0, 0)],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(A2:A10)</f>"));
    assert!(!sheet_xml.contains(r#"t="shared""#));
    assert!(!sheet_xml.contains(r#"si="7""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn imported_array_formula_range_is_not_replayed_without_modeled_group() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(A2:A10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let imported_formula = ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Array,
        r#ref: Some("A1:A2".to_string()),
        text: "SUM(A2:A10)".to_string(),
        aca: true,
        ..Default::default()
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            cell_formulas: vec![((0, 0), imported_formula)],
            force_recalc_cells: vec![(0, 0)],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(A2:A10)</f>"));
    assert!(!sheet_xml.contains(r#"t="array""#));
    assert!(!sheet_xml.contains(r#"aca="1""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
}

#[test]
fn stale_roundtrip_formula_metadata_does_not_decorate_edited_formula_cell() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_formula_cell(
            0,
            0,
            "SUM(B2:B10)",
            DomainValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let imported_formula = ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::Shared,
        si: Some(7),
        r#ref: Some("A1:A1".to_string()),
        text: "SUM(A2:A10)".to_string(),
        ..Default::default()
    };
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            cell_formulas: vec![((0, 0), imported_formula)],
            xml_space_formula_cells: vec![(0, 0)],
            force_recalc_cells: vec![(0, 0)],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="shared""#));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn stale_formula_hints_do_not_decorate_replaced_value_cell() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(42.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let ctx = domain_types::RoundTripContext {
        sheets: vec![domain_types::SheetRoundTripContext {
            xml_space_formula_cells: vec![(0, 0)],
            force_recalc_cells: vec![(0, 0)],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(!sheet_xml.contains("<f"));
    assert!(!sheet_xml.contains(r#"ca="1""#));
    assert!(!sheet_xml.contains(r#"xml:space="preserve""#));
}

#[test]
fn stale_data_table_formula_metadata_does_not_decorate_edited_formula_cell() {
    let mut edited_formula_cell = make_formula_cell(
        0,
        0,
        "SUM(B2:B10)",
        DomainValue::Number(FiniteF64::new(100.0).unwrap()),
    );
    edited_formula_cell.cell_formula = Some(ooxml_types::worksheet::CellFormula {
        t: ooxml_types::worksheet::CellFormulaType::DataTable,
        r#ref: Some("A1:B2".to_string()),
        r1: Some("$A$1".to_string()),
        r2: Some("$B$1".to_string()),
        dt2d: true,
        ..Default::default()
    });
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![edited_formula_cell],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<f>SUM(B2:B10)</f>"));
    assert!(!sheet_xml.contains(r#"t="dataTable""#));
    assert!(!sheet_xml.contains(r#"dt2D="1""#));
}

#[test]
fn test_mixed_cell_types() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(0, 1, DomainValue::Text(Arc::from("text"))),
            make_cell(1, 0, DomainValue::Boolean(true)),
            make_cell(1, 1, DomainValue::Error(value_types::CellError::Ref, None)),
            make_cell(2, 0, DomainValue::Null),
        ],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_merges() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("merged")))],
        merges: vec![MergeRegion {
            start_row: 0,
            start_col: 0,
            end_row: 1,
            end_col: 2,
        }],
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_col_widths_and_row_heights() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        dimensions: SheetDimensions {
            col_widths: vec![ColDimension {
                col: 0,
                width: 20.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
            }],
            row_heights: vec![RowDimension {
                row: 0,
                height: 25.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            }],
            ..Default::default()
        },
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_frozen_pane() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        frozen_pane: Some(FrozenPane {
            rows: 1,
            cols: 0,
            top_left_cell: None,
        }),
        ..Default::default()
    }]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_multiple_sheets() {
    let output = make_parse_output(vec![
        SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(1.0).unwrap()),
            )],
            ..Default::default()
        },
        SheetData {
            name: "Sheet2".to_string(),
            cells: vec![make_cell(0, 0, DomainValue::Text(Arc::from("sheet2")))],
            ..Default::default()
        },
    ]);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn test_styled_cells() {
    let palette = vec![
        DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                size: Some(14_000), // 14pt in millipoints
                color: Some("#FF0000".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        },
        DocumentFormat {
            fill: Some(FillFormat {
                background_color: Some("#00FF00".to_string()),
                pattern_type: Some("solid".to_string()),
                ..Default::default()
            }),
            number_format: Some("#,##0.00".to_string()),
            ..Default::default()
        },
    ];

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                {
                    let mut c = make_cell(0, 0, DomainValue::Number(FiniteF64::new(42.0).unwrap()));
                    c.style_id = Some(0); // palette[0] -> cellXfs[1]
                    c
                },
                {
                    let mut c =
                        make_cell(0, 1, DomainValue::Number(FiniteF64::new(1234.56).unwrap()));
                    c.style_id = Some(1); // palette[1] -> cellXfs[2]
                    c
                },
            ],
            ..Default::default()
        }],
        style_palette: palette,
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
}

#[test]
fn unused_imported_stylesheet_is_not_replayed_without_modeled_style_references() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(1.0).unwrap()),
            )],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;STALE&quot;0"/></numFmts>
          <fonts count="2">
            <font><sz val="11"/><name val="Calibri"/></font>
            <font><sz val="12"/><name val="StaleFont"/></font>
          </fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="2">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
            <xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
          </cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(!styles_xml.contains("StaleFont"));
    assert!(!styles_xml.contains("STALE"));
    assert!(styles_xml.contains("<cellXfs count=\"1\""));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn conditional_format_dxf_reference_keeps_imported_stylesheet() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_cell(
                0,
                0,
                DomainValue::Number(FiniteF64::new(10.0).unwrap()),
            )],
            conditional_formats: vec![ConditionalFormat {
                id: "cf1".to_string(),
                sheet_id: "sheet1".to_string(),
                pivot: None,
                ranges: vec![CFCellRange::new(0, 0, 9, 0)],
                range_identities: None,
                rules: vec![CFRule::CellValue {
                    id: "rule1".to_string(),
                    priority: 1,
                    stop_if_true: None,
                    operator: CfOperator::GreaterThan,
                    value1: serde_json::json!(5),
                    value2: None,
                    style: CFStyle {
                        dxf_id: Some(0),
                        ..Default::default()
                    },
                    text: None,
                }],
            }],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="1"><dxf><font><color rgb="FFFF0000"/></font></dxf></dxfs>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(styles_xml.contains(r#"<dxfs count="1">"#));
    assert!(styles_xml.contains(r#"rgb="FFFF0000""#));
    assert!(sheet_xml.contains(r#"dxfId="0""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn clean_imported_stylesheet_ext_lst_is_preserved() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![{
                let mut cell = make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap()));
                cell.style_id = Some(0);
                cell
            }],
            ..Default::default()
        }],
        style_palette: Vec::new(),
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        styles_ext_lst_xml: Some(
            br#"<extLst><ext uri="{vendor-style-extension}"><vendor:styleHint value="kept"/></ext></extLst>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(styles_xml.contains("vendor-style-extension"));
    assert!(styles_xml.contains("vendor:styleHint"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn mutated_imported_stylesheet_drops_raw_ext_lst() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![{
                let mut cell = make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap()));
                cell.style_id = Some(0);
                cell
            }],
            ..Default::default()
        }],
        style_palette: vec![DocumentFormat {
            font: Some(FontFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        }],
        ..Default::default()
    };
    let imported_styles = br#"
        <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
          <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
          <borders count="1"><border/></borders>
          <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
          <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
          <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
          <dxfs count="0"/>
          <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
        </styleSheet>
    "#;
    let ctx = domain_types::RoundTripContext {
        parsed_stylesheet: Some(crate::domain::styles::read::parse_styles(imported_styles)),
        styles_ext_lst_xml: Some(
            br#"<extLst><ext uri="{stale-style-extension}"><vendor:staleStyleNode/></ext></extLst>"#
                .to_vec(),
        ),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output, Some(&ctx)).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let styles_xml = String::from_utf8(archive.read_file("xl/styles.xml").unwrap()).unwrap();

    assert!(!styles_xml.contains("stale-style-extension"));
    assert!(!styles_xml.contains("staleStyleNode"));
    assert!(styles_xml.contains("<b/>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn test_hex_to_color_def() {
    let c = hex_to_color_def("#FF0000");
    assert_eq!(
        c,
        ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }
    );
}

#[test]
fn test_hex_to_color_def_no_hash() {
    let c = hex_to_color_def("FFFF0000");
    assert_eq!(
        c,
        ColorDef::Rgb {
            val: "FFFF0000".to_string(),
            tint: None,
        }
    );
}

#[test]
fn test_style_mapping_font() {
    let palette = vec![DocumentFormat {
        font: Some(FontFormat {
            name: Some("Arial".to_string()),
            size: Some(12_000),
            bold: Some(true),
            italic: Some(true),
            underline: Some("single".to_string()),
            strikethrough: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    }];
    let writer = build_styles(&palette);
    // Default font + our font = 2 fonts
    assert_eq!(writer.fonts.len(), 2);
    assert_eq!(writer.fonts[1].name.as_deref(), Some("Arial"));
    assert_eq!(writer.fonts[1].size, Some(12.0));
    assert_eq!(writer.fonts[1].bold, Some(true));
    assert_eq!(writer.fonts[1].italic, Some(true));
    assert_eq!(writer.fonts[1].strikethrough, Some(true));
}

#[test]
fn test_style_mapping_border() {
    let palette = vec![DocumentFormat {
        border: Some(BorderFormat {
            top: Some(DomainBorderSide {
                style: "thin".to_string(),
                color: Some("#000000".to_string()),
                color_tint: None,
            }),
            ..Default::default()
        }),
        ..Default::default()
    }];
    let writer = build_styles(&palette);
    // Default border + our border = 2 borders
    assert_eq!(writer.borders.len(), 2);
}

#[test]
fn test_named_ranges() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        named_ranges: vec![NamedRange {
            name: "MyRange".to_string(),
            refers_to: "Sheet1!$A$1:$B$10".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: Some("comment text".to_string()),
            custom_menu: Some("menu text".to_string()),
            description: Some("description text".to_string()),
            help: Some("help text".to_string()),
            status_bar: Some("status text".to_string()),
            xlm: true,
            function: true,
            vb_procedure: true,
            publish_to_server: true,
            workbook_parameter: true,
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    assert_eq!(&bytes[0..2], b"PK");
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    assert!(workbook_xml.contains("comment=\"comment text\""));
    assert!(workbook_xml.contains("customMenu=\"menu text\""));
    assert!(workbook_xml.contains("description=\"description text\""));
    assert!(workbook_xml.contains("help=\"help text\""));
    assert!(workbook_xml.contains("statusBar=\"status text\""));
    assert!(workbook_xml.contains("function=\"1\""));
    assert!(workbook_xml.contains("vbProcedure=\"1\""));
    assert!(workbook_xml.contains("xlm=\"1\""));
    assert!(workbook_xml.contains("publishToServer=\"1\""));
    assert!(workbook_xml.contains("workbookParameter=\"1\""));
}

#[test]
fn test_col_styles_roundtrip() {
    // Test that col_styles are preserved through the write pipeline.
    // Use build_sheet directly to inspect the ColWidth output.
    use super::sheet_builder::build_sheet;
    use crate::write::SharedStringsWriter;

    let sheet_data = SheetData {
        name: "Sheet1".to_string(),
        dimensions: SheetDimensions {
            col_widths: vec![ColDimension {
                col: 0,
                width: 9.0,
                custom_width: false,
                hidden: false,
                best_fit: false,
                collapsed: false,
            }],
            ..Default::default()
        },
        col_styles: vec![ColStyleEntry {
            col: 0,
            style_id: 15,
        }],
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(1.0).unwrap()),
        )],
        ..Default::default()
    };

    let mut shared_strings = SharedStringsWriter::new();
    let no_dt_bodies: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    let no_dt_regions = Vec::new();
    // Test with lossless_styles=true (style_id is raw cellXfs index)
    let writer = build_sheet(
        &sheet_data,
        &mut shared_strings,
        true,
        None,
        &no_dt_bodies,
        &no_dt_regions,
        true,
    );
    let xml = String::from_utf8(writer.to_xml()).unwrap();
    assert!(
        xml.contains("style=\"15\""),
        "Expected style=\"15\" on <col> element (lossless path), but got: {}",
        &xml[..xml.len().min(2000)]
    );

    // Test with lossless_styles=false (palette index N → cellXfs[N+1])
    let mut shared_strings2 = SharedStringsWriter::new();
    let writer2 = build_sheet(
        &sheet_data,
        &mut shared_strings2,
        false,
        None,
        &no_dt_bodies,
        &no_dt_regions,
        true,
    );
    let xml2 = String::from_utf8(writer2.to_xml()).unwrap();
    // In lossy path, palette index 15 should become cellXfs index 16
    assert!(
        xml2.contains("style=\"16\""),
        "Expected style=\"16\" on <col> element (lossy path), but got: {}",
        &xml2[..xml2.len().min(2000)]
    );
}
