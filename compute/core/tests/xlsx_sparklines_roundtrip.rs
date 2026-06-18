use compute_core::storage::engine::YrsComputeEngine;
use domain_types::{
    CellData, EmptyCellDisplay, ParseOutput, SheetData, SheetDimensions, Sparkline,
    SparklineAxisSettings, SparklineCellAddress, SparklineDataRange, SparklineGroup, SparklineType,
    SparklineVisualSettings,
};
use snapshot_types::WorkbookSnapshot;
use value_types::{CellValue, FiniteF64};

#[test]
fn deferred_xlsx_import_preserves_sparkline_theme_colors() {
    let xlsx = xlsx_parser::write::write_xlsx_from_parse_output(&sparkline_theme_parse_output())
        .expect("sparkline parse output should write");

    let (mut engine, _) =
        YrsComputeEngine::from_snapshot(WorkbookSnapshot::default()).expect("blank engine");
    engine
        .import_from_xlsx_bytes_deferred(&xlsx)
        .expect("deferred XLSX import should accept theme sparkline colors");
    engine
        .complete_deferred_hydration()
        .expect("deferred hydration should complete");

    let exported = engine
        .export_to_xlsx_bytes()
        .expect("sparkline workbook should export");
    let archive = xlsx_parser::XlsxArchive::new(&exported).expect("exported XLSX should open");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<x14:colorSeries theme="4" tint="-0.499984740745262"/>"#));
    assert!(sheet_xml.contains(r#"<x14:colorFirst theme="4" tint="0.3999755851924192"/>"#));
    assert!(sheet_xml.contains(r#"<x14:colorAxis theme="5"/>"#));
}

fn sparkline_theme_parse_output() -> ParseOutput {
    let sparkline = Sparkline {
        id: "sparkline-1".to_string(),
        sheet_id: "Sheet1".to_string(),
        cell: SparklineCellAddress {
            sheet_id: "Sheet1".to_string(),
            row: 1,
            col: 0,
        },
        data_range: SparklineDataRange {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 2,
        },
        sparkline_type: SparklineType::Line,
        data_in_rows: false,
        group_id: Some("group-1".to_string()),
        visual: SparklineVisualSettings::default(),
        axis: SparklineAxisSettings::default(),
        created_at: None,
        updated_at: None,
    };

    ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            rows: 3,
            cols: 3,
            cells: vec![
                number_cell(0, 0, 1.0),
                number_cell(0, 1, 2.0),
                number_cell(0, 2, 3.0),
            ],
            dimensions: SheetDimensions::default(),
            sparklines: vec![sparkline],
            sparkline_groups: vec![SparklineGroup {
                id: "group-1".to_string(),
                sheet_id: "Sheet1".to_string(),
                sparkline_ids: vec!["sparkline-1".to_string()],
                sparkline_type: SparklineType::Line,
                visual: SparklineVisualSettings {
                    color: "theme:4:-0.499984740745262".to_string(),
                    first_point_color: Some("theme:accent1:0.3999755851924192".to_string()),
                    ..Default::default()
                },
                axis: SparklineAxisSettings {
                    axis_color: Some("theme:5".to_string()),
                    display_empty_cells: EmptyCellDisplay::Gaps,
                    ..Default::default()
                },
                created_at: None,
                updated_at: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn number_cell(row: u32, col: u32, value: f64) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Number(FiniteF64::must(value)),
        ..Default::default()
    }
}
