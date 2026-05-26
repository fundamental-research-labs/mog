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
//! original_sst_index, original_value) lives as typed fields on
//! `CellProperties`; each field has its own short Yrs key (`si`, `cm`, `vm`,
//! `frt`, `sst`, `ov`) alongside the format keys.
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

use compute_document::undo::ORIGIN_USER_EDIT;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

use super::{KEY_CELL_PROPERTIES, KEY_COL_FORMATS, KEY_ROW_FORMATS, id_to_hex};
pub use crate::engine_types::formatting::*;
use crate::identity::GridIndex;
use crate::mirror::SheetMirror;
use crate::storage::YrsStorage;
use cell_types::{CellId, SheetId};
use compute_document::hex::parse_cell_id;
use domain_types::yrs_schema;
use domain_types::yrs_schema::cell_properties as props_schema;
use domain_types::{CellBorderSide, CellBorders, CellFormat};
use value_types::ComputeError;

// =============================================================================
// Default Format
// =============================================================================

/// Excel "Normal" style defaults -- the lowest-priority layer in format
/// inheritance. Any property not overridden at column, row, or cell level
/// resolves to these values.
pub fn default_format() -> CellFormat {
    CellFormat {
        font_family: Some("Calibri".to_string()),
        font_size: Some(domain_types::FontSize::from_millipoints(11000)),
        font_color: Some("#000000".to_string()),
        bold: Some(false),
        italic: Some(false),
        underline_type: Some(ooxml_types::styles::UnderlineStyle::None),
        strikethrough: Some(false),
        horizontal_align: Some(ooxml_types::styles::HorizontalAlign::General),
        vertical_align: Some(domain_types::CellVerticalAlign::Bottom),
        wrap_text: Some(false),
        locked: Some(true),
        hidden: Some(false),
        ..Default::default()
    }
}

// =============================================================================
// Format Merge Helper
// =============================================================================

/// Merge two `CellFormat` objects with property-level precedence.
/// For each field: if `higher` has `Some`, use it; otherwise keep `lower`.
fn merge_formats(lower: &CellFormat, higher: &CellFormat) -> CellFormat {
    let higher = normalize_format_patch(higher);
    let mut merged = CellFormat {
        font_family: higher.font_family.clone().or(lower.font_family.clone()),
        font_size: higher.font_size.or(lower.font_size),
        font_color: higher.font_color.clone().or(lower.font_color.clone()),
        font_color_tint: higher.font_color_tint.or(lower.font_color_tint),
        bold: higher.bold.or(lower.bold),
        italic: higher.italic.or(lower.italic),
        underline_type: higher.underline_type.or(lower.underline_type),
        strikethrough: higher.strikethrough.or(lower.strikethrough),
        superscript: higher.superscript.or(lower.superscript),
        subscript: higher.subscript.or(lower.subscript),
        font_outline: higher.font_outline.or(lower.font_outline),
        font_shadow: higher.font_shadow.or(lower.font_shadow),
        font_theme: higher.font_theme.clone().or(lower.font_theme.clone()),
        font_charset: higher.font_charset.or(lower.font_charset),
        font_family_type: higher.font_family_type.or(lower.font_family_type),
        horizontal_align: higher.horizontal_align.or(lower.horizontal_align),
        vertical_align: higher.vertical_align.or(lower.vertical_align),
        wrap_text: higher.wrap_text.or(lower.wrap_text),
        indent: higher.indent.or(lower.indent),
        text_rotation: higher.text_rotation.or(lower.text_rotation),
        shrink_to_fit: higher.shrink_to_fit.or(lower.shrink_to_fit),
        reading_order: higher.reading_order.clone().or(lower.reading_order.clone()),
        auto_indent: higher.auto_indent.or(lower.auto_indent),
        number_format: higher.number_format.clone().or(lower.number_format.clone()),
        background_color: higher
            .background_color
            .clone()
            .or(lower.background_color.clone()),
        background_color_tint: higher.background_color_tint.or(lower.background_color_tint),
        pattern_type: higher.pattern_type.or(lower.pattern_type),
        pattern_foreground_color: higher
            .pattern_foreground_color
            .clone()
            .or(lower.pattern_foreground_color.clone()),
        pattern_foreground_color_tint: higher
            .pattern_foreground_color_tint
            .or(lower.pattern_foreground_color_tint),
        gradient_fill: higher.gradient_fill.clone().or(lower.gradient_fill.clone()),
        borders: merge_borders(lower.borders.as_ref(), higher.borders.as_ref()),
        locked: higher.locked.or(lower.locked),
        hidden: higher.hidden.or(lower.hidden),
        quote_prefix: higher.quote_prefix.or(lower.quote_prefix),
    };

    // Clean up any invalid legacy lower layer that already carries both flags.
    enforce_wrap_shrink_exclusive(&mut merged);
    merged
}

fn merge_borders(lower: Option<&CellBorders>, higher: Option<&CellBorders>) -> Option<CellBorders> {
    let Some(higher) = higher else {
        return lower.cloned();
    };

    if is_empty_borders(higher) {
        return Some(CellBorders::default());
    }

    let lower = lower.cloned().unwrap_or_default();
    Some(CellBorders {
        top: merge_border_side(lower.top.as_ref(), higher.top.as_ref()),
        right: merge_border_side(lower.right.as_ref(), higher.right.as_ref()),
        bottom: merge_border_side(lower.bottom.as_ref(), higher.bottom.as_ref()),
        left: merge_border_side(lower.left.as_ref(), higher.left.as_ref()),
        diagonal: merge_border_side(lower.diagonal.as_ref(), higher.diagonal.as_ref()),
        diagonal_up: higher.diagonal_up.or(lower.diagonal_up),
        diagonal_down: higher.diagonal_down.or(lower.diagonal_down),
        vertical: merge_border_side(lower.vertical.as_ref(), higher.vertical.as_ref()),
        horizontal: merge_border_side(lower.horizontal.as_ref(), higher.horizontal.as_ref()),
        outline: higher.outline.or(lower.outline),
    })
}

fn merge_border_side(
    lower: Option<&CellBorderSide>,
    higher: Option<&CellBorderSide>,
) -> Option<CellBorderSide> {
    let Some(higher) = higher else {
        return lower.cloned();
    };

    if is_empty_border_side(higher) {
        return Some(CellBorderSide::default());
    }

    let lower = lower.cloned().unwrap_or_default();
    Some(CellBorderSide {
        style: higher.style.or(lower.style),
        color: higher.color.clone().or(lower.color),
        color_tint: higher.color_tint.or(lower.color_tint),
    })
}

fn is_empty_borders(borders: &CellBorders) -> bool {
    borders.top.is_none()
        && borders.right.is_none()
        && borders.bottom.is_none()
        && borders.left.is_none()
        && borders.diagonal.is_none()
        && borders.diagonal_up.is_none()
        && borders.diagonal_down.is_none()
        && borders.vertical.is_none()
        && borders.horizontal.is_none()
        && borders.outline.is_none()
}

fn is_empty_border_side(side: &CellBorderSide) -> bool {
    side.style.is_none() && side.color.is_none() && side.color_tint.is_none()
}

pub(crate) fn normalize_format_patch(format: &CellFormat) -> CellFormat {
    let mut normalized = format.clone();
    match (normalized.wrap_text, normalized.shrink_to_fit) {
        // Same-patch conflicts are unordered in the struct representation.
        // Canonicalize to wrapText, matching the default dialog precedence.
        (Some(true), Some(true)) => normalized.shrink_to_fit = Some(false),
        (Some(true), _) => normalized.shrink_to_fit = Some(false),
        (_, Some(true)) => normalized.wrap_text = Some(false),
        _ => {}
    }
    normalized
}

fn enforce_wrap_shrink_exclusive(format: &mut CellFormat) {
    if format.wrap_text == Some(true) && format.shrink_to_fit == Some(true) {
        format.shrink_to_fit = Some(false);
    }
}

// =============================================================================
// Internal Helpers
// =============================================================================

/// Get a per-sheet sub-map by key (read-only).
fn get_sheet_submap<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
    key: &str,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let sheet_map = match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, key) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Resolve a compact JSON string property entry (`{"s": N, ...}`) into full
/// `CellProperties` by looking up the style palette index in the
/// workbook-level `stylePalette` map.
///
/// The compact JSON is produced by `hydration::styles::hydrate_cell_styles`
/// during XLSX import. It deserializes directly into `CellProperties` via
/// the typed `style_id` / `cm` / `vm` / `formula_result_type` /
/// `original_sst_index` / `original_value` fields (serde renames keep the
/// wire shape at `{"s", "cm", "vm", "formulaResultType", "sstIndex",
/// "originalValue"}`). The style palette stores pre-serialized `CellFormat`
/// JSON per index; we look it up here and hydrate `format`.
///
/// NOTE: `style_id` is intentionally preserved on the returned struct —
/// the export path reads it to recover the original cellXfs index for
/// lossless round-trip, even though we also use it above for palette lookup.
///
/// Public variant of `resolve_compact_props` for use by the combined
/// batch-read function in the export path (which shares a single Yrs
/// transaction across properties and raw formula reads).
pub(crate) fn resolve_compact_props_with_txn<T: yrs::ReadTxn>(
    json_str: &str,
    workbook: &MapRef,
    txn: &T,
) -> Option<CellProperties> {
    resolve_compact_props(json_str, workbook, txn)
}

fn resolve_compact_props<T: yrs::ReadTxn>(
    json_str: &str,
    workbook: &MapRef,
    txn: &T,
) -> Option<CellProperties> {
    // Typed-field deserialize: the compact JSON's keys (s, cm, vm,
    // formulaResultType, sstIndex, originalValue) line up with the
    // serde renames on CellProperties, so this replaces the former
    // free-form HashMap<String, Value> bag.
    let mut props: CellProperties = serde_json::from_str(json_str).ok()?;

    // Look up the style palette index → CellFormat (inflates the compact
    // `{"s": N}` reference into the full format).
    if let Some(idx) = props.style_id {
        let palette_map = match workbook.get(txn, super::KEY_STYLE_PALETTE) {
            Some(Out::YMap(m)) => Some(m),
            _ => None,
        };
        if let Some(palette_map) = palette_map {
            let key = idx.to_string();
            if let Some(Out::Any(Any::String(ref fmt_json))) = palette_map.get(txn, &key) {
                props.format = serde_json::from_str::<CellFormat>(fmt_json).ok();
            }
        }
    }

    // Return None only if there is truly nothing
    if props.format.is_none() && props.metadata_is_empty() {
        return None;
    }

    Some(props)
}

// =============================================================================
// YrsStorage Properties Operations
// =============================================================================

// -------------------------------------------------------------------
// Cell Properties CRUD
// -------------------------------------------------------------------

/// Get all properties for a cell by cell_id.
///
/// Returns `None` if the sheet or properties map doesn't exist, or
/// if no properties have been stored for the given cell.
///
/// Handles two storage formats:
/// - **Structured Y.Map**: full format fields written inline (user edits).
/// - **Compact JSON string**: `{"s": N, ...}` written during XLSX hydration.
///   The `"s"` key is a palette index resolved via the workbook-level
///   `stylePalette` map into a full `CellFormat`.
pub fn get_properties(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<CellProperties> {
    let txn = doc.transact();
    let props_map = get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES)?;
    match props_map.get(&txn, cell_id) {
        Some(Out::YMap(nested)) => props_schema::from_yrs_map(&nested, &txn).map(Into::into),
        Some(Out::Any(Any::String(ref json_str))) => {
            resolve_compact_props(json_str, workbook, &txn)
        }
        _ => None,
    }
}

/// Batch-read ALL cell properties for a sheet in a single transaction.
///
/// Returns a HashMap mapping `CellId` → `CellProperties`.
/// Much faster than calling `get_properties` per cell when exporting
/// large sheets, as it avoids per-cell transaction + map navigation overhead.
///
/// Uses numeric `CellId` keys (parsed from hex) to avoid 3.1M+ String
/// allocations that the old `HashMap<String, _>` approach required.
pub fn get_all_properties(
    doc: &yrs::Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> std::collections::HashMap<CellId, CellProperties> {
    let txn = doc.transact();
    let props_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        Some(m) => m,
        None => return std::collections::HashMap::new(),
    };

    let mut result = std::collections::HashMap::new();
    for (key, value) in props_map.iter(&txn) {
        let cell_id = match parse_cell_id(key) {
            Some(id) => id,
            None => continue,
        };
        let props_opt = match value {
            Out::YMap(nested) => props_schema::from_yrs_map(&nested, &txn).map(Into::into),
            Out::Any(Any::String(ref json_str)) => resolve_compact_props(json_str, workbook, &txn),
            _ => None,
        };
        if let Some(props) = props_opt {
            result.insert(cell_id, props);
        }
    }
    result
}

/// Set (replace) all properties for a cell.
///
/// The full `CellProperties` value is serialized to JSON and stored in
/// the per-sheet `properties` map keyed by `cell_id`.
pub fn set_properties(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
    props: &CellProperties,
) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(props_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        // Remove old entry (may be legacy JSON string or prior Y.Map)
        props_map.remove(&mut txn, cell_id);
        let mut props = props.clone();
        if let Some(format) = props.format.as_ref() {
            props.format = Some(normalize_format_patch(format));
        }
        let dt_props: domain_types::CellProperties = props.into();
        let entries = props_schema::to_yrs_prelim(&dt_props);
        let nested: MapPrelim = entries.into_iter().collect();
        props_map.insert(&mut txn, cell_id, nested);
    }
}

/// Remove all properties for a cell.
pub fn clear_properties(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId, cell_id: &str) {
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(props_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        props_map.remove(&mut txn, cell_id);
    }
}

/// Iterate all cell IDs that have stored properties for a sheet.
///
/// Returns `(cell_id_hex, CellProperties)` pairs. Used by the export path
/// to discover empty cells that have formatting but no value (ghost cells
/// excluded from the mirror but needed for lossless XLSX round-trip).
pub fn iter_all_properties(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<(String, CellProperties)> {
    let txn = doc.transact();
    let props_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        Some(m) => m,
        None => return vec![],
    };
    let mut result = Vec::new();
    for (key, value) in props_map.iter(&txn) {
        let props_opt = match value {
            Out::YMap(nested) => props_schema::from_yrs_map(&nested, &txn).map(Into::into),
            Out::Any(Any::String(ref json_str)) => resolve_compact_props(json_str, workbook, &txn),
            _ => None,
        };
        if let Some(props) = props_opt {
            result.push((key.to_string(), props));
        }
    }
    result
}

/// Iterate cell IDs that carry cell-level formatting without inflating compact
/// style-palette entries. Used by data-bounds queries, which only need to know
/// whether formatting exists at a cell, not the full `CellFormat` payload.
pub fn iter_formatted_property_cell_ids(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
) -> Vec<String> {
    let txn = doc.transact();
    let props_map = match get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (key, value) in props_map.iter(&txn) {
        let has_format = match value {
            Out::YMap(nested) => props_schema::from_yrs_map(&nested, &txn)
                .map(|props| props.format.is_some())
                .unwrap_or(false),
            Out::Any(Any::String(ref json_str)) => serde_json::from_str::<CellProperties>(json_str)
                .map(|props| props.style_id.is_some() || props.format.is_some())
                .unwrap_or(false),
            _ => false,
        };
        if has_format {
            result.push(key.to_string());
        }
    }
    result
}

// -------------------------------------------------------------------
// Cell Format
// -------------------------------------------------------------------

/// Get the format portion of a cell's properties.
pub fn get_cell_format(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<CellFormat> {
    get_properties(doc, workbook, sheets, sheet_id, cell_id)?.format
}

/// Set (merge) format into a cell's properties.
///
/// If the cell already has properties, the format is merged at the
/// property level (higher-priority fields from `format` override).
/// Non-format metadata fields are preserved.
///
/// Cells stored in compact palette-index format are expanded to full-JSON
/// on write (the `"s"` key is removed and full `CellFormat` is inlined).
pub fn set_cell_format(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
) {
    let mut props = get_properties(doc, workbook, sheets, sheet_id, cell_id).unwrap_or_default();
    let merged = match &props.format {
        Some(existing) => merge_formats(existing, format),
        None => normalize_format_patch(format),
    };
    props.format = Some(merged);
    // Drop the compact palette index — we're now storing the full format.
    props.style_id = None;
    set_properties(doc, sheets, sheet_id, cell_id, &props);
}

/// Clear the format from a cell's properties, preserving other metadata.
///
/// If the cell has no other metadata after removing the format, the
/// entire properties entry is deleted.
pub fn clear_cell_format(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) {
    if let Some(mut props) = get_properties(doc, workbook, sheets, sheet_id, cell_id) {
        props.format = None;
        // Drop the compact palette index since we're clearing the format.
        props.style_id = None;
        if props.metadata_is_empty() {
            // No other properties -- remove the entry entirely.
            clear_properties(doc, sheets, sheet_id, cell_id);
        } else {
            set_properties(doc, sheets, sheet_id, cell_id, &props);
        }
    }
}

// -------------------------------------------------------------------
// Batch Format Operations
// -------------------------------------------------------------------

/// Set format on multiple cells in a single Yrs transaction.
pub fn set_cell_formats(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    format: &CellFormat,
) {
    let existing: Vec<CellProperties> = cell_ids
        .iter()
        .map(|cid| get_properties(doc, workbook, sheets, sheet_id, cid).unwrap_or_default())
        .collect();

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(props_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        for (i, cid) in cell_ids.iter().enumerate() {
            let mut props = existing[i].clone();
            let merged = match &props.format {
                Some(ex) => merge_formats(ex, format),
                None => normalize_format_patch(format),
            };
            props.format = Some(merged);
            // Drop the compact palette index — we're writing the full format.
            props.style_id = None;
            props_map.remove(&mut txn, cid);
            let dt_props: domain_types::CellProperties = props.into();
            let entries = props_schema::to_yrs_prelim(&dt_props);
            let nested: MapPrelim = entries.into_iter().collect();
            props_map.insert(&mut txn, *cid, nested);
        }
    }
}

/// Clear format on multiple cells in a single Yrs transaction.
pub fn clear_cell_formats(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_ids: &[&str],
) {
    let existing: Vec<Option<CellProperties>> = cell_ids
        .iter()
        .map(|cid| get_properties(doc, workbook, sheets, sheet_id, cid))
        .collect();

    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(props_map) = get_sheet_submap(&txn, sheets, sheet_id, KEY_CELL_PROPERTIES) {
        for (i, cid) in cell_ids.iter().enumerate() {
            if let Some(mut props) = existing[i].clone() {
                props.format = None;
                // Drop the compact palette index since we're clearing the format.
                props.style_id = None;
                if props.metadata_is_empty() {
                    props_map.remove(&mut txn, cid);
                } else {
                    props_map.remove(&mut txn, cid);
                    let dt_props: domain_types::CellProperties = props.into();
                    let entries = props_schema::to_yrs_prelim(&dt_props);
                    let nested: MapPrelim = entries.into_iter().collect();
                    props_map.insert(&mut txn, *cid, nested);
                }
            }
        }
    }
}

// -------------------------------------------------------------------
// Row Format (keyed by RowId via row_col_identity)
// -------------------------------------------------------------------

/// Get format for a row.
///
/// Uses read-only `get_row_id_at` so virtual (unmaterialized) rows
/// return `None` without side-effects.
pub fn get_row_format(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Option<CellFormat> {
    let row_id = id_to_hex(grid_index?.row_id(row)?.as_u128());
    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();
    let fmt_map = get_sheet_submap(&txn, &sheets, sheet_id, KEY_ROW_FORMATS)?;
    match fmt_map.get(&txn, &row_id) {
        Some(Out::YMap(nested)) => yrs_schema::cell_format::from_yrs_map(&nested, &txn),
        _ => None,
    }
}

/// Set format for a row, materializing the row if needed.
///
/// Merges with any existing row format on a per-property basis.
pub fn set_row_format(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    row: u32,
    format: &CellFormat,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let row_id = grid_index
        .and_then(|gi| gi.row_id(row))
        .map(|rid| id_to_hex(rid.as_u128()))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;

    let existing: Option<CellFormat> = {
        let sheets = storage.sheets_ref();
        let txn = storage.doc().transact();
        get_sheet_submap(&txn, &sheets, sheet_id, KEY_ROW_FORMATS).and_then(|m| {
            match m.get(&txn, &row_id) {
                Some(Out::YMap(nested)) => yrs_schema::cell_format::from_yrs_map(&nested, &txn),
                _ => None,
            }
        })
    };

    let merged = match &existing {
        Some(ex) => merge_formats(ex, format),
        None => normalize_format_patch(format),
    };

    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(fmt_map) = get_sheet_submap(&txn, &sheets, sheet_id, KEY_ROW_FORMATS) {
        // Remove old entry (may be legacy JSON string or prior Y.Map) then insert structured.
        fmt_map.remove(&mut txn, &row_id);
        let entries = yrs_schema::cell_format::to_yrs_prelim(&merged);
        let nested: MapPrelim = entries.into_iter().collect();
        fmt_map.insert(&mut txn, &*row_id, nested);
    }
    Ok(())
}

/// Clear the format for a row.
///
/// Uses read-only `get_row_id_at` -- if the row is virtual (no RowId),
/// this is a no-op.
pub fn clear_row_format(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) {
    let row_id = match grid_index.and_then(|gi| gi.row_id(row)) {
        Some(rid) => id_to_hex(rid.as_u128()),
        None => return,
    };
    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(fmt_map) = get_sheet_submap(&txn, &sheets, sheet_id, KEY_ROW_FORMATS) {
        fmt_map.remove(&mut txn, &row_id);
    }
}

// -------------------------------------------------------------------
// Column Format (keyed by ColId via row_col_identity)
// -------------------------------------------------------------------

/// Get format for a column.
///
/// Uses read-only `get_col_id_at` so virtual (unmaterialized) columns
/// return `None` without side-effects.
pub fn get_col_format(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> Option<CellFormat> {
    let col_id = id_to_hex(grid_index?.col_id(col)?.as_u128());
    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();
    let fmt_map = get_sheet_submap(&txn, &sheets, sheet_id, KEY_COL_FORMATS)?;
    match fmt_map.get(&txn, &col_id) {
        Some(Out::YMap(nested)) => yrs_schema::cell_format::from_yrs_map(&nested, &txn),
        _ => None,
    }
}

/// Get the stored original XLSX cellXfs index for a column format.
///
/// Returns `None` if the column has no format or no stored xlsxStyleId.
pub fn get_col_xlsx_style_id(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) -> Option<u32> {
    let col_id = id_to_hex(grid_index?.col_id(col)?.as_u128());
    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();
    let fmt_map = get_sheet_submap(&txn, &sheets, sheet_id, KEY_COL_FORMATS)?;
    match fmt_map.get(&txn, &col_id) {
        Some(Out::YMap(nested)) => {
            use domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID;
            match nested.get(&txn, KEY_XLSX_STYLE_ID) {
                Some(Out::Any(Any::Number(n))) => Some(n as u32),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Get the stored original XLSX cellXfs index for a row format.
///
/// Returns `None` if the row has no format or no stored xlsxStyleId.
pub fn get_row_xlsx_style_id(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    row: u32,
    grid_index: Option<&GridIndex>,
) -> Option<u32> {
    let row_id = id_to_hex(grid_index?.row_id(row)?.as_u128());
    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();
    let fmt_map = get_sheet_submap(&txn, &sheets, sheet_id, KEY_ROW_FORMATS)?;
    match fmt_map.get(&txn, &row_id) {
        Some(Out::YMap(nested)) => {
            use domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID;
            match nested.get(&txn, KEY_XLSX_STYLE_ID) {
                Some(Out::Any(Any::Number(n))) => Some(n as u32),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Set format for a column, materializing the column if needed.
///
/// Merges with any existing column format on a per-property basis.
pub fn set_col_format(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    col: u32,
    format: &CellFormat,
    grid_index: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let col_id = grid_index
        .and_then(|gi| gi.col_id(col))
        .map(|cid| id_to_hex(cid.as_u128()))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;

    let existing: Option<CellFormat> = {
        let sheets = storage.sheets_ref();
        let txn = storage.doc().transact();
        get_sheet_submap(&txn, &sheets, sheet_id, KEY_COL_FORMATS).and_then(|m| {
            match m.get(&txn, &col_id) {
                Some(Out::YMap(nested)) => yrs_schema::cell_format::from_yrs_map(&nested, &txn),
                _ => None,
            }
        })
    };

    let merged = match &existing {
        Some(ex) => merge_formats(ex, format),
        None => normalize_format_patch(format),
    };

    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(fmt_map) = get_sheet_submap(&txn, &sheets, sheet_id, KEY_COL_FORMATS) {
        // Remove old entry (may be legacy JSON string or prior Y.Map) then insert structured.
        fmt_map.remove(&mut txn, &col_id);
        let entries = yrs_schema::cell_format::to_yrs_prelim(&merged);
        let nested: MapPrelim = entries.into_iter().collect();
        fmt_map.insert(&mut txn, &*col_id, nested);
    }
    Ok(())
}

/// Clear the format for a column.
///
/// Uses read-only `get_col_id_at` -- if the column is virtual (no ColId),
/// this is a no-op.
pub fn clear_col_format(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    col: u32,
    grid_index: Option<&GridIndex>,
) {
    let col_id = match grid_index.and_then(|gi| gi.col_id(col)) {
        Some(cid) => id_to_hex(cid.as_u128()),
        None => return,
    };
    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(fmt_map) = get_sheet_submap(&txn, &sheets, sheet_id, KEY_COL_FORMATS) {
        fmt_map.remove(&mut txn, &col_id);
    }
}

// -------------------------------------------------------------------
// Batch Row/Col Format Reads (export path)
// -------------------------------------------------------------------

/// Row format entry returned by batch read — includes the CellFormat and
/// the optional original XLSX cellXfs style index for lossless round-trip.
pub struct RowFormatEntry {
    pub row: u32,
    pub format: Option<CellFormat>,
    pub xlsx_style_id: Option<u32>,
}

/// Column format entry returned by batch read.
pub struct ColFormatEntry {
    pub col: u32,
    pub format: Option<CellFormat>,
    pub xlsx_style_id: Option<u32>,
}

/// Batch-read ALL row formats for a sheet in a single Yrs transaction.
///
/// Instead of calling `get_row_format()` per row (each creating a new
/// transaction), this iterates the `rowFormats` Yrs map once and resolves
/// hex keys back to row indices via the GridIndex. Returns entries only
/// for rows that actually have stored formats.
pub fn get_all_row_formats(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<RowFormatEntry> {
    let grid = match grid_index {
        Some(g) => g,
        None => return vec![],
    };
    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();
    let fmt_map = match get_sheet_submap(&txn, &sheets, sheet_id, KEY_ROW_FORMATS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (hex_key, value) in fmt_map.iter(&txn) {
        // Parse hex key → RowId → row index
        let raw_id = match compute_document::hex::hex_to_id(hex_key) {
            Some(id) => id,
            None => continue,
        };
        let row_id = cell_types::RowId::from_raw(raw_id);
        let row = match grid.row_index(&row_id) {
            Some(r) => r,
            None => continue,
        };

        let (format, xlsx_style_id) = match value {
            Out::YMap(nested) => {
                let fmt = yrs_schema::cell_format::from_yrs_map(&nested, &txn);
                let xi = {
                    use domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID;
                    match nested.get(&txn, KEY_XLSX_STYLE_ID) {
                        Some(Out::Any(Any::Number(n))) => Some(n as u32),
                        _ => None,
                    }
                };
                (fmt, xi)
            }
            _ => continue,
        };

        result.push(RowFormatEntry {
            row,
            format,
            xlsx_style_id,
        });
    }
    result
}

/// Batch-read ALL column formats for a sheet in a single Yrs transaction.
///
/// Same pattern as `get_all_row_formats` but for the `colFormats` map.
pub fn get_all_col_formats(
    storage: &YrsStorage,
    sheet_id: &SheetId,
    grid_index: Option<&GridIndex>,
) -> Vec<ColFormatEntry> {
    let grid = match grid_index {
        Some(g) => g,
        None => return vec![],
    };
    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();
    let fmt_map = match get_sheet_submap(&txn, &sheets, sheet_id, KEY_COL_FORMATS) {
        Some(m) => m,
        None => return vec![],
    };

    let mut result = Vec::new();
    for (hex_key, value) in fmt_map.iter(&txn) {
        let raw_id = match compute_document::hex::hex_to_id(hex_key) {
            Some(id) => id,
            None => continue,
        };
        let col_id = cell_types::ColId::from_raw(raw_id);
        let col = match grid.col_index(&col_id) {
            Some(c) => c,
            None => continue,
        };

        let (format, xlsx_style_id) = match value {
            Out::YMap(nested) => {
                let fmt = yrs_schema::cell_format::from_yrs_map(&nested, &txn);
                let xi = {
                    use domain_types::yrs_schema::cell_format::KEY_XLSX_STYLE_ID;
                    match nested.get(&txn, KEY_XLSX_STYLE_ID) {
                        Some(Out::Any(Any::Number(n))) => Some(n as u32),
                        _ => None,
                    }
                };
                (fmt, xi)
            }
            _ => continue,
        };

        result.push(ColFormatEntry {
            col,
            format,
            xlsx_style_id,
        });
    }
    result
}

// -------------------------------------------------------------------
// Format Inheritance
// -------------------------------------------------------------------

/// Get the effective (computed) format for a cell.
///
/// Merges from lowest to highest priority:
/// `default -> column -> row -> Format Range -> table -> cell`
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
    let base = default_format();

    let col_fmt = get_col_format(storage, sheet_id, col, grid_index).unwrap_or_default();
    let after_col = merge_formats(&base, &col_fmt);

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
    let base = default_format();

    let col_fmt = get_col_format(storage, sheet_id, col, grid_index).unwrap_or_default();
    let after_col = merge_formats(&base, &col_fmt);

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

/// Positional format for cells with no cell_id: default → column → row → Format Range.
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
    let base = default_format();

    let col_fmt = get_col_format(storage, sheet_id, col, grid_index).unwrap_or_default();
    let after_col = merge_formats(&base, &col_fmt);

    let row_fmt = get_row_format(storage, sheet_id, row, grid_index).unwrap_or_default();
    let after_row = merge_formats(&after_col, &row_fmt);

    // Format Range layer: between row and table (no table/cell layer in positional format).
    apply_format_range_layer(&after_row, row, col, sheet_mirror)
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
fn apply_format_range_layer(
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

// -------------------------------------------------------------------
// Format Range CRUD
// -------------------------------------------------------------------

/// Add or update a Format Range in the mirror and Yrs storage.
///
/// Creates a `rangeFormats[range_id]` entry in Yrs with the serialized
/// `CellFormat` and registers the range in the mirror's spatial index +
/// format cache.
pub fn add_format_range(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    mirror: &mut SheetMirror,
    range_id: crate::mirror::RangeId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    format: &CellFormat,
) {
    use compute_document::schema::KEY_RANGE_FORMATS;

    let format = normalize_format_patch(format);

    // Write to Yrs
    let range_hex = id_to_hex(range_id.as_u128());
    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id) {
        // Ensure rangeFormats sub-map exists
        let rf_map = match sheet_map.get(&txn, KEY_RANGE_FORMATS) {
            Some(Out::YMap(m)) => m,
            _ => {
                let empty = MapPrelim::from([] as [(&str, Any); 0]);
                sheet_map.insert(&mut txn, KEY_RANGE_FORMATS, empty)
            }
        };

        // Store format as a structured Y.Map (same encoding as rowFormats/colFormats)
        // plus bounds metadata.
        rf_map.remove(&mut txn, &range_hex);
        let mut entries = yrs_schema::cell_format::to_yrs_prelim(&format);
        entries.push(("_sr", Any::Number(start_row as f64)));
        entries.push(("_sc", Any::Number(start_col as f64)));
        entries.push(("_er", Any::Number(end_row as f64)));
        entries.push(("_ec", Any::Number(end_col as f64)));
        let nested: MapPrelim = entries.into_iter().collect();
        rf_map.insert(&mut txn, &*range_hex, nested);
    }
    drop(txn);

    // Update mirror
    // Remove existing entry if present (for update case)
    mirror.format_ranges.retain(|r| r.id != range_id);
    mirror.format_ranges.push(crate::mirror::FormatRange {
        id: range_id,
        start_row,
        start_col,
        end_row,
        end_col,
    });
    mirror.range_format_cache.insert(range_id, format);
}

/// Remove a Format Range from both mirror and Yrs storage.
pub fn remove_format_range(
    storage: &mut YrsStorage,
    sheet_id: &SheetId,
    mirror: &mut SheetMirror,
    range_id: crate::mirror::RangeId,
) {
    use compute_document::schema::KEY_RANGE_FORMATS;

    // Remove from Yrs
    let range_hex = id_to_hex(range_id.as_u128());
    let sheets = storage.sheets_ref();
    let mut txn = storage
        .doc()
        .transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    if let Some(sheet_map) = get_sheet_map(&txn, &sheets, sheet_id)
        && let Some(Out::YMap(rf_map)) = sheet_map.get(&txn, KEY_RANGE_FORMATS)
    {
        rf_map.remove(&mut txn, &range_hex);
    }
    drop(txn);

    // Remove from mirror
    mirror.format_ranges.retain(|r| r.id != range_id);
    mirror.range_format_cache.remove(&range_id);
}

/// Get a per-sheet map by SheetId (read-only, returns the sheet's top-level map).
fn get_sheet_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_id: &SheetId,
) -> Option<MapRef> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    match sheets_root.get(txn, &sheet_hex) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Hydrate Format Ranges from the `rangeFormats` Yrs sub-map into a SheetMirror.
///
/// Called during document load after the Yrs document is populated.
/// Each entry in `rangeFormats[range_id_hex]` is a Y.Map containing:
/// - CellFormat fields (same encoding as rowFormats/colFormats)
/// - Bounds metadata: `_sr` (start_row), `_sc` (start_col), `_er` (end_row), `_ec` (end_col)
pub fn hydrate_format_ranges(storage: &YrsStorage, sheet_id: &SheetId, mirror: &mut SheetMirror) {
    use compute_document::schema::KEY_RANGE_FORMATS;

    let sheets = storage.sheets_ref();
    let txn = storage.doc().transact();

    let sheet_map = match get_sheet_map(&txn, &sheets, sheet_id) {
        Some(m) => m,
        None => return,
    };

    let rf_map = match sheet_map.get(&txn, KEY_RANGE_FORMATS) {
        Some(Out::YMap(m)) => m,
        _ => return,
    };

    for (hex_key, value) in rf_map.iter(&txn) {
        let raw_id = match compute_document::hex::hex_to_id(hex_key) {
            Some(id) => id,
            None => continue,
        };
        let range_id = crate::mirror::RangeId::from_raw(raw_id);

        if let Out::YMap(nested) = value {
            // Read bounds
            let start_row = match nested.get(&txn, "_sr") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let start_col = match nested.get(&txn, "_sc") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let end_row = match nested.get(&txn, "_er") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };
            let end_col = match nested.get(&txn, "_ec") {
                Some(Out::Any(Any::Number(n))) => n as u32,
                _ => continue,
            };

            // Read CellFormat (ignoring the bounds keys). Imported authored
            // style-only runs on the lossless stylesheet path may only carry
            // the original XLSX style id (`xi`) plus bounds; keep those as
            // default-format ranges so export can stream the original `<c s>`
            // coverage back without densifying cells.
            let has_imported_style_id = nested
                .get(&txn, yrs_schema::cell_format::KEY_XLSX_STYLE_ID)
                .is_some();
            if let Some(fmt) = yrs_schema::cell_format::from_yrs_map(&nested, &txn)
                .or_else(|| has_imported_style_id.then(CellFormat::default))
            {
                mirror.format_ranges.push(crate::mirror::FormatRange {
                    id: range_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                });
                mirror.range_format_cache.insert(range_id, fmt);
            }
        }
    }
}

// -------------------------------------------------------------------
// Protection Helpers
// -------------------------------------------------------------------

/// Check if a cell is locked (for protection purposes).
///
/// Defaults to `true` per Excel convention -- all cells are locked
/// unless explicitly set to `false`.
pub fn is_cell_locked(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> bool {
    get_cell_format(doc, workbook, sheets, sheet_id, cell_id)
        .and_then(|f| f.locked)
        .unwrap_or(true)
}

/// Check if a cell's formula should be hidden in the formula bar.
///
/// Defaults to `false` -- formulas are visible unless explicitly hidden.
pub fn is_formula_hidden(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) -> bool {
    get_cell_format(doc, workbook, sheets, sheet_id, cell_id)
        .and_then(|f| f.hidden)
        .unwrap_or(false)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::YrsStorage;
    use cell_types::SheetId;
    use std::collections::HashMap;

    // -------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    /// Create a storage with a single sheet and return (storage, sheet_id).
    fn storage_with_sheet() -> (YrsStorage, SheetId, GridIndex) {
        let mut storage = YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sid = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
            .unwrap();
        let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
        let gi = GridIndex::new(sid, 100, 26, id_alloc);
        (storage, sid, gi)
    }

    #[test]
    fn test_merge_formats_merges_partial_borders_per_edge_and_side_field() {
        use ooxml_types::styles::BorderStyle;

        let lower = CellFormat {
            borders: Some(CellBorders {
                top: Some(CellBorderSide {
                    style: Some(BorderStyle::Thin),
                    color: Some("#111111".to_string()),
                    ..Default::default()
                }),
                right: Some(CellBorderSide {
                    style: Some(BorderStyle::Medium),
                    color: Some("#222222".to_string()),
                    ..Default::default()
                }),
                diagonal_up: Some(true),
                outline: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        let higher = CellFormat {
            borders: Some(CellBorders {
                top: Some(CellBorderSide {
                    color: Some("#333333".to_string()),
                    ..Default::default()
                }),
                bottom: Some(CellBorderSide {
                    style: Some(BorderStyle::Dashed),
                    color: Some("#444444".to_string()),
                    ..Default::default()
                }),
                diagonal_up: Some(false),
                ..Default::default()
            }),
            ..Default::default()
        };

        let merged = merge_formats(&lower, &higher);
        let borders = merged.borders.expect("merged borders");

        let top = borders.top.expect("top border preserved");
        assert_eq!(top.style, Some(BorderStyle::Thin));
        assert_eq!(top.color, Some("#333333".to_string()));

        let right = borders.right.expect("right border preserved");
        assert_eq!(right.style, Some(BorderStyle::Medium));
        assert_eq!(right.color, Some("#222222".to_string()));

        let bottom = borders.bottom.expect("bottom border applied");
        assert_eq!(bottom.style, Some(BorderStyle::Dashed));
        assert_eq!(bottom.color, Some("#444444".to_string()));

        assert_eq!(borders.diagonal_up, Some(false));
        assert_eq!(borders.outline, Some(true));
    }

    #[test]
    fn test_merge_formats_empty_borders_patch_clears_all_borders() {
        use ooxml_types::styles::BorderStyle;

        let lower = CellFormat {
            borders: Some(CellBorders {
                top: Some(CellBorderSide {
                    style: Some(BorderStyle::Thin),
                    color: Some("#111111".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        let higher = CellFormat {
            borders: Some(CellBorders::default()),
            ..Default::default()
        };

        let merged = merge_formats(&lower, &higher);
        assert_eq!(merged.borders, Some(CellBorders::default()));
    }

    #[test]
    fn test_merge_formats_preserves_extended_sparse_fields() {
        let lower = CellFormat {
            font_color_tint: Some(0.25),
            auto_indent: Some(true),
            background_color_tint: Some(-0.4),
            pattern_foreground_color_tint: Some(0.5),
            ..Default::default()
        };
        let higher = CellFormat {
            auto_indent: Some(false),
            ..Default::default()
        };

        let merged = merge_formats(&lower, &higher);
        assert_eq!(merged.font_color_tint, Some(0.25));
        assert_eq!(merged.auto_indent, Some(false));
        assert_eq!(merged.background_color_tint, Some(-0.4));
        assert_eq!(merged.pattern_foreground_color_tint, Some(0.5));
    }

    // -------------------------------------------------------------------
    // Test 1: Set + get properties
    // -------------------------------------------------------------------

    #[test]
    fn test_set_and_get_properties() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let props = CellProperties {
            format: Some(CellFormat {
                bold: Some(true),
                ..Default::default()
            }),
            provenance: Some("ai".to_string()),
            ..Default::default()
        };
        set_properties(doc, sheets, &sid, "cell-a", &props);

        let got = get_properties(doc, workbook, sheets, &sid, "cell-a").unwrap();
        assert_eq!(got.format.as_ref().unwrap().bold, Some(true));
        assert_eq!(got.provenance, Some("ai".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 2: Clear properties
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_properties() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let props = CellProperties {
            provenance: Some("user".to_string()),
            ..Default::default()
        };
        set_properties(doc, sheets, &sid, "cell-b", &props);
        assert!(get_properties(doc, workbook, sheets, &sid, "cell-b").is_some());

        clear_properties(doc, sheets, &sid, "cell-b");
        assert!(get_properties(doc, workbook, sheets, &sid, "cell-b").is_none());
    }

    // -------------------------------------------------------------------
    // Test 3: Set + get cell format
    // -------------------------------------------------------------------

    #[test]
    fn test_set_and_get_cell_format() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let fmt = CellFormat {
            font_size: Some(domain_types::FontSize::from_millipoints(14000)),
            bold: Some(true),
            ..Default::default()
        };
        set_cell_format(doc, workbook, sheets, &sid, "cell-c", &fmt);

        let got = get_cell_format(doc, workbook, sheets, &sid, "cell-c").unwrap();
        assert_eq!(
            got.font_size,
            Some(domain_types::FontSize::from_millipoints(14000))
        );
        assert_eq!(got.bold, Some(true));
    }

    // -------------------------------------------------------------------
    // Test 4: Clear cell format preserves other properties
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_cell_format_preserves_metadata() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let props = CellProperties {
            format: Some(CellFormat {
                italic: Some(true),
                ..Default::default()
            }),
            provenance: Some("import".to_string()),
            ..Default::default()
        };
        set_properties(doc, sheets, &sid, "cell-d", &props);

        clear_cell_format(doc, workbook, sheets, &sid, "cell-d");

        let got = get_properties(doc, workbook, sheets, &sid, "cell-d").unwrap();
        assert!(got.format.is_none());
        assert_eq!(got.provenance, Some("import".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 5: Clear cell format deletes entry when no metadata
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_cell_format_deletes_when_empty() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let props = CellProperties {
            format: Some(CellFormat {
                bold: Some(true),
                ..Default::default()
            }),
            ..Default::default()
        };
        set_properties(doc, sheets, &sid, "cell-e", &props);

        clear_cell_format(doc, workbook, sheets, &sid, "cell-e");
        assert!(get_properties(doc, workbook, sheets, &sid, "cell-e").is_none());
    }

    // -------------------------------------------------------------------
    // Test 6: Batch set formats
    // -------------------------------------------------------------------

    #[test]
    fn test_batch_set_formats() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let fmt = CellFormat {
            font_color: Some("#FF0000".to_string()),
            ..Default::default()
        };
        set_cell_formats(doc, workbook, sheets, &sid, &["c1", "c2", "c3"], &fmt);

        for cid in &["c1", "c2", "c3"] {
            let got = get_cell_format(doc, workbook, sheets, &sid, cid).unwrap();
            assert_eq!(got.font_color, Some("#FF0000".to_string()));
        }
    }

    // -------------------------------------------------------------------
    // Test 7: Batch clear formats
    // -------------------------------------------------------------------

    #[test]
    fn test_batch_clear_formats() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        let fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        set_cell_formats(doc, workbook, sheets, &sid, &["c1", "c2"], &fmt);

        clear_cell_formats(doc, workbook, sheets, &sid, &["c1", "c2"]);

        assert!(get_cell_format(doc, workbook, sheets, &sid, "c1").is_none());
        assert!(get_cell_format(doc, workbook, sheets, &sid, "c2").is_none());
    }

    // -------------------------------------------------------------------
    // Test 8: Set + get row format (materializes row)
    // -------------------------------------------------------------------

    #[test]
    fn test_set_and_get_row_format() {
        let (mut storage, sid, gi) = storage_with_sheet();

        let fmt = CellFormat {
            background_color: Some("#00FF00".to_string()),
            ..Default::default()
        };
        set_row_format(&mut storage, &sid, 5, &fmt, Some(&gi)).unwrap();

        let got = get_row_format(&storage, &sid, 5, Some(&gi)).unwrap();
        assert_eq!(got.background_color, Some("#00FF00".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 9: Get row format on unmaterialized row returns None
    // -------------------------------------------------------------------

    #[test]
    fn test_get_row_format_unmaterialized() {
        let (storage, sid, gi) = storage_with_sheet();
        assert!(get_row_format(&storage, &sid, 99, Some(&gi)).is_none());
    }

    // -------------------------------------------------------------------
    // Test 10: Clear row format
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_row_format() {
        let (mut storage, sid, gi) = storage_with_sheet();

        let fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };
        set_row_format(&mut storage, &sid, 3, &fmt, Some(&gi)).unwrap();
        assert!(get_row_format(&storage, &sid, 3, Some(&gi)).is_some());

        clear_row_format(&mut storage, &sid, 3, Some(&gi));
        assert!(get_row_format(&storage, &sid, 3, Some(&gi)).is_none());
    }

    // -------------------------------------------------------------------
    // Test 11: Set + get col format (materializes column)
    // -------------------------------------------------------------------

    #[test]
    fn test_set_and_get_col_format() {
        let (mut storage, sid, gi) = storage_with_sheet();

        let fmt = CellFormat {
            number_format: Some("#,##0.00".to_string()),
            ..Default::default()
        };
        set_col_format(&mut storage, &sid, 2, &fmt, Some(&gi)).unwrap();

        let got = get_col_format(&storage, &sid, 2, Some(&gi)).unwrap();
        assert_eq!(got.number_format, Some("#,##0.00".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 12: Get col format on unmaterialized column returns None
    // -------------------------------------------------------------------

    #[test]
    fn test_get_col_format_unmaterialized() {
        let (storage, sid, gi) = storage_with_sheet();
        assert!(get_col_format(&storage, &sid, 25, Some(&gi)).is_none());
    }

    // -------------------------------------------------------------------
    // Test 13: Clear col format
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_col_format() {
        let (mut storage, sid, gi) = storage_with_sheet();

        let fmt = CellFormat {
            italic: Some(true),
            ..Default::default()
        };
        set_col_format(&mut storage, &sid, 4, &fmt, Some(&gi)).unwrap();
        assert!(get_col_format(&storage, &sid, 4, Some(&gi)).is_some());

        clear_col_format(&mut storage, &sid, 4, Some(&gi));
        assert!(get_col_format(&storage, &sid, 4, Some(&gi)).is_none());
    }

    // -------------------------------------------------------------------
    // Test 14: Effective format — cell overrides row overrides column overrides default
    // -------------------------------------------------------------------

    #[test]
    fn test_effective_format_full_inheritance() {
        let (mut storage, sid, gi) = storage_with_sheet();

        // Column 1: set number_format
        set_col_format(
            &mut storage,
            &sid,
            1,
            &CellFormat {
                number_format: Some("0.00%".to_string()),
                font_color: Some("#0000FF".to_string()),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        // Row 2: set font_color (overrides column's font_color)
        set_row_format(
            &mut storage,
            &sid,
            2,
            &CellFormat {
                font_color: Some("#FF0000".to_string()),
                bold: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        // Cell at (2, 1): set bold=false (overrides row's bold)
        set_cell_format(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &sid,
            "cell-x",
            &CellFormat {
                bold: Some(false),
                ..Default::default()
            },
        );

        let eff = get_effective_format(&storage, &sid, "cell-x", 2, 1, None, Some(&gi), None);

        // bold: cell says false -> false
        assert_eq!(eff.bold, Some(false));
        // font_color: row says #FF0000, overrides column #0000FF
        assert_eq!(eff.font_color, Some("#FF0000".to_string()));
        // number_format: from column
        assert_eq!(eff.number_format, Some("0.00%".to_string()));
        // font_family: from default
        assert_eq!(eff.font_family, Some("Calibri".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 15: Effective format — no overrides returns default
    // -------------------------------------------------------------------

    #[test]
    fn test_effective_format_no_overrides() {
        let (storage, sid, gi) = storage_with_sheet();

        let eff = get_effective_format(&storage, &sid, "no-cell", 0, 0, None, Some(&gi), None);
        let def = default_format();

        assert_eq!(eff.font_family, def.font_family);
        assert_eq!(eff.font_size, def.font_size);
        assert_eq!(eff.bold, def.bold);
        assert_eq!(eff.locked, def.locked);
    }

    // -------------------------------------------------------------------
    // Test 16: Effective format — only row format set
    // -------------------------------------------------------------------

    #[test]
    fn test_effective_format_only_row() {
        let (mut storage, sid, gi) = storage_with_sheet();

        set_row_format(
            &mut storage,
            &sid,
            7,
            &CellFormat {
                italic: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        let eff = get_effective_format(&storage, &sid, "some-cell", 7, 0, None, Some(&gi), None);
        assert_eq!(eff.italic, Some(true));
        // Other properties from default
        assert_eq!(eff.font_family, Some("Calibri".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 17: Effective format — only col format set
    // -------------------------------------------------------------------

    #[test]
    fn test_effective_format_only_col() {
        let (mut storage, sid, gi) = storage_with_sheet();

        set_col_format(
            &mut storage,
            &sid,
            3,
            &CellFormat {
                wrap_text: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        let eff = get_effective_format(&storage, &sid, "some-cell", 0, 3, None, Some(&gi), None);
        assert_eq!(eff.wrap_text, Some(true));
        assert_eq!(
            eff.font_size,
            Some(domain_types::FontSize::from_millipoints(11000))
        );
    }

    // -------------------------------------------------------------------
    // Test 18: is_cell_locked — default true
    // -------------------------------------------------------------------

    #[test]
    fn test_is_locked_default_true() {
        let (storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
        assert!(is_cell_locked(doc, workbook, sheets, &sid, "unknown-cell"));
    }

    // -------------------------------------------------------------------
    // Test 19: is_cell_locked — explicitly false
    // -------------------------------------------------------------------

    #[test]
    fn test_is_locked_explicitly_false() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        set_cell_format(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &sid,
            "unlocked-cell",
            &CellFormat {
                locked: Some(false),
                ..Default::default()
            },
        );

        assert!(!is_cell_locked(
            doc,
            workbook,
            sheets,
            &sid,
            "unlocked-cell"
        ));
    }

    // -------------------------------------------------------------------
    // Test 20: is_formula_hidden — default false
    // -------------------------------------------------------------------

    #[test]
    fn test_is_formula_hidden_default_false() {
        let (storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
        assert!(!is_formula_hidden(
            doc,
            workbook,
            sheets,
            &sid,
            "unknown-cell"
        ));
    }

    // -------------------------------------------------------------------
    // Test 21: is_formula_hidden — explicitly true
    // -------------------------------------------------------------------

    #[test]
    fn test_is_formula_hidden_explicitly_true() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        set_cell_format(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &sid,
            "hidden-cell",
            &CellFormat {
                hidden: Some(true),
                ..Default::default()
            },
        );

        assert!(is_formula_hidden(
            doc,
            workbook,
            sheets,
            &sid,
            "hidden-cell"
        ));
    }

    // -------------------------------------------------------------------
    // Test 22: Properties on nonexistent sheet
    // -------------------------------------------------------------------

    #[test]
    fn test_properties_nonexistent_sheet() {
        let storage = YrsStorage::new();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());
        let sid = make_sheet_id(999);

        assert!(get_properties(doc, workbook, sheets, &sid, "any").is_none());
        assert!(get_cell_format(doc, workbook, sheets, &sid, "any").is_none());
        assert!(get_row_format(&storage, &sid, 0, None).is_none());
        assert!(get_col_format(&storage, &sid, 0, None).is_none());
        assert!(is_cell_locked(doc, workbook, sheets, &sid, "any")); // default true
        assert!(!is_formula_hidden(doc, workbook, sheets, &sid, "any")); // default false
    }

    // -------------------------------------------------------------------
    // Test 23: set_cell_format merges with existing format
    // -------------------------------------------------------------------

    #[test]
    fn test_set_cell_format_merges() {
        let (mut storage, sid, gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        // First set: bold
        set_cell_format(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &sid,
            "merge-cell",
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        );

        // Second set: italic (should merge, not replace)
        set_cell_format(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &sid,
            "merge-cell",
            &CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        );

        let got = get_cell_format(doc, workbook, sheets, &sid, "merge-cell").unwrap();
        assert_eq!(got.bold, Some(true));
        assert_eq!(got.italic, Some(true));
    }

    #[test]
    fn test_wrap_text_and_shrink_to_fit_are_exclusive_for_cell_formats() {
        let (storage, sid, _gi) = storage_with_sheet();
        let (doc, workbook, sheets) = (storage.doc(), storage.workbook_map(), storage.sheets());

        set_cell_format(
            doc,
            workbook,
            sheets,
            &sid,
            "cell-wrap-shrink",
            &CellFormat {
                wrap_text: Some(true),
                ..Default::default()
            },
        );

        set_cell_format(
            doc,
            workbook,
            sheets,
            &sid,
            "cell-wrap-shrink",
            &CellFormat {
                shrink_to_fit: Some(true),
                ..Default::default()
            },
        );

        let got = get_cell_format(doc, workbook, sheets, &sid, "cell-wrap-shrink").unwrap();
        assert_eq!(got.wrap_text, Some(false));
        assert_eq!(got.shrink_to_fit, Some(true));

        set_cell_format(
            doc,
            workbook,
            sheets,
            &sid,
            "cell-wrap-shrink",
            &CellFormat {
                wrap_text: Some(true),
                ..Default::default()
            },
        );

        let got = get_cell_format(doc, workbook, sheets, &sid, "cell-wrap-shrink").unwrap();
        assert_eq!(got.wrap_text, Some(true));
        assert_eq!(got.shrink_to_fit, Some(false));
    }

    // -------------------------------------------------------------------
    // Test 24: set_row_format merges with existing row format
    // -------------------------------------------------------------------

    #[test]
    fn test_set_row_format_merges() {
        let (mut storage, sid, gi) = storage_with_sheet();

        set_row_format(
            &mut storage,
            &sid,
            0,
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        set_row_format(
            &mut storage,
            &sid,
            0,
            &CellFormat {
                italic: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        let got = get_row_format(&storage, &sid, 0, Some(&gi)).unwrap();
        assert_eq!(got.bold, Some(true));
        assert_eq!(got.italic, Some(true));
    }

    #[test]
    fn test_wrap_text_and_shrink_to_fit_are_exclusive_for_row_and_col_formats() {
        let (mut storage, sid, gi) = storage_with_sheet();

        set_row_format(
            &mut storage,
            &sid,
            0,
            &CellFormat {
                wrap_text: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();
        set_row_format(
            &mut storage,
            &sid,
            0,
            &CellFormat {
                shrink_to_fit: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();
        let row = get_row_format(&storage, &sid, 0, Some(&gi)).unwrap();
        assert_eq!(row.wrap_text, Some(false));
        assert_eq!(row.shrink_to_fit, Some(true));

        set_col_format(
            &mut storage,
            &sid,
            0,
            &CellFormat {
                shrink_to_fit: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();
        set_col_format(
            &mut storage,
            &sid,
            0,
            &CellFormat {
                wrap_text: Some(true),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();
        let col = get_col_format(&storage, &sid, 0, Some(&gi)).unwrap();
        assert_eq!(col.wrap_text, Some(true));
        assert_eq!(col.shrink_to_fit, Some(false));
    }

    // -------------------------------------------------------------------
    // Test 25: CellProperties serde roundtrip
    // -------------------------------------------------------------------

    #[test]
    fn test_cell_properties_serde_roundtrip() {
        let props = CellProperties {
            format: Some(CellFormat {
                bold: Some(true),
                font_size: Some(domain_types::FontSize::from_millipoints(14000)),
                ..Default::default()
            }),
            provenance: Some("ai-generated".to_string()),
            validation: None,
            connection_id: Some("conn-1".to_string()),
            ..Default::default()
        };

        let json = serde_json::to_string(&props).unwrap();
        let parsed: CellProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(props, parsed);
    }

    // -------------------------------------------------------------------
    // Test 26: CellFormat serde roundtrip with camelCase
    // -------------------------------------------------------------------

    #[test]
    fn test_cell_format_serde_camel_case() {
        let fmt = CellFormat {
            font_family: Some("Arial".to_string()),
            font_size: Some(domain_types::FontSize::from_millipoints(12000)),
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
            wrap_text: Some(true),
            ..Default::default()
        };

        let json = serde_json::to_string(&fmt).unwrap();
        // Verify camelCase in JSON
        assert!(json.contains("fontFamily"));
        assert!(json.contains("fontSize"));
        assert!(json.contains("horizontalAlign"));
        assert!(json.contains("wrapText"));
        // Should NOT contain snake_case
        assert!(!json.contains("font_family"));
        assert!(!json.contains("font_size"));

        let parsed: CellFormat = serde_json::from_str(&json).unwrap();
        assert_eq!(fmt, parsed);
    }

    // -------------------------------------------------------------------
    // Test 27: default_format has expected values
    // -------------------------------------------------------------------

    #[test]
    fn test_default_format_values() {
        let def = default_format();
        assert_eq!(def.font_family, Some("Calibri".to_string()));
        assert_eq!(
            def.font_size,
            Some(domain_types::FontSize::from_millipoints(11000))
        );
        assert_eq!(def.font_color, Some("#000000".to_string()));
        assert_eq!(def.bold, Some(false));
        assert_eq!(def.italic, Some(false));
        assert_eq!(def.locked, Some(true));
        assert_eq!(def.hidden, Some(false));
        assert!(def.number_format.is_none());
        assert!(def.background_color.is_none());
    }

    // -------------------------------------------------------------------
    // Test 28: merge_formats helper
    // -------------------------------------------------------------------

    #[test]
    fn test_merge_formats_higher_wins() {
        let lower = CellFormat {
            bold: Some(true),
            font_size: Some(domain_types::FontSize::from_millipoints(10000)),
            ..Default::default()
        };
        let higher = CellFormat {
            bold: Some(false),
            italic: Some(true),
            ..Default::default()
        };

        let merged = merge_formats(&lower, &higher);
        assert_eq!(merged.bold, Some(false)); // higher wins
        assert_eq!(
            merged.font_size,
            Some(domain_types::FontSize::from_millipoints(10000))
        ); // from lower
        assert_eq!(merged.italic, Some(true)); // from higher
    }

    // -------------------------------------------------------------------
    // Test 29: clear_row_format on virtual row is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_row_format_virtual_noop() {
        let (mut storage, sid, gi) = storage_with_sheet();
        // Should not panic
        clear_row_format(&mut storage, &sid, 99, Some(&gi));
        assert!(get_row_format(&storage, &sid, 99, Some(&gi)).is_none());
    }

    // -------------------------------------------------------------------
    // Test 30: clear_col_format on virtual column is no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_clear_col_format_virtual_noop() {
        let (mut storage, sid, gi) = storage_with_sheet();
        // Should not panic
        clear_col_format(&mut storage, &sid, 25, Some(&gi));
        assert!(get_col_format(&storage, &sid, 25, Some(&gi)).is_none());
    }

    // -------------------------------------------------------------------
    // Test 31: set_cell_formats preserves existing format from compact palette
    // Reproduces the xlsx border-wipes-format bug
    // -------------------------------------------------------------------

    #[test]
    fn test_set_cell_formats_preserves_compact_palette_format() {
        let (mut storage, sid, _gi) = storage_with_sheet();
        let doc = storage.doc();
        let workbook = storage.workbook_map().clone();
        let sheets = storage.sheets().clone();

        // 1. Simulate xlsx hydration: write a style palette entry
        let fmt = CellFormat {
            bold: Some(true),
            font_size: Some(domain_types::FontSize::from_millipoints(10000)),
            font_family: Some("Calibri".to_string()),
            number_format: Some("#,##0".to_string()),
            ..Default::default()
        };
        let fmt_json = serde_json::to_string(&fmt).unwrap();
        {
            let mut txn = doc.transact_mut();
            // Create stylePalette in workbook map
            let palette_prelim: MapPrelim = vec![(
                "5",
                yrs::Any::String(std::sync::Arc::from(fmt_json.as_str())),
            )]
            .into_iter()
            .collect();
            workbook.insert(
                &mut txn,
                compute_document::schema::KEY_STYLE_PALETTE,
                palette_prelim,
            );
        }

        // 2. Write compact JSON to cellProperties (like hydrate_cell_styles does)
        let cell_hex = "deadbeef00000000deadbeef00000000";
        {
            let mut txn = doc.transact_mut();
            let sheet_hex = id_to_hex(sid.as_u128());
            let sheet_map = match sheets.get(&txn, &sheet_hex) {
                Some(Out::YMap(m)) => m,
                _ => panic!("sheet map not found"),
            };
            let props_map = match sheet_map.get(&txn, KEY_CELL_PROPERTIES) {
                Some(Out::YMap(m)) => m,
                _ => panic!("cellProperties map not found"),
            };
            // Compact format: {"s":5}
            props_map.insert(
                &mut txn,
                cell_hex,
                yrs::Any::String(std::sync::Arc::from(r#"{"s":5}"#)),
            );
        }

        // 3. Verify get_properties reads the compact format correctly
        let existing = get_properties(doc, &workbook, &sheets, &sid, cell_hex);
        assert!(
            existing.is_some(),
            "get_properties should return Some for compact format cell"
        );
        let existing = existing.unwrap();
        assert!(
            existing.format.is_some(),
            "format should be resolved from palette"
        );
        assert_eq!(existing.format.as_ref().unwrap().bold, Some(true));
        assert_eq!(
            existing.format.as_ref().unwrap().font_family,
            Some("Calibri".to_string())
        );

        // 4. Call set_cell_formats with ONLY borders (simulating APPLY_BORDERS)
        let border_fmt = CellFormat {
            borders: Some(domain_types::CellBorders {
                top: Some(domain_types::CellBorderSide {
                    style: Some(ooxml_types::styles::BorderStyle::Thin),
                    color: Some("#000000".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            }),
            ..Default::default()
        };
        set_cell_formats(doc, &workbook, &sheets, &sid, &[cell_hex], &border_fmt);

        // 5. Read back and verify ALL format properties are preserved
        let after = get_properties(doc, &workbook, &sheets, &sid, cell_hex);
        assert!(
            after.is_some(),
            "properties should exist after set_cell_formats"
        );
        let after = after.unwrap();
        assert!(
            after.format.is_some(),
            "format should exist after set_cell_formats"
        );
        let after_fmt = after.format.unwrap();

        // Borders should be applied
        assert!(after_fmt.borders.is_some(), "borders should be applied");
        assert!(
            after_fmt.borders.as_ref().unwrap().top.is_some(),
            "top border should be set"
        );

        // Existing format properties MUST be preserved (this is the bug check)
        assert_eq!(
            after_fmt.bold,
            Some(true),
            "bold should be preserved after border-only operation"
        );
        assert_eq!(
            after_fmt.font_size,
            Some(domain_types::FontSize::from_millipoints(10000)),
            "font_size should be preserved after border-only operation"
        );
        assert_eq!(
            after_fmt.font_family,
            Some("Calibri".to_string()),
            "font_family should be preserved after border-only operation"
        );
        assert_eq!(
            after_fmt.number_format,
            Some("#,##0".to_string()),
            "number_format should be preserved after border-only operation"
        );
    }

    // ===================================================================
    // Format Range Tests
    // ===================================================================

    /// Helper: create a storage with a sheet and get a mutable SheetMirror reference.
    fn storage_with_sheet_and_mirror() -> (
        crate::storage::YrsStorage,
        SheetId,
        GridIndex,
        crate::mirror::CellMirror,
    ) {
        let mut storage = crate::storage::YrsStorage::new();
        let mut mirror = crate::mirror::CellMirror::new();
        let sid = make_sheet_id(1);
        storage
            .add_sheet(&mut mirror, sid, "Sheet1", 100, 26)
            .unwrap();
        let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
        let gi = GridIndex::new(sid, 100, 26, id_alloc);
        (storage, sid, gi, mirror)
    }

    // -------------------------------------------------------------------
    // Test 32: Format cascade with all layers — cell > table > Format Range > row > col > default
    // -------------------------------------------------------------------

    #[test]
    fn test_format_cascade_all_layers() {
        let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

        // Column 1: number format
        set_col_format(
            &mut storage,
            &sid,
            1,
            &CellFormat {
                number_format: Some("0.00%".to_string()),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        // Row 2: font_color
        set_row_format(
            &mut storage,
            &sid,
            2,
            &CellFormat {
                font_color: Some("#FF0000".to_string()),
                ..Default::default()
            },
            Some(&gi),
        )
        .unwrap();

        // Format Range covering (0,0)-(5,5): background_color + italic
        let range_id = crate::mirror::RangeId::from_raw(1000);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            0,
            0,
            5,
            5,
            &CellFormat {
                background_color: Some("#00FF00".to_string()),
                italic: Some(true),
                ..Default::default()
            },
        );

        // Table format: bold
        let table_fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };

        // Cell format: wrap_text
        set_cell_format(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &sid,
            "cell-cascade",
            &CellFormat {
                wrap_text: Some(true),
                ..Default::default()
            },
        );

        // Get effective format at (2, 1) with all layers
        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        let eff = get_effective_format(
            &storage,
            &sid,
            "cell-cascade",
            2,
            1,
            Some(&table_fmt),
            Some(&gi),
            Some(sheet_mirror),
        );

        // Verify cascade priority: cell > table > Format Range > row > col > default
        // wrap_text: from cell
        assert_eq!(eff.wrap_text, Some(true));
        // bold: from table
        assert_eq!(eff.bold, Some(true));
        // background_color: from Format Range
        assert_eq!(eff.background_color, Some("#00FF00".to_string()));
        // italic: from Format Range
        assert_eq!(eff.italic, Some(true));
        // font_color: from row
        assert_eq!(eff.font_color, Some("#FF0000".to_string()));
        // number_format: from col
        assert_eq!(eff.number_format, Some("0.00%".to_string()));
        // font_family: from default
        assert_eq!(eff.font_family, Some("Calibri".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 33: Two overlapping Format Ranges — non-conflicting merge + conflict resolution
    // -------------------------------------------------------------------

    #[test]
    fn test_overlapping_format_ranges() {
        let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

        // Range 1 (lower RangeId): background_color + italic
        let range_id_low = crate::mirror::RangeId::from_raw(100);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id_low,
            0,
            0,
            10,
            10,
            &CellFormat {
                background_color: Some("#AAAAAA".to_string()),
                italic: Some(true),
                ..Default::default()
            },
        );

        // Range 2 (higher RangeId): background_color (conflicting) + bold (non-conflicting)
        let range_id_high = crate::mirror::RangeId::from_raw(200);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id_high,
            0,
            0,
            5,
            5,
            &CellFormat {
                background_color: Some("#BBBBBB".to_string()),
                bold: Some(true),
                ..Default::default()
            },
        );

        // Query at (3, 3) — both ranges overlap
        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        let base = default_format();
        let result = apply_format_range_layer(&base, 3, 3, Some(sheet_mirror));

        // Non-conflicting: italic from range 1
        assert_eq!(result.italic, Some(true));
        // Non-conflicting: bold from range 2
        assert_eq!(result.bold, Some(true));
        // Conflicting: background_color — higher RangeId (200) wins
        assert_eq!(result.background_color, Some("#BBBBBB".to_string()));

        // Query at (7, 7) — only range 1 overlaps
        let result2 = apply_format_range_layer(&base, 7, 7, Some(sheet_mirror));
        assert_eq!(result2.background_color, Some("#AAAAAA".to_string()));
        assert_eq!(result2.italic, Some(true));
        assert_eq!(result2.bold, Some(false)); // from default

        // Query at (12, 12) — no ranges overlap
        let result3 = apply_format_range_layer(&base, 12, 12, Some(sheet_mirror));
        assert_eq!(result3.background_color, None); // default has no background
    }

    // -------------------------------------------------------------------
    // Test 34: Format Range deletion — cascade falls back
    // -------------------------------------------------------------------

    #[test]
    fn test_format_range_deletion_lifecycle() {
        let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

        let range_id = crate::mirror::RangeId::from_raw(500);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            0,
            0,
            10,
            10,
            &CellFormat {
                background_color: Some("#FF0000".to_string()),
                ..Default::default()
            },
        );

        // Verify it's in the cascade
        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        let base = default_format();
        let result = apply_format_range_layer(&base, 5, 5, Some(sheet_mirror));
        assert_eq!(result.background_color, Some("#FF0000".to_string()));

        // Delete the Format Range
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        remove_format_range(&mut storage, &sid, sheet_mirror, range_id);

        // After deletion, cascade falls back to base (no background_color)
        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        let result2 = apply_format_range_layer(&base, 5, 5, Some(sheet_mirror));
        assert_eq!(result2.background_color, None);

        // Verify the mirror state
        assert!(sheet_mirror.format_ranges().is_empty());
        assert!(sheet_mirror.range_format_cache().is_empty());
    }

    // -------------------------------------------------------------------
    // Test 35: Cold-load — Format Range survives Yrs rehydration
    // -------------------------------------------------------------------

    #[test]
    fn test_format_range_cold_load() {
        let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

        // Add a Format Range
        let range_id = crate::mirror::RangeId::from_raw(777);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            2,
            3,
            8,
            7,
            &CellFormat {
                bold: Some(true),
                font_color: Some("#0000FF".to_string()),
                ..Default::default()
            },
        );

        // Create a fresh SheetMirror (simulating cold-load) and hydrate
        let mut fresh_mirror = crate::mirror::SheetMirror::new(sid, "Sheet1".to_string(), 100, 26);
        assert!(fresh_mirror.format_ranges().is_empty());
        assert!(fresh_mirror.range_format_cache().is_empty());

        hydrate_format_ranges(&storage, &sid, &mut fresh_mirror);

        // Verify hydration populated the mirror
        assert_eq!(fresh_mirror.format_ranges().len(), 1);
        assert_eq!(fresh_mirror.range_format_cache().len(), 1);

        let fr = &fresh_mirror.format_ranges()[0];
        assert_eq!(fr.id, range_id);
        assert_eq!(fr.start_row, 2);
        assert_eq!(fr.start_col, 3);
        assert_eq!(fr.end_row, 8);
        assert_eq!(fr.end_col, 7);

        let fmt = fresh_mirror.range_format_cache().get(&range_id).unwrap();
        assert_eq!(fmt.bold, Some(true));
        assert_eq!(fmt.font_color, Some("#0000FF".to_string()));

        // Verify the cascade works with the hydrated mirror
        let base = default_format();
        let result = apply_format_range_layer(&base, 5, 5, Some(&fresh_mirror));
        assert_eq!(result.bold, Some(true));
        assert_eq!(result.font_color, Some("#0000FF".to_string()));

        // Outside the range — no effect
        let result_outside = apply_format_range_layer(&base, 0, 0, Some(&fresh_mirror));
        assert_eq!(result_outside.bold, Some(false)); // from default
    }

    // -------------------------------------------------------------------
    // Test 36: Hydration on empty rangeFormats is a no-op
    // -------------------------------------------------------------------

    #[test]
    fn test_hydrate_empty_range_formats() {
        let (storage, sid, _gi, _mirror) = storage_with_sheet_and_mirror();

        // Fresh mirror + hydrate from a sheet with empty rangeFormats
        let mut fresh_mirror = crate::mirror::SheetMirror::new(sid, "Sheet1".to_string(), 100, 26);
        hydrate_format_ranges(&storage, &sid, &mut fresh_mirror);

        assert!(fresh_mirror.format_ranges().is_empty());
        assert!(fresh_mirror.range_format_cache().is_empty());
    }

    // -------------------------------------------------------------------
    // Test 37: Positional format includes Format Range layer
    // -------------------------------------------------------------------

    #[test]
    fn test_positional_format_with_ranges() {
        let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

        let range_id = crate::mirror::RangeId::from_raw(300);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            0,
            0,
            10,
            10,
            &CellFormat {
                background_color: Some("#ABCDEF".to_string()),
                ..Default::default()
            },
        );

        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        let eff = get_positional_format(&storage, &sid, 5, 5, Some(&gi), Some(sheet_mirror));
        assert_eq!(eff.background_color, Some("#ABCDEF".to_string()));
        // Default fields still present
        assert_eq!(eff.font_family, Some("Calibri".to_string()));
    }

    // -------------------------------------------------------------------
    // Test 38: Format Range update (add same RangeId with different format)
    // -------------------------------------------------------------------

    #[test]
    fn test_format_range_update() {
        let (mut storage, sid, _gi, mut mirror) = storage_with_sheet_and_mirror();

        let range_id = crate::mirror::RangeId::from_raw(400);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();

        // Initial format: bold
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            0,
            0,
            5,
            5,
            &CellFormat {
                bold: Some(true),
                ..Default::default()
            },
        );

        // Update: change to italic (same RangeId)
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            0,
            0,
            5,
            5,
            &CellFormat {
                italic: Some(true),
                ..Default::default()
            },
        );

        // Should have exactly 1 range, not 2
        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        assert_eq!(sheet_mirror.format_ranges().len(), 1);

        let base = default_format();
        let result = apply_format_range_layer(&base, 3, 3, Some(sheet_mirror));
        // Should have the updated format (italic), not the old one (bold)
        assert_eq!(result.italic, Some(true));
        // bold should come from default (false), since the update replaced the format
        assert_eq!(result.bold, Some(false));
    }

    // -------------------------------------------------------------------
    // Test 39: preloaded cascade with Format Range
    // -------------------------------------------------------------------

    #[test]
    fn test_effective_format_preloaded_with_ranges() {
        let (mut storage, sid, gi, mut mirror) = storage_with_sheet_and_mirror();

        let range_id = crate::mirror::RangeId::from_raw(600);
        let sheet_mirror = mirror.get_sheet_mut(&sid).unwrap();
        add_format_range(
            &mut storage,
            &sid,
            sheet_mirror,
            range_id,
            0,
            0,
            10,
            10,
            &CellFormat {
                background_color: Some("#123456".to_string()),
                ..Default::default()
            },
        );

        let cell_fmt = CellFormat {
            bold: Some(true),
            ..Default::default()
        };

        let sheet_mirror = mirror.get_sheet(&sid).unwrap();
        let eff = get_effective_format_preloaded(
            &storage,
            &sid,
            5,
            5,
            None,
            &cell_fmt,
            Some(&gi),
            Some(sheet_mirror),
        );

        assert_eq!(eff.bold, Some(true)); // from cell format
        assert_eq!(eff.background_color, Some("#123456".to_string())); // from Format Range
        assert_eq!(eff.font_family, Some("Calibri".to_string())); // from default
    }
}
