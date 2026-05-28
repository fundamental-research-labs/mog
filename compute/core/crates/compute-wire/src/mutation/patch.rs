//! Patch record types and builder functions for mutation serialization.

use crate::flags::{self as render_flags, ValueType};
use crate::viewport::intern_optional_string;

use crate::types::ViewportBounds;

use super::helpers::{
    CfColorOverrides, display_text_for_value, intern_error_string, number_value_for,
    resolve_cf_colors, within_bounds,
};

/// Internal patch record used during mutation serialization.
pub(crate) struct PatchRecord {
    pub(crate) row: u32,
    pub(crate) col: u32,
    pub(crate) number_value: f64,
    pub(crate) display_off: u32,
    pub(crate) error_off: u32,
    pub(crate) flags: u16,
    pub(crate) format_idx: u16,
    pub(crate) display_len: u16,
    pub(crate) error_len: u16,
    pub(crate) bg_color_override: u32,
    pub(crate) font_color_override: u32,
}

/// Build patch records from changed cells, optionally filtering by viewport bounds.
pub(crate) fn build_cell_patches(
    changes: &[snapshot_types::CellChange],
    string_pool: &mut Vec<u8>,
    cf_colors: Option<&CfColorOverrides>,
    bounds: Option<ViewportBounds>,
    sheet_id_filter: Option<&str>,
) -> Vec<PatchRecord> {
    let mut patches = Vec::with_capacity(changes.len());

    for change in changes {
        let Some(pos) = change.position.as_ref() else {
            continue;
        };
        if let Some(filter) = sheet_id_filter
            && change.sheet_id != filter
        {
            continue;
        }
        if !within_bounds(pos.row, pos.col, bounds) {
            continue;
        }

        let mut flags = u16::from(ValueType::from_cell_value(&change.value)) | change.extra_flags;
        if matches!(change.value, value_types::CellValue::Image(_)) {
            flags |= render_flags::HAS_CELL_IMAGE;
        }
        let number_value = number_value_for(&change.value);
        let (display_off, display_len) =
            intern_optional_string(string_pool, change.display_text.as_deref());
        let (error_off, error_len) = intern_error_string(string_pool, &change.value);
        let format_idx = change.format_idx.unwrap_or(0);
        let (bg_color_override, font_color_override) =
            resolve_cf_colors(cf_colors, pos.row, pos.col);

        patches.push(PatchRecord {
            row: pos.row,
            col: pos.col,
            number_value,
            display_off,
            error_off,
            flags,
            format_idx,
            display_len,
            error_len,
            bg_color_override,
            font_color_override,
        });
    }

    patches
}

/// Build patch records from projection (spill) cells, optionally filtering by viewport bounds.
pub(crate) fn build_spill_patches(
    projection_changes: &[snapshot_types::ProjectionChange],
    string_pool: &mut Vec<u8>,
    cf_colors: Option<&CfColorOverrides>,
    bounds: Option<ViewportBounds>,
    sheet_id_filter: Option<&str>,
) -> Vec<PatchRecord> {
    let mut patches = Vec::with_capacity(
        projection_changes
            .iter()
            .map(|pc| pc.projection_cells.len())
            .sum(),
    );

    for proj_change in projection_changes {
        if let Some(filter) = sheet_id_filter
            && proj_change.sheet_id != filter
        {
            continue;
        }
        for proj_cell in &proj_change.projection_cells {
            // Defensive: `ProjectionCellData` still has flat `row: u32, col: u32`
            // (not migrated in sub-scope — positions are always-resolved in
            // practice, per the peer-field audit). Keep the sentinel guard so a
            // buggy upstream cannot leak u32::MAX onto the wire.
            if proj_cell.row == u32::MAX || proj_cell.col == u32::MAX {
                continue;
            }
            if !within_bounds(proj_cell.row, proj_cell.col, bounds) {
                continue;
            }

            let mut flags = u16::from(ValueType::from_cell_value(&proj_cell.value))
                | render_flags::IS_SPILL_MEMBER;
            if proj_change.is_cse {
                flags |= render_flags::HAS_FORMULA;
            }
            if matches!(proj_cell.value, value_types::CellValue::Image(_)) {
                flags |= render_flags::HAS_CELL_IMAGE;
            }
            let number_value = number_value_for(&proj_cell.value);

            // ProjectionCellData lacks display_text; generate from value.
            let display_text = display_text_for_value(&proj_cell.value);
            let (display_off, display_len) =
                intern_optional_string(string_pool, display_text.as_deref());
            let (error_off, error_len) = intern_error_string(string_pool, &proj_cell.value);
            let (bg_color_override, font_color_override) =
                resolve_cf_colors(cf_colors, proj_cell.row, proj_cell.col);

            patches.push(PatchRecord {
                row: proj_cell.row,
                col: proj_cell.col,
                number_value,
                display_off,
                error_off,
                flags,
                format_idx: 0, // Spill cells inherit source cell's format; 0 = default
                display_len,
                error_len,
                bg_color_override,
                font_color_override,
            });
        }
    }

    patches
}

/// Write a single 40-byte patch record (8-byte row/col prefix + 32-byte cell record).
///
/// All fields are assembled into a `[u8; PATCH_STRIDE]` array first, then
/// written in a single `extend_from_slice` call (1 call instead of 11).
pub(crate) fn write_patch_to_buf(buf: &mut Vec<u8>, patch: &PatchRecord) {
    use crate::constants::PATCH_STRIDE;

    let mut rec = [0u8; PATCH_STRIDE];
    rec[0..4].copy_from_slice(&patch.row.to_le_bytes());
    rec[4..8].copy_from_slice(&patch.col.to_le_bytes());
    rec[8..16].copy_from_slice(&patch.number_value.to_le_bytes());
    rec[16..20].copy_from_slice(&patch.display_off.to_le_bytes());
    rec[20..24].copy_from_slice(&patch.error_off.to_le_bytes());
    rec[24..26].copy_from_slice(&patch.flags.to_le_bytes());
    rec[26..28].copy_from_slice(&patch.format_idx.to_le_bytes());
    rec[28..30].copy_from_slice(&patch.display_len.to_le_bytes());
    rec[30..32].copy_from_slice(&patch.error_len.to_le_bytes());
    rec[32..36].copy_from_slice(&patch.bg_color_override.to_le_bytes());
    rec[36..40].copy_from_slice(&patch.font_color_override.to_le_bytes());
    buf.extend_from_slice(&rec);
}

/// Write the spill section (u32 count + patches) if non-empty.
#[allow(clippy::cast_possible_truncation)] // patch count bounded by cell count
pub(crate) fn write_spill_section(buf: &mut Vec<u8>, patches: &[PatchRecord]) {
    if !patches.is_empty() {
        debug_assert!(
            u32::try_from(patches.len()).is_ok(),
            "spill patch count exceeds u32"
        );
        buf.extend_from_slice(&(patches.len() as u32).to_le_bytes());
        for patch in patches {
            write_patch_to_buf(buf, patch);
        }
    }
}
