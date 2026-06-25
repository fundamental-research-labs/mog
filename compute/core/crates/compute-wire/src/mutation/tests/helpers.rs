use std::collections::HashMap;

use snapshot_types::{CellChange, RecalcResult};
use value_types::CellValue;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, PATCH_STRIDE};

pub(super) fn make_test_result() -> RecalcResult {
    RecalcResult {
        changed_cells: vec![
            CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
                value: CellValue::number(42.0),
                display_text: Some("42".to_string()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: Some(1),
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c2".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 1, col: 3 }),
                value: CellValue::Text("Hello".into()),
                display_text: Some("Hello".to_string()),
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: Some(0),
                extra_flags: 0,
                old_value: None,
            },
            CellChange {
                cell_id: "c3".into(),
                sheet_id: "s1".into(),
                position: Some(snapshot_types::CellPosition { row: 2, col: 0 }),
                value: CellValue::Error(value_types::CellError::Div0, None),
                display_text: None,
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
    }
}

/// Helper: create a `RecalcResult` with one base cell at (0,0) and the given
/// projection cells in a single `ProjectionChange`.
pub(super) fn make_spill_result(
    proj_cells: Vec<snapshot_types::ProjectionCellData>,
) -> RecalcResult {
    RecalcResult {
        changed_cells: vec![CellChange {
            cell_id: "base".into(),
            sheet_id: "s1".into(),
            position: Some(snapshot_types::CellPosition { row: 0, col: 0 }),
            value: CellValue::number(1.0),
            display_text: Some("1".into()),
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: Some(0),
            extra_flags: 0,
            old_value: None,
        }],
        projection_changes: vec![snapshot_types::ProjectionChange {
            source_cell_id: "base".into(),
            sheet_id: "s1".into(),
            is_cse: false,
            projection_cells: proj_cells,
        }],
        errors: vec![],
        validation_annotations: vec![],
        metrics: Default::default(),
        old_values: HashMap::new(),
        policy_preserved_parse_outcomes: Vec::new(),
        policy_preserved_parse_summary: None,
    }
}

/// Helper: locate the spill section in the serialized buffer and return
/// (`pool_start`, `proj_start`, `proj_count`).
pub(super) fn find_spill_section(buf: &[u8]) -> (usize, usize, u32) {
    let patch_count = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let string_bytes = u32::from_le_bytes(buf[4..8].try_into().unwrap()) as usize;
    let sheet_id_len = u16::from_le_bytes(buf[8..10].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + sheet_id_len + patch_count * PATCH_STRIDE;
    let proj_start = pool_start + string_bytes;
    let proj_count = u32::from_le_bytes(buf[proj_start..proj_start + 4].try_into().unwrap());
    (pool_start, proj_start, proj_count)
}

/// Read a spill patch at the given index and return decoded fields.
pub(super) struct SpillPatch {
    pub row: u32,
    pub col: u32,
    pub number_value: f64,
    pub display_off: u32,
    pub error_off: u32,
    pub flags: u16,
    pub display_len: u16,
    pub error_len: u16,
}

pub(super) fn read_spill_patch(buf: &[u8], proj_start: usize, index: usize) -> SpillPatch {
    let sp = proj_start + 4 + index * PATCH_STRIDE;
    SpillPatch {
        row: u32::from_le_bytes(buf[sp..sp + 4].try_into().unwrap()),
        col: u32::from_le_bytes(buf[sp + 4..sp + 8].try_into().unwrap()),
        number_value: f64::from_le_bytes(buf[sp + 8..sp + 16].try_into().unwrap()),
        display_off: u32::from_le_bytes(buf[sp + 16..sp + 20].try_into().unwrap()),
        error_off: u32::from_le_bytes(buf[sp + 20..sp + 24].try_into().unwrap()),
        flags: u16::from_le_bytes(buf[sp + 24..sp + 26].try_into().unwrap()),
        display_len: u16::from_le_bytes(buf[sp + 28..sp + 30].try_into().unwrap()),
        error_len: u16::from_le_bytes(buf[sp + 30..sp + 32].try_into().unwrap()),
    }
}

pub(super) fn read_pool_string(buf: &[u8], pool_start: usize, off: u32, len: u16) -> String {
    let o = off as usize;
    let l = len as usize;
    std::str::from_utf8(&buf[pool_start + o..pool_start + o + l])
        .unwrap()
        .to_string()
}
