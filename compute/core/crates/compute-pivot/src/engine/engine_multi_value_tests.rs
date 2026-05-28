//! Engine integration tests for multi-measure, calculated-field, and
//! Show Values As behavior.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

mod calculated_field_layout;
mod calculated_field_resolution;
mod calculated_fields;
mod multiple_values;
mod show_values_as_integration;

#[test]
fn source_shape_stays_modular() {
    let suite_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/engine/engine_multi_value_tests.rs");
    let suite_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/engine/engine_multi_value_tests");

    let budgets = [
        (suite_root, 90usize),
        (suite_dir.join("multiple_values.rs"), 250),
        (suite_dir.join("calculated_fields.rs"), 500),
        (suite_dir.join("calculated_field_layout.rs"), 450),
        (suite_dir.join("calculated_field_resolution.rs"), 350),
        (suite_dir.join("show_values_as_integration.rs"), 400),
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
