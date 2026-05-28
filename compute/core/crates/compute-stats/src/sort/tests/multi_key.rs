use value_types::CellValue;

use super::super::{KeyConfig, SortConfig, sort_by_multiple_in_place, sort_values};

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
            key_fn: Box::new(|item: &Item| CellValue::Text(item.dept.clone().into())),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|item: &Item| CellValue::Text(item.name.clone().into())),
            config: SortConfig::asc(),
        },
    ];

    sort_by_multiple_in_place(&mut items, &key_configs);

    let labels: Vec<String> = items
        .iter()
        .map(|item| format!("{}:{}", item.dept, item.name))
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
            key_fn: Box::new(|item: &Pair| CellValue::number(item.x as f64)),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|item: &Pair| CellValue::number(item.y as f64)),
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
            key_fn: Box::new(|row: &Row| CellValue::Text(row.group.clone().into())),
            config: SortConfig::asc(),
        },
        KeyConfig {
            key_fn: Box::new(|row: &Row| CellValue::number(row.score)),
            config: SortConfig::desc(),
        },
    ];

    sort_by_multiple_in_place(&mut items, &key_configs);

    let labels: Vec<String> = items
        .iter()
        .map(|row| format!("{}:{}", row.group, row.score))
        .collect();
    assert_eq!(labels, vec!["A:30", "A:20", "A:10", "B:30", "B:10"]);
}

#[test]
fn multi_key_stability_equal_key_tuple() {
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
    let key_configs: Vec<KeyConfig<Row>> = vec![KeyConfig {
        key_fn: Box::new(|row: &Row| CellValue::number(row.key as f64)),
        config: SortConfig::asc(),
    }];

    sort_by_multiple_in_place(&mut items, &key_configs);

    let tags: Vec<&str> = items.iter().map(|row| row.tag.as_str()).collect();
    assert_eq!(tags, vec!["first", "second", "third"]);
}

#[test]
fn single_key_matches_sort_values() {
    let mut direct = vec![
        CellValue::Text("Item 10".into()),
        CellValue::Text("item 2".into()),
        CellValue::number(2.0),
        CellValue::number(1.0),
        CellValue::Null,
    ];
    let mut multi_key = direct.clone();
    let config = SortConfig::asc();
    let key_configs: Vec<KeyConfig<CellValue>> = vec![KeyConfig {
        key_fn: Box::new(Clone::clone),
        config: config.clone(),
    }];

    sort_values(&mut direct, &config);
    sort_by_multiple_in_place(&mut multi_key, &key_configs);

    assert_eq!(multi_key, direct);
}
