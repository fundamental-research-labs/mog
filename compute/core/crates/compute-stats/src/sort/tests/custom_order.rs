use value_types::CellValue;

use super::super::{
    SortConfig, sort_by_custom_order, sort_by_custom_order_in_place, sort_by_in_place,
};
use super::fixtures::{text_values, texts};

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
    let custom_order = text_values(&["critical", "high", "medium", "low"]);

    let sorted = sort_by_custom_order(
        &items,
        |item| CellValue::Text(item.priority.clone().into()),
        &custom_order,
        &SortConfig::asc(),
    );

    let priorities: Vec<&str> = sorted.iter().map(|item| item.priority.as_str()).collect();
    assert_eq!(priorities, vec!["critical", "high", "medium", "low"]);
}

#[test]
fn items_not_in_custom_order_go_to_end() {
    #[derive(Debug, Clone)]
    struct Item {
        value: String,
    }

    let items = vec![
        Item { value: "x".into() },
        Item { value: "a".into() },
        Item { value: "b".into() },
        Item { value: "y".into() },
    ];
    let custom_order = text_values(&["a", "b"]);

    let sorted = sort_by_custom_order(
        &items,
        |item| CellValue::Text(item.value.clone().into()),
        &custom_order,
        &SortConfig::asc(),
    );

    let values: Vec<&str> = sorted.iter().map(|item| item.value.as_str()).collect();
    assert_eq!(values, vec!["a", "b", "x", "y"]);
}

#[test]
fn case_insensitive_custom_order() {
    #[derive(Debug, Clone)]
    struct Item {
        value: String,
    }

    let items = vec![
        Item { value: "B".into() },
        Item { value: "a".into() },
        Item { value: "C".into() },
    ];
    let custom_order = text_values(&["A", "B", "C"]);

    let sorted = sort_by_custom_order(
        &items,
        |item| CellValue::Text(item.value.clone().into()),
        &custom_order,
        &SortConfig::asc(),
    );

    let values: Vec<&str> = sorted.iter().map(|item| item.value.as_str()).collect();
    assert_eq!(values, vec!["a", "B", "C"]);
}

#[test]
fn custom_order_in_place() {
    let mut items = text_values(&["c", "a", "b"]);
    let custom_order = text_values(&["b", "a", "c"]);

    sort_by_custom_order_in_place(&mut items, Clone::clone, &custom_order, &SortConfig::asc());

    assert_eq!(texts(&items), vec!["b", "a", "c"]);
}

#[test]
fn custom_order_clone_and_in_place_match() {
    let items = text_values(&["low", "high", "medium", "other"]);
    let custom_order = text_values(&["high", "medium", "low"]);

    let sorted = sort_by_custom_order(&items, Clone::clone, &custom_order, &SortConfig::asc());
    let mut in_place = items.clone();
    sort_by_custom_order_in_place(
        &mut in_place,
        Clone::clone,
        &custom_order,
        &SortConfig::asc(),
    );

    assert_eq!(sorted, in_place);
    assert_eq!(texts(&items), vec!["low", "high", "medium", "other"]);
}

#[test]
fn descending_does_not_reverse_custom_list_indices() {
    let mut items = text_values(&["low", "high", "medium"]);
    let custom_order = text_values(&["high", "medium", "low"]);

    sort_by_custom_order_in_place(&mut items, Clone::clone, &custom_order, &SortConfig::desc());

    assert_eq!(texts(&items), vec!["high", "medium", "low"]);
}

#[test]
fn desc_affects_only_non_custom_fallback_items() {
    let mut items = text_values(&["custom", "Item 2", "Item 10", "alpha"]);
    let custom_order = text_values(&["custom"]);

    sort_by_custom_order_in_place(&mut items, Clone::clone, &custom_order, &SortConfig::desc());

    assert_eq!(texts(&items), vec!["custom", "Item 10", "Item 2", "alpha"]);
}

#[test]
fn empty_custom_order_matches_in_place_standard_sort() {
    let values = text_values(&["Item 10", "item 2", "alpha"]);
    let custom_order = vec![];
    let config = SortConfig::asc();

    let mut custom_sorted = values.clone();
    sort_by_custom_order_in_place(&mut custom_sorted, Clone::clone, &custom_order, &config);

    let mut standard_sorted = values.clone();
    sort_by_in_place(&mut standard_sorted, Clone::clone, &config);

    assert_eq!(custom_sorted, standard_sorted);
}
