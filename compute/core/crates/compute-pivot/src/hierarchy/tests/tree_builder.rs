use super::fixtures::*;
use super::*;
use std::collections::HashSet;

#[test]
fn test_aggregated_tree_builder_expanded_tree_indexes_visible_leaf_rows() {
    let field_names = vec!["Region".to_string(), "Product".to_string()];
    let rows = vec![
        make_data_row(
            "east\x00widget",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "east\x00gadget",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header(
                    "east\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(200.0)],
        ),
        make_subtotal_row(
            "east__SUBTOTAL__",
            vec![make_header(
                "east",
                CellValue::Text("East Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(300.0)],
        ),
        make_data_row(
            "west\x00widget",
            vec![
                make_header("west", CellValue::Text("West".into()), "region", 0),
                make_header(
                    "west\x00widget",
                    CellValue::Text("Widget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(150.0)],
        ),
        make_subtotal_row(
            "west__SUBTOTAL__",
            vec![make_header(
                "west",
                CellValue::Text("West Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(150.0)],
        ),
        make_grand_total_row(vec![CellValue::number(450.0)]),
    ];
    let tree = vec![
        make_node(
            "east",
            CellValue::Text("East".into()),
            "region",
            0,
            vec![
                make_node(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "product",
                    1,
                    vec![],
                    Some("east"),
                ),
                make_node(
                    "east\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "product",
                    1,
                    vec![],
                    Some("east"),
                ),
            ],
            None,
        ),
        make_node(
            "west",
            CellValue::Text("West".into()),
            "region",
            0,
            vec![make_node(
                "west\x00widget",
                CellValue::Text("Widget".into()),
                "product",
                1,
                vec![],
                Some("west"),
            )],
            None,
        ),
    ];

    let hierarchy = build_group_hierarchy_from_aggregated_tree(&tree, &rows, &field_names, None);

    assert_eq!(
        hierarchy.children_by_parent.get(&(0, String::new())),
        Some(&vec![0, 1, 3])
    );
    assert_eq!(
        hierarchy.children_by_parent.get(&(1, "east".to_string())),
        Some(&vec![0, 1])
    );
    assert_eq!(
        hierarchy.children_by_parent.get(&(1, "west".to_string())),
        Some(&vec![3])
    );
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "east".to_string())),
        Some(&2)
    );
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "west".to_string())),
        Some(&4)
    );
    assert_eq!(
        hierarchy.row_group_paths[2],
        vec![("region".to_string(), "east".to_string())]
    );
    assert_eq!(
        hierarchy.row_group_paths[4],
        vec![("region".to_string(), "west".to_string())]
    );
    assert!(hierarchy.row_group_paths[5].is_empty());
}

#[test]
fn test_aggregated_tree_builder_collapsed_node_maps_parent_row() {
    let field_names = vec!["Region".to_string(), "Product".to_string()];
    let rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "region",
                0,
            )],
            vec![CellValue::number(300.0)],
        ),
        make_subtotal_row(
            "east__SUBTOTAL__",
            vec![make_header(
                "east",
                CellValue::Text("East Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(300.0)],
        ),
        make_grand_total_row(vec![CellValue::number(300.0)]),
    ];
    let tree = vec![make_node(
        "east",
        CellValue::Text("East".into()),
        "region",
        0,
        vec![make_node(
            "east\x00widget",
            CellValue::Text("Widget".into()),
            "product",
            1,
            vec![],
            Some("east"),
        )],
        None,
    )];
    let expanded = HashSet::new();

    let hierarchy =
        build_group_hierarchy_from_aggregated_tree(&tree, &rows, &field_names, Some(&expanded));

    assert_eq!(
        hierarchy.children_by_parent.get(&(0, String::new())),
        Some(&vec![0])
    );
    assert_eq!(
        hierarchy.row_group_paths[0],
        vec![("region".to_string(), "east".to_string())]
    );
    assert_eq!(hierarchy.position_in_group(1, 0), None);
    assert_eq!(hierarchy.position_in_group(2, 0), None);
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "east".to_string())),
        Some(&1)
    );
}

#[test]
fn test_aggregated_tree_builder_selective_expansion_omits_missing_rows() {
    let field_names = vec!["Region".to_string(), "Product".to_string()];
    let rows = vec![
        make_data_row(
            "east\x00widget",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "product",
                    1,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "west",
            vec![make_header(
                "west",
                CellValue::Text("West".into()),
                "region",
                0,
            )],
            vec![CellValue::number(150.0)],
        ),
        make_grand_total_row(vec![CellValue::number(250.0)]),
    ];
    let tree = vec![
        make_node(
            "east",
            CellValue::Text("East".into()),
            "region_id",
            0,
            vec![
                make_node(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "product_id",
                    1,
                    vec![],
                    Some("east"),
                ),
                make_node(
                    "east\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "product_id",
                    1,
                    vec![],
                    Some("east"),
                ),
            ],
            None,
        ),
        make_node(
            "west",
            CellValue::Text("West".into()),
            "region_id",
            0,
            vec![make_node(
                "west\x00widget",
                CellValue::Text("Widget".into()),
                "product_id",
                1,
                vec![],
                Some("west"),
            )],
            None,
        ),
    ];
    let expanded = HashSet::from(["east".to_string()]);

    let hierarchy =
        build_group_hierarchy_from_aggregated_tree(&tree, &rows, &field_names, Some(&expanded));

    assert_eq!(
        hierarchy.children_by_parent.get(&(0, String::new())),
        Some(&vec![0, 1])
    );
    assert_eq!(
        hierarchy.children_by_parent.get(&(1, "east".to_string())),
        Some(&vec![0])
    );
    assert_eq!(
        hierarchy.children_by_parent.get(&(1, "west".to_string())),
        None
    );
    assert!(hierarchy.subtotal_index.is_empty());
    assert_eq!(
        hierarchy.row_group_paths[0],
        vec![
            ("region_id".to_string(), "east".to_string()),
            ("product_id".to_string(), "east\x00widget".to_string()),
        ]
    );
    assert_eq!(
        hierarchy.row_group_paths[1],
        vec![("region_id".to_string(), "west".to_string())]
    );
    assert!(hierarchy.row_group_paths[2].is_empty());
}
