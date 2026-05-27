//! Tests for sort-by-value functionality.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

mod basic;
mod column_key;
mod custom_sort;
mod expansion_state;
mod helpers;
mod hierarchical;
mod regressions;
mod tiebreakers;

#[test]
fn source_shape_stays_modular() {
    let suite_root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine/value_sorting_tests.rs");
    let suite_dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine/value_sorting_tests");

    let budgets = [
        (suite_root, 80usize),
        (suite_dir.join("helpers.rs"), 350),
        (suite_dir.join("basic.rs"), 900),
        (suite_dir.join("column_key.rs"), 900),
        (suite_dir.join("hierarchical.rs"), 900),
        (suite_dir.join("tiebreakers.rs"), 900),
        (suite_dir.join("custom_sort.rs"), 900),
        (suite_dir.join("regressions.rs"), 900),
        (suite_dir.join("expansion_state.rs"), 900),
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
