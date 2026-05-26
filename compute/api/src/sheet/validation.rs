//! SheetValidation — Column/range schema and cell validation operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::{CellValidationResult, ColumnSchema, RangeSchema};
use snapshot_types::MutationResult;

/// Data validation and schema operations for a single sheet.
///
/// Manages column schemas (type constraints per column) and range schemas
/// (validation rules for arbitrary ranges). Also provides cell-level
/// validation against applicable schemas.
pub struct SheetValidation {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetValidation {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Column schemas
    // -----------------------------------------------------------------

    /// Get the column schema at the given column index.
    pub fn get_column_schema(
        &self,
        col_index: u32,
    ) -> Result<Option<ColumnSchema>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_column_schema(&sid, col_index))
    }

    /// Set (create or overwrite) a column schema at the given column index.
    pub fn set_column_schema(
        &self,
        col_index: u32,
        schema: ColumnSchema,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.set_column_schema(&sid, col_index, &schema)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove the column schema at the given column index.
    pub fn clear_column_schema(&self, col_index: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_column_schema(&sid, col_index).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Return all column schemas for the sheet as `(col_index, ColumnSchema)` pairs.
    pub fn get_all_column_schemas(&self) -> Result<Vec<(u32, ColumnSchema)>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_column_schemas(&sid))
    }

    // -----------------------------------------------------------------
    // Range schemas
    // -----------------------------------------------------------------

    /// Get a single range schema by its ID.
    pub fn get_range_schema(
        &self,
        schema_id: &str,
    ) -> Result<Option<RangeSchema>, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = schema_id.to_owned();
        self.dispatch
            .query_engine(move |e| e.get_range_schema(&sid, &owned_id))
    }

    /// Return all range schemas for the sheet.
    pub fn get_range_schemas(&self) -> Result<Vec<RangeSchema>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_range_schemas_for_sheet(&sid))
    }

    /// Create or overwrite a range schema.
    pub fn set_range_schema(&self, schema: RangeSchema) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_range_schema(&sid, &schema).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update an existing range schema by ID (full replacement).
    pub fn update_range_schema(
        &self,
        schema_id: &str,
        updates: RangeSchema,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = schema_id.to_owned();
        self.dispatch
            .call_engine(move |e| {
                e.update_range_schema(&sid, &owned_id, &updates)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a range schema by ID.
    pub fn delete_range_schema(&self, schema_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_id = schema_id.to_owned();
        self.dispatch
            .call_engine(move |e| e.delete_range_schema(&sid, &owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Cell validation
    // -----------------------------------------------------------------

    /// Validate a cell value against any applicable schema (column or range).
    pub fn validate_cell_value(
        &self,
        row: u32,
        col: u32,
        value: &str,
    ) -> Result<CellValidationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let owned_value = value.to_owned();
        self.dispatch
            .query_engine(move |e| e.validate_cell_value(&sid, row, col, &owned_value))
    }
}
