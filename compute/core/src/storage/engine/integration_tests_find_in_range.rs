use super::*;
use crate::engine_types::queries::FindInRangeOptions;
use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
use value_types::{CellValue, FiniteF64};

fn sheet_id() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
}

fn text(value: &str) -> CellValue {
    CellValue::Text(value.into())
}

fn find_snapshot() -> WorkbookSnapshot {
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
                    value: text("COGS"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: text("Revenue A"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 1,
                    col: 0,
                    value: text("Q1"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
                    row: 1,
                    col: 1,
                    value: text("Revenue B"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440005".to_string(),
                    row: 4,
                    col: 0,
                    value: text("literal dot .*"),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440006".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::Number(FiniteF64::must(3.0)),
                    formula: Some("=SUM(1,2)".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

fn options(pattern: &str) -> FindInRangeOptions {
    FindInRangeOptions {
        text: pattern.to_string(),
        case_sensitive: None,
        whole_cell: None,
        include_formulas: None,
    }
}

#[test]
fn find_in_range_interprets_text_as_regex_pattern() {
    let (engine, _) = YrsComputeEngine::from_snapshot(find_snapshot()).unwrap();
    let sheet = sheet_id();

    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 0, 4, 2, options("OG"))
            .map(|result| result.address),
        Some("A1".to_string())
    );
    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 0, 4, 2, options("C.GS"))
            .map(|result| result.address),
        Some("A1".to_string())
    );
    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 0, 4, 2, options("^COGS$"))
            .map(|result| result.address),
        Some("A1".to_string())
    );
    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 0, 4, 2, options("Revenue A|Revenue B"))
            .map(|result| result.address),
        Some("B1".to_string())
    );
    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 0, 4, 2, options("Q[12]"))
            .map(|result| result.address),
        Some("A2".to_string())
    );
    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 0, 4, 2, options(".*"))
            .map(|result| result.address),
        Some("A1".to_string())
    );
}

#[test]
fn find_in_range_applies_regex_to_formula_text_when_requested() {
    let (engine, _) = YrsComputeEngine::from_snapshot(find_snapshot()).unwrap();
    let sheet = sheet_id();
    let mut opts = options(r"SUM\(1,2\)");
    opts.include_formulas = Some(true);

    assert_eq!(
        engine
            .find_in_range(&sheet, 0, 2, 0, 2, opts)
            .map(|result| result.address),
        Some("C1".to_string())
    );
}
