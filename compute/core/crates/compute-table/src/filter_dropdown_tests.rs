use super::*;
use crate::types::{
    ConditionFilter, TableFilterCondition, FilterLogic, FilterOperator, ValueFilter,
};
use value_types::{CellError, FiniteF64};

// -- Helpers ---------------------------------------------------------------

fn cv_num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(n))
}

fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.to_string())
}

fn cv_bool(b: bool) -> CellValue {
    CellValue::Boolean(b)
}

fn cv_null() -> CellValue {
    CellValue::Null
}

fn cv_err(e: CellError) -> CellValue {
    CellValue::Error(e, None)
}

fn make_value_filter(included: Vec<CellValue>, include_blanks: bool) -> FilterCriteria {
    FilterCriteria::Values(ValueFilter {
        included,
        include_blanks,
    })
}

// =========================================================================
// Test 1: Basic unique value extraction and counting
// =========================================================================

#[test]
fn basic_unique_values_and_counts() {
    let data = vec![
        cv_num(1.0),
        cv_num(2.0),
        cv_num(1.0),
        cv_num(3.0),
        cv_num(2.0),
        cv_num(1.0),
    ];
    let result = build_filter_dropdown_data(&data, None, None);

    assert_eq!(result.items.len(), 3);
    assert_eq!(result.total_row_count, 6);
    assert!(!result.has_blank);
    assert_eq!(result.blank_count, 0);

    // Items sorted by Excel ordering (numbers ascending)
    assert_eq!(result.items[0].value, cv_num(1.0));
    assert_eq!(result.items[0].count, 3);
    assert_eq!(result.items[1].value, cv_num(2.0));
    assert_eq!(result.items[1].count, 2);
    assert_eq!(result.items[2].value, cv_num(3.0));
    assert_eq!(result.items[2].count, 1);
}

// =========================================================================
// Test 2: Blank handling
// =========================================================================

#[test]
fn blank_handling() {
    let data = vec![cv_num(1.0), cv_null(), cv_num(2.0), cv_null(), cv_null()];
    let result = build_filter_dropdown_data(&data, None, None);

    assert!(result.has_blank);
    assert_eq!(result.blank_count, 3);
    assert!(result.blank_selected);
    assert_eq!(result.total_row_count, 5);
    // Blanks are NOT included in items list (they are tracked via has_blank/blank_count)
    assert_eq!(result.items.len(), 2);
    assert_eq!(result.items[0].value, cv_num(1.0));
    assert_eq!(result.items[1].value, cv_num(2.0));
}

// =========================================================================
// Test 3: Selection state from current filter (value filter)
// =========================================================================

#[test]
fn selection_state_from_value_filter() {
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let filter = make_value_filter(vec![cv_num(1.0), cv_num(3.0)], false);
    let result = build_filter_dropdown_data(&data, Some(&filter), None);

    assert_eq!(result.items.len(), 3);
    assert!(!result.blank_selected);
    assert!(result.items[0].selected); // 1.0 is in included
    assert!(!result.items[1].selected); // 2.0 is NOT in included
    assert!(result.items[2].selected); // 3.0 is in included
}

// =========================================================================
// Test 4: No filter => all selected
// =========================================================================

#[test]
fn no_filter_all_selected() {
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let result = build_filter_dropdown_data(&data, None, None);

    assert!(result.items.iter().all(|item| item.selected));
    assert!(result.blank_selected);
}

// =========================================================================
// Test 5: Non-value filter => all selected
// =========================================================================

#[test]
fn non_value_filter_all_selected() {
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let condition_filter = FilterCriteria::Condition(ConditionFilter {
        conditions: vec![TableFilterCondition {
            operator: FilterOperator::GreaterThan,
            value: cv_num(1.5),
            value2: None,
        }],
        logic: FilterLogic::And,
    });
    let result = build_filter_dropdown_data(&data, Some(&condition_filter), None);

    // Non-value filters show all as selected
    assert!(result.items.iter().all(|item| item.selected));
    assert!(result.blank_selected);
}

// =========================================================================
// Test 6: Row visibility cross-filter
// =========================================================================

#[test]
fn row_visibility_cross_filter() {
    let data = vec![
        cv_text("Apple"),
        cv_text("Banana"),
        cv_text("Apple"),
        cv_text("Cherry"),
        cv_text("Banana"),
    ];
    let visibility: Vec<u8> = vec![1, 0, 1, 0, 1];
    let result = build_filter_dropdown_data(&data, None, Some(&visibility));

    assert_eq!(result.items.len(), 3);
    assert_eq!(result.total_row_count, 5);

    // All unique values appear (even hidden ones), but counts reflect only visible rows
    let apple = result
        .items
        .iter()
        .find(|i| i.display_text == "Apple")
        .unwrap();
    let banana = result
        .items
        .iter()
        .find(|i| i.display_text == "Banana")
        .unwrap();
    let cherry = result
        .items
        .iter()
        .find(|i| i.display_text == "Cherry")
        .unwrap();

    assert_eq!(apple.count, 2); // rows 0, 2 visible
    assert_eq!(banana.count, 1); // row 4 visible, row 1 hidden
    assert_eq!(cherry.count, 0); // row 3 hidden
}

// =========================================================================
// Test 7: Empty column data
// =========================================================================

#[test]
fn empty_column_data() {
    let data: Vec<CellValue> = vec![];
    let result = build_filter_dropdown_data(&data, None, None);

    assert_eq!(result.items.len(), 0);
    assert_eq!(result.total_row_count, 0);
    assert!(!result.has_blank);
    assert_eq!(result.blank_count, 0);
}

// =========================================================================
// Test 8: Sorting by Excel ordering (numbers < text < booleans < errors)
// =========================================================================

#[test]
fn sorting_by_excel_ordering() {
    let data = vec![
        cv_bool(true),
        cv_num(42.0),
        cv_text("Hello"),
        cv_err(CellError::Na),
        cv_num(1.0),
        cv_text("Apple"),
        cv_bool(false),
    ];
    let result = build_filter_dropdown_data(&data, None, None);

    assert_eq!(result.items.len(), 7);
    // numbers first (ascending)
    assert_eq!(result.items[0].value, cv_num(1.0));
    assert_eq!(result.items[1].value, cv_num(42.0));
    // then text (case-insensitive alphabetical)
    assert_eq!(result.items[2].value, cv_text("Apple"));
    assert_eq!(result.items[3].value, cv_text("Hello"));
    // then booleans (FALSE < TRUE)
    assert_eq!(result.items[4].value, cv_bool(false));
    assert_eq!(result.items[5].value, cv_bool(true));
    // then errors (last in Excel ordering)
    assert_eq!(result.items[6].value, cv_err(CellError::Na));
}

// =========================================================================
// Test 9: Mixed types with errors
// =========================================================================

#[test]
fn mixed_types_with_errors() {
    let data = vec![
        cv_err(CellError::Na),
        cv_err(CellError::Div0),
        cv_err(CellError::Na), // duplicate
        cv_num(10.0),
    ];
    let result = build_filter_dropdown_data(&data, None, None);

    assert_eq!(result.items.len(), 3); // 10, #DIV/0!, #N/A
    assert_eq!(result.items[0].value, cv_num(10.0));
    // Errors sorted by Excel fixed order: #DIV/0! before #N/A
    assert_eq!(result.items[1].value, cv_err(CellError::Div0));
    assert_eq!(result.items[2].value, cv_err(CellError::Na));
    // #N/A count should be 2
    assert_eq!(result.items[2].count, 2);
}

// =========================================================================
// Test 10: Case-insensitive string deduplication
// =========================================================================

#[test]
fn case_insensitive_string_dedup() {
    let data = vec![
        cv_text("Hello"),
        cv_text("hello"),
        cv_text("HELLO"),
        cv_text("World"),
    ];
    let result = build_filter_dropdown_data(&data, None, None);

    assert_eq!(result.items.len(), 2);
    assert_eq!(result.items[0].count, 3); // Hello/hello/HELLO
    assert_eq!(result.items[1].count, 1); // World
}

// =========================================================================
// Test 11: Display text formatting
// =========================================================================

#[test]
fn display_text_formatting() {
    let data = vec![
        cv_num(42.0),
        cv_text("Apple"),
        cv_bool(true),
        cv_err(CellError::Na),
    ];
    let result = build_filter_dropdown_data(&data, None, None);

    assert_eq!(result.items[0].display_text, "42");
    assert_eq!(result.items[1].display_text, "Apple");
    assert_eq!(result.items[2].display_text, "TRUE");
    assert_eq!(result.items[3].display_text, "#N/A");
}

// =========================================================================
// Test 12: Row visibility with blanks
// =========================================================================

#[test]
fn row_visibility_with_blanks() {
    let data = vec![cv_null(), cv_num(1.0), cv_null(), cv_num(2.0)];
    let visibility: Vec<u8> = vec![1, 1, 0, 1];
    let result = build_filter_dropdown_data(&data, None, Some(&visibility));

    assert!(result.has_blank);
    assert_eq!(result.blank_count, 1); // Only row 0 blank is visible
    assert!(result.blank_selected);
    assert_eq!(result.items.len(), 2);
}

// =========================================================================
// Test 13: All blanks
// =========================================================================

#[test]
fn all_blanks() {
    let data = vec![cv_null(), cv_null(), cv_null()];
    let result = build_filter_dropdown_data(&data, None, None);

    assert!(result.has_blank);
    assert_eq!(result.blank_count, 3);
    assert!(result.blank_selected);
    assert_eq!(result.items.len(), 0);
    assert_eq!(result.total_row_count, 3);
}

#[test]
fn blank_selected_truth_table_for_value_filters() {
    let data = vec![cv_null(), cv_text("A"), cv_text("B")];

    let blank_only = make_value_filter(vec![], true);
    let result = build_filter_dropdown_data(&data, Some(&blank_only), None);
    assert!(result.blank_selected);
    assert!(result.items.iter().all(|item| !item.selected));

    let value_plus_blank = make_value_filter(vec![cv_text("A")], true);
    let result = build_filter_dropdown_data(&data, Some(&value_plus_blank), None);
    assert!(result.blank_selected);
    assert!(result
        .items
        .iter()
        .find(|item| item.value == cv_text("A"))
        .unwrap()
        .selected);
    assert!(!result
        .items
        .iter()
        .find(|item| item.value == cv_text("B"))
        .unwrap()
        .selected);

    let value_only = make_value_filter(vec![cv_text("A")], false);
    let result = build_filter_dropdown_data(&data, Some(&value_only), None);
    assert!(!result.blank_selected);

    let empty_value_filter_without_blanks = make_value_filter(vec![], false);
    let result = build_filter_dropdown_data(&data, Some(&empty_value_filter_without_blanks), None);
    assert!(!result.blank_selected);
}

#[test]
fn blank_json_uses_camel_case_selected_field() {
    let data = vec![cv_null(), cv_text("A")];
    let result = build_filter_dropdown_data(&data, None, None);
    let json = serde_json::to_string(&result).unwrap();

    assert!(json.contains("\"hasBlank\":true"));
    assert!(json.contains("\"blankCount\":1"));
    assert!(json.contains("\"blankSelected\":true"));
    assert!(json.contains("\"totalRowCount\":2"));
}

// =========================================================================
// Test 14: Value filter with case-insensitive string matching
// =========================================================================

#[test]
fn value_filter_case_insensitive_selection() {
    let data = vec![cv_text("Apple"), cv_text("banana"), cv_text("Cherry")];
    let filter = make_value_filter(vec![cv_text("apple"), cv_text("cherry")], false);
    let result = build_filter_dropdown_data(&data, Some(&filter), None);

    assert_eq!(result.items.len(), 3);
    let apple = result
        .items
        .iter()
        .find(|i| i.display_text == "Apple")
        .unwrap();
    let banana = result
        .items
        .iter()
        .find(|i| i.display_text == "banana")
        .unwrap();
    let cherry = result
        .items
        .iter()
        .find(|i| i.display_text == "Cherry")
        .unwrap();
    assert!(apple.selected);
    assert!(!banana.selected);
    assert!(cherry.selected);
}
