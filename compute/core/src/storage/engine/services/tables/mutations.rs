#![allow(unused_imports, unused_variables)]
use super::*;
use crate::storage::engine::history::metadata::capture_workbook_entry;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::table_result_merge::merge_mutation_result;

// -------------------------------------------------------------------
// Table CRUD Mutations
// -------------------------------------------------------------------

/// Create a new table from parameters and register it in the compute cell_store.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn create_table(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
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
    compute_table::table::validate_table_name(&name).map_err(|err| ComputeError::Eval {
        message: err.to_string(),
    })?;
    if cell_store
        .all_tables()
        .iter()
        .any(|table| table.name.eq_ignore_ascii_case(&name))
    {
        return Err(ComputeError::Eval {
            message: format!("Table name \"{}\" already exists", name),
        });
    }
    let style = super::normalize_table_style_id(stores, style)?;

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
                    // Read header cell value from the cell store
                    cell_store
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
        id: next_table_id(stores),
        name: name.clone(),
        display_name: name.clone(),
        sheet_id: sheet_id.to_uuid_string(),
        range: cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
        columns: effective_columns
            .iter()
            .enumerate()
            .map(|(i, col_name)| TableColumn {
                id: next_table_column_id(stores),
                name: col_name.clone(),
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
            })
            .collect(),
        has_header_row: has_headers,
        has_totals_row: false,
        style,
        banded_rows: true,
        banded_columns: false,
        emphasize_first_column: false,
        emphasize_last_column: false,
        show_filter_buttons: true,
        auto_expand: true,
        auto_calculated_columns: true,
        ..CanonicalTable::default()
    };
    let (header_start_id, header_end_id, data_end_id) = {
        let mut ensure = |row, col| {
            super::super::cell_editing::ensure_cell_id(stores, cell_store, sheet_id, row, col)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })
        };
        (
            ensure(start_row, start_col)?,
            ensure(start_row, end_col)?,
            ensure(end_row, end_col)?,
        )
    };

    let header_start = id_to_hex(header_start_id.as_u128()).to_string();
    let header_end = id_to_hex(header_end_id.as_u128()).to_string();
    let data_end = id_to_hex(data_end_id.as_u128()).to_string();

    stores.compute.set_table(cell_store, table.clone());
    let filter_state = create_table_filter(
        stores,
        &table,
        sheet_id,
        &header_start,
        &header_end,
        &data_end,
    )?;

    // Re-parse formulas containing implicit structured refs now that the table exists.
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    let recalc_result = stores.compute.reparse_implicit_structured_refs(
        cell_store, sheet_id, start_row, start_col, end_row, end_col,
    );

    let mut result = MutationResult::empty();
    result.recalc = recalc_result;
    result.filter_changes.push(FilterChange {
        sheet_id: sheet_id.to_uuid_string(),
        filter_id: filter_state.id,
        filter_kind: Some("tableFilter".to_string()),
        table_id: filter_state.table_id.clone(),
        capability: None,
        unsupported_reasons: Vec::new(),
        has_active_filter: Some(!filter_state.column_filters.is_empty()),
        clearable: Some(true),
        diagnostics: Vec::new(),
        action: Some("created".to_string()),
        hidden_row_count: None,
        visible_row_count: None,
        kind: ChangeKind::Set,
    });
    result.table_changes.push(TableChange {
        name: table.name.clone(),
        table_id: Some(table.id),
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
    });
    Ok(result)
}

/// Delete a table by name.
pub(in crate::storage::engine) fn delete_table(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store.get_table(table_name).cloned();
    let table_filter = table.as_ref().and_then(|table| {
        let sheet_id = SheetId::from_uuid_str(&table.sheet_id).ok()?;
        filters::get_table_filter(&stores.storage, &sheet_id, &table.id)
            .map(|filter| (sheet_id, filter.id))
    });
    let prepared_filter_delete = table_filter
        .as_ref()
        .map(|(sheet_id, filter_id)| prepare_table_filter_delete(stores, sheet_id, filter_id));

    stores.compute.remove_table(cell_store, table_name);
    rewrite_table_formulas(
        stores,
        cell_store,
        TableReferenceEdit::DeleteTable { table: table_name },
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    let mut result = MutationResult::from_recalc(
        stores
            .compute
            .structure_change_with_formula_refresh(cell_store, None, &[])?,
    );
    let visibility_transitions = if let Some(table) = table {
        let visibility_transitions = remove_table_filter(stores, table_filter.as_ref());
        result.table_changes.push(TableChange {
            name: table.name.clone(),
            table_id: Some(table.id),
            sheet_id: table.sheet_id,
            kind: ChangeKind::Removed,
        });
        visibility_transitions
    } else {
        remove_table_filter(stores, table_filter.as_ref())
    };
    if let (Some((sheet_id, _)), Some(prepared_filter_delete)) =
        (table_filter.as_ref(), prepared_filter_delete)
    {
        let filter_result = finish_prepared_table_filter_delete(
            stores,
            cell_store,
            sheet_id,
            prepared_filter_delete,
            &visibility_transitions,
        );
        merge_mutation_result(&mut result, filter_result);
    }
    Ok(result)
}

/// Rename a table.
pub(in crate::storage::engine) fn rename_table(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    old_name: &str,
    new_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
        .get_table(old_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", old_name),
        })?;
    let other_tables: Vec<CanonicalTable> = cell_store
        .all_tables()
        .iter()
        .filter(|table| table.name != old_name)
        .cloned()
        .collect();
    let renamed =
        compute_table::operations::rename_table_validated(&table, new_name, &other_tables)
            .map_err(|err| ComputeError::Eval {
                message: err.to_string(),
            })?;

    stores.compute.remove_table(cell_store, old_name);
    stores.compute.set_table(cell_store, renamed.clone());

    rewrite_table_formulas(
        stores,
        cell_store,
        TableReferenceEdit::RenameTable {
            old: old_name,
            new: new_name,
        },
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    Ok(MutationResult::from_recalc(
        stores
            .compute
            .structure_change_with_formula_refresh(cell_store, None, &[])?,
    ))
}

/// Resize a table's range.
pub(in crate::storage::engine) fn resize_table(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    new_start_row: u32,
    new_start_col: u32,
    new_end_row: u32,
    new_end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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
            cell_store
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
            id: next_table_column_id(stores),
            name: col_name,
            index: i as u32,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
            ..Default::default()
        });
    }
    // If columns contracted, remove excess.
    resized.columns.truncate(new_col_count);

    stores.compute.set_table(cell_store, resized.clone());

    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    // Re-parse formulas with implicit structured refs in the new range.
    let _ = stores.compute.reparse_implicit_structured_refs(
        cell_store,
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
    cell_store: &mut CellStore,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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
    stores.compute.set_table(cell_store, updated.clone());
    Ok(MutationResult::empty())
}

/// Toggle the header row on/off for a table.
pub(in crate::storage::engine) fn toggle_header_row(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    updated.has_header_row = !updated.has_header_row;
    stores.compute.set_table(cell_store, updated.clone());
    Ok(MutationResult::empty())
}

/// Add a column to a table at the given position.
pub(in crate::storage::engine) fn add_table_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    column_name: &str,
    position: u32,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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
            id: next_table_column_id(stores),
            name: column_name.to_string(),
            index: pos as u32,
            totals_function: None,
            totals_label: None,
            calculated_formula: None,
            ..Default::default()
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

    let mut result = if updated.has_header_row {
        let sheet_id =
            SheetId::from_uuid_str(&updated.sheet_id).map_err(|_| ComputeError::Eval {
                message: format!("Invalid sheet ID in table: {}", table_name),
            })?;
        let row = updated.range.start_row();
        let col = updated.range.start_col() + pos as u32;
        let cell_id =
            super::super::cell_editing::ensure_cell_id(stores, cell_store, &sheet_id, row, col)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;
        let input = CellInput::Literal {
            text: column_name.to_string(),
        };
        let recalc = super::super::cell_editing::set_cell(
            stores, cell_store, &sheet_id, cell_id, row, col, &input,
        )?;
        MutationResult::from_recalc(recalc)
    } else {
        MutationResult::empty()
    };

    stores.compute.set_table(cell_store, updated.clone());
    result.table_changes.push(TableChange {
        name: updated.name,
        table_id: Some(updated.id),
        sheet_id: updated.sheet_id,
        kind: ChangeKind::Set,
    });
    Ok(result)
}

/// Rename a column in a table.
pub(in crate::storage::engine) fn rename_table_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    column_index: u32,
    new_column_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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

    let updated =
        compute_table::operations::rename_table_column_by_index(&table, idx, new_column_name)
            .map_err(|err| ComputeError::Eval {
                message: err.to_string(),
            })?;

    let mut result = if updated.has_header_row {
        let sheet_id =
            SheetId::from_uuid_str(&updated.sheet_id).map_err(|_| ComputeError::Eval {
                message: format!("Invalid sheet ID in table: {}", table_name),
            })?;
        let row = updated.range.start_row();
        let col = updated.range.start_col() + column_index;
        let cell_id =
            super::super::cell_editing::ensure_cell_id(stores, cell_store, &sheet_id, row, col)
                .ok_or_else(|| ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                })?;
        let input = CellInput::Literal {
            text: new_column_name.to_string(),
        };
        let recalc = super::super::cell_editing::set_cell(
            stores, cell_store, &sheet_id, cell_id, row, col, &input,
        )?;
        MutationResult::from_recalc(recalc)
    } else {
        MutationResult::empty()
    };

    stores.compute.set_table(cell_store, updated.clone());

    rewrite_table_formulas(
        stores,
        cell_store,
        TableReferenceEdit::RenameColumn {
            table: table_name,
            old: &old_column_name,
            new: new_column_name,
        },
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    let formula_recalc =
        stores
            .compute
            .structure_change_with_formula_refresh(cell_store, None, &[])?;
    merge_mutation_result(&mut result, MutationResult::from_recalc(formula_recalc));

    result.table_changes.push(TableChange {
        name: updated.name,
        table_id: Some(updated.id),
        sheet_id: updated.sheet_id,
        kind: ChangeKind::Set,
    });

    Ok(result)
}

/// Remove a column from a table by index.
pub(in crate::storage::engine) fn remove_table_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    column_index: u32,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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
    stores.compute.set_table(cell_store, updated.clone());

    rewrite_table_formulas(
        stores,
        cell_store,
        TableReferenceEdit::DeleteColumn {
            table: table_name,
            column: &deleted_col_name,
        },
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    Ok(MutationResult::from_recalc(
        stores
            .compute
            .structure_change_with_formula_refresh(cell_store, None, &[])?,
    ))
}

/// Add a calculated column to a table.
pub(in crate::storage::engine) fn add_calculated_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    column_name: &str,
    formula: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;
    let mut updated = table;
    let next_index = updated.columns.len() as u32;
    updated.columns.push(TableColumn {
        id: next_table_column_id(stores),
        name: column_name.to_string(),
        index: next_index,
        totals_function: None,
        totals_label: None,
        calculated_formula: Some(formula.to_string()),
        ..Default::default()
    });
    updated.range = cell_types::SheetRange::new(
        updated.range.start_row(),
        updated.range.start_col(),
        updated.range.end_row(),
        updated.range.end_col().saturating_add(1),
    );
    stores.compute.set_table(cell_store, updated.clone());
    Ok(MutationResult::empty())
}

/// Remove a calculated column from a table by column index.
pub(in crate::storage::engine) fn remove_calculated_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    column_index: u32,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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
    stores.compute.set_table(cell_store, updated.clone());
    Ok(MutationResult::empty())
}

/// Update the formula for a calculated column.
pub(in crate::storage::engine) fn update_calculated_column(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
    column_index: u32,
    formula: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
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
    stores.compute.set_table(cell_store, updated.clone());
    Ok(MutationResult::empty())
}

/// Apply auto-expansion to a table.
pub(in crate::storage::engine) fn apply_auto_expansion(
    cell_store: &CellStore,
    sheet_id: &SheetId,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let sheet_hex = sheet_id.to_uuid_string();
    let _table = &cell_store
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
    capture_workbook_entry!(stores.storage, custom_table_styles, style_name);
    stores
        .storage
        .metadata
        .custom_table_styles
        .insert(style_name.clone(), style.clone());
    let mut result = MutationResult::empty();
    result.table_changes.push(TableChange {
        name: style_name.clone(),
        table_id: None,
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
    capture_workbook_entry!(stores.storage, custom_table_styles, style_name);
    stores
        .storage
        .metadata
        .custom_table_styles
        .remove(style_name);
    Ok(MutationResult::empty())
}

/// Update a custom table style.
pub(in crate::storage::engine) fn update_custom_table_style(
    stores: &mut EngineStores,
    style_name: &str,
    style: compute_table::custom_styles::CustomTableStyleConfig,
) -> Result<MutationResult, ComputeError> {
    capture_workbook_entry!(stores.storage, custom_table_styles, style_name);
    stores
        .storage
        .metadata
        .custom_table_styles
        .insert(style_name.to_string(), style.clone());
    Ok(MutationResult::empty())
}

/// Set a table definition from a `TableDef`.
pub(in crate::storage::engine) fn set_table_def(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table: TableDef,
) {
    let existing = cell_store.get_table(&table.name).cloned();
    let table_id = existing
        .as_ref()
        .map(|table| table.id.clone())
        .unwrap_or_else(|| next_table_id(stores));
    let canonical = CanonicalTable {
        id: table_id,
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
                id: existing
                    .as_ref()
                    .and_then(|table| table.columns.get(i).map(|column| column.id.clone()))
                    .unwrap_or_else(|| next_table_column_id(stores)),
                name: name.clone(),
                index: i as u32,
                totals_function: None,
                totals_label: None,
                calculated_formula: None,
                ..Default::default()
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
        ..CanonicalTable::default()
    };
    stores.compute.set_table(cell_store, canonical);
}

/// Remove a table by name.
pub(in crate::storage::engine) fn remove_table_def(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    name: &str,
) {
    stores.compute.remove_table(cell_store, name);
    rewrite_table_formulas(
        stores,
        cell_store,
        TableReferenceEdit::DeleteTable { table: name },
    );
}

/// Convert a table to a plain range.
pub(in crate::storage::engine) fn convert_table_to_range(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    table_name: &str,
) -> Result<MutationResult, ComputeError> {
    let table = cell_store
        .get_table(table_name)
        .cloned()
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Table not found: {}", table_name),
        })?;

    let sheet_id_str = table.sheet_id.clone();
    let table_filter = SheetId::from_uuid_str(&table.sheet_id)
        .ok()
        .and_then(|sheet_id| {
            filters::get_table_filter(&stores.storage, &sheet_id, &table.id)
                .map(|filter| (sheet_id, filter.id))
        });
    let prepared_filter_delete = table_filter
        .as_ref()
        .map(|(sheet_id, filter_id)| prepare_table_filter_delete(stores, sheet_id, filter_id));

    let table_def = crate::storage::table_format::table_to_table_def(&table);
    let sheet_name = SheetId::from_uuid_str(&table.sheet_id)
        .ok()
        .and_then(|id| cell_store.get_sheet(&id).map(|sheet| sheet.name.clone()))
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: table.sheet_id.clone(),
        })?;
    let mut result = materialize_table_visible_formats(stores, cell_store, &table)?;
    stores.compute.remove_table(cell_store, table_name);
    let converted_count = rewrite_table_formulas(
        stores,
        cell_store,
        TableReferenceEdit::ConvertToRange {
            table: &table_def,
            sheet_name: &sheet_name,
        },
    );
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    merge_mutation_result(
        &mut result,
        MutationResult::from_recalc(stores.compute.structure_change_with_formula_refresh(
            cell_store,
            None,
            &[],
        )?),
    );
    let visibility_transitions = remove_table_filter(stores, table_filter.as_ref());
    if let (Some((sheet_id, _)), Some(prepared_filter_delete)) =
        (table_filter.as_ref(), prepared_filter_delete)
    {
        let filter_result = finish_prepared_table_filter_delete(
            stores,
            cell_store,
            sheet_id,
            prepared_filter_delete,
            &visibility_transitions,
        );
        merge_mutation_result(&mut result, filter_result);
    }

    result.table_changes.push(TableChange {
        name: table_name.to_string(),
        table_id: Some(table.id),
        sheet_id: sheet_id_str,
        kind: ChangeKind::Removed,
    });
    Ok(result.with_data(&converted_count)?)
}
