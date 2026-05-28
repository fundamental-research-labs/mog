use super::super::types::{Table, TableRange};
use super::*;

fn tables_overlap(a: &Table, b: &Table) -> bool {
    if a.range.end_col() < b.range.start_col() || a.range.start_col() > b.range.end_col() {
        return false;
    }
    if a.range.end_row() < b.range.start_row() || a.range.start_row() > b.range.end_row() {
        return false;
    }
    true
}

#[test]
fn tables_overlap_true() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 3),
        &["A", "B", "C", "D"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(3, 2, 8, 5),
        &["E", "F", "G", "H"],
        None,
    )
    .unwrap();
    assert!(tables_overlap(&a, &b));
    assert!(tables_overlap(&b, &a));
}

#[test]
fn tables_overlap_false_no_col_overlap() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 2),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(0, 3, 5, 5),
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(!tables_overlap(&a, &b));
}

#[test]
fn tables_overlap_false_no_row_overlap() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 2),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(6, 0, 10, 2),
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(!tables_overlap(&a, &b));
}

#[test]
fn tables_overlap_adjacent_edges_are_overlapping() {
    let a = create_table(
        "A",
        "s1",
        TableRange::new(0, 0, 5, 2),
        &["A", "B", "C"],
        None,
    )
    .unwrap();
    let b = create_table(
        "B",
        "s1",
        TableRange::new(5, 0, 10, 2),
        &["D", "E", "F"],
        None,
    )
    .unwrap();
    assert!(tables_overlap(&a, &b));
}
