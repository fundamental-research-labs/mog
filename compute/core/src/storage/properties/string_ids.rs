//! String-ID adapters for serialization boundaries and existing Rust consumers.
//! Engine callers use the typed property functions directly.

use super::cell::*;
use super::merge::{merge_formats, normalize_format_patch};
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
    let mut props = get_properties(storage, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(props.format.as_ref().map_or_else(
        || normalize_format_patch(format),
        |existing| merge_formats(existing, format),
    ));
    props.style_id = None;
    set_properties(storage, sheet_id, cell_id, &props);
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
    let mut props = get_properties(storage, sheet_id, cell_id).unwrap_or_default();
    props.format = Some(normalize_format_patch(format));
    props.style_id = None;
    set_properties(storage, sheet_id, cell_id, &props);
}

pub fn clear_cell_format(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: &str) {
    if let Some(mut props) = get_properties(storage, sheet_id, cell_id) {
        props.format = None;
        props.style_id = None;
        set_properties(storage, sheet_id, cell_id, &props);
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
    // Validate every patch before writing any part of the batch.
    let patched: Vec<_> = cell_ids
        .iter()
        .map(|id| {
            let mut props = get_properties(storage, sheet_id, id).unwrap_or_default();
            let patched = super::apply_format_patch(
                &props.format.clone().unwrap_or_default(),
                format,
                clear_fields,
            )?;
            props.format = (patched != CellFormat::default()).then_some(patched);
            props.style_id = None;
            Ok(props)
        })
        .collect::<Result<_, value_types::ComputeError>>()?;
    for (id, props) in cell_ids.iter().zip(patched) {
        set_properties(storage, sheet_id, id, &props);
    }
    Ok(())
}

pub fn patch_cell_borders(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_ids: &[&str],
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
) -> Result<(), value_types::ComputeError> {
    for id in cell_ids {
        let mut props = get_properties(storage, sheet_id, id).unwrap_or_default();
        let mut format = props.format.take().unwrap_or_default();
        format.borders = super::apply_borders_patch(format.borders.as_ref(), borders, clear_fields);
        props.format = (format != CellFormat::default()).then_some(format);
        props.style_id = None;
        set_properties(storage, sheet_id, id, &props);
    }
    Ok(())
}

pub fn clear_cell_formats(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_ids: &[&str]) {
    for id in cell_ids {
        clear_cell_format(storage, sheet_id, id);
    }
}
