//! Table management helpers extracted as free functions.
//!
//! Read-only queries take `&CellMirror` (and optionally `&EngineStores`).
//! Mutations take `(&mut EngineStores, &mut CellMirror)`.
//! Bridge methods on `YrsComputeEngine` delegate to these with one-line calls.

use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use domain_types::CellFormat;
use domain_types::domain::table::{Table as CanonicalTable, TableColumn};
use formula_types::TableDef;
use value_types::ComputeError;
use yrs::{Map, Origin, Out, Transact};

use crate::engine_types::{AutoExpansionResult, TableHitRegion};
use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, FilterChange, MutationResult, TableChange};
use crate::storage::cells::structured_ref_updater;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;

// -------------------------------------------------------------------
// Table Queries (read-only)
// -------------------------------------------------------------------

/// Get all tables in a specific sheet.
pub(in crate::storage::engine) fn get_all_tables_in_sheet(
    mirror: &CellMirror,
    sheet_id: &SheetId,
) -> Vec<CanonicalTable> {
    let sheet_hex = sheet_id.to_uuid_string();
    mirror
        .all_tables()
        .iter()
        .filter(|t| t.sheet_id == sheet_hex)
        .cloned()
        .collect()
}

/// Get the table containing a specific cell, if any.
pub(in crate::storage::engine) fn get_table_at_cell(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CanonicalTable> {
    let sheet_hex = sheet_id.to_uuid_string();
    mirror
        .all_tables()
        .iter()
        .find(|t| {
            t.sheet_id == sheet_hex
                && row >= t.range.start_row()
                && row <= t.range.end_row()
                && col >= t.range.start_col()
                && col <= t.range.end_col()
        })
        .cloned()
}

/// Look up a table definition by name (case-insensitive).
pub(in crate::storage::engine) fn get_table_by_name(
    mirror: &CellMirror,
    table_name: &str,
) -> Option<CanonicalTable> {
    mirror.get_table(table_name).cloned()
}

/// Get which table region a cell falls in (header, data, or totals).
pub(in crate::storage::engine) fn get_table_hit_region(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<TableHitRegion> {
    let sheet_hex = sheet_id.to_uuid_string();
    let t = mirror.all_tables().iter().find(|t| {
        t.sheet_id == sheet_hex
            && row >= t.range.start_row()
            && row <= t.range.end_row()
            && col >= t.range.start_col()
            && col <= t.range.end_col()
    })?;

    let region = if row == t.range.start_row() && t.has_header_row {
        "header"
    } else if t.has_totals_row && row == t.range.end_row() {
        "totals"
    } else {
        "data"
    };
    let column_index = col - t.range.start_col();
    let column_name = t
        .columns
        .get(column_index as usize)
        .map(|c| c.name.clone())
        .unwrap_or_default();

    Some(TableHitRegion {
        table_name: t.name.clone(),
        region: region.to_string(),
        column_index,
        start_row: t.range.start_row(),
        start_col: t.range.start_col(),
        end_row: t.range.end_row(),
        end_col: t.range.end_col(),
        has_headers: t.has_header_row,
        has_totals: t.has_totals_row,
        column_name,
    })
}

/// Detect if a table should auto-expand based on adjacent data.
pub(in crate::storage::engine) fn detect_auto_expansion(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table_name: &str,
) -> Result<AutoExpansionResult, ComputeError> {
    let sheet_hex = sheet_id.to_uuid_string();
    let table = &mirror
        .all_tables()
        .iter()
        .find(|t| t.name == table_name && t.sheet_id == sheet_hex)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {} in sheet", table_name),
        })?;
    // TODO: Implement actual auto-expansion detection.
    Ok(AutoExpansionResult {
        should_expand: false,
        new_end_row: table.range.end_row(),
        new_end_col: table.range.end_col(),
    })
}

/// Resolve the table-derived CellFormat for a cell, if it is inside a table.
pub(in crate::storage::engine) fn resolve_table_format_at_cell(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<CellFormat> {
    let sheet_hex = sheet_id.to_uuid_string();
    let table = &mirror.all_tables().iter().find(|t| {
        t.sheet_id == sheet_hex
            && row >= t.range.start_row()
            && row <= t.range.end_row()
            && col >= t.range.start_col()
            && col <= t.range.end_col()
    })?;

    let ct_table = crate::storage::table_format::build_table_for_style_resolution(table);
    let tcf = compute_table::styles::resolve_table_cell_format(&ct_table, row, col)?;
    Some(crate::storage::table_format::table_cell_format_to_cell_format(&tcf))
}

/// Get all custom table styles.
pub(in crate::storage::engine) fn get_all_custom_table_styles(
    stores: &EngineStores,
) -> Vec<compute_table::custom_styles::CustomTableStyleConfig> {
    let mut result: Vec<_> = stores.custom_table_styles.values().cloned().collect();
    result.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    result
}

// -------------------------------------------------------------------
// Table CRUD Mutations
// -------------------------------------------------------------------

/// Create a new table from parameters and register it in the compute mirror.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn create_table(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    name: String,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: Vec<String>,
    has_headers: bool,
    style: Option<String>,
) -> Result<MutationResult, ComputeError> {
    // Derive column names: use provided names, fall back to header-row cell
    // values, and finally generate "Column1", "Column2", etc.
    let col_count = (end_col - start_col + 1) as usize;
    let effective_columns: Vec<String> = if !columns.is_empty() {
        columns
    } else {
        (0..col_count)
            .map(|i| {
                let col = start_col + i as u32;
                if has_headers {
                    // Read header cell value from the mirror
                    mirror
                        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(start_row, col))
                        .and_then(|v| match v {
                            value_types::CellValue::Text(s) => Some(s.to_string()),
                            value_types::CellValue::Number(n) => Some(n.to_string()),
                            _ => None,
                        })
                        .unwrap_or_else(|| format!("Column{}", i + 1))
                } else {
                    format!("Column{}", i + 1)
                }
            })
            .collect()
    };

    let table = CanonicalTable {
        id: name.clone(),
        name: name.clone(),
        display_name: name.clone(),
        sheet_id: sheet_id.to_uuid_string(),
        range: cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
        columns: effective_columns
            .iter()
            .enumerate()
            .map(|(i, col_name)| TableColumn {
                id: format!("{}", i + 1),
                name: col_name.clone(),
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            })
            .collect(),
        has_header_row: has_headers,
        has_totals_row: false,
        style: style.unwrap_or_else(|| "TableStyleMedium2".to_string()),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
    };
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    let header_start_id = grid.ensure_cell_id(start_row, start_col);
    let header_end_id = grid.ensure_cell_id(start_row, end_col);
    let data_end_id = grid.ensure_cell_id(end_row, end_col);

    mirror.register_identity_only(
        sheet_id,
        SheetPos::new(start_row, start_col),
        header_start_id,
    );
    mirror.register_identity_only(sheet_id, SheetPos::new(start_row, end_col), header_end_id);
    mirror.register_identity_only(sheet_id, SheetPos::new(end_row, end_col), data_end_id);

    let header_start = id_to_hex(header_start_id.as_u128()).to_string();
    let header_end = id_to_hex(header_end_id.as_u128()).to_string();
    let data_end = id_to_hex(data_end_id.as_u128()).to_string();

    stores.compute.set_table(mirror, table.clone());
    let filter_state = persist_table_to_yrs_with_table_filter(
        stores,
        &table,
        sheet_id,
        &header_start,
        &header_end,
        &data_end,
    )?;

    // Re-parse formulas containing implicit structured refs now that the table exists.
    let recalc_result = stores
        .compute
        .reparse_implicit_structured_refs(mirror, sheet_id, start_row, start_col, end_row, end_col);

    let mut result = MutationResult::empty();
    result.recalc = recalc_result;
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_state.id,
        filter_kind: Some("tableFilter".to_string()),
        action: Some("created".to_string()),
        hidden_row_count: None,
        visible_row_count: None,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

/// Delete a table by name.
pub(in crate::storage::engine) fn delete_table(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror.get_table(table_name).cloned();
    let table_filter = table.as_ref().and_then(|table| {
        let sheet_id = SheetId::from_uuid_str(&table.sheet_id).ok()?;
        filters::get_table_filter(
            stores.storage.doc(),
            stores.storage.sheets(),
            &sheet_id,
            &table.id,
        )
        .map(|filter| (sheet_id, filter.id))
    });

    structured_ref_updater::propagate_ref_error_for_table_delete(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        table_name,
    );

    stores.compute.remove_table(mirror, table_name);
    remove_table_from_yrs_with_filter(stores, table_name, table_filter.as_ref());
    Ok(MutationResult::empty())
}

/// Rename a table.
pub(in crate::storage::engine) fn rename_table(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    old_name: &str,
    new_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(old_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", old_name),
        })?;
    stores.compute.remove_table(mirror, old_name);
    remove_table_from_yrs(stores, old_name);
    let mut renamed = table;
    renamed.name = new_name.to_string();
    stores.compute.set_table(mirror, renamed.clone());
    persist_table_to_yrs(stores, &renamed);

    structured_ref_updater::update_formulas_for_table_rename(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        old_name,
        new_name,
    );

    Ok(MutationResult::empty())
}

/// Resize a table's range.
pub(in crate::storage::engine) fn resize_table(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    new_start_row: u32,
    new_start_col: u32,
    new_end_row: u32,
    new_end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let sheet_id = SheetId::from_uuid_str(&table.sheet_id).map_err(|_| ComputeError::Eval {
        message: format!("Invalid sheet ID in table: {}", table_name),
    })?;
    let mut resized = table.clone();
    resized.range =
        cell_types::SheetRange::new(new_start_row, new_start_col, new_end_row, new_end_col);

    // If columns expanded, add new column definitions from header row values.
    let new_col_count = (new_end_col - new_start_col + 1) as usize;
    while resized.columns.len() < new_col_count {
        let i = resized.columns.len();
        let col = new_start_col + i as u32;
        let col_name = if resized.has_header_row {
            mirror
                .get_cell_value_at(&sheet_id, cell_types::SheetPos::new(new_start_row, col))
                .and_then(|v| match v {
                    value_types::CellValue::Text(s) => Some(s.to_string()),
                    value_types::CellValue::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .unwrap_or_else(|| format!("Column{}", i + 1))
        } else {
            format!("Column{}", i + 1)
        };
        resized.columns.push(TableColumn {
            id: format!("{}", i + 1),
            name: col_name,
            index: i as u32,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        });
    }
    // If columns contracted, remove excess.
    resized.columns.truncate(new_col_count);

    stores.compute.set_table(mirror, resized.clone());
    persist_table_to_yrs(stores, &resized);

    // Re-parse formulas with implicit structured refs in the new range.
    let _ = stores.compute.reparse_implicit_structured_refs(
        mirror,
        &sheet_id,
        new_start_row,
        new_start_col,
        new_end_row,
        new_end_col,
    );

    Ok(MutationResult::empty())
}

/// Toggle the totals row on/off for a table.
pub(in crate::storage::engine) fn toggle_totals_row(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    if updated.has_totals_row {
        // Turning off: contract end_row by 1
        updated.has_totals_row = false;
        updated.range = cell_types::SheetRange::new(
            updated.range.start_row(),
            updated.range.start_col(),
            updated.range.end_row().saturating_sub(1),
            updated.range.end_col(),
        );
    } else {
        // Turning on: expand end_row by 1
        updated.has_totals_row = true;
        updated.range = cell_types::SheetRange::new(
            updated.range.start_row(),
            updated.range.start_col(),
            updated.range.end_row().saturating_add(1),
            updated.range.end_col(),
        );
    }
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Toggle the header row on/off for a table.
pub(in crate::storage::engine) fn toggle_header_row(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    updated.has_header_row = !updated.has_header_row;
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Add a column to a table at the given position.
pub(in crate::storage::engine) fn add_table_column(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    column_name: &str,
    position: u32,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    let pos = (position as usize).min(updated.columns.len());
    updated.columns.insert(
        pos,
        TableColumn {
            id: format!("{}", updated.columns.len() + 1),
            name: column_name.to_string(),
            index: pos as u32,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
        },
    );
    for (i, col) in updated.columns.iter_mut().enumerate() {
        col.index = i as u32;
    }
    updated.range = cell_types::SheetRange::new(
        updated.range.start_row(),
        updated.range.start_col(),
        updated.range.end_row(),
        updated.range.end_col() + 1,
    );
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Rename a column in a table.
pub(in crate::storage::engine) fn rename_table_column(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    column_index: u32,
    new_column_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let idx = column_index as usize;
    if idx >= table.columns.len() {
        return Err(ComputeError::Eval {
            message: format!(
                "Column index {} out of range (table has {} columns)",
                column_index,
                table.columns.len()
            ),
        });
    }

    let old_column_name = table.columns[idx].name.clone();
    if old_column_name == new_column_name {
        return Ok(MutationResult::empty());
    }

    let mut updated = table;
    updated.columns[idx].name = new_column_name.to_string();
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);

    structured_ref_updater::update_formulas_for_column_rename(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        table_name,
        &old_column_name,
        new_column_name,
    );

    Ok(MutationResult::empty())
}

/// Remove a column from a table by index.
pub(in crate::storage::engine) fn remove_table_column(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    column_index: u32,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let idx = column_index as usize;
    if idx >= table.columns.len() {
        return Err(ComputeError::Eval {
            message: format!(
                "Column index {} out of range (table has {} columns)",
                column_index,
                table.columns.len()
            ),
        });
    }

    let deleted_col_name = table.columns[idx].name.clone();

    let mut updated = table;
    updated.columns.remove(idx);
    for (i, col) in updated.columns.iter_mut().enumerate() {
        col.index = i as u32;
    }
    if updated.range.end_col() > updated.range.start_col() {
        updated.range = cell_types::SheetRange::new(
            updated.range.start_row(),
            updated.range.start_col(),
            updated.range.end_row(),
            updated.range.end_col() - 1,
        );
    }
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);

    structured_ref_updater::propagate_ref_error_for_column_delete(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        table_name,
        &deleted_col_name,
    );

    Ok(MutationResult::empty())
}

/// Add a calculated column to a table.
pub(in crate::storage::engine) fn add_calculated_column(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    column_name: &str,
    formula: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    let next_index = updated.columns.len() as u32;
    updated.columns.push(TableColumn {
        id: format!("{}", next_index + 1),
        name: column_name.to_string(),
        index: next_index,
        totals_function: None,
        totals_label: None,
        calculated_formula: Some(formula.to_string()),
    });
    updated.range = cell_types::SheetRange::new(
        updated.range.start_row(),
        updated.range.start_col(),
        updated.range.end_row(),
        updated.range.end_col().saturating_add(1),
    );
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Remove a calculated column from a table by column index.
pub(in crate::storage::engine) fn remove_calculated_column(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    column_index: u32,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    let idx = column_index as usize;
    if idx >= updated.columns.len() {
        return Err(ComputeError::Eval {
            message: format!(
                "Column index {} out of range (table has {} columns)",
                column_index,
                updated.columns.len()
            ),
        });
    }
    updated.columns[idx].calculated_formula = None;
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Update the formula for a calculated column.
pub(in crate::storage::engine) fn update_calculated_column(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    column_index: u32,
    formula: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    let idx = column_index as usize;
    if idx >= updated.columns.len() {
        return Err(ComputeError::Eval {
            message: format!(
                "Column index {} out of range (table has {} columns)",
                column_index,
                updated.columns.len()
            ),
        });
    }
    updated.columns[idx].calculated_formula = Some(formula.to_string());
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Apply auto-expansion to a table.
pub(in crate::storage::engine) fn apply_auto_expansion(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_hex = sheet_id.to_uuid_string();
    let _table = &mirror
        .all_tables()
        .iter()
        .find(|t| t.name == table_name && t.sheet_id == sheet_hex)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {} in sheet", table_name),
        })?;
    Ok(MutationResult::empty())
}

/// Create a custom table style.
pub(in crate::storage::engine) fn create_custom_table_style(
    stores: &mut EngineStores,
    style: compute_table::custom_styles::CustomTableStyleConfig,
) -> Result<MutationResult, ComputeError> {
    let style_name = style.name.clone();
    stores.custom_table_styles.insert(style_name.clone(), style);
    let mut result = MutationResult::empty();
    result.table_changes.push(TableChange {
        name: style_name.clone(),
        sheet_id: String::new(),
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&style_name)?)
}

/// Delete a custom table style by name.
pub(in crate::storage::engine) fn delete_custom_table_style(
    stores: &mut EngineStores,
    style_name: &str,
) -> Result<MutationResult, ComputeError> {
    stores.custom_table_styles.remove(style_name);
    Ok(MutationResult::empty())
}

/// Update a custom table style.
pub(in crate::storage::engine) fn update_custom_table_style(
    stores: &mut EngineStores,
    style_name: &str,
    style: compute_table::custom_styles::CustomTableStyleConfig,
) -> Result<MutationResult, ComputeError> {
    stores
        .custom_table_styles
        .insert(style_name.to_string(), style);
    Ok(MutationResult::empty())
}

/// Set a table definition from a `TableDef`.
pub(in crate::storage::engine) fn set_table_def(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table: TableDef,
) {
    let canonical = CanonicalTable {
        id: table.name.clone(),
        name: table.name.clone(),
        display_name: table.name.clone(),
        sheet_id: table.sheet.to_uuid_string(),
        range: cell_types::SheetRange::new(
            table.start_row,
            table.start_col,
            table.end_row,
            table.end_col,
        ),
        columns: table
            .columns
            .iter()
            .enumerate()
            .map(|(i, name)| TableColumn {
                id: format!("{}", i + 1),
                name: name.clone(),
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            })
            .collect(),
        has_header_row: table.has_headers,
        has_totals_row: table.has_totals,
        style: "TableStyleMedium2".to_string(),
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
    };
    stores.compute.set_table(mirror, canonical);
}

/// Remove a table by name.
pub(in crate::storage::engine) fn remove_table_def(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    name: &str,
) {
    structured_ref_updater::propagate_ref_error_for_table_delete(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        name,
    );

    stores.compute.remove_table(mirror, name);
}

/// Convert a table to a plain range.
pub(in crate::storage::engine) fn convert_table_to_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let sheet_id_str = table.sheet_id.clone();

    let table_info = structured_ref_updater::TableRangeInfo {
        name: table.name.clone(),
        start_row: table.range.start_row(),
        start_col: table.range.start_col(),
        end_row: table.range.end_row(),
        end_col: table.range.end_col(),
        columns: table
            .columns
            .iter()
            .map(|c| (c.name.clone(), c.index))
            .collect(),
        has_header_row: table.has_header_row,
        has_total_row: table.has_totals_row,
    };

    let converted_count = structured_ref_updater::convert_structured_refs_to_a1(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        &table_info,
    );

    stores.compute.remove_table(mirror, table_name);
    remove_table_from_yrs(stores, table_name);

    let mut result = MutationResult::empty();
    result.table_changes.push(TableChange {
        name: table_name.to_string(),
        sheet_id: sheet_id_str,
        kind: ChangeKind::Removed,
    });
    Ok(result.with_data(&converted_count)?)
}

// -------------------------------------------------------------------
// Table Bool Options & Row Add/Remove
// -------------------------------------------------------------------

/// Set a boolean option on a table (proper set semantics, not toggle).
pub(in crate::storage::engine) fn set_table_bool_option(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    option: &str,
    value: bool,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let opt = match option {
        "bandedRows" => compute_table::types::TableBoolOption::BandedRows,
        "bandedColumns" => compute_table::types::TableBoolOption::BandedColumns,
        "emphasizeFirstColumn" => compute_table::types::TableBoolOption::EmphasizeFirstColumn,
        "emphasizeLastColumn" => compute_table::types::TableBoolOption::EmphasizeLastColumn,
        "showFilterButtons" => compute_table::types::TableBoolOption::ShowFilterButtons,
        _ => {
            return Err(ComputeError::Eval {
                message: format!("Unknown table option: {}", option),
            });
        }
    };

    let updated = compute_table::table::set_table_option(&table, opt, value);
    stores.compute.set_table(mirror, updated.clone());
    persist_table_to_yrs(stores, &updated);
    Ok(MutationResult::empty())
}

/// Set table auto-expansion policy.
pub(in crate::storage::engine) fn set_table_auto_expand(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    enabled: bool,
) -> Result<MutationResult, ComputeError> {
    let mut table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    if table.auto_expand == enabled {
        return Ok(MutationResult::empty());
    }

    table.auto_expand = enabled;
    stores.compute.set_table(mirror, table.clone());
    persist_table_to_yrs(stores, &table);
    Ok(MutationResult::empty())
}

/// Set table automatic calculated-column policy.
pub(in crate::storage::engine) fn set_table_auto_calculated_columns(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    enabled: bool,
) -> Result<MutationResult, ComputeError> {
    let mut table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    if table.auto_calculated_columns == enabled {
        return Ok(MutationResult::empty());
    }

    table.auto_calculated_columns = enabled;
    stores.compute.set_table(mirror, table.clone());
    persist_table_to_yrs(stores, &table);
    Ok(MutationResult::empty())
}

/// Add a data row to a table at the given relative position.
pub(in crate::storage::engine) fn add_table_data_row(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    relative_row: Option<u32>,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let result = compute_table::operations::add_data_row(&table, relative_row);
    stores.compute.set_table(mirror, result.table.clone());
    persist_table_to_yrs(stores, &result.table);

    // Return both the insert row and whether the caller needs to expand
    // the table range post-structural-change (see add_data_row docs).
    let data = serde_json::json!({
        "insertRow": result.insert_row,
        "needsRangeExpand": result.needs_range_expand,
    });
    Ok(MutationResult::empty().with_data(&data)?)
}

/// Remove a data row from a table by relative index.
pub(in crate::storage::engine) fn remove_table_data_row(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    table_name: &str,
    relative_row: u32,
) -> Result<MutationResult, ComputeError> {
    let table = mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let result =
        compute_table::operations::remove_data_row(&table, relative_row).ok_or_else(|| {
            ComputeError::Eval {
                message: format!(
                    "Cannot remove row {} from table {}: out of bounds or would leave 0 data rows",
                    relative_row, table_name
                ),
            }
        })?;
    stores.compute.set_table(mirror, result.table.clone());
    persist_table_to_yrs(stores, &result.table);
    Ok(MutationResult::empty().with_data(&result.removed_row)?)
}

// -------------------------------------------------------------------
// Table Yrs Persistence
// -------------------------------------------------------------------

/// Persist a full table definition to the Yrs CRDT document.
///
/// Writes a `TableBinding` JSON string to `workbook.rangeBindings[table:<name>]`
/// (Range-backed format). Also ensures the `tables` sub-map exists so the
/// undo manager records a transaction entry even on first create.
///
/// Uses a single `ORIGIN_USER_EDIT` transaction so the change syncs to peers.
pub(in crate::storage::engine) fn persist_table_to_yrs(
    stores: &mut EngineStores,
    table: &CanonicalTable,
) {
    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    // Lazy-create the `tables` sub-map so the undo manager records a
    // transaction entry. See `crate::storage::ensure_workbook_child_map`
    // doc-comment for why this is the LWW-safe construction.
    let _tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    // Write TableBinding to rangeBindings (Range-backed format).
    let range_id = table_range_id(&table.name);
    if let Some(json) = domain_types::yrs_schema::table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(&workbook, &mut txn, &range_id, &json);
    }
}

/// Persist a table definition and its backing table filter in one Yrs transaction.
///
/// A table filter is not an independent user action; it is part of the table
/// model. Keeping both writes in one transaction preserves undo/redo semantics
/// and ensures peers observe a coherent table creation.
pub(in crate::storage::engine) fn persist_table_to_yrs_with_table_filter(
    stores: &mut EngineStores,
    table: &CanonicalTable,
    sheet_id: &SheetId,
    header_start_cell_id: &str,
    header_end_cell_id: &str,
    data_end_cell_id: &str,
) -> Result<filters::FilterState, ComputeError> {
    let workbook = stores.storage.workbook_map().clone();
    let sheets = stores.storage.sheets().clone();
    let doc = stores.storage.doc().clone();
    let mut txn = doc.transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    let _tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    let range_id = table_range_id(&table.name);
    if let Some(json) = domain_types::yrs_schema::table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(&workbook, &mut txn, &range_id, &json);
    }

    filters::create_filter_in_txn(
        &mut txn,
        &sheets,
        sheet_id,
        header_start_cell_id,
        header_end_cell_id,
        data_end_cell_id,
        filters::FilterKind::TableFilter,
        Some(table.id.clone()),
        &stores.id_alloc,
    )
}

/// Remove a table from the Yrs CRDT document.
///
/// Removes the `rangeBindings[table:<name>]` entry. Also ensures the
/// `tables` sub-map exists so the undo manager records a transaction
/// entry (important for create+delete groupings where the inner remove
/// is otherwise a no-op and the txn would carry no changes).
pub(in crate::storage::engine) fn remove_table_from_yrs(
    stores: &mut EngineStores,
    table_name: &str,
) {
    remove_table_from_yrs_with_filter(stores, table_name, None);
}

fn remove_table_from_yrs_with_filter(
    stores: &mut EngineStores,
    table_name: &str,
    table_filter: Option<&(SheetId, String)>,
) {
    let workbook = stores.storage.workbook_map().clone();
    let sheets = stores.storage.sheets().clone();
    let doc = stores.storage.doc().clone();
    let mut txn = doc.transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    // Ensure `tables` sub-map exists for undo manager tracking.
    let _tables_map = crate::storage::ensure_workbook_child_map(
        &workbook,
        &mut txn,
        compute_document::schema::KEY_TABLES,
    );

    // Clean up rangeBindings entry.
    let range_id = table_range_id(table_name);
    compute_document::range::remove_range_binding_wb(&workbook, &mut txn, &range_id);

    if let Some((sheet_id, filter_id)) = table_filter {
        filters::delete_filter_in_txn(&mut txn, &sheets, sheet_id, filter_id);
    }
}

/// Persist the current table style fields to the Yrs document.
///
/// Writes a `TableBinding` JSON string to `workbook.rangeBindings[table:<name>]`
/// in a single `ORIGIN_USER_EDIT` transaction.
pub(in crate::storage::engine) fn persist_table_style_to_yrs(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    table_name: &str,
) -> Result<(), ComputeError> {
    let table = &mirror
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let workbook = stores.storage.workbook_map().clone();
    let mut txn = stores
        .storage
        .doc()
        .transact_mut_with(Origin::from(compute_document::undo::ORIGIN_USER_EDIT));

    // Write updated binding to rangeBindings.
    let range_id = table_range_id(table_name);
    if let Some(json) = domain_types::yrs_schema::table::table_to_binding_json(table) {
        compute_document::range::write_range_binding_wb(&workbook, &mut txn, &range_id, &json);
    }

    Ok(())
}

/// Re-read ALL tables from Yrs and sync them into the mirror.
///
/// Primary read path: `rangeBindings[table:<name>]` entries (Range-backed
/// format). Range coordinates, table ID, and sheet ID are stored in the
/// binding JSON itself.
///
/// Fallback for XLSX-imported tables that were written through the legacy
/// `workbook.tables` path (which does not yet write to rangeBindings):
/// any table name present in `workbook.tables` but NOT in rangeBindings
/// is read via `from_yrs_map_to_table` (canonical Y.Map keys or OOXML
/// rangeRef fallback).
///
/// Called after undo/redo or remote changes so the mirror stays in sync.
pub(in crate::storage::engine) fn sync_tables_from_yrs(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
) {
    let (yrs_tables, yrs_names): (Vec<CanonicalTable>, std::collections::HashSet<String>) = {
        let txn = stores.storage.doc().transact();
        let mut tables = Vec::new();
        let mut names = std::collections::HashSet::new();

        // Tier 1: read tables from rangeBindings (primary path).
        let binding_entries =
            compute_document::range::all_range_bindings_wb(stores.storage.workbook_map(), &txn);
        for (range_id, json) in &binding_entries {
            if let Some(_tname) = table_name_from_range_id(range_id)
                && let Some(table) =
                    domain_types::yrs_schema::table::from_binding_json_standalone(json)
            {
                names.insert(table.name.clone());
                tables.push(table);
            }
        }

        // Fallback: read from workbook.tables for XLSX-imported tables
        // that haven't been migrated to rangeBindings yet.
        if let Some(Out::YMap(tables_map)) = stores
            .storage
            .workbook_map()
            .get(&txn, compute_document::schema::KEY_TABLES)
        {
            for (key, value) in tables_map.iter(&txn) {
                // Skip if already found in rangeBindings.
                if names.contains(key) {
                    continue;
                }
                if let Out::YMap(inner) = value
                    && let Some(table) =
                        domain_types::yrs_schema::table::from_yrs_map_to_table(&inner, &txn)
                {
                    names.insert(table.name.clone());
                    tables.push(table);
                }
            }
        }

        (tables, names)
    };

    // Update or create tables from Yrs
    for table in yrs_tables {
        stores.compute.set_table(mirror, table);
    }

    // Remove tables that exist in mirror but not in Yrs
    let mirror_names: Vec<String> = mirror.all_tables().iter().map(|t| t.name.clone()).collect();
    for name in mirror_names {
        if !yrs_names.contains(&name) {
            stores.compute.remove_table(mirror, &name);
        }
    }
}

// -------------------------------------------------------------------
// Range ID helpers
// -------------------------------------------------------------------

/// Derive a stable range_id key for a table name.
///
/// Convention: `"table:<name>"` — allows rangeBindings to distinguish
/// table bindings from future Range kinds (e.g., `"condformat:<id>"`).
pub(in crate::storage::engine) fn table_range_id(table_name: &str) -> String {
    format!("table:{}", table_name)
}

/// Extract the table name from a range_id, if it follows the `"table:<name>"` convention.
pub(in crate::storage::engine) fn table_name_from_range_id(range_id: &str) -> Option<&str> {
    range_id.strip_prefix("table:")
}

// =====================================================================
// Tests
// =====================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
    use crate::storage::engine::YrsComputeEngine;
    use crate::storage::engine::mutation::CellInput;
    use cell_types::SheetPos;
    use value_types::{CellValue, FiniteF64};

    fn simple_snapshot() -> WorkbookSnapshot {
        WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: "550e8400-e29b-41d4-a716-446655440000".to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
                cells: vec![CellData {
                    cell_id: "550e8400-e29b-41d4-a716-446655440001".to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(10.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        }
    }

    fn sheet_id() -> SheetId {
        SheetId::from_uuid_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    }

    fn set_people_data(engine: &mut YrsComputeEngine, sid: SheetId) {
        engine
            .batch_set_cells_by_position(
                vec![
                    (
                        sid,
                        0,
                        0,
                        CellInput::Parse {
                            text: "Name".into(),
                        },
                    ),
                    (
                        sid,
                        1,
                        0,
                        CellInput::Parse {
                            text: "Alice".into(),
                        },
                    ),
                    (sid, 0, 1, CellInput::Parse { text: "Age".into() }),
                    (sid, 1, 1, CellInput::Parse { text: "30".into() }),
                ],
                false,
            )
            .expect("set people data");
    }

    fn cell_value(
        engine: &YrsComputeEngine,
        sid: SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellValue> {
        engine
            .mirror()
            .get_cell_value_at(&sid, SheetPos::new(row, col))
            .cloned()
    }

    /// pass 1 regression: creating a table via the production
    /// `from_snapshot` engine path must push an entry onto the
    /// undo stack and a subsequent `undo()` must remove it.
    ///
    /// Pre-fix symptom: `persist_table_to_yrs` silently returns
    /// when `KEY_TABLES` sub-map doesn't exist; the txn drops with
    /// no changes, the undo manager has nothing to push, and
    /// `can_undo()` stays false.
    #[test]
    fn create_table_pushes_undo_entry() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        assert!(
            !engine.can_undo(),
            "fresh engine must have empty undo stack"
        );

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        assert!(
            engine.can_undo(),
            "create_table must push an undo entry — pre-fix this fails because \
             persist_table_to_yrs silently returned"
        );

        engine.undo().expect("undo");
        assert!(
            engine.get_all_tables_in_sheet(&sid).is_empty(),
            "undo must remove the table"
        );
    }

    #[test]
    fn create_table_persists_table_filter_in_rust() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        let (_, result) = engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        let sheet_filters = engine.get_filters_in_sheet(&sid);
        let table_filter = sheet_filters
            .iter()
            .find(|filter| filter.table_id.as_deref() == Some("T1"))
            .expect("table filter");
        assert_eq!(table_filter.filter_kind, filters::FilterKind::TableFilter);

        let change = result
            .filter_changes
            .iter()
            .find(|change| change.filter_id == table_filter.id)
            .expect("table filter creation receipt");
        assert_eq!(change.filter_kind.as_deref(), Some("tableFilter"));
        assert_eq!(change.action.as_deref(), Some("created"));

        engine.delete_table("T1").expect("delete_table");
        assert!(
            engine.get_filters_in_sheet(&sid).is_empty(),
            "deleting a table must remove its owned table filter"
        );
    }

    #[test]
    fn create_table_lifecycle_with_style_undo_redo_is_atomic() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        set_people_data(&mut engine, sid);
        let before_depth = engine.get_undo_state().undo_depth;

        engine
            .create_table_lifecycle(
                &sid,
                Some("StyledPeople".into()),
                0,
                0,
                1,
                1,
                vec![],
                true,
                Some("TableStyleMedium4".into()),
            )
            .expect("create lifecycle");

        assert_eq!(engine.get_undo_state().undo_depth, before_depth + 1);
        let table = engine
            .get_table_by_name("StyledPeople")
            .expect("styled table");
        assert_eq!(table.style, "TableStyleMedium4");
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .any(|filter| filter.table_id.as_deref() == Some("StyledPeople")),
            "table filter should be created with the table"
        );

        engine.undo().expect("undo lifecycle");
        assert_eq!(engine.get_undo_state().undo_depth, before_depth);
        assert!(engine.get_table_by_name("StyledPeople").is_none());
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .all(|filter| filter.table_id.as_deref() != Some("StyledPeople")),
            "one undo should remove the table-owned filter"
        );

        engine.redo().expect("redo lifecycle");
        let redone = engine
            .get_table_by_name("StyledPeople")
            .expect("redone table");
        assert_eq!(redone.style, "TableStyleMedium4");
        assert!(
            engine
                .get_filters_in_sheet(&sid)
                .iter()
                .any(|filter| filter.table_id.as_deref() == Some("StyledPeople")),
            "redo should restore the table-owned filter"
        );
    }

    #[test]
    fn create_table_lifecycle_without_headers_undo_redo_is_atomic() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();
        set_people_data(&mut engine, sid);
        let before_depth = engine.get_undo_state().undo_depth;

        engine
            .create_table_lifecycle(
                &sid,
                Some("GeneratedHeaders".into()),
                0,
                0,
                1,
                1,
                vec![],
                false,
                None,
            )
            .expect("create no-header lifecycle");

        assert_eq!(engine.get_undo_state().undo_depth, before_depth + 1);
        assert_eq!(
            cell_value(&engine, sid, 0, 0),
            Some(CellValue::Text("Column1".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 0),
            Some(CellValue::Text("Name".into()))
        );
        assert!(engine.get_table_by_name("GeneratedHeaders").is_some());

        engine.undo().expect("undo no-header lifecycle");
        assert_eq!(engine.get_undo_state().undo_depth, before_depth);
        assert!(engine.get_table_by_name("GeneratedHeaders").is_none());
        assert_eq!(
            cell_value(&engine, sid, 0, 0),
            Some(CellValue::Text("Name".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 0),
            Some(CellValue::Text("Alice".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 1),
            Some(CellValue::Number(FiniteF64::must(30.0)))
        );

        engine.redo().expect("redo no-header lifecycle");
        assert_eq!(
            cell_value(&engine, sid, 0, 0),
            Some(CellValue::Text("Column1".into()))
        );
        assert_eq!(
            cell_value(&engine, sid, 1, 0),
            Some(CellValue::Text("Name".into()))
        );
        assert!(engine.get_table_by_name("GeneratedHeaders").is_some());
    }

    /// pass 1 regression (Edit A behavioural pin): removing a
    /// non-existent table must not panic. After the fix, the call
    /// lazily creates an empty `tables` sub-map (which itself is an
    /// undoable txn entry) and the table-name removal is a no-op.
    #[test]
    fn remove_table_from_yrs_on_missing_table_does_not_panic() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        // Deliberately call into the service helper at a place where
        // the table doesn't exist. delete_table on a missing name is
        // an Err at the service layer; we drive the persist site
        // directly via a private helper test.
        //
        // Use the private helper: route through `remove_table_from_yrs`
        // by exposing it via the same module. The cleanest call shape
        // from the test is via `delete_table` for a name that exists,
        // but here we want the *missing-table* path. The bridge call
        // returns Err for missing name; we instead invoke the persist
        // site directly so we exercise the lazy-create branch.
        {
            // Reach into stores via crate-private access; the test
            // module lives inside the crate.
            remove_table_from_yrs(&mut engine.stores, "DoesNotExist");
        }

        // (a) no panic: reaching this line is the proof.
        // (b) mirror still has zero tables.
        assert!(
            engine.get_all_tables_in_sheet(&sid).is_empty(),
            "mirror should still be empty after removing a non-existent table"
        );

        // (c) yrs `tables` sub-map exists and is empty.
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let tables_map = match workbook.get(&txn, compute_document::schema::KEY_TABLES) {
            Some(Out::YMap(m)) => m,
            _ => panic!("tables sub-map must exist after lazy-create"),
        };
        assert_eq!(
            tables_map.len(&txn),
            0,
            "tables sub-map must be empty (we only created the container, never inserted a table)"
        );
    }

    // ================================================================
    // Phase 5E tests — Range-backed table bindings
    // ================================================================

    /// Creating a table writes a TableBinding to rangeBindings.
    #[test]
    fn create_table_writes_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "Sales".into(),
                0,
                0,
                5,
                2,
                vec!["Name".into(), "Amount".into(), "Date".into()],
                true,
            )
            .expect("create_table");

        // Verify rangeBindings entry exists
        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:Sales");
        assert!(
            json.is_some(),
            "rangeBindings[table:Sales] must exist after create_table"
        );

        // Verify the binding deserializes correctly
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json.unwrap()).expect("deserialize TableBinding");
        assert_eq!(binding.name, "Sales");
        assert_eq!(binding.columns.len(), 3);
        assert_eq!(binding.columns[0].name, "Name");
        assert_eq!(binding.columns[1].name, "Amount");
        assert_eq!(binding.columns[2].name, "Date");
        assert!(binding.has_header_row);
        assert!(!binding.has_totals_row);
    }

    /// Deleting a table removes its rangeBindings entry.
    #[test]
    fn delete_table_removes_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine.delete_table("T1").expect("delete_table");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1");
        assert!(
            json.is_none(),
            "rangeBindings[table:T1] must be removed after delete_table"
        );
    }

    /// Renaming a table updates the rangeBindings entry (old key removed, new key added).
    #[test]
    fn rename_table_updates_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "OldName".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine
            .rename_table("OldName", "NewName")
            .expect("rename_table");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();

        assert!(
            compute_document::range::read_range_binding_wb(&workbook, &txn, "table:OldName")
                .is_none(),
            "old binding key must be removed"
        );
        let new_json =
            compute_document::range::read_range_binding_wb(&workbook, &txn, "table:NewName");
        assert!(new_json.is_some(), "new binding key must exist");

        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&new_json.unwrap()).unwrap();
        assert_eq!(binding.name, "NewName");
    }

    /// Resizing a table updates the rangeBindings (columns may change).
    #[test]
    fn resize_table_updates_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        // Expand columns
        engine.resize_table("T1", 0, 0, 3, 2).expect("resize_table");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert_eq!(
            binding.columns.len(),
            3,
            "expanding to 3 columns must add a column definition"
        );
    }

    /// Toggling totals row updates the rangeBindings.
    #[test]
    fn toggle_totals_updates_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine.toggle_totals_row("T1").expect("toggle_totals");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert!(
            binding.has_totals_row,
            "totals row must be true after toggle"
        );
    }

    /// Renaming a column updates the rangeBindings.
    #[test]
    fn rename_column_updates_range_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine
            .rename_table_column("T1", 0, "Alpha")
            .expect("rename_column");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert_eq!(
            binding.columns[0].name, "Alpha",
            "column name must be updated in binding"
        );
    }

    /// Three-tier read: sync_tables_from_yrs uses rangeBindings (Tier 1) when available.
    #[test]
    fn sync_tables_uses_range_binding_tier1() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["Col1".into(), "Col2".into()],
                true,
            )
            .expect("create_table");

        // Verify the table is in the mirror
        assert_eq!(engine.get_all_tables_in_sheet(&sid).len(), 1);

        // Simulate undo + redo to trigger sync_tables_from_yrs
        engine.undo().expect("undo");
        assert!(
            engine.get_all_tables_in_sheet(&sid).is_empty(),
            "table must be gone after undo"
        );

        engine.redo().expect("redo");
        let tables = engine.get_all_tables_in_sheet(&sid);
        assert_eq!(tables.len(), 1, "table must be back after redo");
        assert_eq!(tables[0].name, "T1");
        assert_eq!(tables[0].columns.len(), 2);
        assert_eq!(tables[0].columns[0].name, "Col1");
    }

    /// TableBinding roundtrip: from_table -> to_table preserves all fields.
    #[test]
    fn table_binding_roundtrip() {
        use domain_types::domain::table::{TableBinding, TotalsFunction};

        let original = CanonicalTable {
            id: "42".to_string(),
            name: "Inventory".to_string(),
            display_name: "InventoryDisplay".to_string(),
            sheet_id: "sheet-1".to_string(),
            range: cell_types::SheetRange::new(2, 1, 10, 4),
            columns: vec![
                TableColumn {
                    id: "1".into(),
                    name: "Item".into(),
                    index: 0,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
                TableColumn {
                    id: "2".into(),
                    name: "Qty".into(),
                    index: 1,
                    totals_function: Some(TotalsFunction::Sum),
                    totals_label: Some("Total".into()),
                    calculated_formula: None,
                },
                TableColumn {
                    id: "3".into(),
                    name: "Price".into(),
                    index: 2,
                    totals_function: Some(TotalsFunction::Average),
                    totals_label: None,
                    calculated_formula: Some("=[Qty]*[Price]".into()),
                },
                TableColumn {
                    id: "4".into(),
                    name: "Total".into(),
                    index: 3,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
            ],
            has_header_row: true,
            has_totals_row: true,
            style: "TableStyleDark5".to_string(),
            banded_rows: false,
            banded_columns: true,
            emphasize_first_column: true,
            emphasize_last_column: false,
            show_filter_buttons: false,
            auto_expand: false,
            auto_calculated_columns: false,
        };

        let binding = TableBinding::from_table(&original);
        let reconstructed = binding.to_table(&original.id, &original.sheet_id, original.range);

        assert_eq!(reconstructed.name, original.name);
        assert_eq!(reconstructed.display_name, original.display_name);
        assert_eq!(reconstructed.sheet_id, original.sheet_id);
        assert_eq!(reconstructed.range, original.range);
        assert_eq!(reconstructed.has_header_row, original.has_header_row);
        assert_eq!(reconstructed.has_totals_row, original.has_totals_row);
        assert_eq!(reconstructed.style, original.style);
        assert_eq!(reconstructed.banded_rows, original.banded_rows);
        assert_eq!(reconstructed.banded_columns, original.banded_columns);
        assert_eq!(
            reconstructed.emphasize_first_column,
            original.emphasize_first_column
        );
        assert_eq!(
            reconstructed.emphasize_last_column,
            original.emphasize_last_column
        );
        assert_eq!(
            reconstructed.show_filter_buttons,
            original.show_filter_buttons
        );
        assert_eq!(reconstructed.auto_expand, original.auto_expand);
        assert_eq!(
            reconstructed.auto_calculated_columns,
            original.auto_calculated_columns
        );
        assert_eq!(reconstructed.columns.len(), original.columns.len());
        for (i, (orig, recon)) in original
            .columns
            .iter()
            .zip(reconstructed.columns.iter())
            .enumerate()
        {
            assert_eq!(recon.name, orig.name, "column {} name mismatch", i);
            assert_eq!(recon.index, orig.index, "column {} index mismatch", i);
            assert_eq!(
                recon.totals_function, orig.totals_function,
                "column {} totals_function mismatch",
                i
            );
            assert_eq!(
                recon.totals_label, orig.totals_label,
                "column {} totals_label mismatch",
                i
            );
            assert_eq!(
                recon.calculated_formula, orig.calculated_formula,
                "column {} calculated_formula mismatch",
                i
            );
        }
    }

    /// TableBinding JSON roundtrip via serde.
    #[test]
    fn table_binding_json_roundtrip() {
        use domain_types::domain::table::TableBinding;

        let table = CanonicalTable {
            id: "1".to_string(),
            name: "T1".to_string(),
            display_name: "T1".to_string(),
            sheet_id: "s1".to_string(),
            range: cell_types::SheetRange::new(0, 0, 5, 2),
            columns: vec![
                TableColumn {
                    id: "1".into(),
                    name: "A".into(),
                    index: 0,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
                TableColumn {
                    id: "2".into(),
                    name: "B".into(),
                    index: 1,
                    totals_function: None,
                    totals_label: None,
                    calculated_formula: None,
                },
            ],
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: false,
            auto_calculated_columns: false,
        };

        let json = domain_types::yrs_schema::table::table_to_binding_json(&table)
            .expect("serialize to JSON");
        let reconstructed =
            domain_types::yrs_schema::table::from_binding_to_table(&json, "1", "s1", table.range)
                .expect("reconstruct from JSON");

        assert_eq!(reconstructed.name, table.name);
        assert_eq!(reconstructed.columns.len(), table.columns.len());
        assert_eq!(reconstructed.columns[0].name, "A");
        assert_eq!(reconstructed.columns[1].name, "B");
        assert!(!reconstructed.auto_expand);
        assert!(!reconstructed.auto_calculated_columns);
    }

    /// table_range_id and table_name_from_range_id are inverse operations.
    #[test]
    fn range_id_round_trip() {
        let name = "MyTable";
        let rid = table_range_id(name);
        assert_eq!(rid, "table:MyTable");
        assert_eq!(table_name_from_range_id(&rid), Some("MyTable"));
        assert_eq!(table_name_from_range_id("other:stuff"), None);
    }

    /// Mirror maintains table_range_ids index.
    #[test]
    fn mirror_table_range_id_index() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                2,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        // Check index via mirror
        assert_eq!(engine.mirror().table_range_id("T1"), Some("table:T1"),);
        // Case-insensitive
        assert_eq!(engine.mirror().table_range_id("t1"), Some("table:T1"),);

        // Delete should clean up index
        engine.delete_table("T1").expect("delete_table");
        assert_eq!(engine.mirror().table_range_id("T1"), None);
    }

    /// Single-row table (header only, no data rows) binding roundtrip.
    #[test]
    fn single_row_table_binding() {
        use domain_types::domain::table::TableBinding;

        let table = CanonicalTable {
            id: "1".to_string(),
            name: "Tiny".to_string(),
            display_name: "Tiny".to_string(),
            sheet_id: "s1".to_string(),
            range: cell_types::SheetRange::new(0, 0, 0, 0),
            columns: vec![TableColumn {
                id: "1".into(),
                name: "Only".into(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }],
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
        };

        let binding = TableBinding::from_table(&table);
        let reconstructed = binding.to_table(&table.id, &table.sheet_id, table.range);
        assert_eq!(reconstructed.columns.len(), 1);
        assert_eq!(reconstructed.columns[0].name, "Only");
        assert_eq!(reconstructed.range, cell_types::SheetRange::new(0, 0, 0, 0));
    }

    /// Single-column table binding roundtrip.
    #[test]
    fn single_column_table_binding() {
        use domain_types::domain::table::TableBinding;

        let table = CanonicalTable {
            id: "1".to_string(),
            name: "SingleCol".to_string(),
            display_name: "SingleCol".to_string(),
            sheet_id: "s1".to_string(),
            range: cell_types::SheetRange::new(0, 0, 10, 0),
            columns: vec![TableColumn {
                id: "1".into(),
                name: "Data".into(),
                index: 0,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
            }],
            has_header_row: true,
            has_totals_row: false,
            style: "TableStyleMedium2".to_string(),
            banded_rows: true,
            banded_columns: false,
            emphasize_first_column: false,
            emphasize_last_column: false,
            show_filter_buttons: true,
            auto_expand: true,
            auto_calculated_columns: true,
        };

        let binding = TableBinding::from_table(&table);
        assert_eq!(binding.columns.len(), 1);
        let json = serde_json::to_string(&binding).unwrap();
        let deserialized: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.columns[0].name, "Data");
    }

    /// Convert table to range also cleans up binding.
    #[test]
    fn convert_to_range_cleans_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine
            .convert_table_to_range("T1")
            .expect("convert_to_range");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        assert!(
            compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1").is_none(),
            "binding must be cleaned up after convert_to_range"
        );
    }

    /// Style info persists through binding.
    #[test]
    fn style_info_persists_in_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        // Change style options
        engine
            .set_table_bool_option("T1", "bandedColumns", true)
            .expect("set banded columns");
        engine
            .set_table_bool_option("T1", "bandedRows", false)
            .expect("set banded rows");

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        let style = binding.style.expect("style must be present");
        assert!(!style.banded_rows, "banded_rows should be false");
        assert!(style.banded_columns, "banded_columns should be true");
    }

    #[test]
    fn table_policy_updates_persist_in_binding() {
        let (mut engine, _) = YrsComputeEngine::from_snapshot(simple_snapshot()).unwrap();
        let sid = sheet_id();

        engine
            .create_table(
                &sid,
                "T1".into(),
                0,
                0,
                3,
                1,
                vec!["A".into(), "B".into()],
                true,
            )
            .expect("create_table");

        engine
            .set_table_auto_expand("T1", false)
            .expect("set auto expand policy");
        engine
            .set_table_auto_calculated_columns("T1", false)
            .expect("set calculated columns policy");

        let table = engine.get_table_by_name("T1").expect("table must exist");
        assert!(!table.auto_expand);
        assert!(!table.auto_calculated_columns);

        let workbook = engine.stores.storage.workbook_map().clone();
        let doc = engine.stores.storage.doc().clone();
        let txn = doc.transact();
        let json = compute_document::range::read_range_binding_wb(&workbook, &txn, "table:T1")
            .expect("binding must exist");
        let binding: domain_types::domain::table::TableBinding =
            serde_json::from_str(&json).unwrap();
        assert!(!binding.auto_expand);
        assert!(!binding.auto_calculated_columns);
    }
}
