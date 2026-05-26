//! Sheet facade — core cell operations and access to domain sub-APIs.
//!
//! A `Sheet` handle provides ergonomic access to cells within a single sheet.
//! It holds a clone of the Dispatch handle and a SheetId.

use crate::address::{CellAddress, CellRange};
use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use compute_core::ZOrderEntry;
use domain_types::Comment;
use snapshot_types::MutationResult;
use value_types::CellValue;

// Domain sub-APIs
pub mod bindings;
pub mod charts;
pub mod comments;
pub mod conditional;
pub mod filters;
pub mod formats;
pub mod hyperlinks;
pub mod layout;
pub mod objects;
pub mod outline;
pub mod pivots;
pub mod print;
pub mod protection;
pub mod slicers;
pub mod sparklines;
pub mod structure;
pub mod tables;
pub mod validation;

/// Handle to a single sheet within a workbook.
///
/// `Sheet` is `Clone` — cloning produces another handle to the same sheet.
/// All operations are dispatched to the engine thread (native) or called
/// directly (WASM).
pub struct Sheet {
    pub(crate) dispatch: Dispatch,
    pub(crate) sheet_id: SheetId,
}

impl Clone for Sheet {
    fn clone(&self) -> Self {
        Sheet {
            dispatch: self.dispatch.clone(),
            sheet_id: self.sheet_id,
        }
    }
}

impl Sheet {
    /// Create a new Sheet handle (called by Workbook, not public).
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Sheet { dispatch, sheet_id }
    }

    /// Returns the sheet's ID.
    pub fn id(&self) -> &SheetId {
        &self.sheet_id
    }

    /// Returns the sheet's name.
    pub fn name(&self) -> Result<String, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_sheet_name(&sid))
            .and_then(|opt| {
                opt.ok_or_else(|| ComputeApiError::SheetNotFound {
                    id: self.sheet_id.to_uuid_string(),
                })
            })
    }

    // -----------------------------------------------------------------
    // Cell write operations
    // -----------------------------------------------------------------

    /// Set a cell's value. Accepts A1 notation ("B2") or position (row, col).
    pub fn set_cell(
        &self,
        addr: impl Into<CellAddress>,
        value: impl Into<String>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        let input = value.into();
        self.dispatch
            .call_engine(move |e| e.set_cell_value_parsed(&sid, row, col, &input))
            .and_then(|r| {
                r.map(|(_vp, mutation)| mutation)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Set a range of cells from a 2D grid of values.
    pub fn set_range(
        &self,
        range: impl Into<CellRange>,
        values: &[Vec<String>],
    ) -> Result<MutationResult, ComputeApiError> {
        let (start_row, start_col, _end_row, _end_col) = range.into().resolve()?;
        let sid = self.sheet_id;
        let mut updates = Vec::new();
        for (i, row_values) in values.iter().enumerate() {
            for (j, val) in row_values.iter().enumerate() {
                updates.push((start_row + i as u32, start_col + j as u32, val.clone()));
            }
        }
        self.dispatch
            .call_engine(move |e| e.set_cell_values_parsed(&sid, updates))
            .and_then(|r| {
                r.map(|(_vp, mutation)| mutation)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Clear all cells in a range.
    pub fn clear_range(
        &self,
        range: impl Into<CellRange>,
    ) -> Result<MutationResult, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_range(&sid, sr, sc, er, ec).map(|(_, r)| r))
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Clear a range with a specific mode: "all", "contents", "formats", or "hyperlinks".
    pub fn clear_with_mode(
        &self,
        range: impl Into<CellRange>,
        mode: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        let m = mode.to_string();
        self.dispatch
            .call_engine(move |e| {
                e.clear_range_with_mode(&sid, sr, sc, er, ec, &m)
                    .map(|(_, r)| r)
            })
            .and_then(|r| r.map_err(ComputeApiError::from))
    }

    /// Check whether a cell can be edited given the sheet's protection state.
    pub fn can_edit_cell(&self, addr: impl Into<CellAddress>) -> Result<bool, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.can_edit_cell(&sid, row, col))
    }

    /// Check whether a structural operation is allowed given sheet protection.
    pub fn can_do_structure_op(&self, operation: &str) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        let op = operation.to_string();
        self.dispatch
            .query_engine(move |e| e.can_do_structure_op(&sid, &op))
    }

    // -----------------------------------------------------------------
    // Cell read operations
    // -----------------------------------------------------------------

    /// Get the formatted display value of a cell (what the user sees).
    pub fn get_display_value(
        &self,
        addr: impl Into<CellAddress>,
    ) -> Result<String, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_display_value(&sid, row, col))
    }

    /// Get the raw value of a cell (formula bar content).
    pub fn get_raw_value(&self, addr: impl Into<CellAddress>) -> Result<String, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_raw_value(&sid, row, col))
    }

    /// Get the formula string if the cell contains a formula, otherwise `None`.
    pub fn get_formula(
        &self,
        addr: impl Into<CellAddress>,
    ) -> Result<Option<String>, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        let raw = self
            .dispatch
            .query_engine(move |e| e.get_raw_value(&sid, row, col))?;
        if raw.starts_with('=') {
            Ok(Some(raw))
        } else {
            Ok(None)
        }
    }

    /// Get the semantic value of a cell: computed value for formula cells, raw value otherwise.
    ///
    /// This is the "getValue" semantic used by SDKs — if the cell has a formula,
    /// the computed result is returned; otherwise the stored raw value is returned.
    /// Empty cells return `CellValue::Null`.
    pub fn get_cell_value(
        &self,
        addr: impl Into<CellAddress>,
    ) -> Result<CellValue, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_cell_value(&sid, row, col))
    }

    /// Get a 2D grid of cell values for a range, using getValue semantics.
    ///
    /// Returns a row-major `Vec<Vec<CellValue>>` where each inner vec is one row.
    /// Empty cells appear as `CellValue::Null`.
    pub fn get_range_values_2d(
        &self,
        range: impl Into<CellRange>,
    ) -> Result<Vec<Vec<CellValue>>, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_range_values_2d(&sid, sr, sc, er, ec))
    }

    /// Get full cell data as JSON (value, formula, format, etc.).
    pub fn get_cell_data(
        &self,
        addr: impl Into<CellAddress>,
    ) -> Result<Option<serde_json::Value>, ComputeApiError> {
        let (row, col) = addr.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_cell_data(&sid, row, col))
    }

    /// Sort a range by the given specifications.
    pub fn sort_range(
        &self,
        range: impl Into<CellRange>,
        options: compute_core::bridge_types::BridgeSortOptions,
    ) -> Result<MutationResult, ComputeApiError> {
        let (sr, sc, er, ec) = range.into().resolve()?;
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.sort_range(&sid, sr, sc, er, ec, options))
            .and_then(|r| {
                r.map(|(_vp, mutation)| mutation)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Get the data bounds (used range) of the sheet.
    pub fn get_data_bounds(
        &self,
    ) -> Result<Option<compute_core::engine_types::DataBounds>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_data_bounds(&sid))
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    /// Find all cells whose value loosely matches the given string.
    ///
    /// Loose matching: `"42"` matches `Number(42.0)` and vice versa.
    /// When `range` is `None`, the full data extent is searched.
    /// Returns `(row, col)` pairs.
    pub fn find_by_value(
        &self,
        value: &str,
        range: Option<impl Into<CellRange>>,
    ) -> Result<Vec<(u32, u32)>, ComputeApiError> {
        let sid = self.sheet_id;
        let (sr, sc, er, ec) = if let Some(r) = range {
            let (sr, sc, er, ec) = r.into().resolve()?;
            (Some(sr), Some(sc), Some(er), Some(ec))
        } else {
            (None, None, None, None)
        };
        let val = value.to_string();
        self.dispatch
            .query_engine(move |e| e.find_cells_by_value(&sid, &val, sr, sc, er, ec))
    }

    /// Find all cells whose formula matches a regex pattern.
    ///
    /// The regex is matched against the A1-style formula string.
    /// Returns `(row, col)` pairs.
    pub fn find_by_formula(&self, pattern: &str) -> Result<Vec<(u32, u32)>, ComputeApiError> {
        let sid = self.sheet_id;
        let pat = pattern.to_string();
        self.dispatch
            .query_engine(move |e| e.find_cells_by_formula(&sid, &pat))
    }

    // -----------------------------------------------------------------
    // Comments convenience
    // -----------------------------------------------------------------

    /// Get all comments in this sheet, including their resolved/unresolved state.
    ///
    /// Each [`Comment`] carries a `resolved: Option<bool>` field indicating
    /// whether the thread has been marked as resolved. This is a convenience
    /// method equivalent to `sheet.comments().get_all()`.
    pub fn get_comments_with_resolved_state(&self) -> Result<Vec<Comment>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_comments(&sid))
    }

    // -----------------------------------------------------------------
    // Domain sub-APIs
    // -----------------------------------------------------------------

    /// Cell formatting operations.
    pub fn formats(&self) -> formats::SheetFormats {
        formats::SheetFormats::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Structural operations (insert/delete rows/cols, merges).
    pub fn structure(&self) -> structure::SheetStructure {
        structure::SheetStructure::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Layout operations (row heights, col widths, visibility).
    pub fn layout(&self) -> layout::SheetLayout {
        layout::SheetLayout::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Table CRUD operations.
    pub fn tables(&self) -> tables::SheetTables {
        tables::SheetTables::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Chart CRUD operations.
    pub fn charts(&self) -> charts::SheetCharts {
        charts::SheetCharts::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Filter and sort operations.
    pub fn filters(&self) -> filters::SheetFilters {
        filters::SheetFilters::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Threaded comments CRUD.
    pub fn comments(&self) -> comments::SheetComments {
        comments::SheetComments::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Conditional formatting rules.
    pub fn conditional_formats(&self) -> conditional::SheetConditionalFormats {
        conditional::SheetConditionalFormats::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Data validation / schema operations.
    pub fn validation(&self) -> validation::SheetValidation {
        validation::SheetValidation::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Hyperlink operations.
    pub fn hyperlinks(&self) -> hyperlinks::SheetHyperlinks {
        hyperlinks::SheetHyperlinks::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Sheet protection operations.
    pub fn protection(&self) -> protection::SheetProtection {
        protection::SheetProtection::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Print settings, page breaks, print area/titles.
    pub fn print(&self) -> print::SheetPrint {
        print::SheetPrint::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Sparkline CRUD.
    pub fn sparklines(&self) -> sparklines::SheetSparklines {
        sparklines::SheetSparklines::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Row/col grouping, subtotals, outline levels.
    pub fn outline(&self) -> outline::SheetOutline {
        outline::SheetOutline::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Pivot table operations.
    pub fn pivots(&self) -> pivots::SheetPivots {
        pivots::SheetPivots::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Slicer CRUD.
    pub fn slicers(&self) -> slicers::SheetSlicers {
        slicers::SheetSlicers::new(self.dispatch.clone(), self.sheet_id)
    }

    /// External data binding CRUD.
    pub fn bindings(&self) -> bindings::SheetBindings {
        bindings::SheetBindings::new(self.dispatch.clone(), self.sheet_id)
    }

    /// Floating objects CRUD.
    pub fn objects(&self) -> objects::SheetObjects {
        objects::SheetObjects::new(self.dispatch.clone(), self.sheet_id)
    }

    // -----------------------------------------------------------------
    // Unified z-order (across charts and floating objects)
    // -----------------------------------------------------------------

    /// Get the maximum z-index across all charts and floating objects.
    pub fn get_max_z_index(&self) -> Result<i32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_max_z_index_all(&sid))
    }

    /// Get the minimum z-index across all charts and floating objects.
    pub fn get_min_z_index(&self) -> Result<i32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_min_z_index_all(&sid))
    }

    /// Get all charts and floating objects interleaved by z-order (back to front).
    pub fn get_all_in_z_order(&self) -> Result<Vec<ZOrderEntry>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_in_z_order(&sid))
    }
}
