//! WorkbookSettings — Workbook-level settings (calculation mode, culture, theme).

use std::collections::HashMap;

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use snapshot_types::MutationResult;

/// Workbook-level settings and configuration.
pub struct WorkbookSettings {
    dispatch: Dispatch,
}

impl WorkbookSettings {
    pub(crate) fn new(dispatch: Dispatch) -> Self {
        Self { dispatch }
    }

    /// Set the workbook culture/locale (e.g., "en-US", "de-DE").
    ///
    /// This updates number formatting, date parsing, and list separators.
    pub fn set_culture(&self, culture: &str) -> Result<MutationResult, ComputeApiError> {
        let owned_culture = culture.to_owned();
        self.dispatch
            .call_engine(move |e| e.set_culture(&owned_culture).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get workbook settings (calculation mode, iteration settings, etc.).
    pub fn get_workbook_settings(
        &self,
    ) -> Result<snapshot_types::WorkbookSettings, ComputeApiError> {
        self.dispatch.query_engine(|e| e.get_workbook_settings())
    }

    /// Set workbook settings.
    pub fn set_workbook_settings(
        &self,
        settings: snapshot_types::WorkbookSettings,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.set_workbook_settings(settings).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Get the theme color palette (slot name -> hex color).
    ///
    /// Returns a cloned `HashMap` since `CultureInfo` is not `Send`.
    pub fn theme_palette(&self) -> Result<HashMap<String, String>, ComputeApiError> {
        self.dispatch.query_engine(|e| e.theme_palette().clone())
    }

    // -----------------------------------------------------------------
    // Atomic settings methods
    // -----------------------------------------------------------------

    /// Set the calculation mode ("auto", "autoNoTable", "manual").
    ///
    /// Atomically reads current settings, updates only the calc mode, and writes back.
    pub fn set_calculation_mode(&self, mode: &str) -> Result<MutationResult, ComputeApiError> {
        let m = mode.to_string();
        self.dispatch
            .call_engine(move |e| e.set_calculation_mode(&m).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Set the maximum iterations for iterative calculation.
    pub fn set_max_iterations(&self, n: u32) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.set_max_iterations(n).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Enable or disable iterative calculation.
    pub fn set_iterative_calculation(
        &self,
        enabled: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        self.dispatch
            .call_engine(move |e| e.set_iterative_calculation(enabled).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
