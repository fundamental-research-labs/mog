#![allow(clippy::pedantic, clippy::all, missing_docs)]

mod support;

use std::collections::HashMap;

use compute_wire::constants::*;
use compute_wire::flags::*;
use compute_wire::{CfColorOverrides, serialize_mutation_result};
use snapshot_types::{
    CellChange, CellErrorInfo, ProjectionCellData, ProjectionChange, RecalcResult,
};
use support::layout::MutationLayout;
use support::wire::{read_f64, read_string, read_u8, read_u16, read_u32};
use value_types::{CellError, CellValue, FiniteF64};

#[test]
fn mutation_roundtrip() {
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "cell-1".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 3, col: 7 }),
                value: CellValue::Number(FiniteF64::new(123.456).unwrap()),
                display_text: Some("123.456".into()),
                format_idx: Some(2),
                extra_flags: HAS_FORMULA,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-2".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 4, col: 0 }),
                value: CellValue::Text("Hello".into()),
                display_text: Some("Hello".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-3".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 5, col: 1 }),
                value: CellValue::Boolean(true),
                display_text: Some("TRUE".into()),
                format_idx: None,
                extra_flags: HAS_COMMENT,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-4".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 6, col: 2 }),
                value: CellValue::Error(CellError::Div0, None),
                display_text: Some("#DIV/0!".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "cell-5".into(),
                sheet_id: "sheet-1".into(),
                position: Some(snapshot_types::CellPosition { row: 7, col: 3 }),
                value: CellValue::Null,
                display_text: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let sheet_id = "abc-def-123";
    let generation = 99u8;
    let buf = serialize_mutation_result(&result, sheet_id, generation, None);
    let layout = MutationLayout::new(&buf);

    // -- Read header (16 bytes) ------------------------------------------------

    assert_eq!(layout.patch_count, 5, "patch_count");
    assert_eq!(layout.sheet_id_len, sheet_id.len());
    let hdr_flags = read_u8(&buf, 10);
    assert_eq!(hdr_flags & MUT_HAS_PROJECTION_CHANGES, 0, "no projections");
    assert_eq!(hdr_flags & MUT_HAS_ERRORS, 0, "no errors flag");
    assert_eq!(read_u8(&buf, 11), generation);

    // -- Read sheet ID ---------------------------------------------------------

    let read_sheet_id =
        String::from_utf8(buf[layout.sheet_id_start..layout.patches_start].to_vec()).unwrap();
    assert_eq!(read_sheet_id, sheet_id);

    // -- Compute section offsets -----------------------------------------------

    let patches_start = layout.patches_start;
    let string_pool_start = layout.string_pool_start;

    // -- Read back cell patches ------------------------------------------------

    // Patch 0: row=3, col=7, Number(123.456), "123.456", format_idx=2, HAS_FORMULA
    {
        let base = patches_start;
        assert_eq!(read_u32(&buf, base), 3, "patch 0 row");
        assert_eq!(read_u32(&buf, base + 4), 7, "patch 0 col");
        // Cell record starts at base + 8
        let cr = layout.patch_cell_base(0);
        assert_eq!(read_f64(&buf, cr + OFF_NUMBER_VALUE), 123.456);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
        assert_ne!(disp_off, NO_STRING);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "123.456");
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);
        assert_ne!(flags & HAS_FORMULA, 0);
        assert_eq!(read_u16(&buf, cr + OFF_FORMAT_IDX), 2);
    }

    // Patch 1: row=4, col=0, Text("Hello")
    {
        let base = layout.patch_base(1);
        assert_eq!(read_u32(&buf, base), 4);
        assert_eq!(read_u32(&buf, base + 4), 0);
        let cr = layout.patch_cell_base(1);
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_TEXT);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
        let disp = read_string(&buf, string_pool_start, disp_off, disp_len);
        assert_eq!(disp, "Hello");
        // number_value should be NaN for text
        assert!(read_f64(&buf, cr + OFF_NUMBER_VALUE).is_nan());
    }

    // Patch 2: Boolean(true), HAS_COMMENT
    {
        let base = layout.patch_base(2);
        assert_eq!(read_u32(&buf, base), 5);
        assert_eq!(read_u32(&buf, base + 4), 1);
        let cr = layout.patch_cell_base(2);
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_BOOL);
        assert_ne!(flags & HAS_COMMENT, 0);
        assert_eq!(read_f64(&buf, cr + OFF_NUMBER_VALUE), 1.0);
    }

    // Patch 3: Error(Div0)
    {
        let base = layout.patch_base(3);
        assert_eq!(read_u32(&buf, base), 6);
        assert_eq!(read_u32(&buf, base + 4), 2);
        let cr = layout.patch_cell_base(3);
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_ERROR);
        // Error string
        let err_off = read_u32(&buf, cr + OFF_ERROR_OFF);
        let err_len = read_u16(&buf, cr + OFF_ERROR_LEN);
        assert_ne!(err_off, NO_STRING);
        let err = read_string(&buf, string_pool_start, err_off, err_len);
        assert_eq!(err, "#DIV/0!");
    }

    // Patch 4: Null
    {
        let base = layout.patch_base(4);
        assert_eq!(read_u32(&buf, base), 7);
        assert_eq!(read_u32(&buf, base + 4), 3);
        let cr = layout.patch_cell_base(4);
        let flags = read_u16(&buf, cr + OFF_FLAGS);
        assert_eq!(flags & VALUE_TYPE_MASK, VALUE_TYPE_NULL);
        let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
        assert_eq!(disp_off, NO_STRING);
        let err_off = read_u32(&buf, cr + OFF_ERROR_OFF);
        assert_eq!(err_off, NO_STRING);
    }

    // Verify total size
    let expected_size = layout.string_pool_start + layout.string_pool_bytes;
    assert_eq!(buf.len(), expected_size, "total mutation buffer size");
}

// ---------------------------------------------------------------------------
// b (cont). Mutation with projections and errors flags
// ---------------------------------------------------------------------------

#[test]
fn mutation_with_projections_and_errors() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Number(FiniteF64::new(10.0).unwrap()),
            display_text: Some("10".into()),
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![ProjectionChange {
            source_cell_id: "src-1".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                ProjectionCellData {
                    cell_id: "p1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::new(20.0).unwrap()),
                },
                ProjectionCellData {
                    cell_id: "p2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::Text("spill text".into()),
                },
            ],
        }],
        errors: vec![CellErrorInfo {
            cell_id: "c-err".into(),
            sheet_id: "s1".into(),
            error: "#VALUE!".into(),
        }],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "sheet-x", 1, None);
    let layout = MutationLayout::new(&buf);

    // Header flags
    let hdr_flags = read_u8(&buf, 10);
    assert_ne!(
        hdr_flags & MUT_HAS_PROJECTION_CHANGES,
        0,
        "has_projection_changes"
    );
    assert_ne!(hdr_flags & MUT_HAS_ERRORS, 0, "has_errors");

    // Read patch count
    assert_eq!(layout.patch_count, 1, "only 1 changed cell");
    let spill_section_start = layout.spill_section_start.expect("spill section");

    // Read spill section header
    let proj_count = read_u32(&buf, spill_section_start) as usize;
    assert_eq!(proj_count, 2, "2 projection patches");

    // Read first spill patch
    let sp0 = layout.spill_patch_base(0);
    assert_eq!(read_u32(&buf, sp0), 1, "spill patch 0 row");
    assert_eq!(read_u32(&buf, sp0 + 4), 0, "spill patch 0 col");
    let cr0 = sp0 + 8;
    let flags0 = read_u16(&buf, cr0 + OFF_FLAGS);
    assert_ne!(flags0 & IS_SPILL_MEMBER, 0, "IS_SPILL_MEMBER set");
    assert_eq!(flags0 & VALUE_TYPE_MASK, VALUE_TYPE_NUMBER);

    // Read second spill patch
    let sp1 = layout.spill_patch_base(1);
    assert_eq!(read_u32(&buf, sp1), 2, "spill patch 1 row");
    let cr1 = sp1 + 8;
    let flags1 = read_u16(&buf, cr1 + OFF_FLAGS);
    assert_ne!(flags1 & IS_SPILL_MEMBER, 0);
    assert_eq!(flags1 & VALUE_TYPE_MASK, VALUE_TYPE_TEXT);
}

// ---------------------------------------------------------------------------
// b (cont). Mutation with CF color overrides
// ---------------------------------------------------------------------------

#[test]
fn mutation_with_cf_color_overrides() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 2, col: 3 }),
            value: CellValue::Number(FiniteF64::new(50.0).unwrap()),
            display_text: Some("50".into()),
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let mut cf_colors = CfColorOverrides::default();
    cf_colors.insert(2, 3, 0xAABBCCDD, 0x11223344);

    let buf = serialize_mutation_result(&result, "s1", 0, Some(&cf_colors));
    let layout = MutationLayout::new(&buf);

    let cr = layout.patch_cell_base(0);
    assert_eq!(
        read_u32(&buf, cr + OFF_BG_COLOR_OVERRIDE),
        0xAABBCCDD,
        "bg color override"
    );
    assert_eq!(
        read_u32(&buf, cr + OFF_FONT_COLOR_OVERRIDE),
        0x11223344,
        "font color override"
    );
}

#[test]
fn mutation_empty_result() {
    let result = RecalcResult {
        changed_cells: vec![],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "empty-sheet", 0, None);
    let layout = MutationLayout::new(&buf);

    assert_eq!(layout.patch_count, 0);
    assert_eq!(layout.string_pool_bytes, 0);
    assert_eq!(layout.sheet_id_len, "empty-sheet".len());

    // Total size: header + sheet_id only
    let expected = MUTATION_HEADER_SIZE + layout.sheet_id_len;
    assert_eq!(buf.len(), expected);
}

#[test]
fn mutation_skips_unresolved_positions() {
    // Cells without resolved positions should be skipped.
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "good".into(),
                sheet_id: "s".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
                value: CellValue::Number(FiniteF64::new(1.0).unwrap()),
                display_text: Some("1".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "unresolved".into(),
                sheet_id: "s".into(),
                position: None,
                value: CellValue::Number(FiniteF64::new(2.0).unwrap()),
                display_text: Some("2".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "s", 0, None);
    let patch_count = read_u32(&buf, 0);
    assert_eq!(patch_count, 1, "only the good cell should be serialized");
}

#[test]
fn mutation_unicode_display_text() {
    let emoji_text = "\u{1F4B0}\u{1F4B0}\u{1F4B0}"; // money bags
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c".into(),
            sheet_id: "s".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Text(emoji_text.into()),
            display_text: Some(emoji_text.into()),
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "s", 0, None);
    let layout = MutationLayout::new(&buf);

    let cr = layout.patch_cell_base(0);
    let disp_off = read_u32(&buf, cr + OFF_DISPLAY_OFF);
    let disp_len = read_u16(&buf, cr + OFF_DISPLAY_LEN);
    let disp = read_string(&buf, layout.string_pool_start, disp_off, disp_len);
    assert_eq!(disp, emoji_text);
}

#[test]
fn mutation_stride_alignment_smoke() {
    // Verify PATCH_STRIDE (40) = 8 (row+col) + 32 (cell record)
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "a".into(),
                sheet_id: "s".into(),
                position: Some(snapshot_types::CellPosition { row: 10, col: 20 }),
                value: CellValue::Number(FiniteF64::new(100.0).unwrap()),
                display_text: Some("100".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "b".into(),
                sheet_id: "s".into(),
                position: Some(snapshot_types::CellPosition { row: 30, col: 40 }),
                value: CellValue::Number(FiniteF64::new(200.0).unwrap()),
                display_text: Some("200".into()),
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
        ],
        projection_changes: vec![],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let buf = serialize_mutation_result(&result, "s", 0, None);
    let layout = MutationLayout::new(&buf);

    // Patch 0
    let p0 = layout.patch_base(0);
    assert_eq!(read_u32(&buf, p0), 10);
    assert_eq!(read_u32(&buf, p0 + 4), 20);
    assert_eq!(
        read_f64(&buf, layout.patch_cell_base(0) + OFF_NUMBER_VALUE),
        100.0
    );

    // Patch 1
    let p1 = layout.patch_base(1);
    assert_eq!(read_u32(&buf, p1), 30);
    assert_eq!(read_u32(&buf, p1 + 4), 40);
    assert_eq!(
        read_f64(&buf, layout.patch_cell_base(1) + OFF_NUMBER_VALUE),
        200.0
    );
}
