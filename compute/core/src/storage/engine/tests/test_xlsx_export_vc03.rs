//! VC-03 XLSX export evidence for version-control coverage-matrix rows.

use super::helpers::engine_from_parse_output_normal;
use domain_types::{
    AuthoredStyleRun, CellFormat, ColDimension, DocumentFormat, ParseOutput, RowDimension,
    SheetData, SheetDimensions,
    domain::workbook::{
        CalcMode as WorkbookCalcMode, RefMode, UpdateLinks, WorkbookProperties, WorkbookView,
        WorkbookViewVisibility,
    },
};
use std::sync::Arc;
use value_types::{CellError, CellValue, FiniteF64};

fn parsed_cell(sheet: &SheetData, row: u32, col: u32) -> &domain_types::CellData {
    sheet
        .cells
        .iter()
        .find(|cell| cell.row == row && cell.col == col)
        .unwrap_or_else(|| panic!("expected cell at row {row}, col {col}"))
}

fn parsed_row_dimension(sheet: &SheetData, row: u32) -> &RowDimension {
    sheet
        .dimensions
        .row_heights
        .iter()
        .find(|dimension| dimension.row == row)
        .unwrap_or_else(|| panic!("expected row dimension for row {row}"))
}

fn parsed_col_dimension(sheet: &SheetData, col: u32) -> &ColDimension {
    sheet
        .dimensions
        .col_widths
        .iter()
        .find(|dimension| dimension.col == col)
        .unwrap_or_else(|| panic!("expected column dimension for col {col}"))
}

fn assert_close(actual: f64, expected: f64, label: &str) {
    assert!(
        (actual - expected).abs() < 0.001,
        "{label}: expected {expected}, got {actual}"
    );
}

fn assert_number_cell(sheet: &SheetData, row: u32, col: u32, expected: f64) {
    match &parsed_cell(sheet, row, col).value {
        CellValue::Number(value) => assert_close(value.get(), expected, "cell number"),
        other => panic!("expected number at row {row}, col {col}, got {other:?}"),
    }
}

#[test]
fn vc03_xlsx_export_reparse_preserves_authored_cells_sheets_dimensions_and_workbook_metadata() {
    let input = ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat::from(&CellFormat {
                background_color: Some("#FFEE00".to_string()),
                ..Default::default()
            }),
        ],
        sheets: vec![
            SheetData {
                name: "Values".to_string(),
                rows: 12,
                cols: 8,
                sheet_id: Some(101),
                visibility: domain_types::SheetState::Visible,
                cells: vec![
                    domain_types::CellData {
                        row: 0,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(42.5)),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 0,
                        col: 1,
                        value: CellValue::Text(Arc::from("literal text")),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 0,
                        col: 2,
                        value: CellValue::Boolean(true),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 0,
                        col: 3,
                        value: CellValue::Error(CellError::Div0, None),
                        ..Default::default()
                    },
                    domain_types::CellData {
                        row: 1,
                        col: 0,
                        value: CellValue::Number(FiniteF64::must(52.5)),
                        formula: Some("A1+10".to_string()),
                        ..Default::default()
                    },
                ],
                authored_style_runs: vec![AuthoredStyleRun {
                    start_row: 5,
                    start_col: 0,
                    end_row: 5,
                    end_col: 1,
                    style_id: 1,
                }],
                dimensions: SheetDimensions {
                    default_row_height: Some(18.0),
                    default_col_width: Some(13.0),
                    row_heights: vec![
                        RowDimension {
                            row: 1,
                            height: 24.0,
                            custom_height: true,
                            ..Default::default()
                        },
                        RowDimension {
                            row: 3,
                            height: 18.0,
                            hidden: true,
                            explicit_hidden: true,
                            ..Default::default()
                        },
                    ],
                    col_widths: vec![
                        ColDimension {
                            col: 1,
                            width: 22.0,
                            width_present: Some(true),
                            custom_width: true,
                            custom_width_attr: Some(true),
                            ..Default::default()
                        },
                        ColDimension {
                            col: 3,
                            width: 9.5,
                            width_present: Some(true),
                            custom_width: true,
                            custom_width_attr: Some(true),
                            hidden: true,
                            hidden_attr: Some(true),
                            ..Default::default()
                        },
                    ],
                    ..Default::default()
                },
                sheet_properties: Some(ooxml_types::worksheet::SheetProperties {
                    tab_color: Some(ooxml_types::styles::ColorDef::Rgb {
                        val: "FF4472C4".to_string(),
                        tint: None,
                    }),
                    ..Default::default()
                }),
                ..Default::default()
            },
            SheetData {
                name: "Hidden".to_string(),
                rows: 1,
                cols: 1,
                sheet_id: Some(205),
                visibility: domain_types::SheetState::Hidden,
                cells: vec![domain_types::CellData {
                    row: 0,
                    col: 0,
                    value: CellValue::Text(Arc::from("hidden sheet value")),
                    ..Default::default()
                }],
                ..Default::default()
            },
            SheetData {
                name: "Very Hidden".to_string(),
                rows: 1,
                cols: 1,
                sheet_id: Some(309),
                visibility: domain_types::SheetState::VeryHidden,
                ..Default::default()
            },
        ],
        properties: Some(domain_types::DocumentProperties {
            title: Some("VC-03 Export Evidence".to_string()),
            creator: Some("Mog".to_string()),
            language: Some("de-DE".to_string()),
            created: Some("2026-06-21T12:34:56Z".to_string()),
            modified: Some("2026-06-21T12:45:00Z".to_string()),
            last_modified_by: Some("VC03".to_string()),
            ..Default::default()
        }),
        workbook_properties: Some(WorkbookProperties {
            date1904: true,
            update_links: UpdateLinks::Never,
            code_name: Some("VC03Book".to_string()),
            default_theme_version: Some(166925),
            ..Default::default()
        }),
        calculation: domain_types::domain::workbook::CalculationProperties {
            iterate: true,
            iterate_count: 37,
            iterate_delta: 0.00001,
            calc_mode: WorkbookCalcMode::Manual,
            full_calc_on_load: true,
            ref_mode: RefMode::R1C1,
            full_precision: false,
            calc_completed: false,
            calc_on_save: false,
            concurrent_calc: false,
            concurrent_manual_count: Some(4),
            calc_id: Some(191029),
            force_full_calc: true,
            has_explicit_iterate_count: true,
            has_explicit_iterate_delta: true,
        },
        workbook_views: vec![WorkbookView {
            active_tab: 1,
            first_sheet: 0,
            visibility: WorkbookViewVisibility::Visible,
            minimized: false,
            show_horizontal_scroll: false,
            show_vertical_scroll: true,
            show_sheet_tabs: true,
            auto_filter_date_grouping: false,
            x_window: Some(12),
            y_window: Some(24),
            window_width: Some(14400),
            window_height: Some(9000),
            tab_ratio: Some(650.0),
            uid: None,
            ext_lst_raw: None,
        }],
        ..Default::default()
    };

    let engine = engine_from_parse_output_normal(&input);
    let exported_bytes = engine.export_to_xlsx_bytes().expect("export xlsx bytes");
    let reparsed = xlsx_api::parse(&exported_bytes)
        .expect("exported VC-03 evidence workbook should parse")
        .output;

    assert_eq!(reparsed.sheets.len(), 3);
    assert_eq!(
        reparsed
            .sheets
            .iter()
            .map(|sheet| (sheet.sheet_id, sheet.name.as_str(), sheet.visibility))
            .collect::<Vec<_>>(),
        vec![
            (Some(101), "Values", domain_types::SheetState::Visible),
            (Some(205), "Hidden", domain_types::SheetState::Hidden),
            (
                Some(309),
                "Very Hidden",
                domain_types::SheetState::VeryHidden
            ),
        ]
    );

    let values_sheet = &reparsed.sheets[0];
    let tab_color = values_sheet
        .sheet_properties
        .as_ref()
        .and_then(|properties| properties.tab_color.as_ref())
        .expect("visible sheet tab color should round-trip");
    assert_eq!(
        tab_color,
        &ooxml_types::styles::ColorDef::Rgb {
            val: "FF4472C4".to_string(),
            tint: None,
        }
    );

    assert_number_cell(values_sheet, 0, 0, 42.5);
    match &parsed_cell(values_sheet, 0, 1).value {
        CellValue::Text(text) => assert_eq!(&**text, "literal text"),
        other => panic!("expected text literal, got {other:?}"),
    }
    assert_eq!(
        parsed_cell(values_sheet, 0, 2).value,
        CellValue::Boolean(true)
    );
    assert_eq!(
        parsed_cell(values_sheet, 0, 3).value,
        CellValue::Error(CellError::Div0, None)
    );
    let formula = parsed_cell(values_sheet, 1, 0);
    assert_eq!(formula.formula.as_deref(), Some("A1+10"));
    assert_number_cell(values_sheet, 1, 0, 52.5);

    assert!(
        values_sheet
            .authored_style_runs
            .iter()
            .any(|run| run.start_row <= 5
                && run.end_row >= 5
                && run.start_col <= 0
                && run.end_col >= 1),
        "authored styled blank range should export/reparse without becoming value cells"
    );
    assert!(
        values_sheet
            .cells
            .iter()
            .all(|cell| !((cell.row, cell.col) == (5, 0) && matches!(cell.value, CellValue::Null))),
        "style-only authored blanks should not be reparsed as literal null cells"
    );

    assert_close(
        values_sheet.dimensions.default_row_height.unwrap(),
        18.0,
        "default row height",
    );
    assert_close(
        values_sheet.dimensions.default_col_width.unwrap(),
        13.0,
        "default column width",
    );
    let custom_row = parsed_row_dimension(values_sheet, 1);
    assert_close(custom_row.height, 24.0, "custom row height");
    assert!(custom_row.custom_height);
    assert!(parsed_row_dimension(values_sheet, 3).hidden);
    assert_eq!(
        values_sheet
            .dimensions
            .row_heights
            .iter()
            .map(|dimension| dimension.row)
            .collect::<Vec<_>>(),
        vec![1, 3]
    );

    let custom_col = parsed_col_dimension(values_sheet, 1);
    assert_close(custom_col.width, 22.0, "custom column width");
    assert!(custom_col.custom_width);
    let hidden_col = parsed_col_dimension(values_sheet, 3);
    assert!(hidden_col.hidden);
    assert_close(hidden_col.width, 9.5, "hidden column width");
    assert_eq!(
        values_sheet
            .dimensions
            .col_widths
            .iter()
            .map(|dimension| dimension.col)
            .collect::<Vec<_>>(),
        vec![1, 3]
    );

    let props = reparsed
        .properties
        .as_ref()
        .expect("document properties should round-trip");
    assert_eq!(props.title.as_deref(), Some("VC-03 Export Evidence"));
    assert_eq!(props.creator.as_deref(), Some("Mog"));
    assert_eq!(props.language.as_deref(), Some("de-DE"));
    assert_eq!(props.created.as_deref(), Some("2026-06-21T12:34:56Z"));
    assert_eq!(props.modified.as_deref(), Some("2026-06-21T12:45:00Z"));
    assert_eq!(props.last_modified_by.as_deref(), Some("VC03"));

    let workbook_properties = reparsed
        .workbook_properties
        .as_ref()
        .expect("workbook properties should round-trip");
    assert!(workbook_properties.date1904);
    assert_eq!(workbook_properties.update_links, UpdateLinks::Never);
    assert_eq!(workbook_properties.code_name.as_deref(), Some("VC03Book"));
    assert_eq!(workbook_properties.default_theme_version, Some(166925));

    assert!(reparsed.calculation.iterate);
    assert_eq!(reparsed.calculation.iterate_count, 37);
    assert_close(reparsed.calculation.iterate_delta, 0.00001, "iterate delta");
    assert_eq!(reparsed.calculation.calc_mode, WorkbookCalcMode::Manual);
    assert_eq!(reparsed.calculation.ref_mode, RefMode::R1C1);
    assert!(reparsed.calculation.full_calc_on_load);
    assert!(!reparsed.calculation.full_precision);
    assert!(!reparsed.calculation.calc_completed);
    assert!(!reparsed.calculation.calc_on_save);
    assert!(!reparsed.calculation.concurrent_calc);
    assert_eq!(reparsed.calculation.concurrent_manual_count, Some(4));
    assert!(reparsed.calculation.force_full_calc);
    assert_eq!(reparsed.calculation.calc_id, Some(0));
    assert!(reparsed.calculation.has_explicit_iterate_count);
    assert!(reparsed.calculation.has_explicit_iterate_delta);

    assert_eq!(reparsed.workbook_views.len(), 1);
    let workbook_view = &reparsed.workbook_views[0];
    assert_eq!(workbook_view.active_tab, 1);
    assert_eq!(workbook_view.first_sheet, 0);
    assert!(!workbook_view.show_horizontal_scroll);
    assert!(workbook_view.show_vertical_scroll);
    assert!(workbook_view.show_sheet_tabs);
    assert!(!workbook_view.auto_filter_date_grouping);
    assert_eq!(workbook_view.x_window, Some(12));
    assert_eq!(workbook_view.y_window, Some(24));
    assert_eq!(workbook_view.window_width, Some(14400));
    assert_eq!(workbook_view.window_height, Some(9000));
    assert_eq!(workbook_view.tab_ratio, Some(650.0));
}
