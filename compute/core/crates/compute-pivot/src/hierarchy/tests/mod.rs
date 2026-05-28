use super::{GroupHierarchy, build_group_hierarchy, build_group_hierarchy_from_aggregated_tree};
use crate::types::PivotRow;
use value_types::CellValue;

mod accessors;
mod edge_cases;
mod fixtures;
mod flat_builder;
mod three_level;
mod tree_builder;
mod value_matching;

#[test]
fn test_hierarchy_import_paths_remain_available() {
    let rows: Vec<PivotRow> = vec![];
    let fields: Vec<String> = vec![];
    let hierarchy: GroupHierarchy = build_group_hierarchy(&rows, &fields);
    let root_hierarchy: crate::GroupHierarchy =
        build_group_hierarchy_from_aggregated_tree(&[], &rows, &fields, None);

    assert_eq!(hierarchy.depth(), 0);
    assert_eq!(root_hierarchy.depth(), 0);
}

#[test]
fn source_shape_stays_modular() {
    let suite_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/hierarchy/tests");

    let budgets = [
        (suite_dir.join("mod.rs"), 120usize),
        (suite_dir.join("fixtures.rs"), 350),
        (suite_dir.join("flat_builder.rs"), 450),
        (suite_dir.join("accessors.rs"), 450),
        (suite_dir.join("three_level.rs"), 450),
        (suite_dir.join("edge_cases.rs"), 450),
        (suite_dir.join("value_matching.rs"), 450),
        (suite_dir.join("tree_builder.rs"), 450),
    ];

    for (path, max_lines) in budgets {
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));
        let line_count = source.lines().count();
        assert!(
            line_count <= max_lines,
            "{} has {line_count} lines, budget is {max_lines}",
            path.display()
        );
    }
}
