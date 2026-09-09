//! Native cell properties and the format cascade.
//!
//! Cell properties use stable CellIds. Imported style-only cells retain a shared
//! workbook palette index; metadata and edited formats are allocated when present.
//! Effective formats merge workbook defaults, column, row, format range, table,
//! and cell layers in that order.

mod cascade;
mod cell;
mod defaults;
mod merge;
mod protection;
mod ranges;
mod row_col;
mod string_ids;

pub use crate::engine_types::formatting::*;

#[cfg(test)]
use cascade::apply_format_range_layer;
pub use cascade::{
    get_effective_format, get_effective_format_by_id, get_effective_format_preloaded,
    get_positional_format,
};
pub(crate) use cascade::{
    get_effective_format_from_preloaded_layers,
    get_effective_format_from_preloaded_layers_with_range, get_workbook_base_format,
};
pub(crate) use cell::StoredCellProperties;
pub(crate) use cell::{PreloadedCellFormatLayers, get_cell_format_layers_for_ids};
pub use defaults::default_format;
pub(crate) use merge::normalize_format_patch;
pub(crate) use merge::{apply_borders_patch, apply_format_patch, merge_formats};
pub use protection::{
    is_cell_locked, is_cell_locked_by_id, is_formula_hidden, is_formula_hidden_by_id,
};
pub(crate) use ranges::{
    CopiedFormats, ImportedFormats, clear_col_format_ranges_in_span, patch_native_format_ranges,
    rectangle_difference, set_col_format_range_with_alloc,
};
pub use ranges::{add_format_range, remove_format_range};
pub use row_col::{
    ColFormatEntry, RowFormatEntry, clear_col_format, clear_row_format, get_all_col_formats,
    get_all_row_formats, get_col_format, get_col_xlsx_style_id, get_row_format,
    get_row_xlsx_style_id, patch_col_borders, patch_col_format, patch_row_borders,
    patch_row_format, set_col_format, set_row_format,
};
pub use string_ids::{
    clear_cell_format, clear_cell_formats, clear_formula_cache_metadata, clear_properties,
    get_cell_format, get_properties, patch_cell_borders, patch_cell_format, patch_cell_formats,
    replace_cell_format, set_cell_format, set_cell_formats, set_properties,
};
#[cfg(test)]
mod tests;

pub use cell::{
    clear_cell_format_by_id, clear_cell_formats_by_id, clear_formula_cache_metadata_by_id,
    clear_formula_cache_metadata_for_cell_ids, clear_properties_by_id, get_all_properties,
    get_cell_format_by_id, get_properties_by_id, iter_all_properties,
    iter_formatted_property_cell_ids, patch_cell_borders_by_id, patch_cell_format_by_id,
    patch_cell_formats_by_id, replace_cell_format_by_id, set_cell_format_by_id,
    set_cell_formats_by_id, set_properties_by_id,
};
