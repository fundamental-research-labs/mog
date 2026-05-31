use super::*;
use domain_types::{
    AxisBound, AxisBoundLabel, EmptyCellDisplay, Sparkline, SparklineAxisSettings,
    SparklineCellAddress, SparklineDataRange, SparklineGroup, SparklineType,
    SparklineVisualSettings,
};

#[test]
fn sparkline_groups_are_authoritative_ext_lst_source_without_relationships() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet 1".to_string(),
            cells: vec![
                make_cell(0, 0, DomainValue::Number(FiniteF64::new(1.0).unwrap())),
                make_cell(0, 1, DomainValue::Number(FiniteF64::new(2.0).unwrap())),
                make_cell(0, 2, DomainValue::Number(FiniteF64::new(3.0).unwrap())),
            ],
            sparklines: vec![
                Sparkline {
                    id: "spark-a".to_string(),
                    sheet_id: "sheet-1".to_string(),
                    cell: SparklineCellAddress {
                        sheet_id: "sheet-1".to_string(),
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
                    data_in_rows: true,
                    group_id: Some("group-1".to_string()),
                    visual: SparklineVisualSettings {
                        color: "#FF0000".to_string(),
                        ..Default::default()
                    },
                    axis: SparklineAxisSettings::default(),
                    created_at: None,
                    updated_at: None,
                },
                Sparkline {
                    id: "spark-b".to_string(),
                    sheet_id: "sheet-1".to_string(),
                    cell: SparklineCellAddress {
                        sheet_id: "sheet-1".to_string(),
                        row: 2,
                        col: 0,
                    },
                    data_range: SparklineDataRange {
                        start_row: 0,
                        start_col: 0,
                        end_row: 0,
                        end_col: 2,
                    },
                    sparkline_type: SparklineType::Line,
                    data_in_rows: true,
                    group_id: Some("group-1".to_string()),
                    visual: SparklineVisualSettings {
                        color: "#FF0000".to_string(),
                        ..Default::default()
                    },
                    axis: SparklineAxisSettings::default(),
                    created_at: None,
                    updated_at: None,
                },
            ],
            sparkline_groups: vec![SparklineGroup {
                id: "group-1".to_string(),
                sheet_id: "sheet-1".to_string(),
                sparkline_ids: vec!["spark-a".to_string(), "spark-b".to_string()],
                sparkline_type: SparklineType::Column,
                visual: SparklineVisualSettings {
                    color: "#123456".to_string(),
                    negative_color: Some("#654321".to_string()),
                    show_markers: Some(true),
                    high_point_color: Some("#00B050".to_string()),
                    line_weight: Some(0.75),
                    ..Default::default()
                },
                axis: SparklineAxisSettings {
                    min_value: AxisBound::Label(AxisBoundLabel::Same),
                    max_value: AxisBound::Value(10.0),
                    show_axis: Some(true),
                    axis_color: Some("#445566".to_string()),
                    display_empty_cells: EmptyCellDisplay::Zero,
                    right_to_left: Some(true),
                },
                created_at: None,
                updated_at: None,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = crate::XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains("<extLst>"));
    assert!(sheet_xml.contains("<x14:sparklineGroups"));
    assert!(sheet_xml.contains(
        r#"<x14:sparklineGroup type="column" displayEmptyCellsAs="zero" lineWeight="0.75" markers="1" high="1" negative="1" displayXAxis="1" rightToLeft="1" minAxisType="group" maxAxisType="custom" manualMax="10">"#
    ));
    assert!(sheet_xml.contains(r#"<x14:colorSeries rgb="FF123456"/>"#));
    assert!(sheet_xml.contains(r#"<x14:colorAxis rgb="FF445566"/>"#));
    assert!(sheet_xml.contains("<xm:f>&apos;Sheet 1&apos;!A1:C1</xm:f>"));
    assert!(sheet_xml.contains("<xm:sqref>A2</xm:sqref>"));
    assert!(sheet_xml.contains("<xm:sqref>A3</xm:sqref>"));
    assert!(
        archive
            .read_file("xl/worksheets/_rels/sheet1.xml.rels")
            .is_err()
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}
