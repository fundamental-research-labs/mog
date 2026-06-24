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
use value_types::{CellValue, FiniteF64};

const STANDARD_CHART_PROJECTION_SCHEMA_VERSION: u32 = 6;

#[test]
fn sdk_authored_chart_palette_exports_chart_color_style_part() {
    let cases = [
        (
            serde_json::json!({ "colors": ["#4472C4"] }),
            r#"id="0""#,
            Some(r#"<a:srgbClr val="4472C4"/>"#),
        ),
        (serde_json::json!({ "colorScheme": 1 }), r#"id="1""#, None),
        (
            serde_json::json!({ "colors": ["#4472C4"], "colorScheme": 1 }),
            r#"id="1""#,
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
    expected_scheme: &str,
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
    assert!(color_style.contains(expected_scheme));
    if let Some(expected_color) = expected_color {
        assert!(color_style.contains(expected_color));
    }
}

#[test]
fn imported_standard_chart_metadata_survives_yrs_without_auxiliary_package_replay() {
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

    assert!(archive.contains("xl/charts/chart1.xml"));
    assert!(!archive.contains("xl/charts/chart2.xml"));
    assert!(!archive.contains("xl/charts/_rels/chart2.xml.rels"));
    assert!(!archive.contains("xl/charts/style2.xml"));
    assert!(!archive.contains("xl/charts/colors2.xml"));
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
            br#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle"/>"#
                .to_vec(),
        ),
    ];

    let fingerprint = standard_chart_projection_fingerprint(&chart);
    chart.standard_chart_provenance = Some(StandardChartProvenance {
        original_path: Some("xl/charts/chart2.xml".to_string()),
        rels_path: Some("xl/charts/_rels/chart2.xml.rels".to_string()),
        projection_schema_version: STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
        projection_fingerprint: Some(fingerprint.clone()),
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
