//! Direct row/column formats keyed by native axis identities.
use super::merge::{merge_formats, normalize_format_patch};
use crate::border_patch::BorderPatchField;
use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use crate::storage::sheet::dimensions::StoredAxisFormat;
use cell_types::SheetId;
use domain_types::{CellBorders, CellFormat};
use value_types::ComputeError;

pub fn get_row_format(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) -> Option<CellFormat> {
    get_row_format_by_id(storage, sheet_id, grid?.row_id(row)?)
}

pub(crate) fn get_row_format_by_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    id: cell_types::RowId,
) -> Option<CellFormat> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .dimensions
        .rows
        .get(&id)?
        .format
        .as_ref()?
        .resolve(&storage.metadata.style_palette)
        .cloned()
}
pub fn get_row_xlsx_style_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) -> Option<u32> {
    let id = grid?.row_id(row)?;
    storage
        .sheet_metadata
        .get(sheet_id)?
        .dimensions
        .rows
        .get(&id)?
        .format
        .as_ref()?
        .xlsx_style_id()
}

fn replace_row_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    format: CellFormat,
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let missing = || ComputeError::SheetNotFound {
        sheet_id: sheet_id.to_uuid_string(),
    };
    let id = grid.and_then(|grid| grid.row_id(row)).ok_or_else(missing)?;
    crate::storage::engine::history::metadata::capture_row(storage, *sheet_id, id);
    let meta = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .ok_or_else(missing)?;
    meta.dimensions.rows.entry(id).or_default().format =
        (format != CellFormat::default()).then(|| StoredAxisFormat::Detailed(Box::new(format)));
    Ok(())
}

pub fn set_row_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    format: &CellFormat,
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let merged = get_row_format(storage, sheet_id, row, grid)
        .map(|existing| merge_formats(&existing, format))
        .unwrap_or_else(|| normalize_format_patch(format));
    replace_row_format(storage, sheet_id, row, merged, grid)
}

pub fn patch_row_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    format: &CellFormat,
    clear_fields: &[String],
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let existing = get_row_format(storage, sheet_id, row, grid).unwrap_or_default();
    let patched = super::apply_format_patch(&existing, format, clear_fields)?;
    replace_row_format(storage, sheet_id, row, patched, grid)
}

pub fn patch_row_borders(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let mut patched = get_row_format(storage, sheet_id, row, grid).unwrap_or_default();
    patched.borders = super::apply_borders_patch(patched.borders.as_ref(), borders, clear_fields);
    replace_row_format(storage, sheet_id, row, patched, grid)
}

pub struct RowFormatEntry {
    pub row: u32,
    pub format: Option<CellFormat>,
    pub xlsx_style_id: Option<u32>,
}

pub fn get_all_row_formats(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<RowFormatEntry> {
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return vec![];
    };
    let mut entries: Vec<_> = meta
        .dimensions
        .rows
        .iter()
        .filter_map(|(id, record)| {
            let format = record.format.as_ref()?;
            Some(RowFormatEntry {
                row: grid.row_index(id)?,
                format: format.resolve(&storage.metadata.style_palette).cloned(),
                xlsx_style_id: format.xlsx_style_id(),
            })
        })
        .collect();
    entries.sort_unstable_by_key(|entry| entry.row);
    entries
}

pub fn get_col_format(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid: Option<&GridIndex>,
) -> Option<CellFormat> {
    get_col_format_by_id(storage, sheet_id, grid?.col_id(col)?)
}

pub(crate) fn get_col_format_by_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    id: cell_types::ColId,
) -> Option<CellFormat> {
    storage
        .sheet_metadata
        .get(sheet_id)?
        .dimensions
        .columns
        .get(&id)?
        .format
        .as_ref()?
        .resolve(&storage.metadata.style_palette)
        .cloned()
}
pub fn get_col_xlsx_style_id(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid: Option<&GridIndex>,
) -> Option<u32> {
    let id = grid?.col_id(col)?;
    storage
        .sheet_metadata
        .get(sheet_id)?
        .dimensions
        .columns
        .get(&id)?
        .format
        .as_ref()?
        .xlsx_style_id()
}

fn replace_col_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    format: CellFormat,
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let missing = || ComputeError::SheetNotFound {
        sheet_id: sheet_id.to_uuid_string(),
    };
    let id = grid.and_then(|grid| grid.col_id(col)).ok_or_else(missing)?;
    crate::storage::engine::history::metadata::capture_column(storage, *sheet_id, id);
    let meta = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .ok_or_else(missing)?;
    meta.dimensions.columns.entry(id).or_default().format =
        (format != CellFormat::default()).then(|| StoredAxisFormat::Detailed(Box::new(format)));
    Ok(())
}

pub fn set_col_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    format: &CellFormat,
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let merged = get_col_format(storage, sheet_id, col, grid)
        .map(|existing| merge_formats(&existing, format))
        .unwrap_or_else(|| normalize_format_patch(format));
    replace_col_format(storage, sheet_id, col, merged, grid)
}

pub fn patch_col_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    format: &CellFormat,
    clear_fields: &[String],
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let existing = get_col_format(storage, sheet_id, col, grid).unwrap_or_default();
    let patched = super::apply_format_patch(&existing, format, clear_fields)?;
    replace_col_format(storage, sheet_id, col, patched, grid)
}

pub fn patch_col_borders(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
    grid: Option<&GridIndex>,
) -> Result<(), ComputeError> {
    let mut patched = get_col_format(storage, sheet_id, col, grid).unwrap_or_default();
    patched.borders = super::apply_borders_patch(patched.borders.as_ref(), borders, clear_fields);
    replace_col_format(storage, sheet_id, col, patched, grid)
}

pub struct ColFormatEntry {
    pub col: u32,
    pub format: Option<CellFormat>,
    pub xlsx_style_id: Option<u32>,
}

pub fn get_all_col_formats(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    grid: Option<&GridIndex>,
) -> Vec<ColFormatEntry> {
    let (Some(meta), Some(grid)) = (storage.sheet_metadata.get(sheet_id), grid) else {
        return vec![];
    };
    let mut entries: Vec<_> = meta
        .dimensions
        .columns
        .iter()
        .filter_map(|(id, record)| {
            let format = record.format.as_ref()?;
            Some(ColFormatEntry {
                col: grid.col_index(id)?,
                format: format.resolve(&storage.metadata.style_palette).cloned(),
                xlsx_style_id: format.xlsx_style_id(),
            })
        })
        .collect();
    entries.sort_unstable_by_key(|entry| entry.col);
    entries
}

pub fn clear_row_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    row: u32,
    grid: Option<&GridIndex>,
) {
    let Some(id) = grid.and_then(|grid| grid.row_id(row)) else {
        return;
    };
    crate::storage::engine::history::metadata::capture_row(storage, *sheet_id, id);
    if let Some(record) = storage
        .sheet_metadata
        .get_mut(sheet_id)
        .and_then(|meta| meta.dimensions.rows.get_mut(&id))
    {
        record.format = None;
    }
}

pub fn clear_col_format(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    col: u32,
    grid: Option<&GridIndex>,
) {
    if let Some(id) = grid.and_then(|grid| grid.col_id(col)) {
        crate::storage::engine::history::metadata::capture_column(storage, *sheet_id, id);
        if let Some(record) = storage
            .sheet_metadata
            .get_mut(sheet_id)
            .and_then(|meta| meta.dimensions.columns.get_mut(&id))
        {
            record.format = None;
        }
    }
}
