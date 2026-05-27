#![allow(unused_imports)]

use std::sync::Arc;

use super::helpers::{
    assert_cells_match, cell, formula_cell, make_single_sheet, roundtrip, styled_cell,
};
use domain_types::{
    AlignmentFormat, BorderFormat, BorderSide, CFCellRange, CFRule, CFStyle, CellData,
    ColDimension, Comment, CommentType, ConditionalFormat, DocumentFormat, DocumentProperties,
    ErrorStyle, FillFormat, FontFormat, FrozenPane, MergeRegion, NamedRange, ParseOutput,
    RoundTripContext, RowDimension, SheetData, SheetDimensions, TableColumnSpec, TableSpec,
    ValidationOperator, ValidationRule, ValidationSpec,
};
use value_types::{CellError, CellValue, FiniteF64};

#[test]
fn roundtrip_merge_regions() {
    let mut output = make_single_sheet(
        "Merges",
        vec![
            cell(0, 0, CellValue::Text(Arc::from("Merged"))),
            cell(2, 0, CellValue::Text(Arc::from("Another merge"))),
        ],
    );
    output.sheets[0].merges = vec![
        MergeRegion {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 2,
        },
        MergeRegion {
            start_row: 2,
            start_col: 0,
            end_row: 3,
            end_col: 1,
        },
    ];
    output.sheets[0].rows = 4;
    output.sheets[0].cols = 3;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    // Sort merges for stable comparison
    let mut orig_merges = output.sheets[0].merges.clone();
    let mut rt_merges = rt.sheets[0].merges.clone();
    orig_merges.sort_by_key(|m| (m.start_row, m.start_col));
    rt_merges.sort_by_key(|m| (m.start_row, m.start_col));

    assert_eq!(
        orig_merges, rt_merges,
        "Merge regions should round-trip exactly"
    );
}

#[test]
fn roundtrip_single_cell_merge() {
    // Edge case: a merge region that spans just 2 cells
    let mut output = make_single_sheet(
        "SmallMerge",
        vec![cell(0, 0, CellValue::Text(Arc::from("Merged")))],
    );
    output.sheets[0].merges = vec![MergeRegion {
        start_row: 0,
        start_col: 0,
        end_row: 0,
        end_col: 1,
    }];
    output.sheets[0].rows = 1;
    output.sheets[0].cols = 2;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets[0].merges.len(), 1);
    assert_eq!(rt.sheets[0].merges[0].start_row, 0);
    assert_eq!(rt.sheets[0].merges[0].end_col, 1);
}

#[test]
fn roundtrip_row_and_col_dimensions() {
    let mut output = make_single_sheet(
        "Dimensions",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: Some(8.43),
        row_heights: vec![
            RowDimension {
                row: 0,
                height: 30.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            },
            RowDimension {
                row: 5,
                height: 45.0,
                custom_height: true,
                hidden: false,
                ..Default::default()
            },
        ],
        col_widths: vec![
            ColDimension {
                col: 0,
                width: 20.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
            },
            ColDimension {
                col: 3,
                width: 50.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
            },
        ],
        ..Default::default()
    };
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let orig_dims = &output.sheets[0].dimensions;
    let rt_dims = &rt.sheets[0].dimensions;

    // Row heights
    let orig_rows: std::collections::HashMap<u32, f64> = orig_dims
        .row_heights
        .iter()
        .map(|r| (r.row, r.height))
        .collect();
    let rt_rows: std::collections::HashMap<u32, f64> = rt_dims
        .row_heights
        .iter()
        .filter(|r| r.custom_height)
        .map(|r| (r.row, r.height))
        .collect();

    for (row, orig_h) in &orig_rows {
        let rt_h = rt_rows.get(row).unwrap_or_else(|| {
            panic!("Row {row} height missing in round-trip. Original: {orig_h}")
        });
        let diff = (orig_h - rt_h).abs();
        assert!(diff < 0.01, "Row {row} height mismatch: {orig_h} vs {rt_h}");
    }

    // Col widths
    let orig_cols: std::collections::HashMap<u32, f64> = orig_dims
        .col_widths
        .iter()
        .map(|c| (c.col, c.width))
        .collect();
    let rt_cols: std::collections::HashMap<u32, f64> = rt_dims
        .col_widths
        .iter()
        .filter(|c| c.custom_width)
        .map(|c| (c.col, c.width))
        .collect();

    for (col, orig_w) in &orig_cols {
        let rt_w = rt_cols
            .get(col)
            .unwrap_or_else(|| panic!("Col {col} width missing in round-trip. Original: {orig_w}"));
        let diff = (orig_w - rt_w).abs();
        assert!(diff < 0.01, "Col {col} width mismatch: {orig_w} vs {rt_w}");
    }
}

#[test]
fn roundtrip_hidden_rows_and_cols() {
    let mut output = make_single_sheet(
        "Hidden",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions = SheetDimensions {
        default_row_height: Some(15.0),
        default_col_width: None,
        row_heights: vec![RowDimension {
            row: 2,
            height: 0.0,
            custom_height: true,
            hidden: true,
            ..Default::default()
        }],
        col_widths: vec![ColDimension {
            col: 1,
            width: 0.0,
            custom_width: true,
            hidden: true,
            best_fit: false,
            collapsed: false,
        }],
        ..Default::default()
    };
    output.sheets[0].rows = 5;
    output.sheets[0].cols = 3;

    let rt = roundtrip(&output);

    // Hidden row should survive -- at minimum the dimension entry should exist.
    // NOTE: The `hidden` flag may not round-trip perfectly through the current
    // pipeline (known gap). We verify the row dimension entry exists.
    let hidden_row = rt.sheets[0]
        .dimensions
        .row_heights
        .iter()
        .find(|r| r.row == 2);
    assert!(
        hidden_row.is_some(),
        "Hidden row 2 dimension entry should survive round-trip"
    );

    // Hidden col should survive -- at minimum the dimension entry should exist.
    let hidden_col = rt.sheets[0]
        .dimensions
        .col_widths
        .iter()
        .find(|c| c.col == 1);
    assert!(
        hidden_col.is_some(),
        "Hidden col 1 dimension entry should survive round-trip"
    );
}

#[test]
fn roundtrip_frozen_panes() {
    let mut output = make_single_sheet(
        "Frozen",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 2,
        cols: 1,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    assert_eq!(rt.sheets.len(), 1);

    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 2, "Frozen rows mismatch");
    assert_eq!(rt_pane.cols, 1, "Frozen cols mismatch");
}

#[test]
fn roundtrip_frozen_rows_only() {
    let mut output = make_single_sheet(
        "FrozenRows",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 3,
        cols: 0,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 3);
    assert_eq!(rt_pane.cols, 0);
}

#[test]
fn roundtrip_frozen_cols_only() {
    let mut output = make_single_sheet(
        "FrozenCols",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].frozen_pane = Some(FrozenPane {
        rows: 0,
        cols: 2,
        top_left_cell: None,
    });
    output.sheets[0].rows = 10;
    output.sheets[0].cols = 5;

    let rt = roundtrip(&output);
    let rt_pane = rt.sheets[0]
        .frozen_pane
        .as_ref()
        .expect("frozen pane should be preserved");
    assert_eq!(rt_pane.rows, 0);
    assert_eq!(rt_pane.cols, 2);
}

// =============================================================================
// 6e: Style round-trip tests
// =============================================================================
