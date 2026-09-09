//! String-ID adapters for serialization boundaries and existing Rust consumers.
//! Engine callers use the typed property functions directly.

use super::cell::*;
use crate::border_patch::BorderPatchField;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use compute_document::hex::parse_cell_id;
use domain_types::{CellBorders, CellFormat};
use snapshot_types::CellProperties;

pub fn get_properties(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<CellProperties> {
    get_properties_by_id(storage, sheet_id, &parse_cell_id(cell_id)?)
}

pub fn set_properties(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    props: &CellProperties,
) {
    let Some(id) = parse_cell_id(cell_id) else {
        return;
    };
    set_properties_by_id(storage, sheet_id, &id, props);
}

pub fn clear_properties(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: &str) {
    let Some(id) = parse_cell_id(cell_id) else {
        return;
    };
    clear_properties_by_id(storage, sheet_id, &id);
}

pub fn clear_formula_cache_metadata(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
) {
    let Some(id) = parse_cell_id(cell_id) else {
        return;
    };
    clear_formula_cache_metadata_by_id(storage, sheet_id, &id);
}

pub fn get_cell_format(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
) -> Option<CellFormat> {
    get_properties(storage, sheet_id, cell_id)?.format
}

pub fn set_cell_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
) {
    if let Some(id) = parse_cell_id(cell_id) {
        set_cell_format_by_id(storage, sheet_id, &id, format);
    }
}

pub fn patch_cell_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), value_types::ComputeError> {
    patch_cell_formats(storage, sheet_id, &[cell_id], format, clear_fields)
}

pub fn replace_cell_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: &str,
    format: &CellFormat,
) {
    if let Some(id) = parse_cell_id(cell_id) {
        replace_cell_format_by_id(storage, sheet_id, &id, format);
    }
}

pub fn clear_cell_format(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: &str) {
    if let Some(id) = parse_cell_id(cell_id) {
        clear_cell_format_by_id(storage, sheet_id, &id);
    }
}

pub fn set_cell_formats(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    format: &CellFormat,
) {
    for id in cell_ids {
        set_cell_format(storage, sheet_id, id, format);
    }
}

pub fn patch_cell_formats(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<(), value_types::ComputeError> {
    let ids: Vec<_> = cell_ids.iter().filter_map(|id| parse_cell_id(id)).collect();
    // A nonempty batch still validates the patch when every ID is malformed.
    // Otherwise the native batch validates before mutating any valid cell.
    if ids.is_empty() && !cell_ids.is_empty() {
        super::apply_format_patch(&CellFormat::default(), format, clear_fields)?;
    }
    patch_cell_formats_by_id(storage, sheet_id, &ids, format, clear_fields)
}

pub fn patch_cell_borders(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
) -> Result<(), value_types::ComputeError> {
    let ids: Vec<_> = cell_ids.iter().filter_map(|id| parse_cell_id(id)).collect();
    patch_cell_borders_by_id(storage, sheet_id, &ids, borders, clear_fields)
}

pub fn clear_cell_formats(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_ids: &[&str]) {
    for id in cell_ids {
        clear_cell_format(storage, sheet_id, id);
    }
}
