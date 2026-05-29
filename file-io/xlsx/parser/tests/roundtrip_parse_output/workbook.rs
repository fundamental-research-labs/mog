#![allow(unused_imports)]

use std::sync::Arc;

use super::helpers::{
    assert_cells_match, cell, formula_cell, make_single_sheet, roundtrip, styled_cell,
};
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CalcMode,
    CalculationProperties, CellData, ColDimension, Comment, CommentType, ConditionalFormat,
    DocumentCustomProperty, DocumentCustomPropertyValue, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FormulaCacheProvenance, FormulaCacheState, FrozenPane,
    MergeRegion, NamedRange, ParseOutput, RefMode, RowDimension, SheetData, SheetDimensions,
    TableColumnSpec, TableSpec, ValidationOperator, ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};
use xlsx_parser::infra::package_integrity::validate_archive_package_integrity;
use xlsx_parser::write::{
    ExportDiagnosticCode, write_xlsx_from_parse_output, write_xlsx_from_parse_output_with_report,
};
use xlsx_parser::zip::XlsxArchive;

#[test]
fn document_properties_roundtrip_from_modeled_state() {
    let mut output = make_single_sheet("Sheet1", Vec::new());
    output.properties = Some(DocumentProperties {
        title: Some("Modeled Workbook".to_string()),
        creator: Some("Mog".to_string()),
        custom: vec![("ReviewStatus".to_string(), "Approved".to_string())],
        ..Default::default()
    });

    let round_tripped = roundtrip(&output);
    let properties = round_tripped
        .properties
        .as_ref()
        .expect("document properties should round-trip");

    assert_eq!(properties.title.as_deref(), Some("Modeled Workbook"));
    assert_eq!(properties.creator.as_deref(), Some("Mog"));
    assert_eq!(
        properties.custom,
        vec![("ReviewStatus".to_string(), "Approved".to_string())]
    );
}

#[test]
fn typed_custom_document_properties_roundtrip_from_modeled_state() {
    let mut output = make_single_sheet("Sheet1", Vec::new());
    output.properties = Some(DocumentProperties {
        typed_custom: vec![
            DocumentCustomProperty {
                fmtid: Some(domain_types::DEFAULT_CUSTOM_PROPERTY_FMTID.to_string()),
                pid: Some(2),
                name: "Approved".to_string(),
                value: DocumentCustomPropertyValue::Bool(true),
                link_target: None,
            },
            DocumentCustomProperty {
                fmtid: Some(domain_types::DEFAULT_CUSTOM_PROPERTY_FMTID.to_string()),
                pid: Some(3),
                name: "Revision".to_string(),
                value: DocumentCustomPropertyValue::I4(7),
                link_target: None,
            },
            DocumentCustomProperty {
                fmtid: Some(domain_types::DEFAULT_CUSTOM_PROPERTY_FMTID.to_string()),
                pid: Some(4),
                name: "Confidence".to_string(),
                value: DocumentCustomPropertyValue::R8(0.875),
                link_target: None,
            },
            DocumentCustomProperty {
                fmtid: Some(domain_types::DEFAULT_CUSTOM_PROPERTY_FMTID.to_string()),
                pid: Some(5),
                name: "ReviewedAt".to_string(),
                value: DocumentCustomPropertyValue::Filetime("2026-05-27T10:00:00Z".to_string()),
                link_target: None,
            },
        ],
        ..Default::default()
    });

    let round_tripped = roundtrip(&output);
    let properties = round_tripped
        .properties
        .as_ref()
        .expect("document properties should round-trip");

    assert_eq!(
        properties.typed_custom,
        output.properties.as_ref().unwrap().typed_custom
    );
    assert_eq!(
        properties.custom,
        vec![
            ("Approved".to_string(), "true".to_string()),
            ("Revision".to_string(), "7".to_string()),
            ("Confidence".to_string(), "0.875".to_string()),
            ("ReviewedAt".to_string(), "2026-05-27T10:00:00Z".to_string()),
        ]
    );
}

#[test]
fn calculation_properties_roundtrip_from_modeled_state() {
    let mut output = make_single_sheet("Sheet1", Vec::new());
    output.calculation = CalculationProperties {
        iterate: true,
        iterate_count: 250,
        iterate_delta: 0.0005,
        calc_mode: CalcMode::Manual,
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
    };

    let mut expected = output.calculation.clone();
    expected.calc_id = Some(0);

    let round_tripped = roundtrip(&output);

    assert_eq!(round_tripped.calculation, expected);
}

#[test]
fn calculation_properties_regenerate_workbook_xml_from_modeled_state() {
    let mut output = make_single_sheet("Sheet1", Vec::new());
    output.calculation = CalculationProperties {
        iterate: true,
        iterate_count: 100,
        iterate_delta: 0.001,
        calc_mode: CalcMode::Manual,
        full_calc_on_load: true,
        ref_mode: RefMode::R1C1,
        full_precision: false,
        calc_completed: false,
        calc_on_save: false,
        concurrent_calc: false,
        concurrent_manual_count: Some(2),
        calc_id: Some(191029),
        force_full_calc: true,
        has_explicit_iterate_count: true,
        has_explicit_iterate_delta: true,
    };
    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"<calcPr calcId="0""#));
    assert!(workbook_xml.contains(r#"calcMode="manual""#));
    assert!(workbook_xml.contains(r#"fullCalcOnLoad="1""#));
    assert!(workbook_xml.contains(r#"refMode="R1C1""#));
    assert!(workbook_xml.contains(r#"iterate="1""#));
    assert!(workbook_xml.contains(r#"iterateCount="100""#));
    assert!(workbook_xml.contains(r#"iterateDelta="0.001""#));
    assert!(workbook_xml.contains(r#"fullPrecision="0""#));
    assert!(workbook_xml.contains(r#"calcCompleted="0""#));
    assert!(workbook_xml.contains(r#"calcOnSave="0""#));
    assert!(workbook_xml.contains(r#"concurrentCalc="0""#));
    assert!(workbook_xml.contains(r#"concurrentManualCount="2""#));
    assert!(workbook_xml.contains(r#"forceFullCalc="1""#));
    assert!(!workbook_xml.contains("999999"));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn calculation_properties_do_not_force_recalc_flags_when_clean() {
    let mut output = make_single_sheet("Sheet1", Vec::new());
    output.calculation = CalculationProperties {
        calc_id: Some(191029),
        full_calc_on_load: false,
        calc_completed: true,
        force_full_calc: false,
        has_explicit_iterate_count: true,
        has_explicit_iterate_delta: true,
        ..Default::default()
    };

    let bytes = write_xlsx_from_parse_output(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"<calcPr calcId="0""#));
    assert!(workbook_xml.contains(r#"iterateCount="100""#));
    assert!(workbook_xml.contains(r#"iterateDelta="0.001""#));
    assert!(!workbook_xml.contains(r#"fullCalcOnLoad="1""#));
    assert!(!workbook_xml.contains(r#"calcCompleted="0""#));
    assert!(!workbook_xml.contains(r#"forceFullCalc="1""#));
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn current_cell_recalc_intent_does_not_force_workbook_recalc_flags() {
    let mut cell = formula_cell(
        0,
        0,
        "A2+1",
        CellValue::Number(FiniteF64::new(2.0).unwrap()),
    );
    cell.formula_cache_provenance = FormulaCacheProvenance {
        state: FormulaCacheState::ImportedCurrent,
        force_recalc: true,
        formula_identity_fingerprint: Some("A2+1".to_string()),
        ..Default::default()
    };
    let output = make_single_sheet("Sheet1", vec![cell]);

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();
    let sheet_xml =
        String::from_utf8(archive.read_file("xl/worksheets/sheet1.xml").unwrap()).unwrap();

    assert!(sheet_xml.contains(r#"<f ca="1">A2+1</f>"#));
    assert!(workbook_xml.contains(r#"<calcPr calcId="0"/>"#));
    assert!(!workbook_xml.contains(r#"fullCalcOnLoad="1""#));
    assert!(!workbook_xml.contains(r#"calcCompleted="0""#));
    assert!(!workbook_xml.contains(r#"forceFullCalc="1""#));
    assert!(report.diagnostics.iter().any(|diagnostic| {
        diagnostic.code == ExportDiagnosticCode::FormulaRecalcIntentPreserved
    }));
    assert!(
        !report
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == ExportDiagnosticCode::ConsumerRecalcRequired)
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

#[test]
fn stale_imported_formula_cache_forces_workbook_recalc_flags() {
    let mut cell = formula_cell(
        0,
        0,
        "A2+1",
        CellValue::Number(FiniteF64::new(2.0).unwrap()),
    );
    cell.formula_cache_provenance = FormulaCacheProvenance {
        state: FormulaCacheState::StaleImported,
        formula_identity_fingerprint: Some("A2+1".to_string()),
        ..Default::default()
    };
    let output = make_single_sheet("Sheet1", vec![cell]);

    let (bytes, report) = write_xlsx_from_parse_output_with_report(&output).unwrap();
    let archive = XlsxArchive::new(&bytes).expect("exported XLSX should be readable");
    let workbook_xml = String::from_utf8(archive.read_file("xl/workbook.xml").unwrap()).unwrap();

    assert!(workbook_xml.contains(r#"fullCalcOnLoad="1""#));
    assert!(workbook_xml.contains(r#"calcCompleted="0""#));
    assert!(workbook_xml.contains(r#"forceFullCalc="1""#));
    assert!(
        report
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == ExportDiagnosticCode::ConsumerRecalcRequired)
    );
    validate_archive_package_integrity(&archive).expect("exported package should be valid");
}

// =============================================================================
// 6c: Cell value round-trip tests
// =============================================================================
#[test]
fn roundtrip_named_ranges() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(
            0,
            0,
            CellValue::Number(FiniteF64::new(100.0).unwrap()),
        )],
    );
    output.named_ranges = vec![
        NamedRange {
            name: "MyRange".to_string(),
            refers_to: "Sheet1!$A$1".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: None,
            ..Default::default()
        },
        NamedRange {
            name: "SheetScoped".to_string(),
            refers_to: "Sheet1!$A$1:$B$2".to_string(),
            local_sheet_id: Some(0),
            hidden: true,
            comment: Some("sheet-local comment".to_string()),
            custom_menu: Some("sheet-local menu".to_string()),
            description: Some("sheet-local description".to_string()),
            help: Some("sheet-local help".to_string()),
            status_bar: Some("sheet-local status".to_string()),
            xlm: true,
            function_group_id: None,
            shortcut_key: None,
            function: true,
            vb_procedure: true,
            publish_to_server: true,
            workbook_parameter: true,
            xml_space_preserve: true,
        },
    ];

    let rt = roundtrip(&output);

    let rt_names: std::collections::HashSet<String> =
        rt.named_ranges.iter().map(|n| n.name.clone()).collect();

    assert!(
        rt_names.contains("MyRange"),
        "Named range 'MyRange' should be preserved. Got: {rt_names:?}"
    );

    let my_range = rt
        .named_ranges
        .iter()
        .find(|n| n.name == "MyRange")
        .expect("MyRange should exist");
    assert_eq!(my_range.refers_to, "Sheet1!$A$1");

    let sheet_scoped = rt
        .named_ranges
        .iter()
        .find(|n| n.name == "SheetScoped")
        .expect("SheetScoped should exist");
    assert_eq!(sheet_scoped.refers_to, "Sheet1!$A$1:$B$2");
    assert_eq!(sheet_scoped.local_sheet_id, Some(0));
    assert!(sheet_scoped.hidden);
    assert_eq!(sheet_scoped.comment.as_deref(), Some("sheet-local comment"));
    assert_eq!(
        sheet_scoped.custom_menu.as_deref(),
        Some("sheet-local menu")
    );
    assert_eq!(
        sheet_scoped.description.as_deref(),
        Some("sheet-local description")
    );
    assert_eq!(sheet_scoped.help.as_deref(), Some("sheet-local help"));
    assert_eq!(
        sheet_scoped.status_bar.as_deref(),
        Some("sheet-local status")
    );
    assert!(sheet_scoped.xlm);
    assert!(sheet_scoped.function);
    assert!(sheet_scoped.vb_procedure);
    assert!(sheet_scoped.publish_to_server);
    assert!(sheet_scoped.workbook_parameter);
    assert!(sheet_scoped.xml_space_preserve);
}

// =============================================================================
// Multiple sheets
// =============================================================================

#[test]
fn roundtrip_multiple_sheets() {
    let output = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Data".to_string(),
                rows: 3,
                cols: 2,
                cells: vec![
                    cell(0, 0, CellValue::Text(Arc::from("Name"))),
                    cell(0, 1, CellValue::Text(Arc::from("Value"))),
                    cell(1, 0, CellValue::Text(Arc::from("Alpha"))),
                    cell(1, 1, CellValue::Number(FiniteF64::new(100.0).unwrap())),
                    cell(2, 0, CellValue::Text(Arc::from("Beta"))),
                    cell(2, 1, CellValue::Number(FiniteF64::new(200.0).unwrap())),
                ],
                ..Default::default()
            },
            SheetData {
                name: "Summary".to_string(),
                rows: 1,
                cols: 1,
                cells: vec![formula_cell(
                    0,
                    0,
                    "SUM(Data!B2:B3)",
                    CellValue::Number(FiniteF64::new(300.0).unwrap()),
                )],
                ..Default::default()
            },
        ],
        ..Default::default()
    };

    let rt = roundtrip(&output);

    assert_eq!(rt.sheets.len(), 2, "Both sheets should survive");
    assert_eq!(rt.sheets[0].name, "Data");
    assert_eq!(rt.sheets[1].name, "Summary");

    assert_cells_match(&output.sheets[0].cells, &rt.sheets[0].cells, "Data");
    assert_cells_match(&output.sheets[1].cells, &rt.sheets[1].cells, "Summary");
}

#[test]
fn roundtrip_many_sheets() {
    let sheets: Vec<SheetData> = (0..5)
        .map(|i| SheetData {
            name: format!("Sheet{}", i + 1),
            rows: 1,
            cols: 1,
            cells: vec![cell(
                0,
                0,
                CellValue::Number(FiniteF64::new((i + 1) as f64).unwrap()),
            )],
            ..Default::default()
        })
        .collect();

    let output = ParseOutput {
        sheets,
        ..Default::default()
    };

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 5);
    for (i, sheet) in rt.sheets.iter().enumerate() {
        assert_eq!(sheet.name, format!("Sheet{}", i + 1));
    }
}

#[test]
fn roundtrip_sheet_name_special_chars() {
    let output = make_single_sheet(
        "My Sheet (1)",
        vec![cell(0, 0, CellValue::Text(Arc::from("data")))],
    );

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets[0].name, "My Sheet (1)");
}

// =============================================================================
// Comprehensive integration test
// =============================================================================

#[test]
fn roundtrip_comprehensive() {
    let bold = DocumentFormat {
        font: Some(FontFormat {
            bold: Some(true),
            ..Default::default()
        }),
        ..Default::default()
    };
    let highlighted = DocumentFormat {
        fill: Some(FillFormat {
            pattern_type: Some("solid".to_string()),
            pattern_foreground_color: Some("#CCFFCC".to_string()),
            background_color: None,
            ..Default::default()
        }),
        ..Default::default()
    };

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Report".to_string(),
            rows: 5,
            cols: 3,
            cells: vec![
                // Header row (bold)
                styled_cell(0, 0, CellValue::Text(Arc::from("Item")), 0),
                styled_cell(0, 1, CellValue::Text(Arc::from("Qty")), 0),
                styled_cell(0, 2, CellValue::Text(Arc::from("Total")), 0),
                // Data rows
                cell(1, 0, CellValue::Text(Arc::from("Widget"))),
                cell(1, 1, CellValue::Number(FiniteF64::new(5.0).unwrap())),
                formula_cell(
                    1,
                    2,
                    "B2*10",
                    CellValue::Number(FiniteF64::new(50.0).unwrap()),
                ),
                cell(2, 0, CellValue::Text(Arc::from("Gadget"))),
                cell(2, 1, CellValue::Number(FiniteF64::new(3.0).unwrap())),
                formula_cell(
                    2,
                    2,
                    "B3*20",
                    CellValue::Number(FiniteF64::new(60.0).unwrap()),
                ),
                // Summary row (highlighted)
                styled_cell(4, 0, CellValue::Text(Arc::from("Grand Total")), 1),
                formula_cell(
                    4,
                    2,
                    "SUM(C2:C3)",
                    CellValue::Number(FiniteF64::new(110.0).unwrap()),
                ),
            ],
            merges: vec![MergeRegion {
                start_row: 4,
                start_col: 0,
                end_row: 4,
                end_col: 1,
            }],
            frozen_pane: Some(FrozenPane {
                rows: 1,
                cols: 0,
                top_left_cell: None,
            }),
            dimensions: SheetDimensions {
                default_row_height: Some(15.0),
                default_col_width: None,
                row_heights: vec![RowDimension {
                    row: 0,
                    height: 20.0,
                    custom_height: true,
                    hidden: false,
                    ..Default::default()
                }],
                col_widths: vec![ColDimension {
                    col: 0,
                    width: 25.0,
                    custom_width: true,
                    hidden: false,
                    best_fit: false,
                    collapsed: false,
                    phonetic: false,
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        }],
        style_palette: vec![bold, highlighted],
        workbook_stylesheet: None,
        named_ranges: vec![NamedRange {
            name: "Totals".to_string(),
            refers_to: "Report!$C$2:$C$3".to_string(),
            local_sheet_id: None,
            hidden: false,
            comment: None,
            ..Default::default()
        }],
        ..Default::default()
    };

    let rt = roundtrip(&output);

    // Verify structure
    assert_eq!(rt.sheets.len(), 1);
    assert_eq!(rt.sheets[0].name, "Report");

    // Verify cells
    assert_cells_match(&output.sheets[0].cells, &rt.sheets[0].cells, "Report");

    // Verify merges
    assert_eq!(rt.sheets[0].merges.len(), 1);
    assert_eq!(rt.sheets[0].merges[0].start_row, 4);
    assert_eq!(rt.sheets[0].merges[0].end_col, 1);

    // Verify frozen pane
    let pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should survive");
    assert_eq!(pane.rows, 1);
    assert_eq!(pane.cols, 0);

    // Verify named range
    assert!(
        rt.named_ranges.iter().any(|n| n.name == "Totals"),
        "Named range 'Totals' should survive round-trip"
    );

    // Verify some style survived
    assert!(
        !rt.style_palette.is_empty(),
        "Style palette should be non-empty"
    );
}

// =============================================================================
// Edge cases
// =============================================================================

#[test]
fn roundtrip_empty_sheet() {
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "Empty".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ..Default::default()
        }],
        ..Default::default()
    };

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);
    assert_eq!(rt.sheets[0].name, "Empty");
    // Empty sheet should have no cells (or only null cells)
    let non_null: Vec<_> = rt.sheets[0]
        .cells
        .iter()
        .filter(|c| !matches!(c.value, CellValue::Null))
        .collect();
    assert!(
        non_null.is_empty(),
        "Empty sheet should have no non-null cells after round-trip"
    );
}

#[test]
fn roundtrip_large_numbers() {
    let original = make_single_sheet(
        "LargeNums",
        vec![
            cell(
                0,
                0,
                CellValue::Number(FiniteF64::new(1.7976931348623157e308).unwrap()),
            ),
            cell(0, 1, CellValue::Number(FiniteF64::new(5e-324).unwrap())),
            cell(0, 2, CellValue::Number(FiniteF64::new(-1e100).unwrap())),
        ],
    );

    let rt = roundtrip(&original);
    assert_cells_match(&original.sheets[0].cells, &rt.sheets[0].cells, "LargeNums");
}
