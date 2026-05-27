use super::super::*;
use crate::hierarchy::{GroupHierarchy, build_group_hierarchy};
use crate::types::{FieldId, PivotHeader};

// ===================================================================
// Test Helpers
// ===================================================================

/// Create a PivotHeader for testing.
pub(super) fn make_header(
    key: &str,
    value: CellValue,
    field_id: &str,
    depth: usize,
) -> PivotHeader {
    PivotHeader {
        key: key.to_string(),
        value,
        field_id: FieldId::from(field_id),
        depth,
        span: 1,
        is_expandable: false,
        is_expanded: true,
        is_subtotal: false,
        is_grand_total: false,
        parent_key: None,
        child_keys: None,
    }
}

/// Create a data row.
pub(super) fn make_data_row(
    key: &str,
    headers: Vec<PivotHeader>,
    values: Vec<CellValue>,
) -> PivotRow {
    let depth = headers.last().map_or(0, |h| h.depth);
    PivotRow {
        key: key.to_string(),
        headers,
        values,
        depth,
        is_subtotal: false,
        is_grand_total: false,
        source_row_indices: None,
    }
}

/// Create a subtotal row.
pub(super) fn make_subtotal_row(
    key: &str,
    headers: Vec<PivotHeader>,
    depth: usize,
    values: Vec<CellValue>,
) -> PivotRow {
    PivotRow {
        key: key.to_string(),
        headers,
        values,
        depth,
        is_subtotal: true,
        is_grand_total: false,
        source_row_indices: None,
    }
}

/// Create a grand total row.
pub(super) fn make_grand_total_row(values: Vec<CellValue>) -> PivotRow {
    PivotRow {
        key: "__grand_total__".to_string(),
        headers: vec![],
        values,
        depth: 0,
        is_subtotal: false,
        is_grand_total: true,
        source_row_indices: None,
    }
}

/// Shorthand to create PivotGrandTotals.
pub(super) fn make_grand_totals(row: Option<Vec<CellValue>>) -> PivotGrandTotals {
    PivotGrandTotals {
        grand: row.clone(),
        row,
        column: None,
        row_label: None,
    }
}

/// Helper to extract a number from CellValue.
pub(super) fn num(v: &CellValue) -> f64 {
    match v {
        CellValue::Number(n) => n.get(),
        other => panic!("Expected Number, got {:?}", other),
    }
}

/// Helper to check that a CellValue is Null.
pub(super) fn is_null(v: &CellValue) -> bool {
    matches!(v, CellValue::Null)
}

/// Assert approximate floating-point equality.
pub(super) fn assert_approx(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "Expected {} to be approximately {} (tolerance {})",
        actual,
        expected,
        tolerance
    );
}

// ---- Standard 2-level test data (Region > Product) ----

/// Build a 2-level hierarchy: Region > Product
///
/// Structure:
///   Row 0: East / Widget  = 100
///   Row 1: East / Gadget  = 200
///   Row 2: East subtotal  = 300
///   Row 3: West / Widget  = 150
///   Row 4: West / Gadget  = 250
///   Row 5: West subtotal  = 400
///   Row 6: Grand total    = 700
pub(super) fn make_two_level_test_data() -> (Vec<PivotRow>, GroupHierarchy, PivotGrandTotals) {
    let field_names = vec!["Region".to_string(), "Product".to_string()];

    let rows = vec![
        make_data_row(
            "east\x00widget",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header(
                    "east\x00widget",
                    CellValue::Text("Widget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "east\x00gadget",
            vec![
                make_header("east", CellValue::Text("East".into()), "Region", 0),
                make_header(
                    "east\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "Product",
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
                "Region",
                0,
            )],
            0,
            vec![CellValue::number(300.0)],
        ),
        make_data_row(
            "west\x00widget",
            vec![
                make_header("west", CellValue::Text("West".into()), "Region", 0),
                make_header(
                    "west\x00widget",
                    CellValue::Text("Widget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(150.0)],
        ),
        make_data_row(
            "west\x00gadget",
            vec![
                make_header("west", CellValue::Text("West".into()), "Region", 0),
                make_header(
                    "west\x00gadget",
                    CellValue::Text("Gadget".into()),
                    "Product",
                    1,
                ),
            ],
            vec![CellValue::number(250.0)],
        ),
        make_subtotal_row(
            "west__SUBTOTAL__",
            vec![make_header(
                "west",
                CellValue::Text("West Total".into()),
                "Region",
                0,
            )],
            0,
            vec![CellValue::number(400.0)],
        ),
        make_grand_total_row(vec![CellValue::number(700.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(700.0)]));

    (rows, hierarchy, grand_totals)
}

/// Build a flat (single-level) test data set.
///
/// Structure:
///   Row 0: Q1 = 100
///   Row 1: Q2 = 150
///   Row 2: Q3 = 200
///   Row 3: Q4 = 50
///   Row 4: Grand total = 500
pub(super) fn make_flat_test_data() -> (Vec<PivotRow>, GroupHierarchy, PivotGrandTotals) {
    let field_names = vec!["Quarter".to_string()];

    let rows = vec![
        make_data_row(
            "q1",
            vec![make_header(
                "q1",
                CellValue::Text("Q1".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(100.0)],
        ),
        make_data_row(
            "q2",
            vec![make_header(
                "q2",
                CellValue::Text("Q2".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(150.0)],
        ),
        make_data_row(
            "q3",
            vec![make_header(
                "q3",
                CellValue::Text("Q3".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(200.0)],
        ),
        make_data_row(
            "q4",
            vec![make_header(
                "q4",
                CellValue::Text("Q4".into()),
                "Quarter",
                0,
            )],
            vec![CellValue::number(50.0)],
        ),
        make_grand_total_row(vec![CellValue::number(500.0)]),
    ];

    let hierarchy = build_group_hierarchy(&rows, &field_names);
    let grand_totals = make_grand_totals(Some(vec![CellValue::number(500.0)]));

    (rows, hierarchy, grand_totals)
}

// ===================================================================
// Flat Pivot Tests (backward compatibility)
// ===================================================================
