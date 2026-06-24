//! Cell properties CRUD, row/column format, format inheritance, and protection.
//!
//! Port of `spreadsheet-model/src/properties.ts` (spreadsheet-model elimination).
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has three maps for properties/format data:
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- cellProperties: Y.Map<CellId, Y.Map (structured)>
//!       +-- rowFormats: Y.Map<RowId, Y.Map (structured CellFormat fields)>
//!       +-- colFormats: Y.Map<ColId, Y.Map (structured CellFormat fields)>
//! ```
//!
//! ## Cell Properties Storage
//!
//! Cell properties are stored as structured Y.Maps via `yrs_schema::cell_properties`.
//! Round-trip bookkeeping (style palette index, cm, vm, formula_result_type,
//! has_empty_cached_value, original_sst_index, original_value) lives as typed fields on
//! `CellProperties`; each field has its own short Yrs key (`si`, `cm`, `vm`,
//! `frt`, `ecv`, `sst`, `ov`) alongside the format keys.
//!
//! The `style_id` field references the workbook-level `stylePalette` map, which
//! stores the full `CellFormat` per index. This reduces per-cell Yrs payload
//! from ~500 bytes to ~10 bytes (~50x reduction) for unedited XLSX cells.
//!
//! User edits transition cells to full format with the `CellFormat`
//! written inline (the `style_id` field is cleared).
//!
//! Row/col formats use structured Y.Map storage (short keys like "ff", "fs",
//! "bg", etc.) via `yrs_schema::cell_format`.
//!
//! ## Format Inheritance
//!
//! Effective format = merge(default, column, row, **Format Range**, table, cell)
//! with later layers overriding earlier ones on a per-property basis.
//! Format Ranges sit between row and table in the cascade. When multiple
//! Format Ranges overlap at a cell position, they merge field-by-field with
//! higher `RangeId` values winning on conflicts.
//! Matches Excel's "Normal" style priority chain.
//!
//! ## Style Operations
//!
//! Style-related operations (getStyleById, applyStyleToRange, custom style CRUD)
//! are **deferred** -- they require a built-in style registry from contracts.

mod cascade;
mod cell;
mod defaults;
mod merge;
mod protection;
mod ranges;
mod row_col;
mod yrs;

pub use crate::engine_types::formatting::*;

#[cfg(test)]
use cascade::apply_format_range_layer;
pub use cascade::{get_effective_format, get_effective_format_preloaded, get_positional_format};
pub use cell::{
    clear_cell_format, clear_cell_formats, clear_formula_cache_metadata,
    clear_formula_cache_metadata_for_cell_ids, clear_properties, get_all_properties,
    get_cell_format, get_properties, iter_all_properties, iter_formatted_property_cell_ids,
    replace_cell_format, set_cell_format, set_cell_formats, set_cell_formats_with_origin,
    set_properties,
};
pub use defaults::default_format;
pub(crate) use merge::merge_formats;
pub(crate) use merge::normalize_format_patch;
pub use protection::{is_cell_locked, is_formula_hidden};
pub(crate) use ranges::set_col_format_range_with_alloc;
pub use ranges::{
    add_format_range, hydrate_col_format_ranges, hydrate_format_ranges, remove_format_range,
};
pub(crate) use row_col::clear_col_format_with_alloc;
pub use row_col::{
    ColFormatEntry, RowFormatEntry, clear_col_format, clear_row_format, get_all_col_formats,
    get_all_row_formats, get_col_format, get_col_xlsx_style_id, get_row_format,
    get_row_xlsx_style_id, set_col_format, set_row_format,
};
pub(crate) use yrs::resolve_compact_props_with_txn;
#[cfg(test)]
mod tests;
