//! SheetPrint — Print settings, page breaks, print area, and print titles.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::domain::print::{PageBreaks, PrintSettings};
use domain_types::{PrintRange, PrintTitles};
use snapshot_types::MutationResult;

/// Print-related operations for a single sheet.
///
/// Manages page breaks (horizontal/vertical), print area, print titles
/// (repeating rows/columns), and general print settings (orientation,
/// margins, scaling, etc.).
pub struct SheetPrint {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetPrint {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Page breaks
    // -----------------------------------------------------------------

    /// Get all page breaks for the sheet.
    pub fn get_page_breaks(&self) -> Result<PageBreaks, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_page_breaks(&sid))
    }

    /// Add a horizontal page break before the given row.
    pub fn add_horizontal_page_break(&self, row: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.add_horizontal_page_break(&sid, row).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a horizontal page break at the given row.
    pub fn remove_horizontal_page_break(
        &self,
        row: u32,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.remove_horizontal_page_break(&sid, row).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Add a vertical page break before the given column.
    pub fn add_vertical_page_break(&self, col: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.add_vertical_page_break(&sid, col).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove a vertical page break at the given column.
    pub fn remove_vertical_page_break(&self, col: u32) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.remove_vertical_page_break(&sid, col).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear all page breaks for the sheet.
    pub fn clear_all_page_breaks(&self) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_all_page_breaks(&sid).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Print area
    // -----------------------------------------------------------------

    /// Get the print area for the sheet.
    pub fn get_print_area(&self) -> Result<Option<PrintRange>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_print_area(&sid))
    }

    /// Set or clear the print area for the sheet.
    pub fn set_print_area(
        &self,
        area: Option<PrintRange>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_print_area(&sid, area).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Print titles
    // -----------------------------------------------------------------

    /// Get print titles (repeating rows/columns) for the sheet.
    pub fn get_print_titles(&self) -> Result<PrintTitles, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_print_titles(&sid))
    }

    /// Set print titles (repeating rows/columns) for the sheet.
    pub fn set_print_titles(&self, titles: PrintTitles) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_print_titles(&sid, titles).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Print settings
    // -----------------------------------------------------------------

    /// Set print settings (orientation, margins, scaling, etc.) for the sheet.
    pub fn set_print_settings(
        &self,
        settings: PrintSettings,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_print_settings(&sid, settings).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    // -----------------------------------------------------------------
    // Header/footer images
    // -----------------------------------------------------------------

    /// Get all header/footer images for the sheet.
    pub fn get_hf_images(
        &self,
    ) -> Result<Vec<domain_types::domain::print::HeaderFooterImageInfo>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_hf_images(&sid))
    }

    /// Set or replace a header/footer image at the specified position.
    pub fn set_hf_image(
        &self,
        info: domain_types::domain::print::HeaderFooterImageInfo,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.set_hf_image(&sid, info).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Remove the header/footer image at the specified position.
    pub fn remove_hf_image(
        &self,
        position: domain_types::domain::print::HfImagePosition,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.remove_hf_image(&sid, position).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }
}
