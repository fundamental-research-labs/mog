use std::sync::Arc;

use cell_types::SheetId;
use compute_core::storage::engine::YrsComputeEngine;
use domain_types::domain::comment::CommentType;
use domain_types::{CellData, Comment, ParseOutput, SheetData};
use value_types::CellValue;
use xlsx_parser::write::write_xlsx_from_parse_output;

fn text_cell(row: u32, col: u32, text: &str) -> CellData {
    CellData {
        row,
        col,
        value: CellValue::Text(Arc::from(text)),
        ..Default::default()
    }
}

fn fixture_parse_output() -> ParseOutput {
    ParseOutput {
        sheets: vec![SheetData {
            name: "CommentAnchors".to_string(),
            rows: 1,
            cols: 1,
            cells: vec![text_cell(0, 0, "data")],
            comments: vec![
                Comment {
                    cell_ref: "AV1".to_string(),
                    author: "Wide".to_string(),
                    content: Some("wide empty anchor".to_string()),
                    comment_type: CommentType::Note,
                    ..Default::default()
                },
                Comment {
                    cell_ref: "B111".to_string(),
                    author: "HexLike".to_string(),
                    content: Some("A1-looking hex guard".to_string()),
                    comment_type: CommentType::Note,
                    ..Default::default()
                },
            ],
            ..Default::default()
        }],
        ..Default::default()
    }
}

fn is_cell_id_hex(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn stored_comment_by_author<'a>(comments: &'a [Comment], author: &str) -> &'a Comment {
    comments
        .iter()
        .find(|comment| comment.author == author)
        .unwrap_or_else(|| panic!("missing stored comment by {author}"))
}

fn exported_ref_by_author<'a>(comments: &'a [Comment], author: &str) -> &'a str {
    comments
        .iter()
        .find(|comment| comment.author == author)
        .map(|comment| comment.cell_ref.as_str())
        .unwrap_or_else(|| panic!("missing exported comment by {author}"))
}

#[test]
fn l2_preserves_empty_comment_anchor_identity_without_data_cells() {
    let input = fixture_parse_output();
    let input_bytes = write_xlsx_from_parse_output(&input).expect("write input xlsx");

    let (engine, _) = YrsComputeEngine::from_xlsx_bytes(&input_bytes).expect("from_xlsx_bytes");
    let sheet_id = SheetId::from_uuid_str(
        engine
            .get_sheet_order()
            .first()
            .expect("imported workbook should have a sheet"),
    )
    .expect("sheet id");

    let stored_comments = engine.get_all_comments(&sheet_id);
    assert_eq!(stored_comments.len(), 2);

    for (author, row, col) in [("Wide", 0, 47), ("HexLike", 110, 1)] {
        let comment = stored_comment_by_author(&stored_comments, author);
        assert!(
            is_cell_id_hex(&comment.cell_ref),
            "hydrated comment ref for {author} should be CellId hex, got {}",
            comment.cell_ref
        );

        let grid_cell = engine
            .get_cell_id_at(&sheet_id, row, col)
            .unwrap_or_else(|| panic!("{author} anchor should resolve in runtime GridIndex"));
        assert_eq!(grid_cell, comment.cell_ref);

        let pos = engine
            .get_cell_position(&sheet_id, &comment.cell_ref)
            .unwrap_or_else(|| panic!("{author} CellId should resolve to a position"));
        assert_eq!((pos.row, pos.col), (row, col));
    }

    let exported = engine
        .export_to_parse_output()
        .expect("export_to_parse_output")
        .parse_output;
    let sheet = &exported.sheets[0];
    assert_eq!(sheet.rows, 1, "comment-only anchors must not grow rows");
    assert_eq!(sheet.cols, 1, "comment-only anchors must not grow cols");
    assert_eq!(exported_ref_by_author(&sheet.comments, "Wide"), "AV1");
    assert_eq!(exported_ref_by_author(&sheet.comments, "HexLike"), "B111");
    assert!(
        !sheet
            .cells
            .iter()
            .any(|cell| matches!((cell.row, cell.col), (0, 47) | (110, 1))),
        "comment-only anchors must not export data cells"
    );

    let exported_bytes = engine.export_to_xlsx_bytes().expect("export_to_xlsx_bytes");
    let (reparsed, _diagnostics) =
        xlsx_parser::parse_xlsx_to_output(&exported_bytes).expect("parse exported xlsx");
    let reparsed_sheet = &reparsed.sheets[0];
    assert_eq!(
        exported_ref_by_author(&reparsed_sheet.comments, "Wide"),
        "AV1"
    );
    assert_eq!(
        exported_ref_by_author(&reparsed_sheet.comments, "HexLike"),
        "B111"
    );
    assert!(
        !reparsed_sheet
            .cells
            .iter()
            .any(|cell| matches!((cell.row, cell.col), (0, 47) | (110, 1))),
        "reparsed XLSX must not contain data cells for comment-only anchors"
    );
}
