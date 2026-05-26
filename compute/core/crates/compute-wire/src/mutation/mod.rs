//! Binary serializer for mutation results (cell patches after recalc).
//!
//! Converts a [`RecalcResult`] into a compact `Vec<u8>` that TypeScript can
//! splice directly into the viewport buffer without JSON parsing.
//!
//! # Wire Layout (all little-endian)
//!
//! ```text
//! [Header 16 B] [SheetID UTF-8] [CellPatches N*40 B] [StringPool] [SpillSection?] [PaletteSection?]
//! ```
//!
//! ## Spill Section (present when header flags bit 0 is set)
//!
//! | Offset | Size | Field          | Description                        |
//! |--------|------|----------------|------------------------------------|
//! | 0      | 4    | `proj_count`   | Number of spill cell patches       |
//! | 4      | N×40 | spill patches  | Same 40-byte format as cell patches|
//!
//! Spill cell patches have the `IS_SPILL_MEMBER` flag (bit 8) set.
//!
//! ## Palette Section (present when header flags bit 2 is set)
//!
//! | Offset | Size | Field              | Description                          |
//! |--------|------|--------------------|--------------------------------------|
//! | 0      | 2    | `palette_start_idx`  | First format index in this delta     |
//! | 2      | 4    | `palette_bytes_len`  | Length of palette binary bytes         |
//! | 6      | N    | `palette_bytes`      | Binary-encoded palette entries         |
//!
//! ## Header (16 bytes)
//!
//! | Offset | Size | Field          | Description                        |
//! |--------|------|----------------|------------------------------------|
//! | 0      | 4    | `patch_count`  | Number of cell patches             |
//! | 4      | 4    | `string_bytes` | Total bytes in string pool         |
//! | 8      | 2    | `sheet_id_len` | Length of `sheet_id` UTF-8 string  |
//! | 10     | 1    | flags          | bit 0: `has_projection_changes`, bit 1: `has_errors`, bit 2: `has_palette` |
//! | 11     | 1    | generation     | Mutation generation counter        |
//! | 12     | 4    | reserved       | Reserved for future use            |
//!
//! ## Cell Patch (40 bytes each)
//!
//! | Offset | Size | Field          | Description                        |
//! |--------|------|----------------|------------------------------------|
//! | 0      | 4    | row            | Zero-based row index               |
//! | 4      | 4    | col            | Zero-based column index            |
//! | 8      | 32   | cell record    | Same layout as `ViewportCellRecord`|
//!
//! ## String Pool
//!
//! UTF-8 bytes referenced by `display_off`/`error_off` in cell records.

mod helpers;
mod patch;

#[cfg(test)]
mod tests;

pub use helpers::CfColorOverrides;

use crate::constants::{MUTATION_HEADER_SIZE as HEADER_SIZE, PATCH_STRIDE};
use crate::flags::{MUT_HAS_ERRORS, MUT_HAS_PALETTE, MUT_HAS_PROJECTION_CHANGES};
use crate::types::{PaletteSnapshot, ViewportBounds};
use patch::{build_cell_patches, build_spill_patches, write_patch_to_buf, write_spill_section};
use snapshot_types::RecalcResult;

/// Serialize a [`RecalcResult`] into a binary mutation result blob.
///
/// Each `CellChange` in `result.changed_cells` becomes a 32-byte cell patch
/// (row + col + 24-byte cell record). The cell record layout is identical to
/// [`super::viewport::ViewportCellRecord`] so TS can splice patches
/// directly into the viewport buffer.
///
/// # Arguments
/// - `result` -- Recalc result with `display_text` already populated.
/// - `sheet_id` -- Sheet ID as UUID string (written into the header region).
/// - `generation` -- Monotonic counter for stale-buffer detection.
/// - `cf_colors` -- Optional CF color overrides for cells.
#[must_use]
#[allow(clippy::cast_possible_truncation)] // wire protocol fields are protocol-bounded
pub fn serialize_mutation_result(
    result: &RecalcResult,
    sheet_id: &str,
    generation: u8,
    cf_colors: Option<&CfColorOverrides>,
) -> Vec<u8> {
    let sheet_id_bytes = sheet_id.as_bytes();

    // -- Step : Build string pool and collect patch data --------------------

    let mut string_pool = Vec::with_capacity(result.changed_cells.len() * 12);
    let patches = build_cell_patches(
        &result.changed_cells,
        &mut string_pool,
        cf_colors,
        None,
        None,
    );
    let projection_patches = build_spill_patches(
        &result.projection_changes,
        &mut string_pool,
        cf_colors,
        None,
        None,
    );

    // -- Step : Calculate total size and allocate ---------------------------

    let actual_patch_count = patches.len();
    debug_assert!(
        u32::try_from(actual_patch_count).is_ok(),
        "patch count exceeds u32"
    );
    debug_assert!(
        u32::try_from(string_pool.len()).is_ok(),
        "string pool exceeds u32"
    );
    debug_assert!(
        u16::try_from(sheet_id_bytes.len()).is_ok(),
        "sheet ID exceeds u16"
    );

    let proj_section_size = if projection_patches.is_empty() {
        0
    } else {
        4 + projection_patches.len() * PATCH_STRIDE // u32 count + records
    };
    let total_size = HEADER_SIZE
        + sheet_id_bytes.len()
        + actual_patch_count * PATCH_STRIDE
        + string_pool.len()
        + proj_section_size;

    let mut buf = Vec::with_capacity(total_size);

    // -- Step : Write header (16 bytes, little-endian) ----------------------

    let header_flags: u8 = {
        let mut f = 0u8;
        if !projection_patches.is_empty() {
            f |= MUT_HAS_PROJECTION_CHANGES;
        }
        if !result.errors.is_empty() {
            f |= MUT_HAS_ERRORS;
        }
        f
    };

    buf.extend_from_slice(&(actual_patch_count as u32).to_le_bytes()); // 0-3
    buf.extend_from_slice(&(string_pool.len() as u32).to_le_bytes()); // 4-7
    buf.extend_from_slice(&(sheet_id_bytes.len() as u16).to_le_bytes()); // 8-9
    buf.push(header_flags); // 10
    buf.push(generation); // 11
    buf.extend_from_slice(&0u32.to_le_bytes()); // 12-15: reserved

    debug_assert_eq!(buf.len(), HEADER_SIZE);

    // -- Step : Write sheet ID UTF-8 ----------------------------------------

    buf.extend_from_slice(sheet_id_bytes);

    // -- Step : Write cell patches (40 bytes each) --------------------------

    for patch in &patches {
        write_patch_to_buf(&mut buf, patch);
    }

    // -- Step : Write string pool -------------------------------------------

    buf.extend_from_slice(&string_pool);

    // -- Step : Write spill section (if present) ----------------------------

    write_spill_section(&mut buf, &projection_patches);

    debug_assert_eq!(buf.len(), total_size);
    buf
}

/// Serialize a [`RecalcResult`] for a single viewport, filtering to only
/// cells within the given bounds.
///
/// This reuses the same binary layout as [`serialize_mutation_result`] but
/// only includes cells where `row >= bounds.0 && row <= bounds.2 && col >= bounds.1 && col <= bounds.3`.
/// If no cells intersect the viewport bounds, returns a header-only buffer
/// (`patch_count` = 0, no cell patches, no string pool).
///
/// # Arguments
/// - `result` -- Recalc result with `display_text` already populated.
/// - `sheet_id` -- Sheet ID as UUID string (written into the header region).
/// - `generation` -- Monotonic counter for stale-buffer detection.
/// - `bounds` -- Inclusive viewport bounds.
/// - `palette_json` -- Optional palette delta snapshot for format palette.
/// - `cf_colors` -- Optional CF color overrides for cells.
#[must_use]
#[allow(clippy::cast_possible_truncation)] // wire protocol fields are protocol-bounded
pub fn serialize_mutation_result_for_viewport(
    result: &RecalcResult,
    sheet_id: &str,
    generation: u8,
    bounds: ViewportBounds,
    palette_json: Option<PaletteSnapshot<'_>>,
    cf_colors: Option<&CfColorOverrides>,
) -> Vec<u8> {
    let sheet_id_bytes = sheet_id.as_bytes();

    // -- Step : Build string pool and collect patch data (filtered by bounds) --

    let mut string_pool = Vec::with_capacity(result.changed_cells.len() * 12);
    let patches = build_cell_patches(
        &result.changed_cells,
        &mut string_pool,
        cf_colors,
        Some(bounds),
        Some(sheet_id),
    );
    let projection_patches = build_spill_patches(
        &result.projection_changes,
        &mut string_pool,
        cf_colors,
        Some(bounds),
        Some(sheet_id),
    );

    // -- Step : Calculate total size and allocate ---------------------------

    let actual_patch_count = patches.len();
    debug_assert!(
        u32::try_from(actual_patch_count).is_ok(),
        "patch count exceeds u32"
    );
    debug_assert!(
        u32::try_from(string_pool.len()).is_ok(),
        "string pool exceeds u32"
    );
    debug_assert!(
        u16::try_from(sheet_id_bytes.len()).is_ok(),
        "sheet ID exceeds u16"
    );

    let proj_section_size = if projection_patches.is_empty() {
        0
    } else {
        4 + projection_patches.len() * PATCH_STRIDE
    };
    let palette_section_size = match &palette_json {
        Some(snap) => 2 + 4 + snap.palette_bytes.len(), // u16 start_idx + u32 len + bytes
        None => 0,
    };
    let total_size = HEADER_SIZE
        + sheet_id_bytes.len()
        + actual_patch_count * PATCH_STRIDE
        + string_pool.len()
        + proj_section_size
        + palette_section_size;

    let mut buf = Vec::with_capacity(total_size);

    // -- Step : Write header (16 bytes, little-endian) ----------------------

    let header_flags: u8 = {
        let mut f = 0u8;
        if !projection_patches.is_empty() {
            f |= MUT_HAS_PROJECTION_CHANGES;
        }
        if !result.errors.is_empty() {
            f |= MUT_HAS_ERRORS;
        }
        if palette_json.is_some() {
            f |= MUT_HAS_PALETTE;
        }
        f
    };

    buf.extend_from_slice(&(actual_patch_count as u32).to_le_bytes());
    buf.extend_from_slice(&(string_pool.len() as u32).to_le_bytes());
    buf.extend_from_slice(&(sheet_id_bytes.len() as u16).to_le_bytes());
    buf.push(header_flags);
    buf.push(generation);
    buf.extend_from_slice(&0u32.to_le_bytes());

    debug_assert_eq!(buf.len(), HEADER_SIZE);

    // -- Step : Write sheet ID UTF-8 ----------------------------------------

    buf.extend_from_slice(sheet_id_bytes);

    // -- Step : Write cell patches (40 bytes each) --------------------------

    for patch in &patches {
        write_patch_to_buf(&mut buf, patch);
    }

    // -- Step : Write string pool -------------------------------------------

    buf.extend_from_slice(&string_pool);

    // -- Step : Write spill section (if present) ----------------------------

    write_spill_section(&mut buf, &projection_patches);

    // -- Step : Write palette section (if present) --------------------------

    if let Some(snap) = palette_json {
        buf.extend_from_slice(&snap.start_index.to_le_bytes());
        buf.extend_from_slice(&(snap.palette_bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(snap.palette_bytes);
    }

    debug_assert_eq!(buf.len(), total_size);
    buf
}

/// Concatenate multiple multi-viewport patch blobs into a single one.
///
/// Each input blob already carries the wire-format `[u16 viewport_count]`
/// header followed by per-viewport entries (see
/// [`serialize_multi_viewport_patches`]). The concatenation:
///
/// - Sums the viewport counts (capped at `u16::MAX`).
/// - Concatenates the per-viewport entry bytes in input order.
///
/// Used by callers that produce two or more patch blobs from the same
/// mutation and want to stream them back to the runtime as a single
/// payload (for example, cross-sheet `relocate_cells_yrs` returns the
/// incremental flush + a full-rebuild blob for each affected sheet).
///
/// 2-byte buffers (the `viewport_count = 0` sentinel) contribute nothing.
#[must_use]
#[allow(clippy::cast_possible_truncation)]
pub fn concat_multi_viewport_patches(blobs: &[Vec<u8>]) -> Vec<u8> {
    let mut total_count: u32 = 0;
    let mut combined_body: Vec<u8> = Vec::new();
    for blob in blobs {
        if blob.len() < 2 {
            continue;
        }
        let count = u16::from_le_bytes([blob[0], blob[1]]);
        if count == 0 {
            continue;
        }
        total_count += u32::from(count);
        combined_body.extend_from_slice(&blob[2..]);
    }
    let count_u16 = u16::try_from(total_count).unwrap_or(u16::MAX);
    let mut out = Vec::with_capacity(2 + combined_body.len());
    out.extend_from_slice(&count_u16.to_le_bytes());
    out.extend_from_slice(&combined_body);
    out
}

/// Pack multiple per-viewport patches into a single binary blob.
///
/// # Wire Layout (all little-endian)
///
/// ```text
/// [u16 viewport_count]
/// For each viewport:
///   [u8 id_len] [id_bytes UTF-8] [u32 patch_len] [patch_bytes...]
/// ```
///
/// If `patches` is empty, returns a 2-byte buffer with `viewport_count = 0`.
#[must_use]
#[allow(clippy::cast_possible_truncation)] // wire protocol fields are protocol-bounded
pub fn serialize_multi_viewport_patches(patches: &[(String, Vec<u8>)]) -> Vec<u8> {
    if patches.is_empty() {
        return vec![0u8, 0u8]; // u16 viewport_count = 0
    }

    // Pre-calculate total size
    let mut total_size = 2; // u16 viewport_count
    for (id, patch_bytes) in patches {
        total_size += 1 + id.len() + 4 + patch_bytes.len(); // u8 id_len + id_bytes + u32 patch_len + patch_bytes
    }

    let mut buf = Vec::with_capacity(total_size);

    buf.extend_from_slice(&(patches.len() as u16).to_le_bytes());

    for (id, patch_bytes) in patches {
        let id_bytes = id.as_bytes();
        buf.push(id_bytes.len() as u8);
        buf.extend_from_slice(id_bytes);
        buf.extend_from_slice(&(patch_bytes.len() as u32).to_le_bytes());
        buf.extend_from_slice(patch_bytes);
    }

    debug_assert_eq!(buf.len(), total_size);
    buf
}
