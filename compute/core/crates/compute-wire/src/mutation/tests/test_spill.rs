use std::collections::HashMap;

use super::super::*;
use super::helpers::*;
use snapshot_types::{CellChange, RecalcResult};
use value_types::CellValue;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, NO_STRING, PATCH_STRIDE};
use crate::flags::{self as render_flags, MUT_HAS_PROJECTION_CHANGES};

#[test]
fn test_spill_section_serialization() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::number(10.0),
            display_text: Some("10".to_string()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: Some(0),
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "c1".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: vec![
                snapshot_types::ProjectionCellData {
                    cell_id: "sp1".into(),
                    row: 1,
                    col: 0,
                    value: CellValue::number(20.0),
                },
                snapshot_types::ProjectionCellData {
                    cell_id: "sp2".into(),
                    row: 2,
                    col: 0,
                    value: CellValue::number(30.0),
                },
            ],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    // Header: has_projection_changes flag should be set
    assert_eq!(
        buf[10] & MUT_HAS_PROJECTION_CHANGES,
        MUT_HAS_PROJECTION_CHANGES
    );

    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    assert_eq!(patch_count, 1); // only 1 changed cell

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;

    // Spill section starts after string pool
    let proj_section_start = pool_start + string_bytes;
    let proj_count = u32::from_le_bytes(
        buf[proj_section_start..proj_section_start + 4]
            .try_into()
            .unwrap(),
    );
    assert_eq!(proj_count, 2);

    // First spill patch: row=1, col=0, value=20.0
    let sp0 = proj_section_start + 4;
    let sp0_row = u32::from_le_bytes(buf[sp0..sp0 + 4].try_into().unwrap());
    let sp0_col = u32::from_le_bytes(buf[sp0 + 4..sp0 + 8].try_into().unwrap());
    assert_eq!(sp0_row, 1);
    assert_eq!(sp0_col, 0);

    let sp0_num = f64::from_le_bytes(buf[sp0 + 8..sp0 + 16].try_into().unwrap());
    assert_eq!(sp0_num, 20.0);

    // Spill cell flags should have IS_SPILL_MEMBER (bit 8 = 0x100) + VALUE_TYPE_NUMBER (1)
    let sp0_flags = u16::from_le_bytes(buf[sp0 + 24..sp0 + 26].try_into().unwrap());
    assert_eq!(
        sp0_flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        sp0_flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NUMBER
    );

    // Spill cell display text should be in the string pool
    let sp0_d_off = u32::from_le_bytes(buf[sp0 + 16..sp0 + 20].try_into().unwrap()) as usize;
    let sp0_d_len = u16::from_le_bytes(buf[sp0 + 28..sp0 + 30].try_into().unwrap()) as usize;
    let sp0_text =
        std::str::from_utf8(&buf[pool_start + sp0_d_off..pool_start + sp0_d_off + sp0_d_len])
            .unwrap();
    assert_eq!(sp0_text, "20");

    // Second spill patch: row=2, col=0, value=30.0
    let sp1 = sp0 + PATCH_STRIDE;
    let sp1_num = f64::from_le_bytes(buf[sp1 + 8..sp1 + 16].try_into().unwrap());
    assert_eq!(sp1_num, 30.0);
}

#[test]
fn test_dynamic_spill_members_do_not_carry_has_formula_but_cse_members_do() {
    let mut dynamic = make_spill_result(vec![snapshot_types::ProjectionCellData {
        cell_id: "sp1".into(),
        row: 1,
        col: 0,
        value: CellValue::number(20.0),
    }]);
    dynamic.projection_changes[0].is_cse = false;
    let dynamic_buf = serialize_mutation_result(&dynamic, "s1", 0, None);

    let patch_count = u32::from_le_bytes(dynamic_buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(dynamic_buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(dynamic_buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_start = pool_start + string_bytes;
    let dynamic_flags = u16::from_le_bytes(
        dynamic_buf[proj_start + 4 + 24..proj_start + 4 + 26]
            .try_into()
            .unwrap(),
    );
    assert_eq!(
        dynamic_flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(dynamic_flags & render_flags::HAS_FORMULA, 0);

    let mut cse = dynamic;
    cse.projection_changes[0].is_cse = true;
    let cse_buf = serialize_mutation_result(&cse, "s1", 0, None);
    let cse_flags = u16::from_le_bytes(
        cse_buf[proj_start + 4 + 24..proj_start + 4 + 26]
            .try_into()
            .unwrap(),
    );
    assert_eq!(
        cse_flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        cse_flags & render_flags::HAS_FORMULA,
        render_flags::HAS_FORMULA
    );
}

#[test]
fn test_spill_no_section_when_empty() {
    let result = make_test_result(); // no spill changes
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    // No spill flag
    assert_eq!(buf[10] & MUT_HAS_PROJECTION_CHANGES, 0);

    // Buffer should end right after string pool (no spill section)
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let expected_size = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE + string_bytes;
    assert_eq!(buf.len(), expected_size);
}

#[test]
fn test_spill_text_cell() {
    let result = make_spill_result(vec![snapshot_types::ProjectionCellData {
        cell_id: "sp1".into(),
        row: 3,
        col: 1,
        value: CellValue::Text("hello".into()),
    }]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (pool_start, proj_start, proj_count) = find_spill_section(&buf);
    assert_eq!(proj_count, 1);

    let p = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(p.row, 3);
    assert_eq!(p.col, 1);

    // Text cells should have NaN number_value
    assert!(
        p.number_value.is_nan(),
        "text cell number_value should be NaN"
    );

    // Flags: IS_SPILL_MEMBER | VALUE_TYPE_TEXT
    assert_eq!(
        p.flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        p.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_TEXT
    );

    // Display text should be "hello"
    assert_ne!(p.display_off, NO_STRING);
    let display = read_pool_string(&buf, pool_start, p.display_off, p.display_len);
    assert_eq!(display, "hello");

    // No error
    assert_eq!(p.error_off, NO_STRING);
    assert_eq!(p.error_len, 0);
}

#[test]
fn test_spill_boolean_cells() {
    let result = make_spill_result(vec![
        snapshot_types::ProjectionCellData {
            cell_id: "sp_true".into(),
            row: 1,
            col: 0,
            value: CellValue::Boolean(true),
        },
        snapshot_types::ProjectionCellData {
            cell_id: "sp_false".into(),
            row: 2,
            col: 0,
            value: CellValue::Boolean(false),
        },
    ]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (pool_start, proj_start, proj_count) = find_spill_section(&buf);
    assert_eq!(proj_count, 2);

    // --- true cell ---
    let p_true = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(
        p_true.flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        p_true.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
    assert_eq!(p_true.number_value, 1.0);
    let display_true = read_pool_string(&buf, pool_start, p_true.display_off, p_true.display_len);
    assert_eq!(display_true, "TRUE");
    assert_eq!(p_true.error_off, NO_STRING);

    // --- false cell ---
    let p_false = read_spill_patch(&buf, proj_start, 1);
    assert_eq!(
        p_false.flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        p_false.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
    assert_eq!(p_false.number_value, 0.0);
    let display_false =
        read_pool_string(&buf, pool_start, p_false.display_off, p_false.display_len);
    assert_eq!(display_false, "FALSE");
    assert_eq!(p_false.error_off, NO_STRING);
}

#[test]
fn test_spill_error_cell() {
    let result = make_spill_result(vec![snapshot_types::ProjectionCellData {
        cell_id: "sp_err".into(),
        row: 4,
        col: 2,
        value: CellValue::Error(value_types::CellError::Ref, None),
    }]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (pool_start, proj_start, proj_count) = find_spill_section(&buf);
    assert_eq!(proj_count, 1);

    let p = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(p.row, 4);
    assert_eq!(p.col, 2);

    // Error cells should have NaN number_value
    assert!(
        p.number_value.is_nan(),
        "error cell number_value should be NaN"
    );

    // Flags: IS_SPILL_MEMBER | VALUE_TYPE_ERROR
    assert_eq!(
        p.flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        p.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_ERROR
    );

    // Display text should be "#REF!" (auto-generated from value)
    assert_ne!(p.display_off, NO_STRING);
    let display = read_pool_string(&buf, pool_start, p.display_off, p.display_len);
    assert_eq!(display, "#REF!");

    // Error pool should also contain "#REF!"
    assert_ne!(p.error_off, NO_STRING);
    let error = read_pool_string(&buf, pool_start, p.error_off, p.error_len);
    assert_eq!(error, "#REF!");
}

#[test]
fn test_spill_null_cell() {
    let result = make_spill_result(vec![snapshot_types::ProjectionCellData {
        cell_id: "sp_null".into(),
        row: 5,
        col: 0,
        value: CellValue::Null,
    }]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (pool_start, proj_start, proj_count) = find_spill_section(&buf);
    let _ = pool_start; // suppress unused warning
    assert_eq!(proj_count, 1);

    let p = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(p.row, 5);
    assert_eq!(p.col, 0);

    // Null cells should have NaN number_value
    assert!(
        p.number_value.is_nan(),
        "null cell number_value should be NaN"
    );

    // Flags: IS_SPILL_MEMBER | VALUE_TYPE_NULL
    assert_eq!(
        p.flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        p.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NULL
    );

    // No display text for null
    assert_eq!(p.display_off, NO_STRING);
    assert_eq!(p.display_len, 0);

    // No error
    assert_eq!(p.error_off, NO_STRING);
    assert_eq!(p.error_len, 0);
}

#[test]
fn test_spill_array_cell() {
    let result = make_spill_result(vec![snapshot_types::ProjectionCellData {
        cell_id: "sp_arr".into(),
        row: 6,
        col: 0,
        value: CellValue::Array(std::sync::Arc::new(value_types::CellArray::from_rows(
            vec![vec![CellValue::number(1.0), CellValue::number(2.0)]],
        ))),
    }]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (pool_start, proj_start, proj_count) = find_spill_section(&buf);
    assert_eq!(proj_count, 1);

    let p = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(p.row, 6);
    assert_eq!(p.col, 0);

    // Arrays map to NUMBER value type
    assert_eq!(
        p.flags & render_flags::IS_SPILL_MEMBER,
        render_flags::IS_SPILL_MEMBER
    );
    assert_eq!(
        p.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NUMBER
    );

    // Array cells should have NaN number_value
    assert!(
        p.number_value.is_nan(),
        "array cell number_value should be NaN"
    );

    // Display text should be "{...}"
    assert_ne!(p.display_off, NO_STRING);
    let display = read_pool_string(&buf, pool_start, p.display_off, p.display_len);
    assert_eq!(display, "{...}");

    // No error
    assert_eq!(p.error_off, NO_STRING);
    assert_eq!(p.error_len, 0);
}

#[test]
fn test_spill_skips_unresolved_positions() {
    let result = make_spill_result(vec![
        snapshot_types::ProjectionCellData {
            cell_id: "sp_unresolved".into(),
            row: u32::MAX,
            col: 0,
            value: CellValue::number(99.0),
        },
        snapshot_types::ProjectionCellData {
            cell_id: "sp_resolved".into(),
            row: 5,
            col: 0,
            value: CellValue::number(42.0),
        },
    ]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (_pool_start, proj_start, proj_count) = find_spill_section(&buf);
    // Only the resolved cell (5, 0) should appear
    assert_eq!(proj_count, 1);

    let p = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(p.row, 5);
    assert_eq!(p.col, 0);
    assert_eq!(p.number_value, 42.0);
}

#[test]
fn test_spill_mixed_value_types() {
    let result = make_spill_result(vec![
        snapshot_types::ProjectionCellData {
            cell_id: "sp_num".into(),
            row: 1,
            col: 0,
            value: CellValue::number(3.14),
        },
        snapshot_types::ProjectionCellData {
            cell_id: "sp_txt".into(),
            row: 2,
            col: 0,
            value: CellValue::Text("mixed".into()),
        },
        snapshot_types::ProjectionCellData {
            cell_id: "sp_bool".into(),
            row: 3,
            col: 0,
            value: CellValue::Boolean(true),
        },
        snapshot_types::ProjectionCellData {
            cell_id: "sp_err".into(),
            row: 4,
            col: 0,
            value: CellValue::Error(value_types::CellError::Na, None),
        },
    ]);
    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let (pool_start, proj_start, proj_count) = find_spill_section(&buf);
    assert_eq!(proj_count, 4);

    // All cells must have IS_SPILL_MEMBER set
    for i in 0..4 {
        let p = read_spill_patch(&buf, proj_start, i);
        assert_eq!(
            p.flags & render_flags::IS_SPILL_MEMBER,
            render_flags::IS_SPILL_MEMBER,
            "spill cell {} missing IS_SPILL_MEMBER flag",
            i
        );
    }

    // Number cell
    let p0 = read_spill_patch(&buf, proj_start, 0);
    assert_eq!(
        p0.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NUMBER
    );
    assert_eq!(p0.number_value, 3.14);
    assert_eq!(p0.error_off, NO_STRING);

    // Text cell
    let p1 = read_spill_patch(&buf, proj_start, 1);
    assert_eq!(
        p1.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_TEXT
    );
    assert!(p1.number_value.is_nan());
    let d1 = read_pool_string(&buf, pool_start, p1.display_off, p1.display_len);
    assert_eq!(d1, "mixed");
    assert_eq!(p1.error_off, NO_STRING);

    // Boolean cell
    let p2 = read_spill_patch(&buf, proj_start, 2);
    assert_eq!(
        p2.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
    assert_eq!(p2.number_value, 1.0);
    let d2 = read_pool_string(&buf, pool_start, p2.display_off, p2.display_len);
    assert_eq!(d2, "TRUE");
    assert_eq!(p2.error_off, NO_STRING);

    // Error cell
    let p3 = read_spill_patch(&buf, proj_start, 3);
    assert_eq!(
        p3.flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_ERROR
    );
    assert!(p3.number_value.is_nan());
    assert_ne!(p3.error_off, NO_STRING);
    let err = read_pool_string(&buf, pool_start, p3.error_off, p3.error_len);
    assert_eq!(err, "#N/A");
}
