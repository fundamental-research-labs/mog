//! XLSX export regressions for runtime-created chart metadata.

use super::super::*;
use super::helpers::{archive_text, engine_from_parse_output_normal, sheet_id, simple_snapshot};
use std::sync::Arc;

use domain_types::chart::{
    ChartRelationshipData, StandardChartAuthorityValidity, StandardChartExportAuthority,
    StandardChartProvenance,
};
use domain_types::domain::floating_object::ChartDrawingFrameOoxmlProps;
use domain_types::{CellData, ChartSpec, ParseOutput, SheetData};
use ooxml_types::charts::{
    AxisCrosses, AxisType, Chart, ChartAxis, ChartAxisPosition, ChartGroup, ChartSpace,
    ChartType as OoxmlChartType, ChartTypeConfig, DataLabelOptions, PlotArea, Scaling, TickMark,
};
use value_types::{CellValue, FiniteF64};

const STANDARD_CHART_PROJECTION_SCHEMA_VERSION: u32 = 6;

#[test]
fn imported_axis_visibility_and_formatting_survive_yrs_and_xlsx_export() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_imported_axis_visibility_and_formatting_survive_yrs_and_xlsx_export)
        .expect("spawn chart roundtrip test")
        .join()
        .expect("chart roundtrip test");
}

fn assert_imported_axis_visibility_and_formatting_survive_yrs_and_xlsx_export() {
    let mut chart = bounded_source_range_chart();
    chart.axes = Some(domain_types::chart::AxisData {
        category_axis: Some(domain_types::chart::SingleAxisData {
            visible: true,
            visible_explicit: true,
            ..Default::default()
        }),
        value_axis: Some(domain_types::chart::SingleAxisData {
            visible: true,
            visible_explicit: true,
            ..Default::default()
        }),
        secondary_category_axis: None,
        secondary_value_axis: None,
        series_axis: None,
    });

    let mut category_axis = imported_axis(AxisType::Category, 10, 20);
    category_axis.sp_pr = Some(xlsx_parser::domain::charts::parse_shape_properties(
        br#"<c:spPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:noFill/><a:ln><a:solidFill><a:srgbClr val="123456"/></a:solidFill></a:ln>
            </c:spPr>"#,
    ));
    category_axis.tx_pr = Some(xlsx_parser::domain::charts::parse_text_body(
        br#"<c:txPr xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
                         xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:bodyPr rot="-60000000"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p>
            </c:txPr>"#,
    ));
    chart.definition = Some(domain_types::ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                axes: vec![category_axis, imported_axis(AxisType::Value, 20, 10)],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));

    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 16,
            cols: 10,
            charts: vec![chart],
            ..Default::default()
        }],
        ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&input);
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let chart_xml = archive_text(&exported_bytes, "xl/charts/chart1.xml").expect("chart XML");
    let category_axis_xml = chart_xml
        .split_once("<c:catAx>")
        .and_then(|(_, rest)| rest.split_once("</c:catAx>"))
        .map(|(axis, _)| axis)
        .expect("category axis XML");

    assert!(category_axis_xml.contains(r#"<c:delete val="0"/>"#));
    assert!(category_axis_xml.contains(r#"<a:srgbClr val="123456"/>"#));
    assert!(category_axis_xml.contains(r#"<a:bodyPr rot="-60000000"/>"#));
    assert!(category_axis_xml.contains(r#"<a:endParaRPr lang="en-US"/>"#));
}

#[test]
fn imported_group_and_series_false_data_label_flags_survive_yrs_and_xlsx_export() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(assert_imported_group_and_series_false_data_label_flags_survive_yrs_and_xlsx_export)
        .expect("spawn chart roundtrip test")
        .join()
        .expect("chart roundtrip test");
}

fn assert_imported_group_and_series_false_data_label_flags_survive_yrs_and_xlsx_export() {
    let mut chart = bounded_source_range_chart();
    chart.series[0].idx = Some(0);
    let false_labels = imported_explicit_false_data_labels();
    chart.definition = Some(domain_types::ChartDefinition::Chart(ChartSpace {
        chart: Chart {
            plot_area: PlotArea {
                chart_groups: vec![ChartGroup {
                    chart_type: OoxmlChartType::Bar,
                    config: ChartTypeConfig::Bar(Default::default()),
                    series: vec![ooxml_types::charts::ChartSeries {
                        idx: 0,
                        order: 0,
                        d_lbls: Some(false_labels.clone()),
                        ..Default::default()
                    }],
                    d_lbls: Some(false_labels),
                    ax_id: vec![10, 20],
                    raw_chart_type_attr: None,
                    raw_chart_element_name: None,
                    raw_chart_group_xml: None,
                }],
                axes: vec![
                    imported_axis(AxisType::Category, 10, 20),
                    imported_axis(AxisType::Value, 20, 10),
                ],
                ..Default::default()
            },
            ..Default::default()
        },
        ..Default::default()
    }));

    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 16,
            cols: 10,
            charts: vec![chart],
            ..Default::default()
        }],
        ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&input);
    let hydrated_sheet_id =
        SheetId::from_uuid_str(&engine.get_all_sheet_ids()[0]).expect("valid hydrated sheet id");
    let stored_chart = engine
        .get_all_floating_objects_typed(&hydrated_sheet_id)
        .into_iter()
        .next()
        .expect("stored chart");
    let domain_types::domain::floating_object::FloatingObjectData::Chart(stored_chart) =
        stored_chart.data
    else {
        panic!("expected stored chart");
    };
    let stored_definition = stored_chart
        .ooxml
        .and_then(|ooxml| ooxml.definition)
        .expect("stored imported definition");
    let domain_types::ChartDefinition::Chart(stored_definition) = stored_definition else {
        panic!("expected standard chart definition");
    };
    let stored_group = &stored_definition.chart.plot_area.chart_groups[0];
    assert!(
        stored_group
            .d_lbls
            .as_ref()
            .is_some_and(|labels| labels.show_value_present)
    );
    assert!(
        stored_group.series[0]
            .d_lbls
            .as_ref()
            .is_some_and(|labels| labels.show_value_present)
    );
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let chart_xml = archive_text(&exported_bytes, "xl/charts/chart1.xml").expect("chart XML");

    for flag in [
        "showVal",
        "showCatName",
        "showSerName",
        "showPercent",
        "showLegendKey",
        "showBubbleSize",
    ] {
        assert_eq!(
            chart_xml
                .matches(&format!(r#"<c:{flag} val="0"/>"#))
                .count(),
            2,
            "expected explicit false {flag} at group and series level: {chart_xml}"
        );
    }
}

fn imported_axis(axis_type: AxisType, ax_id: u32, cross_ax: u32) -> ChartAxis {
    ChartAxis {
        axis_type,
        ax_id,
        scaling: Scaling::default(),
        delete: false,
        delete_explicit: true,
        ax_pos: if axis_type == AxisType::Category {
            ChartAxisPosition::Left
        } else {
            ChartAxisPosition::Bottom
        },
        major_tick_mark: TickMark::None,
        major_tick_mark_explicit: true,
        minor_tick_mark: TickMark::None,
        minor_tick_mark_explicit: true,
        cross_ax,
        crosses: AxisCrosses::AutoZero,
        crosses_explicit: true,
        ..Default::default()
    }
}

fn imported_explicit_false_data_labels() -> DataLabelOptions {
    DataLabelOptions {
        show_value_present: true,
        show_category_present: true,
        show_series_name_present: true,
        show_percent_present: true,
        show_legend_key_present: true,
        show_bubble_size_present: true,
        ..Default::default()
    }
}

#[test]
fn sdk_authored_chart_palette_exports_chart_color_style_part() {
    let cases = [
        (
            serde_json::json!({ "colors": ["#4472C4"] }),
            None,
            Some(r#"<a:srgbClr val="4472C4"/>"#),
        ),
        (
            serde_json::json!({ "colors": ["#4472C4"], "colorScheme": 1 }),
            Some(r#"id="1""#),
            Some(r#"<a:srgbClr val="4472C4"/>"#),
        ),
    ];

    for (appearance_config, expected_scheme, expected_color) in cases {
        assert_sdk_authored_chart_color_style_export(
            appearance_config,
            expected_scheme,
            expected_color,
        );
    }
}

fn assert_sdk_authored_chart_color_style_export(
    appearance_config: serde_json::Value,
    expected_scheme: Option<&str>,
    expected_color: Option<&str>,
) {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sheet_id = sheet_id();
    let mut chart_config = serde_json::json!({
        "type": "area",
        "name": "Palette Contract",
        "title": "Palette Contract",
        "dataRange": "A1:B2",
        "anchorRow": 7,
        "anchorCol": 1,
        "width": 480.0,
        "height": 320.0
    });
    let chart_obj = chart_config
        .as_object_mut()
        .expect("chart config should be an object");
    for (key, value) in appearance_config
        .as_object()
        .expect("appearance config should be an object")
    {
        chart_obj.insert(key.clone(), value.clone());
    }

    engine
        .create_chart(&sheet_id, &chart_config)
        .expect("chart creation should succeed");

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let content_types =
        archive_text(&exported_bytes, "[Content_Types].xml").expect("content types should exist");
    let chart_rels = archive_text(&exported_bytes, "xl/charts/_rels/chart1.xml.rels")
        .expect("chart relationships should exist");
    let color_style = archive_text(&exported_bytes, "xl/charts/colors1.xml")
        .expect("chart color style should exist");

    assert!(content_types.contains("/xl/charts/colors1.xml"));
    assert!(
        chart_rels
            .contains("http://schemas.microsoft.com/office/2011/relationships/chartColorStyle")
    );
    assert!(chart_rels.contains(r#"Target="colors1.xml""#));
    if let Some(expected_scheme) = expected_scheme {
        assert!(color_style.contains(expected_scheme));
    } else {
        assert!(!color_style.contains(r#" id="#));
    }
    if let Some(expected_color) = expected_color {
        assert!(color_style.contains(expected_color));
    }
}

#[test]
fn sdk_authored_chart_color_scheme_without_palette_omits_invalid_sidecar() {
    let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
    let sheet_id = sheet_id();
    engine
        .create_chart(
            &sheet_id,
            &serde_json::json!({
                "type": "area",
                "name": "Scheme-only Contract",
                "dataRange": "A1:B2",
                "anchorRow": 7,
                "anchorCol": 1,
                "width": 480.0,
                "height": 320.0,
                "colorScheme": 1
            }),
        )
        .expect("chart creation should succeed");

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    assert!(archive_text(&exported_bytes, "xl/charts/colors1.xml").is_none());
    let chart_rels = archive_text(&exported_bytes, "xl/charts/_rels/chart1.xml.rels");
    assert!(chart_rels.as_deref().is_none_or(|rels| {
        !rels.contains("http://schemas.microsoft.com/office/2011/relationships/chartColorStyle")
    }));
}

#[test]
fn imported_standard_chart_metadata_survives_yrs_with_current_package_replay() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 20,
            cols: 8,
            charts: vec![imported_current_standard_chart2()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let chart = &exported.sheets[0].charts[0];
    let frame = chart.chart_frame.as_ref().expect("chart frame");

    assert_eq!(chart.series_range, None);
    assert_eq!(chart.category_range, None);
    assert_eq!(frame.relationship_id.as_deref(), Some("rId2"));
    assert_eq!(
        frame.relationship_target.as_deref(),
        Some("../charts/chart2.xml")
    );
    assert_eq!(
        chart
            .standard_chart_provenance
            .as_ref()
            .and_then(|provenance| provenance.original_path.as_deref()),
        Some("xl/charts/chart2.xml")
    );
    assert_eq!(
        chart
            .standard_chart_export_authority
            .as_ref()
            .and_then(|authority| authority.package_owner.as_deref()),
        Some("xl/charts/chart2.xml")
    );
    assert!(
        chart
            .chart_relationships
            .iter()
            .any(|relationship| relationship.target.as_deref() == Some("style2.xml"))
    );
    assert!(
        chart
            .chart_relationships
            .iter()
            .any(|relationship| relationship.target.as_deref() == Some("colors2.xml"))
    );
    assert!(
        chart
            .chart_auxiliary_files
            .iter()
            .any(|(path, _)| path == "xl/charts/style2.xml")
    );
    assert!(
        chart
            .chart_auxiliary_files
            .iter()
            .any(|(path, _)| path == "xl/charts/colors2.xml")
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let archive =
        xlsx_parser::zip::XlsxArchive::new(&exported_bytes).expect("exported XLSX is readable");

    assert!(!archive.contains("xl/charts/chart1.xml"));
    assert!(archive.contains("xl/charts/chart2.xml"));
    assert!(archive.contains("xl/charts/_rels/chart2.xml.rels"));
    assert!(archive.contains("xl/charts/style2.xml"));
    assert!(archive.contains("xl/charts/colors2.xml"));
}

#[test]
fn reconstructed_standard_chart_retains_imported_style_and_color_companions() {
    let mut chart = imported_current_standard_chart2();
    chart.title = Some("Edited Revenue".to_string());
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 20,
            cols: 8,
            charts: vec![chart],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let archive =
        xlsx_parser::zip::XlsxArchive::new(&exported_bytes).expect("exported XLSX is readable");
    let chart_rels = archive_text(&exported_bytes, "xl/charts/_rels/chart1.xml.rels")
        .expect("reconstructed chart relationships should exist");
    let content_types =
        archive_text(&exported_bytes, "[Content_Types].xml").expect("content types should exist");

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(archive.contains("xl/charts/style2.xml"));
    assert!(archive.contains("xl/charts/colors2.xml"));
    assert!(chart_rels.contains(xlsx_parser::infra::opc::REL_CHART_STYLE));
    assert!(chart_rels.contains(r#"Target="style2.xml""#));
    assert!(chart_rels.contains(xlsx_parser::infra::opc::REL_CHART_COLOR_STYLE));
    assert!(chart_rels.contains(r#"Target="colors2.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/charts/style2.xml""#));
    assert!(content_types.contains(r#"PartName="/xl/charts/colors2.xml""#));
}

#[test]
fn historical_nested_chart_palette_is_regenerated_during_current_replay() {
    let mut chart = imported_current_standard_chart2();
    chart.colors = Some(vec!["AAD7E2".to_string()]);
    chart.color_scheme = None;
    chart.chart_auxiliary_files[1].1 = br#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="cycle" id="0"><cs:variation><a:srgbClr val="AAD7E2"/></cs:variation></cs:colorStyle>"#.to_vec();
    let fingerprint = standard_chart_projection_fingerprint(&chart);
    chart
        .standard_chart_provenance
        .as_mut()
        .expect("import provenance")
        .projection_fingerprint = Some(fingerprint.clone());
    chart
        .standard_chart_export_authority
        .as_mut()
        .expect("export authority")
        .projection_fingerprint = Some(fingerprint);

    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 20,
            cols: 8,
            charts: vec![chart],
            ..Default::default()
        }],
        ..Default::default()
    };
    let engine = engine_from_parse_output_normal(&input);
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let color_style = archive_text(&exported_bytes, "xl/charts/colors2.xml")
        .expect("repaired chart color style should exist");
    let chart_rels = archive_text(&exported_bytes, "xl/charts/_rels/chart2.xml.rels")
        .expect("chart relationships should exist");

    assert!(color_style.contains(r#"<a:srgbClr val="AAD7E2"/><cs:variation/>"#));
    assert!(!color_style.contains(r#"id="0""#));
    assert!(!color_style.contains(r#"<cs:variation><a:srgbClr"#));
    assert!(chart_rels.contains(r#"Id="rId2""#));
    assert!(chart_rels.contains(r#"Target="colors2.xml""#));
    assert!(archive_text(&exported_bytes, "xl/charts/style2.xml").is_some());
}

#[test]
fn imported_current_standard_chart_skips_source_completion_before_replay_planning() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 20,
            cols: 8,
            cells: vec![
                chart_text_cell(0, 0, "Quarter"),
                chart_text_cell(0, 1, "Revenue"),
                chart_text_cell(0, 2, "Profit"),
                chart_text_cell(1, 0, "Q1"),
                chart_number_cell(1, 1, 100.0),
                chart_number_cell(1, 2, 25.0),
                chart_text_cell(2, 0, "Q2"),
                chart_number_cell(2, 1, 125.0),
                chart_number_cell(2, 2, 35.0),
            ],
            charts: vec![imported_current_standard_chart2()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let chart = &exported.sheets[0].charts[0];

    for series in &chart.series {
        assert_eq!(series.value_cache, None);
        assert_eq!(series.category_cache, None);
        assert_eq!(series.bubble_size_cache, None);
    }
    let fingerprint = standard_chart_projection_fingerprint(chart);
    assert_eq!(
        chart
            .standard_chart_provenance
            .as_ref()
            .and_then(|provenance| provenance.projection_fingerprint.as_deref()),
        Some(fingerprint.as_str())
    );
    assert_eq!(
        chart
            .standard_chart_export_authority
            .as_ref()
            .and_then(|authority| authority.projection_fingerprint.as_deref()),
        Some(fingerprint.as_str())
    );
}

fn chart_text_cell(row: u32, col: u32, text: &str) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(text)),
        ..Default::default()
    }
}

fn chart_number_cell(row: u32, col: u32, number: f64) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Number(FiniteF64::must(number)),
        ..Default::default()
    }
}

fn bounded_source_range_chart() -> ChartSpec {
    serde_json::from_value(serde_json::json!({
        "chartType": "column",
        "title": "Bounded Source Range",
        "position": {
            "anchorRow": 1,
            "anchorCol": 4,
            "anchorRowOffset": 11,
            "anchorColOffset": 22,
            "endRow": 12,
            "endCol": 9,
            "endRowOffset": 33,
            "endColOffset": 44
        },
        "size": {
            "width": 480.0,
            "height": 320.0
        },
        "zIndex": 0,
        "dataRange": "Data!A1:C4",
        "seriesRange": "Data!B1:C1",
        "categoryRange": "Data!A2:A4",
        "series": [
            {
                "name": "Revenue",
                "nameRef": "Data!B1",
                "values": "Data!B2:B4",
                "categories": "Data!A2:A4"
            },
            {
                "name": "Profit",
                "nameRef": "Data!C1",
                "values": "Data!C2:C4",
                "categories": "Data!A2:A4"
            }
        ]
    }))
    .expect("valid bounded source range chart")
}

fn assert_same_sheet_ref(actual: Option<&str>, expected_unqualified: &str) {
    let actual = actual.expect("expected chart source reference");
    let unqualified = actual.strip_prefix("Data!").unwrap_or(actual);
    assert_eq!(unqualified, expected_unqualified);
}

fn assert_bounded_source_range_chart(chart: &ChartSpec) {
    assert_same_sheet_ref(chart.data_range.as_deref(), "A1:C4");
    assert_same_sheet_ref(chart.series_range.as_deref(), "B1:C1");
    assert_same_sheet_ref(chart.category_range.as_deref(), "A2:A4");
    assert_eq!(chart.position.anchor_row, 1);
    assert_eq!(chart.position.anchor_col, 4);
    assert_eq!(chart.position.anchor_row_offset, 11);
    assert_eq!(chart.position.anchor_col_offset, 22);
    assert_eq!(chart.position.end_row, Some(12));
    assert_eq!(chart.position.end_col, Some(9));
    assert_eq!(chart.position.end_row_offset, Some(33));
    assert_eq!(chart.position.end_col_offset, Some(44));
    assert_eq!(chart.series.len(), 2);
    assert_same_sheet_ref(chart.series[0].name_ref.as_deref(), "B1");
    assert_same_sheet_ref(chart.series[0].values.as_deref(), "B2:B4");
    assert_same_sheet_ref(chart.series[0].categories.as_deref(), "A2:A4");
    assert_same_sheet_ref(chart.series[1].name_ref.as_deref(), "C1");
    assert_same_sheet_ref(chart.series[1].values.as_deref(), "C2:C4");
    assert_same_sheet_ref(chart.series[1].categories.as_deref(), "A2:A4");
}

fn assert_reparsed_source_ranges(chart: &ChartSpec) {
    assert_eq!(chart.series.len(), 2);
    assert_same_sheet_ref(chart.series[0].name_ref.as_deref(), "B1");
    assert_same_sheet_ref(chart.series[0].values.as_deref(), "B2:B4");
    assert_same_sheet_ref(chart.series[0].categories.as_deref(), "A2:A4");
    assert_same_sheet_ref(chart.series[1].name_ref.as_deref(), "C1");
    assert_same_sheet_ref(chart.series[1].values.as_deref(), "C2:C4");
    assert_same_sheet_ref(chart.series[1].categories.as_deref(), "A2:A4");
    assert_eq!(chart.position.anchor_row, 1);
    assert_eq!(chart.position.anchor_col, 4);
    assert_eq!(chart.position.end_row, Some(12));
    assert_eq!(chart.position.end_col, Some(9));
}

#[test]
fn imported_bounded_chart_source_ranges_survive_yrs_and_xlsx_export() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Data".to_string(),
            rows: 16,
            cols: 10,
            cells: vec![
                chart_text_cell(0, 0, "Quarter"),
                chart_text_cell(0, 1, "Revenue"),
                chart_text_cell(0, 2, "Profit"),
                chart_text_cell(1, 0, "Q1"),
                chart_number_cell(1, 1, 100.0),
                chart_number_cell(1, 2, 25.0),
                chart_text_cell(2, 0, "Q2"),
                chart_number_cell(2, 1, 125.0),
                chart_number_cell(2, 2, 35.0),
                chart_text_cell(3, 0, "Q3"),
                chart_number_cell(3, 1, 140.0),
                chart_number_cell(3, 2, 44.0),
            ],
            charts: vec![bounded_source_range_chart()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported = engine.export_to_parse_output().unwrap().parse_output;
    let chart = exported.sheets[0]
        .charts
        .first()
        .expect("exported chart should exist");
    assert_bounded_source_range_chart(chart);

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let (reparsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&exported_bytes).expect("parse exported xlsx");
    let reparsed_chart = reparsed.sheets[0]
        .charts
        .first()
        .expect("reparsed chart should exist");
    assert_reparsed_source_ranges(reparsed_chart);
}

fn imported_current_standard_chart2() -> ChartSpec {
    let mut chart: ChartSpec = serde_json::from_value(serde_json::json!({
        "chartType": "column",
        "title": "Imported Revenue",
        "position": {
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffset": 0,
            "anchorColOffset": 0,
            "endRow": 15,
            "endCol": 8,
            "endRowOffset": 0,
            "endColOffset": 0
        },
        "size": {
            "width": 640.0,
            "height": 300.0
        },
        "zIndex": 0,
        "series": [
            {
                "nameRef": "Data!B1",
                "values": "Data!B2:B3",
                "categories": "Data!A2:A3"
            },
            {
                "nameRef": "Data!C1",
                "values": "Data!C2:C3",
                "categories": "Data!A2:A3"
            }
        ]
    }))
    .expect("valid chart spec");
    chart.chart_frame = Some(ChartDrawingFrameOoxmlProps {
        relationship_id: Some("rId2".to_string()),
        relationship_target: Some("../charts/chart2.xml".to_string()),
        ..Default::default()
    });
    chart.chart_relationships = vec![
        ChartRelationshipData {
            r_id: "rId1".to_string(),
            relationship_type: Some(xlsx_parser::infra::opc::REL_CHART_STYLE.to_string()),
            target: Some("style2.xml".to_string()),
            target_mode: None,
        },
        ChartRelationshipData {
            r_id: "rId2".to_string(),
            relationship_type: Some(xlsx_parser::infra::opc::REL_CHART_COLOR_STYLE.to_string()),
            target: Some("colors2.xml".to_string()),
            target_mode: None,
        },
    ];
    chart.chart_auxiliary_files = vec![
        (
            "xl/charts/style2.xml".to_string(),
            br#"<c:styleSheet xmlns:c="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>"#
                .to_vec(),
        ),
        (
            "xl/charts/colors2.xml".to_string(),
            br#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="cycle"><a:schemeClr val="accent1"/><cs:variation/></cs:colorStyle>"#
                .to_vec(),
        ),
    ];

    let fingerprint = standard_chart_projection_fingerprint(&chart);
    chart.standard_chart_provenance = Some(StandardChartProvenance {
        original_path: Some("xl/charts/chart2.xml".to_string()),
        original_xml: None,
        rels_path: Some("xl/charts/_rels/chart2.xml.rels".to_string()),
        projection_schema_version: STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
        projection_fingerprint: Some(fingerprint.clone()),
        source_fingerprint: None,
        relationships: chart.chart_relationships.clone(),
        auxiliary_paths: chart
            .chart_auxiliary_files
            .iter()
            .map(|(path, _)| path.clone())
            .collect(),
    });
    chart.standard_chart_export_authority = Some(StandardChartExportAuthority {
        schema_version: STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
        validity: StandardChartAuthorityValidity::Current,
        chart_part_revision: 0,
        package_owner: Some("xl/charts/chart2.xml".to_string()),
        relationship_closure_current: true,
        projection_fingerprint: Some(fingerprint),
        source_fingerprint: None,
        invalidated_owner_ids: Vec::new(),
        stale_reason: None,
    });

    chart
}

fn standard_chart_projection_fingerprint(chart_spec: &ChartSpec) -> String {
    let mut fingerprint = Fnv1a64::default();
    fingerprint.write_str(chart_spec.chart_type.as_str());
    fingerprint.write_json(&chart_spec.title);
    fingerprint.write_json(&chart_spec.series);
    fingerprint.write_json(&chart_spec.sub_type);
    fingerprint.write_json(&chart_spec.legend);
    fingerprint.write_json(&chart_spec.axes);
    fingerprint.write_json(&chart_spec.data_labels);
    fingerprint.write_json(&chart_spec.data_range);
    fingerprint.write_json(&chart_spec.series_range);
    fingerprint.write_json(&chart_spec.category_range);
    fingerprint.write_json(&chart_spec.colors);
    fingerprint.write_json(&chart_spec.style);
    fingerprint.write_json(&chart_spec.rounded_corners);
    fingerprint.write_json(&chart_spec.auto_title_deleted);
    fingerprint.write_json(&chart_spec.show_data_labels_over_max);
    fingerprint.write_json(&chart_spec.chart_format);
    fingerprint.write_json(&chart_spec.plot_format);
    fingerprint.write_json(&chart_spec.title_format);
    fingerprint.write_json(&chart_spec.title_rich_text);
    fingerprint.write_json(&chart_spec.title_formula);
    fingerprint.write_json(&chart_spec.plot_layout);
    fingerprint.write_json(&chart_spec.title_layout);
    fingerprint.write_json(&chart_spec.data_table);
    fingerprint.write_json(&chart_spec.drop_lines);
    fingerprint.write_json(&chart_spec.high_low_lines);
    fingerprint.write_json(&chart_spec.series_lines);
    fingerprint.write_json(&chart_spec.up_down_bars);
    fingerprint.write_json(&chart_spec.waterfall);
    fingerprint.write_json(&chart_spec.histogram);
    fingerprint.write_json(&chart_spec.boxplot);
    fingerprint.write_json(&chart_spec.hierarchy);
    fingerprint.write_json(&chart_spec.region_map);
    fingerprint.write_json(&chart_spec.display_blanks_as);
    fingerprint.write_json(&chart_spec.plot_visible_only);
    fingerprint.write_json(&chart_spec.gap_width);
    fingerprint.write_json(&chart_spec.gap_depth);
    fingerprint.write_json(&chart_spec.overlap);
    fingerprint.write_json(&chart_spec.doughnut_hole_size);
    fingerprint.write_json(&chart_spec.first_slice_angle);
    fingerprint.write_json(&chart_spec.bubble_scale);
    fingerprint.write_json(&chart_spec.show_neg_bubbles);
    fingerprint.write_json(&chart_spec.size_represents);
    fingerprint.write_json(&chart_spec.split_type);
    fingerprint.write_json(&chart_spec.split_value);
    fingerprint.write_json(&chart_spec.category_label_level);
    fingerprint.write_json(&chart_spec.series_name_level);
    fingerprint.write_json(&chart_spec.show_all_field_buttons);
    fingerprint.write_json(&chart_spec.second_plot_size);
    fingerprint.write_json(&chart_spec.vary_by_categories);
    fingerprint.write_json(&chart_spec.title_h_align);
    fingerprint.write_json(&chart_spec.title_v_align);
    fingerprint.write_json(&chart_spec.title_show_shadow);
    fingerprint.write_json(&chart_spec.pivot_options);
    fingerprint.write_json(&chart_spec.bar_shape);
    fingerprint.write_json(&chart_spec.bubble_3d_effect);
    fingerprint.write_json(&chart_spec.wireframe);
    fingerprint.write_json(&chart_spec.surface_top_view);
    fingerprint.write_json(&chart_spec.color_scheme);
    fingerprint.write_json(&chart_spec.chart_style_context);
    fingerprint.write_json(&chart_spec.view_3d);
    fingerprint.write_json(&chart_spec.floor_format);
    fingerprint.write_json(&chart_spec.side_wall_format);
    fingerprint.write_json(&chart_spec.back_wall_format);
    format!("{:016x}", fingerprint.finish())
}

#[derive(Clone, Copy)]
struct Fnv1a64(u64);

impl Default for Fnv1a64 {
    fn default() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl Fnv1a64 {
    fn write_json<T: serde::Serialize>(&mut self, value: &T) {
        match serde_json::to_vec(value) {
            Ok(bytes) => self.write_bytes(&bytes),
            Err(_) => self.write_bytes(b"<serde-error>"),
        }
        self.write_bytes(&[0xff]);
    }

    fn write_str(&mut self, value: &str) {
        self.write_bytes(value.as_bytes());
        self.write_bytes(&[0xff]);
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }

    fn finish(self) -> u64 {
        self.0
    }
}
