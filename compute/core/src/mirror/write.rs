//! Mutable cell operations for the cell mirror.

use cell_types::{CellId, IdAllocator, SheetId, SheetPos};
use formula_types::IdentityFormula;
use value_types::CellValue;

use super::cell_mirror::CellMirror;
use super::types::{CellEdit, CellEntry};

impl CellMirror {
    // -----------------------------------------------------------------------
    // Write API (called during recalc + init)
    // -----------------------------------------------------------------------

    /// Set the value of an existing cell (mutable, across all sheets).
    pub fn set_value_mut(&mut self, cell_id: &CellId, value: CellValue) -> bool {
        let sheet_id = match self.cell_to_sheet.get(cell_id).copied() {
            Some(sid) => sid,
            None => return false,
        };
        let mut invalidate_col: Option<u32> = None;
        if let Some(sheet) = self.sheets.get_mut(&sheet_id) {
            if let Some(entry) = sheet.cells.get_mut(cell_id) {
                if let Some(&pos) = sheet.id_to_pos.get(cell_id) {
                    let (row, col) = (pos.row(), pos.col());
                    let col_vec = sheet.col_data.entry(col).or_insert_with(|| {
                        let len = std::cmp::max(sheet.rows as usize, row as usize + 1);
                        vec![CellValue::Null; len]
                    });
                    #[cfg(feature = "journal")]
                    let old_val_for_journal = if (row as usize) < col_vec.len() {
                        col_vec[row as usize].clone()
                    } else {
                        CellValue::Null
                    };
                    if (row as usize) < col_vec.len() {
                        col_vec[row as usize] = value.clone();
                    } else {
                        col_vec.resize(row as usize + 1, CellValue::Null);
                        col_vec[row as usize] = value.clone();
                    }
                    // Expand sheet dimensions so range materialisation sees the cells.
                    if pos.row() + 1 > sheet.rows {
                        sheet.rows = pos.row() + 1;
                    }
                    if pos.col() + 1 > sheet.cols {
                        sheet.cols = pos.col() + 1;
                    }
                    if pos.row() + 1 > sheet.grid_rows {
                        sheet.grid_rows = pos.row() + 1;
                    }
                    if pos.col() + 1 > sheet.grid_cols {
                        sheet.grid_cols = pos.col() + 1;
                    }
                    invalidate_col = Some(col);
                    #[cfg(feature = "journal")]
                    crate::journal_write!(
                        sheet_id,
                        row,
                        col,
                        &old_val_for_journal,
                        &value,
                        "set_value_mut",
                        Some(*cell_id)
                    );
                }
                entry.value = value;
            } else {
                return false;
            }
        } else {
            return false;
        }
        if let Some(col) = invalidate_col {
            self.dense_cache.invalidate(&sheet_id, col);
            self.bump_col_version(&sheet_id, col);
        }
        true
    }

    /// Set the CellEntry.value without updating col_data.
    ///
    /// Used by dynamic array spill handling to store the full `CellValue::Array` in the
    /// source cell's entry while col_data retains the top-left scalar for aggregation
    /// reads. Normal writes should use `set_value_mut` which updates both.
    pub fn set_entry_value_only(&mut self, cell_id: &CellId, value: CellValue) -> bool {
        if let Some(sheet_id) = self.cell_to_sheet.get(cell_id)
            && let Some(sheet) = self.sheets.get_mut(sheet_id)
            && let Some(entry) = sheet.cells.get_mut(cell_id)
        {
            #[cfg(feature = "journal")]
            {
                let old_val = crate::journal::journal_fmt_value(&entry.value);
                let new_val = crate::journal::journal_fmt_value(&value);
                crate::journal::record(crate::journal::JournalEvent::EntryWrite {
                    cell: *cell_id,
                    field: "value",
                    old_value: old_val,
                    new_value: new_val,
                    source: "set_entry_value_only",
                });
            }
            entry.value = value;
            return true;
        }
        false
    }

    /// Set the formula of an existing cell (across all sheets).
    pub fn set_formula(&mut self, cell_id: &CellId, formula: Option<IdentityFormula>) -> bool {
        if let Some(sheet_id) = self.cell_to_sheet.get(cell_id)
            && let Some(sheet) = self.sheets.get_mut(sheet_id)
            && let Some(entry) = sheet.cells.get_mut(cell_id)
        {
            entry.formula = formula.map(Box::new);
            return true;
        }
        false
    }

    /// Insert a cell into a specific sheet at the given position.
    ///
    /// Silently ignored if the sheet does not exist.
    pub fn insert_cell(
        &mut self,
        sheet: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        entry: CellEntry,
    ) {
        if let Some(s) = self.sheets.get_mut(sheet) {
            // Update column store (grow or create if needed)
            let col_vec = s.col_data.entry(pos.col()).or_insert_with(|| {
                let len = std::cmp::max(s.rows as usize, pos.row() as usize + 1);
                vec![CellValue::Null; len]
            });
            if (pos.row() as usize) < col_vec.len() {
                col_vec[pos.row() as usize] = entry.value.clone();
            } else {
                col_vec.resize(pos.row() as usize + 1, CellValue::Null);
                col_vec[pos.row() as usize] = entry.value.clone();
            }
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet);
            s.expand_extent(pos);
        }
        // Invalidate dense column cache for the affected column.
        self.dense_cache.invalidate(sheet, pos.col());
        self.bump_col_version(sheet, pos.col());
    }

    /// Clear the mirror's position-keyed state at `pos` on `sheet_id` without
    /// disturbing the CellId-keyed maps. Used by same-sheet `relocate_cells`,
    /// where a moved CellId now lives at a NEW position but the OLD position
    /// still holds stale entries in `pos_to_id` / `col_data` because
    /// `apply_edit` only writes the destination side. `id_to_pos` and `cells`
    /// already reflect the new position (the move's `apply_edit` overwrote
    /// them) and must NOT be touched here — the cell hasn't been deleted,
    /// just relocated.
    ///
    /// No-op if the position holds no entry.
    pub fn vacate_position(&mut self, sheet_id: &SheetId, pos: SheetPos) {
        let mut invalidate_col: Option<u32> = None;
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            // Drop the position→id mapping. Don't touch id_to_pos / cells:
            // those already point at the moved cell's new position.
            if s.pos_to_id.remove(&pos).is_some() {
                invalidate_col = Some(pos.col());
            }
            if let Some(col_vec) = s.col_data.get_mut(&pos.col())
                && (pos.row() as usize) < col_vec.len()
                && !matches!(col_vec[pos.row() as usize], CellValue::Null)
            {
                col_vec[pos.row() as usize] = CellValue::Null;
                invalidate_col = Some(pos.col());
            }
            // If this column has Range-backed data, rebuild col_data so
            // the payload value is restored instead of leaving Null.
            // For non-Range columns this returns early (no-op).
            s.rebuild_col_data(pos.col());
        }
        if let Some(col) = invalidate_col {
            self.dense_cache.invalidate(sheet_id, col);
            self.bump_col_version(sheet_id, col);
        }
    }

    /// Update the id_to_pos entry for a cell without touching pos_to_id or
    /// col_data.  Used after a yrs gridIndex change is detected (e.g. undo of
    /// same-sheet relocate_cells) to pre-warm the mirror position so that
    /// apply_cell_changes resolves the correct new position when it runs.
    ///
    /// Callers should call `vacate_position(old_pos)` first to clean up the
    /// stale pos_to_id / col_data slot at the former position.
    pub fn update_id_to_pos(&mut self, sheet_id: &SheetId, cell_id: CellId, new_pos: SheetPos) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.id_to_pos.insert(cell_id, new_pos);
        }
    }

    /// Synchronize the position-keyed mirror state for an existing CellId after
    /// a yrs gridIndex-only move. Cell payloads are keyed by CellId and may not
    /// fire a separate cell observer event, so position-only undo/redo still
    /// needs to repopulate `pos_to_id` and `col_data` from the existing entry.
    pub fn sync_cell_position_mapping(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
    ) {
        let mut invalidate_col = false;
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet_id);

            if let Some(value) = s.cells.get(&cell_id).map(|entry| entry.value.clone()) {
                let col_vec = s.col_data.entry(pos.col()).or_insert_with(|| {
                    let len = std::cmp::max(s.rows as usize, pos.row() as usize + 1);
                    vec![CellValue::Null; len]
                });
                if (pos.row() as usize) < col_vec.len() {
                    col_vec[pos.row() as usize] = value;
                } else {
                    col_vec.resize(pos.row() as usize + 1, CellValue::Null);
                    col_vec[pos.row() as usize] = value;
                }
                invalidate_col = true;
            }

            s.expand_extent(pos);
        }

        if invalidate_col {
            self.dense_cache.invalidate(sheet_id, pos.col());
            self.bump_col_version(sheet_id, pos.col());
        }
    }

    /// Remove a cell by CellId (across all sheets).
    pub fn remove_cell(&mut self, cell_id: &CellId) {
        let mut invalidate_info: Option<(SheetId, u32)> = None;
        for (sheet_id, sheet) in self.sheets.iter_mut() {
            if sheet.cells.remove(cell_id).is_some() {
                if let Some(pos) = sheet.id_to_pos.remove(cell_id) {
                    sheet.pos_to_id.remove(&pos);
                    // Clear stale col_data entry
                    if let Some(col_vec) = sheet.col_data.get_mut(&pos.col())
                        && (pos.row() as usize) < col_vec.len()
                    {
                        col_vec[pos.row() as usize] = CellValue::Null;
                    }
                    // If this column has Range-backed data, rebuild col_data so
                    // the payload value is restored instead of leaving Null.
                    // For non-Range columns this returns early (no-op).
                    sheet.rebuild_col_data(pos.col());
                    invalidate_info = Some((*sheet_id, pos.col()));
                }
                break;
            }
        }
        self.cell_to_sheet.remove(cell_id);
        if let Some((sheet_id, col)) = invalidate_info {
            self.dense_cache.invalidate(&sheet_id, col);
            self.bump_col_version(&sheet_id, col);
        }
    }

    // -----------------------------------------------------------------------
    // Identity management
    // -----------------------------------------------------------------------

    /// Get or create a CellId at the given position.
    ///
    /// If a cell already exists at the position, its CellId is returned.
    /// Otherwise, a new unique CellId is created via the allocator and registered.
    ///
    /// For positions within an active projection, the CellId is registered in
    /// the identity maps (`pos_to_id`, `id_to_pos`, `cells`, `cell_to_sheet`)
    /// but `col_data` is NOT touched — the projected value written by
    /// `materialize_projection()` must be preserved. Ghost cells should never
    /// overwrite projected spill values.
    pub fn ensure_cell_id(
        &mut self,
        sheet_id: &SheetId,
        pos: SheetPos,
        id_alloc: &IdAllocator,
    ) -> Option<CellId> {
        // If already exists, return it
        if let Some(id) = self.resolve_cell_id(sheet_id, pos) {
            return Some(id);
        }
        // Create a unique CellId via the monotonic allocator. Must NOT be
        // position-derived because position-based hashes would collide after
        // structure changes: a cell created at (row=4, col=0) that later shifts
        // to (row=5, col=0) would collide with a new cell at the original
        // (row=4, col=0).
        let new_id = id_alloc.next_cell_id();
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };

        // If position is within an active projection, register the CellId for
        // identity tracking only — do NOT write Null to col_data.
        if self
            .projection_registry
            .is_projected(sheet_id, pos.row(), pos.col())
        {
            if let Some(s) = self.sheets.get_mut(sheet_id) {
                s.cells.insert(new_id, entry);
                s.pos_to_id.insert(pos, new_id);
                s.id_to_pos.insert(new_id, pos);
                self.cell_to_sheet.insert(new_id, *sheet_id);
                s.expand_identity_extent(pos);
            }
            return Some(new_id);
        }

        // Normal path: full insert with col_data write
        self.insert_cell(sheet_id, new_id, pos, entry);
        Some(new_id)
    }

    /// Get or create a CellId at the given position, preserving `col_data`.
    ///
    /// Like `ensure_cell_id`, but registers identity mappings only — it does
    /// NOT write `Null` to `col_data`. This is critical for data table body
    /// cells whose cached XLSX values in `col_data` must survive until the
    /// prepass writes computed results.
    pub fn ensure_cell_id_identity_only(
        &mut self,
        sheet_id: &SheetId,
        pos: SheetPos,
        id_alloc: &IdAllocator,
    ) -> Option<CellId> {
        if let Some(id) = self.resolve_cell_id(sheet_id, pos) {
            return Some(id);
        }
        let new_id = id_alloc.next_cell_id();
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.cells.insert(new_id, entry);
            s.pos_to_id.insert(pos, new_id);
            s.id_to_pos.insert(new_id, pos);
            self.cell_to_sheet.insert(new_id, *sheet_id);
            s.expand_identity_extent(pos);
        }
        Some(new_id)
    }

    /// Register a pre-allocated ghost cell at the given position.
    ///
    /// Used by the parallel init path to flush ghost cells that were allocated
    /// concurrently via `ConcurrentIdentityResolver`. The CellId was already
    /// determined during parallel resolution, so we must use it exactly.
    ///
    /// No-op if a cell already exists at this position (race-safe).
    pub fn register_ghost_cell(&mut self, sheet_id: &SheetId, pos: SheetPos, cell_id: CellId) {
        // Skip if already registered
        if self.resolve_cell_id(sheet_id, pos).is_some() {
            return;
        }
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };

        // If position is within an active projection, register the CellId for
        // identity tracking only — do NOT write Null to col_data.
        if self
            .projection_registry
            .is_projected(sheet_id, pos.row(), pos.col())
        {
            if let Some(s) = self.sheets.get_mut(sheet_id) {
                s.cells.insert(cell_id, entry);
                s.pos_to_id.insert(pos, cell_id);
                s.id_to_pos.insert(cell_id, pos);
                self.cell_to_sheet.insert(cell_id, *sheet_id);
                s.expand_identity_extent(pos);
            }
            return;
        }

        // Normal path: full insert with col_data write
        self.insert_cell(sheet_id, cell_id, pos, entry);
    }

    /// Register a pre-allocated CellId at the given position **for identity
    /// tracking only** — does NOT write `Null` into `col_data`.
    ///
    /// This is the right primitive for callers that need a stable CellId at a
    /// position (so it can be referenced later through `resolve_position` /
    /// `cell_id_at`) but where the position itself is logically empty:
    ///
    /// * Filter corner cells (autofilter `header_start` / `header_end` /
    ///   `data_end`) where the corner sits on an empty cell — writing
    ///   `CellValue::Null` would expand the sheet's identity extent and
    ///   confuse `is_blank` predicates, autofill, and `expand_extent`.
    /// * Any future "exists for refs purposes only" identity allocation.
    ///
    /// Compare with [`Self::register_ghost_cell`], which falls through to
    /// [`Self::insert_cell`] (writes `Null` to `col_data`) when the position
    /// is not under an active projection. That behaviour is correct for
    /// parallel-init ghost cells — those positions did carry data in the
    /// source XLSX and the `Null` write reserves the slot. It is *wrong* for
    /// filter corners on empty cells.
    ///
    /// Mirrors [`Self::ensure_cell_id_identity_only`], but takes a caller-
    /// supplied CellId (matching the `register_ghost_cell` shape).
    ///
    /// No-op if a cell already exists at this position.
    pub fn register_identity_only(&mut self, sheet_id: &SheetId, pos: SheetPos, cell_id: CellId) {
        if self.resolve_cell_id(sheet_id, pos).is_some() {
            return;
        }
        let entry = CellEntry {
            value: CellValue::Null,
            formula: None,
        };
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet_id);
            s.expand_identity_extent(pos);
        }
    }

    // -----------------------------------------------------------------------
    // Incremental Update
    // -----------------------------------------------------------------------

    /// Apply a single cell edit (upsert).
    ///
    /// Silently ignored if the sheet does not exist.
    pub fn apply_edit(
        &mut self,
        sheet_id: &SheetId,
        cell_id: CellId,
        pos: SheetPos,
        value: CellValue,
        formula: Option<IdentityFormula>,
    ) {
        let entry = CellEntry {
            value: value.clone(),
            formula: formula.map(Box::new),
        };
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.cells.insert(cell_id, entry);
            s.pos_to_id.insert(pos, cell_id);
            s.id_to_pos.insert(cell_id, pos);
            self.cell_to_sheet.insert(cell_id, *sheet_id);
            // Update column store (grow or create if needed)
            let col_vec = s.col_data.entry(pos.col()).or_insert_with(|| {
                let len = std::cmp::max(s.rows as usize, pos.row() as usize + 1);
                vec![CellValue::Null; len]
            });
            if (pos.row() as usize) < col_vec.len() {
                col_vec[pos.row() as usize] = value;
            } else {
                col_vec.resize(pos.row() as usize + 1, CellValue::Null);
                col_vec[pos.row() as usize] = value;
            }
            s.expand_extent(pos);

            // If this position is inside a Range, track it as an override so
            // the compaction threshold stays accurate.
            let owning_range_id = s
                .range_spatial_index
                .query(pos.row(), pos.col())
                .first()
                .map(|ext| ext.range_id);
            if let Some(range_id) = owning_range_id
                && let (Some(row_id), Some(col_id)) = (
                    s.index_to_row.get(&pos.row()).copied(),
                    s.index_to_col.get(&pos.col()).copied(),
                )
                && let Some(rv) = s.range_views.get_mut(&range_id)
            {
                rv.overrides.insert((row_id, col_id), cell_id);
                rv.override_count = rv.overrides.len() as u32;
            }
        }
        // Invalidate dense column cache for the affected column.
        self.dense_cache.invalidate(sheet_id, pos.col());
        self.bump_col_version(sheet_id, pos.col());
    }

    /// Apply a batch of edits.
    pub fn apply_edits(&mut self, edits: &[CellEdit]) {
        for edit in edits {
            self.apply_edit(
                &edit.sheet,
                edit.cell,
                edit.pos,
                edit.value.clone(),
                edit.formula.clone(),
            );
        }
    }

    // -----------------------------------------------------------------------
    // Domain cache write API
    // -----------------------------------------------------------------------

    /// Set merge regions for a sheet (replaces all existing).
    pub fn set_merge_regions(
        &mut self,
        sheet_id: &SheetId,
        regions: Vec<super::types::MergeRegion>,
    ) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.merge_regions = regions;
        }
    }

    /// Add a single merge region to a sheet.
    pub fn add_merge_region(&mut self, sheet_id: &SheetId, region: super::types::MergeRegion) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.merge_regions.push(region);
        }
    }

    /// Remove a merge region from a sheet by matching bounds.
    pub fn remove_merge_region(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.merge_regions.retain(|r| {
                !(r.start_row == start_row
                    && r.start_col == start_col
                    && r.end_row == end_row
                    && r.end_col == end_col)
            });
        }
    }

    /// Set the custom height for a row.
    pub fn set_row_height(&mut self, sheet_id: &SheetId, row: u32, height: f64) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.row_heights.insert(row, height);
        }
    }

    /// Remove a custom row height (revert to default).
    pub fn remove_row_height(&mut self, sheet_id: &SheetId, row: u32) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.row_heights.remove(&row);
        }
    }

    /// Set the custom width for a column.
    pub fn set_col_width(&mut self, sheet_id: &SheetId, col: u32, width: f64) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.col_widths.insert(col, width);
        }
    }

    /// Remove a custom column width (revert to default).
    pub fn remove_col_width(&mut self, sheet_id: &SheetId, col: u32) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.col_widths.remove(&col);
        }
    }

    /// Set a row as hidden or visible.
    pub fn set_row_hidden(&mut self, sheet_id: &SheetId, row: u32, hidden: bool) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            if hidden {
                s.hidden_rows.insert(row);
            } else {
                s.hidden_rows.remove(&row);
            }
        }
    }

    /// Set a column as hidden or visible.
    pub fn set_col_hidden(&mut self, sheet_id: &SheetId, col: u32, hidden: bool) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            if hidden {
                s.hidden_cols.insert(col);
            } else {
                s.hidden_cols.remove(&col);
            }
        }
    }

    /// Mark a cell as having a comment.
    pub fn set_comment(&mut self, sheet_id: &SheetId, cell_id: CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.comment_cells.insert(cell_id);
        }
    }

    /// Remove the comment indicator for a cell.
    pub fn remove_comment(&mut self, sheet_id: &SheetId, cell_id: &CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.comment_cells.remove(cell_id);
        }
    }

    // -----------------------------------------------------------------------
    // Projection materialization (Dynamic Array Architecture)
    // -----------------------------------------------------------------------

    /// Batch-materialize an array's projected values into col_data.
    /// This makes projected values visible to ALL read paths (DenseColumn, LookupIndex, range_store).
    /// The origin cell (0,0) is skipped — it already has its value set by the source cell.
    pub fn materialize_projection(
        &mut self,
        sheet: &SheetId,
        origin_row: u32,
        origin_col: u32,
        array: &CellValue,
    ) {
        let (arr_rows, arr_cols) = match array {
            CellValue::Array(arr) => (arr.rows(), arr.cols()),
            _other => {
                return;
            }
        };

        // Collect columns touched so we can invalidate caches after releasing sheet borrow
        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            for c in 0..arr_cols {
                let col = origin_col + c as u32;
                // Ensure col_data entry exists, sized to fit both sheet rows and projection extent
                let num_rows = sheet_mirror.rows as usize;
                let max_needed = (origin_row + arr_rows as u32) as usize;
                let target_len = std::cmp::max(num_rows, max_needed);
                let col_vec = sheet_mirror
                    .col_data
                    .entry(col)
                    .or_insert_with(|| vec![CellValue::Null; target_len]);
                // Extend if needed to fit projection extent
                if col_vec.len() < target_len {
                    col_vec.resize(target_len, CellValue::Null);
                }

                for r in 0..arr_rows {
                    let row = origin_row + r as u32;
                    // Skip origin cell — that's the source cell, already has its value
                    if r == 0 && c == 0 {
                        continue;
                    }
                    if (row as usize) < col_vec.len()
                        && let CellValue::Array(arr) = array
                        && let Some(val) = arr.get(r, c)
                    {
                        col_vec[row as usize] = val.clone();
                    }
                }

                cols_touched.push(col);
            }

            // Expand sheet dimensions to encompass projection extent so that
            // range reads (get_range_values / resolve_range_to_key) don't clamp
            // cross-sheet references to the pre-spill sheet size.
            // expand_extent uses pos.row + 1, so pass max - 1 to get equivalent result
            let max_row_needed = origin_row + arr_rows as u32;
            let max_col_needed = origin_col + arr_cols as u32;
            if max_row_needed > 0 && max_col_needed > 0 {
                sheet_mirror.expand_extent(SheetPos::new(max_row_needed - 1, max_col_needed - 1));
            }
        }

        // Invalidate caches outside the sheet borrow
        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::CacheInvalidate {
                    tier: "dense_cache",
                    sheet: *sheet,
                    col,
                    reason: "materialize_projection",
                });
            }
        }
    }

    /// Clear materialized projection values from col_data.
    /// Called when projection shrinks, moves, or source is cleared.
    /// The origin cell (0,0) is skipped — the source cell keeps its value.
    pub fn clear_materialization(
        &mut self,
        sheet: &SheetId,
        origin_row: u32,
        origin_col: u32,
        rows: u32,
        cols: u32,
    ) {
        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::ProjectionClear {
                source: cell_types::CellId::from_raw(0),
                origin: (origin_row, origin_col),
                size: (rows, cols),
            });
        }

        // Collect columns touched so we can invalidate caches after releasing sheet borrow
        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            for c in 0..cols {
                let col = origin_col + c;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col) {
                    for r in 0..rows {
                        let row = origin_row + r;
                        // Skip origin (source cell keeps its value)
                        if r == 0 && c == 0 {
                            continue;
                        }
                        if (row as usize) < col_vec.len() {
                            col_vec[row as usize] = CellValue::Null;
                        }
                    }
                }
                cols_touched.push(col);
            }
        }

        // Invalidate caches outside the sheet borrow
        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::CacheInvalidate {
                    tier: "dense_cache",
                    sheet: *sheet,
                    col,
                    reason: "clear_materialization",
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Pivot table materialization
    // -----------------------------------------------------------------------

    /// Clear a rectangular region in col_data, setting all cells to Null.
    /// Used to wipe previously materialized pivot output before re-rendering.
    pub fn clear_pivot_region(
        &mut self,
        sheet: &SheetId,
        anchor_row: u32,
        anchor_col: u32,
        total_rows: u32,
        total_cols: u32,
    ) {
        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            for c in 0..total_cols {
                let col = anchor_col + c;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col) {
                    for r in 0..total_rows {
                        let row = (anchor_row + r) as usize;
                        if row < col_vec.len() {
                            col_vec[row] = CellValue::Null;
                        }
                    }
                    cols_touched.push(col);
                }
            }
        }

        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
        }
    }

    /// Materialize a computed pivot table result into col_data cells.
    /// Writes column headers, row headers, data values, and grand totals.
    pub fn materialize_pivot(
        &mut self,
        sheet: &SheetId,
        anchor_row: u32,
        anchor_col: u32,
        result: &compute_pivot::types::PivotTableResult,
        row_field_names: &[String],
    ) {
        let bounds = &result.rendered_bounds;
        let first_data_row = bounds.first_data_row;
        let first_data_col = bounds.first_data_col;
        let total_rows = bounds.total_rows;
        let total_cols = bounds.total_cols;

        if total_rows == 0 || total_cols == 0 {
            return;
        }

        // Derive the number of value fields from the grand totals structure.
        // Do NOT use rows[0].values.len() — that includes column-leaf expansion
        // (e.g., 3 column leaves × 2 value fields = 6), but grand_totals.column
        // and grand_totals.grand are indexed by value field only.
        let num_value_fields = result
            .grand_totals
            .grand
            .as_ref()
            .map(|g| g.len().max(1))
            .or_else(|| {
                result
                    .grand_totals
                    .column
                    .as_ref()
                    .and_then(|c| c.first().map(|row| row.len().max(1)))
            })
            .unwrap_or(1) as u32;

        let num_data_cols = result.rendered_bounds.num_data_cols;

        debug_assert!(
            row_field_names.is_empty() || first_data_row >= 1,
            "row field labels need a header row reserved (got first_data_row={}, row_field_names={:?})",
            first_data_row,
            row_field_names,
        );
        debug_assert!(
            result.grand_totals.row.is_none()
                || total_rows > first_data_row + result.rows.len() as u32,
            "GT row not reserved in total_rows (total_rows={}, first_data_row={}, rows={})",
            total_rows,
            first_data_row,
            result.rows.len(),
        );
        debug_assert!(
            result.grand_totals.column.is_none()
                || total_cols >= first_data_col + num_data_cols + num_value_fields.max(1),
            "GT column not reserved in total_cols (total_cols={}, first_data_col={}, num_data_cols={}, num_value_fields={})",
            total_cols,
            first_data_col,
            num_data_cols,
            num_value_fields,
        );

        let mut cols_touched = Vec::new();

        if let Some(sheet_mirror) = self.sheets.get_mut(sheet) {
            let num_rows = sheet_mirror.rows as usize;
            let max_needed = (anchor_row + total_rows) as usize;
            let target_len = std::cmp::max(num_rows, max_needed);

            // Ensure all columns exist and are sized
            for c in 0..total_cols {
                let col = anchor_col + c;
                let col_vec = sheet_mirror
                    .col_data
                    .entry(col)
                    .or_insert_with(|| vec![CellValue::Null; target_len]);
                if col_vec.len() < target_len {
                    col_vec.resize(target_len, CellValue::Null);
                }
                cols_touched.push(col);
            }

            // Write row field labels in the header row (e.g., "Region" at F1)
            for (h_idx, name) in row_field_names.iter().enumerate() {
                if !name.is_empty() {
                    let row = anchor_row;
                    let col = anchor_col + h_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = CellValue::from(name.as_str());
                    }
                }
            }

            // Write column headers
            for (_level_idx, col_header) in result.column_headers.iter().enumerate() {
                let level_idx = _level_idx as u32;
                let mut data_col_offset: u32 = 0;
                for header in &col_header.headers {
                    let row = anchor_row + level_idx;
                    let col = anchor_col + first_data_col + data_col_offset;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = header.value.clone();
                    }
                    data_col_offset += header.span as u32;
                }
            }

            // Bug D — column-GT header label at the leftmost column of the GT span.
            // Aligns with the existing column-GT value writes below, which use
            // `anchor_col + total_cols - num_value_fields + val_idx`, so the leftmost
            // value column is at `total_cols - num_value_fields`. At v=0, num_value_fields
            // collapses to 1 and the label sits in the single GT column.
            if result.grand_totals.column.is_some() {
                let gt_label = result
                    .grand_totals
                    .row_label
                    .as_deref()
                    .unwrap_or("Grand Total");
                let gt_span = num_value_fields.max(1);
                let gt_label_col = anchor_col + total_cols - gt_span;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&gt_label_col)
                    && (anchor_row as usize) < col_vec.len()
                {
                    col_vec[anchor_row as usize] = CellValue::Text(gt_label.into());
                }
            }

            // Write row headers and data values
            for (row_idx, pivot_row) in result.rows.iter().enumerate() {
                let row_idx = row_idx as u32;
                // Row headers
                for (h_idx, header) in pivot_row.headers.iter().enumerate() {
                    let row = anchor_row + first_data_row + row_idx;
                    let col = anchor_col + h_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = header.value.clone();
                    }
                }
                // Data values
                for (v_idx, value) in pivot_row.values.iter().enumerate() {
                    let row = anchor_row + first_data_row + row_idx;
                    let col = anchor_col + first_data_col + v_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (row as usize) < col_vec.len()
                    {
                        col_vec[row as usize] = value.clone();
                    }
                }
            }

            // Grand total column (right side)
            if let Some(ref col_totals) = result.grand_totals.column {
                for (row_idx, row_totals) in col_totals.iter().enumerate() {
                    let row_idx = row_idx as u32;
                    for (val_idx, value) in row_totals.iter().enumerate() {
                        let row = anchor_row + first_data_row + row_idx;
                        let col = anchor_col + total_cols - num_value_fields + val_idx as u32;
                        if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                            && (row as usize) < col_vec.len()
                        {
                            col_vec[row as usize] = value.clone();
                        }
                    }
                }
            }

            // Grand total row (bottom)
            if let Some(ref row_totals) = result.grand_totals.row {
                // Label
                let label = result
                    .grand_totals
                    .row_label
                    .as_deref()
                    .unwrap_or("Grand Total");
                let gt_row = anchor_row + total_rows - 1;
                let label_col = anchor_col;
                if let Some(col_vec) = sheet_mirror.col_data.get_mut(&label_col)
                    && (gt_row as usize) < col_vec.len()
                {
                    col_vec[gt_row as usize] = CellValue::Text(label.into());
                }
                // Values
                for (v_idx, value) in row_totals.iter().enumerate() {
                    let col = anchor_col + first_data_col + v_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (gt_row as usize) < col_vec.len()
                    {
                        col_vec[gt_row as usize] = value.clone();
                    }
                }
            }

            // Corner grand total
            if let Some(ref grand) = result.grand_totals.grand {
                let gt_row = anchor_row + total_rows - 1;
                for (val_idx, value) in grand.iter().enumerate() {
                    let col = anchor_col + total_cols - num_value_fields + val_idx as u32;
                    if let Some(col_vec) = sheet_mirror.col_data.get_mut(&col)
                        && (gt_row as usize) < col_vec.len()
                    {
                        col_vec[gt_row as usize] = value.clone();
                    }
                }
            }

            // Expand extent to encompass pivot output
            sheet_mirror.expand_extent(SheetPos::new(
                anchor_row + total_rows - 1,
                anchor_col + total_cols - 1,
            ));
        }

        // Invalidate caches outside the sheet borrow
        for col in cols_touched {
            self.bump_col_version(sheet, col);
            self.dense_cache.invalidate(sheet, col);
        }
    }

    /// Mark a cell as having a sparkline.
    pub fn set_sparkline(&mut self, sheet_id: &SheetId, cell_id: CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.sparkline_cells.insert(cell_id);
        }
    }

    /// Remove the sparkline indicator for a cell.
    pub fn remove_sparkline(&mut self, sheet_id: &SheetId, cell_id: &CellId) {
        if let Some(s) = self.sheets.get_mut(sheet_id) {
            s.sparkline_cells.remove(cell_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::SheetMirror;
    use super::*;

    fn make_mirror() -> (CellMirror, SheetId) {
        let mut mirror = CellMirror::new();
        let sheet_id = SheetId::from_raw(1);
        let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 10);
        mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
        (mirror, sheet_id)
    }

    #[test]
    fn col_version_returns_zero_for_untracked() {
        let (mirror, sheet_id) = make_mirror();
        assert_eq!(mirror.col_version(&sheet_id, 0), 0);
        assert_eq!(mirror.col_version(&sheet_id, 99), 0);
    }

    #[test]
    fn insert_cell_bumps_col_version() {
        let (mut mirror, sheet_id) = make_mirror();
        assert_eq!(mirror.col_version(&sheet_id, 3), 0);

        let cell_id = CellId::from_raw(10);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(0, 3),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );
        assert_eq!(mirror.col_version(&sheet_id, 3), 1);
    }

    #[test]
    fn set_value_mut_bumps_col_version() {
        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(20);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(0, 5),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );
        let v_after_insert = mirror.col_version(&sheet_id, 5);

        mirror.set_value_mut(&cell_id, CellValue::number(2.0));
        assert_eq!(mirror.col_version(&sheet_id, 5), v_after_insert + 1);
    }

    #[test]
    fn remove_cell_bumps_col_version() {
        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(30);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(0, 7),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );
        let v_after_insert = mirror.col_version(&sheet_id, 7);

        mirror.remove_cell(&cell_id);
        assert_eq!(mirror.col_version(&sheet_id, 7), v_after_insert + 1);
    }

    #[test]
    fn apply_edit_bumps_col_version() {
        let (mut mirror, sheet_id) = make_mirror();
        assert_eq!(mirror.col_version(&sheet_id, 2), 0);

        let cell_id = CellId::from_raw(40);
        mirror.apply_edit(
            &sheet_id,
            cell_id,
            SheetPos::new(0, 2),
            CellValue::number(99.0),
            None,
        );
        assert_eq!(mirror.col_version(&sheet_id, 2), 1);
    }

    #[test]
    fn insert_cell_creates_col_data_for_new_column() {
        let (mut mirror, sheet_id) = make_mirror();
        // Column 20 has no col_data entry initially
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(!sheet.col_data.contains_key(&20));

        let cell_id = CellId::from_raw(100);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(5, 20),
            CellEntry {
                value: CellValue::number(42.0),
                formula: None,
            },
        );

        // col_data should now exist for column 20
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(sheet.col_data.contains_key(&20));
        let col_vec = &sheet.col_data[&20];
        assert_eq!(col_vec[5], CellValue::number(42.0));
    }

    #[test]
    fn set_value_mut_creates_col_data_for_new_column() {
        let (mut mirror, sheet_id) = make_mirror();
        // Insert a cell into a column that has no col_data
        let cell_id = CellId::from_raw(101);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(3, 25),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );
        // col_data should exist now (from insert_cell fix)
        // Verify set_value_mut also works on it
        mirror.set_value_mut(&cell_id, CellValue::number(99.0));
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.col_data[&25][3], CellValue::number(99.0));
    }

    #[test]
    fn apply_edit_creates_col_data_for_new_column() {
        let (mut mirror, sheet_id) = make_mirror();
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(!sheet.col_data.contains_key(&30));

        let cell_id = CellId::from_raw(102);
        mirror.apply_edit(
            &sheet_id,
            cell_id,
            SheetPos::new(2, 30),
            CellValue::number(77.0),
            None,
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(sheet.col_data.contains_key(&30));
        assert_eq!(sheet.col_data[&30][2], CellValue::number(77.0));
    }

    #[test]
    fn writing_col_a_does_not_affect_col_b() {
        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(50);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(0, 0),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );
        assert_eq!(mirror.col_version(&sheet_id, 0), 1);
        assert_eq!(mirror.col_version(&sheet_id, 1), 0);
    }

    #[test]
    fn insert_cell_expands_identity_extent() {
        let (mut mirror, sheet_id) = make_mirror();
        // Initial: rows=100, cols=10, identity_rows=100, identity_cols=10
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.identity_rows, 100);
        assert_eq!(sheet.identity_cols, 10);

        // Insert cell beyond current extent
        let cell_id = CellId::from_raw(200);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            SheetPos::new(150, 20),
            CellEntry {
                value: CellValue::number(1.0),
                formula: None,
            },
        );

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.rows, 151);
        assert_eq!(sheet.cols, 21);
        assert_eq!(sheet.identity_rows, 151);
        assert_eq!(sheet.identity_cols, 21);
    }

    #[test]
    fn ensure_cell_id_identity_only_expands_identity_extent() {
        let (mut mirror, sheet_id) = make_mirror();
        let id_alloc = cell_types::IdAllocator::new();

        // Use ensure_cell_id_identity_only at a position beyond current extent
        mirror.ensure_cell_id_identity_only(&sheet_id, SheetPos::new(200, 30), &id_alloc);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        // Data extent should NOT change (identity-only path)
        assert_eq!(sheet.rows, 100);
        assert_eq!(sheet.cols, 10);
        // Identity extent SHOULD expand
        assert_eq!(sheet.identity_rows, 201);
        assert_eq!(sheet.identity_cols, 31);
    }

    // -----------------------------------------------------------------------
    // T5: register_identity_only — pre-allocated CellId, no col_data write
    // -----------------------------------------------------------------------

    #[test]
    fn register_identity_only_does_not_write_col_data() {
        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(900);

        // Position beyond row extent (row 200 vs base rows=100); col=5
        // sits inside the base cols=10 so `identity_cols` doesn't grow.
        // What's tested here is "no col_data write" + "identity extent
        // grows on row" + "data extent unchanged".
        mirror.register_identity_only(&sheet_id, SheetPos::new(200, 5), cell_id);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        // Identity mappings present.
        assert_eq!(sheet.pos_to_id.get(&SheetPos::new(200, 5)), Some(&cell_id));
        assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&SheetPos::new(200, 5)));
        assert!(sheet.cells.contains_key(&cell_id));
        // col_data must NOT have been touched at column 5 (no Null write).
        // The original sheet has no col_data for col 5 → still none.
        assert!(!sheet.col_data.contains_key(&5));
        // Data extent stays put; identity rows extent grows past base 100.
        assert_eq!(sheet.rows, 100);
        assert_eq!(sheet.cols, 10);
        assert_eq!(sheet.identity_rows, 201);
        // col 5 < base cols 10, so identity_cols stays at 10.
        assert_eq!(sheet.identity_cols, 10);
    }

    #[test]
    fn register_identity_only_grows_identity_cols_when_outside_base() {
        // Companion test: when the position's col is past the base
        // sheet's cols, identity_cols grows but data cols does not.
        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(901);

        mirror.register_identity_only(&sheet_id, SheetPos::new(50, 25), cell_id);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(!sheet.col_data.contains_key(&25));
        // Data cols stays at base 10.
        assert_eq!(sheet.cols, 10);
        // Identity cols grows to 26 (= 25 + 1).
        assert_eq!(sheet.identity_cols, 26);
        // Data rows stays at base 100.
        assert_eq!(sheet.rows, 100);
        // Identity rows stays at base 100 too — row 50 < 100.
        assert_eq!(sheet.identity_rows, 100);
    }

    /// Reproduces a known bug: when `apply_edit` moves a CellId from position A
    /// to position B, the stale `pos_to_id[A]` entry is NOT removed. This causes
    /// two positions to resolve to the same CellId, so rendering position A
    /// returns position B's value.
    ///
    /// CORRECT behavior: `apply_edit` should detect that `cell_id` already exists
    /// at a different position (via `id_to_pos`) and remove the old `pos_to_id`
    /// entry (and clear the old `col_data` slot). Until that fix lands, this test
    /// asserts the BUGGY behavior to document the issue.
    #[test]
    fn test_apply_edit_stale_pos_to_id_after_move() {
        use crate::projection::CellRender;

        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(500);

        // Step 1: Insert cell at position A (row=2, col=1) with value "hello"
        let pos_a = SheetPos::new(2, 1);
        mirror.insert_cell(
            &sheet_id,
            cell_id,
            pos_a,
            CellEntry {
                value: CellValue::from("hello"),
                formula: None,
            },
        );

        // Sanity: pos_a resolves to our cell_id
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.pos_to_id.get(&pos_a), Some(&cell_id));
        assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&pos_a));

        // Step 2: apply_edit with the SAME cell_id but at position B (row=15, col=12)
        let pos_b = SheetPos::new(15, 12);
        mirror.apply_edit(&sheet_id, cell_id, pos_b, CellValue::from("world"), None);

        // id_to_pos correctly points to the new position B
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.id_to_pos.get(&cell_id), Some(&pos_b));

        // BUG: pos_to_id at position A still resolves to cell_id (stale entry).
        // The correct behavior would be: pos_to_id should NOT contain pos_a anymore.
        assert_eq!(
            sheet.pos_to_id.get(&pos_a),
            Some(&cell_id),
            "BUG: stale pos_to_id entry at old position A still points to the moved cell"
        );

        // BUG (user-visible): cell_render_at at position A returns "world" (the
        // moved cell's current value) instead of Empty.
        // Correct behavior: cell_render_at(pos_a) should return CellRender::Empty.
        match mirror.cell_render_at(&sheet_id, pos_a.row(), pos_a.col()) {
            CellRender::Plain(view) => {
                assert_eq!(view.cell_id, cell_id);
                assert_eq!(
                    *view.value,
                    CellValue::from("world"),
                    "BUG: old position A renders the moved cell's new value 'world'"
                );
            }
            other => panic!(
                "Expected CellRender::Plain (buggy stale render), got {:?}",
                other
            ),
        }
    }

    #[test]
    fn register_identity_only_is_noop_when_cell_already_present() {
        let (mut mirror, sheet_id) = make_mirror();
        let real_id = CellId::from_raw(1);
        let pos = SheetPos::new(0, 0);
        mirror.insert_cell(
            &sheet_id,
            real_id,
            pos,
            CellEntry {
                value: CellValue::number(42.0),
                formula: None,
            },
        );

        // Try to register a *different* CellId at the same position. Must be a
        // no-op — the existing real cell wins.
        let phantom = CellId::from_raw(999);
        mirror.register_identity_only(&sheet_id, pos, phantom);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.pos_to_id.get(&pos), Some(&real_id));
        // Phantom must not have been registered.
        assert!(!sheet.cells.contains_key(&phantom));
    }

    #[test]
    fn register_ghost_cell_writes_null_into_col_data_outside_projections() {
        // Lock in the *contrast* with register_identity_only: the existing
        // register_ghost_cell path still writes Null into col_data when no
        // projection covers the position. This is correct for the parallel-
        // init path (positions back real XLSX data) but wrong for filter
        // corners — that's exactly why register_identity_only exists.
        let (mut mirror, sheet_id) = make_mirror();
        let cell_id = CellId::from_raw(123);
        let pos = SheetPos::new(50, 7);

        mirror.register_ghost_cell(&sheet_id, pos, cell_id);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(sheet.col_data.contains_key(&7));
        assert_eq!(sheet.col_data[&7][50], CellValue::Null);
    }

    #[test]
    fn insert_rows_remaps_row_heights() {
        use formula_types::StructureChange;

        let (mut mirror, sheet_id) = make_mirror();
        // Set custom height at row 5
        mirror.set_row_height(&sheet_id, 5, 30.0);
        mirror.set_row_height(&sheet_id, 2, 20.0);

        // Insert 2 rows at position 3
        let change = StructureChange::InsertRows {
            at: 3,
            count: 2,
            new_row_ids: vec![],
        };
        mirror.apply_structure_change(&sheet_id, &change);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        // Row 2 (before insertion point) should be unchanged
        assert_eq!(sheet.row_heights.get(&2), Some(&20.0));
        // Row 5 should have shifted to row 7
        assert!(!sheet.row_heights.contains_key(&5));
        assert_eq!(sheet.row_heights.get(&7), Some(&30.0));
    }

    #[test]
    fn delete_rows_remaps_row_heights() {
        use formula_types::StructureChange;

        let (mut mirror, sheet_id) = make_mirror();
        mirror.set_row_height(&sheet_id, 3, 20.0);
        mirror.set_row_height(&sheet_id, 5, 30.0);
        mirror.set_row_height(&sheet_id, 8, 40.0);

        // Delete 2 rows starting at position 3 (deletes rows 3 and 4)
        let change = StructureChange::DeleteRows {
            at: 3,
            count: 2,
            deleted_cell_ids: vec![],
        };
        mirror.apply_structure_change(&sheet_id, &change);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        // Row 5 should shift to row 3 (shifted down by 2), replacing the deleted row 3
        assert_eq!(sheet.row_heights.get(&3), Some(&30.0));
        // Original row 5 key should be gone
        assert!(!sheet.row_heights.contains_key(&5));
        // Row 8 should shift to row 6
        assert_eq!(sheet.row_heights.get(&6), Some(&40.0));
    }

    #[test]
    fn insert_rows_remaps_hidden_rows() {
        use formula_types::StructureChange;

        let (mut mirror, sheet_id) = make_mirror();
        mirror.set_row_hidden(&sheet_id, 5, true);
        mirror.set_row_hidden(&sheet_id, 8, true);

        // Insert 3 rows at position 6
        let change = StructureChange::InsertRows {
            at: 6,
            count: 3,
            new_row_ids: vec![],
        };
        mirror.apply_structure_change(&sheet_id, &change);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        // Row 5 (before insertion) should still be hidden
        assert!(sheet.hidden_rows.contains(&5));
        // Row 8 should have shifted to row 11
        assert!(!sheet.hidden_rows.contains(&8));
        assert!(sheet.hidden_rows.contains(&11));
    }

    #[test]
    fn insert_cols_remaps_col_widths() {
        use formula_types::StructureChange;

        let (mut mirror, sheet_id) = make_mirror();
        mirror.set_col_width(&sheet_id, 3, 150.0);

        let change = StructureChange::InsertCols {
            at: 2,
            count: 1,
            new_col_ids: vec![],
        };
        mirror.apply_structure_change(&sheet_id, &change);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert!(!sheet.col_widths.contains_key(&3));
        assert_eq!(sheet.col_widths.get(&4), Some(&150.0));
    }

    #[test]
    fn structure_change_updates_identity_extent() {
        use formula_types::StructureChange;

        let (mut mirror, sheet_id) = make_mirror();
        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.identity_rows, 100);

        let change = StructureChange::InsertRows {
            at: 50,
            count: 5,
            new_row_ids: vec![],
        };
        mirror.apply_structure_change(&sheet_id, &change);

        let sheet = mirror.get_sheet(&sheet_id).unwrap();
        assert_eq!(sheet.rows, 105);
        assert_eq!(sheet.identity_rows, 105);
    }
}
