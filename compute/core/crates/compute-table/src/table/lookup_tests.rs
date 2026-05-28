use super::test_fixtures::make_test_table;
use super::*;

// ---- get_column_by_name ----

#[test]
fn get_column_by_name_found() {
    let t = make_test_table();
    let col = get_column_by_name(&t, "Age").unwrap();
    assert_eq!(col.name, "Age");
    assert_eq!(col.index, 1);
}

#[test]
fn get_column_by_name_case_insensitive() {
    let t = make_test_table();
    let col = get_column_by_name(&t, "age").unwrap();
    assert_eq!(col.name, "Age");
    let col2 = get_column_by_name(&t, "AGE").unwrap();
    assert_eq!(col2.name, "Age");
}

#[test]
fn get_column_by_name_not_found() {
    let t = make_test_table();
    assert!(get_column_by_name(&t, "Missing").is_none());
}

// ---- get_column_by_id ----

#[test]
fn get_column_by_id_found() {
    let t = make_test_table();
    let col = get_column_by_id(&t, "TestTable-col-1").unwrap();
    assert_eq!(col.name, "Age");
}

#[test]
fn get_column_by_id_not_found() {
    let t = make_test_table();
    assert!(get_column_by_id(&t, "nonexistent").is_none());
}
