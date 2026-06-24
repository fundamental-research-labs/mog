//! Table management methods for YrsComputeEngine.

use bridge_core as bridge;
use cell_types::SheetId;
use compute_wire::mutation::serialize_multi_viewport_patches;
use domain_types::CellFormat;
use domain_types::domain::table::TableCatalogEntry as CanonicalTable;
use formula_types::{StructureChange, TableDef};
use value_types::ComputeError;

use super::YrsComputeEngine;
use super::mutation::{CellInput, EngineMutation, MutationOutput};
use super::services;
use super::table_result_merge::merge_mutation_result;
use crate::engine_types::{AutoExpansionResult, TableHitRegion};
use crate::snapshot::{MutationResult, RecalcResult};

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "tables",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    // GROUP 2: Table Queries

    /// Get all tables in a specific sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_tables_in_sheet(&self, sheet_id: &SheetId) -> Vec<CanonicalTable> {
        services::tables::get_all_tables_in_sheet(&self.mirror, sheet_id)
    }

    /// Get the table containing a specific cell, if any.
    #[bridge::read(scope = "cell")]
    pub fn get_table_at_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CanonicalTable> {
        services::tables::get_table_at_cell(&self.mirror, sheet_id, row, col)
    }

    /// Look up a table definition by name (case-insensitive).
    /// Eliminates N+1 sheet iteration on the TS side.
    #[bridge::read(scope = "workbook")]
    pub fn get_table_by_name(&self, table_name: &str) -> Option<CanonicalTable> {
        services::tables::get_table_by_name(&self.mirror, table_name)
    }

    /// Get which table region a cell falls in (header, data, or totals).
    /// Returns the hit region info, or `None` if the cell is not inside any table.
    #[bridge::read(scope = "cell")]
    pub fn get_table_hit_region(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<TableHitRegion> {
        services::tables::get_table_hit_region(&self.mirror, sheet_id, row, col)
    }

    // GROUP 2b: Table CRUD Mutations

    /// Create a new table from parameters and register it in the compute mirror.
    #[bridge::write(scope = "range")]
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
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::create_table(
            &mut self.stores,
            &mut self.mirror,
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
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Create a table as one user-visible lifecycle command.
    ///
    /// This owns the effects that are semantically part of table creation:
    /// optional generated header row insertion, generated header cell writes,
    /// table name allocation, initial style, table binding, and table-owned
    /// filter creation. All internal Yrs transactions are grouped into one undo
    /// entry.
    #[bridge::write(scope = "range")]
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
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        let result = (|| -> Result<(Vec<u8>, MutationResult), ComputeError> {
            let requested_name = requested_name.unwrap_or_default();
            let table_name = if requested_name.trim().is_empty() {
                let existing: Vec<&str> = self
                    .mirror
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
            if self
                .mirror
                .all_tables()
                .iter()
                .any(|table| table.name.eq_ignore_ascii_case(&table_name))
            {
                return Err(ComputeError::Eval {
                    message: format!("Table name \"{}\" already exists", table_name),
                });
            }
            let style = Some(services::tables::normalize_table_style_id(
                &self.stores,
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
                let (_patches, structure_result) = self.structure_change(sheet_id, &change)?;
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
                    self.apply_mutation(EngineMutation::SetCellsByPosition {
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
                    let existing = self
                        .mirror
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
                        self.apply_mutation(EngineMutation::SetCellsByPosition {
                            edits,
                            skip_cycle_check: false,
                        })?
                    {
                        merge_mutation_result(&mut combined, recalc_result);
                    }
                }
            }

            let created_table_name = table_name.clone();
            let create_result = services::tables::create_table(
                &mut self.stores,
                &mut self.mirror,
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

            let table_style_patches = self.build_table_style_viewport_patches(&created_table_name);
            let patches = if !table_style_patches.is_empty() {
                table_style_patches
            } else if combined.recalc.changed_cells.is_empty()
                && combined.recalc.projection_changes.is_empty()
                && combined.recalc.errors.is_empty()
            {
                serialize_multi_viewport_patches(&[])
            } else {
                self.flush_viewport_patches()
            };

            Ok((patches, combined))
        })();
        self.mutation.undo_manager.end_undo_group();
        result
    }

    /// Delete a table by name.
    #[bridge::write(scope = "workbook")]
    pub fn delete_table(
        &mut self,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        let result = services::tables::delete_table(&mut self.stores, &mut self.mirror, table_name);
        self.mutation.undo_manager.end_undo_group();
        Ok((serialize_multi_viewport_patches(&[]), result?))
    }

    /// Rename a table.
    #[bridge::write(scope = "workbook")]
    pub fn rename_table(
        &mut self,
        old_name: &str,
        new_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        self.mutation.undo_manager.begin_undo_group();
        let result =
            services::tables::rename_table(&mut self.stores, &mut self.mirror, old_name, new_name);
        self.mutation.undo_manager.end_undo_group();
        Ok((serialize_multi_viewport_patches(&[]), result?))
    }

    /// Resize a table's range.
    #[bridge::write(scope = "workbook")]
    pub fn resize_table(
        &mut self,
        table_name: &str,
        new_start_row: u32,
        new_start_col: u32,
        new_end_row: u32,
        new_end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::resize_table(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            new_start_row,
            new_start_col,
            new_end_row,
            new_end_col,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Set a table's style name (persisted to Yrs and mirror).
    #[bridge::write(scope = "workbook")]
    pub fn set_table_style(
        &mut self,
        table_name: &str,
        style_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut table =
            self.mirror
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
        table.style =
            services::tables::normalize_table_style_id(&self.stores, Some(style_name.to_string()))?;
        self.stores.compute.set_table(&mut self.mirror, table);

        services::tables::persist_table_style_to_yrs(&mut self.stores, &self.mirror, table_name)?;

        let patches = self.build_table_style_viewport_patches(table_name);
        Ok((patches, MutationResult::empty()))
    }

    /// Toggle the totals row on/off for a table.
    #[bridge::write(scope = "workbook")]
    pub fn toggle_totals_row(
        &mut self,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::tables::toggle_totals_row(&mut self.stores, &mut self.mirror, table_name)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Toggle the header row on/off for a table.
    #[bridge::write(scope = "workbook")]
    pub fn toggle_header_row(
        &mut self,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::tables::toggle_header_row(&mut self.stores, &mut self.mirror, table_name)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Toggle banded rows for a table (persisted to Yrs and mirror).
    #[bridge::write(scope = "workbook")]
    pub fn toggle_banded_rows(
        &mut self,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut table =
            self.mirror
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
        table.banded_rows = !table.banded_rows;
        self.stores.compute.set_table(&mut self.mirror, table);

        services::tables::persist_table_style_to_yrs(&mut self.stores, &self.mirror, table_name)?;

        let patches = self.build_table_style_viewport_patches(table_name);
        Ok((patches, MutationResult::empty()))
    }

    /// Toggle banded columns for a table (persisted to Yrs and mirror).
    #[bridge::write(scope = "workbook")]
    pub fn toggle_banded_cols(
        &mut self,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut table =
            self.mirror
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
        table.banded_columns = !table.banded_columns;
        self.stores.compute.set_table(&mut self.mirror, table);

        services::tables::persist_table_style_to_yrs(&mut self.stores, &self.mirror, table_name)?;

        let patches = self.build_table_style_viewport_patches(table_name);
        Ok((patches, MutationResult::empty()))
    }

    /// Set a boolean option on a table (proper set semantics, not toggle).
    #[bridge::write(scope = "workbook")]
    pub fn set_table_bool_option(
        &mut self,
        table_name: &str,
        option: &str,
        value: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::tables::set_table_bool_option(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            option,
            value,
        )?;

        services::tables::persist_table_style_to_yrs(&mut self.stores, &self.mirror, table_name)?;

        let patches = self.build_table_style_viewport_patches(table_name);
        Ok((patches, MutationResult::empty()))
    }

    /// Set whether a table automatically expands when adjacent user input is entered.
    #[bridge::write(scope = "workbook")]
    pub fn set_table_auto_expand(
        &mut self,
        table_name: &str,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::set_table_auto_expand(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            enabled,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Set whether formulas entered in table data columns automatically create/fill calculated columns.
    #[bridge::write(scope = "workbook")]
    pub fn set_table_auto_calculated_columns(
        &mut self,
        table_name: &str,
        enabled: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::set_table_auto_calculated_columns(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            enabled,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Set the totals-row function metadata for a table column.
    #[bridge::write(scope = "workbook")]
    pub fn set_table_totals_function(
        &mut self,
        table_name: &str,
        column_id: &str,
        func: compute_table::types::TotalsFunction,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::set_table_totals_function(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            column_id,
            func,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Add a data row to a table. Returns the absolute row index where a worksheet
    /// row should be inserted (encoded in MutationResult.data).
    #[bridge::write(scope = "workbook")]
    pub fn add_table_data_row(
        &mut self,
        table_name: &str,
        relative_row: Option<u32>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::add_table_data_row(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            relative_row,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Remove a data row from a table by relative index. Returns the absolute row
    /// that was removed (encoded in MutationResult.data).
    #[bridge::write(scope = "workbook")]
    pub fn remove_table_data_row(
        &mut self,
        table_name: &str,
        relative_row: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::remove_table_data_row(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            relative_row,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Add a column to a table at the given position.
    #[bridge::write(scope = "workbook")]
    pub fn add_table_column(
        &mut self,
        table_name: &str,
        column_name: &str,
        position: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut result = self.with_undo_group_if(true, |engine| {
            services::tables::add_table_column(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                table_name,
                column_name,
                position,
            )
        })?;
        self.prepare_recalc_for_flush(&mut result.recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, result))
    }

    /// Rename a column in a table.
    ///
    /// Updates the column name in the table definition and propagates the
    /// rename to all formulas containing structured references to the old
    /// column name.
    #[bridge::write(scope = "workbook")]
    pub fn rename_table_column(
        &mut self,
        table_name: &str,
        column_index: u32,
        new_column_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let mut result = self.with_undo_group_if(true, |engine| {
            services::tables::rename_table_column(
                &mut engine.stores,
                &mut engine.mirror,
                &mut engine.mutation,
                table_name,
                column_index,
                new_column_name,
            )
        })?;
        self.prepare_recalc_for_flush(&mut result.recalc);
        let patches = self.flush_viewport_patches();
        Ok((patches, result))
    }

    /// Remove a column from a table by index.
    #[bridge::write(scope = "workbook")]
    pub fn remove_table_column(
        &mut self,
        table_name: &str,
        column_index: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::remove_table_column(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            column_index,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    #[bridge::write(scope = "workbook")]
    pub fn set_calculated_column_formula(
        &mut self,
        table_name: &str,
        column_index: u32,
        formula: &str,
    ) -> Result<(Vec<u8>, crate::snapshot::MutationResult), ComputeError> {
        let table =
            self.mirror
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

        let mut last_result = (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            crate::snapshot::MutationResult::from_recalc(RecalcResult::empty()),
        );
        for row in data_start..=data_end {
            let grid = self.stores.grid_indexes.get_mut(&sheet_id).ok_or_else(|| {
                ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                }
            })?;
            let cell_id = grid.ensure_cell_id(row, col);
            last_result = self.set_cell(&sheet_id, cell_id, row, col, formula.into())?;
        }
        Ok(last_result)
    }

    /// Apply pre-determined calculated-column formulas to a single row.
    /// Intended for use after inserting a new data row into a table:
    /// each `(column_index, formula)` pair is written to the given row.
    #[bridge::write(scope = "workbook")]
    pub fn apply_calculated_formulas_to_row(
        &mut self,
        table_name: &str,
        row: u32,
        formulas: Vec<(u32, String)>,
    ) -> Result<(Vec<u8>, crate::snapshot::MutationResult), ComputeError> {
        let table =
            self.mirror
                .get_table(table_name)
                .cloned()
                .ok_or_else(|| ComputeError::Eval {
                    message: format!("Table not found: {}", table_name),
                })?;
        let sheet_id = cell_types::SheetId::from_uuid_str(&table.sheet_id)
            .unwrap_or(cell_types::SheetId::from_raw(0));

        let mut last_result = (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            crate::snapshot::MutationResult::from_recalc(RecalcResult::empty()),
        );
        for (column_index, formula) in &formulas {
            let col = table.range.start_col() + column_index;
            let grid = self.stores.grid_indexes.get_mut(&sheet_id).ok_or_else(|| {
                ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                }
            })?;
            let cell_id = grid.ensure_cell_id(row, col);
            last_result = self.set_cell(&sheet_id, cell_id, row, col, formula.as_str().into())?;
        }
        Ok(last_result)
    }

    // -------------------------------------------------------------------
    // G7: Calculated Columns
    // -------------------------------------------------------------------

    /// Add a calculated column to a table.
    #[bridge::write(scope = "workbook")]
    pub fn add_calculated_column(
        &mut self,
        table_name: &str,
        column_name: &str,
        formula: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::add_calculated_column(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            column_name,
            formula,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Remove a calculated column from a table by column index.
    #[bridge::write(scope = "workbook")]
    pub fn remove_calculated_column(
        &mut self,
        table_name: &str,
        column_index: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::remove_calculated_column(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            column_index,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Update the formula for a calculated column.
    #[bridge::write(scope = "workbook")]
    pub fn update_calculated_column(
        &mut self,
        table_name: &str,
        column_index: u32,
        formula: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::update_calculated_column(
            &mut self.stores,
            &mut self.mirror,
            table_name,
            column_index,
            formula,
        )?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    // -------------------------------------------------------------------
    // G8: Table Auto-expansion
    // -------------------------------------------------------------------

    /// Detect if a table should auto-expand based on adjacent data.
    #[bridge::read(scope = "sheet")]
    pub fn detect_auto_expansion(
        &self,
        sheet_id: &SheetId,
        table_name: &str,
    ) -> Result<AutoExpansionResult, ComputeError> {
        services::tables::detect_auto_expansion(&self.mirror, sheet_id, table_name)
    }

    /// Apply auto-expansion to a table.
    #[bridge::write(scope = "sheet")]
    pub fn apply_auto_expansion(
        &mut self,
        sheet_id: &SheetId,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::apply_auto_expansion(&self.mirror, sheet_id, table_name)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Create a custom table style.
    #[bridge::write(scope = "workbook")]
    pub fn create_custom_table_style(
        &mut self,
        style: compute_table::custom_styles::CustomTableStyleConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::create_custom_table_style(&mut self.stores, style)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Delete a custom table style by name.
    #[bridge::write(scope = "workbook")]
    pub fn delete_custom_table_style(
        &mut self,
        style_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = services::tables::delete_custom_table_style(&mut self.stores, style_name)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Update a custom table style.
    #[bridge::write(scope = "workbook")]
    pub fn update_custom_table_style(
        &mut self,
        style_name: &str,
        style: compute_table::custom_styles::CustomTableStyleConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result =
            services::tables::update_custom_table_style(&mut self.stores, style_name, style)?;
        Ok((serialize_multi_viewport_patches(&[]), result))
    }

    /// Get all custom table styles.
    #[bridge::read(scope = "workbook")]
    pub fn get_all_custom_table_styles(
        &self,
    ) -> Vec<compute_table::custom_styles::CustomTableStyleConfig> {
        services::tables::get_all_custom_table_styles(&self.stores)
    }

    #[bridge::skip(wasm, tauri, napi, pyo3)]
    #[bridge::write(scope = "workbook")]
    pub fn set_table_def(&mut self, table: TableDef) {
        services::tables::set_table_def(&mut self.stores, &mut self.mirror, table)
    }

    /// Remove a table by name.
    #[bridge::skip(wasm, tauri, napi, pyo3)]
    #[bridge::write(scope = "workbook")]
    pub fn remove_table_def(&mut self, name: &str) {
        services::tables::remove_table_def(&mut self.stores, &mut self.mirror, name)
    }

    /// Resolve the table-derived CellFormat for a cell, if it is inside a table.
    ///
    /// Returns `None` if the cell is not in any table or the table style produces
    /// no formatting for this position.
    #[bridge::read(scope = "cell")]
    pub fn resolve_table_format_at_cell(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellFormat> {
        services::tables::resolve_table_format_at_cell(&self.mirror, sheet_id, row, col)
    }

    /// Convert a table to a plain range.
    ///
    /// Converts all structured references (e.g., `Table1[Column1]`) to A1
    /// notation (e.g., `$B$2:$B$10`), then removes the table definition.
    /// Returns the number of formulas that were converted (in `data`).
    #[bridge::write(scope = "workbook")]
    pub fn convert_table_to_range(
        &mut self,
        table_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let converted_table = self.mirror.get_table(table_name).cloned();
        let result = services::tables::convert_table_to_range(
            &mut self.stores,
            &mut self.mirror,
            table_name,
        )?;
        let patches = converted_table
            .as_ref()
            .and_then(|table| {
                let sheet_id = cell_types::SheetId::from_uuid_str(&table.sheet_id).ok()?;
                let grid = self.stores.grid_indexes.get(&sheet_id)?;
                let mut affected_cells = Vec::new();
                for row in table.range.start_row()..=table.range.end_row() {
                    for col in table.range.start_col()..=table.range.end_col() {
                        if let Some(cell_id) = grid.cell_id_at(row, col) {
                            affected_cells.push((cell_id.as_u128(), row, col));
                        }
                    }
                }
                Some(self.produce_format_change_patches(&sheet_id, &affected_cells))
            })
            .unwrap_or_else(|| serialize_multi_viewport_patches(&[]));
        Ok((patches, result))
    }
}

// ---------------------------------------------------------------------------
// Private helpers (outside #[bridge::api] block)
// ---------------------------------------------------------------------------

impl YrsComputeEngine {
    /// Build viewport patches for all cells in a table after a style change.
    ///
    /// Collects every cell within the table bounds, then delegates to
    /// `produce_format_change_patches` which resolves effective formats
    /// (including the table layer) and produces binary patches for the UI.
    fn build_table_style_viewport_patches(&mut self, table_name: &str) -> Vec<u8> {
        // 1. Get table bounds
        let table = match self.mirror.get_table(table_name).cloned() {
            Some(t) => t,
            None => return Vec::new(),
        };
        let sheet_id = cell_types::SheetId::from_uuid_str(&table.sheet_id)
            .unwrap_or(cell_types::SheetId::from_raw(0));

        // 2. Get grid index for this sheet
        let grid = match self.stores.grid_indexes.get(&sheet_id) {
            Some(g) => g,
            None => return Vec::new(),
        };

        // 3. Collect all cell IDs within the table bounds
        let mut affected_cells: Vec<(u128, u32, u32)> = Vec::new();
        for row in table.range.start_row()..=table.range.end_row() {
            for col in table.range.start_col()..=table.range.end_col() {
                if let Some(cell_id) = grid.cell_id_at(row, col) {
                    affected_cells.push((cell_id.as_u128(), row, col));
                }
            }
        }

        if affected_cells.is_empty() {
            return Vec::new();
        }

        // 4. Delegate to the format viewport patches builder
        self.produce_format_change_patches(&sheet_id, &affected_cells)
    }

    /// Re-read all tables from the Yrs `workbook.tables` map and sync
    /// them into the mirror.  Called after undo/redo so the mirror stays in
    /// sync with the reverted Yrs state.
    pub(crate) fn sync_tables_from_yrs(&mut self) {
        services::tables::sync_tables_from_yrs(&mut self.stores, &mut self.mirror)
    }

    /// Re-read all named ranges from the Yrs `workbook.namedRanges` map and
    /// sync them into the ComputeCore/mirror.  Called when the observer
    /// detects named-range changes during sync (push/pull or undo/redo).
    ///
    /// After typed formula boundary, the `refers_to` field in Yrs is stored in exactly
    /// one format: `serde_json::to_string(&IdentityFormula)`. Entries that
    /// fail to deserialize are logged and skipped — the prior "fall back to
    /// raw A1 parse" branch silently returned wrong semantics on malformed
    /// input and has been deleted.
    pub(crate) fn sync_named_ranges_from_yrs(&mut self) {
        use crate::storage::workbook::named_ranges;

        let defined_names = named_ranges::get_all_named_ranges(
            self.stores.storage.doc(),
            self.stores.storage.workbook_map(),
        );
        let nil_sheet = SheetId::from_raw(0);
        let named_range_defs =
            super::construction::defined_names_to_named_range_defs(defined_names, |identity| {
                self.stores
                    .compute
                    .to_a1_display_qualified(&self.mirror, &nil_sheet, identity)
            });

        // Collect names seen in Yrs so we can detect deletions.
        let mut yrs_names = std::collections::HashSet::new();

        for def in named_range_defs {
            yrs_names.insert(def.name.to_ascii_lowercase());
            let name = def.name.clone();
            self.stores
                .compute
                .set_named_range(&mut self.mirror, name, def);
        }

        // Remove named ranges that exist in mirror but no longer in Yrs.
        let mirror_names: Vec<String> = self
            .mirror
            .variables
            .all_variables()
            .map(|(_, name, _)| name.clone())
            .collect::<std::collections::HashSet<_>>()
            .into_iter()
            .collect();
        for name in mirror_names {
            if !yrs_names.contains(&name) {
                self.stores
                    .compute
                    .remove_named_range(&mut self.mirror, &name);
            }
        }
    }
}
