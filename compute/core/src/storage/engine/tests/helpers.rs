//! Shared test helpers for storage engine tests.

use super::super::*;
use crate::snapshot::{CellData, SheetSnapshot};
use value_types::{CellValue, FiniteF64};

use compute_wire::constants::{MUTATION_HEADER_SIZE, NO_STRING, PATCH_STRIDE};

// -------------------------------------------------------------------
// Snapshot Builders
// -------------------------------------------------------------------

pub(super) fn num(value: f64) -> CellValue {
    CellValue::Number(FiniteF64::must(value))
}

pub(super) fn cell_value_at(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> CellValue {
    engine
        .mirror()
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

pub(super) fn empty_bulk_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: sheet_id().to_uuid_string(),
            name: "Sheet1".to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

/// Build a simple snapshot with one sheet and a few cells.
pub(super) fn simple_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(20.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

pub(super) fn sheet_id() -> SheetId {
    SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
}

pub(super) fn cell_id_a1() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440001").unwrap()
}

pub(super) fn cell_id_b1() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440002").unwrap()
}

pub(super) fn cell_id_a2() -> CellId {
    CellId::from_uuid_str("550e8400-e29b-41d4-a716-446655440003").unwrap()
}

// -------------------------------------------------------------------
// Collaboration bootstrap helpers
// -------------------------------------------------------------------

pub(super) fn canonical_room_state() -> (Vec<u8>, SheetId) {
    let doc = yrs::Doc::new();
    let (_workbook, _sheets, sheet_hex) = compute_document::schema::init_canonical_schema(&doc);
    let sheet_id = SheetId::from_uuid_str(sheet_hex.as_str()).unwrap();
    (compute_collab::encode_full_state(&doc), sheet_id)
}

pub(super) fn fork_engine_from_state(state: &[u8]) -> YrsComputeEngine {
    let (engine, _) = YrsComputeEngine::from_yrs_state(state).expect("from_yrs_state fork");
    engine
}

pub(super) fn fork_engine_pair_from_state(state: &[u8]) -> (YrsComputeEngine, YrsComputeEngine) {
    (fork_engine_from_state(state), fork_engine_from_state(state))
}

// -------------------------------------------------------------------
// CopyRange snapshot builder
// -------------------------------------------------------------------

/// Snapshot with values A1=10, B1=20, A2=30, B2=40 and formula C1=A1+B1 (=30).
pub(super) fn copy_range_snapshot() -> WorkbookSnapshot {
    WorkbookSnapshot {
        sheets: vec![SheetSnapshot {
            id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
            name: "Sheet1".to_string(),
            rows: 100,
            cols: 26,
            cells: vec![
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440002".to_string(),
                    row: 0,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(20.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440004".to_string(),
                    row: 1,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(30.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440005".to_string(),
                    row: 1,
                    col: 1,
                    value: CellValue::Number(FiniteF64::must(40.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                },
                CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440003".to_string(),
                    row: 0,
                    col: 2,
                    value: CellValue::Number(FiniteF64::must(0.0)),
                    formula: Some("=A1+B1".to_string()),
                    identity_formula: None,
                    array_ref: None,
                },
            ],
            ranges: vec![],
        }],
        named_ranges: vec![],
        tables: vec![],
        pivot_tables: vec![],
        data_table_regions: vec![],
        iterative_calc: false,
        max_iterations: 100,
        max_change: value_types::FiniteF64::must(0.001),
        calculation_settings: None,
    }
}

// -------------------------------------------------------------------
// Binary patch decode helpers
// -------------------------------------------------------------------

/// Decode a multi-viewport packed blob and extract the first viewport's
/// mutation patch bytes. Returns None if the blob has no viewports.
pub(super) fn extract_first_viewport_mutation(packed: &[u8]) -> Option<Vec<u8>> {
    if packed.len() < 2 {
        return None;
    }
    let viewport_count = u16::from_le_bytes([packed[0], packed[1]]) as usize;
    if viewport_count == 0 {
        return None;
    }
    let mut offset = 2;
    // Read first viewport
    let id_len = packed[offset] as usize;
    offset += 1 + id_len;
    let patch_len = u32::from_le_bytes([
        packed[offset],
        packed[offset + 1],
        packed[offset + 2],
        packed[offset + 3],
    ]) as usize;
    offset += 4;
    Some(packed[offset..offset + patch_len].to_vec())
}

/// Given raw mutation patch bytes, extract (display_off, display_len)
/// for each cell patch. display_off == NO_STRING means no display text.
pub(super) fn extract_patch_display_info(mutation_bytes: &[u8]) -> Vec<(u32, u16)> {
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;

    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let mut results = Vec::new();
    for i in 0..patch_count {
        let patch_off = patches_start + i * PATCH_STRIDE;
        // Cell record starts at +8 within the patch (after row u32 + col u32)
        let rec_off = patch_off + 8;
        // display_off is at +8 within the 24-byte cell record
        let display_off = u32::from_le_bytes([
            mutation_bytes[rec_off + 8],
            mutation_bytes[rec_off + 9],
            mutation_bytes[rec_off + 10],
            mutation_bytes[rec_off + 11],
        ]);
        // display_len is at +20 within the 24-byte cell record
        let display_len =
            u16::from_le_bytes([mutation_bytes[rec_off + 20], mutation_bytes[rec_off + 21]]);
        results.push((display_off, display_len));
    }
    results
}

/// Given raw mutation patch bytes, decode the display text string for
/// a patch at index `i` from the string pool. Returns None if NO_STRING.
pub(super) fn decode_patch_display_text(
    mutation_bytes: &[u8],
    patch_index: usize,
) -> Option<String> {
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;

    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let string_pool_start = patches_start + patch_count * PATCH_STRIDE;

    let patch_off = patches_start + patch_index * PATCH_STRIDE;
    let rec_off = patch_off + 8;
    let display_off = u32::from_le_bytes([
        mutation_bytes[rec_off + 8],
        mutation_bytes[rec_off + 9],
        mutation_bytes[rec_off + 10],
        mutation_bytes[rec_off + 11],
    ]);
    let display_len =
        u16::from_le_bytes([mutation_bytes[rec_off + 20], mutation_bytes[rec_off + 21]]);
    if display_off == NO_STRING || display_len == 0 {
        return None;
    }
    let start = string_pool_start + display_off as usize;
    let end = start + display_len as usize;
    Some(String::from_utf8_lossy(&mutation_bytes[start..end]).to_string())
}

/// Extract (row, col) pairs from a single-viewport mutation binary blob.
pub(super) fn extract_patch_positions(mutation_bytes: &[u8]) -> Vec<(u32, u32)> {
    let patch_count = u32::from_le_bytes([
        mutation_bytes[0],
        mutation_bytes[1],
        mutation_bytes[2],
        mutation_bytes[3],
    ]) as usize;
    let sheet_id_len = u16::from_le_bytes([mutation_bytes[8], mutation_bytes[9]]) as usize;
    let patches_start = MUTATION_HEADER_SIZE + sheet_id_len;
    let mut positions = Vec::new();
    for i in 0..patch_count {
        let patch_off = patches_start + i * PATCH_STRIDE;
        let row = u32::from_le_bytes([
            mutation_bytes[patch_off],
            mutation_bytes[patch_off + 1],
            mutation_bytes[patch_off + 2],
            mutation_bytes[patch_off + 3],
        ]);
        let col = u32::from_le_bytes([
            mutation_bytes[patch_off + 4],
            mutation_bytes[patch_off + 5],
            mutation_bytes[patch_off + 6],
            mutation_bytes[patch_off + 7],
        ]);
        positions.push((row, col));
    }
    positions
}
