use super::super::*;
use super::helpers::*;
use snapshot_types::RecalcResult;
use value_types::CellValue;

use std::collections::HashMap;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, PATCH_STRIDE};
use crate::flags::{MUT_HAS_PALETTE, MUT_HAS_PROJECTION_CHANGES};
use crate::types::{PaletteSnapshot, ViewportBounds};
use snapshot_types::CellChange;

#[test]
fn test_viewport_palette_none_backward_compat() {
    // Passing None for palette_json should produce identical output to before.
    let result = make_test_result();
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 10,
        },
        None,
        None,
    );

    let flags = buf[10];
    // Bit 2 (palette) must NOT be set
    assert_eq!(flags & MUT_HAS_PALETTE, 0);

    // Basic sanity: patch_count should be 3
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap());
    assert_eq!(patch_count, 3);
}

#[test]
fn test_viewport_palette_some_sets_flag_and_appends() {
    let result = RecalcResult::empty();
    let palette_bytes = b"{\"bold\":true}";
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 10,
        },
        Some(PaletteSnapshot {
            start_index: 42,
            palette_bytes,
        }),
        None,
    );

    // Bit 2 (palette) must be set
    let flags = buf[10];
    assert_ne!(flags & MUT_HAS_PALETTE, 0);

    // With empty result and no spill, the palette section starts right after
    // header + sheet_id + 0 patches + 0 string pool bytes.
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let palette_off = HEADER_SIZE + sheet_id_len; // no patches, no string pool

    // Read palette_start_index (u16)
    let start_idx = u16::from_le_bytes(buf[palette_off..palette_off + 2].try_into().unwrap());
    assert_eq!(start_idx, 42);

    // Read palette_json_len (u32)
    let json_len =
        u32::from_le_bytes(buf[palette_off + 2..palette_off + 6].try_into().unwrap()) as usize;
    assert_eq!(json_len, palette_bytes.len());

    // Read palette_json_bytes
    let json_data = &buf[palette_off + 6..palette_off + 6 + json_len];
    assert_eq!(json_data, palette_bytes);

    // Total length should be exact
    assert_eq!(buf.len(), palette_off + 6 + json_len);
}

#[test]
fn test_viewport_palette_round_trip() {
    // Write a palette section with real-ish JSON, then parse it back.
    let palette_json = b"[{\"fill\":\"#FF0000\",\"bold\":true},{\"fill\":\"#00FF00\"}]";
    let start_index: u16 = 100;

    let result = make_test_result(); // 3 cells in bounds
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        7,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 10,
        },
        Some(PaletteSnapshot {
            start_index,
            palette_bytes: palette_json,
        }),
        None,
    );

    // Verify flag
    let flags = buf[10];
    assert_ne!(
        flags & MUT_HAS_PALETTE,
        0,
        "palette flag bit 2 should be set"
    );

    // Navigate to palette section: header + sheet_id + patches + string_pool
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let palette_off = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE + string_bytes;
    // No spill section (no projection_changes in make_test_result)

    // Round-trip: read back start_index
    let rt_start = u16::from_le_bytes(buf[palette_off..palette_off + 2].try_into().unwrap());
    assert_eq!(rt_start, start_index);

    // Round-trip: read back json length
    let rt_len =
        u32::from_le_bytes(buf[palette_off + 2..palette_off + 6].try_into().unwrap()) as usize;
    assert_eq!(rt_len, palette_json.len());

    // Round-trip: read back json bytes
    let rt_json = &buf[palette_off + 6..palette_off + 6 + rt_len];
    assert_eq!(rt_json, palette_json);

    // Verify the JSON is valid UTF-8
    let rt_str = std::str::from_utf8(rt_json).expect("palette JSON should be valid UTF-8");
    assert!(rt_str.starts_with('['));
}

#[test]
fn test_viewport_spill_and_palette_combined() {
    let result = RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::number(10.0),
            display_text: Some("10".into()),
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
            projection_cells: vec![snapshot_types::ProjectionCellData {
                cell_id: "sp1".into(),
                row: 1,
                col: 0,
                value: CellValue::number(20.0),
            }],
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    };

    let palette_json = b"[{\"bold\":true}]";
    let buf = serialize_mutation_result_for_viewport(
        &result,
        "s1",
        0,
        ViewportBounds {
            start_row: 0,
            start_col: 0,
            end_row: 10,
            end_col: 10,
        },
        Some(PaletteSnapshot {
            start_index: 5,
            palette_bytes: palette_json,
        }),
        None,
    );

    let flags = buf[10];
    // Both MUT_HAS_PROJECTION_CHANGES and MUT_HAS_PALETTE should be set
    assert_ne!(
        flags & MUT_HAS_PROJECTION_CHANGES,
        0,
        "projection changes flag should be set"
    );
    assert_ne!(flags & MUT_HAS_PALETTE, 0, "palette flag should be set");

    // Navigate: header + sheet_id + patches + string_pool
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let pool_end = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE + string_bytes;

    // Spill section comes first
    let proj_count = u32::from_le_bytes(buf[pool_end..pool_end + 4].try_into().unwrap());
    assert_eq!(proj_count, 1);

    // Palette section comes after spill section
    let palette_off = pool_end + 4 + (proj_count as usize) * PATCH_STRIDE;
    let palette_start_idx =
        u16::from_le_bytes(buf[palette_off..palette_off + 2].try_into().unwrap());
    assert_eq!(palette_start_idx, 5);

    let palette_len =
        u32::from_le_bytes(buf[palette_off + 2..palette_off + 6].try_into().unwrap()) as usize;
    assert_eq!(palette_len, palette_json.len());

    let palette_data = &buf[palette_off + 6..palette_off + 6 + palette_len];
    assert_eq!(palette_data, palette_json);
}
