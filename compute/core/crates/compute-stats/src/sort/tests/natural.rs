use std::cmp::Ordering;

use value_types::CellValue;

use super::super::natural::compare_numeric_strings;
use super::super::{SortConfig, compare_cell_values, natural_compare, sort_values};
use super::fixtures::{text_values, texts};

#[test]
fn natural_sort_for_strings_with_numbers() {
    let config = SortConfig::asc();

    assert_eq!(
        compare_cell_values(
            &CellValue::Text("Item 2".into()),
            &CellValue::Text("Item 10".into()),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("Item 10".into()),
            &CellValue::Text("Item 2".into()),
            &config
        ),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("Item 10".into()),
            &CellValue::Text("Item 10".into()),
            &config
        ),
        Ordering::Equal
    );
}

#[test]
fn sorts_strings_naturally() {
    let mut values = text_values(&["Item 10", "Item 2", "Item 1", "Item 20"]);

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(
        texts(&values),
        vec!["Item 1", "Item 2", "Item 10", "Item 20"]
    );
}

#[test]
fn natural_compare_pure_text() {
    assert_eq!(natural_compare("apple", "banana", false), Ordering::Less);
    assert_eq!(natural_compare("banana", "apple", false), Ordering::Greater);
    assert_eq!(natural_compare("apple", "apple", false), Ordering::Equal);
}

#[test]
fn natural_compare_pure_numbers() {
    assert_eq!(natural_compare("2", "10", false), Ordering::Less);
    assert_eq!(natural_compare("10", "2", false), Ordering::Greater);
    assert_eq!(natural_compare("10", "10", false), Ordering::Equal);
}

#[test]
fn natural_compare_mixed_chunks() {
    assert_eq!(
        natural_compare("file1.txt", "file2.txt", false),
        Ordering::Less
    );
    assert_eq!(
        natural_compare("file10.txt", "file2.txt", false),
        Ordering::Greater
    );
    assert_eq!(
        natural_compare("file1.txt", "file1.txt", false),
        Ordering::Equal
    );
}

#[test]
fn natural_compare_empty_strings() {
    assert_eq!(natural_compare("", "", false), Ordering::Equal);
    assert_eq!(natural_compare("", "a", false), Ordering::Less);
    assert_eq!(natural_compare("a", "", false), Ordering::Greater);
}

#[test]
fn natural_compare_case_insensitive() {
    assert_eq!(natural_compare("Item 2", "item 10", false), Ordering::Less);
    assert_eq!(natural_compare("APPLE", "apple", false), Ordering::Equal);
}

#[test]
fn natural_compare_case_sensitive() {
    assert_eq!(natural_compare("Apple", "apple", true), Ordering::Less);
}

#[test]
fn natural_compare_very_large_numbers() {
    assert_eq!(
        natural_compare(
            "Item 99999999999999999999",
            "Item 100000000000000000000",
            false
        ),
        Ordering::Less
    );
    assert_eq!(
        natural_compare(
            "Item 100000000000000000000",
            "Item 99999999999999999999",
            false
        ),
        Ordering::Greater
    );
    assert_eq!(
        natural_compare(
            "Item 99999999999999999998",
            "Item 99999999999999999999",
            false
        ),
        Ordering::Less
    );
    assert_eq!(
        natural_compare(
            "Item 99999999999999999999",
            "Item 99999999999999999999",
            false
        ),
        Ordering::Equal
    );
    assert_eq!(
        natural_compare(
            "123456789012345678901234567890",
            "123456789012345678901234567891",
            false
        ),
        Ordering::Less
    );
    assert_eq!(
        natural_compare("file 007", "file 7", false),
        Ordering::Equal
    );
    assert_eq!(
        natural_compare("file 009", "file 10", false),
        Ordering::Less
    );
}

#[test]
fn compare_numeric_strings_basic() {
    assert_eq!(compare_numeric_strings("2", "10"), Ordering::Less);
    assert_eq!(compare_numeric_strings("10", "2"), Ordering::Greater);
    assert_eq!(compare_numeric_strings("10", "10"), Ordering::Equal);
    assert_eq!(compare_numeric_strings("007", "7"), Ordering::Equal);
    assert_eq!(compare_numeric_strings("0", "0"), Ordering::Equal);
    assert_eq!(compare_numeric_strings("000", "0"), Ordering::Equal);
    assert_eq!(compare_numeric_strings("1", "2"), Ordering::Less);
}

#[test]
fn natural_sort_file_names() {
    let mut values = text_values(&["file10", "file2", "file1"]);

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(texts(&values), vec!["file1", "file2", "file10"]);
}

#[test]
fn natural_sort_embedded_numbers_with_suffix() {
    let mut values = text_values(&["a1b", "a10b", "a2b"]);

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(texts(&values), vec!["a1b", "a2b", "a10b"]);
}

#[test]
fn natural_sort_pure_number_strings() {
    let mut values = text_values(&["10", "2", "1", "20"]);

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(texts(&values), vec!["1", "2", "10", "20"]);
}

#[test]
fn natural_sort_mixed_case_insensitive() {
    assert_eq!(natural_compare("File1", "file2", false), Ordering::Less);
    assert_eq!(natural_compare("file2", "FILE3", false), Ordering::Less);
}
