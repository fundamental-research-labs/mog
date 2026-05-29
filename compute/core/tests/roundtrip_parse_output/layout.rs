use std::sync::Arc;

use super::helpers::*;
use domain_types::{
    ColDimension, FrozenPane, MergeRegion, RowDimension, RowXmlHints, SheetDimensions,
};
use value_types::{CellValue, FiniteF64};

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
                phonetic: false,
                ..Default::default()
            },
            ColDimension {
                col: 3,
                width: 50.0,
                custom_width: true,
                hidden: false,
                best_fit: false,
                collapsed: false,
                phonetic: false,
                ..Default::default()
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
fn roundtrip_row_metadata_through_yrs() {
    let mut output = make_single_sheet(
        "Row metadata",
        vec![cell(0, 0, CellValue::Number(FiniteF64::new(1.0).unwrap()))],
    );
    output.sheets[0].dimensions.row_heights = vec![
        RowDimension {
            row: 0,
            hidden: false,
            explicit_hidden: true,
            outline_level: Some(0),
            explicit_outline_level_zero: true,
            collapsed: Some(false),
            thick_top: true,
            thick_bot: true,
            xml_hints: RowXmlHints {
                spans: Some("1:4".to_string()),
                bare_empty: false,
            },
            ..Default::default()
        },
        RowDimension {
            row: 3,
            xml_hints: RowXmlHints {
                spans: None,
                bare_empty: true,
            },
            ..Default::default()
        },
    ];
    output.sheets[0].rows = 4;
    output.sheets[0].cols = 1;

    let rt = roundtrip(&output);
    let rows = &rt.sheets[0].dimensions.row_heights;
    let row0 = rows.iter().find(|r| r.row == 0).expect("row 1 metadata");
    assert!(row0.explicit_hidden);
    assert_eq!(row0.outline_level, Some(0));
    assert!(row0.explicit_outline_level_zero);
    assert_eq!(row0.collapsed, Some(false));
    assert!(row0.thick_top);
    assert!(row0.thick_bot);
    assert_eq!(row0.xml_hints.spans.as_deref(), Some("1:4"));

    let row3 = rows.iter().find(|r| r.row == 3).expect("bare row metadata");
    assert!(row3.xml_hints.bare_empty);
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
