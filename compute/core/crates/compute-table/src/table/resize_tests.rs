use super::super::types::TableRange;
use super::test_fixtures::make_test_table;
use super::*;

#[test]
fn resize_table_expand_columns() {
    let t = make_test_table();
    let t2 = resize_table(&t, TableRange::new(0, 0, 10, 4)).unwrap();
    assert_eq!(t2.columns.len(), 5);
    assert_eq!(t2.columns[3].name, "Column4");
    assert_eq!(t2.columns[4].name, "Column5");
    for (i, col) in t2.columns.iter().enumerate() {
        assert_eq!(col.index, i as u32);
    }
}

#[test]
fn resize_table_shrink_columns() {
    let t = make_test_table();
    let t2 = resize_table(&t, TableRange::new(0, 0, 10, 1)).unwrap();
    assert_eq!(t2.columns.len(), 2);
    assert_eq!(t2.columns[0].name, "Name");
    assert_eq!(t2.columns[1].name, "Age");
}

#[test]
fn resize_table_same_columns() {
    let t = make_test_table();
    let t2 = resize_table(&t, t.range).unwrap();
    assert_eq!(t2.columns.len(), t.columns.len());
}

#[test]
fn resize_table_with_inverted_range_normalized() {
    let t = make_test_table();

    let row_inverted = resize_table(&t, TableRange::new(10, 0, 5, 2));
    assert!(row_inverted.is_ok());

    let col_inverted = resize_table(&t, TableRange::new(0, 5, 10, 2));
    assert!(col_inverted.is_ok());
}

#[test]
fn resize_table_multi_cycle() {
    let t = make_test_table();

    let t2 = resize_table(&t, TableRange::new(0, 0, 10, 4)).unwrap();
    assert_eq!(t2.columns.len(), 5);
    let ids_after_expand: Vec<String> = t2.columns.iter().map(|c| c.id.clone()).collect();
    assert_eq!(ids_after_expand[0], "TestTable-col-0");
    assert_eq!(ids_after_expand[1], "TestTable-col-1");
    assert_eq!(ids_after_expand[2], "TestTable-col-2");

    let t3 = resize_table(&t2, TableRange::new(0, 0, 10, 1)).unwrap();
    assert_eq!(t3.columns.len(), 2);
    assert_eq!(t3.columns[0].id, "TestTable-col-0");
    assert_eq!(t3.columns[1].id, "TestTable-col-1");

    let t4 = resize_table(&t3, TableRange::new(0, 0, 10, 3)).unwrap();
    assert_eq!(t4.columns.len(), 4);
    assert_eq!(t4.columns[0].id, "TestTable-col-0");
    assert_eq!(t4.columns[1].id, "TestTable-col-1");

    let new_ids: Vec<String> = t4.columns.iter().map(|c| c.id.clone()).collect();
    let unique_ids: std::collections::HashSet<_> = new_ids.iter().collect();
    assert_eq!(unique_ids.len(), 4);
}
