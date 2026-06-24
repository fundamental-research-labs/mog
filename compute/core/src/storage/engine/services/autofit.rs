//! Autofit service — compute optimal column widths and row heights from cell content.
//!
//! Iterates cells in the target column/row, formats display text via
//! `compute_formats::format_value`, measures text width/height via
//! `compute_text_measurement`, and returns the max dimension.
//!
//! Both read-only (compute dimension) and write (compute + set) variants
//! are provided. The bridge layer in `layout.rs` delegates to these functions.

use cell_types::SheetId;
use compute_text_measurement as text_measure;
use domain_types::units::{Pixels, points_to_pixels};
use rustc_hash::FxHashMap;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::MutationResult;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use crate::storage::sheet::{dimensions, merges};

use compute_document::hex::id_to_hex;

/// Maximum autofit column width in pixels.
const MAX_AUTOFIT_WIDTH: Pixels = Pixels(500.0);
/// Maximum autofit row height in pixels (Excel max).
const MAX_AUTOFIT_HEIGHT: Pixels = Pixels(409.0);
/// Minimum column width in pixels.
const MIN_COL_WIDTH: Pixels = Pixels(20.0);
/// Minimum row height in pixels.
const MIN_ROW_HEIGHT: Pixels = Pixels(16.0);

// ---------------------------------------------------------------------------
// Read-only: compute optimal dimension without setting it
// ---------------------------------------------------------------------------

/// Compute the optimal width for a single column.
pub(in crate::storage::engine) fn auto_fit_column(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    col: u32,
) -> Result<Pixels, ComputeError> {
    let grid = match stores.grid_indexes.get(sheet_id) {
        Some(g) => g,
        None => return Ok(compute_layout_index::platform_default_col_width()),
    };

    let max_row = grid.row_count();

    // Collect cells to measure (avoids borrow conflict with stores.measurement_cache)
    let cells_to_measure: Vec<_> = grid
        .cells_in_range(0, col, max_row.saturating_sub(1), col)
        .collect();

    let all_merges = merges::get_all_merges(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
    );

    // Build merge lookup: (row, col) → index into all_merges. O(total merge area).
    let merge_at = build_merge_lookup(&all_merges);

    let mut max_width: Pixels = Pixels(0.0);

    for (cell_id, row, cell_col) in cells_to_measure {
        if dimensions::is_row_hidden(stores.storage.doc(), stores.storage.sheets(), sheet_id, row) {
            continue;
        }

        // Skip non-origin merge cells, and origin cells spanning multiple columns
        if let Some(&mi) = merge_at.get(&(row, cell_col)) {
            let merge = &all_merges[mi];
            if row != merge.start_row || cell_col != merge.start_col {
                continue;
            }
            if merge.end_col > merge.start_col {
                continue;
            }
        }

        let width = Pixels(measure_cell_width_for_autofit(
            stores, mirror, settings, sheet_id, &cell_id, row, cell_col,
        ));
        if width.0 > max_width.0 {
            max_width = width;
        }
    }

    Ok(Pixels(
        max_width.0.clamp(MIN_COL_WIDTH.0, MAX_AUTOFIT_WIDTH.0),
    ))
}

/// Compute optimal widths for multiple columns in a single call.
pub(in crate::storage::engine) fn auto_fit_columns(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    cols: &[u32],
) -> Result<Vec<(u32, Pixels)>, ComputeError> {
    let mut results = Vec::with_capacity(cols.len());
    for &col in cols {
        let width = auto_fit_column(stores, mirror, settings, sheet_id, col)?;
        results.push((col, width));
    }
    Ok(results)
}

/// Compute the optimal height for a single row.
pub(in crate::storage::engine) fn auto_fit_row(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    row: u32,
) -> Result<Pixels, ComputeError> {
    let grid = match stores.grid_indexes.get(sheet_id) {
        Some(g) => g,
        None => return Ok(compute_layout_index::DEFAULT_ROW_HEIGHT),
    };

    let max_col = grid.col_count();

    let cells_to_measure: Vec<_> = grid
        .cells_in_range(row, 0, row, max_col.saturating_sub(1))
        .collect();

    let all_merges = merges::get_all_merges(
        stores.storage.doc(),
        stores.storage.sheets(),
        *sheet_id,
        grid,
    );

    // Build merge lookup: (row, col) → index into all_merges. O(total merge area).
    let merge_at = build_merge_lookup(&all_merges);

    let mut max_height: Pixels = Pixels(0.0);

    for (cell_id, cell_row, col) in cells_to_measure {
        if dimensions::is_column_hidden(
            stores.storage.doc(),
            stores.storage.sheets(),
            sheet_id,
            col,
        ) {
            continue;
        }

        if let Some(&mi) = merge_at.get(&(cell_row, col)) {
            let merge = &all_merges[mi];
            if cell_row != merge.start_row || col != merge.start_col {
                continue;
            }
            if merge.end_row > merge.start_row {
                continue;
            }
        }

        let height = Pixels(measure_cell_height_for_autofit(
            stores, mirror, settings, sheet_id, &cell_id, cell_row, col,
        ));
        if height.0 > max_height.0 {
            max_height = height;
        }
    }

    if max_height.0 == 0.0 {
        let default = points_to_pixels(super::queries::get_default_row_height(stores, sheet_id));
        return Ok(default);
    }

    Ok(Pixels(
        max_height.0.clamp(MIN_ROW_HEIGHT.0, MAX_AUTOFIT_HEIGHT.0),
    ))
}

/// Compute optimal heights for multiple rows in a single call.
pub(in crate::storage::engine) fn auto_fit_rows(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    rows: &[u32],
) -> Result<Vec<(u32, Pixels)>, ComputeError> {
    let mut results = Vec::with_capacity(rows.len());
    for &row in rows {
        let height = auto_fit_row(stores, mirror, settings, sheet_id, row)?;
        results.push((row, height));
    }
    Ok(results)
}

// ---------------------------------------------------------------------------
// Write: compute + set in one call
// ---------------------------------------------------------------------------

/// Compute and set optimal widths for a single column.
pub(in crate::storage::engine) fn auto_fit_column_and_set(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    col: u32,
) -> Result<MutationResult, ComputeError> {
    let width = auto_fit_column(stores, mirror, settings, sheet_id, col)?;
    super::structural::set_col_width(stores, sheet_id, col, width)
}

/// Compute and set optimal widths for multiple columns.
pub(in crate::storage::engine) fn auto_fit_columns_and_set(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    cols: &[u32],
) -> Result<MutationResult, ComputeError> {
    let widths = auto_fit_columns(stores, mirror, settings, sheet_id, cols)?;
    let mut combined = MutationResult::empty();
    for (col, width) in widths {
        let result = super::structural::set_col_width(stores, sheet_id, col, width)?;
        merge_mutation_results(&mut combined, result);
    }
    Ok(combined)
}

/// Compute and set optimal heights for multiple rows.
pub(in crate::storage::engine) fn auto_fit_rows_and_set(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    rows: &[u32],
) -> Result<MutationResult, ComputeError> {
    let heights = auto_fit_rows(stores, mirror, settings, sheet_id, rows)?;
    let mut combined = MutationResult::empty();
    for (row, height) in heights {
        let result = super::structural::set_row_height(stores, sheet_id, row, height)?;
        merge_mutation_results(&mut combined, result);
    }
    Ok(combined)
}

/// Merge dimension and floating object changes from `src` into `dst`.
fn merge_mutation_results(dst: &mut MutationResult, src: MutationResult) {
    dst.dimension_changes.extend(src.dimension_changes);
    dst.floating_object_changes
        .extend(src.floating_object_changes);
}

// ---------------------------------------------------------------------------
// Merge lookup
// ---------------------------------------------------------------------------

/// Build a HashMap from (row, col) to the index of the merge containing that
/// cell. Since merges never overlap, each position maps to at most one merge.
/// This turns per-cell merge lookups from O(M) to O(1).
fn build_merge_lookup(
    merges: &[domain_types::ResolvedMergedRegion],
) -> FxHashMap<(u32, u32), usize> {
    let mut map = FxHashMap::default();
    for (idx, m) in merges.iter().enumerate() {
        for r in m.start_row..=m.end_row {
            for c in m.start_col..=m.end_col {
                map.insert((r, c), idx);
            }
        }
    }
    map
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Measure the width a cell needs for its content.
fn measure_cell_width_for_autofit(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    cell_id: &cell_types::CellId,
    row: u32,
    col: u32,
) -> f64 {
    let value = get_cell_value(stores, mirror, sheet_id, cell_id);
    if matches!(value, CellValue::Null) {
        return 0.0;
    }

    let effective = get_effective_format(stores, mirror, settings, sheet_id, cell_id, row, col);
    let format_code = effective.number_format.as_deref().unwrap_or("General");
    let display_text = compute_formats::format_value(&value, format_code, &settings.locale).text;

    if display_text.is_empty() {
        return 0.0;
    }

    let font_family = effective.font_family.as_deref().unwrap_or("Calibri");
    let font_size = effective
        .font_size
        .map(|s| s.points() as f32)
        .unwrap_or(11.0);
    let bold = effective.bold.unwrap_or(false);
    let italic = effective.italic.unwrap_or(false);
    let indent = effective.indent.unwrap_or(0);
    let rotation = effective.text_rotation.unwrap_or(0).max(0) as u16;

    if rotation != 0 {
        let (w, _h) = text_measure::measure_rotated_cell(
            &stores.font_db,
            font_family,
            font_size,
            bold,
            italic,
            &display_text,
            rotation,
        );
        return w as f64;
    }

    // Check cache
    if let Some((font_id, _)) = stores.font_db.resolve_styled(font_family, bold, italic)
        && let Some(cached) = stores
            .measurement_cache
            .get(font_id, font_size, &display_text)
    {
        let indent_px = indent as f32 * text_measure::cell_measure::INDENT_WIDTH;
        return (cached
            + text_measure::cell_measure::CELL_PADDING * 2.0
            + text_measure::cell_measure::AUTOFIT_PADDING
            + indent_px) as f64;
    }

    let width = text_measure::measure_cell_width(
        &stores.font_db,
        font_family,
        font_size,
        bold,
        italic,
        indent,
        &display_text,
    );

    width as f64
}

/// Measure the height a cell needs for its content.
fn measure_cell_height_for_autofit(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    cell_id: &cell_types::CellId,
    row: u32,
    col: u32,
) -> f64 {
    let value = get_cell_value(stores, mirror, sheet_id, cell_id);
    if matches!(value, CellValue::Null) {
        return 0.0;
    }

    let effective = get_effective_format(stores, mirror, settings, sheet_id, cell_id, row, col);
    let format_code = effective.number_format.as_deref().unwrap_or("General");
    let display_text = compute_formats::format_value(&value, format_code, &settings.locale).text;

    if display_text.is_empty() {
        return 0.0;
    }

    let font_family = effective.font_family.as_deref().unwrap_or("Calibri");
    let font_size = effective
        .font_size
        .map(|s| s.points() as f32)
        .unwrap_or(11.0);
    let bold = effective.bold.unwrap_or(false);
    let italic = effective.italic.unwrap_or(false);
    let wrap_text = effective.wrap_text.unwrap_or(false);
    let rotation = effective.text_rotation.unwrap_or(0).max(0) as u16;

    if rotation != 0 {
        let (_w, h) = text_measure::measure_rotated_cell(
            &stores.font_db,
            font_family,
            font_size,
            bold,
            italic,
            &display_text,
            rotation,
        );
        return h as f64;
    }

    let available_width = stores
        .layout_indexes
        .get(sheet_id)
        .map(|li| li.get_col_width(col as usize).0 as f32)
        .unwrap_or(compute_layout_index::platform_default_col_width().0 as f32);

    let height = text_measure::measure_cell_height(
        &stores.font_db,
        font_family,
        font_size,
        bold,
        italic,
        wrap_text,
        &display_text,
        available_width,
    );

    height as f64
}

/// Get cell value: ComputeCore first, mirror fallback.
fn get_cell_value(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    cell_id: &cell_types::CellId,
) -> CellValue {
    stores
        .compute
        .get_cell_value(mirror, cell_id)
        .cloned()
        .unwrap_or_else(|| {
            mirror
                .get_cell_value_in_sheet(sheet_id, cell_id)
                .cloned()
                .unwrap_or(CellValue::Null)
        })
}

/// Get effective format for a cell (resolves col > row > table > cell cascade).
fn get_effective_format(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    sheet_id: &SheetId,
    cell_id: &cell_types::CellId,
    row: u32,
    col: u32,
) -> domain_types::CellFormat {
    let cell_id_hex = id_to_hex(cell_id.as_u128());
    let table_fmt = super::resolve_structured_format_at_cell(mirror, sheet_id, row, col);
    let mut effective = properties::get_effective_format(
        &stores.storage,
        sheet_id,
        &cell_id_hex,
        row,
        col,
        table_fmt.as_ref(),
        stores.grid_indexes.get(sheet_id),
        mirror.get_sheet(sheet_id),
    );
    domain_types::theme_color::resolve_theme_refs(&mut effective, &settings.theme_palette);
    effective
}
