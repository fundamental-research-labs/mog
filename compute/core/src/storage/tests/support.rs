use super::*;

pub(super) fn make_sheet_id(n: u128) -> SheetId {
    SheetId::from_raw(n)
}

pub(super) fn make_cell_id(n: u128) -> CellId {
    CellId::from_raw(n)
}

pub(super) fn simple_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(42.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Text("Hello".into()),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(100.0)),
                    formula: Some("=A1*2+16".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![NamedRangeDef::from_positions(
            "Revenue".to_string(),
            formula_types::Scope::Workbook,
            make_cell_id(5001),
            make_cell_id(5002),
            0,
            0,
            9,
            0,
        )],
        tables: vec![TableDef {
            name: "Sales".to_string(),
            sheet: SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 2,
            columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
            has_headers: true,
            has_totals: false,
        }],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}
