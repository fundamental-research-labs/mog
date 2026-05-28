use value_types::{CellError, CellValue};

use super::super::in_place::apply_permutation;
use super::super::{SortConfig, sort_by, sort_by_in_place, sort_values};
use super::fixtures::{assert_blank_suffix, number_values, numbers};

#[test]
fn apply_permutation_identity() {
    let mut items = vec![10, 20, 30];

    apply_permutation(&mut items, &[0, 1, 2]);

    assert_eq!(items, vec![10, 20, 30]);
}

#[test]
fn apply_permutation_reverse() {
    let mut items = vec![10, 20, 30];

    apply_permutation(&mut items, &[2, 1, 0]);

    assert_eq!(items, vec![30, 20, 10]);
}

#[test]
fn apply_permutation_cycle() {
    let mut items = vec![10, 20, 30, 40];

    apply_permutation(&mut items, &[1, 2, 3, 0]);

    assert_eq!(items, vec![20, 30, 40, 10]);
}

#[test]
fn apply_permutation_empty() {
    let mut items: Vec<i32> = vec![];

    apply_permutation(&mut items, &[]);

    assert!(items.is_empty());
}

#[test]
fn sorts_numbers_ascending() {
    let mut values = number_values(&[3.0, 1.0, 4.0, 1.0, 5.0, 9.0, 2.0, 6.0]);

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(
        numbers(&values),
        vec![1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 9.0]
    );
}

#[test]
fn sorts_numbers_descending() {
    let mut values = number_values(&[3.0, 1.0, 4.0, 1.0, 5.0]);

    sort_values(&mut values, &SortConfig::desc());

    assert_eq!(numbers(&values), vec![5.0, 4.0, 3.0, 1.0, 1.0]);
}

#[test]
fn handles_mixed_types_blanks_last() {
    let mut values = vec![
        CellValue::Text("text".into()),
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::Boolean(true),
        CellValue::number(2.0),
    ];

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(values[0], CellValue::number(1.0));
    assert_eq!(values[1], CellValue::number(2.0));
    assert_eq!(values[2], CellValue::Text("text".into()));
    assert_eq!(values[3], CellValue::Boolean(true));
    assert!(values[4].is_null());
}

#[test]
fn mixed_types_blanks_last_descending() {
    let mut values = vec![
        CellValue::Text("text".into()),
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::Boolean(true),
        CellValue::number(2.0),
        CellValue::Text("".into()),
    ];

    sort_values(&mut values, &SortConfig::desc());

    assert_eq!(values[0], CellValue::number(2.0));
    assert_eq!(values[1], CellValue::number(1.0));
    assert_eq!(values[2], CellValue::Text("text".into()));
    assert_eq!(values[3], CellValue::Boolean(true));
    assert_blank_suffix(&values, 4);
}

#[test]
fn empty_input() {
    let mut values: Vec<CellValue> = vec![];

    sort_values(&mut values, &SortConfig::asc());

    assert!(values.is_empty());
}

#[test]
fn descending_sort_blanks_still_last() {
    let mut values = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::Null,
        CellValue::number(2.0),
    ];

    sort_values(&mut values, &SortConfig::desc());

    assert_eq!(values[0], CellValue::number(3.0));
    assert_eq!(values[1], CellValue::number(2.0));
    assert_eq!(values[2], CellValue::number(1.0));
    assert_eq!(values[3], CellValue::Null);
}

#[test]
fn blanks_all_sort_to_end_ascending() {
    let mut values = vec![
        CellValue::Null,
        CellValue::number(1.0),
        CellValue::Text("".into()),
        CellValue::number(2.0),
        CellValue::Text("  ".into()),
    ];

    sort_values(&mut values, &SortConfig::asc());

    assert_eq!(values[0], CellValue::number(1.0));
    assert_eq!(values[1], CellValue::number(2.0));
    assert_blank_suffix(&values, 2);
}

#[test]
fn blanks_all_sort_to_end_descending() {
    let mut values = vec![
        CellValue::Null,
        CellValue::number(1.0),
        CellValue::Text("".into()),
        CellValue::number(2.0),
    ];

    sort_values(&mut values, &SortConfig::desc());

    assert_eq!(values[0], CellValue::number(2.0));
    assert_eq!(values[1], CellValue::number(1.0));
    assert_blank_suffix(&values, 2);
}

#[test]
fn sort_by_in_place_objects_by_key() {
    #[derive(Debug, Clone, PartialEq)]
    struct Person {
        name: String,
        age: i32,
    }

    let mut items = vec![
        Person {
            name: "Charlie".into(),
            age: 30,
        },
        Person {
            name: "Alice".into(),
            age: 25,
        },
        Person {
            name: "Bob".into(),
            age: 35,
        },
    ];

    sort_by_in_place(
        &mut items,
        |item| CellValue::Text(item.name.clone().into()),
        &SortConfig::asc(),
    );

    let names: Vec<&str> = items.iter().map(|item| item.name.as_str()).collect();
    assert_eq!(names, vec!["Alice", "Bob", "Charlie"]);
}

#[test]
fn sort_by_in_place_descending() {
    #[derive(Debug, Clone, PartialEq)]
    struct Person {
        name: String,
        age: i32,
    }

    let mut items = vec![
        Person {
            name: "Charlie".into(),
            age: 30,
        },
        Person {
            name: "Alice".into(),
            age: 25,
        },
        Person {
            name: "Bob".into(),
            age: 35,
        },
    ];

    sort_by_in_place(
        &mut items,
        |item| CellValue::number(item.age as f64),
        &SortConfig::desc(),
    );

    let ages: Vec<i32> = items.iter().map(|item| item.age).collect();
    assert_eq!(ages, vec![35, 30, 25]);
}

#[test]
fn sort_by_wrapper_returns_new_vec() {
    let items = number_values(&[3.0, 1.0, 2.0]);

    let sorted = sort_by(&items, Clone::clone, &SortConfig::asc());

    assert_eq!(numbers(&items), vec![3.0, 1.0, 2.0]);
    assert_eq!(numbers(&sorted), vec![1.0, 2.0, 3.0]);
}

#[test]
fn in_place_sort_matches_clone_sort() {
    let original = vec![
        CellValue::number(3.0),
        CellValue::Text("banana".into()),
        CellValue::Null,
        CellValue::Boolean(false),
        CellValue::number(1.0),
        CellValue::Text("apple".into()),
        CellValue::Error(CellError::Div0, None),
        CellValue::Text("".into()),
    ];
    let config = SortConfig::asc();

    let clone_sorted = sort_by(&original, Clone::clone, &config);
    let mut in_place = original.clone();
    sort_by_in_place(&mut in_place, Clone::clone, &config);

    assert_eq!(clone_sorted, in_place);
}

#[test]
fn in_place_sort_matches_clone_sort_descending() {
    let original = vec![
        CellValue::number(3.0),
        CellValue::Text("banana".into()),
        CellValue::Null,
        CellValue::Boolean(false),
        CellValue::number(1.0),
        CellValue::Text("apple".into()),
        CellValue::Text("  ".into()),
    ];
    let config = SortConfig::desc();

    let clone_sorted = sort_by(&original, Clone::clone, &config);
    let mut in_place = original.clone();
    sort_by_in_place(&mut in_place, Clone::clone, &config);

    assert_eq!(clone_sorted, in_place);
}
