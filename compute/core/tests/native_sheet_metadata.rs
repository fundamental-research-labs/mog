//! Worksheet metadata survives native edits, copying, and the XLSX boundary.

use cell_types::SheetId;
use compute_core::storage::engine::ComputeEngine;
use domain_types::{
    ParseOutput, SheetData, SheetPaneConfig, SheetPaneId, SheetPaneState, SheetState,
    domain::print::{PageBreakEntry, PageBreaks, PrintSettings},
    domain::protection::SheetProtection,
    domain::sheet::{PrintRange, PrintTitles},
};

fn sheet_id(hex: &str) -> SheetId {
    SheetId::from_raw(u128::from_str_radix(hex, 16).unwrap())
}

fn fixture() -> ParseOutput {
    let mut sheet = SheetData {
        name: "Metadata".into(),
        rows: 12,
        cols: 8,
        sheet_id: Some(7),
        visibility: SheetState::VeryHidden,
        protection: Some(SheetProtection {
            is_protected: true,
            password_hash: Some("CC2A".into()),
            hash_value: Some("aGFzaA==".into()),
            algorithm_name: Some("SHA-512".into()),
            salt_value: Some("c2FsdA==".into()),
            spin_count: Some(100_000),
            format_cells: true,
            insert_rows: true,
            auto_filter: true,
            ..Default::default()
        }),
        print_settings: Some(PrintSettings {
            orientation: Some("landscape".into()),
            paper_size: Some(9),
            scale: Some(75),
            fit_to_width: Some(2),
            fit_to_height: Some(3),
            h_centered: true,
            gridlines: true,
            ..Default::default()
        }),
        page_breaks: Some(PageBreaks {
            row_breaks: vec![PageBreakEntry {
                id: 8,
                min: 1,
                max: 5,
                manual: true,
                pt: true,
            }],
            col_breaks: vec![PageBreakEntry {
                id: 4,
                min: 2,
                max: 10,
                manual: false,
                pt: false,
            }],
        }),
        ..Default::default()
    };
    sheet.dimensions.default_row_height = Some(19.5);
    sheet.dimensions.default_col_width = Some(11.75);
    sheet.dimensions.default_row_descent = Some(0.3);
    sheet.dimensions.base_col_width = Some(9);
    sheet.dimensions.custom_height = true;
    sheet.dimensions.thick_top = true;
    sheet.sheet_properties = Some(ooxml_types::worksheet::SheetProperties {
        code_name: Some("MetadataSheet".into()),
        tab_color: Some(ooxml_types::styles::ColorDef::rgb("FF336699")),
        ..Default::default()
    });
    sheet.view.show_gridlines = false;
    sheet.view.show_row_col_headers = false;
    sheet.view.right_to_left = true;
    sheet.view.zoom_scale = Some(125);
    sheet.view.zoom_scale_normal = Some(110);
    sheet.view.zoom_scale_page_layout_view = Some(80);
    sheet.view.view = Some("pageLayout".into());
    sheet.view.pane = Some(SheetPaneConfig {
        state: SheetPaneState::Frozen,
        x_split: 2.0,
        y_split: 3.0,
        top_left_cell: Some("C4".into()),
        active_pane: Some(SheetPaneId::BottomRight),
    });
    sheet.view.active_cell = Some("D5".into());
    sheet.view.sqref = Some("D5:E6".into());
    sheet.view.scroll_row = 3;
    sheet.view.scroll_col = 2;
    sheet.view.show_ruler = false;
    sheet.view.show_white_space = false;
    sheet.view.window_protection = true;
    ParseOutput {
        workbook_views: vec![domain_types::domain::workbook::WorkbookView {
            active_tab: 1,
            ..Default::default()
        }],
        sheets: vec![
            sheet,
            SheetData {
                name: "Visible".into(),
                rows: 2,
                cols: 2,
                ..Default::default()
            },
        ],
        ..Default::default()
    }
}

fn import_fixture() -> (ComputeEngine, ParseOutput) {
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&fixture()).unwrap();
    let parsed = xlsx_api::parse(&bytes).unwrap().output;
    (ComputeEngine::from_xlsx_bytes(&bytes).unwrap().0, parsed)
}

#[test]
fn imported_sheet_metadata_survives_unrelated_settings_edits() {
    let (mut engine, source) = import_fixture();
    let id = sheet_id(&engine.get_all_sheet_ids()[0]);
    engine
        .set_sheet_setting(&id, "showFormulas", "true")
        .unwrap();
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let exported = xlsx_api::parse(&bytes).unwrap().output;
    let actual = &exported.sheets[0];
    let expected = &source.sheets[0];
    assert_eq!(actual.protection, expected.protection);
    assert_eq!(actual.print_settings, expected.print_settings);
    assert_eq!(actual.page_breaks, expected.page_breaks);
    assert_eq!(actual.sheet_properties, expected.sheet_properties);
    assert_eq!(actual.visibility, expected.visibility);
    assert_eq!(
        actual.dimensions.default_row_height,
        expected.dimensions.default_row_height
    );
    assert_eq!(
        actual.dimensions.default_col_width,
        expected.dimensions.default_col_width
    );
    assert_eq!(
        actual.dimensions.default_row_descent,
        expected.dimensions.default_row_descent
    );
    let mut expected_view = expected.view.clone();
    expected_view.show_formulas = true;
    assert_eq!(actual.view, expected_view);
    assert_eq!(engine.get_tab_color_query(&id).as_deref(), Some("#336699"));
}

#[test]
fn copy_clones_metadata_and_mutations_and_deletion_stay_independent() {
    let (mut engine, _) = import_fixture();
    let source_id = sheet_id(&engine.get_all_sheet_ids()[0]);
    let area = PrintRange {
        start_row: 1,
        start_col: 2,
        end_row: 8,
        end_col: 6,
    };
    let titles = PrintTitles {
        repeat_rows: Some((0, 2)),
        repeat_cols: Some((0, 1)),
    };
    engine
        .set_print_area(&source_id, Some(area.clone()))
        .unwrap();
    engine.set_print_titles(&source_id, titles.clone()).unwrap();
    let source_settings = engine.get_sheet_settings(&source_id);
    let source_print = engine.get_print_settings(&source_id);
    let (copy_hex, _) = engine.copy_sheet(&source_id, "Copy").unwrap();
    let copy_id = sheet_id(&copy_hex);
    assert_eq!(engine.get_sheet_settings(&copy_id), source_settings);
    assert_eq!(engine.get_print_settings(&copy_id), source_print);
    assert_eq!(engine.get_print_area(&copy_id), Some(area.clone()));
    assert_eq!(engine.get_print_titles(&copy_id), titles);
    assert_eq!(engine.get_sheet_visibility(&copy_id).unwrap(), "visible");
    assert_eq!(engine.get_frozen_panes_query(&copy_id).rows, 3);

    engine.set_frozen_panes(&source_id, 0, 0).unwrap();
    engine
        .set_sheet_setting(&source_id, "showGridlines", "true")
        .unwrap();
    engine.set_print_area(&source_id, None).unwrap();
    assert!(!engine.get_sheet_settings(&copy_id).show_gridlines);
    assert_eq!(engine.get_frozen_panes_query(&copy_id).rows, 3);
    assert_eq!(engine.get_print_area(&copy_id), Some(area));
    engine.delete_sheet(&source_id).unwrap();
    assert!(engine.get_sheet_meta(&source_id).is_none());
    assert_eq!(engine.get_sheet_name(&copy_id).as_deref(), Some("Copy"));

    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let reloaded = ComputeEngine::from_xlsx_bytes(&bytes).unwrap().0;
    let restored = sheet_id(&reloaded.get_all_sheet_ids()[0]);
    assert_eq!(reloaded.get_sheet_name(&restored).as_deref(), Some("Copy"));
    assert_eq!(reloaded.get_print_titles(&restored), titles);
    assert_eq!(reloaded.get_print_settings(&restored), source_print);
}

#[test]
fn resized_axes_are_available_to_cross_sheet_formulas_immediately() {
    let source = ParseOutput {
        sheets: ["Data", "Report"]
            .into_iter()
            .map(|name| SheetData {
                name: name.into(),
                rows: 1,
                cols: 1,
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&source).unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let ids = engine.get_all_sheet_ids();
    let data = sheet_id(&ids[0]);
    let report = sheet_id(&ids[1]);
    engine.set_row_height(&data, 40, 28.0).unwrap();
    engine.set_col_width(&data, 30, 110.0).unwrap();
    assert!(engine.mirror().row_id_lookup(&data, 40).is_some());
    assert!(engine.mirror().col_id_lookup(&data, 30).is_some());
    engine
        .set_cell_value_parsed(&report, 0, 0, "=Data!AE41")
        .unwrap();
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&report, cell_types::SheetPos::new(0, 0)),
        Some(&value_types::CellValue::Number(
            value_types::FiniteF64::ZERO
        ))
    );
    engine.set_cell_value_parsed(&data, 40, 30, "9").unwrap();
    assert_eq!(
        engine
            .mirror()
            .get_cell_value_at(&report, cell_types::SheetPos::new(0, 0)),
        Some(&value_types::CellValue::Number(
            value_types::FiniteF64::must(9.0)
        ))
    );
}

#[test]
fn copied_native_axis_and_range_formats_survive_independent_edits_and_xlsx() {
    use domain_types::{
        AuthoredStyleRun, CellFormat, ColStyleRange, DocumentFormat, RowStyleEntry,
    };
    let input = ParseOutput {
        style_palette: vec![
            DocumentFormat::default(),
            DocumentFormat::from(&CellFormat {
                number_format: Some("0.00".into()),
                ..Default::default()
            }),
            DocumentFormat::from(&CellFormat {
                italic: Some(true),
                ..Default::default()
            }),
        ],
        sheets: vec![SheetData {
            name: "Formats".into(),
            rows: 8,
            cols: 6,
            row_styles: vec![RowStyleEntry {
                row: 3,
                style_id: 1,
            }],
            col_style_ranges: vec![ColStyleRange {
                start_col: 2,
                end_col: 3,
                style_id: 2,
            }],
            authored_style_runs: vec![AuthoredStyleRun {
                start_row: 4,
                start_col: 0,
                end_row: 4,
                end_col: 1,
                style_id: 1,
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let source = sheet_id(&engine.get_all_sheet_ids()[0]);
    let (copy_hex, _) = engine.copy_sheet(&source, "Copy").unwrap();
    let copy = sheet_id(&copy_hex);
    assert_eq!(
        engine
            .get_resolved_format(&copy, 3, 0)
            .number_format
            .as_deref(),
        Some("0.00")
    );
    assert_eq!(
        engine
            .get_resolved_format(&copy, 4, 0)
            .number_format
            .as_deref(),
        Some("0.00")
    );
    assert_eq!(engine.get_resolved_format(&copy, 0, 2).italic, Some(true));
    engine
        .patch_row_format(&copy, 3, CellFormat::default(), vec!["numberFormat".into()])
        .unwrap();
    engine.clear_col_format(&source, 2).unwrap();
    assert_eq!(
        engine
            .get_resolved_format(&source, 3, 0)
            .number_format
            .as_deref(),
        Some("0.00")
    );
    assert_ne!(
        engine
            .get_resolved_format(&copy, 3, 0)
            .number_format
            .as_deref(),
        Some("0.00")
    );
    assert_eq!(engine.get_resolved_format(&copy, 0, 2).italic, Some(true));
    let bytes = engine.export_to_xlsx_bytes().unwrap();
    let (reloaded, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let copy = sheet_id(&reloaded.get_all_sheet_ids()[1]);
    assert_eq!(
        reloaded
            .get_resolved_format(&copy, 4, 0)
            .number_format
            .as_deref(),
        Some("0.00")
    );
    assert_eq!(reloaded.get_resolved_format(&copy, 0, 2).italic, Some(true));
    assert_ne!(
        reloaded
            .get_resolved_format(&copy, 3, 0)
            .number_format
            .as_deref(),
        Some("0.00")
    );
}
