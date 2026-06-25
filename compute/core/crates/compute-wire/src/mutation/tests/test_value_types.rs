use std::collections::HashMap;

use super::super::*;
use snapshot_types::{CellChange, RecalcResult};
use value_types::CellValue;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, NO_STRING, PATCH_STRIDE};
use crate::flags::{self as render_flags};

#[test]
fn test_skips_unresolved_positions() {
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: None,
                value: CellValue::number(1.0),
                display_text: Some("1".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c2".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 5, col: 3 }),
                value: CellValue::number(2.0),
                display_text: Some("2".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
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
    let buf = serialize_mutation_result(&result, "s1", 0, None);
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 1); // Only the resolved cell
}

#[test]
fn test_boolean_number_value() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Boolean(true),
            display_text: Some("TRUE".into()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
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
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    let num = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
    assert_eq!(num, 1.0);

    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
}

#[test]
fn test_cf_color_overrides() {
    let result = RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
                value: CellValue::number(1.0),
                display_text: Some("1".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c2".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 1, col: 0 }),
                value: CellValue::number(2.0),
                display_text: Some("2".into()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
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

    let mut cf_colors = CfColorOverrides::default();
    cf_colors.insert(0, 0, 0xFF0000FF, 0x00FF00FF);
    cf_colors.insert(1, 0, 0x0000FFFF, 0);

    let buf = serialize_mutation_result(&result, "s1", 0, Some(&cf_colors));

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let patches_start = HEADER_SIZE + sheet_id_len;

    // First patch: bg_color_override at +32, font_color_override at +36
    let bg0 = u32::from_le_bytes(
        buf[patches_start + 32..patches_start + 36]
            .try_into()
            .unwrap(),
    );
    let font0 = u32::from_le_bytes(
        buf[patches_start + 36..patches_start + 40]
            .try_into()
            .unwrap(),
    );
    assert_eq!(bg0, 0xFF0000FF);
    assert_eq!(font0, 0x00FF00FF);

    // Second patch
    let p1 = patches_start + PATCH_STRIDE;
    let bg1 = u32::from_le_bytes(buf[p1 + 32..p1 + 36].try_into().unwrap());
    let font1 = u32::from_le_bytes(buf[p1 + 36..p1 + 40].try_into().unwrap());
    assert_eq!(bg1, 0x0000FFFF);
    assert_eq!(font1, 0);
}

#[test]
fn test_extra_flags_preserved() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::number(1.0),
            display_text: Some("1".into()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: None,
            extra_flags: render_flags::HAS_FORMULA | render_flags::HAS_COMMENT,
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

    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    // Should have VALUE_TYPE_NUMBER | HAS_FORMULA | HAS_COMMENT
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NUMBER
    );
    assert_ne!(flags & render_flags::HAS_FORMULA, 0);
    assert_ne!(flags & render_flags::HAS_COMMENT, 0);
}

#[test]
fn test_null_cell_value() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Null,
            display_text: None,
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
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

    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_NULL
    );

    let num = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
    assert!(num.is_nan());

    let display_off = u32::from_le_bytes(buf[off + 16..off + 20].try_into().unwrap());
    assert_eq!(display_off, NO_STRING);
}

#[test]
fn test_text_cell_value_type() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Text("world".into()),
            display_text: Some("world".to_string()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
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

    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_TEXT
    );

    // Verify display text round-trips through string pool
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;

    let d_off = u32::from_le_bytes(buf[off + 16..off + 20].try_into().unwrap()) as usize;
    let d_len = u16::from_le_bytes(buf[off + 28..off + 30].try_into().unwrap()) as usize;

    assert!(string_bytes >= d_off + d_len);
    let display_text =
        std::str::from_utf8(&buf[pool_start + d_off..pool_start + d_off + d_len]).unwrap();
    assert_eq!(display_text, "world");
}

#[test]
fn test_boolean_false_number_value() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::Boolean(false),
            display_text: Some("FALSE".into()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
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

    let buf = serialize_mutation_result(&result, "s1", 0, None);

    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let off = HEADER_SIZE + sheet_id_len;

    let num = f64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
    assert_eq!(num, 0.0);
    assert!(!num.is_nan());

    let flags = u16::from_le_bytes(buf[off + 24..off + 26].try_into().unwrap());
    assert_eq!(
        flags & render_flags::VALUE_TYPE_MASK,
        render_flags::VALUE_TYPE_BOOL
    );
}
