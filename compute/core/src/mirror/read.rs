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

    /// Look up a cell value by CellId across all sheets.
    ///
    /// If the stored value is a `CellValue::Array` (a dynamic array source),
    /// this returns the top-left element for backwards compatibility. Use
    /// [`get_cell_value_raw`] to retrieve the full Array.
    ///
    /// For ghost cells (Null value, no formula) at projected positions, falls
    /// back to `col_data` to read the materialized projection value. This
    /// ensures that formulas like `=A2` correctly see spilled values.
    pub fn get_cell_value(&self, cell_id: &CellId) -> Option<&CellValue> {
        let sheet_id = self.cell_to_sheet.get(cell_id);
        if let Some(sheet_id) = sheet_id {
            let sheet = self.sheets.get(sheet_id)?;
            if let Some(entry) = sheet.cells.get(cell_id) {
                if let CellValue::Array(ref arr) = entry.value {
                    return arr.get(0, 0);
                }
                // Virtual CellId with explicit Null override: return it as-is
                // rather than falling through to col_data (which would return
                // the Range payload value).
                if cell_id.is_virtual() && entry.value.is_null() && entry.formula.is_none() {
                    return Some(&entry.value);
                }
                if entry.value.is_null()
                    && entry.formula.is_none()
                    && let Some(pos) = sheet.id_to_pos.get(cell_id)
                    && let Some(col_vec) = sheet.col_data.get(&pos.col())
                    && let Some(val) = col_vec.get(pos.row() as usize)
                    && !val.is_null()
                {
                    return Some(val);
                }
                return Some(&entry.value);
            }
            // Virtual CellId not in cells: read from Range payload via col_data
            if cell_id.is_virtual()
                && let Some(pos) = sheet.id_to_pos.get(cell_id)
                && let Some(col_vec) = sheet.col_data.get(&pos.col())
                && let Some(val) = col_vec.get(pos.row() as usize)
                && !val.is_null()
            {
                return Some(val);
            }
        }
        None
    }

    /// Look up the raw cell value by CellId (without Array unwrapping).
    ///
    /// Returns the stored `CellValue` as-is, including `CellValue::Array`
    /// for dynamic array source cells. Used by ANCHORARRAY (#) to retrieve
    /// the full array.
    pub fn get_cell_value_raw(&self, cell_id: &CellId) -> Option<&CellValue> {
        let sheet_id = self.cell_to_sheet.get(cell_id)?;
        let sheet = self.sheets.get(sheet_id)?;
        if let Some(entry) = sheet.cells.get(cell_id) {
            return Some(&entry.value);
        }
        // Virtual CellId not in cells: fall back to col_data
        if cell_id.is_virtual()
            && let Some(pos) = sheet.id_to_pos.get(cell_id)
            && let Some(col_vec) = sheet.col_data.get(&pos.col())
            && let Some(val) = col_vec.get(pos.row() as usize)
            && !val.is_null()
        {
            return Some(val);
        }
        None
    }

    /// Look up a cell value by CellId within a specific sheet.
    ///
    /// Unwraps `CellValue::Array` to the top-left element (same as [`get_cell_value`]).
    pub fn get_cell_value_in_sheet(&self, sheet: &SheetId, cell_id: &CellId) -> Option<&CellValue> {
        let s = self.sheets.get(sheet)?;
        if let Some(entry) = s.cells.get(cell_id) {
            if let CellValue::Array(ref arr) = entry.value {
                return arr.get(0, 0);
            }
            // Virtual CellId with explicit Null override
            if cell_id.is_virtual() && entry.value.is_null() && entry.formula.is_none() {
                return Some(&entry.value);
            }
            if entry.value.is_null()
                && entry.formula.is_none()
                && let Some(pos) = s.id_to_pos.get(cell_id)
                && let Some(col_vec) = s.col_data.get(&pos.col())
                && let Some(val) = col_vec.get(pos.row() as usize)
                && !val.is_null()
            {
                return Some(val);
            }
            return Some(&entry.value);
        }
        // Virtual CellId not in cells: read from col_data
        if cell_id.is_virtual()
            && let Some(pos) = s.id_to_pos.get(cell_id)
            && let Some(col_vec) = s.col_data.get(&pos.col())
            && let Some(val) = col_vec.get(pos.row() as usize)
            && !val.is_null()
        {
            return Some(val);
        }
        None
    }

    /// Look up a cell value by position within a sheet.
    ///
    /// Checks both `pos_to_id` → `cells` (real cells) and `col_data` (which
    /// includes materialized projection values from dynamic arrays). If a real
    /// cell exists with a non-null value, returns it. Otherwise, falls back to
    /// col_data which may have a projected value at that position.
    ///
    /// For dynamic array source cells, unwraps `CellValue::Array` to the
    /// top-left element so normal positional reads see the scalar.
    pub fn get_cell_value_at(&self, sheet: &SheetId, pos: SheetPos) -> Option<&CellValue> {
        let s = self.sheets.get(sheet)?;
        // Step 1: sparse override or real cell with non-null value/formula
        if let Some(cell_id) = s.pos_to_id.get(&pos)
            && let Some(entry) = s.cells.get(cell_id)
            && (!entry.value.is_null() || entry.formula.is_some())
        {
            if let CellValue::Array(ref arr) = entry.value {
                return arr.get(0, 0);
            }
            return Some(&entry.value);
        }
        // Step 2: Range spatial index — payload value
        if !s.range_spatial_index.is_empty() {
            let hits = s.range_spatial_index.query(pos.row(), pos.col());
            if !hits.is_empty()
                && let Some(row_id) = s.index_to_row.get(&pos.row())
                && let Some(col_id) = s.index_to_col.get(&pos.col())
            {
                for extent in &hits {
                    if let Some(rv) = s.range_views.get(&extent.range_id)
                        && let Some(val) = rv.decode_at(row_id, col_id)
                        && !val.is_null()
                    {
                        // We can't return a reference to a decoded
                        // value, so fall through to col_data which
                        // should have the materialized value.
                        break;
                    }
                }
            }
            // Range-resident values are materialized into col_data by
            // rebuild_col_data; fall through to the col_data check.
        }
        // Step 3: col_data for materialized projection / Range values
        if let Some(col_vec) = s.col_data.get(&pos.col())
            && let Some(val) = col_vec.get(pos.row() as usize)
            && !val.is_null()
        {
            return Some(val);
        }
        // Step 4: real-cell Null fallback
        if let Some(cell_id) = s.pos_to_id.get(&pos) {
            return s.cells.get(cell_id).map(|e| &e.value);
        }
        None
    }

    /// Get a column's dense data as a slice, if available.
    pub(crate) fn get_column_slice(&self, sheet: &SheetId, col: u32) -> Option<&[CellValue]> {
        self.sheets.get(sheet)?.get_column_slice(col)
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
        let row_id = s.index_to_row.get(&pos.row()).copied()?;
        let col_id = s.index_to_col.get(&pos.col()).copied()?;
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

    pub(crate) fn cell_to_sheet_entries(&self) -> impl Iterator<Item = (&CellId, &SheetId)> {
        self.cell_to_sheet.iter()
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

    /// Resolve a projected value by checking the projection registry and reading from col_data.
    ///
    /// Projected values are materialized into col_data, so this method reads directly
    /// from col_data rather than requiring the source cell to store the full CellValue::Array.
    /// Falls back to reading from the source cell's CellEntry.value if it holds an Array
    /// (for backward compatibility during the transition).
    ///
    /// Returns `Some(CellValue)` if the position falls within a registered projection.
    /// Returns `None` if the position is not projected.
    pub fn resolve_projected_value(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<CellValue> {
        let (_source, _er, _ec) = self.projection_registry.resolve(sheet, row, col)?;

        // Read directly from col_data (materialized by materialize_projection)
        let sheet_mirror = self.sheets.get(sheet)?;
        if let Some(col_vec) = sheet_mirror.col_data.get(&col)
            && (row as usize) < col_vec.len()
        {
            let val = &col_vec[row as usize];
            if !val.is_null() {
                return Some(val.clone());
            }
        }

        // Fallback: try reading from source cell's Array value (backward compat)
        let source_sheet = self.cell_to_sheet.get(&_source).unwrap_or(sheet);
        let sm = self.sheets.get(source_sheet)?;
        let entry = sm.cells.get(&_source)?;
        match &entry.value {
            CellValue::Array(arr) => arr
                .get(_er as usize, _ec as usize)
                .cloned()
                .or(Some(CellValue::Null)),
            other if _er == 0 && _ec == 0 => Some(other.clone()),
            _ => Some(CellValue::Null),
        }
    }

    /// Check if a cell has a sparkline.
    pub fn has_sparkline(&self, sheet_id: &SheetId, cell_id: &CellId) -> bool {
        self.sheets
            .get(sheet_id)
            .is_some_and(|s| s.sparkline_cells.contains(cell_id))
    }
}
