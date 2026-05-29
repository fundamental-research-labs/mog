//! Projection Registry — spatial index for dynamic array projections.
//!
//! Replaces `SpillTracker` with a design that maps source CellIds to projected
//! regions WITHOUT creating phantom cells.  Instead of maintaining a separate
//! CellId for every projected position, the registry stores a compact
//! `Projection` record per source and answers spatial queries via a per-sheet
//! sorted index with binary search.
//!
//! ## Terminology
//!
//! - **Source**: The cell containing the formula that produced the array.
//! - **Projection**: The rectangular region on the grid where the array result
//!   is displayed. The origin of the projection is the source cell's position.
//! - **Element coordinates**: `(elem_row, elem_col)` — zero-based offsets into
//!   the array result.
//!
//! ## Spatial Index Design
//!
//! Each sheet has a `Vec<ProjectionEntry>` sorted by `(origin_row, origin_col)`.
//! `resolve()` uses binary search to find an upper bound, then scans backwards
//! checking whether the target position falls within each projection's extent.
//! Complexity: O(log n + k) where k = projections overlapping the target row.

use rustc_hash::FxHashMap;

use crate::mirror::CellMirror;
use cell_types::{CellId, SheetId, SheetPos};
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Render views — the unified return type for `CellMirror::cell_render_at`.
// ---------------------------------------------------------------------------

/// Projection-aware view of a cell at `(sheet, row, col)`.
///
/// `value` is the dereferenced element scalar (NOT the wrapping
/// `CellValue::Array(..)`). At the anchor (`row==anchor_row`,
/// `col==anchor_col`) it is the top-left scalar of the array.
#[derive(Debug)]
pub struct ProjectionView<'a> {
    pub anchor_id: CellId,
    pub anchor_row: u32,
    pub anchor_col: u32,
    pub value: &'a CellValue,
    /// `true` iff `anchor_id` is registered in `mirror.cse_anchors`. CSE
    /// distinguishes the legacy Ctrl+Shift+Enter array formulas (extent is
    /// reserved; partial-edit is rejected) from automatic dynamic-array
    /// spills (members may be displaced as `#SPILL!`).
    pub is_cse: bool,
}

/// View of a non-projection cell that has a CellId at `(sheet, row, col)`.
///
/// The render path stitches in the formula text via the scheduler's
/// `formula_strings`; the mirror does not own that map.
///
/// `region` carries non-projection region membership — Data Tables today;
/// pivot value cells / table column / defined-name multi / cross-workbook
/// when D6 sub-streams land. `None` for plain cells outside any region.
#[derive(Debug)]
pub struct PlainCellView<'a> {
    pub cell_id: CellId,
    pub value: &'a CellValue,
    pub region: Option<RegionRef>,
}

/// View of a materialized positional value with no CellId.
///
/// Pivot output and other generated grid projections can live in `col_data`
/// without allocating editable cell identities. They are still first-class
/// renderable grid values and must flow through the same mirror chokepoint as
/// CellId-backed cells.
#[derive(Debug)]
pub struct MaterializedCellView<'a> {
    pub value: &'a CellValue,
}

/// Discriminant for region-membership kinds surfaced through `cell_render_at`.
///
/// `DataTable` is the only kind today; the enum exists so consumers
/// (formula bar brace policy, viewport flag emission, `RegionMeta` wire
/// shape) can switch on kind uniformly. The plan's "Forward-compat note"
/// reserves room for `Pivot`, `TableColumn`, `DefinedNameMulti`, `External`
/// (D6 sub-streams).
///
/// Projection-side kinds (`CseArray`, `ArraySpill`) are NOT carried by
/// `RegionRef` itself — those flow through `ProjectionView.is_cse` today
/// and become a `kind` field on `ProjectionView` when D6.1 lands. Keeping
/// the region kind enum forward-compatible is enough for v1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegionKind {
    /// XLSX `<f t="dataTable">` — the master cell holds the
    /// `=TABLE(r2,r1)` formula; body cells carry their own per-cell
    /// values (cached or computed via Stream E).
    DataTable,
    // Forward-compat: Pivot, TableColumn, DefinedNameMulti, External
    // — see plan's Architecture target section.
}

/// Pointer to the region a cell belongs to, surfaced via
/// `CellRender::Plain { region: Some(_) }`.
///
/// `is_anchor` distinguishes the formula-owning cell (e.g., the Data
/// Table master) from body cells. `anchor_row`/`anchor_col` plus
/// `rows`/`cols` describe the full region rectangle, so wire-side
/// `RegionMeta` populates without a parallel mirror lookup — keeping
/// the chokepoint complete (no second read of `mirror.data_table_regions`
/// from render code).
#[derive(Debug, Clone, Copy)]
pub struct RegionRef {
    pub kind: RegionKind,
    pub anchor_row: u32,
    pub anchor_col: u32,
    pub is_anchor: bool,
    /// Region rectangle dimensions in cells.
    pub rows: u32,
    pub cols: u32,
}

/// Result of `CellMirror::cell_render_at` — the chokepoint that every
/// render path keys off of.
///
/// The `Projection` arm exists so the renderer cannot accidentally route
/// projection members through the no-CellId branch (the original bug).
/// The `Plain` arm only carries cells that are not part of any projection.
#[derive(Debug)]
pub enum CellRender<'a> {
    Projection(ProjectionView<'a>),
    Plain(PlainCellView<'a>),
    Materialized(MaterializedCellView<'a>),
    Empty,
}

// ---------------------------------------------------------------------------
// Data structures
// ---------------------------------------------------------------------------

/// Metadata for a single array projection onto the grid.
#[derive(Debug, Clone, PartialEq)]
pub struct Projection {
    pub source: CellId,
    pub sheet: SheetId,
    pub origin_row: u32,
    pub origin_col: u32,
    pub rows: u32,
    pub cols: u32,
}

/// Entry in the per-sheet spatial index, sorted by `(origin_row, origin_col)`.
#[derive(Debug, Clone)]
struct ProjectionEntry {
    source: CellId,
    origin_row: u32,
    origin_col: u32,
    rows: u32,
    cols: u32,
}

/// Registry of array projections. Replaces `SpillTracker`.
///
/// Maps source CellIds to projected regions and provides spatial lookup:
/// `(sheet, row, col) → (source, element_row, element_col)`.
///
/// The spatial index per sheet is a `Vec` sorted by `(origin_row, origin_col)`.
/// `resolve()` uses binary search to find candidates, then scans checking bounds.
/// Complexity: O(log n + k) where k = projections overlapping the target row.
#[derive(Debug, Clone)]
pub struct ProjectionRegistry {
    /// source CellId → projection metadata
    projections: FxHashMap<CellId, Projection>,
    /// Per-sheet spatial index: sorted by `(origin_row, origin_col)`.
    sheet_index: FxHashMap<SheetId, Vec<ProjectionEntry>>,
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

impl Default for ProjectionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectionRegistry {
    /// Create an empty registry.
    pub fn new() -> Self {
        Self {
            projections: FxHashMap::default(),
            sheet_index: FxHashMap::default(),
        }
    }

    /// Register (or update) a projection for `source`.
    ///
    /// Returns the previous `Projection` if the source was already registered.
    pub fn register(
        &mut self,
        source: CellId,
        sheet: SheetId,
        origin_row: u32,
        origin_col: u32,
        rows: u32,
        cols: u32,
    ) -> Option<Projection> {
        let old = self.remove(&source);

        // Insert into projections map.
        self.projections.insert(
            source,
            Projection {
                source,
                sheet,
                origin_row,
                origin_col,
                rows,
                cols,
            },
        );

        // Insert into spatial index, maintaining sorted order.
        let entries = self.sheet_index.entry(sheet).or_default();
        let key = (origin_row, origin_col);
        let pos = entries.partition_point(|e| (e.origin_row, e.origin_col) < key);
        entries.insert(
            pos,
            ProjectionEntry {
                source,
                origin_row,
                origin_col,
                rows,
                cols,
            },
        );

        old
    }

    /// Remove a projection by source CellId. Returns the removed `Projection`.
    pub fn remove(&mut self, source: &CellId) -> Option<Projection> {
        if let Some(proj) = self.projections.remove(source) {
            if let Some(entries) = self.sheet_index.get_mut(&proj.sheet) {
                entries.retain(|e| e.source != *source);
                if entries.is_empty() {
                    self.sheet_index.remove(&proj.sheet);
                }
            }
            Some(proj)
        } else {
            None
        }
    }

    /// Spatial lookup: given a `(sheet, row, col)`, return
    /// `(source, elem_row, elem_col)` if the position falls within any projection.
    pub fn resolve(&self, sheet: &SheetId, row: u32, col: u32) -> Option<(CellId, u32, u32)> {
        let entries = self.sheet_index.get(sheet)?;

        // Binary search: find upper bound for (row, col).
        let _ub = entries.partition_point(|e| (e.origin_row, e.origin_col) <= (row, col));

        // Scan backwards from the upper bound. Any projection whose origin_row <= row
        // and origin_col <= col *could* contain (row, col).
        // But we also need to check entries that start at an earlier row with a large
        // enough extent to cover `row`, even if their origin_col > col wouldn't
        // be found by scanning strictly backwards. So we scan ALL entries with
        // origin_row <= row.
        //
        // We'll scan backwards from ub, then also scan entries earlier in the vec
        // that might have origin_row <= row but origin_col > col.

        // First, find the leftmost entry whose origin_row <= row.
        // Since entries are sorted by (origin_row, origin_col), all entries
        // with origin_row <= row come before entries with origin_row > row.
        // We need to scan all entries from the start up to the last entry
        // with origin_row <= row.

        // Find the last entry with origin_row <= row.
        // Entries with origin_row <= row and any origin_col come first in sort order,
        // but entries at origin_row == row but origin_col > col come AFTER ub.
        // So we need to extend our scan past ub for entries at the same row.
        let scan_end = entries.partition_point(|e| e.origin_row <= row);

        for i in (0..scan_end).rev() {
            let e = &entries[i];
            // Check if (row, col) is within this projection's rectangle.
            if row >= e.origin_row
                && row < e.origin_row + e.rows
                && col >= e.origin_col
                && col < e.origin_col + e.cols
            {
                let elem_row = row - e.origin_row;
                let elem_col = col - e.origin_col;
                return Some((e.source, elem_row, elem_col));
            }
        }

        None
    }

    /// Return all projections that overlap the given range `[start_row..end_row) x [start_col..end_col)`.
    pub fn projections_in_range(
        &self,
        sheet: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Vec<&Projection> {
        let mut result = Vec::new();
        for proj in self.projections.values() {
            if proj.sheet != *sheet {
                continue;
            }
            // Overlap check: projection rect vs query rect.
            let proj_end_row = proj.origin_row + proj.rows;
            let proj_end_col = proj.origin_col + proj.cols;
            if proj.origin_row < end_row
                && proj_end_row > start_row
                && proj.origin_col < end_col
                && proj_end_col > start_col
            {
                result.push(proj);
            }
        }
        result
    }

    /// Check whether `(sheet, row, col)` is covered by any projection.
    #[inline]
    pub fn is_projected(&self, sheet: &SheetId, row: u32, col: u32) -> bool {
        self.resolve(sheet, row, col).is_some()
    }

    /// O(1) check whether `source` is registered.
    #[inline]
    pub fn is_source(&self, source: &CellId) -> bool {
        self.projections.contains_key(source)
    }

    /// O(1) lookup of projection metadata for `source`.
    #[inline]
    pub fn get(&self, source: &CellId) -> Option<&Projection> {
        self.projections.get(source)
    }

    /// If `(sheet, row, col)` is the origin of a registered projection, return
    /// the source CellId.
    pub fn source_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<CellId> {
        let entries = self.sheet_index.get(sheet)?;
        let key = (row, col);
        let pos = entries.partition_point(|e| (e.origin_row, e.origin_col) < key);
        if pos < entries.len() {
            let e = &entries[pos];
            if e.origin_row == row && e.origin_col == col {
                return Some(e.source);
            }
        }
        None
    }

    /// Conflict detection for a proposed projection.
    ///
    /// A target position is a conflict if:
    /// - A cell exists in the mirror with a non-null value or formula, OR
    /// - The position falls inside another source's projection in this registry, OR
    /// - The position overlaps a multi-cell merge region in this sheet
    ///   (Excel parity: spilling into a merged range yields `#SPILL!`).
    ///
    /// Own projection positions (belonging to `source`) are NOT conflicts.
    ///
    /// Returns `Ok(())` if no conflict, `Err(conflicting_cell_id)` otherwise.
    #[allow(clippy::too_many_arguments)]
    pub fn check_conflict(
        &self,
        mirror: &CellMirror,
        sheet: &SheetId,
        origin_row: u32,
        origin_col: u32,
        rows: u32,
        cols: u32,
        source: &CellId,
    ) -> Result<(), CellId> {
        // Precompute the multi-cell merges for this sheet once. 1x1 "merges"
        // are no-ops (some import paths can produce degenerate single-cell
        // entries) — skipping them keeps benign metadata from blocking spills.
        let merges = mirror.get_merge_regions(sheet);
        let multi_merges: Vec<&crate::mirror::MergeRegion> = merges
            .iter()
            .filter(|m| m.start_row != m.end_row || m.start_col != m.end_col)
            .collect();

        for r in 0..rows {
            for c in 0..cols {
                // Skip the origin cell itself.
                if r == 0 && c == 0 {
                    continue;
                }

                let row = origin_row + r;
                let col = origin_col + c;

                // Check if this position falls inside a projection first.
                // If it belongs to the source's own pre-registered projection,
                // it's not a conflict — the source is re-spilling into its
                // own range (e.g., after XLSX import where cached spill-target
                // values are loaded into the mirror).
                if let Some((proj_source, _, _)) = self.resolve(sheet, row, col) {
                    if proj_source == *source {
                        continue; // Own projection target — allow re-spill
                    }
                    // Another source's projection occupies this position.
                    return Err(proj_source);
                }

                // Check mirror for existing cell content.
                if let Some(cell_id) = mirror.resolve_cell_id(sheet, SheetPos::new(row, col))
                    && let Some(sheet_mirror) = mirror.get_sheet(sheet)
                    && let Some(entry) = sheet_mirror.get_cell(&cell_id)
                {
                    let has_content = !entry.value.is_null() || entry.formula.is_some();
                    if has_content {
                        return Err(cell_id);
                    }
                }

                // Check whether this position sits inside a multi-cell merge.
                // Excel rule: any spill target overlapping a merged range is
                // refused with #SPILL!. Resolve a stable CellId for the
                // conflict report — use the existing one if any, else the
                // merge's anchor (top-left).
                for m in &multi_merges {
                    if row >= m.start_row
                        && row <= m.end_row
                        && col >= m.start_col
                        && col <= m.end_col
                    {
                        let conflict_cell = mirror
                            .resolve_cell_id(sheet, SheetPos::new(row, col))
                            .or_else(|| {
                                mirror
                                    .resolve_cell_id(sheet, SheetPos::new(m.start_row, m.start_col))
                            })
                            .unwrap_or(*source);
                        return Err(conflict_cell);
                    }
                }
            }
        }
        Ok(())
    }

    /// Reset the registry, removing all projections.
    pub fn clear(&mut self) {
        self.projections.clear();
        self.sheet_index.clear();
    }

    /// Iterate over all registered projections.
    pub fn iter_projections(&self) -> impl Iterator<Item = (&CellId, &Projection)> {
        self.projections.iter()
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::{CellEntry, CellMirror, SheetMirror};
    use value_types::{CellValue, FiniteF64};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_cell_id(n: u128) -> CellId {
        CellId::from_raw(n)
    }

    fn make_sheet_id(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_mirror_with_sheet(
        sheet_id: SheetId,
        cells: Vec<(CellId, u32, u32, CellValue)>,
    ) -> CellMirror {
        let mut mirror = CellMirror::new();
        let sheet_mirror = SheetMirror::new(sheet_id, "Sheet1".to_string(), 100, 26);
        mirror.add_sheet_mirror(sheet_id, "Sheet1".to_string(), sheet_mirror);
        for (cell_id, row, col, value) in cells {
            let entry = CellEntry {
                value,
                formula: None,
            };
            mirror.insert_cell(&sheet_id, cell_id, SheetPos::new(row, col), entry);
        }
        mirror
    }

    // -----------------------------------------------------------------------
    // Test: new — empty registry
    // -----------------------------------------------------------------------

    #[test]
    fn test_new_empty() {
        let reg = ProjectionRegistry::new();
        let cell = make_cell_id(1);
        let sheet = make_sheet_id(100);
        assert!(!reg.is_source(&cell));
        assert!(!reg.is_projected(&sheet, 0, 0));
        assert!(reg.get(&cell).is_none());
        assert!(reg.resolve(&sheet, 0, 0).is_none());
        assert!(reg.source_at(&sheet, 0, 0).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: register and get
    // -----------------------------------------------------------------------

    #[test]
    fn test_register_and_get() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        let old = reg.register(source, sheet, 5, 3, 4, 2);
        assert!(old.is_none());

        assert!(reg.is_source(&source));
        let proj = reg.get(&source).unwrap();
        assert_eq!(proj.source, source);
        assert_eq!(proj.sheet, sheet);
        assert_eq!(proj.origin_row, 5);
        assert_eq!(proj.origin_col, 3);
        assert_eq!(proj.rows, 4);
        assert_eq!(proj.cols, 2);
    }

    // -----------------------------------------------------------------------
    // Test: register returns old projection on update
    // -----------------------------------------------------------------------

    #[test]
    fn test_register_update_returns_old() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 0, 0, 3, 1);
        let old = reg.register(source, sheet, 0, 0, 5, 2);

        assert!(old.is_some());
        let old = old.unwrap();
        assert_eq!(old.rows, 3);
        assert_eq!(old.cols, 1);

        // New projection should be active.
        let proj = reg.get(&source).unwrap();
        assert_eq!(proj.rows, 5);
        assert_eq!(proj.cols, 2);
    }

    // -----------------------------------------------------------------------
    // Test: remove
    // -----------------------------------------------------------------------

    #[test]
    fn test_remove() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 0, 0, 3, 2);
        let removed = reg.remove(&source);
        assert!(removed.is_some());
        assert_eq!(removed.unwrap().rows, 3);

        assert!(!reg.is_source(&source));
        assert!(reg.get(&source).is_none());
        assert!(reg.resolve(&sheet, 1, 1).is_none());
    }

    #[test]
    fn test_remove_nonexistent() {
        let mut reg = ProjectionRegistry::new();
        assert!(reg.remove(&make_cell_id(999)).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: resolve — exact origin
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_origin() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 2, 3, 4, 2);

        let result = reg.resolve(&sheet, 2, 3);
        assert_eq!(result, Some((source, 0, 0)));
    }

    // -----------------------------------------------------------------------
    // Test: resolve — middle of projection
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_middle() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        // 4 rows x 3 cols starting at (10, 5)
        reg.register(source, sheet, 10, 5, 4, 3);

        // (12, 6) -> elem (2, 1)
        assert_eq!(reg.resolve(&sheet, 12, 6), Some((source, 2, 1)));
        // (13, 7) -> elem (3, 2) — last cell
        assert_eq!(reg.resolve(&sheet, 13, 7), Some((source, 3, 2)));
    }

    // -----------------------------------------------------------------------
    // Test: resolve — outside projection
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_outside() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 10, 5, 4, 3);

        // One past end row.
        assert!(reg.resolve(&sheet, 14, 5).is_none());
        // One past end col.
        assert!(reg.resolve(&sheet, 10, 8).is_none());
        // Before origin.
        assert!(reg.resolve(&sheet, 9, 5).is_none());
        assert!(reg.resolve(&sheet, 10, 4).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: resolve — boundary cases
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_boundary() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        // 1x1 projection — only the origin.
        reg.register(source, sheet, 5, 5, 1, 1);

        assert_eq!(reg.resolve(&sheet, 5, 5), Some((source, 0, 0)));
        assert!(reg.resolve(&sheet, 5, 6).is_none());
        assert!(reg.resolve(&sheet, 6, 5).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: is_projected
    // -----------------------------------------------------------------------

    #[test]
    fn test_is_projected() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 0, 0, 3, 2);

        assert!(reg.is_projected(&sheet, 0, 0));
        assert!(reg.is_projected(&sheet, 2, 1));
        assert!(!reg.is_projected(&sheet, 3, 0));
        assert!(!reg.is_projected(&sheet, 0, 2));
    }

    // -----------------------------------------------------------------------
    // Test: source_at
    // -----------------------------------------------------------------------

    #[test]
    fn test_source_at() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 5, 3, 4, 2);

        // The origin position should return the source.
        assert_eq!(reg.source_at(&sheet, 5, 3), Some(source));
        // Non-origin projected positions should NOT return from source_at.
        assert!(reg.source_at(&sheet, 6, 3).is_none());
        // Unrelated position.
        assert!(reg.source_at(&sheet, 0, 0).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: multiple projections on same sheet
    // -----------------------------------------------------------------------

    #[test]
    fn test_multiple_projections() {
        let mut reg = ProjectionRegistry::new();
        let s1 = make_cell_id(1);
        let s2 = make_cell_id(2);
        let sheet = make_sheet_id(100);

        // Projection 1: 3 rows x 1 col at (0, 0)
        reg.register(s1, sheet, 0, 0, 3, 1);
        // Projection 2: 1 row x 3 cols at (0, 5)
        reg.register(s2, sheet, 0, 5, 1, 3);

        assert!(reg.is_source(&s1));
        assert!(reg.is_source(&s2));

        assert_eq!(reg.resolve(&sheet, 2, 0), Some((s1, 2, 0)));
        assert_eq!(reg.resolve(&sheet, 0, 6), Some((s2, 0, 1)));

        // Remove one, other remains.
        reg.remove(&s1);
        assert!(!reg.is_source(&s1));
        assert!(reg.is_source(&s2));
        assert!(reg.resolve(&sheet, 2, 0).is_none());
        assert_eq!(reg.resolve(&sheet, 0, 6), Some((s2, 0, 1)));
    }

    // -----------------------------------------------------------------------
    // Test: projections_in_range
    // -----------------------------------------------------------------------

    #[test]
    fn test_projections_in_range() {
        let mut reg = ProjectionRegistry::new();
        let s1 = make_cell_id(1);
        let s2 = make_cell_id(2);
        let s3 = make_cell_id(3);
        let sheet = make_sheet_id(100);

        // s1: rows 0..3, cols 0..1
        reg.register(s1, sheet, 0, 0, 3, 1);
        // s2: rows 5..8, cols 5..8
        reg.register(s2, sheet, 5, 5, 3, 3);
        // s3: rows 2..4, cols 0..2
        reg.register(s3, sheet, 2, 0, 2, 2);

        // Query range [1..4) x [0..2) should overlap s1 and s3.
        let result = reg.projections_in_range(&sheet, 1, 0, 4, 2);
        let mut sources: Vec<CellId> = result.iter().map(|p| p.source).collect();
        sources.sort_by_key(|c| c.as_u128());
        assert_eq!(sources, vec![s1, s3]);

        // Query range [5..9) x [5..9) should overlap s2 only.
        let result = reg.projections_in_range(&sheet, 5, 5, 9, 9);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].source, s2);

        // Query range [10..20) x [10..20) should overlap nothing.
        let result = reg.projections_in_range(&sheet, 10, 10, 20, 20);
        assert!(result.is_empty());
    }

    // -----------------------------------------------------------------------
    // Test: projections_in_range — overlapping projections
    // -----------------------------------------------------------------------

    #[test]
    fn test_projections_in_range_overlap() {
        let mut reg = ProjectionRegistry::new();
        let s1 = make_cell_id(1);
        let s2 = make_cell_id(2);
        let sheet = make_sheet_id(100);

        // Two projections that overlap in space.
        reg.register(s1, sheet, 0, 0, 5, 5);
        reg.register(s2, sheet, 3, 3, 5, 5);

        // Query that covers the overlap region.
        let result = reg.projections_in_range(&sheet, 3, 3, 5, 5);
        assert_eq!(result.len(), 2);
    }

    // -----------------------------------------------------------------------
    // Test: clear
    // -----------------------------------------------------------------------

    #[test]
    fn test_clear() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        reg.register(source, sheet, 0, 0, 3, 3);
        assert!(reg.is_source(&source));

        reg.clear();
        assert!(!reg.is_source(&source));
        assert!(reg.resolve(&sheet, 1, 1).is_none());
        assert!(reg.source_at(&sheet, 0, 0).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: iter_projections
    // -----------------------------------------------------------------------

    #[test]
    fn test_iter_projections() {
        let mut reg = ProjectionRegistry::new();
        let s1 = make_cell_id(1);
        let s2 = make_cell_id(2);
        let sheet = make_sheet_id(100);

        reg.register(s1, sheet, 0, 0, 2, 2);
        reg.register(s2, sheet, 5, 5, 3, 3);

        let mut items: Vec<CellId> = reg.iter_projections().map(|(id, _)| *id).collect();
        items.sort_by_key(|c| c.as_u128());
        assert_eq!(items, vec![s1, s2]);
    }

    // -----------------------------------------------------------------------
    // Test: conflict detection — no conflict with empty cells
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_conflict_no_conflict() {
        let reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        let mirror = make_mirror_with_sheet(sheet, vec![(source, 0, 0, CellValue::Null)]);

        let result = reg.check_conflict(&mirror, &sheet, 0, 0, 3, 1, &source);
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Test: conflict detection — occupied cell
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_conflict_occupied_cell() {
        let reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let blocker = make_cell_id(2);
        let sheet = make_sheet_id(100);

        let mirror = make_mirror_with_sheet(
            sheet,
            vec![
                (source, 0, 0, CellValue::Null),
                (blocker, 1, 0, CellValue::Number(FiniteF64::must(42.0))),
            ],
        );

        let result = reg.check_conflict(&mirror, &sheet, 0, 0, 3, 1, &source);
        assert_eq!(result, Err(blocker));
    }

    // -----------------------------------------------------------------------
    // Test: conflict detection — own projection region is not a conflict
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_conflict_own_projection_expand_ok() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        // Source at (0,0), with existing 2x1 projection.
        // Projected positions don't have CellIds in the mirror.
        let mirror = make_mirror_with_sheet(sheet, vec![(source, 0, 0, CellValue::Null)]);

        // Register source's own projection (2 rows x 1 col).
        reg.register(source, sheet, 0, 0, 2, 1);

        // Expanding to 3 rows: (0,0), (1,0), (2,0).
        // (1,0) is in own projection — should not conflict.
        let result = reg.check_conflict(&mirror, &sheet, 0, 0, 3, 1, &source);
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Test: conflict detection — another source's projection is a conflict
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_conflict_other_projection() {
        let mut reg = ProjectionRegistry::new();
        let source_a = make_cell_id(1);
        let source_b = make_cell_id(2);
        let sheet = make_sheet_id(100);

        // Source A has a projection covering rows 0..3, col 0.
        reg.register(source_a, sheet, 0, 0, 3, 1);

        let mirror = make_mirror_with_sheet(
            sheet,
            vec![
                (source_a, 0, 0, CellValue::Null),
                (source_b, 0, 1, CellValue::Null),
            ],
        );

        // Source B tries to project 3 rows x 2 cols from (0, 0).
        // Position (1, 0) is inside source A's projection → conflict.
        let result = reg.check_conflict(&mirror, &sheet, 0, 0, 3, 2, &source_b);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), source_a);
    }

    // -----------------------------------------------------------------------
    // Test: conflict detection — own projection is not a conflict
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_conflict_own_projection_ok() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        // Source already has a 3x1 projection.
        reg.register(source, sheet, 0, 0, 3, 1);

        let mirror = make_mirror_with_sheet(sheet, vec![(source, 0, 0, CellValue::Null)]);

        // Expanding to 5x2 — own projection positions are NOT conflicts.
        let result = reg.check_conflict(&mirror, &sheet, 0, 0, 5, 2, &source);
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Test: conflict detection — null cell no conflict
    // -----------------------------------------------------------------------

    #[test]
    fn test_check_conflict_null_cell_ok() {
        let reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let empty = make_cell_id(2);
        let sheet = make_sheet_id(100);

        let mirror = make_mirror_with_sheet(
            sheet,
            vec![
                (source, 0, 0, CellValue::Null),
                (empty, 1, 0, CellValue::Null),
            ],
        );

        let result = reg.check_conflict(&mirror, &sheet, 0, 0, 2, 1, &source);
        assert!(result.is_ok());
    }

    // -----------------------------------------------------------------------
    // Test: resolve with projection starting at row 0 covering many rows
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_large_projection() {
        let mut reg = ProjectionRegistry::new();
        let source = make_cell_id(1);
        let sheet = make_sheet_id(100);

        // Projection starting at (0, 0) covering 100 rows x 1 col.
        reg.register(source, sheet, 0, 0, 100, 1);

        assert_eq!(reg.resolve(&sheet, 0, 0), Some((source, 0, 0)));
        assert_eq!(reg.resolve(&sheet, 50, 0), Some((source, 50, 0)));
        assert_eq!(reg.resolve(&sheet, 99, 0), Some((source, 99, 0)));
        assert!(reg.resolve(&sheet, 100, 0).is_none());
    }

    // -----------------------------------------------------------------------
    // Test: resolve with multiple projections, different cols
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_multiple_same_row_different_col() {
        let mut reg = ProjectionRegistry::new();
        let s1 = make_cell_id(1);
        let s2 = make_cell_id(2);
        let sheet = make_sheet_id(100);

        // s1 at (0, 0) 3x1, s2 at (0, 5) 3x1
        reg.register(s1, sheet, 0, 0, 3, 1);
        reg.register(s2, sheet, 0, 5, 3, 1);

        assert_eq!(reg.resolve(&sheet, 1, 0), Some((s1, 1, 0)));
        assert_eq!(reg.resolve(&sheet, 1, 5), Some((s2, 1, 0)));
        assert!(reg.resolve(&sheet, 1, 3).is_none());
    }
}
