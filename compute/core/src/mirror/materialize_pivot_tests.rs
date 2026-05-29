//! pivot framing sub-scope C.4 — direct cell-readback tests for `materialize_pivot`.
//!
//! Before this round there were zero tests for `materialize_pivot` anywhere
//! under `compute/core/src/mirror/`. The four `frame_survives_*` tests below
//! lock in the structural framing the materializer must emit (Bugs A, B, C,
//! D from pivot framing) by hand-building `PivotTableResult` values and reading
//! cells back from `col_data`. The three `#[should_panic]` tests exercise
//! the `debug_assert!`s added in sub-scope D — without those asserts firing
//! on malformed input, the runtime invariants are hopes, not gates.

use cell_types::SheetPos;
use compute_pivot::types::{
    FieldId, PivotColumnHeader, PivotGrandTotals, PivotHeader, PivotRenderedBounds, PivotRow,
    PivotTableResult,
};
use value_types::CellValue;

use super::test_helpers::fresh_mirror_with_sheet;

// --------------------------------------------------------------------------
// Helpers — minimal builders so each test stays focused on the assertion.
// --------------------------------------------------------------------------

fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

fn num(n: f64) -> CellValue {
    CellValue::number(n)
}

/// A row PivotHeader at the given depth with no children, no special flags.
fn row_header(value: CellValue, field_id: &str, depth: usize) -> PivotHeader {
    PivotHeader {
        key: format!("row_{}_{}", field_id, depth),
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

/// A column PivotHeader at depth 0 with the given span.
fn col_header(value: CellValue, field_id: &str, span: usize) -> PivotHeader {
    PivotHeader {
        key: format!("col_{}", value),
        value,
        field_id: FieldId::from(field_id),
        depth: 0,
        span,
        is_expandable: false,
        is_expanded: true,
        is_subtotal: false,
        is_grand_total: false,
        parent_key: None,
        child_keys: None,
    }
}

/// A pivot row with one row-axis header and the given values.
fn pivot_row(label: &str, field_id: &str, values: Vec<CellValue>) -> PivotRow {
    PivotRow {
        key: format!("row_{}", label),
        headers: vec![row_header(text(label), field_id, 0)],
        values,
        depth: 0,
        is_subtotal: false,
        is_grand_total: false,
        source_row_indices: None,
    }
}

fn pivot_row_with_headers(
    key: &str,
    headers: Vec<(&str, &str, usize)>,
    values: Vec<CellValue>,
) -> PivotRow {
    let depth = headers.last().map(|(_, _, depth)| *depth).unwrap_or(0);
    PivotRow {
        key: key.into(),
        headers: headers
            .into_iter()
            .map(|(label, field_id, depth)| row_header(text(label), field_id, depth))
            .collect(),
        values,
        depth,
        is_subtotal: false,
        is_grand_total: false,
        source_row_indices: None,
    }
}

const ANCHOR_ROW: u32 = 0;
const ANCHOR_COL: u32 = 5; // column F — typical pivot anchor in the corpus

#[test]
fn materialize_pivot_writes_transformed_grand_total_branches() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    let result = PivotTableResult {
        column_headers: vec![PivotColumnHeader {
            field_id: FieldId::from("quarter"),
            headers: vec![
                col_header(text("Q1"), "quarter", 1),
                col_header(text("Q2"), "quarter", 1),
            ],
        }],
        rows: vec![
            pivot_row("East", "region", vec![num(0.1), num(0.3)]),
            pivot_row("West", "region", vec![num(0.2), num(0.4)]),
        ],
        grand_totals: PivotGrandTotals {
            row: Some(vec![num(0.3), num(0.7)]),
            column: Some(vec![vec![num(0.4)], vec![num(0.6)]]),
            grand: Some(vec![num(1.0)]),
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 4,
            total_cols: 4,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 2,
        },
        source_row_count: 2,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string()],
    );

    let gt_row = ANCHOR_ROW + 3;
    let gt_col = ANCHOR_COL + 3;
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(gt_row, ANCHOR_COL + 1))
            .cloned(),
        Some(num(0.3)),
        "bottom grand-total row must use transformed values",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(gt_row, ANCHOR_COL + 2))
            .cloned(),
        Some(num(0.7)),
        "bottom grand-total row must write every transformed column leaf",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 1, gt_col))
            .cloned(),
        Some(num(0.4)),
        "right-side grand-total column must use transformed values",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 2, gt_col))
            .cloned(),
        Some(num(0.6)),
        "right-side grand-total column must write each transformed row total",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(gt_row, gt_col))
            .cloned(),
        Some(num(1.0)),
        "corner grand total must use the transformed value",
    );
}

#[test]
fn materialize_compact_multi_row_fields_writes_deepest_visible_label() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    let result = PivotTableResult {
        column_headers: vec![],
        rows: vec![
            pivot_row_with_headers("North", vec![("North", "region", 0)], vec![num(200.0)]),
            pivot_row_with_headers(
                "North|Gadget",
                vec![("North", "region", 0), ("Gadget", "product", 1)],
                vec![num(40.0)],
            ),
            pivot_row_with_headers(
                "North|Widget",
                vec![("North", "region", 0), ("Widget", "product", 1)],
                vec![num(160.0)],
            ),
        ],
        grand_totals: PivotGrandTotals {
            row: Some(vec![num(200.0)]),
            column: None,
            grand: None,
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 5,
            total_cols: 2,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 1,
        },
        source_row_count: 3,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string(), "Product".to_string()],
    );

    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL))
            .cloned(),
        Some(text("Region")),
        "compact layout exposes one row-header column before data",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 1, ANCHOR_COL))
            .cloned(),
        Some(text("North")),
        "outer group rows keep their outer label",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 2, ANCHOR_COL))
            .cloned(),
        Some(text("Gadget")),
        "child rows must show the deepest row-field label in the compact column",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 2, ANCHOR_COL + 1))
            .cloned(),
        Some(num(40.0)),
        "child row value stays in the first data column instead of overwriting the label",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 3, ANCHOR_COL))
            .cloned(),
        Some(text("Widget")),
        "sibling child rows also show their deepest label",
    );
}

// ==========================================================================
// 1. frame_survives_rows_only_no_values  —  r=1, c=0, v=0
// ==========================================================================

/// Bug A regression test. Row-field labels at `anchor_row` must survive even
/// when no column or value placements exist. Bug B regression: a header row
/// must be reserved (`first_data_row = 1`) so data rows do not clobber it.
/// Row GT framing emits a "Grand Total" label at the bottom-left.
#[test]
fn frame_survives_rows_only_no_values() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    // r=1, c=0, v=0:
    //   total_rows = 1 (header) + N (rows) + 1 (GT row) = 5
    //   total_cols = 1 (row-header col) + 0 (no data cols) + 0 (no col GT) = 1
    //   first_data_row = 1, first_data_col = 1, num_data_cols = 0
    let rows = vec![
        pivot_row("East", "region", vec![]),
        pivot_row("North", "region", vec![]),
        pivot_row("South", "region", vec![]),
    ];
    let n = rows.len() as u32;

    let result = PivotTableResult {
        column_headers: vec![],
        rows,
        grand_totals: PivotGrandTotals {
            row: Some(Vec::new()),
            column: None,
            grand: None,
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 1 + n + 1,
            total_cols: 1,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 0,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string()],
    );

    // Row-field name at the top-left (anchor_row, anchor_col).
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL))
            .cloned(),
        Some(text("Region")),
        "row-field name must land at the anchor (header row reserved)",
    );

    // First data-row label is at anchor_row + 1, NOT at anchor_row.
    // This is the regression test for Bug A: data rows must not clobber the header.
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + 1, ANCHOR_COL))
            .cloned(),
        Some(text("East")),
        "first data-row label must land at anchor_row + 1",
    );
    // And NOT at anchor_row.
    assert_ne!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL))
            .cloned(),
        Some(text("East")),
        "data row must not clobber the row-field header at anchor_row",
    );

    // Row GT label "Grand Total" at (anchor_row + total_rows - 1, anchor_col)
    // = (anchor_row + 1 + N + 1 - 1, anchor_col) = (anchor_row + N + 1, anchor_col).
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW + n + 1, ANCHOR_COL))
            .cloned(),
        Some(text("Grand Total")),
        "row GT label must land at the bottom-left corner",
    );
}

// ==========================================================================
// 2. frame_survives_cols_only_no_values  —  r=0, c=1, v=0
// ==========================================================================

/// Bug D regression test. Column headers must materialize at `anchor_row`,
/// and the column-GT header label "Grand Total" must land at the leftmost
/// column of the GT span — which collapses to a single column when
/// `num_value_fields = 1` (the v=0 fallback).
#[test]
fn frame_survives_cols_only_no_values() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    // r=0, c=1, v=0:
    //   column leaves = 2 (Gadget, Widget), each span = 1 * max(0, 1) = 1.
    //   num_data_cols = 2.
    //   total_rows = 1 (column-header level) + 0 + 0 = 1.
    //   total_cols = 0 + 2 + 1 (GT col) = 3.
    //   first_data_row = 1, first_data_col = 0.
    let column_headers = vec![PivotColumnHeader {
        field_id: FieldId::from("product"),
        headers: vec![
            col_header(text("Gadget"), "product", 1),
            col_header(text("Widget"), "product", 1),
        ],
    }];

    let result = PivotTableResult {
        column_headers,
        rows: vec![],
        grand_totals: PivotGrandTotals {
            row: None,
            column: Some(Vec::new()), // outer empty — no rows × no values
            grand: None,
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 1,
            total_cols: 3,
            first_data_row: 1,
            first_data_col: 0,
            num_data_cols: 2,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(&sheet_id, ANCHOR_ROW, ANCHOR_COL, &result, &[]);

    // Column-header values land at anchor_row.
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL))
            .cloned(),
        Some(text("Gadget")),
        "first column-leaf header must land at anchor",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL + 1))
            .cloned(),
        Some(text("Widget")),
        "second column-leaf header must land at anchor_col + 1",
    );

    // Column GT header label at (anchor_row, anchor_col + total_cols - 1)
    // = (anchor_row, anchor_col + 2). gt_span = max(num_value_fields, 1) = 1.
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL + 2))
            .cloned(),
        Some(text("Grand Total")),
        "column GT header label must land at the leftmost (= only) GT column slot",
    );
}

// ==========================================================================
// 3. frame_survives_rows_and_cols_no_values  —  r=1, c=1, v=0
// ==========================================================================

/// Full-frame regression test. All four corners must populate: row-field
/// name top-left, column-header values along the top, row GT label
/// bottom-left, column GT header label top-right.
#[test]
fn frame_survives_rows_and_cols_no_values() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    // r=1, c=1, v=0:
    //   column leaves = 2, num_data_cols = 2.
    //   N = 2 (East, West).
    //   total_rows = 1 (header) + 2 (rows) + 1 (GT row) = 4.
    //   total_cols = 1 (row-header) + 2 (data) + 1 (col GT) = 4.
    //   first_data_row = 1, first_data_col = 1.
    let rows = vec![
        pivot_row("East", "region", vec![]),
        pivot_row("West", "region", vec![]),
    ];
    let n = rows.len() as u32;

    let column_headers = vec![PivotColumnHeader {
        field_id: FieldId::from("product"),
        headers: vec![
            col_header(text("Gadget"), "product", 1),
            col_header(text("Widget"), "product", 1),
        ],
    }];

    // column GT: outer length = N (one inner empty per pivot row).
    let column_gt = vec![Vec::new(), Vec::new()];

    let result = PivotTableResult {
        column_headers,
        rows,
        grand_totals: PivotGrandTotals {
            row: Some(Vec::new()),
            column: Some(column_gt),
            grand: Some(Vec::new()),
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 1 + n + 1,
            total_cols: 1 + 2 + 1,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 2,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string()],
    );

    // Top-left: row-field name "Region".
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL))
            .cloned(),
        Some(text("Region")),
        "row-field name at top-left",
    );

    // Top: column-leaf values at (anchor_row, anchor_col + 1) and (anchor_row, anchor_col + 2).
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL + 1))
            .cloned(),
        Some(text("Gadget")),
        "first column-leaf header next to row-field column",
    );
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL + 2))
            .cloned(),
        Some(text("Widget")),
        "second column-leaf header",
    );

    // Top-right: column GT header label at (anchor_row, anchor_col + total_cols - 1).
    // total_cols = 4, so column 3 from anchor.
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, ANCHOR_COL + 3))
            .cloned(),
        Some(text("Grand Total")),
        "column GT header label at top-right",
    );

    // Bottom-left: row GT label "Grand Total" at (anchor_row + total_rows - 1, anchor_col).
    let gt_row = ANCHOR_ROW + 1 + n + 1 - 1;
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(gt_row, ANCHOR_COL))
            .cloned(),
        Some(text("Grand Total")),
        "row GT label at bottom-left",
    );
}

// ==========================================================================
// 4. column_gt_header_label_at_v_geq_1_multi_value  —  r=1, c=1, v=2
// ==========================================================================

/// At v ≥ 2 the column GT spans `num_value_fields` columns. The header label
/// must sit at the **leftmost** column of that span — `anchor_col + total_cols
/// - num_value_fields` — to align with the leftmost value column underneath
/// it. This pins both Bug D and the multi-value label position that the plan
/// prose alone leaves under-specified.
#[test]
fn column_gt_header_label_at_v_geq_1_multi_value() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    // r=1, c=1, v=2:
    //   column leaves = 2 (Gadget, Widget); each span = 1 * 2 = 2 (per value field).
    //   num_data_cols = 4.
    //   N = 2.
    //   total_rows = 1 + 2 + 1 = 4.
    //   total_cols = 1 (row-header) + 4 (data) + 2 (col GT span) = 7.
    let rows = vec![
        PivotRow {
            key: "row_East".into(),
            headers: vec![row_header(text("East"), "region", 0)],
            values: vec![num(100.0), num(10.0), num(200.0), num(20.0)],
            depth: 0,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: None,
        },
        PivotRow {
            key: "row_West".into(),
            headers: vec![row_header(text("West"), "region", 0)],
            values: vec![num(150.0), num(15.0), num(300.0), num(30.0)],
            depth: 0,
            is_subtotal: false,
            is_grand_total: false,
            source_row_indices: None,
        },
    ];
    let n = rows.len() as u32;

    let column_headers = vec![PivotColumnHeader {
        field_id: FieldId::from("product"),
        headers: vec![
            col_header(text("Gadget"), "product", 2),
            col_header(text("Widget"), "product", 2),
        ],
    }];

    // Column GT: per-row inner vec has length 2 (num_value_fields).
    let column_gt = vec![vec![num(300.0), num(30.0)], vec![num(450.0), num(45.0)]];
    // Corner GT: length 2 (num_value_fields).
    let grand_gt = vec![num(750.0), num(75.0)];
    // Row GT: length = column_leaves * num_value_fields = 4.
    let row_gt = vec![num(250.0), num(25.0), num(500.0), num(50.0)];

    let total_cols = 1 + 4 + 2;
    let result = PivotTableResult {
        column_headers,
        rows,
        grand_totals: PivotGrandTotals {
            row: Some(row_gt),
            column: Some(column_gt),
            grand: Some(grand_gt),
            row_label: Some("Grand Total".to_string()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 1 + n + 1,
            total_cols,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 4,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string()],
    );

    // GT label at (anchor_row, anchor_col + total_cols - num_value_fields) — leftmost of GT span.
    // num_value_fields = 2, total_cols = 7, so column offset = 5.
    let gt_label_col = ANCHOR_COL + total_cols - 2;
    assert_eq!(
        mirror
            .get_cell_value_at(&sheet_id, SheetPos::new(ANCHOR_ROW, gt_label_col))
            .cloned(),
        Some(text("Grand Total")),
        "column GT header label must sit at the leftmost column of the GT span (anchor_col + total_cols - num_value_fields)",
    );
}

// ==========================================================================
// 5–7. #[should_panic] — exercise sub-scope D's debug_assert!s.
// ==========================================================================

/// `materialize_pivot` must trip on a `PivotTableResult` whose row-field
/// names are non-empty but `first_data_row = 0` — i.e., no header row was
/// reserved for the labels (Bug A's pre-fix shape).
#[test]
#[should_panic(expected = "row field labels need a header row reserved")]
fn debug_assert_trips_on_unreserved_header_row() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    let rows = vec![pivot_row("East", "region", vec![])];
    let result = PivotTableResult {
        column_headers: vec![],
        rows,
        grand_totals: PivotGrandTotals {
            row: None,
            column: None,
            grand: None,
            row_label: None,
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 1,
            total_cols: 1,
            first_data_row: 0, // <-- malformed: no header row reserved
            first_data_col: 1,
            num_data_cols: 0,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string()],
    );
}

/// `materialize_pivot` must trip when `grand_totals.row.is_some()` but
/// `total_rows` is too small to hold the header + N rows + GT row.
#[test]
#[should_panic(expected = "GT row not reserved in total_rows")]
fn debug_assert_trips_on_unreserved_gt_row() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    // 2 rows + GT row should require total_rows >= first_data_row(1) + 2 + 1 = 4.
    // We deliberately set total_rows = 3 to trip the assert.
    let rows = vec![
        pivot_row("East", "region", vec![]),
        pivot_row("West", "region", vec![]),
    ];
    let result = PivotTableResult {
        column_headers: vec![],
        rows,
        grand_totals: PivotGrandTotals {
            row: Some(Vec::new()),
            column: None,
            grand: None,
            row_label: Some("Grand Total".into()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 3, // <-- malformed: GT row not reserved
            total_cols: 1,
            first_data_row: 1,
            first_data_col: 1,
            num_data_cols: 0,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(
        &sheet_id,
        ANCHOR_ROW,
        ANCHOR_COL,
        &result,
        &["Region".to_string()],
    );
}

/// `materialize_pivot` must trip when `grand_totals.column.is_some()` but
/// `total_cols` is too small to accommodate the GT span past the data
/// columns.
#[test]
#[should_panic(expected = "GT column not reserved in total_cols")]
fn debug_assert_trips_on_unreserved_gt_column() {
    let (mut mirror, sheet_id) = fresh_mirror_with_sheet(20, 20);

    // num_data_cols = 2, num_value_fields collapses to 1 (no grand corner).
    // total_cols must be >= first_data_col(0) + 2 + 1 = 3.
    // We deliberately set total_cols = 2 to trip the assert.
    let column_headers = vec![PivotColumnHeader {
        field_id: FieldId::from("product"),
        headers: vec![
            col_header(text("Gadget"), "product", 1),
            col_header(text("Widget"), "product", 1),
        ],
    }];

    let result = PivotTableResult {
        column_headers,
        rows: vec![],
        grand_totals: PivotGrandTotals {
            row: None,
            column: Some(Vec::new()),
            grand: None,
            row_label: Some("Grand Total".into()),
        },
        rendered_bounds: PivotRenderedBounds {
            total_rows: 1,
            total_cols: 2, // <-- malformed: GT col not reserved
            first_data_row: 1,
            first_data_col: 0,
            num_data_cols: 2,
        },
        source_row_count: 0,
        measure_descriptors: vec![],
        value_records: vec![],
        errors: None,
    };

    mirror.materialize_pivot(&sheet_id, ANCHOR_ROW, ANCHOR_COL, &result, &[]);
}
