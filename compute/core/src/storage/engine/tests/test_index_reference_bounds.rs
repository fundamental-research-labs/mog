//! INDEX selectors retain their full width until checked against source bounds.
use super::super::YrsComputeEngine;
use super::helpers::cell_value_at;
use domain_types::{CellData, ParseOutput, SheetData};
use value_types::{CellError, CellValue};

fn cases() -> Vec<(String, CellValue)> {
    let mut cases = Vec::new();
    for index in ["4294967297", "1E100"] {
        for expression in [
            format!("INDEX(Data!B2:B3,{index})"),
            format!("INDEX(Data!B2:C2,{index})"),
            format!("INDEX(Data!B2:C3,{index},1)"),
            format!("INDEX(Data!B2:C3,1,{index})"),
            format!("INDEX(Data!B2:C3,{index},0)"),
            format!("INDEX(Data!B2:C3,0,{index})"),
            format!("INDEX({{11,12;21,22}},{index},1)"),
            format!("INDEX({{11,12;21,22}},{index},0)"),
            format!("INDEX({{11,12;21,22}},0,{index})"),
            format!("INDEX(Data!B2:C3,{{1;{index}}},1)"),
            format!("INDEX(Data!B2:C3,{{1;2}},{{1;{index}}})"),
        ] {
            cases.push((
                format!("SUM({expression})"),
                CellValue::Error(CellError::Ref, None),
            ));
        }
    }
    for index in ["-1", "-0.5"] {
        for expression in [
            format!("INDEX(Data!B2:C3,{index},1)"),
            format!("INDEX(Data!B2:C3,1,{index})"),
            format!("INDEX(Data!B2:C3,{{1;{index}}},1)"),
        ] {
            cases.push((
                format!("SUM({expression})"),
                CellValue::Error(CellError::Value, None),
            ));
        }
    }
    for (expression, expected) in [
        ("INDEX(Data!B2:B3,2)", 21.0),
        ("INDEX(Data!B2:C2,2)", 12.0),
        ("INDEX(Data!B2:C3,2,2)", 22.0),
        ("INDEX(Data!B2:C3,2)", 43.0),
        ("INDEX(Data!B2:C3,2,0)", 43.0),
        ("INDEX(Data!B2:C3,0,2)", 34.0),
        ("INDEX(Data!B2:C3,0,0)", 66.0),
        ("INDEX(Data!B2:B3,0)", 32.0),
        ("INDEX(Data!B2:C2,0)", 23.0),
        ("INDEX(Data!B2:C3,{1;2},2)", 34.0),
        ("INDEX(Data!B2:C3,{1;2},{2;1})", 33.0),
        // Extract each lifted slice before summing it, preserving its shape.
        ("INDEX(INDEX(Data!B2:C3,{0;2},1),1,1)", 32.0),
        ("INDEX(INDEX(Data!B2:C3,{0;2},{2;0}),1,1)", 34.0),
        ("INDEX(INDEX(Data!B2:C3,{0;2},{2;0}),2,1)", 43.0),
        ("INDEX(INDEX(Data!B2:C3,{0;2},0),1,1)", 66.0),
        ("INDEX(INDEX({11,12;21,22},{0;2},1),1,1)", 32.0),
        ("INDEX(INDEX({11,12;21,22},{0;2},{2;0}),1,1)", 34.0),
        ("INDEX(INDEX({11,12;21,22},{0;2},{2;0}),2,1)", 43.0),
    ] {
        cases.push((format!("SUM({expression})"), CellValue::from(expected)));
    }
    cases
}

fn assert_results(engine: &YrsComputeEngine) {
    let sheet = engine.storage().sheet_order()[1];
    for (row, (formula, expected)) in cases().into_iter().enumerate() {
        let actual = cell_value_at(engine, &sheet, row as u32, 0);
        match expected {
            CellValue::Error(code, _) => assert!(
                matches!(actual, CellValue::Error(actual_code, _) if actual_code == code),
                "{formula}: {actual:?}",
            ),
            _ => assert_eq!(actual, expected, "{formula}"),
        }
    }
}

#[test]
fn index_reference_bounds_and_zero_slices_survive_formula_lifecycle() {
    let input = ParseOutput {
        sheets: vec![
            SheetData {
                name: "Data".into(),
                rows: 4,
                cols: 4,
                cells: [(1, 1, 11.0), (1, 2, 12.0), (2, 1, 21.0), (2, 2, 22.0)]
                    .into_iter()
                    .map(|(row, col, value)| CellData {
                        row,
                        col,
                        value: CellValue::from(value),
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            },
            SheetData {
                name: "Bounds".into(),
                rows: cases().len() as u32,
                cols: 1,
                cells: cases()
                    .into_iter()
                    .enumerate()
                    .map(|(row, (formula, _))| CellData {
                        row: row as u32,
                        col: 0,
                        formula: Some(formula),
                        value: CellValue::from(999.0),
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap();
    let (mut engine, _) = YrsComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    engine.recalculate().unwrap();
    assert_results(&engine);
    let sheet = engine.storage().sheet_order()[1];
    for (row, (formula, _)) in cases().into_iter().enumerate() {
        engine
            .set_cell_value_parsed(&sheet, row as u32, 0, &format!("={formula}"))
            .unwrap();
    }
    assert_results(&engine);
    engine.rebuild_compute_core().unwrap();
    assert_results(&engine);
    let (mut reloaded, _) =
        YrsComputeEngine::from_xlsx_bytes(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    reloaded.recalculate().unwrap();
    assert_results(&reloaded);
}
