//! Hyperlink operations for a single worksheet.
//!
//! Hyperlinks are persisted as cell metadata by the compute engine. This
//! facade keeps the public API typed while leaving address validation and
//! Office.js wire translation to their respective boundaries.

use crate::address::{CellAddress, CellRange};
use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::domain::hyperlink::Hyperlink;
use snapshot_types::MutationResult;

/// Hyperlink operations for a single sheet.
pub struct SheetHyperlinks {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetHyperlinks {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    /// Set an external hyperlink on a cell.
    ///
    /// `display_text`, when supplied, is written as literal cell text and
    /// retained as the hyperlink's display metadata. Omitting it preserves the
    /// current cell value and derives the display text from that value.
    pub fn set_hyperlink(
        &self,
        addr: impl Into<CellAddress>,
        url: impl Into<String>,
        display_text: Option<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let url = url.into();
        self.set_hyperlink_with_metadata(row, col, Some(&url), None, display_text.as_deref(), None)
    }

    /// Set a hyperlink with the full Office.js `RangeHyperlink` field set.
    ///
    /// This is the typed primitive used by the Office.js host. The target is
    /// either `address`, `document_reference`, or both; `text_to_display`
    /// updates the target cell's literal text when present.
    pub fn set_hyperlink_with_metadata(
        &self,
        row: u32,
        col: u32,
        address: Option<&str>,
        document_reference: Option<&str>,
        text_to_display: Option<&str>,
        screen_tip: Option<&str>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let address = address.map(str::to_owned);
        let document_reference = document_reference.map(str::to_owned);
        let text_to_display = text_to_display.map(str::to_owned);
        let screen_tip = screen_tip.map(str::to_owned);
        self.dispatch
            .call_engine(move |e| {
                e.set_hyperlink_with_metadata(
                    &sid,
                    row,
                    col,
                    address,
                    document_reference,
                    text_to_display,
                    screen_tip,
                )
            })
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Get the complete hyperlink metadata for a cell or a containing range
    /// hyperlink.
    pub fn get_hyperlink(
        &self,
        addr: impl Into<CellAddress>,
    ) -> Result<Option<Hyperlink>, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        Ok(self
            .get_all_hyperlinks()?
            .into_iter()
            .find(|link| hyperlink_contains(link, row, col)))
    }

    /// Remove a hyperlink from a cell.
    pub fn remove_hyperlink(
        &self,
        addr: impl Into<CellAddress>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.remove_hyperlink(&sid, row, col))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Get all persisted hyperlink metadata on this sheet.
    pub fn get_all_hyperlinks(&self) -> Result<Vec<Hyperlink>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_hyperlinks(&sid))
    }

    /// Remove hyperlinks from every cell in a rectangular range.
    pub fn clear_hyperlinks(
        &self,
        range: impl Into<CellRange>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (start_row, start_col, end_row, end_col) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| {
                e.clear_hyperlinks_in_range(&sid, start_row, start_col, end_row, end_col)
            })
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }
}

fn hyperlink_contains(link: &Hyperlink, row: u32, col: u32) -> bool {
    CellRange::from(link.cell_ref.as_str())
        .resolve()
        .map(|(start_row, start_col, end_row, end_col)| {
            row >= start_row && row <= end_row && col >= start_col && col <= end_col
        })
        .unwrap_or(false)
}
