//! Function-call syntax must resolve lexical callable values before built-ins.
use super::super::ComputeEngine;
use super::helpers::cell_value_at;
use domain_types::{CellData, ParseOutput, SheetData};
use value_types::{CellError, CellValue};

fn cases() -> Vec<(&'static str, CellValue)> {
    vec![
        (
            "LAMBDA(fn,x,fn(x))(LAMBDA(n,n*2),25)",
            CellValue::from(50.0),
        ),
        (
            "_xlfn.LAMBDA(_xlpm.fn,_xlpm.x,_xlpm.fn(_xlpm.x))(_xlfn.LAMBDA(_xlpm.n,_xlpm.n*2),25)",
            CellValue::from(50.0),
        ),
        ("LET(fn,LAMBDA(n,n+10),fn(5))", CellValue::from(15.0)),
        (
            "LAMBDA(fn,fn(3))(LAMBDA(n,LAMBDA(x,n+x)))(4)",
            CellValue::from(7.0),
        ),
        (
            "LET(fn,LAMBDA(n,n+1),LET(FN,LAMBDA(n,n*3),fn(4))+fn(4))",
            CellValue::from(17.0),
        ),
        (
            "LET(offset,10,fn,LAMBDA(n,n+offset),LET(offset,100,FN(2)))",
            CellValue::from(12.0),
        ),
        ("LET(SORT,LAMBDA(n,n+7),SORT(5))", CellValue::from(12.0)),
        ("LAMBDA(SORT,SORT(5))(LAMBDA(n,n+7))", CellValue::from(12.0)),
        (
            "LAMBDA(Fn,X,fn(x))(LAMBDA(N,n*2),25)",
            CellValue::from(50.0),
        ),
        (
            "LAMBDA(apply,apply(LAMBDA(n,n*2),5))(LAMBDA(fn,x,fn(x)))",
            CellValue::from(10.0),
        ),
        (
            "SUM(MAP({1;2},LAMBDA(n,LET(fn,LAMBDA(x,n+x),SUM(fn(1))))))",
            CellValue::from(5.0),
        ),
        (
            "SUM(MAP({1;2},LAMBDA(n,LET(fn,LAMBDA(x,n+{1;2}),SUM(fn(0))))))",
            CellValue::from(12.0),
        ),
        ("LET(fn,42,fn(1))", CellValue::Error(CellError::Value, None)),
        ("LET(fn,NA(),fn(1))", CellValue::Error(CellError::Na, None)),
        (
            "LET(fn,LAMBDA(x,x),fn(1,2))",
            CellValue::Error(CellError::Value, None),
        ),
        (
            "LET(fn,LAMBDA(n,n+1),fn(2))+fn(2)",
            CellValue::Error(CellError::Name, None),
        ),
    ]
}

fn assert_results(engine: &ComputeEngine) {
    let sheet = engine.storage().sheet_order()[0];
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
fn lexical_callable_bindings_work_in_formula_text_and_xlsx_lifecycle() {
    let input = ParseOutput {
        sheets: vec![SheetData {
            name: "Calls".into(),
            rows: cases().len() as u32,
            cols: 1,
            cells: cases()
                .into_iter()
                .enumerate()
                .map(|(row, (formula, _))| CellData {
                    row: row as u32,
                    col: 0,
                    formula: Some(formula.into()),
                    value: CellValue::from(999.0),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&input).unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    engine.recalculate().unwrap();
    assert_results(&engine);
    let sheet = engine.storage().sheet_order()[0];
    for (row, (formula, _)) in cases().into_iter().enumerate() {
        // Direct entry exercises unprefixed user syntax as well as OOXML import.
        // Prefixes belong to the import boundary, so use the authored first row
        // formula for the equivalent prefixed second row during direct entry.
        let formula = if row == 1 { cases()[0].0 } else { formula };
        engine
            .set_cell_value_parsed(&sheet, row as u32, 0, &format!("={formula}"))
            .unwrap();
    }
    assert_results(&engine);
    engine.rebuild_compute_core().unwrap();
    assert_results(&engine);
    let (mut reloaded, _) =
        ComputeEngine::from_xlsx_bytes(&engine.export_to_xlsx_bytes().unwrap()).unwrap();
    reloaded.recalculate().unwrap();
    assert_results(&reloaded);
}
