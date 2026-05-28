use compute_core::storage::engine::YrsComputeEngine;
use domain_types::{
    ParseOutput, SheetData, SheetPaneConfig, SheetPaneId, SheetPaneState, SheetView,
};
use xlsx_parser::write::write_xlsx_from_parse_output;

fn sheet_xml_after_hydrate_export(output: &ParseOutput) -> String {
    let input = write_xlsx_from_parse_output(output).expect("write input xlsx");
    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&input).expect("hydrate xlsx");
    let exported = engine.export_to_xlsx_bytes().expect("export hydrated xlsx");
    let archive = xlsx_parser::XlsxArchive::new(&exported).expect("exported archive");
    String::from_utf8(
        archive
            .read_file("xl/worksheets/sheet1.xml")
            .expect("sheet xml"),
    )
    .expect("utf8 sheet xml")
}

#[test]
fn split_pane_survives_yrs_hydration_export() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            view: SheetView {
                pane: Some(SheetPaneConfig {
                    state: SheetPaneState::Split,
                    x_split: 1111.5,
                    y_split: 2222.25,
                    top_left_cell: Some("D8".to_string()),
                    active_pane: Some(SheetPaneId::BottomRight),
                }),
                ..Default::default()
            },
            ..Default::default()
        }],
        ..Default::default()
    };

    let sheet_xml = sheet_xml_after_hydrate_export(&output);
    assert!(sheet_xml.contains(r#"state="split""#));
    assert!(sheet_xml.contains(r#"xSplit="1111.5""#));
    assert!(sheet_xml.contains(r#"ySplit="2222.25""#));
    assert!(!sheet_xml.contains(r#"state="frozen""#));
}

#[test]
fn frozen_split_preserves_active_pane_top_left_cell_and_selections() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            view: SheetView {
                pane: Some(SheetPaneConfig {
                    state: SheetPaneState::FrozenSplit,
                    x_split: 2.0,
                    y_split: 3.0,
                    top_left_cell: Some("E9".to_string()),
                    active_pane: Some(SheetPaneId::BottomRight),
                }),
                selections: vec![ooxml_types::worksheet::Selection {
                    pane: Some(ooxml_types::worksheet::Pane::BottomRight),
                    active_cell: Some("E9".to_string()),
                    active_cell_id: Some(0),
                    sqref: Some("E9:F10".to_string()),
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        ..Default::default()
    };

    let sheet_xml = sheet_xml_after_hydrate_export(&output);
    assert!(sheet_xml.contains(r#"state="frozenSplit""#));
    assert!(sheet_xml.contains(r#"topLeftCell="E9""#));
    assert!(sheet_xml.contains(r#"activePane="bottomRight""#));
    assert!(sheet_xml.contains(r#"activeCell="E9""#));
    assert!(sheet_xml.contains(r#"sqref="E9:F10""#));
}

#[test]
fn extra_sheet_views_survive_yrs_hydration_export() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Sheet1".to_string(),
            extra_sheet_views: vec![SheetView {
                workbook_view_id: 1,
                view: Some("pageBreakPreview".to_string()),
                pane: Some(SheetPaneConfig {
                    state: SheetPaneState::Split,
                    x_split: 500.0,
                    y_split: 0.0,
                    top_left_cell: None,
                    active_pane: Some(SheetPaneId::TopRight),
                }),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };

    let sheet_xml = sheet_xml_after_hydrate_export(&output);
    assert_eq!(sheet_xml.matches("<sheetView").count(), 3);
    assert!(sheet_xml.contains(r#"workbookViewId="1""#));
    assert!(sheet_xml.contains(r#"view="pageBreakPreview""#));
    assert!(sheet_xml.contains(r#"activePane="topRight""#));
}
