use super::*;
use crate::types::TableColorFilter;
use domain_types::CellFormat;
use value_types::{CellError, Color, FiniteF64};

// -- Helper ---------------------------------------------------------------

fn cv_num(n: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(n))
}

fn cv_text(s: &str) -> CellValue {
    CellValue::Text(s.into())
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

fn cv_nan() -> CellValue {
    CellValue::number(f64::NAN)
}

fn make_value_filter(included: Vec<CellValue>, include_blanks: bool) -> FilterCriteria {
    FilterCriteria::Values(ValueFilter {
        included,
        include_blanks,
    })
}

fn make_condition_filter(
    conditions: Vec<TableFilterCondition>,
    logic: FilterLogic,
) -> FilterCriteria {
    FilterCriteria::Condition(ConditionFilter { conditions, logic })
}

fn make_cond(op: FilterOperator, value: CellValue) -> TableFilterCondition {
    TableFilterCondition {
        operator: op,
        value,
        value2: None,
    }
}

fn make_cond2(op: FilterOperator, value: CellValue, value2: CellValue) -> TableFilterCondition {
    TableFilterCondition {
        operator: op,
        value,
        value2: Some(value2),
    }
}

fn eval(criteria: &FilterCriteria, data: &[CellValue]) -> Vec<u8> {
    evaluate_column_filter(criteria, data, None, None, None)
}

/// Helper: evaluate a color filter against per-row formats.
fn eval_color(criteria: &FilterCriteria, data: &[CellValue], formats: &[CellFormat]) -> Vec<u8> {
    evaluate_column_filter(criteria, data, Some(formats), None, None)
}

/// Build a CellFormat with only a background_color hex set.
fn fmt_fill(hex: &str) -> CellFormat {
    CellFormat {
        background_color: Some(hex.to_string()),
        ..CellFormat::default()
    }
}

/// Build a CellFormat with only a font_color hex set.
fn fmt_font(hex: &str) -> CellFormat {
    CellFormat {
        font_color: Some(hex.to_string()),
        ..CellFormat::default()
    }
}

/// Build a CellFormat with no color set (default).
fn fmt_default() -> CellFormat {
    CellFormat::default()
}

// =========================================================================
// FilterState CRUD
// =========================================================================

#[test]
fn test_create_filter_state() {
    let state = create_filter_state();
    assert!(state.filters.is_empty());
}

#[test]
fn test_set_column_filter() {
    let state = create_filter_state();
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(2.0)], false);
    let state = set_column_filter(&state, "colA", criteria);
    assert_eq!(state.filters.len(), 1);
    assert!(state.filters.contains_key("colA"));
}

#[test]
fn test_set_column_filter_replaces() {
    let state = create_filter_state();
    let c1 = make_value_filter(vec![cv_num(1.0)], false);
    let c2 = make_value_filter(vec![cv_num(2.0)], true);
    let state = set_column_filter(&state, "colA", c1);
    let state = set_column_filter(&state, "colA", c2);
    assert_eq!(state.filters.len(), 1);
    if let Some(FilterCriteria::Values(vf)) = state.filters.get("colA") {
        assert!(vf.include_blanks);
    } else {
        panic!("Expected ValueFilter");
    }
}

#[test]
fn test_set_column_filter_immutability() {
    let state1 = create_filter_state();
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let state2 = set_column_filter(&state1, "colA", criteria);
    assert!(state1.filters.is_empty());
    assert_eq!(state2.filters.len(), 1);
}

#[test]
fn test_clear_column_filter() {
    let state = create_filter_state();
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    let state = set_column_filter(&state, "colB", make_value_filter(vec![cv_num(2.0)], false));
    let state = clear_column_filter(&state, "colA");
    assert_eq!(state.filters.len(), 1);
    assert!(!state.filters.contains_key("colA"));
    assert!(state.filters.contains_key("colB"));
}

#[test]
fn test_clear_column_filter_nonexistent() {
    let state = create_filter_state();
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    let state2 = clear_column_filter(&state, "nonexistent");
    assert_eq!(state2.filters.len(), 1);
}

#[test]
fn test_clear_all_filters() {
    let state = create_filter_state();
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    let state = set_column_filter(&state, "colB", make_value_filter(vec![cv_num(2.0)], false));
    let state = clear_all_filters(&state);
    assert!(state.filters.is_empty());
}

#[test]
fn test_get_column_filter() {
    let state = create_filter_state();
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let state = set_column_filter(&state, "colA", criteria);
    assert!(get_column_filter(&state, "colA").is_some());
    assert!(get_column_filter(&state, "colB").is_none());
}

#[test]
fn test_has_active_filters() {
    let state = create_filter_state();
    assert!(!has_active_filters(&state));
    let state = set_column_filter(&state, "colA", make_value_filter(vec![cv_num(1.0)], false));
    assert!(has_active_filters(&state));
}

#[test]
fn test_multiple_independent_filters() {
    let state = create_filter_state();
    let ca = make_value_filter(vec![cv_num(1.0), cv_num(2.0)], false);
    let cb = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(10.0))],
        FilterLogic::And,
    );
    let state = set_column_filter(&state, "colA", ca);
    let state = set_column_filter(&state, "colB", cb);
    assert_eq!(state.filters.len(), 2);
}

// =========================================================================
// ValueFilter
// =========================================================================

#[test]
fn test_value_filter_include_specific() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(3.0), cv_num(5.0)], false);
    let data = vec![
        cv_num(1.0),
        cv_num(2.0),
        cv_num(3.0),
        cv_num(4.0),
        cv_num(5.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 1]);
}

#[test]
fn test_value_filter_exclude_blanks() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(2.0)], false);
    let data = vec![cv_num(1.0), cv_null(), cv_num(2.0), cv_null(), cv_num(3.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 0]);
}

#[test]
fn test_value_filter_include_blanks() {
    let criteria = make_value_filter(vec![cv_num(1.0)], true);
    let data = vec![cv_num(1.0), cv_null(), cv_num(2.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1]);
}

#[test]
fn test_value_filter_case_insensitive_strings() {
    let criteria = make_value_filter(vec![cv_text("apple"), cv_text("BANANA")], false);
    let data = vec![
        cv_text("Apple"),
        cv_text("banana"),
        cv_text("Cherry"),
        cv_text("APPLE"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1]);
}

#[test]
fn test_value_filter_booleans() {
    let criteria = make_value_filter(vec![cv_bool(true)], false);
    let data = vec![cv_bool(true), cv_bool(false), cv_bool(true), cv_bool(false)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0]);
}

#[test]
fn test_value_filter_errors() {
    let criteria = make_value_filter(vec![cv_err(CellError::Div0)], false);
    let data = vec![
        cv_err(CellError::Div0),
        cv_err(CellError::Na),
        cv_num(42.0),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0]);
}

#[test]
fn test_value_filter_empty_included_with_blanks() {
    let criteria = make_value_filter(vec![], true);
    let data = vec![cv_num(1.0), cv_null(), cv_text("text"), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 0, 1]);
}

#[test]
fn test_value_filter_empty_included_no_blanks() {
    let criteria = make_value_filter(vec![], false);
    let data = vec![cv_num(1.0), cv_null(), cv_text("text")];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0]);
}

#[test]
fn test_value_filter_nan() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_nan(), cv_text("hello")], false);
    let data = vec![
        cv_num(1.0),
        cv_nan(),
        cv_text("hello"),
        cv_num(2.0),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 0, 0]);
}

#[test]
fn test_value_filter_nan_not_in_list() {
    let criteria = make_value_filter(vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)], false);
    let data = vec![cv_num(1.0), cv_nan(), cv_num(3.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1]);
}

// =========================================================================
// ConditionFilter
// =========================================================================

#[test]
fn test_condition_equals() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Equals, cv_num(42.0))],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(42.0),
        cv_num(43.0),
        cv_num(42.0),
        cv_null(),
        cv_num(0.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 0]);
}

#[test]
fn test_condition_not_equals() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotEquals, cv_num(42.0))],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(42.0),
        cv_num(43.0),
        cv_num(42.0),
        cv_null(),
        cv_num(0.0),
    ];
    // blanks return true for notEquals
    assert_eq!(eval(&criteria, &data), vec![0, 1, 0, 1, 1]);
}

#[test]
fn test_condition_greater_than() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(10.0),
        cv_null(),
        cv_num(100.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 1, 0, 1]);
}

#[test]
fn test_condition_greater_than_or_equal() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThanOrEqual, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(1.0), cv_num(5.0), cv_num(10.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 1, 0]);
}

#[test]
fn test_condition_less_than() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::LessThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(1.0), cv_num(5.0), cv_num(10.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0]);
}

#[test]
fn test_condition_less_than_or_equal() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::LessThanOrEqual, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(1.0), cv_num(5.0), cv_num(10.0), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0]);
}

#[test]
fn test_condition_begins_with() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::BeginsWith, cv_text("he"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("Hello"),
        cv_text("help"),
        cv_text("world"),
        cv_null(),
        cv_text("HE"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0, 1]);
}

#[test]
fn test_condition_ends_with() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::EndsWith, cv_text("LD"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("world"),
        cv_text("BOLD"),
        cv_text("hello"),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0]);
}

#[test]
fn test_condition_contains() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Contains, cv_text("or"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("world"),
        cv_text("more"),
        cv_text("hello"),
        cv_null(),
        cv_text("WORD"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 0, 1]);
}

#[test]
fn test_condition_not_contains() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotContains, cv_text("or"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("world"),
        cv_text("more"),
        cv_text("hello"),
        cv_null(),
    ];
    // blanks return true for notContains
    assert_eq!(eval(&criteria, &data), vec![0, 0, 1, 1]);
}

#[test]
fn test_condition_between() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
        cv_null(),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 1, 1, 0, 0]);
}

#[test]
fn test_condition_not_between() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
        cv_null(),
    ];
    // Blanks return true for notBetween
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0, 1, 1]);
}

#[test]
fn test_condition_and_logic() {
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::GreaterThan, cv_num(5.0)),
            make_cond(FilterOperator::LessThan, cv_num(15.0)),
        ],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(10.0),
        cv_num(15.0),
        cv_num(20.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 1, 0, 0]);
}

#[test]
fn test_condition_or_logic() {
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::Equals, cv_num(1.0)),
            make_cond(FilterOperator::Equals, cv_num(5.0)),
        ],
        FilterLogic::Or,
    );
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(5.0), cv_num(10.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0]);
}

#[test]
fn test_condition_empty_conditions() {
    let criteria = make_condition_filter(vec![], FilterLogic::And);
    let data = vec![cv_num(1.0), cv_null(), cv_text("text")];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_is_blank() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::IsBlank, cv_null())],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_null(),
        cv_text("text"),
        cv_null(),
        cv_bool(true),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 0, 1, 0]);
}

#[test]
fn test_is_not_blank() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::IsNotBlank, cv_null())],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_null(),
        cv_text("text"),
        cv_null(),
        cv_bool(true),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 1]);
}

#[test]
fn test_is_blank_combined_or() {
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::IsBlank, cv_null()),
            make_cond(FilterOperator::Equals, cv_num(42.0)),
        ],
        FilterLogic::Or,
    );
    let data = vec![
        cv_num(42.0),
        cv_null(),
        cv_num(10.0),
        cv_null(),
        cv_num(42.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1, 1]);
}

// =========================================================================
// Between edge cases
// =========================================================================

#[test]
fn test_between_null_value2() {
    let criteria = make_condition_filter(
        vec![make_cond2(FilterOperator::Between, cv_num(5.0), cv_null())],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0, 0, 0]);
}

#[test]
fn test_not_between_null_value2() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_null(),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 1, 1]);
}

#[test]
fn test_between_reversed_bounds() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_num(10.0),
            cv_num(5.0),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(1.0),
        cv_num(5.0),
        cv_num(7.0),
        cv_num(10.0),
        cv_num(15.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0, 0, 0]);
}

#[test]
fn test_between_with_strings() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_text("b"),
            cv_text("d"),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("a"),
        cv_text("b"),
        cv_text("c"),
        cv_text("d"),
        cv_text("e"),
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 1, 1, 1, 0]);
}

// =========================================================================
// Type mismatch / notBetween
// =========================================================================

#[test]
fn test_not_between_string_vs_number() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![cv_text("hello")];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_not_between_bool_vs_number() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![cv_bool(true)];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_not_between_blanks_return_true() {
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_num(5.0),
            cv_num(10.0),
        )],
        FilterLogic::And,
    );
    let data = vec![cv_null(), cv_num(7.0), cv_num(3.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1]);
}

// =========================================================================
// NaN handling
// =========================================================================

#[test]
fn test_nan_not_match_greater_than() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![0]);
}

#[test]
fn test_nan_not_match_greater_than_or_equal() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThanOrEqual, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![0]);
}

#[test]
fn test_nan_equals_nan_as_error() {
    // cv_nan() → Error(Num). Errors of same type are equal in filter context.
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Equals, cv_nan())],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_nan_matches_not_equals() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotEquals, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_nan_matches_is_not_blank() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::IsNotBlank, cv_null())],
        FilterLogic::And,
    );
    let data = vec![cv_nan()];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_error_not_contains_matching() {
    // cv_nan() → Error(Num). "#NUM!" does not contain "Na".
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotContains, cv_text("Na"))],
        FilterLogic::And,
    );
    let data = vec![cv_nan(), cv_text("hello"), cv_num(42.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_nan_not_contains_non_matching() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::NotContains, cv_text("hello"))],
        FilterLogic::And,
    );
    let data = vec![cv_nan(), cv_text("hello world"), cv_num(42.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1]);
}

// =========================================================================
// String operators on numbers
// =========================================================================

#[test]
fn test_begins_with_on_numbers() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::BeginsWith, cv_text("1"))],
        FilterLogic::And,
    );
    let data = vec![cv_num(100.0), cv_num(200.0), cv_num(15.0), cv_num(1.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 1]);
}

#[test]
fn test_contains_on_numbers() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Contains, cv_text("2"))],
        FilterLogic::And,
    );
    let data = vec![cv_num(12.0), cv_num(23.0), cv_num(45.0), cv_num(200.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 0, 1]);
}

// =========================================================================
// Condition equals with string (case-insensitive via compare_values)
// =========================================================================

#[test]
fn test_condition_equals_string_case_insensitive() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::Equals, cv_text("Hello"))],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("hello"),
        cv_text("HELLO"),
        cv_text("Hello"),
        cv_text("world"),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 0]);
}

// =========================================================================
// Color filter (per-row evaluation against CellFormat slice)
// =========================================================================

/// When the caller doesn't supply per-row formats, color filters fall back to
/// all-pass. This is the historical "engine doesn't have format access" path —
/// kept for the pure FFI bridge that doesn't carry format context.
#[test]
fn test_color_filter_no_formats_is_all_pass() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: Some(Color::rgb(255, 0, 0)),
        font_color: None,
    });
    let data = vec![cv_num(1.0), cv_text("hello"), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

/// Yellow fill matches yellow request; white fill does not.
#[test]
fn test_color_filter_fill_matches_only_same_hex() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: Some(Color::rgb(0xff, 0xff, 0x00)),
        font_color: None,
    });
    let data = vec![cv_num(1.0), cv_num(2.0), cv_num(3.0)];
    let formats = vec![
        fmt_fill("#FFFF00"), // yellow uppercase
        fmt_fill("#ffff00"), // yellow lowercase — case-insensitive match
        fmt_fill("#FFFFFF"), // white — does not match
    ];
    assert_eq!(eval_color(&criteria, &data, &formats), vec![1, 1, 0]);
}

/// Font-color filter is independent of fill: a yellow-fill cell with black
/// font should not match a request for red font.
#[test]
fn test_color_filter_font_independent_of_fill() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: None,
        font_color: Some(Color::rgb(0xff, 0x00, 0x00)),
    });
    let data = vec![cv_text("a"), cv_text("b"), cv_text("c")];
    let formats = vec![
        // Yellow fill but no font color — should not match red-font request
        fmt_fill("#FFFF00"),
        // Red font, no fill — should match
        fmt_font("#FF0000"),
        // Red fill, no font — should not match a font filter
        fmt_fill("#FF0000"),
    ];
    assert_eq!(eval_color(&criteria, &data, &formats), vec![0, 1, 0]);
}

/// A cell with no fill set (default white background) is *not* a wildcard for
/// any non-default request. Excel filters by the displayed color; an unstyled
/// cell does not match a "yellow fill" filter.
#[test]
fn test_color_filter_default_fill_is_distinct() {
    let criteria = FilterCriteria::Color(TableColorFilter {
        cell_color: Some(Color::rgb(0xff, 0xff, 0x00)),
        font_color: None,
    });
    let data = vec![cv_num(1.0), cv_num(2.0)];
    let formats = vec![
        fmt_default(), // unstyled — must not match
        fmt_fill("#FFFF00"),
    ];
    assert_eq!(eval_color(&criteria, &data, &formats), vec![0, 1]);
}

// =========================================================================
// TopBottom filter (delegates to filter_resolve)
// =========================================================================

#[test]
fn test_top_bottom_top_3() {
    use super::super::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 3.0,
        by: TopBottomBy::Items,
    });
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![0, 1, 1, 0, 1]);
}

#[test]
fn test_top_bottom_bottom_2() {
    use super::super::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Bottom,
        count: 2.0,
        by: TopBottomBy::Items,
    });
    let data = vec![
        cv_num(10.0),
        cv_num(50.0),
        cv_num(30.0),
        cv_num(20.0),
        cv_num(40.0),
    ];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![1, 0, 0, 1, 0]);
}

#[test]
fn test_top_bottom_duplicate_boundary_selects_exactly_n() {
    use super::super::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    });
    let data = vec![cv_num(10.0), cv_num(10.0), cv_num(10.0)];
    let bitmap = eval(&criteria, &data);
    let visible_count: u8 = bitmap.iter().sum();
    assert_eq!(visible_count, 2);
}

#[test]
fn test_top_bottom_non_numeric_excluded() {
    use super::super::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 2.0,
        by: TopBottomBy::Items,
    });
    let data = vec![
        cv_num(10.0),
        cv_text("text"),
        cv_null(),
        cv_num(50.0),
        cv_num(30.0),
    ];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![0, 0, 0, 1, 1]);
}

#[test]
fn test_top_bottom_all_non_numeric() {
    use super::super::types::{TableTopBottomFilter, TopBottomBy, TopBottomDirection};
    let criteria = FilterCriteria::TopBottom(TableTopBottomFilter {
        direction: TopBottomDirection::Top,
        count: 3.0,
        by: TopBottomBy::Items,
    });
    let data = vec![cv_text("a"), cv_text("b"), cv_null()];
    let bitmap = eval(&criteria, &data);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

// =========================================================================
// Dynamic filter
// =========================================================================

#[test]
fn test_dynamic_above_average() {
    use super::super::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    });
    // Average of [10, 20, 30, 40, 50] = 30
    // BUG FIX: uses >= so 30 IS included
    let data = vec![
        cv_num(10.0),
        cv_num(20.0),
        cv_num(30.0),
        cv_num(40.0),
        cv_num(50.0),
    ];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    // Above average (>= 30): 30, 40, 50
    assert_eq!(bitmap, vec![0, 0, 1, 1, 1]);
}

#[test]
fn test_dynamic_below_average() {
    use super::super::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::BelowAverage,
    });
    // Average = 30
    // BUG FIX: uses <= so 30 IS included
    let data = vec![
        cv_num(10.0),
        cv_num(20.0),
        cv_num(30.0),
        cv_num(40.0),
        cv_num(50.0),
    ];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    // Below average (<= 30): 10, 20, 30
    assert_eq!(bitmap, vec![1, 1, 1, 0, 0]);
}

#[test]
fn test_dynamic_above_average_ignores_non_numeric() {
    use super::super::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    });
    // Numeric values: 10, 20, 30. Average = 20.
    let data = vec![
        cv_num(10.0),
        cv_text("text"),
        cv_num(20.0),
        cv_null(),
        cv_num(30.0),
    ];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    // Above average (>= 20): 20, 30
    assert_eq!(bitmap, vec![0, 0, 1, 0, 1]);
}

#[test]
fn test_dynamic_below_average_all_non_numeric() {
    use super::super::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::BelowAverage,
    });
    let data = vec![cv_text("a"), cv_null(), cv_text("b")];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    assert_eq!(bitmap, vec![0, 0, 0]);
}

// =========================================================================
// Edge cases
// =========================================================================

#[test]
fn test_empty_column_data() {
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let bitmap = eval(&criteria, &[]);
    assert!(bitmap.is_empty());
}

#[test]
fn test_all_blanks_exclude() {
    let criteria = make_value_filter(vec![cv_num(1.0)], false);
    let data = vec![cv_null(), cv_null(), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0]);
}

#[test]
fn test_all_blanks_include() {
    let criteria = make_value_filter(vec![], true);
    let data = vec![cv_null(), cv_null(), cv_null()];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_all_same_value() {
    let criteria = make_value_filter(vec![cv_num(42.0)], false);
    let data = vec![cv_num(42.0), cv_num(42.0), cv_num(42.0)];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1]);
}

#[test]
fn test_single_row_match() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(5.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(10.0)];
    assert_eq!(eval(&criteria, &data), vec![1]);
}

#[test]
fn test_single_row_no_match() {
    let criteria = make_condition_filter(
        vec![make_cond(FilterOperator::GreaterThan, cv_num(50.0))],
        FilterLogic::And,
    );
    let data = vec![cv_num(10.0)];
    assert_eq!(eval(&criteria, &data), vec![0]);
}

#[test]
fn test_mixed_types_value_filter() {
    let criteria = make_value_filter(vec![cv_num(42.0), cv_text("hello"), cv_bool(true)], false);
    let data = vec![
        cv_num(42.0),
        cv_text("HELLO"),
        cv_bool(true),
        cv_bool(false),
        cv_text("world"),
        cv_null(),
        cv_num(43.0),
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 1, 1, 0, 0, 0, 0]);
}

#[test]
fn test_dynamic_above_average_single_value() {
    use super::super::types::{DynamicFilter, DynamicFilterRule};
    let criteria = FilterCriteria::Dynamic(DynamicFilter {
        rule: DynamicFilterRule::AboveAverage,
    });
    // Average of [10] = 10. With >= fix, 10 IS included.
    let data = vec![cv_num(10.0)];
    let now = chrono::NaiveDate::from_ymd_opt(2024, 6, 15);
    let bitmap = evaluate_column_filter(&criteria, &data, None, now, None);
    assert_eq!(bitmap, vec![1]);
}

// =========================================================================
// Additional quality tests
// =========================================================================

#[test]
fn test_not_between_with_strings() {
    // NotBetween operator with string values: strings outside [b, d] pass.
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::NotBetween,
            cv_text("b"),
            cv_text("d"),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_text("a"), // < "b" -> outside -> true
        cv_text("b"), // == lower bound -> inside -> false
        cv_text("c"), // inside -> false
        cv_text("d"), // == upper bound -> inside -> false
        cv_text("e"), // > "d" -> outside -> true
        cv_null(),    // blank -> true (negative operator)
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 0, 0, 1, 1]);
}

#[test]
fn test_condition_or_mixed_types() {
    // OR mode with (greaterThan 5) OR (contains "text") on a mixed column.
    // greaterThan 5 only matches numbers > 5. contains "text" matches strings.
    let criteria = make_condition_filter(
        vec![
            make_cond(FilterOperator::GreaterThan, cv_num(5.0)),
            make_cond(FilterOperator::Contains, cv_text("text")),
        ],
        FilterLogic::Or,
    );
    let data = vec![
        cv_num(10.0),         // > 5 -> true
        cv_num(3.0),          // not > 5, not a string -> false
        cv_text("some text"), // contains "text" -> true
        cv_text("hello"),     // does not contain "text" -> false
        cv_null(),            // blank: greaterThan -> false, contains -> false => false
        cv_num(6.0),          // > 5 -> true
        cv_text("TEXTBOOK"),  // contains "text" (case-insensitive) -> true
    ];
    assert_eq!(eval(&criteria, &data), vec![1, 0, 1, 0, 0, 1, 1]);
}

#[test]
fn test_between_type_mismatch_value2() {
    // Between where value and value1 are numbers but value2 is text.
    // The value-vs-value2 type check should fail since Number(7) and Text("z")
    // have different type ranks, so the between check returns false.
    let criteria = make_condition_filter(
        vec![make_cond2(
            FilterOperator::Between,
            cv_num(5.0),
            cv_text("z"),
        )],
        FilterLogic::And,
    );
    let data = vec![
        cv_num(7.0),  // types_compatible(7, 5) OK, but types_compatible(7, "z") -> false
        cv_num(3.0),  // < 5, but also type mismatch on value2 -> false
        cv_num(10.0), // type mismatch on value2 -> false
        cv_text("m"), // types_compatible("m", 5) -> false -> false
    ];
    assert_eq!(eval(&criteria, &data), vec![0, 0, 0, 0]);
}
