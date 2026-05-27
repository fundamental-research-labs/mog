use super::super::{KEY_COL_FORMATS, KEY_ROW_FORMATS, id_to_hex};
use super::merge::{merge_formats, normalize_format_patch};
use super::yrs::get_sheet_submap;
use crate::identity::GridIndex;
use crate::storage::YrsStorage;
use cell_types::SheetId;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::{CellFormat, yrs_schema};
use value_types::ComputeError;
use yrs::{Any, Map, MapPrelim, Origin, Out, Transact};

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
