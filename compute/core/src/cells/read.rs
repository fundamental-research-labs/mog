//! Read-only accessors for the cell store.

use cell_types::{CellId, ColId, RowId, SheetId, SheetPos};
use formula_types::{IdentityFormula, WorkbookLookup};
use value_types::CellValue;

use super::cell_store::CellStore;
use super::sheet_key::normalize_sheet_key;
use super::types::{MergeRegion, SheetStore};

// ---------------------------------------------------------------------------
// WorkbookLookup implementation for CellStore (unified reference model — formerly
// named CellPositionLookup, renamed + widened to answer resolved_sheet
// uniformly across all six existing IdentityFormulaRef variants).
// ---------------------------------------------------------------------------

/// Wrapper that implements [`WorkbookLookup`] using [`CellStore`]'s
/// existing read methods. The `formula_sheet` field identifies which sheet
/// the formula lives in, so cross-sheet references can include the sheet prefix.
pub struct StorePositionLookup<'a> {
    cell_store: &'a CellStore,
    formula_sheet: SheetId,
}

impl<'a> StorePositionLookup<'a> {
    /// Create a new lookup wrapper.
    pub fn new(cell_store: &'a CellStore, formula_sheet: SheetId) -> Self {
        Self {
            cell_store,
            formula_sheet,
        }
    }
}

impl<'a> WorkbookLookup for StorePositionLookup<'a> {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        let sheet_id = self.cell_store.sheet_for_cell(cell_id)?;
        let pos = self.cell_store.resolve_position(cell_id)?;
        Some((sheet_id, pos.row(), pos.col()))
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.cell_store.row_index_lookup(row_id)
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.cell_store.col_index_lookup(col_id)
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.cell_store.get_sheet(sheet_id).map(|s| s.name.as_str())
    }

    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}

impl CellStore {
    // -----------------------------------------------------------------------
    // Read API
    // -----------------------------------------------------------------------

    /// Sparse authored identities at their current coordinates on one sheet.
    pub fn cells(&self, sheet: &SheetId) -> impl Iterator<Item = (CellId, u32, u32)> + '_ {
        self.sheets
            .get(sheet)
            .into_iter()
            .flat_map(SheetStore::cells)
    }

    pub fn cells_in_range(
        &self,
        sheet: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> impl Iterator<Item = (CellId, u32, u32)> + '_ {
        self.cells(sheet).filter(move |(_, row, col)| {
            *row >= start_row && *row <= end_row && *col >= start_col && *col <= end_col
        })
    }

    pub fn cells_at_or_after_row(&self, sheet: &SheetId, at: u32) -> Vec<(CellId, u32, u32)> {
        self.cells(sheet).filter(|(_, row, _)| *row >= at).collect()
    }

    pub fn cells_at_or_after_col(&self, sheet: &SheetId, at: u32) -> Vec<(CellId, u32, u32)> {
        self.cells(sheet).filter(|(_, _, col)| *col >= at).collect()
    }

    pub fn cells_in_row_range(
        &self,
        sheet: &SheetId,
        at: u32,
        count: u32,
    ) -> Vec<(CellId, u32, u32)> {
        self.cells(sheet)
            .filter(|(_, row, _)| *row >= at && *row < at.saturating_add(count))
            .collect()
    }

    pub fn cells_in_col_range(
        &self,
        sheet: &SheetId,
        at: u32,
        count: u32,
    ) -> Vec<(CellId, u32, u32)> {
        self.cells(sheet)
            .filter(|(_, _, col)| *col >= at && *col < at.saturating_add(count))
            .collect()
    }

    /// Read a cell by identity; arrays expose their top-left scalar.
    pub fn get_cell_value(&self, cell_id: &CellId) -> Option<&CellValue> {
        self.get_cell_value_in_sheet(self.cell_to_sheet.get(cell_id)?, cell_id)
    }

    /// Read the original array value for an anchor, or the cell's scalar.
    pub fn get_cell_value_raw(&self, cell_id: &CellId) -> Option<&CellValue> {
        let sheet = self.sheets.get(self.cell_to_sheet.get(cell_id)?)?;
        if let Some(entry) = sheet.cells.get(cell_id) {
            return Some(&entry.value);
        }
        sheet.value_at(sheet.position_of(cell_id)?)
    }

    pub fn get_cell_value_in_sheet(&self, sheet: &SheetId, cell_id: &CellId) -> Option<&CellValue> {
        let sheet = self.sheets.get(sheet)?;
        if let Some(entry) = sheet.cells.get(cell_id)
            && (!entry.value.is_null()
                || sheet.formulas.contains_key(cell_id)
                || cell_id.is_virtual())
        {
            return match &entry.value {
                CellValue::Array(array) => array.get(0, 0),
                value => Some(value),
            };
        }
        if let Some(pos) = sheet.position_of(cell_id) {
            return sheet.value_at(pos);
        }
        sheet.cells.get(cell_id).map(|entry| &entry.value)
    }

    pub fn get_cell_value_at(&self, sheet: &SheetId, pos: SheetPos) -> Option<&CellValue> {
        self.sheets.get(sheet)?.value_at(pos)
    }

    pub(crate) fn get_column_view(
        &self,
        sheet: &SheetId,
        col: u32,
    ) -> Option<value_types::ColumnView<'_>> {
        self.sheets.get(sheet)?.get_column_view(col)
    }

    /// Get the identity formula for a cell (across all sheets).
    pub fn get_formula(&self, cell_id: &CellId) -> Option<&IdentityFormula> {
        let sheet_id = self.cell_to_sheet.get(cell_id)?;
        let sheet = self.sheets.get(sheet_id)?;
        sheet.formulas.get(cell_id)
    }

    /// Resolve a position to a CellId within a sheet.
    ///
    /// Checks the authored axis-pair map first. If absent, queries the
    /// Range spatial index and synthesizes a virtual CellId for positions
    /// that fall inside a Range.
    pub fn resolve_cell_id(&self, sheet: &SheetId, pos: SheetPos) -> Option<CellId> {
        self.sheets.get(sheet)?.cell_id_at(pos)
    }

    /// Resolve a CellId to its position (across all sheets).
    pub fn resolve_position(&self, cell_id: &CellId) -> Option<SheetPos> {
        let sheet_id = self.cell_to_sheet.get(cell_id)?;
        let sheet = self.sheets.get(sheet_id)?;
        sheet.position_of(cell_id)
    }

    /// Look up a sheet by name (case-insensitive).
    pub fn sheet_by_name(&self, name: &str) -> Option<SheetId> {
        // Try exact (NFC-normalized + lowercased) first, then fall back to
        // XML-entity-decoded form. This catches edge cases where formula sheet
        // names still contain encoded entities (e.g. "&amp;" vs "&").
        let key = normalize_sheet_key(name);
        if let Some(id) = self.sheet_names.get(&key).copied() {
            return Some(id);
        }
        let decoded = compute_parser::decode_xml_entities_str(name);
        self.sheet_names
            .get(&normalize_sheet_key(&decoded))
            .copied()
    }

    /// Return the total number of sheets in the workbook.
    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    /// Get a reference to a SheetStore by SheetId.
    pub fn get_sheet(&self, sheet: &SheetId) -> Option<&SheetStore> {
        self.sheets.get(sheet)
    }

    /// Get a mutable reference to a SheetStore by SheetId.
    ///
    /// Used by Format Range CRUD to update the cell store's spatial index
    /// and format cache.
    pub fn get_sheet_mut(&mut self, sheet: &SheetId) -> Option<&mut SheetStore> {
        self.sheets.get_mut(sheet)
    }

    /// Iterate over all sheet IDs.
    pub fn sheet_ids(&self) -> impl Iterator<Item = &SheetId> {
        self.sheets.keys()
    }

    /// O(1) lookup: which sheet does this CellId belong to?
    pub fn sheet_for_cell(&self, cell_id: &CellId) -> Option<SheetId> {
        self.cell_to_sheet.get(cell_id).copied()
    }

    /// Check whether calculation is enabled for a given sheet.
    /// Returns `true` (calculation enabled) if the sheet does not exist.
    pub fn is_calculation_enabled(&self, sheet_id: &SheetId) -> bool {
        self.sheets
            .get(sheet_id)
            .is_none_or(|s| s.enable_calculation)
    }

    /// Set the enable_calculation flag for a sheet.
    /// No-op if the sheet does not exist.
    pub fn set_enable_calculation(&mut self, sheet_id: &SheetId, enabled: bool) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.enable_calculation = enabled;
        }
    }

    // -----------------------------------------------------------------------
    // Domain cache read API
    // -----------------------------------------------------------------------

    /// Get merge regions for a sheet.
    pub fn get_merge_regions(&self, sheet_id: &SheetId) -> &[MergeRegion] {
        match self.sheets.get(sheet_id) {
            Some(s) => &s.merge_regions,
            None => &[],
        }
    }

    /// Check if a row is hidden.
    pub fn is_row_hidden(&self, sheet_id: &SheetId, row: u32) -> bool {
        self.sheets
            .get(sheet_id)
            .is_some_and(|s| s.hidden_rows.contains(&row))
    }

    /// Check if a column is hidden.
    pub fn is_col_hidden(&self, sheet_id: &SheetId, col: u32) -> bool {
        self.sheets
            .get(sheet_id)
            .is_some_and(|s| s.hidden_cols.contains(&col))
    }

    /// Check if a cell has a comment.
    pub fn has_comment(&self, sheet_id: &SheetId, cell_id: &CellId) -> bool {
        self.sheets
            .get(sheet_id)
            .is_some_and(|s| s.comment_cells.contains(cell_id))
    }

    // -----------------------------------------------------------------------
    // Projection resolution (Dynamic Array Architecture)
    // -----------------------------------------------------------------------

    /// Resolve an element from the source array without a materialized copy.
    pub fn resolve_projected_value(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellValue> {
        self.projection_registry.resolve(sheet, row, col)?;
        Some(
            self.sheets
                .get(sheet)?
                .value_at(SheetPos::new(row, col))
                .cloned()
                .unwrap_or(CellValue::Null),
        )
    }

    /// Check if a cell has a sparkline.
    pub fn has_sparkline(&self, sheet_id: &SheetId, cell_id: &CellId) -> bool {
        self.sheets
            .get(sheet_id)
            .is_some_and(|s| s.sparkline_cells.contains(cell_id))
    }
}
