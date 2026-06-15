use super::super::KEY_STYLE_PALETTE;
use super::cell::get_cell_format;
use super::defaults::default_format;
use super::merge::merge_formats;
use super::row_col::{get_col_format, get_row_format};
use crate::identity::GridIndex;
use crate::mirror::SheetMirror;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use domain_types::CellFormat;
use yrs::{Any, Map, Out, Transact};

/// Get the effective (computed) format for a cell.
///
/// Merges from lowest to highest priority:
/// `default -> workbook Normal -> column range default -> column -> row -> Format Range -> table -> cell`
///
/// Each property is resolved independently -- a cell can inherit font
/// from row, color from column, and alignment from default.
///
/// The `sheet_mirror` parameter is optional; when provided, Format Ranges
/// in the mirror's spatial index are consulted. When `None`, the cascade
/// skips the Format Range layer.
pub fn get_effective_format(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    row: u32,
    col: u32,
    table_format: Option<&CellFormat>,
    grid_index: Option<&GridIndex>,
    sheet_mirror: Option<&SheetMirror>,
) -> CellFormat {
    let base = workbook_base_format(storage);

    let after_col_range = apply_col_format_range_layer(&base, col, sheet_mirror);

    let col_fmt = get_col_format(storage, sheet_id, col, grid_index).unwrap_or_default();
    let after_col = merge_formats(&after_col_range, &col_fmt);

    let row_fmt = get_row_format(storage, sheet_id, row, grid_index).unwrap_or_default();
    let after_row = merge_formats(&after_col, &row_fmt);

    // Format Range layer: between row and table.
    let after_range = apply_format_range_layer(&after_row, row, col, sheet_mirror);

    let after_table = match table_format {
        Some(tf) => merge_formats(&after_range, tf),
        None => after_range,
    };

    let cell_fmt = get_cell_format(
        storage.doc(),
        storage.workbook_map(),
        storage.sheets(),
        sheet_id,
        cell_id,
    )
    .unwrap_or_default();
    merge_formats(&after_table, &cell_fmt)
}

/// Same cascade as `get_effective_format`, but accepts a pre-fetched cell format
/// to avoid a redundant CRDT read when the caller already has it (e.g. for the
/// skip-empty-cell check in `query_range`).
pub fn get_effective_format_preloaded(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    table_format: Option<&CellFormat>,
    cell_format: &CellFormat,
    grid_index: Option<&GridIndex>,
    sheet_mirror: Option<&SheetMirror>,
) -> CellFormat {
    let base = workbook_base_format(storage);

    let after_col_range = apply_col_format_range_layer(&base, col, sheet_mirror);

    let col_fmt = get_col_format(storage, sheet_id, col, grid_index).unwrap_or_default();
    let after_col = merge_formats(&after_col_range, &col_fmt);

    let row_fmt = get_row_format(storage, sheet_id, row, grid_index).unwrap_or_default();
    let after_row = merge_formats(&after_col, &row_fmt);

    // Format Range layer: between row and table.
    let after_range = apply_format_range_layer(&after_row, row, col, sheet_mirror);

    let after_table = match table_format {
        Some(tf) => merge_formats(&after_range, tf),
        None => after_range,
    };

    merge_formats(&after_table, cell_format)
}

/// Positional format for cells with no cell_id:
/// default → workbook Normal → column range default → column → row → Format Range.
///
/// This is the same cascade as `get_effective_format` but without the cell and
/// table layers (which require a cell_id). Used by the viewport render pipeline
/// for grid positions that have no allocated cell.
pub fn get_positional_format(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    grid_index: Option<&GridIndex>,
    sheet_mirror: Option<&SheetMirror>,
) -> CellFormat {
    let base = workbook_base_format(storage);

    let after_col_range = apply_col_format_range_layer(&base, col, sheet_mirror);

    let col_fmt = get_col_format(storage, sheet_id, col, grid_index).unwrap_or_default();
    let after_col = merge_formats(&after_col_range, &col_fmt);

    let row_fmt = get_row_format(storage, sheet_id, row, grid_index).unwrap_or_default();
    let after_row = merge_formats(&after_col, &row_fmt);

    // Format Range layer: between row and table (no table/cell layer in positional format).
    apply_format_range_layer(&after_row, row, col, sheet_mirror)
}

/// Workbook Normal style is stored as style palette entry 0 during XLSX
/// hydration. It sits above Mog's built-in fallback defaults and below every
/// positional or authored style layer.
fn workbook_base_format(storage: &YrsStorage) -> CellFormat {
    let base = default_format();
    let Some(normal) = workbook_normal_format(storage) else {
        return base;
    };
    merge_formats(&base, &normal)
}

fn workbook_normal_format(storage: &YrsStorage) -> Option<CellFormat> {
    let txn = storage.doc().transact();
    let palette = match storage.workbook_map().get(&txn, KEY_STYLE_PALETTE) {
        Some(Out::YMap(map)) => map,
        _ => return None,
    };
    match palette.get(&txn, "0") {
        Some(Out::Any(Any::String(ref fmt_json))) => {
            serde_json::from_str::<CellFormat>(fmt_json).ok()
        }
        _ => None,
    }
}

// -------------------------------------------------------------------
// Column Format Range Layer Helper
// -------------------------------------------------------------------

fn apply_col_format_range_layer(
    base: &CellFormat,
    col: u32,
    sheet_mirror: Option<&SheetMirror>,
) -> CellFormat {
    let mirror = match sheet_mirror {
        Some(m) => m,
        None => return base.clone(),
    };

    let matching = mirror.col_format_ranges_at(col);
    if matching.is_empty() {
        return base.clone();
    }

    let mut range_fmt = CellFormat::default();
    for (_id, fmt) in &matching {
        range_fmt = merge_formats(&range_fmt, fmt);
    }
    merge_formats(base, &range_fmt)
}

// -------------------------------------------------------------------
// Format Range Layer Helper
// -------------------------------------------------------------------

/// Apply the Format Range layer to the cascade.
///
/// Queries the mirror's format range spatial index for all Format Ranges
/// covering `(row, col)`, merges them field-by-field with higher `RangeId`
/// winning on conflicts, and merges the result into `base`.
///
/// When `sheet_mirror` is `None`, this is a no-op that returns `base` unchanged
/// (backward-compatible with code paths that don't have a mirror reference).
pub(in crate::storage::properties) fn apply_format_range_layer(
    base: &CellFormat,
    row: u32,
    col: u32,
    sheet_mirror: Option<&SheetMirror>,
) -> CellFormat {
    let mirror = match sheet_mirror {
        Some(m) => m,
        None => return base.clone(),
    };

    let matching = mirror.format_ranges_at(row, col);
    if matching.is_empty() {
        return base.clone();
    }

    // Merge overlapping Format Ranges: iterate in RangeId order (ascending)
    // so that higher RangeId values override lower ones on per-property conflicts.
    let mut range_fmt = CellFormat::default();
    for (_id, fmt) in &matching {
        range_fmt = merge_formats(&range_fmt, fmt);
    }

    // Merge into the cascade (Format Range overrides row).
    merge_formats(base, &range_fmt)
}
