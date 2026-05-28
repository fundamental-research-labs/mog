//! Tests for tabular and outline layout forms.

use super::test_helpers::*;
use super::*;
use crate::types::*;
use value_types::CellValue;

mod helpers;
mod layout_parity;
mod outline_comparison;
mod rendering_contracts;
mod tabular_basic;
mod tabular_sort;
mod tabular_subtotals;

use helpers::*;

#[test]
fn source_shape_stays_modular() {
    let suite_root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine/tabular_layout_tests.rs");
    let suite_dir =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine/tabular_layout_tests");

    let budgets = [
        (suite_root, 90usize),
        (suite_dir.join("helpers.rs"), 220),
        (suite_dir.join("tabular_basic.rs"), 260),
        (suite_dir.join("tabular_subtotals.rs"), 260),
        (suite_dir.join("tabular_sort.rs"), 380),
        (suite_dir.join("outline_comparison.rs"), 220),
        (suite_dir.join("layout_parity.rs"), 160),
        (suite_dir.join("rendering_contracts.rs"), 160),
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
