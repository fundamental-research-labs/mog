use super::styles::hex_to_color_def;
use super::*;
use crate::domain::styles::write::ColorDef;
use crate::infra::package_integrity::validate_archive_package_integrity;
use domain_types::{
    AnchorPosition, AuthoredStyleRun, BorderFormat, BorderSide as DomainBorderSide, CFCellRange,
    CFRule, CFStyle, CellData as DomainCellData, CellValue as DomainValue, ChartSpec, ChartType,
    ColDimension, ColStyleEntry, ConditionalFormat, DataTableOoxmlFlags, DataTableRegion,
    DocumentFormat, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ObjectSize,
    ParseOutput, RowDimension, RowStyleEntry, SheetData, SheetDimensions, TrailingColRange,
    WorkbookStylesheet,
};
use formula_types::CellRef;
use std::sync::Arc;
use value_types::FiniteF64;

fn make_parse_output(sheets: Vec<SheetData>) -> ParseOutput {
    ParseOutput {
        sheets,
        ..Default::default()
    }
}

mod chart_color_style;
mod chart_ex_frame_defaults;
mod chart_ex_modeled_state;
mod chart_ex_replay;
mod chart_export_defaults;
mod chart_export_plan;
mod chart_plot_vis_only_replay;
mod chart_user_shapes;
mod charts;
mod context_removal_gates;
mod data_tables;
mod package_graph_ownership;
mod pivot_package;
mod smoke_and_formulas;
mod sparklines;
mod styles;
mod theme;

fn make_cell(row: u32, col: u32, value: DomainValue) -> DomainCellData {
    DomainCellData {
        row,
        col,
        value,
        ..Default::default()
    }
}

fn chart_ex_with_raw_anchor(original_number: usize) -> ChartSpec {
    let mut chart_ex = make_chart(ChartType::Waterfall, "");
    chart_ex.title = None;
    chart_ex.data_range = None;
    chart_ex.is_chart_ex = true;
    chart_ex.definition = Some(domain_types::ChartDefinition::ChartEx(
        ooxml_types::chart_ex::ChartExSpace::default(),
    ));
    chart_ex.position = domain_types::AnchorPosition {
        anchor_row: 1,
        anchor_col: 2,
        anchor_row_offset: 0,
        anchor_col_offset: 0,
        absolute_x: None,
        absolute_y: None,
        end_row: Some(12),
        end_col: Some(8),
        end_row_offset: Some(0),
        end_col_offset: Some(0),
        extent_cx: None,
        extent_cy: None,
    };
    chart_ex.cnv_pr_name = Some("ChartEx Raw".to_string());
    chart_ex.cnv_pr_id = Some(77);
    chart_ex.anchor_edit_as = Some("twoCell".to_string());

    let mut graphic_frame = ooxml_types::drawings::SpreadsheetGraphicFrame::default();
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.id =
        ooxml_types::drawings::StDrawingElementId::new(77);
    graphic_frame.nv_graphic_frame_pr.c_nv_pr.name = "ChartEx Raw".to_string();
    graphic_frame.xfrm = ooxml_types::drawings::Transform2D {
        offset: Some((0, 0)),
        extent: Some((0, 0)),
        rotation: None,
        flip_h: None,
        flip_v: None,
    };
    let relationship_id = "rId1".to_string();
    let relationship_target = format!("../charts/chartEx{original_number}.xml");
    let original_path = format!("xl/charts/chartEx{original_number}.xml");
    let raw_anchor = format!(
        r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><!--RAW-CHARTEX-ANCHOR--><mc:Choice Requires="cx1"><xdr:twoCellAnchor editAs="twoCell"><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="77" name="ChartEx Raw"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart r:id="{relationship_id}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></mc:Choice></mc:AlternateContent>"#
    );

    chart_ex.chart_frame = Some(
        domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps {
            graphic_frame,
            anchor_index: Some(0),
            edit_as: Some("twoCell".to_string()),
            relationship_id: Some(relationship_id),
            relationship_target: Some(relationship_target),
            raw_alternate_content: Some(raw_anchor),
            ..Default::default()
        },
    );
    chart_ex.chart_ex_replay = Some(domain_types::chart::ChartExReplayData {
        original_path,
        original_xml: br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart><cx:plotArea><cx:plotAreaRegion/></cx:plotArea></cx:chart></cx:chartSpace>"#
            .to_vec(),
        original_position: chart_ex.position.clone(),
        projection_fingerprint: None,
        rels_path: None,
        rels_xml: None,
        relationships: Vec::new(),
        auxiliary_files: Vec::new(),
    });
    refresh_chart_ex_replay_projection_fingerprint(&mut chart_ex);
    chart_ex
}

fn refresh_chart_ex_replay_projection_fingerprint(chart_ex: &mut ChartSpec) {
    let projection_fingerprint = chart_replay::standard_chart_projection_fingerprint(chart_ex);
    if let Some(replay) = chart_ex.chart_ex_replay.as_mut() {
        replay.projection_fingerprint = Some(projection_fingerprint);
    }
}

fn sheet_xml_from_output(output: &ParseOutput) -> String {
    let bytes = write_xlsx_from_parse_output(output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap()
}

fn dimension_count(sheet_xml: &str) -> usize {
    sheet_xml.matches("<dimension ").count()
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

#[test]
fn matching_authored_worksheet_dimension_is_preserved_once() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        worksheet_dimension_ref: Some("$A$1:$C$2".to_string()),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(1.0).unwrap()),
        )],
        authored_style_runs: vec![AuthoredStyleRun {
            start_row: 1,
            start_col: 2,
            end_row: 1,
            end_col: 2,
            style_id: 0,
        }],
        ..Default::default()
    }]);

    let sheet_xml = sheet_xml_from_output(&output);

    assert_eq!(dimension_count(&sheet_xml), 1);
    assert!(sheet_xml.contains(r#"<dimension ref="$A$1:$C$2"/>"#));
    assert!(sheet_xml.find("<dimension ").unwrap() < sheet_xml.find("<sheetViews").unwrap());
}

#[test]
fn stale_or_malformed_authored_worksheet_dimension_is_recomputed() {
    let stale = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        worksheet_dimension_ref: Some("A1".to_string()),
        cells: vec![make_cell(
            2,
            3,
            DomainValue::Number(FiniteF64::new(2.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let stale_xml = sheet_xml_from_output(&stale);
    assert_eq!(dimension_count(&stale_xml), 1);
    assert!(stale_xml.contains(r#"<dimension ref="D3"/>"#));

    let malformed = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        worksheet_dimension_ref: Some("A1,C3".to_string()),
        cells: vec![make_cell(
            0,
            0,
            DomainValue::Number(FiniteF64::new(3.0).unwrap()),
        )],
        ..Default::default()
    }]);
    let malformed_xml = sheet_xml_from_output(&malformed);
    assert_eq!(dimension_count(&malformed_xml), 1);
    assert!(malformed_xml.contains(r#"<dimension ref="A1"/>"#));
}

#[test]
fn generated_and_style_only_dimensions_come_from_emitted_cells() {
    let generated = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        cells: vec![
            make_cell(1, 1, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
            make_cell(4, 3, DomainValue::Number(FiniteF64::new(4.0).unwrap())),
        ],
        ..Default::default()
    }]);
    let generated_xml = sheet_xml_from_output(&generated);
    assert!(generated_xml.contains(r#"<dimension ref="B2:D5"/>"#));

    let style_only = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        authored_style_runs: vec![AuthoredStyleRun {
            start_row: 2,
            start_col: 4,
            end_row: 3,
            end_col: 5,
            style_id: 0,
        }],
        ..Default::default()
    }]);
    let style_only_xml = sheet_xml_from_output(&style_only);
    assert!(style_only_xml.contains(r#"<dimension ref="E3:F4"/>"#));
    assert!(style_only_xml.contains(r#"<c r="E3" s="0"/>"#));

    let empty = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        ..Default::default()
    }]);
    let empty_xml = sheet_xml_from_output(&empty);
    assert!(empty_xml.contains(r#"<dimension ref="A1"/>"#));
}

#[test]
fn shared_string_rich_text_hint_does_not_seed_export_identity() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![make_text_cell_with_original_sst(0, 0, "Rich", 0)],
            ..Default::default()
        }],
        shared_string_hints: vec![domain_types::SharedStringHint {
            index: 0,
            text: "Rich".to_string(),
            rich_text: Some(vec![domain_types::RichTextRun {
                text: "Rich".to_string(),
                font_name: Some("Calibri".to_string()),
                font_size: Some(11.0),
                bold: true,
                ..Default::default()
            }]),
            phonetic_xml: None,
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(!shared_strings.contains("<rPr><b/>"));
    assert!(shared_strings.contains("<t>Rich</t>"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn empty_persons_part_is_emitted_from_typed_presence_state() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        has_persons_part: true,
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let persons_xml =
        String::from_utf8(archive.read_file("xl/persons/person.xml").unwrap()).unwrap();

    assert!(persons_xml.contains("<personList"));
    assert!(!persons_xml.contains("<person "));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn webextension_cluster_round_trips_through_production_zip_writer() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            ..Default::default()
        }],
        package_fidelity: Some(domain_types::PackageFidelityMetadata {
            root_relationships: vec![domain_types::PackageRelationshipHint {
                id: "rIdWebExt".to_string(),
                relationship_type:
                    "http://schemas.microsoft.com/office/2011/relationships/webextensiontaskpanes"
                        .to_string(),
                target: "xl/webextensions/taskpanes.xml".to_string(),
                target_mode: None,
            }],
            opaque_parts: vec![
                domain_types::OpaquePackagePartHint {
                    path: "xl/webextensions/taskpanes.xml".to_string(),
                    bytes: b"<wetp:taskpanes/>".to_vec(),
                    content_type: Some(
                        "application/vnd.ms-office.webextensiontaskpanes+xml".to_string(),
                    ),
                    relationships: vec![domain_types::PackageRelationshipHint {
                        id: "rId1".to_string(),
                        relationship_type:
                            "http://schemas.microsoft.com/office/2011/relationships/webextension"
                                .to_string(),
                        target: "webextension1.xml".to_string(),
                        target_mode: None,
                    }],
                },
                domain_types::OpaquePackagePartHint {
                    path: "xl/webextensions/webextension1.xml".to_string(),
                    bytes: b"<we:webextension/>".to_vec(),
                    content_type: Some("application/vnd.ms-office.webextension+xml".to_string()),
                    relationships: Vec::new(),
                },
            ],
            ..Default::default()
        }),
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");

    assert!(archive.read_file("xl/webextensions/taskpanes.xml").is_ok());
    assert!(
        archive
            .read_file("xl/webextensions/webextension1.xml")
            .is_ok()
    );
    let root_rels = String::from_utf8(archive.read_file("_rels/.rels").unwrap()).unwrap();
    let taskpane_rels = String::from_utf8(
        archive
            .read_file("xl/webextensions/_rels/taskpanes.xml.rels")
            .unwrap(),
    )
    .unwrap();
    let content_types =
        String::from_utf8(archive.read_file("[Content_Types].xml").unwrap()).unwrap();
    assert!(root_rels.contains("webextensiontaskpanes"));
    assert!(taskpane_rels.contains("webextension1.xml"));
    assert!(content_types.contains("/xl/webextensions/taskpanes.xml"));
    assert!(content_types.contains("/xl/webextensions/webextension1.xml"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn sheet_protection_modern_hash_fields_are_written_from_parse_output() {
    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        protection: Some(domain_types::SheetProtection {
            is_protected: true,
            password_hash: Some("CC2A".to_string()),
            hash_value: Some("modernHash==".to_string()),
            algorithm_name: Some("SHA-512".to_string()),
            salt_value: Some("modernSalt==".to_string()),
            spin_count: Some(100000),
            ..Default::default()
        }),
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<sheetProtection"));
    assert!(sheet_xml.contains(r#"password="CC2A""#));
    assert!(sheet_xml.contains(r#"algorithmName="SHA-512""#));
    assert!(sheet_xml.contains(r#"hashValue="modernHash==""#));
    assert!(sheet_xml.contains(r#"saltValue="modernSalt==""#));
    assert!(sheet_xml.contains(r#"spinCount="100000""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn shared_string_phonetic_hint_does_not_capture_plain_cells_with_same_text() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            cells: vec![
                make_text_cell_with_original_sst(0, 0, "Kana", 0),
                make_cell(1, 0, DomainValue::Text(Arc::from("Kana"))),
            ],
            ..Default::default()
        }],
        shared_string_hints: vec![domain_types::SharedStringHint {
            index: 0,
            text: "Kana".to_string(),
            rich_text: None,
            phonetic_xml: Some(
                br#"<rPh sb="0" eb="4"><t>kana</t></rPh><phoneticPr fontId="1" type="fullwidthKatakana"/>"#
                    .to_vec(),
            ),
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert_eq!(shared_strings.matches("<si>").count(), 1);
    assert!(shared_strings.contains("count=\"2\""));
    assert!(shared_strings.contains("uniqueCount=\"1\""));
    assert_eq!(shared_strings.matches("<rPh").count(), 0);
    assert!(sheet_xml.contains(r#"<c r="A1" t="s"><v>0</v></c>"#));
    assert!(sheet_xml.contains(r#"<c r="A2" t="s"><v>0</v></c>"#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_export_preserves_distinct_image_relationships_to_same_media_part() {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        PictureData, PictureOoxmlProps,
    };

    fn picture(id: &str, anchor_col: u32) -> FloatingObject {
        let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
        picture.blip_fill.embed_id = Some("rIdImported".to_string());
        FloatingObject {
            common: FloatingObjectCommon {
                id: id.to_string(),
                name: id.to_string(),
                width: 100.0,
                height: 40.0,
                anchor: FloatingObjectAnchor {
                    anchor_col,
                    end_col: Some(anchor_col + 1),
                    end_row: Some(1),
                    anchor_mode: AnchorMode::TwoCell,
                    ..Default::default()
                },
                ..Default::default()
            },
            data: FloatingObjectData::Picture(PictureData {
                src: "data:image/png;base64,AQIDBA==".to_string(),
                original_width: None,
                original_height: None,
                crop: None,
                adjustments: None,
                border: None,
                color_type: None,
                ooxml: Some(PictureOoxmlProps {
                    picture,
                    image_path: Some("../media/image1.png".to_string()),
                    ..Default::default()
                }),
            }),
        }
    }

    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![picture("Picture 1", 0), picture("Picture 2", 2)],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    );

    assert!(drawing_xml.contains(r#"r:embed="rId1""#));
    assert!(drawing_xml.contains(r#"r:embed="rId2""#));
    let image_rels: Vec<_> = drawing_rels
        .iter()
        .filter(|rel| rel.rel_type == crate::infra::opc::REL_IMAGE)
        .collect();
    assert_eq!(image_rels.len(), 2);
    assert!(image_rels.iter().any(|rel| rel.id == "rId1"));
    assert!(image_rels.iter().any(|rel| rel.id == "rId2"));
    assert!(
        image_rels
            .iter()
            .all(|rel| rel.target == "../media/image1.png")
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn drawing_picture_external_link_relationship_is_registered_from_owner_state() {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        PictureData, PictureOoxmlProps,
    };

    let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
    picture.blip_fill.embed_id = Some("rIdImported".to_string());
    picture.blip_fill.link_id = Some("rId2".to_string());

    let output = make_parse_output(vec![SheetData {
        name: "Sheet1".to_string(),
        floating_objects: vec![FloatingObject {
            common: FloatingObjectCommon {
                id: "Picture 1".to_string(),
                name: "Picture 1".to_string(),
                width: 100.0,
                height: 40.0,
                anchor: FloatingObjectAnchor {
                    end_col: Some(1),
                    end_row: Some(1),
                    anchor_mode: AnchorMode::TwoCell,
                    ..Default::default()
                },
                ..Default::default()
            },
            data: FloatingObjectData::Picture(PictureData {
                src: "data:image/png;base64,AQIDBA==".to_string(),
                original_width: None,
                original_height: None,
                crop: None,
                adjustments: None,
                border: None,
                color_type: None,
                ooxml: Some(PictureOoxmlProps {
                    picture,
                    image_path: Some("../media/image1.png".to_string()),
                    relationships: vec![ooxml_types::shared::OpcRelationship {
                        id: "rId2".to_string(),
                        rel_type: crate::infra::opc::REL_IMAGE.to_string(),
                        target: "cid:linked-image".to_string(),
                        target_mode: Some("External".to_string()),
                    }],
                    ..Default::default()
                }),
            }),
        }],
        ..Default::default()
    }]);

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let drawing_xml =
        String::from_utf8(archive.read_file("xl/drawings/drawing1.xml").unwrap()).unwrap();
    let drawing_rels = crate::domain::workbook::read::parse_all_rels(
        &archive
            .read_file("xl/drawings/_rels/drawing1.xml.rels")
            .unwrap(),
    );

    assert!(drawing_xml.contains(r#"r:link="rId2""#));
    assert!(drawing_rels.iter().any(|rel| {
        rel.id == "rId2"
            && rel.rel_type == crate::infra::opc::REL_IMAGE
            && rel.target == "cid:linked-image"
            && rel.target_mode.as_deref() == Some("External")
    }));
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
        output_sheet_id: None,
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
        data_on_rows: None,
        ref_range: None,
        first_data_row: None,
        first_header_row: None,
        first_data_col: None,
        rows_per_page: None,
        cols_per_page: None,
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
            ooxml_preservation: Default::default(),
        })
        .collect();
    output
}

fn chart_auxiliary_data(
    chart_num: usize,
) -> (
    Vec<domain_types::chart::ChartRelationshipData>,
    Vec<(String, Vec<u8>)>,
) {
    (
        vec![
            domain_types::chart::ChartRelationshipData {
                r_id: "rId9".to_string(),
                relationship_type: Some(
                    "http://schemas.microsoft.com/office/2011/relationships/chartStyle"
                        .to_string(),
                ),
                target: Some(format!("style{chart_num}.xml")),
                target_mode: None,
            },
            domain_types::chart::ChartRelationshipData {
                r_id: "rId10".to_string(),
                relationship_type: Some("http://example.com/vendorChartSidecar".to_string()),
                target: Some(format!("vendor{chart_num}.xml")),
                target_mode: None,
            },
        ],
        vec![
            (
                format!("xl/charts/style{chart_num}.xml"),
                b"<c:styleSheet xmlns:c=\"http://schemas.microsoft.com/office/drawing/2012/chartStyle\"/>"
                    .to_vec(),
            ),
            (
                format!("xl/charts/vendor{chart_num}.xml"),
                b"<vendor:chartSidecar/>".to_vec(),
            ),
        ],
    )
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

fn with_current_standard_chart_authority(mut chart: ChartSpec) -> ChartSpec {
    let original_path = chart
        .chart_frame
        .as_ref()
        .and_then(|frame| frame.relationship_target.as_deref())
        .map(|target| crate::infra::opc::opc_target_to_zip_path(target, "xl/drawings"))
        .unwrap_or_else(|| "xl/charts/chart1.xml".to_string());
    let fingerprint = chart_replay::standard_chart_projection_fingerprint(&chart);
    chart.standard_chart_provenance = Some(domain_types::chart::StandardChartProvenance {
        original_path: Some(original_path.clone()),
        rels_path: Some(rels_path_for_part(&original_path)),
        projection_schema_version: chart_replay::STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
        projection_fingerprint: Some(fingerprint.clone()),
        relationships: chart.chart_relationships.clone(),
        auxiliary_paths: chart
            .chart_auxiliary_files
            .iter()
            .map(|(path, _)| path.clone())
            .collect(),
    });
    chart.standard_chart_export_authority =
        Some(domain_types::chart::StandardChartExportAuthority {
            schema_version: chart_replay::STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
            validity: domain_types::chart::StandardChartAuthorityValidity::Current,
            chart_part_revision: 0,
            package_owner: Some(original_path),
            relationship_closure_current: true,
            projection_fingerprint: Some(fingerprint),
            invalidated_owner_ids: Vec::new(),
            stale_reason: None,
        });
    chart
}

fn rels_path_for_part(part_path: &str) -> String {
    let Some((dir, file_name)) = part_path.rsplit_once('/') else {
        return format!("_rels/{part_path}.rels");
    };
    format!("{dir}/_rels/{file_name}.rels")
}

fn with_chart_auxiliary(mut chart: ChartSpec, chart_num: usize) -> ChartSpec {
    let (relationships, auxiliary_files) = chart_auxiliary_data(chart_num);
    chart.chart_relationships = relationships;
    chart.chart_auxiliary_files = auxiliary_files;
    chart
}

fn imported_picture_with_media(
    id: &str,
    image_path: &str,
) -> domain_types::domain::floating_object::FloatingObject {
    use domain_types::domain::floating_object::{
        AnchorMode, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
        PictureData, PictureOoxmlProps,
    };

    let mut picture = ooxml_types::drawings::SpreadsheetPicture::default();
    picture.blip_fill.embed_id = Some("rIdImported".to_string());

    FloatingObject {
        common: FloatingObjectCommon {
            id: id.to_string(),
            name: id.to_string(),
            width: 100.0,
            height: 100.0,
            anchor: FloatingObjectAnchor {
                anchor_mode: AnchorMode::TwoCell,
                end_row: Some(4),
                end_col: Some(4),
                ..Default::default()
            },
            ..Default::default()
        },
        data: FloatingObjectData::Picture(PictureData {
            src: "data:image/png;base64,AQIDBA==".to_string(),
            original_width: None,
            original_height: None,
            crop: None,
            adjustments: None,
            border: None,
            color_type: None,
            ooxml: Some(PictureOoxmlProps {
                picture,
                image_path: Some(image_path.to_string()),
                ..Default::default()
            }),
        }),
    }
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
            absolute_x: None,
            absolute_y: None,
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
        definition: Some(domain_types::ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series: Vec::new(),
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: Some(data_range.to_string()),
        series_range: None,
        category_range: None,
        colors: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        gap_depth: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
        show_neg_bubbles: None,
        size_represents: None,
        split_type: None,
        split_value: None,
        show_lines: None,
        smooth_lines: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: None,
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
        pivot_projection: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
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
