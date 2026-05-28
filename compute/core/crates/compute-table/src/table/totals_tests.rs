use super::*;
use super::super::types::{TableRange, TotalsFunction};
use super::test_fixtures::make_test_table;
use super::super::structured_refs::escape_column_name;
use super::totals::subtotal_function_number;

// ---- Toggle Totals Row ----

#[test]
fn toggle_totals_row_on() {
    let t = make_test_table(); // no totals
    let t2 = toggle_totals_row(&t);
    assert!(t2.has_totals_row);
    assert_eq!(t2.range.end_row(), t.range.end_row() + 1);
}

#[test]
fn toggle_totals_row_off() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    let t2 = toggle_totals_row(&t);
    assert!(!t2.has_totals_row);
    assert_eq!(t2.range.end_row(), t.range.end_row() - 1);
}

#[test]
fn toggle_totals_row_off_end_row_zero_no_underflow() {
    let mut t = make_test_table();
    t.has_totals_row = true;
    t.range = TableRange::new(
        t.range.start_row(),
        t.range.start_col(),
        0,
        t.range.end_col(),
    );
    let t2 = toggle_totals_row(&t);
    assert!(!t2.has_totals_row);
    assert_eq!(t2.range.end_row(), 0); // saturates at 0, no underflow
}


// ---- Totals Function ----

#[test]
fn set_totals_function_basic() {
    let t = make_test_table();
    let t2 = set_totals_function(&t, "TestTable-col-1", TotalsFunction::Sum);
    assert_eq!(t2.columns[1].totals_function, Some(TotalsFunction::Sum));
    // Other columns unchanged
    assert_eq!(t2.columns[0].totals_function, None);
}


// ---- Subtotal Formula Generation ----

#[test]
fn get_subtotal_formula_sum() {
    let f = get_subtotal_formula(&TotalsFunction::Sum, "Sales").unwrap();
    assert_eq!(f, "=SUBTOTAL(109,[Sales])");
}

#[test]
fn get_subtotal_formula_average() {
    let f = get_subtotal_formula(&TotalsFunction::Average, "Score").unwrap();
    assert_eq!(f, "=SUBTOTAL(101,[Score])");
}

#[test]
fn get_subtotal_formula_count() {
    let f = get_subtotal_formula(&TotalsFunction::Count, "C").unwrap();
    assert_eq!(f, "=SUBTOTAL(102,[C])");
}

#[test]
fn get_subtotal_formula_none_returns_none() {
    assert!(get_subtotal_formula(&TotalsFunction::None, "C").is_none());
}

#[test]
fn get_subtotal_formula_custom_returns_none() {
    assert!(get_subtotal_formula(&TotalsFunction::Custom, "C").is_none());
}


// ---- Column Name Escaping ----

#[test]
fn escape_column_name_no_special_chars() {
    assert_eq!(escape_column_name("Sales"), "Sales");
}

#[test]
fn escape_column_name_with_single_quote() {
    assert_eq!(escape_column_name("John's"), "'John''s'");
}

#[test]
fn escape_column_name_with_brackets() {
    assert_eq!(escape_column_name("Data[1]"), "'Data[[1]]'");
}

#[test]
fn escape_column_name_with_hash() {
    assert_eq!(escape_column_name("Col#1"), "'Col#1'");
}

#[test]
fn escape_column_name_with_at() {
    assert_eq!(escape_column_name("@mention"), "'@mention'");
}


// ---- Subtotal function number mapping ----

#[test]
fn subtotal_function_number_all_mappings() {
    assert_eq!(
        subtotal_function_number(&TotalsFunction::Average),
        Some(101)
    );
    assert_eq!(subtotal_function_number(&TotalsFunction::Count), Some(102));
    assert_eq!(
        subtotal_function_number(&TotalsFunction::CountNums),
        Some(103)
    );
    assert_eq!(subtotal_function_number(&TotalsFunction::Max), Some(104));
    assert_eq!(subtotal_function_number(&TotalsFunction::Min), Some(105));
    assert_eq!(subtotal_function_number(&TotalsFunction::StdDev), Some(107));
    assert_eq!(subtotal_function_number(&TotalsFunction::Sum), Some(109));
    assert_eq!(subtotal_function_number(&TotalsFunction::Var), Some(110));
    assert_eq!(subtotal_function_number(&TotalsFunction::Custom), None);
    assert_eq!(subtotal_function_number(&TotalsFunction::None), None);
}


// ---- toggle_totals_row overflow guard ----

#[test]
fn toggle_totals_row_on_max_row_no_overflow() {
    let mut t = make_test_table();
    t.range = TableRange::new(
        t.range.start_row(),
        t.range.start_col(),
        u32::MAX,
        t.range.end_col(),
    );
    let t2 = toggle_totals_row(&t);
    assert!(t2.has_totals_row);
    assert_eq!(t2.range.end_row(), u32::MAX); // saturates, no overflow
}
