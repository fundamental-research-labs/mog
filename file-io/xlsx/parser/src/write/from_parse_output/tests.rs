use super::styles::hex_to_color_def;
use super::*;
use crate::domain::styles::write::ColorDef;
use crate::infra::package_integrity::validate_archive_package_integrity;
use crate::write::REL_PIVOT_TABLE;
use domain_types::{
    AnchorPosition, BorderFormat, BorderSide as DomainBorderSide, CFCellRange, CFRule, CFStyle,
    CellData as DomainCellData, CellValue as DomainValue, ChartSpec, ChartType, ColDimension,
    ColStyleEntry, ConditionalFormat, DataTableOoxmlFlags, DataTableRegion, DocumentFormat,
    FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ObjectSize, ParseOutput,
    RoundTripContext, RowDimension, SheetData, SheetDimensions, WorkbookStylesheet,
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

mod charts;
mod data_tables;
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
fn shared_string_rich_text_hint_is_preserved_from_parse_output() {
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();

    assert!(shared_strings.contains("<rPr><b/>"));
    assert!(shared_strings.contains("<t>Rich</t>"));
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
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

    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let shared_strings =
        String::from_utf8(archive.read_file("xl/sharedStrings.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert_eq!(shared_strings.matches("<si>").count(), 2);
    assert!(shared_strings.contains("count=\"2\""));
    assert!(shared_strings.contains("uniqueCount=\"2\""));
    assert_eq!(shared_strings.matches("<rPh").count(), 1);
    assert!(sheet_xml.contains(r#"<c r="A1" t="s"><v>0</v></c>"#));
    assert!(sheet_xml.contains(r#"<c r="A2" t="s"><v>1</v></c>"#));
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

fn chart_auxiliary_round_trip_data(chart_num: usize) -> domain_types::chart::ChartRoundTripData {
    domain_types::chart::ChartRoundTripData {
        auxiliary_files: vec![
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
        chart_rels_bytes: Some((
            format!("xl/charts/_rels/chart{chart_num}.xml.rels"),
            format!(
                r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2011/relationships/chartStyle" Target="style{chart_num}.xml"/><Relationship Id="rId10" Type="http://example.com/vendorChartSidecar" Target="vendor{chart_num}.xml"/></Relationships>"#
            )
            .into_bytes(),
        )),
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

fn with_chart_auxiliary(mut chart: ChartSpec, chart_num: usize) -> ChartSpec {
    chart.rt = Some(chart_auxiliary_round_trip_data(chart_num));
    chart
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
