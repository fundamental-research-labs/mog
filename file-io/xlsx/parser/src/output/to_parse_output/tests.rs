use super::*;
use crate::domain::drawings::{Anchor, Drawing, OneCellAnchor};
use crate::output::results::{
    CELL_TYPE_VAL_BOOL as CELL_TYPE_BOOL, CELL_TYPE_VAL_EMPTY as CELL_TYPE_EMPTY,
    CELL_TYPE_VAL_FORMULA as CELL_TYPE_FORMULA, CELL_TYPE_VAL_NUMBER as CELL_TYPE_NUMBER,
    CELL_TYPE_VAL_STRING as CELL_TYPE_STRING,
};
use crate::output::results::{
    CommentOutput, CommentRunOutput, DefinedNameOutput, FullCellData, FullParseResult,
    FullParsedSheet, HyperlinkOutput, ParseStats, SmartArtPartsOutput, StylesOutput,
};
use domain_types::ImportedCellProjectionRole;
use domain_types::domain::comment::{CommentContentType, CommentType, RichTextRun};
use domain_types::domain::drawings::{DrawingContent, GroupShapeData};
use ooxml_types::worksheet::MergeRange;
use value_types::CellError;
use value_types::CellValue;

fn extent_test_cell(row: u32, col: u32) -> FullCellData {
    FullCellData {
        row,
        col,
        cell_type: CELL_TYPE_NUMBER,
        style_idx: 0,
        value: Some("1".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    }
}

fn test_cell(
    row: u32,
    col: u32,
    value: Option<&str>,
    formula: Option<&str>,
    array_ref: Option<&str>,
    cm: bool,
) -> FullCellData {
    FullCellData {
        row,
        col,
        cell_type: if formula.is_some() {
            CELL_TYPE_FORMULA
        } else {
            CELL_TYPE_NUMBER
        },
        style_idx: 0,
        value: value.map(str::to_string),
        formula: formula.map(str::to_string),
        force_recalc: false,
        array_ref: array_ref.map(str::to_string),
        cm,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    }
}

fn empty_style_cell(row: u32, col: u32, style_idx: u16, has_explicit_style: bool) -> FullCellData {
    FullCellData {
        row,
        col,
        cell_type: CELL_TYPE_EMPTY,
        style_idx,
        value: None,
        formula: None,
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style,
    }
}

#[test]
fn test_parse_error_codes() {
    assert_eq!(parse_error_code("#DIV/0!"), CellError::Div0);
    assert_eq!(parse_error_code("#VALUE!"), CellError::Value);
    assert_eq!(parse_error_code("#REF!"), CellError::Ref);
    assert_eq!(parse_error_code("#NAME?"), CellError::Name);
    assert_eq!(parse_error_code("#NUM!"), CellError::Num);
    assert_eq!(parse_error_code("#N/A"), CellError::Na);
    assert_eq!(parse_error_code("#NULL!"), CellError::Null);
    assert_eq!(parse_error_code("#SPILL!"), CellError::Spill);
    assert_eq!(parse_error_code("#CALC!"), CellError::Calc);
    assert_eq!(parse_error_code("unknown"), CellError::Value);
}

#[test]
fn compatibility_acknowledgements_count_ooxml_smartart_diagrams() {
    let sheets = vec![
        FullParsedSheet {
            smartart_diagrams: vec![smartart_parts(0), smartart_parts(1)],
            ..FullParsedSheet::default()
        },
        FullParsedSheet {
            smartart_diagrams: vec![smartart_parts(2)],
            ..FullParsedSheet::default()
        },
    ];

    assert_eq!(count_ooxml_smartart_diagrams(&sheets), 3);
}

#[test]
fn compatibility_acknowledgements_count_ooxml_wordart_text_effects() {
    let sheets = vec![FullParsedSheet {
        parsed_drawing: Some(Drawing {
            anchors: vec![
                wordart_shape_anchor(true),
                wordart_shape_anchor(false),
                wordart_shape_anchor(true),
                group_shape_anchor(vec![
                    wordart_shape_content(true),
                    wordart_shape_content(false),
                    DrawingContent::GroupShape(GroupShapeData {
                        children: vec![wordart_shape_content(true)],
                        ..GroupShapeData::default()
                    }),
                ]),
            ],
            ..Drawing::default()
        }),
        ..FullParsedSheet::default()
    }];

    assert_eq!(count_ooxml_wordart_text_effects(&sheets), 4);
}

#[test]
fn compatibility_acknowledgements_add_user_facing_messages() {
    let sheets = vec![FullParsedSheet {
        smartart_diagrams: vec![smartart_parts(0), smartart_parts(1), smartart_parts(2)],
        parsed_drawing: Some(Drawing {
            anchors: vec![wordart_shape_anchor(true), wordart_shape_anchor(true)],
            ..Drawing::default()
        }),
        ..FullParsedSheet::default()
    }];
    let mut diagnostics = domain_types::ParseDiagnostics::default();

    append_import_compatibility_acknowledgements(&sheets, &mut diagnostics);
    let messages: Vec<_> = diagnostics
        .import_report
        .expect("import report")
        .diagnostics
        .into_iter()
        .map(|diagnostic| diagnostic.message)
        .collect();

    assert!(messages.contains(&"Detected 3 diagrams from OOXML SmartArt. Diagram source metadata was preserved; editable Mog diagrams are not materialized yet.".to_string()));
    assert!(messages.contains(&"Loaded 2 text-effect objects from OOXML WordArt.".to_string()));
}

#[test]
fn convert_named_ranges_preserves_ct_defined_name_metadata() {
    let mut result = threading_result(FullParsedSheet::default(), None, Vec::new());
    result.defined_names = vec![DefinedNameOutput {
        name: "MyRange".to_string(),
        refers_to: "Sheet1!$A$1".to_string(),
        local_sheet_id: Some(0),
        hidden: true,
        comment: Some("comment text".to_string()),
        custom_menu: Some("menu text".to_string()),
        description: Some("description text".to_string()),
        help: Some("help text".to_string()),
        status_bar: Some("status text".to_string()),
        function: true,
        vb_procedure: true,
        xlm: true,
        publish_to_server: true,
        workbook_parameter: true,
        xml_space_preserve: true,
    }];

    let named_ranges = convert_named_ranges(&result);
    let nr = named_ranges.first().expect("converted named range");
    assert_eq!(nr.name, "MyRange");
    assert_eq!(nr.local_sheet_id, Some(0));
    assert!(nr.hidden);
    assert_eq!(nr.comment.as_deref(), Some("comment text"));
    assert_eq!(nr.custom_menu.as_deref(), Some("menu text"));
    assert_eq!(nr.description.as_deref(), Some("description text"));
    assert_eq!(nr.help.as_deref(), Some("help text"));
    assert_eq!(nr.status_bar.as_deref(), Some("status text"));
    assert!(nr.function);
    assert!(nr.vb_procedure);
    assert!(nr.xlm);
    assert!(nr.publish_to_server);
    assert!(nr.workbook_parameter);
    assert!(nr.xml_space_preserve);
}

fn smartart_parts(anchor_index: usize) -> SmartArtPartsOutput {
    SmartArtPartsOutput {
        anchor_index,
        data_xml: None,
        layout_xml: None,
        colors_xml: None,
        style_xml: None,
        drawing_xml: None,
    }
}

fn wordart_shape_anchor(from_word_art: bool) -> Anchor {
    let shape = wordart_shape(from_word_art);

    Anchor::OneCell(OneCellAnchor {
        from: ooxml_types::drawings::CellAnchor::default(),
        extent: ooxml_types::drawings::Extent::default(),
        content: DrawingContent::Shape(shape),
        client_data: ooxml_types::drawings::ClientData::default(),
        mc_alternate_content: None,
    })
}

fn wordart_shape_content(from_word_art: bool) -> DrawingContent {
    DrawingContent::Shape(wordart_shape(from_word_art))
}

fn wordart_shape(from_word_art: bool) -> ooxml_types::drawings::SpreadsheetShape {
    let mut shape = ooxml_types::drawings::SpreadsheetShape::default();
    shape.tx_body = Some(ooxml_types::drawings::TextBody {
        body_props: ooxml_types::drawings::TextBodyProperties {
            from_word_art: Some(from_word_art),
            ..ooxml_types::drawings::TextBodyProperties::default()
        },
        ..ooxml_types::drawings::TextBody::default()
    });
    shape
}

fn group_shape_anchor(children: Vec<DrawingContent>) -> Anchor {
    Anchor::OneCell(OneCellAnchor {
        from: ooxml_types::drawings::CellAnchor::default(),
        extent: ooxml_types::drawings::Extent::default(),
        content: DrawingContent::GroupShape(GroupShapeData {
            children,
            ..GroupShapeData::default()
        }),
        client_data: ooxml_types::drawings::ClientData::default(),
        mc_alternate_content: None,
    })
}

#[test]
fn test_resolve_cell_value_number() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_NUMBER,
        style_idx: 0,
        value: Some("42.5".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    match resolve_cell_value(&cell, &[]) {
        CellValue::Number(n) => assert_eq!(n.get(), 42.5),
        other => panic!("Expected Number, got {:?}", other),
    }
}

#[test]
fn projection_roles_preserve_authored_cm_cells_and_classify_only_proven_spills() {
    let sheet = FullParsedSheet {
        cells: vec![
            test_cell(0, 0, Some("1"), Some("SEQUENCE(2,2)"), Some("A1:B2"), true),
            test_cell(0, 1, Some("2"), None, None, true),
            test_cell(5, 30, Some("35.676741130091997"), None, None, true),
            test_cell(6, 30, Some("42"), None, None, false),
        ],
        ..FullParsedSheet::default()
    };
    let result = threading_result(sheet, None, Vec::new());

    let (output, _rt_ctx, _diagnostics) = full_parse_result_to_parse_output(&result);
    let cells = &output.sheets[0].cells;
    assert_eq!(cells.len(), 4);

    let role_at = |row, col| {
        cells
            .iter()
            .find(|cell| cell.row == row && cell.col == col)
            .map(|cell| cell.projection_role)
            .expect("cell exists")
    };

    assert_eq!(
        role_at(0, 0),
        ImportedCellProjectionRole::DynamicArraySource
    );
    assert_eq!(
        role_at(0, 1),
        ImportedCellProjectionRole::DynamicArraySpillTarget
    );
    assert_eq!(
        role_at(5, 30),
        ImportedCellProjectionRole::UnknownCellMetadata
    );
    assert_eq!(role_at(6, 30), ImportedCellProjectionRole::Normal);

    let authored_cm = cells
        .iter()
        .find(|cell| cell.row == 5 && cell.col == 30)
        .expect("authored cm cell is preserved");
    assert!(authored_cm.cm);
    assert!(authored_cm.formula.is_none());
    assert_eq!(
        authored_cm.original_value.as_deref(),
        Some("35.676741130091997")
    );
}

#[test]
fn test_resolve_cell_value_string() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_STRING,
        style_idx: 0,
        value: Some("hello".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    match resolve_cell_value(&cell, &[]) {
        CellValue::Text(s) => assert_eq!(&*s, "hello"),
        other => panic!("Expected Text, got {:?}", other),
    }
}

#[test]
fn test_resolve_cell_value_bool() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_BOOL,
        style_idx: 0,
        value: Some("1".to_string()),
        formula: None,
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    match resolve_cell_value(&cell, &[]) {
        CellValue::Boolean(b) => assert!(b),
        other => panic!("Expected Boolean(true), got {:?}", other),
    }
}

#[test]
fn test_resolve_cell_value_empty() {
    let cell = FullCellData {
        row: 0,
        col: 0,
        cell_type: CELL_TYPE_EMPTY,
        style_idx: 0,
        value: None,
        formula: None,
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    assert_eq!(resolve_cell_value(&cell, &[]), CellValue::Null);
}

#[test]
fn test_convert_cell_with_formula() {
    let cell = FullCellData {
        row: 1,
        col: 2,
        cell_type: CELL_TYPE_FORMULA,
        style_idx: 3,
        value: Some("42".to_string()),
        formula: Some("=A1+B1".to_string()),
        force_recalc: false,
        array_ref: None,
        cm: false,
        vm: None,
        cached_value_type: 0,
        cell_formula: None,
        preserve_space_formula: false,
        preserve_space_value: false,
        sst_index: None,
        has_explicit_style: false,
    };
    let cd = convert_cell(&cell, &[]);
    assert_eq!(cd.row, 1);
    assert_eq!(cd.col, 2);
    assert_eq!(cd.formula, Some("=A1+B1".to_string()));
    assert_eq!(cd.style_id, Some(3));
    match cd.value {
        CellValue::Number(n) => assert_eq!(n.get(), 42.0),
        other => panic!("Expected Number, got {:?}", other),
    }
}

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
        r_id: None,
        uid: None,
    });

    assert_eq!(compute_sheet_extent(&sheet), (4, 2));
}

#[test]
fn test_compute_sheet_extent_includes_comment_only_anchor() {
    let mut sheet = FullParsedSheet::default();
    sheet.comments.push(CommentOutput {
        cell_ref: "D6".to_string(),
        author_id: 0,
        text: "note".to_string(),
        runs: vec![],
        shape_id: None,
        xr_uid: None,
    });

    assert_eq!(compute_sheet_extent(&sheet), (6, 4));
}

#[test]
fn test_compute_sheet_extent_includes_merge_endpoint() {
    let mut sheet = FullParsedSheet::default();
    sheet.merges.push(MergeRange::from_coords(0, 0, 4, 3));

    assert_eq!(compute_sheet_extent(&sheet), (5, 4));
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

    let (sheet_data, sheet_rt) = convert_sheet(
        &sheet,
        &[],
        &[],
        &[],
        &[],
        &[],
        &std::collections::HashMap::new(),
    );

    assert!(sheet_data.cells.is_empty());
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
    assert_eq!(sheet_rt.explicit_blank_cells, vec![(2, 0)]);
    assert_eq!((sheet_data.rows, sheet_data.cols), (1, 2));
}

#[test]
fn test_extend_sheet_data_extent_includes_late_comment_anchor() {
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

    assert_eq!((sheet.rows, sheet.cols), (9, 6));
}

#[test]
fn legacy_tc_author_without_threaded_relationship_stays_note() {
    let sheet = FullParsedSheet {
        comments: vec![CommentOutput {
            cell_ref: "B2".to_string(),
            author_id: 0,
            text: "literal note".to_string(),
            runs: vec![comment_run("literal note")],
            shape_id: Some(42),
            xr_uid: Some("{LEGACY-XR-UID}".to_string()),
        }],
        comment_authors: vec!["tc={LITERAL-AUTHOR}".to_string()],
        ..Default::default()
    };

    let (sheet_data, _sheet_rt) = convert_sheet(
        &sheet,
        &[],
        &[],
        &[],
        &[],
        &[],
        &std::collections::HashMap::new(),
    );

    let comment = sheet_data.comments.first().expect("comment");
    assert_eq!(comment.comment_type, CommentType::Note);
    assert_eq!(comment.author, "tc={LITERAL-AUTHOR}");
    assert_eq!(comment.content.as_deref(), Some("literal note"));
    assert_eq!(comment.runs.len(), 1);
    assert_eq!(comment.runs[0].text, "literal note");
    assert_eq!(comment.thread_id, None);
    assert_eq!(comment.xr_uid.as_deref(), Some("{LEGACY-XR-UID}"));
    assert_eq!(comment.shape_id, Some(42));
}

#[test]
fn unreachable_threaded_part_does_not_upgrade_legacy_tc_note() {
    let mut sheets = vec![SheetData {
        comments: vec![Comment {
            cell_ref: "B2".to_string(),
            author: "tc={THREAD-1}".to_string(),
            content: Some("legacy text".to_string()),
            runs: vec![rich_run("legacy text")],
            xr_uid: Some("{THREAD-1}".to_string()),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }];
    let result = threading_result(
        FullParsedSheet::default(),
        None,
        vec![(
            "xl/threadedComments/threadedComment1.xml".to_string(),
            threaded_comments_xml().to_vec(),
        )],
    );

    merge_threaded_comments(&result, &mut sheets);

    let comment = sheets[0].comments.first().expect("comment");
    assert_eq!(comment.comment_type, CommentType::Note);
    assert_eq!(comment.author, "tc={THREAD-1}");
    assert_eq!(comment.thread_id, None);
    assert_eq!(comment.xr_uid.as_deref(), Some("{THREAD-1}"));
    assert_eq!(comment.content.as_deref(), Some("legacy text"));
}

#[test]
fn threaded_candidate_ids_prefers_tc_author_payload_before_xr_uid() {
    let comment = Comment {
        author: "tc={AUTHOR-CANDIDATE}".to_string(),
        xr_uid: Some("{XR-CANDIDATE}".to_string()),
        ..Default::default()
    };

    let candidates: Vec<_> = threaded_candidate_ids(&comment).collect();

    assert_eq!(candidates, vec!["{AUTHOR-CANDIDATE}", "{XR-CANDIDATE}"]);
}

#[test]
fn relationship_backed_threaded_comment_upgrades_legacy_sentinel_and_adds_reply() {
    let mut sheets = vec![SheetData {
        comments: vec![Comment {
            cell_ref: "B2".to_string(),
            author: "tc={THREAD-1}".to_string(),
            content: Some("[Threaded comment] fallback".to_string()),
            runs: vec![rich_run("[Threaded comment] fallback")],
            xr_uid: Some("{THREAD-1}".to_string()),
            shape_id: Some(7),
            comment_type: CommentType::Note,
            ..Default::default()
        }],
        ..Default::default()
    }];
    let parsed_sheet = FullParsedSheet {
        sheet_opc_rels: vec![ooxml_types::shared::OpcRelationship {
            id: "rIdThreadedComments".to_string(),
            rel_type: REL_TYPE_THREADED_COMMENT.to_string(),
            target: "../threadedComments/threadedComment1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };
    let result = threading_result(
        parsed_sheet,
        Some(
            br#"<personList><person displayName="Thread Author" id="P1"/><person displayName="Reply Author" id="P2"/></personList>"#
                .to_vec(),
        ),
        vec![(
            "xl/threadedComments/threadedComment1.xml".to_string(),
            threaded_comments_xml().to_vec(),
        )],
    );

    let persons = merge_threaded_comments(&result, &mut sheets);

    assert_eq!(persons.len(), 2);
    assert_eq!(sheets[0].comments.len(), 2);

    let root = &sheets[0].comments[0];
    assert_eq!(root.comment_type, CommentType::ThreadedComment);
    assert_eq!(root.thread_id.as_deref(), Some("{THREAD-1}"));
    assert_eq!(root.xr_uid, None);
    assert_eq!(root.author, "Thread Author");
    assert_eq!(root.content.as_deref(), Some("actual threaded root"));
    assert_eq!(root.person_id.as_deref(), Some("P1"));
    assert_eq!(root.timestamp.as_deref(), Some("2026-05-20T01:02:03Z"));
    assert_eq!(root.resolved, Some(true));
    assert_eq!(
        root.ext_lst_xml.as_deref(),
        Some("<extLst><ext uri=\"{x}\"/></extLst>")
    );
    assert_eq!(root.content_type, Some(CommentContentType::Mention));
    assert_eq!(root.mentions.len(), 1);
    assert_eq!(root.mentions[0].display_text, "Reply Author");
    assert_eq!(root.shape_id, Some(7));

    let reply = &sheets[0].comments[1];
    assert_eq!(reply.comment_type, CommentType::ThreadedComment);
    assert_eq!(reply.thread_id.as_deref(), Some("{REPLY-1}"));
    assert_eq!(reply.parent_id.as_deref(), Some("{THREAD-1}"));
    assert_eq!(reply.author, "Reply Author");
    assert_eq!(reply.content.as_deref(), Some("reply text"));
}

#[test]
fn threaded_merge_preserves_mixed_legacy_comment_order() {
    let mut sheets = vec![SheetData {
        comments: vec![
            Comment {
                cell_ref: "B2".to_string(),
                author: "tc={THREAD-1}".to_string(),
                content: Some("[Threaded comment] fallback".to_string()),
                runs: vec![rich_run("[Threaded comment] fallback")],
                xr_uid: Some("{THREAD-1}".to_string()),
                comment_type: CommentType::Note,
                ..Default::default()
            },
            Comment {
                cell_ref: "C3".to_string(),
                author: "Legacy Author".to_string(),
                content: Some("legacy note".to_string()),
                runs: vec![rich_run("legacy note")],
                comment_type: CommentType::Note,
                ..Default::default()
            },
            Comment {
                cell_ref: "D4".to_string(),
                author: "tc={THREAD-2}".to_string(),
                content: Some("[Threaded comment] fallback 2".to_string()),
                runs: vec![rich_run("[Threaded comment] fallback 2")],
                xr_uid: Some("{THREAD-2}".to_string()),
                comment_type: CommentType::Note,
                ..Default::default()
            },
        ],
        ..Default::default()
    }];
    let parsed_sheet = FullParsedSheet {
        sheet_opc_rels: vec![ooxml_types::shared::OpcRelationship {
            id: "rIdThreadedComments".to_string(),
            rel_type: REL_TYPE_THREADED_COMMENT.to_string(),
            target: "../threadedComments/threadedComment1.xml".to_string(),
            target_mode: None,
        }],
        ..Default::default()
    };
    let result = threading_result(
        parsed_sheet,
        Some(br#"<personList><person displayName="Thread Author" id="P1"/></personList>"#.to_vec()),
        vec![(
            "xl/threadedComments/threadedComment1.xml".to_string(),
            br#"<ThreadedComments>
    <threadedComment ref="B2" id="{THREAD-1}" personId="P1"><text>root one</text></threadedComment>
    <threadedComment ref="D4" id="{THREAD-2}" personId="P1"><text>root two</text></threadedComment>
</ThreadedComments>"#
                .to_vec(),
        )],
    );

    merge_threaded_comments(&result, &mut sheets);

    let comments = &sheets[0].comments;
    assert_eq!(comments.len(), 3);
    assert_eq!(comments[0].cell_ref, "B2");
    assert_eq!(comments[0].comment_type, CommentType::ThreadedComment);
    assert_eq!(comments[1].cell_ref, "C3");
    assert_eq!(comments[1].comment_type, CommentType::Note);
    assert_eq!(comments[1].author, "Legacy Author");
    assert_eq!(comments[2].cell_ref, "D4");
    assert_eq!(comments[2].comment_type, CommentType::ThreadedComment);
}

#[test]
fn test_normalize_rgb_color() {
    assert_eq!(normalize_rgb_color("#FF0000"), "#FF0000");
    assert_eq!(normalize_rgb_color("FF0000"), "#FF0000");
    assert_eq!(normalize_rgb_color("FFFF0000"), "#FF0000"); // ARGB
}

fn comment_run(text: &str) -> CommentRunOutput {
    CommentRunOutput {
        text: text.to_string(),
        font_name: Some("Tahoma".to_string()),
        font_size: Some(9.0),
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        color: None,
        color_indexed: Some(81),
        color_theme: None,
        color_tint: None,
        font_family: Some(2),
        scheme: None,
        charset: Some(1),
        vert_align: None,
        preserve_space: false,
    }
}

fn rich_run(text: &str) -> RichTextRun {
    RichTextRun {
        text: text.to_string(),
        font_name: Some("Tahoma".to_string()),
        font_size: Some(9.0),
        color_indexed: Some(81),
        charset: Some(1),
        family: Some(2),
        ..Default::default()
    }
}

fn threaded_comments_xml() -> &'static [u8] {
    br#"<ThreadedComments>
    <threadedComment ref="B2" id="{THREAD-1}" personId="P1" dT="2026-05-20T01:02:03Z" done="1">
        <text>actual threaded root</text>
        <mentions><mention mentionpersonId="P2" startIndex="0" length="4"/></mentions>
        <extLst><ext uri="{x}"/></extLst>
    </threadedComment>
    <threadedComment ref="B2" id="{REPLY-1}" personId="P2" parentId="{THREAD-1}">
        <text>reply text</text>
    </threadedComment>
</ThreadedComments>"#
}

fn threading_result(
    sheet: FullParsedSheet,
    raw_persons_xml: Option<Vec<u8>>,
    raw_threaded_comments: Vec<(String, Vec<u8>)>,
) -> FullParseResult {
    FullParseResult {
        sheets: vec![sheet],
        shared_strings: Vec::new(),
        shared_strings_rich_runs: Vec::new(),
        shared_strings_phonetic_xml: Vec::new(),
        styles: StylesOutput::from(&crate::domain::styles::read::Stylesheet::default()),
        theme: None,
        defined_names: Vec::new(),
        workbook_protection: None,
        errors: Vec::new(),
        stats: ParseStats::default(),
        calc_id: None,
        iterative_calc: false,
        max_iterations: None,
        max_change: None,
        calc_pr_settings: None,
        pivot_caches: std::collections::HashMap::new(),
        pivot_cache_paths: Vec::new(),
        slicer_caches: Vec::new(),
        theme_name: None,
        theme_color_scheme: None,
        theme_font_scheme: None,
        theme_format_scheme: None,
        theme_object_defaults_xml: None,
        theme_extra_clr_scheme_lst_xml: None,
        theme_ext_lst_xml: None,
        styles_ext_lst_xml: None,
        parsed_stylesheet: None,
        doc_props_core: None,
        doc_props_app: None,
        doc_props_custom: None,
        raw_doc_props_core_xml: None,
        raw_doc_props_app_xml: None,
        raw_doc_props_custom_xml: None,
        metadata: None,
        content_type_defaults: Vec::new(),
        content_type_overrides: Vec::new(),
        root_relationships: Vec::new(),
        workbook_relationships: Vec::new(),
        sheet_workbook_r_ids: Vec::new(),
        extensions: None,
        raw_metadata_xml: None,
        raw_doc_metadata_label_info: None,
        raw_shared_strings_xml: None,
        external_links: Vec::new(),
        custom_xml_parts: Vec::new(),
        raw_persons_xml,
        raw_threaded_comments,
        workbook_views: Vec::new(),
        workbook_properties: None,
        file_version: None,
        file_sharing: None,
    }
}

#[test]
fn workbook_views_populate_parse_output_and_round_trip_context() {
    let mut result = threading_result(FullParsedSheet::default(), None, Vec::new());
    result.workbook_views = vec![
        ooxml_types::workbook::BookView {
            active_tab: 2,
            first_sheet: 1,
            visibility: ooxml_types::workbook::Visibility::Hidden,
            minimized: true,
            show_horizontal_scroll: false,
            show_vertical_scroll: true,
            show_sheet_tabs: false,
            auto_filter_date_grouping: false,
            x_window: Some(120),
            y_window: Some(240),
            window_width: Some(14400),
            window_height: Some(9000),
            tab_ratio: Some(725.5),
            xr_uid: Some("{VIEW-1}".to_string()),
            ext_lst: None,
        },
        ooxml_types::workbook::BookView {
            active_tab: 0,
            first_sheet: 0,
            window_width: Some(8000),
            ..Default::default()
        },
    ];

    let (output, round_trip, _diagnostics) = full_parse_result_to_parse_output(&result);

    assert_eq!(output.workbook_views.len(), 2);
    assert_eq!(round_trip.workbook_views, output.workbook_views);

    let primary = &output.workbook_views[0];
    assert_eq!(primary.active_tab, 2);
    assert_eq!(primary.first_sheet, 1);
    assert_eq!(
        primary.visibility,
        domain_types::domain::workbook::WorkbookViewVisibility::Hidden
    );
    assert!(primary.minimized);
    assert!(!primary.show_horizontal_scroll);
    assert!(primary.show_vertical_scroll);
    assert!(!primary.show_sheet_tabs);
    assert!(!primary.auto_filter_date_grouping);
    assert_eq!(primary.x_window, Some(120));
    assert_eq!(primary.y_window, Some(240));
    assert_eq!(primary.window_width, Some(14400));
    assert_eq!(primary.window_height, Some(9000));
    assert_eq!(primary.tab_ratio, Some(725.5));
    assert_eq!(primary.uid.as_deref(), Some("{VIEW-1}"));
    assert_eq!(output.workbook_views[1].window_width, Some(8000));
}
