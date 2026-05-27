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
use xlsx_parser::parse_xlsx_to_output;
use xlsx_parser::write::write_xlsx_from_parse_output;

// =============================================================================

/// Round-trip through write_xlsx_from_parse_output with a RoundTripContext,
/// then parse back and verify the workbook.xml.rels relationship IDs.
fn roundtrip_with_ctx(
    output: &ParseOutput,
    ctx: &RoundTripContext,
) -> (ParseOutput, RoundTripContext) {
    let bytes = write_xlsx_from_parse_output(output, Some(ctx))
        .expect("write_xlsx_from_parse_output should succeed");
    assert!(bytes.len() > 4);
    assert_eq!(&bytes[0..2], b"PK");
    let (rt_output, rt_ctx, _diag) =
        parse_xlsx_to_output(&bytes).expect("parse_xlsx_to_output should succeed");
    (rt_output, rt_ctx)
}

/// Build a multi-sheet ParseOutput for rId tests.
fn make_multi_sheet(count: usize) -> ParseOutput {
    let sheets = (0..count)
        .map(|i| SheetData {
            name: format!("Sheet{}", i + 1),
            rows: 1,
            cols: 1,
            cells: vec![cell(0, 0, CellValue::Text(Arc::from(format!("data{}", i))))],
            ..Default::default()
        })
        .collect();
    ParseOutput {
        sheets,
        ..Default::default()
    }
}

#[test]
fn roundtrip_workbook_rels_preserves_non_sequential_rids() {
    // Create a 3-sheet workbook and get initial RoundTripContext
    let mut output = make_multi_sheet(3);
    output.theme = Some(domain_types::ThemeData {
        name: Some("Office Theme".to_string()),
        ..Default::default()
    });
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let (_po, mut ctx, _d) = parse_xlsx_to_output(&bytes).unwrap();

    // Simulate an original file where rIds are NOT sequential starting from rId1.
    // Original ordering: rId10=styles, rId20=theme, rId5=sheet1, rId6=sheet2, rId7=sheet3, rId30=sharedStrings
    let ws_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
    let styles_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";
    let theme_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
    let ss_type =
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings";

    ctx.workbook_relationships = vec![
        domain_types::OpcRelationship {
            id: "rId10".into(),
            rel_type: styles_type.into(),
            target: "styles.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId20".into(),
            rel_type: theme_type.into(),
            target: "theme/theme1.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId5".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet1.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId6".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet2.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId7".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet3.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId30".into(),
            rel_type: ss_type.into(),
            target: "sharedStrings.xml".into(),
            target_mode: None,
        },
    ];
    ctx.sheet_workbook_r_ids = vec!["rId5".into(), "rId6".into(), "rId7".into()];

    // Round-trip with the custom context
    let (_rt_output, rt_ctx) = roundtrip_with_ctx(&output, &ctx);

    // Verify the re-parsed workbook relationships preserve the original rIds
    let find_rel = |rels: &[domain_types::OpcRelationship], target: &str| -> Option<String> {
        rels.iter()
            .find(|r| r.target == target)
            .map(|r| r.id.clone())
    };

    let wb_rels = &rt_ctx.workbook_relationships;
    assert_eq!(
        find_rel(wb_rels, "styles.xml"),
        Some("rId10".into()),
        "styles.xml should keep rId10"
    );
    assert_eq!(
        find_rel(wb_rels, "theme/theme1.xml"),
        Some("rId20".into()),
        "theme should keep rId20"
    );
    assert_eq!(
        find_rel(wb_rels, "worksheets/sheet1.xml"),
        Some("rId5".into()),
        "sheet1 should keep rId5"
    );
    assert_eq!(
        find_rel(wb_rels, "worksheets/sheet2.xml"),
        Some("rId6".into()),
        "sheet2 should keep rId6"
    );
    assert_eq!(
        find_rel(wb_rels, "worksheets/sheet3.xml"),
        Some("rId7".into()),
        "sheet3 should keep rId7"
    );
    assert_eq!(
        find_rel(wb_rels, "sharedStrings.xml"),
        Some("rId30".into()),
        "sharedStrings should keep rId30"
    );
}

#[test]
fn roundtrip_workbook_rels_sheet_rids_used_in_workbook_xml() {
    // Verify that workbook.xml <sheet> elements reference the correct rIds
    // by confirming the re-parsed sheet_workbook_r_ids match what we set.
    let output = make_multi_sheet(2);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let (_po, mut ctx, _d) = parse_xlsx_to_output(&bytes).unwrap();

    let ws_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
    let styles_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles";

    // Set up: sheets at rId8/rId9, styles at rId1
    ctx.workbook_relationships = vec![
        domain_types::OpcRelationship {
            id: "rId1".into(),
            rel_type: styles_type.into(),
            target: "styles.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId8".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet1.xml".into(),
            target_mode: None,
        },
        domain_types::OpcRelationship {
            id: "rId9".into(),
            rel_type: ws_type.into(),
            target: "worksheets/sheet2.xml".into(),
            target_mode: None,
        },
    ];
    ctx.sheet_workbook_r_ids = vec!["rId8".into(), "rId9".into()];

    let (_rt_output, rt_ctx) = roundtrip_with_ctx(&output, &ctx);

    // The re-parsed sheet_workbook_r_ids should match
    assert_eq!(rt_ctx.sheet_workbook_r_ids.len(), 2);
    assert_eq!(rt_ctx.sheet_workbook_r_ids[0], "rId8");
    assert_eq!(rt_ctx.sheet_workbook_r_ids[1], "rId9");
}

#[test]
fn roundtrip_workbook_rels_fallback_to_sequential_without_context() {
    // Without RoundTripContext, rIds should be sequential (rId1, rId2, ...)
    let output = make_multi_sheet(3);
    let bytes = write_xlsx_from_parse_output(&output, None).unwrap();
    let (_po, ctx, _d) = parse_xlsx_to_output(&bytes).unwrap();

    // Sheets should get rId1, rId2, rId3 (sequential)
    assert_eq!(ctx.sheet_workbook_r_ids.len(), 3);
    assert_eq!(ctx.sheet_workbook_r_ids[0], "rId1");
    assert_eq!(ctx.sheet_workbook_r_ids[1], "rId2");
    assert_eq!(ctx.sheet_workbook_r_ids[2], "rId3");
}
