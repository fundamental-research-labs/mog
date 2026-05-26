//! Table CRUD operations for a sheet.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use compute_core::engine_types::TableHitRegion;
use compute_core::table::types::Table;
use snapshot_types::MutationResult;

/// Sub-API for table operations on a single sheet.
pub struct SheetTables {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetTables {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get all tables in this sheet.
    pub fn get_all(&self) -> Result<Vec<Table>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_tables_in_sheet(&sid))
    }

    /// Get the table containing a specific cell, if any.
    pub fn get_at_cell(&self, row: u32, col: u32) -> Result<Option<Table>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_table_at_cell(&sid, row, col))
    }

    /// Look up a table by name (case-insensitive).
    pub fn get_by_name(&self, table_name: &str) -> Result<Option<Table>, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .query_engine(move |e| e.get_table_by_name(&name))
    }

    /// Get which table region a cell falls in (header, data, or totals).
    pub fn get_hit_region(
        &self,
        row: u32,
        col: u32,
    ) -> Result<Option<TableHitRegion>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_table_hit_region(&sid, row, col))
    }

    // -----------------------------------------------------------------
    // CRUD mutations
    // -----------------------------------------------------------------

    /// Create a new table.
    pub fn create(
        &self,
        name: &str,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        columns: Vec<String>,
        has_headers: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let name = name.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.create_table(
                    &sid,
                    name,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    columns,
                    has_headers,
                )
                .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a table by name.
    pub fn delete(&self, table_name: &str) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_table(&name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Rename a table.
    pub fn rename(
        &self,
        old_name: &str,
        new_name: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let old = old_name.to_string();
        let new = new_name.to_string();
        self.dispatch
            .call_engine(move |e| e.rename_table(&old, &new).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Resize a table's range.
    pub fn resize(
        &self,
        table_name: &str,
        new_start_row: u32,
        new_start_col: u32,
        new_end_row: u32,
        new_end_col: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.resize_table(
                    &name,
                    new_start_row,
                    new_start_col,
                    new_end_row,
                    new_end_col,
                )
                .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Style / toggle mutations
    // -----------------------------------------------------------------

    /// Set a table's style name.
    pub fn set_style(
        &self,
        table_name: &str,
        style_name: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        let style = style_name.to_string();
        self.dispatch
            .call_engine(move |e| e.set_table_style(&name, &style))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Toggle the totals row on/off.
    pub fn toggle_totals_row(&self, table_name: &str) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.toggle_totals_row(&name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Toggle the header row on/off.
    pub fn toggle_header_row(&self, table_name: &str) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.toggle_header_row(&name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Toggle banded rows.
    pub fn toggle_banded_rows(&self, table_name: &str) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.toggle_banded_rows(&name))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Toggle banded columns.
    pub fn toggle_banded_cols(&self, table_name: &str) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.toggle_banded_cols(&name))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Column operations
    // -----------------------------------------------------------------

    /// Add a column to a table at the given position.
    pub fn add_column(
        &self,
        table_name: &str,
        column_name: &str,
        position: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        let col_name = column_name.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.add_table_column(&name, &col_name, position)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Rename a column in a table.
    pub fn rename_column(
        &self,
        table_name: &str,
        column_index: u32,
        new_column_name: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        let col_name = new_column_name.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.rename_table_column(&name, column_index, &col_name)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a column from a table by index.
    pub fn remove_column(
        &self,
        table_name: &str,
        column_index: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.remove_table_column(&name, column_index).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Calculated columns
    // -----------------------------------------------------------------

    /// Set the formula for a calculated column, applying it to all data rows.
    pub fn set_calculated_column_formula(
        &self,
        table_name: &str,
        column_index: u32,
        formula: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        let f = formula.to_string();
        self.dispatch
            .call_engine(move |e| e.set_calculated_column_formula(&name, column_index, &f))
            .and_then(|r| r.map(|(_vp, m)| m).map_err(ComputeApiError::from))
    }

    /// Add a calculated column to a table.
    pub fn add_calculated_column(
        &self,
        table_name: &str,
        column_name: &str,
        formula: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        let col_name = column_name.to_string();
        let f = formula.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.add_calculated_column(&name, &col_name, &f)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a calculated column from a table by column index.
    pub fn remove_calculated_column(
        &self,
        table_name: &str,
        column_index: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.remove_calculated_column(&name, column_index)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Conversion
    // -----------------------------------------------------------------

    /// Convert a table to a plain range (structured refs become A1 notation).
    pub fn convert_to_range(&self, table_name: &str) -> Result<MutationResult, ComputeApiError> {
        let name = table_name.to_string();
        self.dispatch
            .call_engine(move |e| e.convert_table_to_range(&name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
