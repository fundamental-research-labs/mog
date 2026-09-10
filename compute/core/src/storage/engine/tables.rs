//! Table management methods for ComputeEngine.

use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::CellFormat;
use domain_types::domain::table::TableCatalogEntry as CanonicalTable;
use formula_types::{StructureChange, TableDef};
use value_types::ComputeError;

use super::ComputeEngine;
use super::mutation::{CellInput, EngineMutation, MutationOutput};
use super::services;
use super::table_result_merge::merge_mutation_result;
use crate::engine_types::{AutoExpansionResult, TableHitRegion};
use crate::snapshot::{MutationResult, RecalcResult};

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "tables",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
    // GROUP 2: Table Queries

    /// Get all tables in a specific sheet.
    #[bridge::read]
    pub fn get_all_tables_in_sheet(&self, sheet_id: &SheetId) -> Vec<CanonicalTable> {
        services::tables::get_all_tables_in_sheet(&self.cell_store, sheet_id)
    }

    /// Get the table containing a specific cell, if any.
    #[bridge::read]
    pub fn get_table_at_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CanonicalTable> {
        services::tables::get_table_at_cell(&self.cell_store, sheet_id, row, col)
    }

    /// Look up a table definition by name (case-insensitive).
    /// Eliminates N+1 sheet iteration on the TS side.
    #[bridge::read]
    pub fn get_table_by_name(&self, table_name: &str) -> Option<CanonicalTable> {
        services::tables::get_table_by_name(&self.cell_store, table_name)
    }

    /// Get which table region a cell falls in (header, data, or totals).
    /// Returns the hit region info, or `None` if the cell is not inside any table.
    #[bridge::read]
    pub fn get_table_hit_region(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<TableHitRegion> {
        services::tables::get_table_hit_region(&self.cell_store, sheet_id, row, col)
    }

    // GROUP 2b: Table CRUD Mutations

    /// Create a new table from parameters and register it in the compute cell_store.
    #[bridge::write]
    #[allow(clippy::too_many_arguments)]
    pub fn create_table(
        &mut self,
        sheet_id: &SheetId,
        name: String,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        columns: Vec<String>,
        has_headers: bool,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::create_table(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                name,
                start_row,
                start_col,
                end_row,
                end_col,
                columns,
                has_headers,
                None,
            )?;
            Ok(result)
        })
    }

    /// Create a table as one user-visible lifecycle command.
    ///
    /// This owns the effects that are semantically part of table creation:
    /// optional generated header row insertion, generated header cell writes,
    /// table name allocation, initial style, table binding, and table-owned
    /// filter creation.
    #[bridge::write]
    #[allow(clippy::too_many_arguments)]
    pub fn create_table_lifecycle(
        &mut self,
        sheet_id: &SheetId,
        requested_name: Option<String>,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        columns: Vec<String>,
        has_headers: bool,
        style: Option<String>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let requested_name = requested_name.unwrap_or_default();
            let table_name = if requested_name.trim().is_empty() {
                let existing: Vec<&str> = engine
                    .cell_store
                    .all_tables()
                    .iter()
                    .map(|table| table.name.as_str())
                    .collect();
                compute_table::table::generate_table_name(&existing)
            } else {
                requested_name
            };
            compute_table::table::validate_table_name(&table_name).map_err(|err| {
                ComputeError::Eval {
                    message: err.to_string(),
                }
            })?;
            if engine
                .cell_store
                .all_tables()
                .iter()
                .any(|table| table.name.eq_ignore_ascii_case(&table_name))
            {
                return Err(ComputeError::Eval {
                    message: format!("Table name \"{}\" already exists", table_name),
                });
            }
            let style = Some(services::tables::normalize_table_style_id(
                &engine.stores,
                style,
            )?);

            let mut combined = MutationResult::empty();
            let mut effective_end_row = end_row;

            if !has_headers {
                let change = StructureChange::InsertRows {
                    at: start_row,
                    count: 1,
                    new_row_ids: Vec::new(),
                };
                let structure_result = engine.structure_change(sheet_id, &change)?;
                merge_mutation_result(&mut combined, structure_result);

                let col_count = end_col.saturating_sub(start_col) + 1;
                let edits = (0..col_count)
                    .map(|i| {
                        (
                            *sheet_id,
                            start_row,
                            start_col + i,
                            CellInput::Parse {
                                text: format!("Column{}", i + 1),
                            },
                        )
                    })
                    .collect();
                if let MutationOutput::Recalc(recalc_result) =
                    engine.apply_mutation(EngineMutation::SetCellsByPosition {
                        edits,
                        skip_cycle_check: false,
                    })?
                {
                    merge_mutation_result(&mut combined, recalc_result);
                }

                effective_end_row = effective_end_row.saturating_add(1);
            } else if columns.is_empty() {
                let col_count = end_col.saturating_sub(start_col) + 1;
                let mut used_names = std::collections::HashSet::new();
                let mut generated_counter = 1_u32;
                let mut edits = Vec::new();

                for i in 0..col_count {
                    let col = start_col + i;
                    let existing = engine
                        .cell_store
                        .get_cell_value_at(sheet_id, cell_types::SheetPos::new(start_row, col))
                        .and_then(|value| match value {
                            value_types::CellValue::Text(text) => {
                                let trimmed = text.trim();
                                (!trimmed.is_empty()).then(|| trimmed.to_string())
                            }
                            value_types::CellValue::Number(number) => Some(number.to_string()),
                            _ => None,
                        });

                    if let Some(name) = existing {
                        used_names.insert(name.to_lowercase());
                        continue;
                    }

                    let generated = loop {
                        let candidate = format!("Column{}", generated_counter);
                        generated_counter += 1;
                        if !used_names.contains(&candidate.to_lowercase()) {
                            break candidate;
                        }
                    };
                    used_names.insert(generated.to_lowercase());
                    edits.push((
                        *sheet_id,
                        start_row,
                        col,
                        CellInput::Parse { text: generated },
                    ));
                }

                if !edits.is_empty() {
                    if let MutationOutput::Recalc(recalc_result) =
                        engine.apply_mutation(EngineMutation::SetCellsByPosition {
                            edits,
                            skip_cycle_check: false,
                        })?
                    {
                        merge_mutation_result(&mut combined, recalc_result);
                    }
                }
            }

            let create_result = services::tables::create_table(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                table_name,
                start_row,
                start_col,
                effective_end_row,
                end_col,
                columns,
                true,
                style,
            )?;
            merge_mutation_result(&mut combined, create_result);

            Ok(combined)
        })
    }

    /// Delete a table by name.
    #[bridge::write]
    pub fn delete_table(&mut self, table_name: &str) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::delete_table(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
            );

            Ok(result?)
        })
    }

    /// Rename a table.
    #[bridge::write]
    pub fn rename_table(
        &mut self,
        old_name: &str,
        new_name: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::rename_table(
                &mut engine.stores,
                &mut engine.cell_store,
                old_name,
                new_name,
            );

            Ok(result?)
        })
    }

    /// Resize a table's range.
    #[bridge::write]
    pub fn resize_table(
        &mut self,
        table_name: &str,
        new_start_row: u32,
        new_start_col: u32,
        new_end_row: u32,
        new_end_col: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::resize_table(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                new_start_row,
                new_start_col,
                new_end_row,
                new_end_col,
            )?;
            Ok(result)
        })
    }

    /// Set a table's native style name.
    #[bridge::write]
    pub fn set_table_style(
        &mut self,
        table_name: &str,
        style_name: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut table = engine
                .cell_store
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
            table.style = services::tables::normalize_table_style_id(
                &engine.stores,
                Some(style_name.to_string()),
            )?;
            engine
                .stores
                .compute
                .set_table(&mut engine.cell_store, table);

            Ok(MutationResult::empty())
        })
    }

    /// Toggle the totals row on/off for a table.
    #[bridge::write]
    pub fn toggle_totals_row(&mut self, table_name: &str) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::toggle_totals_row(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
            )?;
            Ok(result)
        })
    }

    /// Toggle the header row on/off for a table.
    #[bridge::write]
    pub fn toggle_header_row(&mut self, table_name: &str) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::toggle_header_row(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
            )?;
            Ok(result)
        })
    }

    /// Toggle banded rows for a table (updates the native table catalog).
    #[bridge::write]
    pub fn toggle_banded_rows(&mut self, table_name: &str) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut table = engine
                .cell_store
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
            table.banded_rows = !table.banded_rows;
            engine
                .stores
                .compute
                .set_table(&mut engine.cell_store, table);

            Ok(MutationResult::empty())
        })
    }

    /// Toggle banded columns for a table (updates the native table catalog).
    #[bridge::write]
    pub fn toggle_banded_cols(&mut self, table_name: &str) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut table = engine
                .cell_store
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
            table.banded_columns = !table.banded_columns;
            engine
                .stores
                .compute
                .set_table(&mut engine.cell_store, table);

            Ok(MutationResult::empty())
        })
    }

    /// Set a boolean option on a table (proper set semantics, not toggle).
    #[bridge::write]
    pub fn set_table_bool_option(
        &mut self,
        table_name: &str,
        option: &str,
        value: bool,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::tables::set_table_bool_option(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                option,
                value,
            )?;

            Ok(MutationResult::empty())
        })
    }

    /// Set whether a table automatically expands when adjacent user input is entered.
    #[bridge::write]
    pub fn set_table_auto_expand(
        &mut self,
        table_name: &str,
        enabled: bool,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::set_table_auto_expand(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                enabled,
            )?;
            Ok(result)
        })
    }

    /// Set whether formulas entered in table data columns automatically create/fill calculated columns.
    #[bridge::write]
    pub fn set_table_auto_calculated_columns(
        &mut self,
        table_name: &str,
        enabled: bool,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::set_table_auto_calculated_columns(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                enabled,
            )?;
            Ok(result)
        })
    }

    /// Set the totals-row function metadata for a table column.
    #[bridge::write]
    pub fn set_table_totals_function(
        &mut self,
        table_name: &str,
        column_id: &str,
        func: compute_table::types::TotalsFunction,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::set_table_totals_function(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_id,
                func,
            )?;
            Ok(result)
        })
    }

    /// Add a data row to a table. Returns the absolute row index where a worksheet
    /// row should be inserted (encoded in MutationResult.data).
    #[bridge::write]
    pub fn add_table_data_row(
        &mut self,
        table_name: &str,
        relative_row: Option<u32>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::add_table_data_row(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                relative_row,
            )?;
            Ok(result)
        })
    }

    /// Remove a data row from a table by relative index. Returns the absolute row
    /// that was removed (encoded in MutationResult.data).
    #[bridge::write]
    pub fn remove_table_data_row(
        &mut self,
        table_name: &str,
        relative_row: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::remove_table_data_row(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                relative_row,
            )?;
            Ok(result)
        })
    }

    /// Add a column to a table at the given position.
    #[bridge::write]
    pub fn add_table_column(
        &mut self,
        table_name: &str,
        column_name: &str,
        position: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut result = services::tables::add_table_column(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_name,
                position,
            )?;
            engine.postprocess_mutation_recalc(&mut result.recalc);

            Ok(result)
        })
    }

    /// Rename a column in a table.
    ///
    /// Updates the column name in the table definition and propagates the
    /// rename to all formulas containing structured references to the old
    /// column name.
    #[bridge::write]
    pub fn rename_table_column(
        &mut self,
        table_name: &str,
        column_index: u32,
        new_column_name: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let mut result = services::tables::rename_table_column(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_index,
                new_column_name,
            )?;
            engine.postprocess_mutation_recalc(&mut result.recalc);

            Ok(result)
        })
    }

    /// Remove a column from a table by index.
    #[bridge::write]
    pub fn remove_table_column(
        &mut self,
        table_name: &str,
        column_index: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::remove_table_column(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_index,
            )?;
            Ok(result)
        })
    }

    #[bridge::write]
    pub fn set_calculated_column_formula(
        &mut self,
        table_name: &str,
        column_index: u32,
        formula: &str,
    ) -> Result<crate::snapshot::MutationResult, ComputeError> {
        self.with_history(|engine| {
            let table = engine
                .cell_store
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;

            let col = table.range.start_col() + column_index;
            let data_start = if table.has_header_row {
                table.range.start_row() + 1
            } else {
                table.range.start_row()
            };
            let data_end = if table.has_totals_row {
                table.range.end_row() - 1
            } else {
                table.range.end_row()
            };
            let sheet_id = cell_types::SheetId::from_uuid_str(&table.sheet_id)
                .unwrap_or(cell_types::SheetId::from_raw(0));

            let mut last_result =
                crate::snapshot::MutationResult::from_recalc(RecalcResult::empty());
            for row in data_start..=data_end {
                last_result = engine.set_cell_value_parsed(&sheet_id, row, col, formula)?;
            }
            Ok(last_result)
        })
    }

    /// Apply pre-determined calculated-column formulas to a single row.
    /// Intended for use after inserting a new data row into a table:
    /// each `(column_index, formula)` pair is written to the given row.
    #[bridge::write]
    pub fn apply_calculated_formulas_to_row(
        &mut self,
        table_name: &str,
        row: u32,
        formulas: Vec<(u32, String)>,
    ) -> Result<crate::snapshot::MutationResult, ComputeError> {
        self.with_history(|engine| {
            let table = engine
                .cell_store
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
            let sheet_id = cell_types::SheetId::from_uuid_str(&table.sheet_id)
                .unwrap_or(cell_types::SheetId::from_raw(0));

            let mut last_result =
                crate::snapshot::MutationResult::from_recalc(RecalcResult::empty());
            for (column_index, formula) in &formulas {
                let col = table.range.start_col() + column_index;
                last_result =
                    engine.set_cell_value_parsed(&sheet_id, row, col, formula.as_str())?;
            }
            Ok(last_result)
        })
    }

    // -------------------------------------------------------------------
    // G7: Calculated Columns
    // -------------------------------------------------------------------

    /// Add a calculated column to a table.
    #[bridge::write]
    pub fn add_calculated_column(
        &mut self,
        table_name: &str,
        column_name: &str,
        formula: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::add_calculated_column(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_name,
                formula,
            )?;
            Ok(result)
        })
    }

    /// Remove a calculated column from a table by column index.
    #[bridge::write]
    pub fn remove_calculated_column(
        &mut self,
        table_name: &str,
        column_index: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::remove_calculated_column(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_index,
            )?;
            Ok(result)
        })
    }

    /// Update the formula for a calculated column.
    #[bridge::write]
    pub fn update_calculated_column(
        &mut self,
        table_name: &str,
        column_index: u32,
        formula: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::update_calculated_column(
                &mut engine.stores,
                &mut engine.cell_store,
                table_name,
                column_index,
                formula,
            )?;
            Ok(result)
        })
    }

    // -------------------------------------------------------------------
    // G8: Table Auto-expansion
    // -------------------------------------------------------------------

    /// Detect if a table should auto-expand based on adjacent data.
    #[bridge::read]
    pub fn detect_auto_expansion(
        &self,
        sheet_id: &SheetId,
        table_name: &str,
    ) -> Result<AutoExpansionResult, ComputeError> {
        services::tables::detect_auto_expansion(&self.cell_store, sheet_id, table_name)
    }

    /// Apply auto-expansion to a table.
    #[bridge::write]
    pub fn apply_auto_expansion(
        &mut self,
        sheet_id: &SheetId,
        table_name: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result =
                services::tables::apply_auto_expansion(&engine.cell_store, sheet_id, table_name)?;
            Ok(result)
        })
    }

    /// Create a custom table style.
    #[bridge::write]
    pub fn create_custom_table_style(
        &mut self,
        style: compute_table::custom_styles::CustomTableStyleConfig,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = services::tables::create_custom_table_style(&mut engine.stores, style)?;
            Ok(result)
        })
    }

    /// Delete a custom table style by name.
    #[bridge::write]
    pub fn delete_custom_table_style(
        &mut self,
        style_name: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result =
                services::tables::delete_custom_table_style(&mut engine.stores, style_name)?;
            Ok(result)
        })
    }

    /// Update a custom table style.
    #[bridge::write]
    pub fn update_custom_table_style(
        &mut self,
        style_name: &str,
        style: compute_table::custom_styles::CustomTableStyleConfig,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result =
                services::tables::update_custom_table_style(&mut engine.stores, style_name, style)?;
            Ok(result)
        })
    }

    /// Get all custom table styles.
    #[bridge::read]
    pub fn get_all_custom_table_styles(
        &self,
    ) -> Vec<compute_table::custom_styles::CustomTableStyleConfig> {
        services::tables::get_all_custom_table_styles(&self.stores)
    }

    #[bridge::skip(wasm, tauri, napi, pyo3)]
    #[bridge::write]
    pub fn set_table_def(&mut self, table: TableDef) {
        self.with_history(|engine| {
            services::tables::set_table_def(&mut engine.stores, &mut engine.cell_store, table)
        })
    }

    /// Remove a table by name.
    #[bridge::skip(wasm, tauri, napi, pyo3)]
    #[bridge::write]
    pub fn remove_table_def(&mut self, name: &str) {
        self.with_history(|engine| {
            services::tables::remove_table_def(&mut engine.stores, &mut engine.cell_store, name)
        })
    }

    /// Resolve the table-derived CellFormat for a cell, if it is inside a table.
    ///
    /// Returns `None` if the cell is not in any table or the table style produces
    /// no formatting for this position.
    #[bridge::read]
    pub fn resolve_table_format_at_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellFormat> {
        services::tables::resolve_table_format_at_cell(&self.cell_store, sheet_id, row, col)
    }

    /// Convert a table to a plain range.
    ///
    /// Converts all structured references (e.g., `Table1[Column1]`) to A1
    /// notation (e.g., `$B$2:$B$10`), then removes the table definition.
    /// Returns the number of formulas that were converted (in `data`).
    #[bridge::write]
    pub fn convert_table_to_range(
        &mut self,
        table_name: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let result = {
                let result = services::tables::convert_table_to_range(
                    &mut engine.stores,
                    &mut engine.cell_store,
                    table_name,
                )?;
                result
            };

            Ok(result)
        })
    }
}
