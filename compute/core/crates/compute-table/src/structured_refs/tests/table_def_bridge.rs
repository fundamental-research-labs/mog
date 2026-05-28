use super::*;
use cell_types::SheetId;
use formula_types::TableDef;

fn sales_table_def() -> TableDef {
    TableDef {
        name: "Sales".to_string(),
        sheet: SheetId::from_raw(1),
        start_row: 2,
        start_col: 1,
        end_row: 6,
        end_col: 4,
        columns: vec![
            "Product".to_string(),
            "Region".to_string(),
            "Amount".to_string(),
            "Quantity".to_string(),
        ],
        has_headers: true,
        has_totals: true,
    }
}

fn bare_table_def() -> TableDef {
    TableDef {
        name: "Data".to_string(),
        sheet: SheetId::from_raw(1),
        start_row: 0,
        start_col: 0,
        end_row: 2,
        end_col: 2,
        columns: vec!["A".to_string(), "B".to_string(), "C".to_string()],
        has_headers: false,
        has_totals: false,
    }
}

#[test]
fn single_column_data() {
    let ref_ = parse_structured_ref("Sales[Amount]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 3,
            end_row: 5,
            columns: vec![3],
        }
    );
}

#[test]
fn all_columns_default() {
    let ref_ = parse_structured_ref("Sales[#Data]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 3,
            end_row: 5,
            columns: vec![1, 2, 3, 4],
        }
    );
}

#[test]
fn headers_with_column() {
    let ref_ = parse_structured_ref("Sales[[#Headers],[Amount]]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 2,
            end_row: 2,
            columns: vec![3],
        }
    );
}

#[test]
fn totals_with_column_range() {
    let ref_ = parse_structured_ref("Sales[[#Totals],[Product]:[Amount]]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 6,
            end_row: 6,
            columns: vec![1, 2, 3],
        }
    );
}

#[test]
fn this_row_with_column() {
    let ref_ = parse_structured_ref("Sales[@Amount]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), Some(4)).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 4,
            end_row: 4,
            columns: vec![3],
        }
    );
}

#[test]
fn this_row_without_current_row_fails() {
    let ref_ = parse_structured_ref("Sales[@Amount]").unwrap();
    assert!(resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).is_none());
}

#[test]
fn all_specifier() {
    let ref_ = parse_structured_ref("Sales[#All]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 2,
            end_row: 6,
            columns: vec![1, 2, 3, 4],
        }
    );
}

#[test]
fn bare_table_single_column() {
    let ref_ = parse_structured_ref("Data[B]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &bare_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 0,
            end_row: 2,
            columns: vec![1],
        }
    );
}

#[test]
fn nonexistent_column_fails() {
    let ref_ = parse_structured_ref("Sales[NonExistent]").unwrap();
    assert!(resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).is_none());
}

#[test]
fn case_insensitive_column_lookup() {
    let ref_ = parse_structured_ref("Sales[amount]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(ranges[0].columns, vec![3]);
}

#[test]
fn column_range_reverse_order() {
    let ref_ = parse_structured_ref("Sales[[Amount]:[Product]]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 1);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 3,
            end_row: 5,
            columns: vec![1, 2, 3],
        }
    );
}

#[test]
fn disjoint_headers_and_totals() {
    let ref_ = parse_structured_ref("Sales[[#Headers],[#Totals]]").unwrap();
    let ranges = resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).unwrap();
    assert_eq!(ranges.len(), 2);
    assert_eq!(
        ranges[0],
        ResolvedRange {
            start_row: 2,
            end_row: 2,
            columns: vec![1, 2, 3, 4],
        }
    );
    assert_eq!(
        ranges[1],
        ResolvedRange {
            start_row: 6,
            end_row: 6,
            columns: vec![1, 2, 3, 4],
        }
    );
}

#[test]
fn empty_specifiers_returns_none() {
    let ref_ = StructuredRef {
        table_name: "Sales".to_string(),
        specifiers: vec![],
    };
    assert!(resolve_ranges_from_table_def(&ref_, &sales_table_def(), None).is_none());
}
