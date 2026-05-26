use std::sync::Arc;

use super::helpers::*;
use domain_types::{
    CalculationProperties, DocumentProperties, NamedRange, ParseOutput, SheetData,
    WorkbookProtection,
};
use value_types::{CellValue, FiniteF64};

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
            comment: Some("comment text".to_string()),
            custom_menu: Some("menu text".to_string()),
            description: Some("description text".to_string()),
            help: Some("help text".to_string()),
            status_bar: Some("status text".to_string()),
            xlm: true,
            function: true,
            vb_procedure: true,
            publish_to_server: true,
            workbook_parameter: true,
            ..Default::default()
        },
        NamedRange {
            name: "SheetScoped".to_string(),
            refers_to: "Sheet1!$A$1:$B$2".to_string(),
            local_sheet_id: Some(0),
            hidden: false,
            comment: None,
            ..Default::default()
        },
    ];

    let rt = roundtrip(&output);

    // Named ranges should round-trip (order may vary)
    let rt_names: std::collections::HashSet<String> =
        rt.named_ranges.iter().map(|n| n.name.clone()).collect();

    assert!(
        rt_names.contains("MyRange"),
        "Named range 'MyRange' should be preserved. Got: {rt_names:?}"
    );

    // Find "MyRange" and check refers_to
    let my_range = rt
        .named_ranges
        .iter()
        .find(|n| n.name == "MyRange")
        .expect("MyRange should exist");
    assert_eq!(my_range.refers_to, "Sheet1!$A$1");
    assert_eq!(my_range.comment.as_deref(), Some("comment text"));
    assert_eq!(my_range.custom_menu.as_deref(), Some("menu text"));
    assert_eq!(my_range.description.as_deref(), Some("description text"));
    assert_eq!(my_range.help.as_deref(), Some("help text"));
    assert_eq!(my_range.status_bar.as_deref(), Some("status text"));
    assert!(my_range.xlm);
    assert!(my_range.function);
    assert!(my_range.vb_procedure);
    assert!(my_range.publish_to_server);
    assert!(my_range.workbook_parameter);
}

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
fn roundtrip_document_properties() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.properties = Some(DocumentProperties {
        title: Some("Test Workbook".to_string()),
        creator: Some("Shortcut Tests".to_string()),
        description: Some("A test document".to_string()),
        subject: Some("Testing".to_string()),
        category: Some("Test".to_string()),
        keywords: Some("test, roundtrip".to_string()),
        ..Default::default()
    });
    let rt = roundtrip(&output);
    let props = rt
        .properties
        .as_ref()
        .expect("document properties should survive round-trip");
    assert_eq!(props.title.as_deref(), Some("Test Workbook"));
    assert_eq!(props.creator.as_deref(), Some("Shortcut Tests"));
    assert_eq!(props.description.as_deref(), Some("A test document"));
    assert_eq!(props.subject.as_deref(), Some("Testing"));
    assert_eq!(props.category.as_deref(), Some("Test"));
    assert_eq!(props.keywords.as_deref(), Some("test, roundtrip"));
}

#[test]
fn roundtrip_document_properties_minimal() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.properties = Some(DocumentProperties {
        title: Some("Minimal".to_string()),
        ..Default::default()
    });
    let rt = roundtrip(&output);
    let props = rt
        .properties
        .as_ref()
        .expect("document properties should survive round-trip");
    assert_eq!(props.title.as_deref(), Some("Minimal"));
}

#[test]
fn roundtrip_workbook_protection() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.protection = Some(WorkbookProtection {
        lock_structure: true,
        lock_windows: true,
        lock_revision: false,
        ..Default::default()
    });
    let rt = roundtrip(&output);
    let prot = rt
        .protection
        .as_ref()
        .expect("workbook protection should survive round-trip");
    assert!(prot.lock_structure);
    assert!(prot.lock_windows);
}

#[test]
fn roundtrip_workbook_protection_structure_only() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.protection = Some(WorkbookProtection {
        lock_structure: true,
        lock_windows: false,
        lock_revision: false,
        ..Default::default()
    });
    let rt = roundtrip(&output);
    let prot = rt
        .protection
        .as_ref()
        .expect("workbook protection should survive round-trip");
    assert!(prot.lock_structure);
    assert!(!prot.lock_windows);
}

#[test]
fn roundtrip_iterative_calc_enabled() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.calculation = CalculationProperties {
        iterate: true,
        iterate_count: 200,
        iterate_delta: 0.0001,
        ..Default::default()
    };
    let rt = roundtrip(&output);
    assert!(
        rt.calculation.iterate,
        "iterative calc enabled should survive round-trip"
    );
    assert_eq!(rt.calculation.iterate_count, 200);
    assert!(
        (rt.calculation.iterate_delta - 0.0001).abs() < 1e-10,
        "iterate_delta should round-trip: got {}",
        rt.calculation.iterate_delta
    );
}

#[test]
fn roundtrip_iterative_calc_defaults() {
    let mut output = make_single_sheet(
        "Sheet1",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.calculation = CalculationProperties {
        iterate: false,
        iterate_count: 100,
        iterate_delta: 0.001,
        ..Default::default()
    };
    let rt = roundtrip(&output);
    // Default iterative calc (disabled) may or may not be explicitly written.
    // If it round-trips, it should match defaults.
    assert!(!rt.calculation.iterate);
    assert_eq!(rt.calculation.iterate_count, 100);
    assert!((rt.calculation.iterate_delta - 0.001).abs() < 1e-10);
}
