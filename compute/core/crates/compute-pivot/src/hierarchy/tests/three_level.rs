use super::fixtures::*;
use super::*;

#[test]
fn test_three_level_hierarchy() {
    let field_names = vec![
        "Region".to_string(),
        "State".to_string(),
        "City".to_string(),
    ];

    let rows = vec![
        // Row 0: East / NY / NYC
        make_data_row(
            "east\x00ny\x00nyc",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header("east\x00ny", CellValue::Text("NY".into()), "state", 1),
                make_header(
                    "east\x00ny\x00nyc",
                    CellValue::Text("NYC".into()),
                    "city",
                    2,
                ),
            ],
            vec![CellValue::number(500.0)],
        ),
        // Row 1: East / NY / Buffalo
        make_data_row(
            "east\x00ny\x00buf",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header("east\x00ny", CellValue::Text("NY".into()), "state", 1),
                make_header(
                    "east\x00ny\x00buf",
                    CellValue::Text("Buffalo".into()),
                    "city",
                    2,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        // Row 2: East / NY subtotal
        make_subtotal_row(
            "east\x00ny__SUBTOTAL__",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header("east\x00ny", CellValue::Text("NY Total".into()), "state", 1),
            ],
            1,
            vec![CellValue::number(600.0)],
        ),
        // Row 3: East / CT / Hartford
        make_data_row(
            "east\x00ct\x00hart",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header("east\x00ct", CellValue::Text("CT".into()), "state", 1),
                make_header(
                    "east\x00ct\x00hart",
                    CellValue::Text("Hartford".into()),
                    "city",
                    2,
                ),
            ],
            vec![CellValue::number(80.0)],
        ),
        // Row 4: East / CT subtotal
        make_subtotal_row(
            "east\x00ct__SUBTOTAL__",
            vec![
                make_header("east", CellValue::Text("East".into()), "region", 0),
                make_header("east\x00ct", CellValue::Text("CT Total".into()), "state", 1),
            ],
            1,
            vec![CellValue::number(80.0)],
        ),
        // Row 5: East subtotal
        make_subtotal_row(
            "east__SUBTOTAL__",
            vec![make_header(
                "east",
                CellValue::Text("East Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(680.0)],
        ),
        // Row 6: West / CA / LA
        make_data_row(
            "west\x00ca\x00la",
            vec![
                make_header("west", CellValue::Text("West".into()), "region", 0),
                make_header("west\x00ca", CellValue::Text("CA".into()), "state", 1),
                make_header("west\x00ca\x00la", CellValue::Text("LA".into()), "city", 2),
            ],
            vec![CellValue::number(400.0)],
        ),
        // Row 7: West / CA subtotal
        make_subtotal_row(
            "west\x00ca__SUBTOTAL__",
            vec![
                make_header("west", CellValue::Text("West".into()), "region", 0),
                make_header("west\x00ca", CellValue::Text("CA Total".into()), "state", 1),
            ],
            1,
            vec![CellValue::number(400.0)],
        ),
        // Row 8: West subtotal
        make_subtotal_row(
            "west__SUBTOTAL__",
            vec![make_header(
                "west",
                CellValue::Text("West Total".into()),
                "region",
                0,
            )],
            0,
            vec![CellValue::number(400.0)],
        ),
        // Row 9: Grand total
        make_grand_total_row(vec![CellValue::number(1080.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Verify depth and field names
    assert_eq!(hierarchy.depth(), 3);
    assert!(!hierarchy.is_flat());
    assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
    assert_eq!(hierarchy.depth_for_field("State"), Some(1));
    assert_eq!(hierarchy.depth_for_field("City"), Some(2));

    // Verify children at depth 0 (root): all data rows [0, 1, 3, 6]
    let root_children = hierarchy
        .children_by_parent
        .get(&(0, String::new()))
        .unwrap();
    assert_eq!(root_children, &[0, 1, 3, 6]);

    // Verify children at depth 1 under "east": [0, 1, 3]
    let east_children = hierarchy
        .children_by_parent
        .get(&(1, "east".to_string()))
        .unwrap();
    assert_eq!(east_children, &[0, 1, 3]);

    // Verify children at depth 1 under "west": [6]
    let west_children = hierarchy
        .children_by_parent
        .get(&(1, "west".to_string()))
        .unwrap();
    assert_eq!(west_children, &[6]);

    // Verify children at depth 2 under "east\x00ny": [0, 1]
    let east_ny_children = hierarchy
        .children_by_parent
        .get(&(2, "east\x00ny".to_string()))
        .unwrap();
    assert_eq!(east_ny_children, &[0, 1]);

    // Verify children at depth 2 under "east\x00ct": [3]
    let east_ct_children = hierarchy
        .children_by_parent
        .get(&(2, "east\x00ct".to_string()))
        .unwrap();
    assert_eq!(east_ct_children, &[3]);

    // Verify children at depth 2 under "west\x00ca": [6]
    let west_ca_children = hierarchy
        .children_by_parent
        .get(&(2, "west\x00ca".to_string()))
        .unwrap();
    assert_eq!(west_ca_children, &[6]);

    // Verify subtotals
    // East/NY subtotal at depth 1 -> row 2
    assert_eq!(
        hierarchy.subtotal_index.get(&(1, "east\x00ny".to_string())),
        Some(&2)
    );
    // East/CT subtotal at depth 1 -> row 4
    assert_eq!(
        hierarchy.subtotal_index.get(&(1, "east\x00ct".to_string())),
        Some(&4)
    );
    // East subtotal at depth 0 -> row 5
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "east".to_string())),
        Some(&5)
    );
    // West/CA subtotal at depth 1 -> row 7
    assert_eq!(
        hierarchy.subtotal_index.get(&(1, "west\x00ca".to_string())),
        Some(&7)
    );
    // West subtotal at depth 0 -> row 8
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "west".to_string())),
        Some(&8)
    );

    // Verify siblings at different depths
    // NYC (row 0) and Buffalo (row 1) are siblings at depth 2 under east/ny
    assert_eq!(hierarchy.siblings_at_depth(0, 2), Some([0, 1].as_slice()));
    assert_eq!(hierarchy.siblings_at_depth(1, 2), Some([0, 1].as_slice()));

    // Hartford (row 3) is alone at depth 2 under east/ct
    assert_eq!(hierarchy.siblings_at_depth(3, 2), Some([3].as_slice()));

    // LA (row 6) is alone at depth 2 under west/ca
    assert_eq!(hierarchy.siblings_at_depth(6, 2), Some([6].as_slice()));

    // At depth 1 under east: [0, 1, 3]
    assert_eq!(
        hierarchy.siblings_at_depth(0, 1),
        Some([0, 1, 3].as_slice())
    );
    assert_eq!(
        hierarchy.siblings_at_depth(3, 1),
        Some([0, 1, 3].as_slice())
    );

    // At depth 1 under west: [6]
    assert_eq!(hierarchy.siblings_at_depth(6, 1), Some([6].as_slice()));

    // Previous/next at depth 2
    assert_eq!(hierarchy.previous_sibling(1, 2), Some(0)); // Buffalo -> NYC
    assert_eq!(hierarchy.next_sibling(0, 2), Some(1)); // NYC -> Buffalo
    assert_eq!(hierarchy.previous_sibling(0, 2), None); // NYC is first
    assert_eq!(hierarchy.next_sibling(1, 2), None); // Buffalo is last

    // Previous/next at depth 1 under east
    assert_eq!(hierarchy.next_sibling(0, 1), Some(1)); // NYC -> Buffalo
    assert_eq!(hierarchy.next_sibling(1, 1), Some(3)); // Buffalo -> Hartford
    assert_eq!(hierarchy.next_sibling(3, 1), None); // Hartford is last under east

    // find_sibling_by_value at depth 2
    let found = hierarchy.find_sibling_by_value(1, 2, &rows, &CellValue::Text("NYC".into()));
    assert_eq!(found, Some(0));

    // find_sibling_by_value should NOT find across parent groups
    // LA (row 6) looking for "NYC" at depth 2 -> None (different parent)
    let found = hierarchy.find_sibling_by_value(6, 2, &rows, &CellValue::Text("NYC".into()));
    assert_eq!(found, None);

    // subtotal_at_depth
    // NYC (row 0) -> East subtotal at depth 0 (row 5)
    assert_eq!(hierarchy.subtotal_at_depth(0, 0), Some(5));
    // NYC (row 0) -> East/NY subtotal at depth 1 (row 2)
    assert_eq!(hierarchy.subtotal_at_depth(0, 1), Some(2));
    // Hartford (row 3) -> East/CT subtotal at depth 1 (row 4)
    assert_eq!(hierarchy.subtotal_at_depth(3, 1), Some(4));
    // LA (row 6) -> West/CA subtotal at depth 1 (row 7)
    assert_eq!(hierarchy.subtotal_at_depth(6, 1), Some(7));
    // LA (row 6) -> West subtotal at depth 0 (row 8)
    assert_eq!(hierarchy.subtotal_at_depth(6, 0), Some(8));
}

// ---- Empty rows ----
