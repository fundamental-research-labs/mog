use crate::cells::{CellEntry, CellStore, SheetStore};
use crate::eval::{Evaluator, sync_block_on};
use crate::eval_bridge::{EvalContext, StoreCellRefResolver};
use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellError, CellValue};

fn column(values: &[CellValue]) -> (CellStore, SheetId) {
    let sheet = SheetId::from_raw(1);
    let mut store = CellStore::new();
    store.add_sheet_store(
        sheet,
        "Data".into(),
        SheetStore::new(sheet, "Data".into(), values.len().max(1) as u32, 1),
    );
    for (row, value) in values.iter().enumerate() {
        store.insert_cell(
            &sheet,
            CellId::from_raw(row as u128 + 100),
            SheetPos::new(row as u32, 0),
            CellEntry {
                value: value.clone(),
            },
        );
    }
    (store, sheet)
}

fn evaluate(store: &CellStore, sheet: SheetId, formula: &str) -> CellValue {
    let resolver = StoreCellRefResolver {
        cell_store: store,
        current_sheet: sheet,
    };
    let ast = compute_parser::parse_formula(formula, Some(&resolver))
        .unwrap()
        .node;
    let context = EvalContext::new(store, CellId::from_raw(10_000), sheet);
    sync_block_on(Evaluator::evaluate(&ast, &context, &context)).unwrap()
}

#[test]
fn borrowed_and_evaluated_aggregates_preserve_mixed_values_and_error_order() {
    let mut values = vec![
        CellValue::number(6.0),
        CellValue::Boolean(true),
        CellValue::Boolean(false),
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::Text("7".into()),
        CellValue::Text("text".into()),
        CellValue::number(-2.0),
    ];
    for with_errors in [false, true] {
        if with_errors {
            values.extend([
                CellValue::Error(CellError::Ref, None),
                CellValue::Error(CellError::Div0, None),
            ]);
        }
        let (store, sheet) = column(&values);
        for (name, result) in [
            ("SUM", 4.0),
            ("AVERAGE", 2.0),
            ("COUNT", 2.0),
            ("COUNTA", if with_errors { 9.0 } else { 7.0 }),
            ("COUNTBLANK", 2.0),
            ("MIN", -2.0),
            ("MAX", 6.0),
        ] {
            let expected = if with_errors && matches!(name, "SUM" | "AVERAGE" | "MIN" | "MAX") {
                CellValue::Error(CellError::Ref, None)
            } else {
                CellValue::number(result)
            };
            // Nested parentheses take the generic evaluator path; the direct
            // range borrows a column. Both must retain the same semantics.
            for range in [
                format!("A1:A{}", values.len()),
                format!("((A1:A{}))", values.len()),
            ] {
                let formula = format!("{name}({range})");
                assert_eq!(evaluate(&store, sheet, &formula), expected, "{formula}");
            }
        }
    }
}

#[test]
fn aggregate_sources_preserve_inline_boolean_and_omitted_argument_coercion() {
    let (store, sheet) = column(&[CellValue::Boolean(true), CellValue::Text("text".into())]);
    for (formula, expected) in [
        ("SUM(A1:A2)", 0.0),
        ("MIN(A1:A2)", 0.0),
        ("MAX(A1:A2)", 0.0),
        ("COUNT(A1:A2)", 0.0),
        ("SUM(TRUE,2)", 3.0),
        ("SUM({TRUE,2})", 3.0),
        ("COUNT(TRUE,2)", 2.0),
        ("COUNT({TRUE,2})", 1.0),
        ("AVERAGE(2,)", 1.0),
        ("MIN(2,)", 0.0),
    ] {
        assert_eq!(
            evaluate(&store, sheet, formula),
            CellValue::number(expected),
            "{formula}"
        );
    }
    assert_eq!(
        evaluate(&store, sheet, "AVERAGE(A1:A2)"),
        CellValue::Error(CellError::Div0, None)
    );
}

#[cfg(feature = "dd-precision")]
#[test]
fn borrowed_sum_retains_double_double_low_component() {
    let (store, sheet) = column(&[CellValue::number_dd(1e16, 1.0), CellValue::number(-1e16)]);
    for formula in ["SUM(A1:A2)", "SUM(((A1:A2)))"] {
        assert_eq!(evaluate(&store, sheet, formula), CellValue::number(1.0));
    }
}
