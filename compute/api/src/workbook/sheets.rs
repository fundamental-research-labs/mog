//! WorkbookSheets — Sheet CRUD operations (add, remove, rename, reorder, copy, hide/show).

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use snapshot_types::MutationResult;

/// Sheet lifecycle and management operations.
pub struct WorkbookSheets {
    dispatch: Dispatch,
}

impl WorkbookSheets {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Create a new sheet with the given name.
    ///
    /// Returns the new sheet's hex ID and the mutation result.
    pub fn create_sheet(&self, name: &str) -> Result<(String, MutationResult), ComputeApiError> {
        let owned_name = name.to_owned();
        self.dispatch
            .call_engine(move |e| e.create_sheet(&owned_name))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Create the implicit default sheet on a freshly-started blank workbook.
    ///
    /// Identical to [`Self::create_sheet`] for store synchronisation, but the
    /// underlying Yrs transaction does not enter the undo stack. Used by the
    /// document lifecycle when no sheet exists in the persisted state.
    pub fn create_default_sheet(
        &self,
        name: &str,
    ) -> Result<(String, MutationResult), ComputeApiError> {
        let owned_name = name.to_owned();
        self.dispatch
            .call_engine(move |e| e.create_default_sheet(&owned_name))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Delete a sheet by its ID.
    ///
    /// Cannot delete the last remaining sheet.
    pub fn delete_sheet(&self, sheet_id: &SheetId) -> Result<MutationResult, ComputeApiError> {
        let sid = *sheet_id;
        self.dispatch
            .call_engine(move |e| e.delete_sheet(&sid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Rename a sheet.
    pub fn rename_sheet(
        &self,
        sheet_id: &SheetId,
        name: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = *sheet_id;
        let owned_name = name.to_owned();
        self.dispatch
            .call_engine(move |e| e.rename_compute_sheet(&sid, &owned_name).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Reorder all sheets. `new_order` is an array of SheetId hex strings.
    pub fn reorder_sheets(
        &self,
        new_order: Vec<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.reorder_sheets(new_order).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Copy a sheet, creating a new sheet with the given name.
    ///
    /// Returns the new sheet's hex ID and the mutation result.
    pub fn copy_sheet(
        &self,
        sheet_id: &SheetId,
        new_name: &str,
    ) -> Result<(String, MutationResult), ComputeApiError> {
        let sid = *sheet_id;
        let owned_name = new_name.to_owned();
        self.dispatch
            .call_engine(move |e| e.copy_sheet(&sid, &owned_name))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set whether a sheet is hidden.
    pub fn set_sheet_hidden(
        &self,
        sheet_id: &SheetId,
        hidden: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = *sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_sheet_hidden(&sid, hidden).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set or clear the tab color for a sheet.
    pub fn set_tab_color(
        &self,
        sheet_id: &SheetId,
        color: Option<&str>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = *sheet_id;
        let owned_color = color.map(|c| c.to_owned());
        self.dispatch
            .call_engine(move |e| e.set_tab_color(&sid, owned_color).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Move a sheet to a new position (0-based index).
    pub fn move_sheet(
        &self,
        sheet_id: &SheetId,
        new_index: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = *sheet_id;
        self.dispatch
            .call_engine(move |e| e.move_sheet(&sid, new_index).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get all settings for a sheet.
    pub fn get_sheet_settings(
        &self,
        sheet_id: &SheetId,
    ) -> Result<domain_types::SheetSettings, ComputeApiError> {
        let sid = *sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_sheet_settings(&sid))
    }

    /// Set a single sheet setting by key and string value.
    pub fn set_sheet_setting(
        &self,
        sheet_id: &SheetId,
        key: &str,
        value: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = *sheet_id;
        let owned_key = key.to_owned();
        let owned_value = value.to_owned();
        self.dispatch
            .call_engine(move |e| {
                e.set_sheet_setting(&sid, &owned_key, &owned_value)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
