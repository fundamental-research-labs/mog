//! WorkbookNames — Named range (defined name) CRUD operations.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use compute_core::bridge_types::named_ranges::{DefinedNameInput, NamedRangeUpdate};
use formula_types::NamedRangeDef;
use snapshot_types::MutationResult;
use value_types::CellValue;

/// Named range management for the workbook.
pub struct WorkbookNames {
    dispatch: Dispatch,
}

impl WorkbookNames {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Evaluate an Excel expression in the context of a worksheet.
    ///
    /// This delegates to the compute engine's production parser/evaluator so
    /// callers such as Office.js named items get the same cell, name, and
    /// function semantics as worksheet formulas. The expression may include
    /// or omit its leading `=`.
    pub fn evaluate_expression(
        &self,
        sheet_id: &SheetId,
        expression: &str,
    ) -> Result<CellValue, ComputeApiError> {
        let sid = *sheet_id;
        let expression = expression.to_owned();
        self.dispatch
            .query_engine(move |engine| engine.evaluate_expression(&sid, &expression))
            .and_then(|result| result.map_err(ComputeApiError::from))
    }

    /// Return the user-facing formula for a defined name.
    ///
    /// Defined names persisted by the engine use an identity formula JSON
    /// payload. Convert that payload through the engine's production A1
    /// formatter instead of exposing storage JSON to callers.
    pub fn get_named_range_formula_by_id(
        &self,
        id: &str,
    ) -> Result<Option<String>, ComputeApiError> {
        let owned_id = id.to_owned();
        self.dispatch.query_engine(move |engine| {
            let record = engine.get_named_range_by_id(&owned_id)?;
            if let Some(raw) = record.raw_refers_to {
                return Some(raw);
            }
            let identity =
                serde_json::from_str::<formula_types::IdentityFormula>(&record.refers_to).ok()?;
            Some(engine.to_a1_display_qualified(&SheetId::from_raw(0), &identity))
        })
    }

    /// Get a named range by its stable ID.
    pub fn get_named_range_by_id(
        &self,
        id: &str,
    ) -> Result<Option<domain_types::domain::named_range::DefinedName>, ComputeApiError> {
        let owned_id = id.to_owned();
        self.dispatch
            .query_engine(move |e| e.get_named_range_by_id(&owned_id))
    }

    /// Get a named range by name and exact scope.
    ///
    /// Pass `None` for workbook scope or `Some(sheet_id)` for worksheet scope.
    pub fn get_named_range_by_name(
        &self,
        name: &str,
        scope: Option<String>,
    ) -> Result<Option<domain_types::domain::named_range::DefinedName>, ComputeApiError> {
        let owned_name = name.to_owned();
        self.dispatch
            .query_engine(move |e| e.get_named_range_by_name(&owned_name, scope))
    }

    /// Get all named ranges in an exact workbook or worksheet scope.
    pub fn get_named_ranges_by_scope(
        &self,
        scope: Option<String>,
    ) -> Result<Vec<domain_types::domain::named_range::DefinedName>, ComputeApiError> {
        self.dispatch
            .query_engine(move |e| e.get_named_ranges_by_scope(scope))
    }

    /// Create a new named range (defined name).
    ///
    /// Returns a `MutationResult` with the created `DefinedName` in `data`.
    pub fn create_named_range(
        &self,
        input: DefinedNameInput,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.create_named_range(input).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Update an existing named range by its unique ID.
    ///
    /// Returns a `MutationResult` with the updated `DefinedName` in `data`.
    pub fn update_named_range(
        &self,
        id: &str,
        updates: NamedRangeUpdate,
    ) -> Result<MutationResult, ComputeApiError> {
        let owned_id = id.to_owned();
        self.dispatch
            .call_engine(move |e| e.update_named_range(&owned_id, updates).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a named range by its unique ID.
    pub fn remove_named_range_by_id(&self, id: &str) -> Result<MutationResult, ComputeApiError> {
        let owned_id = id.to_owned();
        self.dispatch
            .call_engine(move |e| e.remove_named_range_by_id(&owned_id).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove all named ranges in a scope (useful when deleting a sheet).
    ///
    /// Pass `None` to remove workbook-scoped names, or `Some(sheet_id)` for sheet-scoped.
    pub fn remove_named_ranges_by_scope(
        &self,
        scope: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.remove_named_ranges_by_scope(scope).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Add or update a named range definition in the compute engine.
    ///
    /// This is the lower-level API that directly sets a name→def mapping.
    pub fn set_named_range(
        &self,
        name: String,
        def: NamedRangeDef,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.set_named_range(name, def).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a named range by name from the compute engine.
    pub fn remove_named_range(&self, name: &str) -> Result<MutationResult, ComputeApiError> {
        let owned_name = name.to_owned();
        self.dispatch
            .call_engine(move |e| e.remove_named_range(&owned_name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
