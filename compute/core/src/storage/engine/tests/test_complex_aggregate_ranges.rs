//! Complex aggregation must consume production range and array arguments.
use super::super::YrsComputeEngine;
use super::helpers::cell_value_at;
use domain_types::{CellData, ParseOutput, SheetData};
use value_types::{CellError, CellValue};

#[test]
fn complex_aggregate_ranges_recalculate_after_xlsx_import() {
    let mut cells = Vec::new();
    // Reproduce the engineering stress workbook's sparse two-column IMSUM.
    for row in 32..50 {
        cells.push(CellData {
            row,
            col: 2,
            value: CellValue::from("2+3j"),
            ..Default::default()
        });
    }
    for (row, value) in [(44, "4+6j"), (48, "4+5j"), (49, "4+5j")] {
        cells.push(CellData {
            row,
            col: 3,
            value: CellValue::from(value),
            ..Default::default()
        });
    }
    for (row, col, value) in [(0, 0, "1+j"), (2, 0, "1-j"), (2, 1, "3")] {
        cells.push(CellData {
            row,
            col,
            value: CellValue::from(value),
            ..Default::default()
        });
    }
    cells.push(CellData {
        row: 0,
        col: 1,
        value: CellValue::from(2.0),
        ..Default::default()
    });
    cells.push(CellData {
        row: 0,
        col: 4,
        value: CellValue::Error(CellError::Div0, None),
        ..Default::default()
    });
    let formulas = [
        ("IMSUM(C33:D50)", CellValue::from("48+70j")),
        ("IMPRODUCT(A1:B3)", CellValue::from("12")),
        ("IMPRODUCT(A1:B3,\"2j\")", CellValue::from("24j")),
        ("IMSUM({\"1+j\",2;\"1-j\",3})", CellValue::from("7")),
        ("IMPRODUCT({\"1+j\",2;\"1-j\",3})", CellValue::from("12")),
        ("IMSUM(E1:E2)", CellValue::Error(CellError::Div0, None)),
        ("IMPRODUCT(E1:E2)", CellValue::Error(CellError::Div0, None)),
    ];
    for (row, (formula, _)) in formulas.iter().enumerate() {
        cells.push(CellData {
            row: row as u32,
            col: 5,
            formula: Some((*formula).into()),
            ..Default::default()
        });
    }
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Complex".into(),
            rows: 50,
            cols: 6,
            cells,
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap();
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    engine.recalculate().unwrap();
    let sheet_id = engine.stores.storage.sheet_order()[0];
    for (row, (formula, expected)) in formulas.iter().enumerate() {
        let actual = cell_value_at(&engine, &sheet_id, row as u32, 5);
        match expected {
            CellValue::Error(error, _) => assert!(
                matches!(actual, CellValue::Error(actual_error, _) if actual_error == *error),
                "{formula}: {actual:?}"
            ),
            _ => assert_eq!(&actual, expected, "{formula}"),
        }
    }
}
