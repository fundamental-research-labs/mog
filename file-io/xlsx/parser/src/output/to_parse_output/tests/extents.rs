use super::super::{
    compute_dimensions, compute_sheet_extent, convert_sheet, extend_sheet_data_extent, non_empty,
};
use super::helpers::{empty_style_cell, extent_test_cell};
use crate::output::results::{CommentOutput, FullParsedSheet, HyperlinkOutput};
use domain_types::{AuthoredStyleRun, Comment, SheetData};
use ooxml_types::worksheet::{ColWidth, MergeRange};

#[test]
fn test_non_empty() {
    assert_eq!(non_empty(""), None);
    assert_eq!(non_empty("hello"), Some("hello".to_string()));
}

#[test]
fn test_compute_dimensions_empty() {
    assert_eq!(compute_dimensions(&[]), (0, 0));
}

#[test]
fn test_compute_sheet_extent_includes_hyperlink_only_anchor() {
    let mut sheet = FullParsedSheet {
        cells: vec![extent_test_cell(0, 0), extent_test_cell(1, 1)],
        ..Default::default()
    };
    sheet.hyperlinks.push(HyperlinkOutput {
        cell_ref: "A4".to_string(),
        location: String::new(),
        display: String::new(),
        tooltip: String::new(),
        target: None,
        r_id: None,
        uid: None,
        target_kind: None,
        target_mode: None,
    });

    assert_eq!(compute_sheet_extent(&sheet), (4, 2));
}

#[test]
fn test_compute_sheet_extent_excludes_comment_only_anchor() {
    let mut sheet = FullParsedSheet::default();
    sheet.comments.push(CommentOutput {
        cell_ref: "D6".to_string(),
        author_id: 0,
        text: "note".to_string(),
        runs: vec![],
        shape_id: None,
        xr_uid: None,
        comment_pr: None,
    });

    assert_eq!(compute_sheet_extent(&sheet), (0, 0));
}

#[test]
fn test_compute_sheet_extent_includes_merge_endpoint() {
    let mut sheet = FullParsedSheet::default();
    sheet.merges.push(MergeRange::from_coords(0, 0, 4, 3));

    assert_eq!(compute_sheet_extent(&sheet), (5, 4));
}

#[test]
fn full_width_column_style_does_not_inflate_extent_or_dense_col_styles() {
    let mut full_width_style = ColWidth::range(1, 16_384, 0.0).with_style(7);
    full_width_style.width = None;
    let sheet = FullParsedSheet {
        col_widths: vec![full_width_style],
        ..Default::default()
    };

    assert_eq!(compute_sheet_extent(&sheet), (0, 0));

    let sheet_data = convert_sheet(
        &sheet,
        &[],
        &[],
        &[],
        &[],
        &[],
        &std::collections::HashMap::new(),
        &std::collections::HashMap::<String, Vec<u8>>::new(),
        None,
    );

    assert_eq!((sheet_data.rows, sheet_data.cols), (0, 0));
    assert!(sheet_data.col_styles.is_empty());
    assert_eq!(
        sheet_data.col_style_ranges,
        vec![domain_types::ColStyleRange {
            start_col: 0,
            end_col: 16_383,
            style_id: 7,
        }]
    );
    assert!(sheet_data.dimensions.trailing_col_ranges.is_empty());
}

#[test]
fn style_only_cells_convert_to_authored_runs_not_sparse_cells() {
    let sheet = FullParsedSheet {
        cells: vec![
            empty_style_cell(0, 0, 0, true),
            empty_style_cell(0, 1, 7, true),
        ],
        explicit_blank_cells: vec![(2, 0)],
        ..Default::default()
    };

    let sheet_data = convert_sheet(
        &sheet,
        &[],
        &[],
        &[],
        &[],
        &[],
        &std::collections::HashMap::new(),
        &std::collections::HashMap::<String, Vec<u8>>::new(),
        None,
    );

    assert_eq!(sheet_data.cells.len(), 1);
    assert_eq!(sheet_data.cells[0].row, 2);
    assert_eq!(sheet_data.cells[0].col, 0);
    assert!(sheet_data.cells[0].value.is_null());
    assert_eq!(
        sheet_data.authored_style_runs,
        vec![
            AuthoredStyleRun {
                start_row: 0,
                start_col: 0,
                end_row: 0,
                end_col: 0,
                style_id: 0,
            },
            AuthoredStyleRun {
                start_row: 0,
                start_col: 1,
                end_row: 0,
                end_col: 1,
                style_id: 7,
            },
        ]
    );
    assert_eq!((sheet_data.rows, sheet_data.cols), (3, 2));
}

#[test]
fn test_extend_sheet_data_extent_excludes_late_comment_anchor() {
    let mut sheet = SheetData {
        rows: 1,
        cols: 1,
        comments: vec![Comment {
            cell_ref: "F9".to_string(),
            ..Default::default()
        }],
        ..Default::default()
    };

    extend_sheet_data_extent(&mut sheet);

    assert_eq!((sheet.rows, sheet.cols), (1, 1));
    assert_eq!(sheet.comments[0].cell_ref, "F9");
}
