use super::test_fixtures::make_test_table;
use super::*;

#[test]
fn is_position_in_table_inside() {
    let t = make_test_table();
    assert!(is_position_in_table(&t, 0, 0));
    assert!(is_position_in_table(&t, 5, 1));
    assert!(is_position_in_table(&t, 10, 2));
}

#[test]
fn is_position_in_table_outside() {
    let t = make_test_table();
    assert!(!is_position_in_table(&t, 11, 0));
    assert!(!is_position_in_table(&t, 0, 3));
}

#[test]
fn get_column_at_position_valid() {
    let t = make_test_table();
    let col = get_column_at_position(&t, 1).unwrap();
    assert_eq!(col.name, "Age");
}

#[test]
fn get_column_at_position_outside() {
    let t = make_test_table();
    assert!(get_column_at_position(&t, 5).is_none());
}
