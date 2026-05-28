use crate::types::SortDirection;
use value_types::CellValue;

use super::super::get_unique_sorted;
use super::fixtures::texts;

#[test]
fn returns_unique_sorted_values() {
    let values = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::number(2.0),
        CellValue::number(1.0),
        CellValue::number(3.0),
        CellValue::number(2.0),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(
        unique,
        vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ]
    );
}

#[test]
fn case_insensitive_deduplication() {
    let values = vec![
        CellValue::Text("Apple".into()),
        CellValue::Text("banana".into()),
        CellValue::Text("APPLE".into()),
        CellValue::Text("Banana".into()),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(unique.len(), 2);
}

#[test]
fn blanks_last_in_unique_sorted() {
    let values = vec![
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::number(2.0),
        CellValue::Null,
        CellValue::number(3.0),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(
        unique,
        vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
            CellValue::Null,
        ]
    );
}

#[test]
fn get_unique_sorted_with_custom_list() {
    let values = vec![
        CellValue::Text("low".into()),
        CellValue::Text("high".into()),
        CellValue::Text("medium".into()),
        CellValue::Text("high".into()),
    ];
    let custom = vec!["high".to_string(), "medium".to_string(), "low".to_string()];

    let unique = get_unique_sorted(&values, SortDirection::Asc, Some(&custom));

    assert_eq!(texts(&unique), vec!["high", "medium", "low"]);
}

#[test]
fn get_unique_sorted_deduplicates() {
    let values = vec![
        CellValue::Text("apple".into()),
        CellValue::Text("banana".into()),
        CellValue::Text("apple".into()),
        CellValue::Text("cherry".into()),
        CellValue::Text("banana".into()),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(unique.len(), 3);
}

#[test]
fn get_unique_sorted_sorts_result() {
    let values = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::number(2.0),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(
        unique,
        vec![
            CellValue::number(1.0),
            CellValue::number(2.0),
            CellValue::number(3.0),
        ]
    );
}

#[test]
fn get_unique_sorted_case_insensitive_dedup() {
    let values = vec![
        CellValue::Text("A".into()),
        CellValue::Text("a".into()),
        CellValue::Text("B".into()),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(unique.len(), 2);
    assert_eq!(texts(&unique), vec!["A", "B"]);
}

#[test]
fn first_seen_representative_retained_for_text_duplicates() {
    let values = vec![
        CellValue::Text("Beta".into()),
        CellValue::Text("ALPHA".into()),
        CellValue::Text("alpha".into()),
        CellValue::Text("beta".into()),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(texts(&unique), vec!["ALPHA", "Beta"]);
}

#[test]
fn first_seen_blank_representative_retained() {
    let values = vec![
        CellValue::Text("  ".into()),
        CellValue::Null,
        CellValue::Text("".into()),
        CellValue::number(1.0),
    ];

    let unique = get_unique_sorted(&values, SortDirection::Asc, None);

    assert_eq!(unique[0], CellValue::number(1.0));
    assert_eq!(unique[1], CellValue::Text("  ".into()));
}

#[test]
fn custom_list_ordering_after_deduplication() {
    let values = vec![
        CellValue::Text("medium".into()),
        CellValue::Text("LOW".into()),
        CellValue::Text("low".into()),
        CellValue::Text("high".into()),
    ];
    let custom = vec!["high".to_string(), "medium".to_string(), "low".to_string()];

    let unique = get_unique_sorted(&values, SortDirection::Asc, Some(&custom));

    assert_eq!(texts(&unique), vec!["high", "medium", "LOW"]);
}
