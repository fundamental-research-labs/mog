use super::fixtures::*;
use super::*;

#[test]
fn test_empty_rows_empty_hierarchy() {
    let rows: Vec<PivotRow> = vec![];
    let field_names: Vec<String> = vec![];
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert!(hierarchy.row_group_paths.is_empty());
    assert!(hierarchy.subtotal_index.is_empty());
    assert!(hierarchy.children_by_parent.is_empty());
    assert!(hierarchy.field_names.is_empty());
    assert_eq!(hierarchy.depth(), 0);
    assert!(hierarchy.is_flat());
}

// ---- Single row ----

#[test]
fn test_single_data_row() {
    let field_names = vec!["Region".to_string()];
    let rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "region",
                0,
            )],
            vec![CellValue::number(100.0)],
        ),
        make_grand_total_row(vec![CellValue::number(100.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Single data row at depth 0
    assert_eq!(
        hierarchy
            .children_by_parent
            .get(&(0, String::new()))
            .unwrap(),
        &[0]
    );

    // Position in group
    assert_eq!(hierarchy.position_in_group(0, 0), Some((0, 1)));

    // First and last
    assert!(hierarchy.is_first_in_group(0, 0));
    assert!(hierarchy.is_last_in_group(0, 0));

    // No siblings
    assert_eq!(hierarchy.previous_sibling(0, 0), None);
    assert_eq!(hierarchy.next_sibling(0, 0), None);
}

// ---- Flat hierarchy (single-level) ----

#[test]
fn test_flat_hierarchy_is_flat() {
    let field_names = vec!["Region".to_string()];
    let rows = vec![
        make_data_row(
            "east",
            vec![make_header(
                "east",
                CellValue::Text("East".into()),
                "region",
                0,
            )],
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
            vec![CellValue::number(200.0)],
        ),
        make_data_row(
            "north",
            vec![make_header(
                "north",
                CellValue::Text("North".into()),
                "region",
                0,
            )],
            vec![CellValue::number(300.0)],
        ),
        make_grand_total_row(vec![CellValue::number(600.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert!(hierarchy.is_flat());
    assert_eq!(hierarchy.depth(), 1);

    // All data rows are siblings at depth 0
    assert_eq!(
        hierarchy.siblings_at_depth(0, 0),
        Some([0, 1, 2].as_slice())
    );

    // Navigation at depth 0
    assert_eq!(hierarchy.next_sibling(0, 0), Some(1));
    assert_eq!(hierarchy.next_sibling(1, 0), Some(2));
    assert_eq!(hierarchy.next_sibling(2, 0), None);
    assert_eq!(hierarchy.previous_sibling(0, 0), None);
    assert_eq!(hierarchy.previous_sibling(1, 0), Some(0));
    assert_eq!(hierarchy.previous_sibling(2, 0), Some(1));
}

// ---- No field names (zero-level) ----

#[test]
fn test_zero_field_names() {
    let field_names: Vec<String> = vec![];
    let rows = vec![
        make_data_row("row0", vec![], vec![CellValue::number(100.0)]),
        make_grand_total_row(vec![CellValue::number(100.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert!(hierarchy.is_flat());
    assert_eq!(hierarchy.depth(), 0);
    // No children indexed because num_depths is 0
    assert!(hierarchy.children_by_parent.is_empty());
}

// ---- Grand total row gets empty path ----

#[test]
fn test_grand_total_row_has_empty_path() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Row 5 is grand total
    assert!(hierarchy.row_group_paths[5].is_empty());

    // Helpers should handle grand total gracefully
    assert_eq!(hierarchy.parent_path_key_at_depth(5, 0), "");
    assert_eq!(hierarchy.parent_path_key_at_depth(5, 1), "");
}

// ---- Subtotal row gets a path but is not added to children_by_parent ----

#[test]
fn test_subtotal_rows_not_in_children() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Row 2 is East subtotal, row 4 is West subtotal.
    // They should NOT appear in children_by_parent.
    let root_children = hierarchy
        .children_by_parent
        .get(&(0, String::new()))
        .unwrap();
    assert!(!root_children.contains(&2));
    assert!(!root_children.contains(&4));

    let east_children = hierarchy
        .children_by_parent
        .get(&(1, "east".to_string()))
        .unwrap();
    assert!(!east_children.contains(&2));
}

// ---- parent_path_key_at_depth edge cases ----

#[test]
fn test_parent_path_key_at_depth_out_of_range() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Depth 5 is way out of range for a 2-level hierarchy
    assert_eq!(hierarchy.parent_path_key_at_depth(0, 5), "");
}

#[test]
fn test_parent_path_key_at_depth_for_invalid_row() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Row index 999 doesn't exist
    assert_eq!(hierarchy.parent_path_key_at_depth(999, 0), "");
    assert_eq!(hierarchy.parent_path_key_at_depth(999, 1), "");
}

// ---- position_in_group for grand total / subtotal ----

#[test]
fn test_position_in_group_for_subtotal_returns_none() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Row 2 is East subtotal — it should NOT appear in any children list
    assert_eq!(hierarchy.position_in_group(2, 0), None);
    assert_eq!(hierarchy.position_in_group(2, 1), None);
}

#[test]
fn test_position_in_group_for_grand_total_returns_none() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Row 5 is grand total — it should NOT appear in any children list
    assert_eq!(hierarchy.position_in_group(5, 0), None);
}

// ---- find_sibling_by_value: cell_value_eq consistency tests ----
