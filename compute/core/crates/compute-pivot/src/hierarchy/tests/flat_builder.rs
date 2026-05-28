use super::fixtures::*;
use super::*;

#[test]
fn test_build_two_level_hierarchy_paths() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // Row 0 (East/Widget): path should have two entries
    assert_eq!(hierarchy.row_group_paths[0].len(), 2);
    assert_eq!(hierarchy.row_group_paths[0][0].0, "Region");
    assert_eq!(hierarchy.row_group_paths[0][0].1, "east");
    assert_eq!(hierarchy.row_group_paths[0][1].0, "Product");
    assert_eq!(hierarchy.row_group_paths[0][1].1, "east\x00widget");

    // Row 1 (East/Gadget): same region, different product
    assert_eq!(hierarchy.row_group_paths[1][0].1, "east");
    assert_eq!(hierarchy.row_group_paths[1][1].1, "east\x00gadget");

    // Row 3 (West/Widget): different region
    assert_eq!(hierarchy.row_group_paths[3][0].1, "west");
    assert_eq!(hierarchy.row_group_paths[3][1].1, "west\x00widget");

    // Row 5 (Grand total): empty path
    assert!(hierarchy.row_group_paths[5].is_empty());
}

#[test]
fn test_build_two_level_hierarchy_children_by_parent() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // At depth 0, parent is root (""). All data rows should be children.
    let root_children = hierarchy.children_by_parent.get(&(0, String::new()));
    assert!(root_children.is_some());
    let root_children = root_children.unwrap();
    assert_eq!(root_children, &[0, 1, 3]); // East/Widget, East/Gadget, West/Widget

    // At depth 1, parent "east" should have rows 0 and 1
    let east_children = hierarchy.children_by_parent.get(&(1, "east".to_string()));
    assert!(east_children.is_some());
    assert_eq!(east_children.unwrap(), &[0, 1]);

    // At depth 1, parent "west" should have row 3
    let west_children = hierarchy.children_by_parent.get(&(1, "west".to_string()));
    assert!(west_children.is_some());
    assert_eq!(west_children.unwrap(), &[3]);
}

#[test]
fn test_build_two_level_hierarchy_subtotal_index() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    // East subtotal at depth 0, key "east" -> row 2
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "east".to_string())),
        Some(&2)
    );

    // West subtotal at depth 0, key "west" -> row 4
    assert_eq!(
        hierarchy.subtotal_index.get(&(0, "west".to_string())),
        Some(&4)
    );
}

#[test]
fn test_build_two_level_hierarchy_field_names() {
    let (rows, field_names) = build_two_level_rows();
    let hierarchy = build_group_hierarchy(&rows, &field_names);

    assert_eq!(hierarchy.field_names, vec!["Region", "Product"]);
}

// ---- siblings_at_depth ----
