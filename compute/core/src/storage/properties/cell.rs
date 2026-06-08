use super::super::KEY_CELL_PROPERTIES;
use super::merge::{merge_formats, normalize_format_patch};
use super::yrs::{get_sheet_submap, resolve_compact_props};
use crate::engine_types::formatting::*;
use cell_types::{CellId, SheetId};
use compute_document::hex::parse_cell_id;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::CellFormat;
use domain_types::yrs_schema::cell_properties as props_schema;
use yrs::{Any, Doc, Map, MapPrelim, MapRef, Origin, Out, Transact};

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

/// Clear cached formula serialization metadata after a direct cell edit.
///
/// The cache markers describe the imported cached result shape, so user
/// formula/value writes must not carry them forward unless recalculation
/// explicitly writes fresh metadata later.
pub fn clear_formula_cache_metadata(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
) {
    let Some(mut props) = get_properties(doc, workbook, sheets, sheet_id, cell_id) else {
        return;
    };
    if props.formula_result_type.is_none()
        && !props.has_empty_cached_value
        && props.formula_cache_provenance.is_absent_or_unknown()
    {
        return;
    }

    props.formula_result_type = None;
    props.has_empty_cached_value = false;
    props.formula_cache_provenance = Default::default();
    if props.format.is_none() && props.metadata_is_empty() {
        clear_properties(doc, sheets, sheet_id, cell_id);
    } else {
        set_properties(doc, sheets, sheet_id, cell_id, &props);
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

/// Replace the format portion of a cell's properties.
///
/// Copy/paste and autofill replicate a source format snapshot. Unlike toolbar
/// formatting, that operation must clear target-only format properties that
/// are absent from the source. Non-format metadata is preserved.
pub fn replace_cell_format(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
) {
    let mut props = get_properties(doc, workbook, sheets, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(normalize_format_patch(format));
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
    set_cell_formats_with_origin(
        doc,
        workbook,
        sheets,
        sheet_id,
        cell_ids,
        format,
        ORIGIN_USER_EDIT,
    );
}

/// Set format on multiple cells in a single Yrs transaction with an explicit undo origin.
pub fn set_cell_formats_with_origin(
    doc: &Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    format: &CellFormat,
    origin: &'static [u8],
) {
    let existing: Vec<CellProperties> = cell_ids
        .iter()
        .map(|cid| get_properties(doc, workbook, sheets, sheet_id, cid).unwrap_or_default())
        .collect();

    let mut txn = doc.transact_mut_with(Origin::from(origin));
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
