//! SUBTOTAL retains row identities across reference-producing expressions.
use super::super::ComputeEngine;
use super::helpers::cell_value_at;
use domain_types::domain::table::{TableColumnSpec, TableSpec};
use domain_types::{CellData, ParseOutput, SheetData};
use value_types::{CellError, CellValue};

fn table_engine() -> (ComputeEngine, cell_types::SheetId) {
    table_engine_with_hidden_rows(&[])
}

fn table_engine_with_hidden_rows(hidden_rows: &[u32]) -> (ComputeEngine, cell_types::SheetId) {
    let headers = ["Sales", "Unrelated", "Extra", "Status"];
    let mut cells: Vec<_> = headers
        .iter()
        .enumerate()
        .map(|(col, value)| CellData {
            row: 0,
            col: col as u32,
            value: CellValue::from(*value),
            ..Default::default()
        })
        .collect();
    for (row, value) in [(1, 10.0), (2, 20.0), (3, 30.0), (4, 0.0), (5, 40.0)] {
        for (col, value) in [
            (0, CellValue::from(value)),
            (1, CellValue::from(10000.0)),
            (2, CellValue::from(value * 10.0)),
            (3, CellValue::from(if row == 2 { "Drop" } else { "Keep" })),
        ] {
            cells.push(CellData {
                row,
                col,
                value,
                formula: (row == 4 && col == 0).then(|| "SUBTOTAL(9,A2)".into()),
                ..Default::default()
            });
        }
    }
    for (row, formula) in [
        (8, "SUBTOTAL(109,SalesTable[Sales])"),
        (9, "SUBTOTAL(9,SalesTable[Sales])"),
    ] {
        cells.push(CellData {
            row,
            col: 5,
            formula: Some(formula.into()),
            ..Default::default()
        });
    }
    let output = ParseOutput {
        sheets: vec![SheetData {
            name: "SalesData".into(),
            rows: 20,
            cols: 8,
            cells,
            dimensions: domain_types::SheetDimensions {
                row_heights: hidden_rows
                    .iter()
                    .map(|&row| domain_types::RowDimension {
                        row,
                        hidden: true,
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            },
            tables: vec![TableSpec {
                id: 1,
                name: "SalesTable".into(),
                display_name: "SalesTable".into(),
                range_ref: "A1:D6".into(),
                auto_filter_ref: Some("A1:D6".into()),
                columns: headers
                    .iter()
                    .enumerate()
                    .map(|(index, name)| TableColumnSpec {
                        id: index as u32 + 1,
                        name: (*name).into(),
                        ..Default::default()
                    })
                    .collect(),
                ..Default::default()
            }],
            ..Default::default()
        }],
        ..Default::default()
    };
    let bytes = xlsx_parser::write::write_xlsx_from_parse_output(&output).unwrap();
    let (mut engine, _) = ComputeEngine::from_xlsx_bytes(&bytes).unwrap();
    let sheet = engine.stores.storage.sheet_order()[0];
    engine.recalculate().unwrap();
    (engine, sheet)
}

fn assert_formula(
    engine: &mut ComputeEngine,
    sheet: &cell_types::SheetId,
    formula: &str,
    expected: CellValue,
) {
    engine.set_cell_value_parsed(sheet, 8, 5, formula).unwrap();
    assert_eq!(cell_value_at(engine, sheet, 8, 5), expected, "{formula}");
}

#[test]
fn subtotal_filters_table_named_indirect_union_and_reference_function_inputs() {
    let (mut engine, sheet) = table_engine();
    let filter_id = engine
        .get_filters_in_sheet(&sheet)
        .into_iter()
        .find(|filter| {
            filter.filter_kind == crate::storage::sheet::filters::FilterKind::TableFilter
        })
        .unwrap()
        .id;
    engine
        .set_column_filter(
            &sheet,
            &filter_id,
            3,
            crate::storage::sheet::filters::ColumnFilter::Values {
                values: vec![serde_json::json!("Keep")],
                include_blanks: false,
            },
        )
        .unwrap();
    engine.hide_rows(&sheet, &[3]).unwrap();
    engine
        .create_named_range(domain_types::DefinedNameInput {
            name: "SalesValues".into(),
            refers_to: "=SalesTable[Sales]".into(),
            scope: None,
            comment: None,
        })
        .unwrap();
    for reference in [
        "SalesTable[Sales]",
        "A2:A6",
        "SalesValues",
        "[0]!SalesValues",
        "INDIRECT(\"SalesTable[Sales]\")",
        "INDIRECT(\"SalesValues\")",
        "OFFSET(A2,0,0,5,1)",
        "INDEX(A2:A6,0)",
        "A2:INDEX(A:A,6)",
        "(A2:A3,A4:A6)",
        "(A2:A6)",
        "'SalesData'!A2:A6",
    ] {
        assert_formula(
            &mut engine,
            &sheet,
            &format!("=SUBTOTAL(9,{reference})"),
            CellValue::from(80.0),
        );
        assert_formula(
            &mut engine,
            &sheet,
            &format!("=SUBTOTAL(109,{reference})"),
            CellValue::from(50.0),
        );
    }
    for (code, expected) in [(9, 880.0), (109, 550.0)] {
        assert_formula(
            &mut engine,
            &sheet,
            &format!("=SUBTOTAL({code},SalesTable[[Sales],[Extra]])"),
            CellValue::from(expected),
        );
    }
    assert_formula(
        &mut engine,
        &sheet,
        "=SUBTOTAL(109,SalesTable[Sales])",
        CellValue::from(50.0),
    );
    engine.unhide_rows(&sheet, &[3]).unwrap();
    engine.recalculate().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet, 8, 5), CellValue::from(80.0));
    engine.hide_rows(&sheet, &[3]).unwrap();
    engine.recalculate().unwrap();
    assert_eq!(cell_value_at(&engine, &sheet, 8, 5), CellValue::from(50.0));

    // Changing the filter must query its live ownership rather than treating
    // all hidden rows as manually hidden or retaining imported visibility.
    engine.clear_column_filter(&sheet, &filter_id, 3).unwrap();
    assert_formula(
        &mut engine,
        &sheet,
        "=SUBTOTAL(9,SalesTable[Sales])",
        CellValue::from(100.0),
    );
    assert_formula(
        &mut engine,
        &sheet,
        "=SUBTOTAL(109,SalesTable[Sales])",
        CellValue::from(70.0),
    );
}

#[test]
fn aggregate_reference_options_preserve_documented_nested_hidden_and_error_bits() {
    let (mut engine, sheet) = table_engine();
    engine.hide_rows(&sheet, &[3]).unwrap();
    for (option, expected) in [
        (0, 100.0),
        (1, 70.0),
        (2, 100.0),
        (3, 70.0),
        (4, 110.0),
        (5, 80.0),
        (6, 110.0),
        (7, 80.0),
    ] {
        assert_formula(
            &mut engine,
            &sheet,
            &format!("=AGGREGATE(9,{option},SalesTable[Sales])"),
            CellValue::from(expected),
        );
    }
    engine.set_cell_value_parsed(&sheet, 2, 0, "=1/0").unwrap();
    for (option, expected) in [(2, 80.0), (3, 50.0), (6, 90.0), (7, 60.0)] {
        assert_formula(
            &mut engine,
            &sheet,
            &format!("=AGGREGATE(9,{option},A2:A6)"),
            CellValue::from(expected),
        );
    }
    assert_formula(
        &mut engine,
        &sheet,
        "=AGGREGATE(9,4,A2:A6)",
        CellValue::Error(CellError::Div0, None),
    );
    assert_formula(
        &mut engine,
        &sheet,
        "=AGGREGATE(9,8,A2:A6)",
        CellValue::Error(CellError::Value, None),
    );
    // Calculating an array discards row identities: hidden/nested suppression
    // does not apply, while the ignore-errors option still applies.
    assert_formula(
        &mut engine,
        &sheet,
        "=AGGREGATE(14,3,A2:A6*1,2)",
        CellValue::from(30.0),
    );
}

#[test]
fn subtotal_imported_manual_hidden_rows_reach_initial_recalc_rebuild_and_replay() {
    let (mut engine, sheet) = table_engine_with_hidden_rows(&[3]);
    let assert_totals = |engine: &ComputeEngine, high: f64| {
        assert_eq!(cell_value_at(engine, &sheet, 8, 5), CellValue::from(high));
        assert_eq!(cell_value_at(engine, &sheet, 9, 5), CellValue::from(100.0));
    };
    assert_totals(&engine, 70.0);
    engine.rebuild_compute_core().unwrap();
    assert_totals(&engine, 70.0);
    let peer = super::helpers::rebuild_native_engine(&engine);
    assert_totals(&peer, 70.0);
    engine.unhide_rows(&sheet, &[3]).unwrap();
    engine.recalculate().unwrap();
    assert_totals(&engine, 100.0);
    engine.hide_rows(&sheet, &[3]).unwrap();
    engine.recalculate().unwrap();
    assert_totals(&engine, 70.0);
}
