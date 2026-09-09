//! Read-only accessors for the cell mirror.

use cell_types::{CellId, ColId, RowId, SheetId, SheetPos};
use formula_types::{IdentityFormula, WorkbookLookup};
use value_types::CellValue;

use super::cell_mirror::CellMirror;
use super::sheet_key::normalize_sheet_key;
use super::types::{MergeRegion, SheetMirror};

// ---------------------------------------------------------------------------
// WorkbookLookup implementation for CellMirror (unified reference model — formerly
// named CellPositionLookup, renamed + widened to answer resolved_sheet
// uniformly across all six existing IdentityFormulaRef variants).
// ---------------------------------------------------------------------------

/// Wrapper that implements [`WorkbookLookup`] using [`CellMirror`]'s
/// existing read methods. The `formula_sheet` field identifies which sheet
/// the formula lives in, so cross-sheet references can include the sheet prefix.
pub struct MirrorPositionLookup<'a> {
    mirror: &'a CellMirror,
    formula_sheet: SheetId,
}

impl<'a> MirrorPositionLookup<'a> {
    /// Create a new lookup wrapper.
    pub fn new(mirror: &'a CellMirror, formula_sheet: SheetId) -> Self {
        Self {
            mirror,
            formula_sheet,
        }
    }
}

impl<'a> WorkbookLookup for MirrorPositionLookup<'a> {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        let sheet_id = self.mirror.sheet_for_cell(cell_id)?;
        let pos = self.mirror.resolve_position(cell_id)?;
        Some((sheet_id, pos.row(), pos.col()))
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.mirror.row_index_lookup(row_id)
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.mirror.col_index_lookup(col_id)
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.mirror.get_sheet(sheet_id).map(|s| s.name.as_str())
    }

    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}

impl CellMirror {
    // -----------------------------------------------------------------------
    // Read API
    // -----------------------------------------------------------------------

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
        sheet.value_at(*sheet.id_to_pos.get(cell_id)?)
    }

    pub fn get_cell_value_in_sheet(&self, sheet: &SheetId, cell_id: &CellId) -> Option<&CellValue> {
        let sheet = self.sheets.get(sheet)?;
        if let Some(entry) = sheet.cells.get(cell_id)
            && (!entry.is_ghost() || cell_id.is_virtual())
        {
            return match &entry.value {
                CellValue::Array(array) => array.get(0, 0),
                value => Some(value),
            };
        }
        if let Some(pos) = sheet.id_to_pos.get(cell_id) {
            return sheet.value_at(*pos);
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
        sheet.cells.get(cell_id).and_then(|e| e.formula.as_deref())
    }

    /// Resolve a position to a CellId within a sheet.
    ///
    /// Checks the anchored `pos_to_id` map first. If absent, queries the
    /// Range spatial index and synthesizes a virtual CellId for positions
    /// that fall inside a Range.
    pub fn resolve_cell_id(&self, sheet: &SheetId, pos: SheetPos) -> Option<CellId> {
        let s = self.sheets.get(sheet)?;
        if let Some(id) = s.pos_to_id.get(&pos).copied() {
            return Some(id);
        }
        let hits = s.range_spatial_index.query(pos.row(), pos.col());
        if hits.is_empty() {
            return None;
        }
        let row_id = s.row_id_at(pos.row())?;
        let col_id = s.col_id_at(pos.col())?;
        Some(CellId::virtual_at(*sheet, row_id, col_id))
    }

    /// Resolve a CellId to its position (across all sheets).
    pub fn resolve_position(&self, cell_id: &CellId) -> Option<SheetPos> {
        let sheet_id = self.cell_to_sheet.get(cell_id)?;
        let sheet = self.sheets.get(sheet_id)?;
        sheet.id_to_pos.get(cell_id).copied()
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

    /// Get a reference to a SheetMirror by SheetId.
    pub fn get_sheet(&self, sheet: &SheetId) -> Option<&SheetMirror> {
        self.sheets.get(sheet)
    }

    /// Get a mutable reference to a SheetMirror by SheetId.
    ///
    /// Used by Format Range CRUD to update the mirror's spatial index
    /// and format cache.
    pub fn get_sheet_mut(&mut self, sheet: &SheetId) -> Option<&mut SheetMirror> {
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

    /// Get the custom height for a row, if set.
    pub fn get_row_height(&self, sheet_id: &SheetId, row: u32) -> Option<f64> {
        self.sheets.get(sheet_id)?.row_heights.get(&row).copied()
    }

    /// Get the custom width for a column, if set.
    pub fn get_col_width(&self, sheet_id: &SheetId, col: u32) -> Option<f64> {
        self.sheets.get(sheet_id)?.col_widths.get(&col).copied()
    }

    /// Check if a row is hidden.
    pub fn is_row_hidden(&self, sheet_id: &SheetId, row: u32) -> bool {
        self.cell_metadata_provider
            .as_ref()
            .and_then(|provider| provider.row_hidden(self, sheet_id, row))
            .unwrap_or_else(|| {
                self.sheets
                    .get(sheet_id)
                    .is_some_and(|s| s.hidden_rows.contains(&row))
            })
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
