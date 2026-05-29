#![allow(unused_imports, unused_variables)]
use super::*;

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
    compute_table::table::validate_table_name(&name).map_err(|err| ComputeError::Eval {
        message: err.to_string(),
    })?;
    if mirror
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
        style,
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
    result.table_changes.push(TableChange {
        name: table.name,
        sheet_id: sheet_id.to_uuid_string(),
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
    let other_tables: Vec<CanonicalTable> = mirror
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

    stores.compute.remove_table(mirror, old_name);
    remove_table_from_yrs(stores, old_name);
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
    stores
        .custom_table_styles
        .insert(style_name.clone(), style.clone());
    persist_custom_table_style(stores, &style_name, &style)?;
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
    remove_custom_table_style(stores, style_name);
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
        .insert(style_name.to_string(), style.clone());
    persist_custom_table_style(stores, style_name, &style)?;
    Ok(MutationResult::empty())
}

fn persist_custom_table_style(
    stores: &mut EngineStores,
    style_name: &str,
    style: &compute_table::custom_styles::CustomTableStyleConfig,
) -> Result<(), ComputeError> {
    let json = serde_json::to_string(style).map_err(|e| ComputeError::Eval {
        message: format!("Failed to serialize table style: {}", e),
    })?;
    let doc = stores.storage.doc();
    let workbook = stores.storage.workbook_map();
    let mut txn =
        doc.transact_mut_with(yrs::Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
    let styles_map = crate::storage::ensure_workbook_child_map(
        workbook,
        &mut txn,
        compute_document::schema::KEY_CUSTOM_TABLE_STYLES,
    );
    styles_map.insert(
        &mut txn,
        style_name,
        yrs::Any::String(std::sync::Arc::from(json.as_str())),
    );
    Ok(())
}

fn remove_custom_table_style(stores: &mut EngineStores, style_name: &str) {
    let doc = stores.storage.doc();
    let workbook = stores.storage.workbook_map();
    let mut txn =
        doc.transact_mut_with(yrs::Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
    if let Some(yrs::Out::YMap(styles_map)) =
        workbook.get(&txn, compute_document::schema::KEY_CUSTOM_TABLE_STYLES)
    {
        styles_map.remove(&mut txn, style_name);
    }
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
