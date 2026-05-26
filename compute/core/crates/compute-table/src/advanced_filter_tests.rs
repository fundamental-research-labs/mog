use super::*;
use value_types::CellValue;

fn text(value: &str) -> CellValue {
    CellValue::Text(value.into())
}

fn num(value: f64) -> CellValue {
    CellValue::number(value)
}

fn lit(value: CellValue) -> AdvancedFilterCriteriaCell {
    AdvancedFilterCriteriaCell::literal(value)
}

fn table() -> AdvancedFilterTable {
    AdvancedFilterTable::new(
        vec!["Name".into(), "Age".into(), "Dept".into()],
        vec![
            vec![text("Alice"), num(30.0), text("Sales")],
            vec![text("Bob"), num(22.0), text("Support")],
            vec![text("Alicia"), num(28.0), text("Sales")],
            vec![text("Carol"), num(41.0), CellValue::Null],
            vec![text("Alice"), num(30.0), text("Sales")],
        ],
    )
}

fn criteria(headers: &[&str], rows: Vec<Vec<CellValue>>) -> AdvancedFilterCriteria {
    AdvancedFilterCriteria::new(
        headers.iter().map(|header| (*header).to_string()).collect(),
        rows.into_iter()
            .map(|row| row.into_iter().map(lit).collect())
            .collect(),
    )
}

fn included(criteria: Option<&AdvancedFilterCriteria>, unique_records_only: bool) -> Vec<bool> {
    evaluate_advanced_filter(
        &table(),
        criteria,
        &AdvancedFilterOptions {
            unique_records_only,
        },
    )
    .unwrap()
    .into_iter()
    .map(|result| result.included)
    .collect()
}

#[test]
fn exact_text_criteria_match_case_insensitive_header_and_value() {
    let criteria = criteria(&["name"], vec![vec![text("alice")]]);

    assert_eq!(
        included(Some(&criteria), false),
        vec![true, false, false, false, true]
    );
}

#[test]
fn comparison_criteria_match_numbers() {
    let criteria = criteria(&["Age"], vec![vec![text(">30")]]);

    assert_eq!(
        included(Some(&criteria), false),
        vec![false, false, false, true, false]
    );
}

#[test]
fn multiple_criteria_rows_are_or() {
    let criteria = criteria(
        &["Name", "Dept"],
        vec![
            vec![text("Bob"), CellValue::Null],
            vec![CellValue::Null, text("Sales")],
        ],
    );

    assert_eq!(
        included(Some(&criteria), false),
        vec![true, true, true, false, true]
    );
}

#[test]
fn repeated_criteria_headers_compose_for_same_list_column() {
    let criteria = criteria(&["Age", "Age"], vec![vec![text(">20"), text("<30")]]);

    assert_eq!(
        included(Some(&criteria), false),
        vec![false, true, true, false, false]
    );
}

#[test]
fn wildcard_criteria_support_star_and_question_mark() {
    let starts_with_ali = criteria(&["Name"], vec![vec![text("Ali*")]]);
    let three_letters = criteria(&["Name"], vec![vec![text("???")]]);

    assert_eq!(
        included(Some(&starts_with_ali), false),
        vec![true, false, true, false, true]
    );
    assert_eq!(
        included(Some(&three_letters), false),
        vec![false, true, false, false, false]
    );
}

#[test]
fn blank_and_nonblank_criteria_are_explicit() {
    let blank = criteria(&["Dept"], vec![vec![text("=")]]);
    let nonblank = criteria(&["Dept"], vec![vec![text("<>")]]);

    assert_eq!(
        included(Some(&blank), false),
        vec![false, false, false, true, false]
    );
    assert_eq!(
        included(Some(&nonblank), false),
        vec![true, true, true, false, true]
    );
}

#[test]
fn no_criteria_matches_all_rows() {
    assert_eq!(included(None, false), vec![true, true, true, true, true]);

    let headers_only = AdvancedFilterCriteria::new(vec!["Name".into()], Vec::new());
    assert_eq!(
        included(Some(&headers_only), false),
        vec![true, true, true, true, true]
    );
}

#[test]
fn unique_records_dedupes_by_full_row_tuple_after_criteria_match() {
    let results = evaluate_advanced_filter(
        &table(),
        None,
        &AdvancedFilterOptions {
            unique_records_only: true,
        },
    )
    .unwrap();

    assert_eq!(
        results
            .iter()
            .map(|result| result.included)
            .collect::<Vec<_>>(),
        vec![true, true, true, true, false]
    );
    assert_eq!(
        results
            .iter()
            .map(|result| result.is_duplicate)
            .collect::<Vec<_>>(),
        vec![false, false, false, false, true]
    );
    assert!(results.iter().all(|result| result.matches_criteria));
}

#[test]
fn formula_criteria_return_typed_unsupported_error() {
    let criteria = AdvancedFilterCriteria::new(
        vec!["Name".into()],
        vec![vec![AdvancedFilterCriteriaCell::formula(text(
            "=A2=\"Alice\"",
        ))]],
    );

    let error =
        evaluate_advanced_filter(&table(), Some(&criteria), &AdvancedFilterOptions::default())
            .unwrap_err();

    assert_eq!(
        error,
        AdvancedFilterError::UnsupportedFormulaCriteria {
            criteria_row: 0,
            criteria_column: 0,
        }
    );
}
