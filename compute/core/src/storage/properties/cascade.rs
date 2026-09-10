use super::cell::get_properties_by_id;
use super::defaults::default_format;
use super::merge::merge_formats;
use super::row_col::{get_col_format, get_row_format};
use crate::cells::SheetStore;
use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use crate::storage::properties::CellProperties;
use cell_types::{CellId, SheetId};
use domain_types::{CellFormat, CellVerticalAlign};
use ooxml_types::styles::{HorizontalAlign, PatternType};

/// Get the effective (computed) format for a cell.
///
/// Merges from lowest to highest priority:
/// `default -> workbook Normal -> column range default -> column -> row -> inherited range -> table -> direct range -> cell`
///
/// Each property is resolved independently -- a cell can inherit font
/// from row, color from column, and alignment from default.
///
/// The `sheet_store` parameter is optional; when provided, Format Ranges
/// in the cell store's spatial index are consulted. When `None`, the cascade
/// skips the Format Range layer.
pub fn get_effective_format(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    row: u32,
    col: u32,
    table_format: Option<&CellFormat>,
    grid_index: Option<&GridIndex>,
    sheet_store: Option<&SheetStore>,
) -> CellFormat {
    let id = compute_document::hex::parse_cell_id(cell_id);
    get_effective_format_by_id(
        storage,
        sheet_id,
        id.as_ref(),
        row,
        col,
        table_format,
        grid_index,
        sheet_store,
    )
}

/// Resolve the format cascade using an already-resolved cell identity.
pub fn get_effective_format_by_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: Option<&CellId>,
    row: u32,
    col: u32,
    table_format: Option<&CellFormat>,
    grid_index: Option<&GridIndex>,
    sheet_store: Option<&SheetStore>,
) -> CellFormat {
    let base = get_workbook_base_format(storage);
    let col_format = get_col_format(storage, sheet_id, col, grid_index);
    let row_format = get_row_format(storage, sheet_id, row, grid_index);
    let cell_props = cell_id.and_then(|id| get_properties_by_id(storage, sheet_id, id));
    let cell_format = materialize_cell_layer_format(cell_props.as_ref());
    get_effective_format_from_preloaded_layers(
        &base,
        col_format.as_ref(),
        row_format.as_ref(),
        row,
        col,
        table_format,
        Some(&cell_format),
        sheet_store,
        false,
    )
}

/// Same cascade as `get_effective_format`, but accepts pre-fetched cell properties
/// to avoid a redundant property lookup when the caller already has them (e.g. for the
/// skip-empty-cell check in `query_range`).
pub fn get_effective_format_preloaded(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    table_format: Option<&CellFormat>,
    cell_properties: Option<&CellProperties>,
    grid_index: Option<&GridIndex>,
    sheet_store: Option<&SheetStore>,
) -> CellFormat {
    let base = get_workbook_base_format(storage);
    let col_format = get_col_format(storage, sheet_id, col, grid_index);
    let row_format = get_row_format(storage, sheet_id, row, grid_index);
    let cell_format = materialize_cell_layer_format(cell_properties);
    get_effective_format_from_preloaded_layers(
        &base,
        col_format.as_ref(),
        row_format.as_ref(),
        row,
        col,
        table_format,
        Some(&cell_format),
        sheet_store,
        false,
    )
}

/// Positional format for cells with no cell_id:
/// default → workbook Normal → column range default → column → row → Format Range.
///
/// This is the same cascade as `get_effective_format` but without the cell and
/// table layers (which require a cell_id). Used by the viewport render pipeline
/// for grid positions that have no allocated cell.
pub fn get_positional_format(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    grid_index: Option<&GridIndex>,
    sheet_store: Option<&SheetStore>,
) -> CellFormat {
    let base = get_workbook_base_format(storage);
    let col_format = get_col_format(storage, sheet_id, col, grid_index);
    let row_format = get_row_format(storage, sheet_id, row, grid_index);
    get_effective_format_from_preloaded_layers(
        &base,
        col_format.as_ref(),
        row_format.as_ref(),
        row,
        col,
        None,
        None,
        sheet_store,
        true,
    )
}

/// Resolve the cascade from layers that were loaded once for a batch read.
///
/// This is the transaction-free core shared by scalar and bulk displayed
/// formatting. `include_imported_xlsx_col_ranges` is true only for positions
/// without an allocated cell, matching [`get_positional_format`].
#[allow(clippy::too_many_arguments)]
pub(crate) fn get_effective_format_from_preloaded_layers(
    base: &CellFormat,
    col_format: Option<&CellFormat>,
    row_format: Option<&CellFormat>,
    row: u32,
    col: u32,
    table_format: Option<&CellFormat>,
    cell_format: Option<&CellFormat>,
    sheet_store: Option<&SheetStore>,
    include_imported_xlsx_col_ranges: bool,
) -> CellFormat {
    let after_col_range =
        apply_col_format_range_layer(base, col, sheet_store, include_imported_xlsx_col_ranges);
    let after_col = match col_format {
        Some(format) => merge_formats(&after_col_range, format),
        None => after_col_range,
    };
    let after_row = match row_format {
        Some(format) => merge_formats(&after_col, format),
        None => after_col,
    };
    let after_range = apply_format_range_layer(&after_row, row, col, sheet_store);
    let after_table = match table_format {
        Some(format) => merge_formats(&after_range, format),
        None => after_range,
    };
    let after_table = apply_direct_format_range_layer(&after_table, row, col, sheet_store);
    let effective = match cell_format {
        Some(format) => merge_formats(&after_table, format),
        None => after_table,
    };
    canonicalize_effective_fill(effective)
}

/// Resolve the cascade with an already-merged Format Range layer.
///
/// Bulk callers use this to avoid a spatial-index query and temporary match
/// vector for every cell. `format_range` must already reflect ascending
/// range precedence, exactly like [`apply_format_range_layer`].
#[allow(clippy::too_many_arguments)]
pub(crate) fn get_effective_format_from_preloaded_layers_with_range(
    base: &CellFormat,
    col_format: Option<&CellFormat>,
    row_format: Option<&CellFormat>,
    col: u32,
    format_range: Option<&CellFormat>,
    direct_range: Option<&CellFormat>,
    table_format: Option<&CellFormat>,
    cell_format: Option<&CellFormat>,
    sheet_store: Option<&SheetStore>,
    include_imported_xlsx_col_ranges: bool,
) -> CellFormat {
    let after_col_range =
        apply_col_format_range_layer(base, col, sheet_store, include_imported_xlsx_col_ranges);
    let after_col = match col_format {
        Some(format) => merge_formats(&after_col_range, format),
        None => after_col_range,
    };
    let after_row = match row_format {
        Some(format) => merge_formats(&after_col, format),
        None => after_col,
    };
    let after_range = match format_range {
        Some(format) => merge_formats(&after_row, format),
        None => after_row,
    };
    let after_table = match table_format {
        Some(format) => merge_formats(&after_range, format),
        None => after_range,
    };
    let after_table = direct_range
        .map(|format| merge_formats(&after_table, format))
        .unwrap_or(after_table);
    let effective = match cell_format {
        Some(format) => merge_formats(&after_table, format),
        None => after_table,
    };
    canonicalize_effective_fill(effective)
}

/// Canonicalize the fully-resolved fill contract returned by effective-format
/// reads. Sparse authored layers must remain sparse while the cascade is still
/// being merged so that a higher background-color shorthand or complete fill
/// can apply normally. Once every layer has resolved, however, an entirely
/// absent fill has one unambiguous transferable representation: `none`, and
/// the public background-color shorthand has the explicit representation
/// `solid` that XLSX export/import also produces.
fn canonicalize_effective_fill(mut format: CellFormat) -> CellFormat {
    if format.gradient_fill.is_none()
        && format.pattern_type.is_none()
        && format.background_color.is_some()
    {
        format.pattern_type = Some(PatternType::Solid);
    } else if fill_fields_are_absent(&format) {
        format.pattern_type = Some(PatternType::None);
    }
    format
}

/// Workbook Normal style is stored as style palette entry 0 during XLSX
/// hydration. It sits above Mog's built-in fallback defaults and below every
/// positional or authored style layer.
pub(crate) fn get_workbook_base_format(storage: &WorkbookStorage) -> CellFormat {
    let base = default_format();
    let Some(normal) = workbook_normal_format(storage) else {
        return base;
    };
    merge_formats(&base, &normal)
}

fn workbook_normal_format(storage: &WorkbookStorage) -> Option<CellFormat> {
    storage.metadata.style_palette.first().cloned()
}

pub(crate) fn materialize_cell_layer_format(
    cell_properties: Option<&CellProperties>,
) -> CellFormat {
    let Some(props) = cell_properties else {
        return CellFormat::default();
    };

    let mut format = props.format.clone().unwrap_or_default();
    if props.style_id.is_some() {
        materialize_imported_cell_xf_defaults(&mut format);
    }
    format
}

pub(super) fn materialize_imported_cell_xf_defaults(format: &mut CellFormat) {
    format
        .number_format
        .get_or_insert_with(|| "General".to_string());
    format
        .horizontal_align
        .get_or_insert(HorizontalAlign::General);
    format
        .vertical_align
        .get_or_insert(CellVerticalAlign::Bottom);
    format.wrap_text.get_or_insert(false);
    format.indent.get_or_insert(0);
    format.text_rotation.get_or_insert(0);
    format.shrink_to_fit.get_or_insert(false);
    format
        .reading_order
        .get_or_insert_with(|| "context".to_string());
    format.auto_indent.get_or_insert(false);

    // The XLSX style palette contains the fully-resolved result of a concrete
    // cellXf. A cellXf whose effective fill is fillId=0 is intentionally sparse
    // in that palette: all fill fields are absent. At the cell layer, however,
    // that means "no fill", not "inherit a row/column fill". Materialize the
    // explicit sentinel only for a truly absent fill; gradient and authored
    // pattern fills must remain untouched.
    if fill_fields_are_absent(format) {
        format.pattern_type = Some(PatternType::None);
    }
}

fn fill_fields_are_absent(format: &CellFormat) -> bool {
    format.background_color.is_none()
        && format.background_color_tint.is_none()
        && format.pattern_type.is_none()
        && format.pattern_foreground_color.is_none()
        && format.pattern_foreground_color_tint.is_none()
        && format.gradient_fill.is_none()
}

// -------------------------------------------------------------------
// Column Format Range Layer Helper
// -------------------------------------------------------------------

fn apply_col_format_range_layer(
    base: &CellFormat,
    col: u32,
    sheet_store: Option<&SheetStore>,
    include_imported_xlsx_ranges: bool,
) -> CellFormat {
    let cell_store = match sheet_store {
        Some(m) => m,
        None => return base.clone(),
    };

    let matching = cell_store.col_format_ranges_at(col);
    if matching.is_empty() {
        return base.clone();
    }

    let mut range_fmt = CellFormat::default();
    for (id, fmt) in &matching {
        // Excel treats imported `<col style>` defaults as positional defaults
        // for empty cells; populated cells keep workbook Normal unless another
        // cell/row/user-authored column layer applies.
        if !include_imported_xlsx_ranges
            && cell_store.col_range_xlsx_style_id_cache().contains_key(id)
        {
            continue;
        }
        range_fmt = merge_formats(&range_fmt, fmt);
    }
    merge_formats(base, &range_fmt)
}

// -------------------------------------------------------------------
// Format Range Layer Helper
// -------------------------------------------------------------------

/// Apply the Format Range layer to the cascade.
///
/// Queries the cell store's format range spatial index for all Format Ranges
/// covering `(row, col)`, merges them field-by-field in stable precedence order, and merges the result into `base`.
///
/// When `sheet_store` is `None`, this is a no-op that returns `base` unchanged
/// (backward-compatible with code paths that don't have a cell store reference).
pub(in crate::storage::properties) fn apply_format_range_layer(
    base: &CellFormat,
    row: u32,
    col: u32,
    sheet_store: Option<&SheetStore>,
) -> CellFormat {
    let cell_store = match sheet_store {
        Some(m) => m,
        None => return base.clone(),
    };

    let matching = cell_store.format_ranges_at_layer(
        row,
        col,
        Some(crate::cells::FormatRangeLayer::Inherited),
    );
    if matching.is_empty() {
        return base.clone();
    }

    // Merge overlapping rectangles in their stable precedence order.
    let mut range_fmt = CellFormat::default();
    for (_id, fmt) in &matching {
        range_fmt = merge_formats(&range_fmt, fmt);
    }

    // Merge into the cascade (Format Range overrides row).
    merge_formats(base, &range_fmt)
}

fn apply_direct_format_range_layer(
    base: &CellFormat,
    row: u32,
    col: u32,
    sheet: Option<&SheetStore>,
) -> CellFormat {
    let Some(sheet) = sheet else {
        return base.clone();
    };
    sheet
        .format_ranges_at_layer(row, col, Some(crate::cells::FormatRangeLayer::Direct))
        .into_iter()
        .fold(base.clone(), |format, (_, overlay)| {
            merge_formats(&format, overlay)
        })
}
