//! Tests for validateConfig / config validation and validate_and_resolve.

use super::test_helpers::*;
use super::*;
use crate::types::*;

mod basic_config;
mod calculated_fields;
mod filter_conditions;
mod grouping;
mod placements;
mod show_values_as;
mod source_range;
mod top_bottom;

#[test]
fn source_shape_stays_modular() {
    let suite_root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine/validation_tests.rs");
    let suite_dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine/validation_tests");

    let budgets = [
        (suite_root, 90usize),
        (suite_dir.join("basic_config.rs"), 500),
        (suite_dir.join("placements.rs"), 550),
        (suite_dir.join("grouping.rs"), 400),
        (suite_dir.join("calculated_fields.rs"), 450),
        (suite_dir.join("show_values_as.rs"), 400),
        (suite_dir.join("source_range.rs"), 250),
        (suite_dir.join("filter_conditions.rs"), 800),
        (suite_dir.join("top_bottom.rs"), 350),
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
