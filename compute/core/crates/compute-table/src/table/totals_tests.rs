use super::super::types::{TableRange, TotalsFunction};
use super::test_fixtures::make_test_table;
use super::totals::subtotal_function_number;
use super::*;

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

#[test]
fn toggle_totals_row_with_end_row_zero() {
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
    assert_eq!(t2.range.end_row(), 0);
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
fn get_subtotal_formula_escapes_column_name() {
    let f = get_subtotal_formula(&TotalsFunction::Sum, "John's").unwrap();
    assert_eq!(f, "=SUBTOTAL(109,['John''s'])");
}

#[test]
fn get_subtotal_formula_none_returns_none() {
    assert!(get_subtotal_formula(&TotalsFunction::None, "C").is_none());
}

#[test]
fn get_subtotal_formula_custom_returns_none() {
    assert!(get_subtotal_formula(&TotalsFunction::Custom, "C").is_none());
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
