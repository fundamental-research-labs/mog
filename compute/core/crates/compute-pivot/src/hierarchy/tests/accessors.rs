use super::fixtures::*;
use super::*;

#[test]
fn test_siblings_at_depth_1() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // East/Widget (row 0) siblings at depth 1 (Product level) = [0, 1]
    let siblings = hierarchy.siblings_at_depth(0, 1);
    assert!(siblings.is_some());
    assert_eq!(siblings.unwrap(), &[0, 1]);

    // East/Gadget (row 1) siblings at depth 1 should be the same
    let siblings = hierarchy.siblings_at_depth(1, 1);
    assert!(siblings.is_some());
    assert_eq!(siblings.unwrap(), &[0, 1]);

    // West/Widget (row 3) siblings at depth 1 = [3]
    let siblings = hierarchy.siblings_at_depth(3, 1);
    assert!(siblings.is_some());
    assert_eq!(siblings.unwrap(), &[3]);
}

#[test]
fn test_siblings_at_depth_0() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // All data rows are siblings at depth 0
    let siblings = hierarchy.siblings_at_depth(0, 0);
    assert!(siblings.is_some());
    assert_eq!(siblings.unwrap(), &[0, 1, 3]);
}

// ---- previous_sibling / next_sibling ----

#[test]
fn test_previous_sibling_within_group() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // East/Gadget (row 1) previous at depth 1 = East/Widget (row 0)
    assert_eq!(hierarchy.previous_sibling(1, 1), Some(0));

    // East/Widget (row 0) previous at depth 1 = None (first in group)
    assert_eq!(hierarchy.previous_sibling(0, 1), None);
}

#[test]
fn test_next_sibling_within_group() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // East/Widget (row 0) next at depth 1 = East/Gadget (row 1)
    assert_eq!(hierarchy.next_sibling(0, 1), Some(1));

    // East/Gadget (row 1) next at depth 1 = None (last in group)
    assert_eq!(hierarchy.next_sibling(1, 1), None);
}

#[test]
fn test_previous_next_does_not_cross_group_boundary() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // West/Widget (row 3) previous at depth 1 = None
    // Even though East/Gadget (row 1) comes before it in the flat list,
    // they are in different parent groups at depth 1.
    assert_eq!(hierarchy.previous_sibling(3, 1), None);

    // East/Gadget (row 1) next at depth 1 = None
    // Even though West/Widget (row 3) comes after it in the flat list.
    assert_eq!(hierarchy.next_sibling(1, 1), None);
}

#[test]
fn test_previous_next_at_depth_0() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // At depth 0, all data rows are in the root group: [0, 1, 3]
    // Row 0 next = row 1
    assert_eq!(hierarchy.next_sibling(0, 0), Some(1));
    // Row 1 next = row 3
    assert_eq!(hierarchy.next_sibling(1, 0), Some(3));
    // Row 3 next = None
    assert_eq!(hierarchy.next_sibling(3, 0), None);

    // Row 0 previous = None
    assert_eq!(hierarchy.previous_sibling(0, 0), None);
    // Row 1 previous = row 0
    assert_eq!(hierarchy.previous_sibling(1, 0), Some(0));
    // Row 3 previous = row 1
    assert_eq!(hierarchy.previous_sibling(3, 0), Some(1));
}

// ---- find_sibling_by_value ----

#[test]
fn test_subtotal_at_depth() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // East/Widget (row 0) subtotal at depth 0 -> East subtotal (row 2)
    assert_eq!(hierarchy.subtotal_at_depth(0, 0), Some(2));

    // East/Gadget (row 1) subtotal at depth 0 -> East subtotal (row 2)
    assert_eq!(hierarchy.subtotal_at_depth(1, 0), Some(2));

    // West/Widget (row 3) subtotal at depth 0 -> West subtotal (row 4)
    assert_eq!(hierarchy.subtotal_at_depth(3, 0), Some(4));
}

#[test]
fn test_subtotal_at_depth_out_of_range() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // There are no subtotals at depth 1 (product level) in this test data
    assert_eq!(hierarchy.subtotal_at_depth(0, 1), None);
}

// ---- depth_for_field ----

#[test]
fn test_depth_for_field() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert_eq!(hierarchy.depth_for_field("Region"), Some(0));
    assert_eq!(hierarchy.depth_for_field("Product"), Some(1));
    assert_eq!(hierarchy.depth_for_field("Unknown"), None);
}

// ---- position_in_group ----

#[test]
fn test_position_in_group() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // East/Widget (row 0) is first of 2 siblings at depth 1
    assert_eq!(hierarchy.position_in_group(0, 1), Some((0, 2)));

    // East/Gadget (row 1) is second of 2 siblings at depth 1
    assert_eq!(hierarchy.position_in_group(1, 1), Some((1, 2)));

    // West/Widget (row 3) is first (and only) at depth 1
    assert_eq!(hierarchy.position_in_group(3, 1), Some((0, 1)));
}

// ---- is_first_in_group / is_last_in_group ----

#[test]
fn test_is_first_in_group() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert!(hierarchy.is_first_in_group(0, 1)); // East/Widget
    assert!(!hierarchy.is_first_in_group(1, 1)); // East/Gadget
    assert!(hierarchy.is_first_in_group(3, 1)); // West/Widget (only one in West)
}

#[test]
fn test_is_last_in_group() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert!(!hierarchy.is_last_in_group(0, 1)); // East/Widget
    assert!(hierarchy.is_last_in_group(1, 1)); // East/Gadget
    assert!(hierarchy.is_last_in_group(3, 1)); // West/Widget (only one in West)
}

// ---- depth / is_flat ----

#[test]
fn test_depth_and_is_flat() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert_eq!(hierarchy.depth(), 2);
    assert!(!hierarchy.is_flat());
}

#[test]
fn test_is_flat_single_level() {
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
        make_grand_total_row(vec![CellValue::number(300.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    assert_eq!(hierarchy.depth(), 1);
    assert!(hierarchy.is_flat());
}

// ---- 3-level hierarchy (Region > State > City) ----
