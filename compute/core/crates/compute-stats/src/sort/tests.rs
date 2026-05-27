use super::in_place::apply_permutation;
use super::natural::compare_numeric_strings;
use super::*;
use crate::types::SortDirection;
use std::cmp::Ordering;
use value_types::{CellError, CellValue};

// ---- compare_cell_values ----

#[test]
fn blanks_always_sort_last_ascending() {
    let config = SortConfig::asc();

    // Null is blank, sorts after everything.
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::number(1.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::Null, &config),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
        Ordering::Equal
    );
}

#[test]
fn blanks_always_sort_last_descending() {
    let config = SortConfig::desc();

    // Even in descending, blanks sort LAST (after all non-blank values).
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::number(1.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::Null, &config),
        Ordering::Less
    );
}

#[test]
fn empty_text_is_blank_sorts_last() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("".into()),
            &CellValue::number(1.0),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn whitespace_only_text_is_blank_sorts_last() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("  ".into()),
            &CellValue::number(1.0),
            &config
        ),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("\t\n".into()),
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn whitespace_only_text_is_blank_sorts_last_descending() {
    let config = SortConfig::desc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("  ".into()),
            &CellValue::number(1.0),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn compares_numbers_correctly() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::number(2.0), &config),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(2.0), &CellValue::number(1.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(&CellValue::number(5.0), &CellValue::number(5.0), &config),
        Ordering::Equal
    );
}

#[test]
fn compares_strings_case_insensitive_by_default() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("apple".into()),
            &CellValue::Text("Banana".into()),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("APPLE".into()),
            &CellValue::Text("apple".into()),
            &config
        ),
        Ordering::Equal
    );
}

#[test]
fn compares_strings_case_sensitive_when_configured() {
    let config = SortConfig {
        case_sensitive: true,
        natural_sort: false,
        ..SortConfig::asc()
    };
    // 'A' (65) < 'a' (97) in ASCII
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("Apple".into()),
            &CellValue::Text("apple".into()),
            &config
        ),
        Ordering::Less
    );
}

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
fn reverses_order_for_desc() {
    let config = SortConfig::desc();
    assert_eq!(
        compare_cell_values(&CellValue::number(1.0), &CellValue::number(2.0), &config),
        Ordering::Greater
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("apple".into()),
            &CellValue::Text("banana".into()),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn handles_booleans() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Boolean(false),
            &CellValue::Boolean(true),
            &config
        ),
        Ordering::Less
    );
    assert_eq!(
        compare_cell_values(
            &CellValue::Boolean(true),
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Greater
    );
}

#[test]
fn handles_errors() {
    let config = SortConfig::asc();
    let e1 = CellValue::Error(CellError::Div0, None);
    let e2 = CellValue::Error(CellError::Value, None);
    assert_eq!(compare_cell_values(&e1, &e2, &config), Ordering::Less);
}

#[test]
fn type_priority_ascending() {
    let config = SortConfig::asc();
    let error = CellValue::Error(CellError::Div0, None);

    // number < text
    assert_eq!(
        compare_cell_values(
            &CellValue::number(1.0),
            &CellValue::Text("a".into()),
            &config
        ),
        Ordering::Less
    );
    // text < boolean
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("a".into()),
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Less
    );
    // boolean < error
    assert_eq!(
        compare_cell_values(&CellValue::Boolean(false), &error, &config),
        Ordering::Less
    );
    // error < blank (null)
    assert_eq!(
        compare_cell_values(&error, &CellValue::Null, &config),
        Ordering::Less
    );
}

#[test]
fn type_priority_stable_in_descending() {
    // In descending mode, type priority does NOT reverse:
    // numbers still before text before booleans before errors, blanks still last.
    let config = SortConfig::desc();
    let error = CellValue::Error(CellError::Div0, None);

    // number still before text (type priority not reversed)
    assert_eq!(
        compare_cell_values(
            &CellValue::number(1.0),
            &CellValue::Text("a".into()),
            &config
        ),
        Ordering::Less
    );
    // text still before boolean
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("a".into()),
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Less
    );
    // boolean still before error
    assert_eq!(
        compare_cell_values(&CellValue::Boolean(false), &error, &config),
        Ordering::Less
    );
    // blanks still last
    assert_eq!(
        compare_cell_values(&error, &CellValue::Null, &config),
        Ordering::Less
    );
}

// ---- sort_values ----

#[test]
fn sorts_numbers_ascending() {
    let mut values = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::number(4.0),
        CellValue::number(1.0),
        CellValue::number(5.0),
        CellValue::number(9.0),
        CellValue::number(2.0),
        CellValue::number(6.0),
    ];
    sort_values(&mut values, &SortConfig::asc());
    let nums: Vec<f64> = values
        .iter()
        .map(|v| match v {
            CellValue::Number(n) => n.get(),
            _ => panic!("expected number"),
        })
        .collect();
    assert_eq!(nums, vec![1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 9.0]);
}

#[test]
fn sorts_numbers_descending() {
    let mut values = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::number(4.0),
        CellValue::number(1.0),
        CellValue::number(5.0),
    ];
    sort_values(&mut values, &SortConfig::desc());
    let nums: Vec<f64> = values
        .iter()
        .map(|v| match v {
            CellValue::Number(n) => n.get(),
            _ => panic!("expected number"),
        })
        .collect();
    assert_eq!(nums, vec![5.0, 4.0, 3.0, 1.0, 1.0]);
}

#[test]
fn sorts_strings_naturally() {
    let mut values = vec![
        CellValue::Text("Item 10".into()),
        CellValue::Text("Item 2".into()),
        CellValue::Text("Item 1".into()),
        CellValue::Text("Item 20".into()),
    ];
    sort_values(&mut values, &SortConfig::asc());
    let strs: Vec<&str> = values
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(strs, vec!["Item 1", "Item 2", "Item 10", "Item 20"]);
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

    // Number < Text < Boolean < Blank (matches Excel)
    assert_eq!(values[0], CellValue::number(1.0));
    assert_eq!(values[1], CellValue::number(2.0));
    assert_eq!(values[2], CellValue::Text("text".into()));
    assert_eq!(values[3], CellValue::Boolean(true));
    assert!(values[4].is_null()); // blank last
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

    // In descending: within-type is reversed, but type priority order is same,
    // and blanks still sort last.
    // Number < Text < Boolean ... then blanks at end
    // Within number descending: 2.0 before 1.0
    // Within text descending: "text" (only non-blank text)
    // Within boolean: true (only one here)
    // Blanks at end: Null and Text("")
    assert_eq!(values[0], CellValue::number(2.0));
    assert_eq!(values[1], CellValue::number(1.0));
    assert_eq!(values[2], CellValue::Text("text".into()));
    assert_eq!(values[3], CellValue::Boolean(true));
    // Last two are blanks (Null and Text("")) — order between blanks is Equal.
}

#[test]
fn empty_input() {
    let mut values: Vec<CellValue> = vec![];
    sort_values(&mut values, &SortConfig::asc());
    assert!(values.is_empty());
}

// ---- sort_by_in_place ----

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
        |i| CellValue::Text(i.name.clone().into()),
        &SortConfig::asc(),
    );
    let names: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
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
        |i| CellValue::number(i.age as f64),
        &SortConfig::desc(),
    );
    let ages: Vec<i32> = items.iter().map(|i| i.age).collect();
    assert_eq!(ages, vec![35, 30, 25]);
}

#[test]
fn sort_by_wrapper_returns_new_vec() {
    let items = vec![
        CellValue::number(3.0),
        CellValue::number(1.0),
        CellValue::number(2.0),
    ];
    let sorted = sort_by(&items, |v| v.clone(), &SortConfig::asc());

    // Original unchanged.
    assert_eq!(items[0], CellValue::number(3.0));
    assert_eq!(items[1], CellValue::number(1.0));
    assert_eq!(items[2], CellValue::number(2.0));
    // Sorted is correct.
    assert_eq!(sorted[0], CellValue::number(1.0));
    assert_eq!(sorted[1], CellValue::number(2.0));
    assert_eq!(sorted[2], CellValue::number(3.0));
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

    // Clone-based sort via wrapper.
    let clone_sorted = sort_by(&original, |v| v.clone(), &config);

    // In-place sort.
    let mut in_place = original.clone();
    sort_by_in_place(&mut in_place, |v| v.clone(), &config);

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

    let clone_sorted = sort_by(&original, |v| v.clone(), &config);
    let mut in_place = original.clone();
    sort_by_in_place(&mut in_place, |v| v.clone(), &config);

    assert_eq!(clone_sorted, in_place);
}

// ---- sort_by_multiple_in_place ----

#[test]
fn sorts_by_multiple_keys() {
    #[derive(Debug, Clone, PartialEq)]
    struct Item {
        dept: String,
        name: String,
    }

    let mut items = vec![
        Item {
            dept: "Sales".into(),
            name: "Bob".into(),
        },
        Item {
            dept: "Engineering".into(),
            name: "Alice".into(),
        },
        Item {
            dept: "Sales".into(),
            name: "Alice".into(),
        },
        Item {
            dept: "Engineering".into(),
            name: "Charlie".into(),
        },
    ];

    let key_configs: Vec<KeyConfig<Item>> = vec![
        KeyConfig {
            key_fn: Box::new(|i: &Item| CellValue::Text(i.dept.clone().into())),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|i: &Item| CellValue::Text(i.name.clone().into())),
            config: SortConfig::asc(),
        },
    ];

    sort_by_multiple_in_place(&mut items, &key_configs);
    let labels: Vec<String> = items
        .iter()
        .map(|i| format!("{}:{}", i.dept, i.name))
        .collect();
    assert_eq!(
        labels,
        vec![
            "Engineering:Alice",
            "Engineering:Charlie",
            "Sales:Alice",
            "Sales:Bob"
        ]
    );
}

#[test]
fn respects_different_directions_for_each_key() {
    #[derive(Debug, Clone, PartialEq)]
    struct Pair {
        x: i32,
        y: i32,
    }

    let mut items = vec![
        Pair { x: 1, y: 1 },
        Pair { x: 1, y: 2 },
        Pair { x: 2, y: 1 },
        Pair { x: 2, y: 2 },
    ];

    let key_configs: Vec<KeyConfig<Pair>> = vec![
        KeyConfig {
            key_fn: Box::new(|i: &Pair| CellValue::number(i.x as f64)),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|i: &Pair| CellValue::number(i.y as f64)),
            config: SortConfig::desc(),
        },
    ];

    sort_by_multiple_in_place(&mut items, &key_configs);
    assert_eq!(
        items,
        vec![
            Pair { x: 1, y: 2 },
            Pair { x: 1, y: 1 },
            Pair { x: 2, y: 2 },
            Pair { x: 2, y: 1 },
        ]
    );
}

// ---- sort_by_custom_order ----

#[test]
fn sorts_by_custom_order() {
    #[derive(Debug, Clone)]
    struct Item {
        priority: String,
    }

    let items = vec![
        Item {
            priority: "low".into(),
        },
        Item {
            priority: "high".into(),
        },
        Item {
            priority: "medium".into(),
        },
        Item {
            priority: "critical".into(),
        },
    ];

    let custom_order = vec![
        CellValue::Text("critical".into()),
        CellValue::Text("high".into()),
        CellValue::Text("medium".into()),
        CellValue::Text("low".into()),
    ];

    let sorted = sort_by_custom_order(
        &items,
        |i| CellValue::Text(i.priority.clone().into()),
        &custom_order,
        &SortConfig::asc(),
    );
    let priorities: Vec<&str> = sorted.iter().map(|i| i.priority.as_str()).collect();
    assert_eq!(priorities, vec!["critical", "high", "medium", "low"]);
}

#[test]
fn items_not_in_custom_order_go_to_end() {
    #[derive(Debug, Clone)]
    struct Item {
        v: String,
    }

    let items = vec![
        Item { v: "x".into() },
        Item { v: "a".into() },
        Item { v: "b".into() },
        Item { v: "y".into() },
    ];

    let custom_order = vec![CellValue::Text("a".into()), CellValue::Text("b".into())];

    let sorted = sort_by_custom_order(
        &items,
        |i| CellValue::Text(i.v.clone().into()),
        &custom_order,
        &SortConfig::asc(),
    );
    let vals: Vec<&str> = sorted.iter().map(|i| i.v.as_str()).collect();
    assert_eq!(vals, vec!["a", "b", "x", "y"]);
}

#[test]
fn case_insensitive_custom_order() {
    #[derive(Debug, Clone)]
    struct Item {
        v: String,
    }

    let items = vec![
        Item { v: "B".into() },
        Item { v: "a".into() },
        Item { v: "C".into() },
    ];

    let custom_order = vec![
        CellValue::Text("A".into()),
        CellValue::Text("B".into()),
        CellValue::Text("C".into()),
    ];

    let sorted = sort_by_custom_order(
        &items,
        |i| CellValue::Text(i.v.clone().into()),
        &custom_order,
        &SortConfig::asc(),
    );
    let vals: Vec<&str> = sorted.iter().map(|i| i.v.as_str()).collect();
    assert_eq!(vals, vec!["a", "B", "C"]);
}

#[test]
fn custom_order_in_place() {
    let mut items = vec![
        CellValue::Text("c".into()),
        CellValue::Text("a".into()),
        CellValue::Text("b".into()),
    ];

    let custom_order = vec![
        CellValue::Text("b".into()),
        CellValue::Text("a".into()),
        CellValue::Text("c".into()),
    ];

    sort_by_custom_order_in_place(&mut items, |v| v.clone(), &custom_order, &SortConfig::asc());
    let vals: Vec<&str> = items
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(vals, vec!["b", "a", "c"]);
}

// ---- get_unique_sorted ----

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
    // Blanks should be last.
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
    let strs: Vec<&str> = unique
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(strs, vec!["high", "medium", "low"]);
}

// ---- natural_compare edge cases ----

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
}

#[test]
fn natural_compare_very_large_numbers() {
    // Numbers exceeding i64::MAX (19 digits) — no overflow.
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
    // 30-digit numbers
    assert_eq!(
        natural_compare(
            "123456789012345678901234567890",
            "123456789012345678901234567891",
            false
        ),
        Ordering::Less
    );
    // Leading zeros
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

// ---- apply_permutation ----

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

// ---- Natural sort correctness ----

#[test]
fn natural_sort_file_names() {
    let mut values = vec![
        CellValue::Text("file10".into()),
        CellValue::Text("file2".into()),
        CellValue::Text("file1".into()),
    ];
    sort_values(&mut values, &SortConfig::asc());
    let strs: Vec<&str> = values
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(strs, vec!["file1", "file2", "file10"]);
}

#[test]
fn natural_sort_embedded_numbers_with_suffix() {
    let mut values = vec![
        CellValue::Text("a1b".into()),
        CellValue::Text("a10b".into()),
        CellValue::Text("a2b".into()),
    ];
    sort_values(&mut values, &SortConfig::asc());
    let strs: Vec<&str> = values
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(strs, vec!["a1b", "a2b", "a10b"]);
}

#[test]
fn natural_sort_pure_number_strings() {
    let mut values = vec![
        CellValue::Text("10".into()),
        CellValue::Text("2".into()),
        CellValue::Text("1".into()),
        CellValue::Text("20".into()),
    ];
    sort_values(&mut values, &SortConfig::asc());
    let strs: Vec<&str> = values
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    assert_eq!(strs, vec!["1", "2", "10", "20"]);
}

#[test]
fn natural_sort_mixed_case_insensitive() {
    // With case_insensitive (default), "File1", "file2", "FILE3" should sort 1, 2, 3.
    assert_eq!(natural_compare("File1", "file2", false), Ordering::Less);
    assert_eq!(natural_compare("file2", "FILE3", false), Ordering::Less);
}

// ---- compare_cell_values type ordering ----

#[test]
fn type_ordering_number_before_text() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::number(999.0),
            &CellValue::Text("a".into()),
            &config
        ),
        Ordering::Less
    );
}

#[test]
fn type_ordering_text_before_boolean() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Text("zzz".into()),
            &CellValue::Boolean(false),
            &config
        ),
        Ordering::Less
    );
}

#[test]
fn type_ordering_boolean_before_error() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Boolean(true),
            &CellValue::Error(CellError::Na, None),
            &config
        ),
        Ordering::Less
    );
}

#[test]
fn type_ordering_error_before_null() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(
            &CellValue::Error(CellError::Na, None),
            &CellValue::Null,
            &config
        ),
        Ordering::Less
    );
}

#[test]
fn type_ordering_null_vs_null() {
    let config = SortConfig::asc();
    assert_eq!(
        compare_cell_values(&CellValue::Null, &CellValue::Null, &config),
        Ordering::Equal
    );
}

// ---- Descending sort ----

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

// ---- sort_by_multiple_in_place: primary asc, secondary desc ----

#[test]
fn multi_key_primary_asc_secondary_desc() {
    #[derive(Debug, Clone, PartialEq)]
    struct Row {
        group: String,
        score: f64,
    }

    let mut items = vec![
        Row {
            group: "B".into(),
            score: 10.0,
        },
        Row {
            group: "A".into(),
            score: 30.0,
        },
        Row {
            group: "A".into(),
            score: 10.0,
        },
        Row {
            group: "B".into(),
            score: 30.0,
        },
        Row {
            group: "A".into(),
            score: 20.0,
        },
    ];

    let key_configs: Vec<KeyConfig<Row>> = vec![
        KeyConfig {
            key_fn: Box::new(|r: &Row| CellValue::Text(r.group.clone().into())),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|r: &Row| CellValue::number(r.score)),
            config: SortConfig::desc(),
        },
    ];

    sort_by_multiple_in_place(&mut items, &key_configs);
    let labels: Vec<String> = items
        .iter()
        .map(|r| format!("{}:{}", r.group, r.score))
        .collect();
    assert_eq!(labels, vec!["A:30", "A:20", "A:10", "B:30", "B:10"]);
}

#[test]
fn multi_key_stability_equal_primary() {
    // Items with equal primary key should maintain secondary key order.
    #[derive(Debug, Clone, PartialEq)]
    struct Row {
        key: i32,
        tag: String,
    }

    let mut items = vec![
        Row {
            key: 1,
            tag: "first".into(),
        },
        Row {
            key: 1,
            tag: "second".into(),
        },
        Row {
            key: 1,
            tag: "third".into(),
        },
    ];

    let key_configs: Vec<KeyConfig<Row>> = vec![
        KeyConfig {
            key_fn: Box::new(|r: &Row| CellValue::number(r.key as f64)),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|r: &Row| CellValue::Text(r.tag.clone().into())),
            config: SortConfig::asc(),
        },
    ];

    sort_by_multiple_in_place(&mut items, &key_configs);
    let tags: Vec<&str> = items.iter().map(|r| r.tag.as_str()).collect();
    assert_eq!(tags, vec!["first", "second", "third"]);
}

// ---- Blank handling ----

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
    // Non-blanks first, sorted ascending.
    assert_eq!(values[0], CellValue::number(1.0));
    assert_eq!(values[1], CellValue::number(2.0));
    // Last 3 are all blanks (Null, "", "  ").
    for v in &values[2..] {
        assert!(
            matches!(v, CellValue::Null) || matches!(v, CellValue::Text(s) if s.trim().is_empty()),
            "expected blank, got {:?}",
            v
        );
    }
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
    // Descending numbers first, then blanks.
    assert_eq!(values[0], CellValue::number(2.0));
    assert_eq!(values[1], CellValue::number(1.0));
    // Last 2 are blanks.
    for v in &values[2..] {
        assert!(
            matches!(v, CellValue::Null) || matches!(v, CellValue::Text(s) if s.trim().is_empty()),
            "expected blank, got {:?}",
            v
        );
    }
}

// ---- get_unique_sorted ----

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
    // "A" and "a" should deduplicate (first seen wins).
    assert_eq!(unique.len(), 2);
    // The result should be sorted.
    let strs: Vec<&str> = unique
        .iter()
        .map(|v| match v {
            CellValue::Text(s) => &**s,
            _ => panic!("expected text"),
        })
        .collect();
    // First seen "A" kept, then "B".
    assert_eq!(strs, vec!["A", "B"]);
}

#[test]
fn public_sort_paths_share_mixed_value_semantics() {
    for config in [SortConfig::asc(), SortConfig::desc()] {
        let values = vec![
            CellValue::Text("Item 10".into()),
            CellValue::Text("item 2".into()),
            CellValue::Null,
            CellValue::number(3.0),
            CellValue::number(1.0),
            CellValue::Text("".into()),
            CellValue::Boolean(false),
        ];

        let mut direct = values.clone();
        sort_values(&mut direct, &config);

        let mut single_key = values.clone();
        sort_by_in_place(&mut single_key, Clone::clone, &config);

        let mut multi_key = values.clone();
        let key_configs: Vec<KeyConfig<CellValue>> = vec![KeyConfig {
            key_fn: Box::new(Clone::clone),
            config,
        }];
        sort_by_multiple_in_place(&mut multi_key, &key_configs);

        assert_eq!(single_key, direct);
        assert_eq!(multi_key, direct);
    }
}
