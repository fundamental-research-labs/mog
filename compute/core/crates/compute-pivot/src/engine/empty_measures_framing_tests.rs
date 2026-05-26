//! pivot framing sub-scope C.2 — empty-measures (`v=0`) framing.
//!
//! Pivot rendered bounds and framing labels (row-field header, "Grand Total"
//! row, "Grand Total" column header) are functions of `(row_placements,
//! column_placements, layout)` only. Measures fill in *values*; their absence
//! must produce empty slots, never collapse the frame. These tests pin the
//! `PivotTableResult`-shape contract end-to-end through `compute_resolved`
//! for each `v=0` config combination that today's corpus does not cover.

use super::test_helpers::*;
use super::*;
use crate::types::*;

/// Build a base config with row/column grand totals enabled and the given
/// placements. Mirrors the layout the UI emits when an analyst drops a field
/// into Rows/Columns and (deliberately) leaves Values empty.
fn config_with_gt(placements: Vec<PivotFieldPlacement>) -> PivotTableConfig {
    let mut config = make_base_config(sample_fields(), placements, vec![]);
    config.layout = Some(PivotTableLayout {
        show_row_grand_totals: Some(true),
        show_column_grand_totals: Some(true),
        ..Default::default()
    });
    config
}

// --------------------------------------------------------------------------
// r=1, c=0, v=0 — rows-only, no values
// --------------------------------------------------------------------------

/// One row field, no column field, no value field. The pivot must reserve
/// a header row for the row-field label, frame the Grand Total row, and
/// emit no column headers and no column grand total.
#[test]
fn rows_only_no_values_frames_header_and_gt_row() {
    let config = config_with_gt(vec![make_placement("region", PivotFieldArea::Row, 0, None)]);
    let data = sample_sales_data();

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let bounds = &result.rendered_bounds;

    // Bug B fix — header row reserved even when column_headers is empty.
    assert_eq!(
        bounds.first_data_row, 1,
        "first_data_row must be 1 to reserve the row-field header row",
    );

    // total_rows = header (1) + N data rows + GT row (1).
    let n = result.rows.len() as u32;
    assert_eq!(
        bounds.total_rows,
        1 + n + 1,
        "total_rows must be header + rows + GT (got {} for n={})",
        bounds.total_rows,
        n,
    );

    // Bug A fix — row GT framing is Some(empty), not None.
    assert!(
        result.grand_totals.row.is_some(),
        "row GT must be Some(...) to reserve the GT row label",
    );
    assert!(
        result.grand_totals.row.as_ref().unwrap().is_empty(),
        "row GT must be empty (no measures, frame only), got {:?}",
        result.grand_totals.row,
    );

    // No column placements → no column GT, no corner.
    assert!(
        result.grand_totals.column.is_none(),
        "column GT must be None when no column placements (got {:?})",
        result.grand_totals.column,
    );
    assert!(
        result.grand_totals.grand.is_none(),
        "corner GT must be None when no column placements (got {:?})",
        result.grand_totals.grand,
    );

    // Caption is the materializer's source of truth.
    assert_eq!(
        result.grand_totals.row_label.as_deref(),
        Some("Grand Total"),
        "row_label must default to 'Grand Total'",
    );

    // No column or value placements → no column headers at all.
    assert!(
        result.column_headers.is_empty(),
        "column_headers must be empty when no column or value placements (got {:?})",
        result.column_headers,
    );
}

// --------------------------------------------------------------------------
// r=0, c=1, v=0 — cols-only, no values
// --------------------------------------------------------------------------

/// One column field, no row field, no value field. The pivot must emit
/// column headers, frame the column GT slot for its label, and emit no
/// row GT.
#[test]
fn cols_only_no_values_frames_column_headers_and_gt_column() {
    let config = config_with_gt(vec![make_placement(
        "region",
        PivotFieldArea::Column,
        0,
        None,
    )]);
    let data = sample_sales_data();

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let bounds = &result.rendered_bounds;
    assert_eq!(
        bounds.first_data_row, 1,
        "first_data_row must be 1 (one column-header level)",
    );
    assert_eq!(
        bounds.first_data_col, 0,
        "first_data_col must be 0 (no row placements)",
    );

    // column_headers has exactly one level (the column field). No value-
    // headers row because v=0.
    assert_eq!(
        result.column_headers.len(),
        1,
        "column_headers must have exactly 1 level (got {:?})",
        result
            .column_headers
            .iter()
            .map(|ch| ch.headers.len())
            .collect::<Vec<_>>(),
    );

    // num_data_cols = sum of depth-0 spans = column_leaves * max(v, 1) = leaves * 1.
    let column_leaves: u32 = result.column_headers[0]
        .headers
        .iter()
        .map(|h| h.span as u32)
        .sum();
    assert_eq!(
        bounds.num_data_cols, column_leaves,
        "num_data_cols must equal sum of depth-0 spans = column_leaves",
    );

    // total_cols = 0 (no row headers) + leaves + 1 (GT column slot).
    assert_eq!(
        bounds.total_cols,
        column_leaves + 1,
        "total_cols must reserve a GT column for the header label",
    );

    // No row placements → no row GT.
    assert!(
        result.grand_totals.row.is_none(),
        "row GT must be None when no row placements (got {:?})",
        result.grand_totals.row,
    );

    // Bug A fix — column GT framing is Some(empty vec), not None.
    // Zero pivot rows means the outer vec is empty; framing only.
    assert!(
        result.grand_totals.column.is_some(),
        "column GT must be Some(...) to reserve the GT column label",
    );
    assert_eq!(
        result.grand_totals.column.as_ref().unwrap(),
        &Vec::<Vec<value_types::CellValue>>::new(),
        "column GT must be Some(vec![]) when no rows (frame only)",
    );

    // No row placements → no corner.
    assert!(
        result.grand_totals.grand.is_none(),
        "corner GT must be None when no row placements (got {:?})",
        result.grand_totals.grand,
    );
}

// --------------------------------------------------------------------------
// r=1, c=1, v=0 — rows + cols, no values
// --------------------------------------------------------------------------

/// One row field, one column field, no value field. Both GT axes frame, the
/// corner frames, and the rendered bounds reserve every slot.
#[test]
fn rows_and_cols_no_values_frames_full_frame() {
    let config = config_with_gt(vec![
        make_placement("region", PivotFieldArea::Row, 0, None),
        make_placement("product", PivotFieldArea::Column, 0, None),
    ]);
    let data = sample_sales_data();

    let result = compute(&config, &data, Some(&expand_all()));
    assert!(result.errors.is_none(), "errors: {:?}", result.errors);

    let bounds = &result.rendered_bounds;
    assert_eq!(bounds.first_data_row, 1);
    assert_eq!(bounds.first_data_col, 1);

    // total_rows = 1 (header) + N + 1 (row GT)
    let n = result.rows.len() as u32;
    assert_eq!(
        bounds.total_rows,
        1 + n + 1,
        "total_rows must be header + rows + GT row (n={})",
        n,
    );

    // total_cols = 1 (row header col) + leaves + 1 (col GT)
    let column_leaves: u32 = result.column_headers[0]
        .headers
        .iter()
        .map(|h| h.span as u32)
        .sum();
    assert_eq!(
        bounds.total_cols,
        1 + column_leaves + 1,
        "total_cols must be row-header + leaves + GT col",
    );

    // Row GT framing — Some(empty) since v=0.
    assert!(
        result.grand_totals.row.is_some(),
        "row GT must be Some(...) (frame)",
    );
    assert!(
        result.grand_totals.row.as_ref().unwrap().is_empty(),
        "row GT vec must be empty (no measures)",
    );

    // Column GT framing — Some(...) with one inner empty vec per pivot row.
    let col_gt = result
        .grand_totals
        .column
        .as_ref()
        .expect("column GT must be Some(...)");
    assert_eq!(
        col_gt.len(),
        result.rows.len(),
        "column GT outer length must equal pivot row count",
    );
    for (i, inner) in col_gt.iter().enumerate() {
        assert!(
            inner.is_empty(),
            "column GT inner[{}] must be empty (no measures), got {:?}",
            i,
            inner,
        );
    }

    // Corner GT — Some(empty) since v=0.
    assert_eq!(
        result.grand_totals.grand,
        Some(Vec::new()),
        "corner GT must be Some(empty) (frame, no values)",
    );

    // One column-header level (the column field). No value-headers row.
    assert_eq!(
        result.column_headers.len(),
        1,
        "column_headers must have exactly 1 level",
    );
}
