//! Core types for the cell mirror.

use cell_types::interval_tree::{IntervalTree, RectLike};
use cell_types::{CellId, ColId, PayloadEncoding, RangeId, RowId, SheetId, SheetPos};
use domain_types::CellFormat;
use formula_types::IdentityFormula;
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::hash_map;
use value_types::CellValue;

use super::range_view::{ColDataState, RangeExtent, RangeView};

// =============================================================================
// Format Range types
// =============================================================================

/// A Format Range — a rectangular region carrying a CellFormat overlay.
///
/// In the format cascade `default -> col -> row -> **Format Range** -> table -> cell`,
/// Format Ranges sit between row and table. When multiple Format Ranges overlap
/// at a cell position, they are merged field-by-field with higher `RangeId`
/// values winning on conflicts (using `merge_formats` semantics).
#[derive(Debug, Clone, Copy)]
pub(crate) struct FormatRange {
    /// Stable identity for this range.
    pub id: RangeId,
    /// Inclusive start row.
    pub start_row: u32,
    /// Inclusive start column.
    pub start_col: u32,
    /// Inclusive end row.
    pub end_row: u32,
    /// Inclusive end column.
    pub end_col: u32,
}

impl RectLike for FormatRange {
    #[inline]
    fn start_row(&self) -> u32 {
        self.start_row
    }

    #[inline]
    fn end_row(&self) -> u32 {
        self.end_row
    }

    #[inline]
    fn start_col(&self) -> u32 {
        self.start_col
    }

    #[inline]
    fn end_col(&self) -> u32 {
        self.end_col
    }
}

/// A sparse whole-column default format range.
#[derive(Debug, Clone, Copy)]
pub(crate) struct ColumnFormatRange {
    pub id: RangeId,
    pub start_col: u32,
    pub end_col: u32,
}

impl RectLike for ColumnFormatRange {
    #[inline]
    fn start_row(&self) -> u32 {
        0
    }

    #[inline]
    fn end_row(&self) -> u32 {
        u32::MAX
    }

    #[inline]
    fn start_col(&self) -> u32 {
        self.start_col
    }

    #[inline]
    fn end_col(&self) -> u32 {
        self.end_col
    }
}

/// A rectangular merge region (zero-based, inclusive bounds).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MergeRegion {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

/// A resolved cell edit (internal representation with parsed identities).
#[derive(Debug, Clone)]
pub struct CellEdit {
    /// Sheet containing this cell.
    pub sheet: SheetId,
    /// Cell identity.
    pub cell: CellId,
    /// Position within the sheet.
    pub pos: SheetPos,
    /// Cell value.
    pub value: CellValue,
    /// Identity-based formula, if any.
    pub formula: Option<IdentityFormula>,
}

/// Entry for a single cell in the mirror.
///
/// `Box<IdentityFormula>` instead of inline: data cells (no formula) drop from
/// 80→32 bytes, saving ~32 MB for a 670K-cell workbook. Formula cells pay one
/// pointer indirection (cold path — evaluation uses `ast_cache`, not this field).
#[derive(Debug, Clone)]
pub struct CellEntry {
    pub value: CellValue,
    /// Identity-based formula (stores references by CellId, not A1 strings).
    pub formula: Option<Box<IdentityFormula>>,
}

impl CellEntry {
    /// Returns true if this entry is a "ghost cell" — Null value with no formula.
    /// Ghost cells are skipped during snapshot loading since callers already
    /// handle missing entries by falling back to `CellValue::Null`.
    pub fn is_ghost(&self) -> bool {
        matches!(self.value, CellValue::Null) && self.formula.is_none()
    }
}

/// Per-sheet cell storage with bidirectional position<->identity index.
#[derive(Debug, Clone)]
pub struct SheetMirror {
    pub id: SheetId,
    pub name: String,
    /// Materialized data extent used for dense/content storage.
    ///
    /// Snapshot hydration tightens this to real content so style/comment-only
    /// ghost rows do not inflate hot storage paths.
    pub rows: u32,
    pub cols: u32,
    /// Declared grid extent used by formula range resolution.
    ///
    /// This preserves blank cells inside the workbook's logical grid for
    /// formulas like `A1:A5` and `C:C`, while `rows`/`cols` remain bounded by
    /// actual content for dense storage and rendering bounds.
    pub grid_rows: u32,
    pub grid_cols: u32,
    /// Identity dimensions — includes all cells that have a CellId (content cells
    /// plus comment-only ghost cells). Always >= rows/cols.
    pub identity_rows: u32,
    pub identity_cols: u32,
    /// Identity-keyed cell store.
    pub(crate) cells: FxHashMap<CellId, CellEntry>,
    /// Position -> CellId index.
    pub(crate) pos_to_id: FxHashMap<SheetPos, CellId>,
    /// CellId -> Position reverse index.
    pub(crate) id_to_pos: FxHashMap<CellId, SheetPos>,
    /// Column-major dense storage for fast range access. Indexed: col_data[col][row] = CellValue.
    pub(crate) col_data: FxHashMap<u32, Vec<CellValue>>,
    /// RowId -> row index within this sheet. Populated from `GridIndex` at
    /// engine assembly time and refreshed after structural mutations.
    /// unified reference model — enables full-row refs (`1:1`) to resolve to a concrete
    /// `(SheetId, row_index)` tuple for display-time prefix emission.
    pub(crate) row_to_index: FxHashMap<RowId, u32>,
    /// ColId -> col index within this sheet. Same shape and motivation as
    /// `row_to_index`.
    pub(crate) col_to_index: FxHashMap<ColId, u32>,
    /// Reverse of `row_to_index`: row index -> RowId.
    pub(crate) index_to_row: FxHashMap<u32, RowId>,
    /// Reverse of `col_to_index`: col index -> ColId.
    pub(crate) index_to_col: FxHashMap<u32, ColId>,

    // --- Range storage ---
    pub(crate) range_views: FxHashMap<RangeId, RangeView>,
    pub(crate) range_spatial_index: IntervalTree<RangeExtent>,
    pub(crate) col_data_state: FxHashMap<u32, ColDataState>,

    // --- Domain caches ---
    // These are lazily populated from the storage layer or snapshot hydration.
    /// Cached merge regions for this sheet.
    pub(super) merge_regions: Vec<MergeRegion>,
    /// Row index -> custom height (only non-default rows are stored).
    pub(super) row_heights: FxHashMap<u32, f64>,
    /// Column index -> custom width (only non-default columns are stored).
    pub(super) col_widths: FxHashMap<u32, f64>,
    /// Set of hidden row indices.
    pub(super) hidden_rows: FxHashSet<u32>,
    /// Set of hidden column indices.
    pub(super) hidden_cols: FxHashSet<u32>,
    /// Cells that have comments attached.
    pub(super) comment_cells: FxHashSet<CellId>,
    /// Cells that have sparklines attached.
    pub(super) sparkline_cells: FxHashSet<CellId>,
    /// Whether formula calculation is enabled for this sheet (default: true).
    /// When false, the scheduler skips evaluation for cells in this sheet,
    /// retaining their last computed values. Cells remain in the dependency
    /// graph so re-enabling triggers correct recalculation.
    pub enable_calculation: bool,

    // --- Format Range caches ---
    /// Spatial index of Format Ranges for this sheet.
    /// Used by the format cascade to find overlapping Format Ranges at a cell position.
    pub(crate) format_ranges: Vec<FormatRange>,
    pub(crate) format_range_spatial_index: IntervalTree<FormatRange>,
    /// Cached CellFormat per RangeId, populated during hydration from the `rangeFormats` Yrs sub-map.
    pub(crate) range_format_cache: FxHashMap<RangeId, CellFormat>,
    /// Original XLSX cellXfs style id per imported format RangeId.
    pub(crate) range_xlsx_style_id_cache: FxHashMap<RangeId, u32>,

    // --- Column format range caches ---
    pub(crate) col_format_ranges: Vec<ColumnFormatRange>,
    pub(crate) col_format_range_spatial_index: IntervalTree<ColumnFormatRange>,
    pub(crate) col_format_range_cache: FxHashMap<RangeId, CellFormat>,
    pub(crate) col_range_xlsx_style_id_cache: FxHashMap<RangeId, u32>,
}

impl SheetMirror {
    /// Create an empty sheet mirror.
    pub fn new(id: SheetId, name: String, rows: u32, cols: u32) -> Self {
        Self {
            id,
            name,
            rows,
            cols,
            grid_rows: rows,
            grid_cols: cols,
            identity_rows: rows,
            identity_cols: cols,
            cells: FxHashMap::default(),
            pos_to_id: FxHashMap::default(),
            id_to_pos: FxHashMap::default(),
            col_data: FxHashMap::default(),
            row_to_index: FxHashMap::default(),
            col_to_index: FxHashMap::default(),
            index_to_row: FxHashMap::default(),
            index_to_col: FxHashMap::default(),
            range_views: FxHashMap::default(),
            range_spatial_index: IntervalTree::new(),
            col_data_state: FxHashMap::default(),
            merge_regions: Vec::new(),
            row_heights: FxHashMap::default(),
            col_widths: FxHashMap::default(),
            hidden_rows: FxHashSet::default(),
            hidden_cols: FxHashSet::default(),
            comment_cells: FxHashSet::default(),
            sparkline_cells: FxHashSet::default(),
            enable_calculation: true,
            format_ranges: Vec::new(),
            format_range_spatial_index: IntervalTree::new(),
            range_format_cache: FxHashMap::default(),
            range_xlsx_style_id_cache: FxHashMap::default(),
            col_format_ranges: Vec::new(),
            col_format_range_spatial_index: IntervalTree::new(),
            col_format_range_cache: FxHashMap::default(),
            col_range_xlsx_style_id_cache: FxHashMap::default(),
        }
    }

    /// Create a sheet mirror with pre-sized cell maps.
    ///
    /// Pre-allocates `cells`, `pos_to_id`, and `id_to_pos` HashMaps to avoid
    /// incremental rehashing during snapshot loading. For a 2M-cell workbook
    /// this eliminates ~20 rehash cycles per HashMap.
    pub fn with_capacity(
        id: SheetId,
        name: String,
        rows: u32,
        cols: u32,
        cell_capacity: usize,
    ) -> Self {
        Self {
            id,
            name,
            rows,
            cols,
            grid_rows: rows,
            grid_cols: cols,
            identity_rows: rows,
            identity_cols: cols,
            cells: FxHashMap::with_capacity_and_hasher(cell_capacity, Default::default()),
            pos_to_id: FxHashMap::with_capacity_and_hasher(cell_capacity, Default::default()),
            id_to_pos: FxHashMap::with_capacity_and_hasher(cell_capacity, Default::default()),
            col_data: FxHashMap::default(),
            row_to_index: FxHashMap::default(),
            col_to_index: FxHashMap::default(),
            index_to_row: FxHashMap::default(),
            index_to_col: FxHashMap::default(),
            range_views: FxHashMap::default(),
            range_spatial_index: IntervalTree::new(),
            col_data_state: FxHashMap::default(),
            merge_regions: Vec::new(),
            row_heights: FxHashMap::default(),
            col_widths: FxHashMap::default(),
            hidden_rows: FxHashSet::default(),
            hidden_cols: FxHashSet::default(),
            comment_cells: FxHashSet::default(),
            sparkline_cells: FxHashSet::default(),
            enable_calculation: true,
            format_ranges: Vec::new(),
            format_range_spatial_index: IntervalTree::new(),
            range_format_cache: FxHashMap::default(),
            range_xlsx_style_id_cache: FxHashMap::default(),
            col_format_ranges: Vec::new(),
            col_format_range_spatial_index: IntervalTree::new(),
            col_format_range_cache: FxHashMap::default(),
            col_range_xlsx_style_id_cache: FxHashMap::default(),
        }
    }

    /// Expand sheet extent to include the given position.
    /// Called by every method that registers a cell at a position.
    #[inline]
    pub(super) fn expand_extent(&mut self, pos: SheetPos) {
        if pos.row() + 1 > self.rows {
            self.rows = pos.row() + 1;
        }
        if pos.col() + 1 > self.cols {
            self.cols = pos.col() + 1;
        }
        if pos.row() + 1 > self.grid_rows {
            self.grid_rows = pos.row() + 1;
        }
        if pos.col() + 1 > self.grid_cols {
            self.grid_cols = pos.col() + 1;
        }
        if pos.row() + 1 > self.identity_rows {
            self.identity_rows = pos.row() + 1;
        }
        if pos.col() + 1 > self.identity_cols {
            self.identity_cols = pos.col() + 1;
        }
    }

    /// Expand identity extent only (for ghost cells that shouldn't affect data extent).
    #[inline]
    pub(super) fn expand_identity_extent(&mut self, pos: SheetPos) {
        if pos.row() + 1 > self.identity_rows {
            self.identity_rows = pos.row() + 1;
        }
        if pos.col() + 1 > self.identity_cols {
            self.identity_cols = pos.col() + 1;
        }
    }

    /// Rows visible to formula range resolution.
    #[inline]
    pub fn formula_rows(&self) -> u32 {
        self.grid_rows.max(self.rows)
    }

    /// Columns visible to formula range resolution.
    #[inline]
    pub fn formula_cols(&self) -> u32 {
        self.grid_cols.max(self.cols)
    }

    /// Get a column's dense data as a slice, if available.
    pub fn get_column_slice(&self, col: u32) -> Option<&[CellValue]> {
        debug_assert!(
            self.col_data_state.get(&col) != Some(&ColDataState::Partial),
            "get_column_slice called during mutation phase with Partial col_data for col {col}"
        );
        self.col_data.get(&col).map(|v| v.as_slice())
    }

    // -----------------------------------------------------------------------
    // Read accessors (encapsulate map fields)
    // -----------------------------------------------------------------------

    /// Resolve a CellId to its position within this sheet.
    ///
    /// For virtual CellIds that are not eagerly registered, attempts
    /// reverse resolution via the row/col identity indexes.
    pub fn position_of(&self, cell_id: &CellId) -> Option<SheetPos> {
        if let Some(pos) = self.id_to_pos.get(cell_id).copied() {
            return Some(pos);
        }
        // Virtual CellIds for large Ranges may not be in id_to_pos.
        // Resolve via row_to_index / col_to_index if the cell was derived
        // via CellId::virtual_at.
        None
    }

    /// Resolve a position to its CellId.
    ///
    /// Checks the anchored `pos_to_id` first, then falls back to the
    /// Range spatial index to synthesize a virtual CellId.
    pub fn cell_id_at(&self, pos: SheetPos) -> Option<CellId> {
        if let Some(id) = self.pos_to_id.get(&pos).copied() {
            return Some(id);
        }
        let hits = self.range_spatial_index.query(pos.row(), pos.col());
        if hits.is_empty() {
            return None;
        }
        let row_id = self.index_to_row.get(&pos.row()).copied()?;
        let col_id = self.index_to_col.get(&pos.col()).copied()?;
        Some(CellId::virtual_at(self.id, row_id, col_id))
    }

    /// Get a cell entry by CellId.
    pub fn get_cell(&self, cell_id: &CellId) -> Option<&CellEntry> {
        self.cells.get(cell_id)
    }

    /// Iterate over all CellIds in this sheet.
    pub fn cell_ids(&self) -> hash_map::Keys<'_, CellId, CellEntry> {
        self.cells.keys()
    }

    /// Iterate over all (CellId, CellEntry) pairs.
    pub fn cells_iter(&self) -> hash_map::Iter<'_, CellId, CellEntry> {
        self.cells.iter()
    }

    pub fn position_for_diagnostics(&self, cell_id: &CellId) -> Option<SheetPos> {
        self.id_to_pos.get(cell_id).copied()
    }

    /// Whether the column-major dense storage is empty.
    pub fn col_data_is_empty(&self) -> bool {
        self.col_data.is_empty()
    }

    /// Number of cells in this sheet.
    pub fn cell_count(&self) -> usize {
        self.cells.len()
    }

    /// Mutable access to the cell store for Range fold operations.
    pub fn cells_mut(&mut self) -> &mut FxHashMap<CellId, CellEntry> {
        &mut self.cells
    }

    /// Resolve a [`RowId`] to its 0-based row index within this sheet.
    ///
    /// Populated by [`crate::mirror::CellMirror::install_row_col_indexes`].
    #[inline]
    pub fn row_index_of(&self, row_id: &RowId) -> Option<u32> {
        self.row_to_index.get(row_id).copied()
    }

    /// Resolve a [`ColId`] to its 0-based column index within this sheet.
    #[inline]
    pub fn col_index_of(&self, col_id: &ColId) -> Option<u32> {
        self.col_to_index.get(col_id).copied()
    }

    /// Resolve a row index to its [`RowId`].
    #[inline]
    pub fn row_id_at(&self, index: u32) -> Option<RowId> {
        self.index_to_row.get(&index).copied()
    }

    /// Resolve a column index to its [`ColId`].
    #[inline]
    pub fn col_id_at(&self, index: u32) -> Option<ColId> {
        self.index_to_col.get(&index).copied()
    }

    // -----------------------------------------------------------------------
    // Range iterators
    // -----------------------------------------------------------------------

    pub fn range_views_is_empty(&self) -> bool {
        self.range_views.is_empty()
    }

    pub fn iter_anchored_cells(&self) -> impl Iterator<Item = (&CellId, &CellEntry)> {
        self.cells.iter()
    }

    pub fn iter_ranges(&self) -> impl Iterator<Item = (&RangeId, &RangeView)> {
        self.range_views.iter()
    }

    /// Iterate ranges in deterministic storage-contract order.
    ///
    /// `range_views` is an `FxHashMap`; callers that merge overlapping ranges
    /// must not depend on its raw iteration order.
    pub(crate) fn ranges_sorted_by_id(&self) -> Vec<(&RangeId, &RangeView)> {
        let mut ranges: Vec<_> = self.range_views.iter().collect();
        ranges.sort_by_key(|(id, _)| id.as_u128());
        ranges
    }

    /// Stream range payload values as sheet coordinates for full-sheet export.
    ///
    /// `RangeView` stays identity-native; this sheet-level helper owns the
    /// RowId/ColId to row/col conversion.
    pub(crate) fn visit_range_values_for_export(&self, mut visit: impl FnMut(u32, u32, CellValue)) {
        for (_, rv) in self.ranges_sorted_by_id() {
            rv.visit_values(|row_id, col_id, value| {
                let Some(row) = self.row_index_of(&row_id) else {
                    return;
                };
                let Some(col) = self.col_index_of(&col_id) else {
                    return;
                };
                visit(row, col, value);
            });
        }
    }

    // -----------------------------------------------------------------------
    // Range-aware col_data rebuild
    // -----------------------------------------------------------------------

    pub fn rebuild_col_data(&mut self, col: u32) {
        let col_id = match self.index_to_col.get(&col).copied() {
            Some(id) => id,
            None => {
                self.col_data_state.remove(&col);
                return;
            }
        };

        let mut has_range = false;
        let mut max_row: usize = self.rows as usize;

        for rv in self.range_views.values() {
            if rv.encoding == PayloadEncoding::None {
                continue;
            }
            if rv.col_offset_by_id.contains_key(&col_id) {
                has_range = true;
                for &row_id in rv.row_offset_by_id.keys() {
                    if let Some(&row_idx) = self.row_to_index.get(&row_id) {
                        max_row = max_row.max(row_idx as usize + 1);
                    }
                }
            }
        }

        if !has_range {
            self.col_data_state.remove(&col);
            return;
        }

        // Find max row from per-cell entries at this column
        for pos in self.pos_to_id.keys() {
            if pos.col() == col {
                max_row = max_row.max(pos.row() as usize + 1);
            }
        }

        let size = max_row.max(self.rows as usize);
        let mut data = vec![CellValue::Null; size];

        // Layer 1: decode Range payload data into the vector
        for rv in self.range_views.values() {
            if rv.encoding == PayloadEncoding::None {
                continue;
            }
            if let Some(&col_offset) = rv.col_offset_by_id.get(&col_id) {
                rv.decode_column_into(col_offset, &self.row_to_index, &mut data);
            }
        }

        self.apply_column_overlays(col, col_id, &mut data);

        self.col_data.insert(col, data);
        self.col_data_state.insert(col, ColDataState::Complete);
    }

    /// Rebuild a known set of range-backed columns together.
    ///
    /// This is the deferred hydration path: when several columns belong to the
    /// same MixedCbor range, decode the range once into all destination columns.
    pub(crate) fn rebuild_range_columns_data(&mut self, cols: &FxHashSet<u32>) {
        let mut columns: FxHashMap<u32, Vec<CellValue>> = FxHashMap::default();

        for &col in cols {
            let Some(col_id) = self.index_to_col.get(&col).copied() else {
                self.col_data_state.remove(&col);
                continue;
            };
            let size = self.column_data_size(col, col_id);
            columns.insert(col, vec![CellValue::Null; size]);
        }

        for rv in self.range_views.values() {
            if rv.encoding == PayloadEncoding::None {
                continue;
            }
            rv.decode_range_into_columns(&self.row_to_index, &self.col_to_index, &mut columns);
        }

        for &col in cols {
            let Some(col_id) = self.index_to_col.get(&col).copied() else {
                continue;
            };
            let Some(data) = columns.get_mut(&col) else {
                continue;
            };
            self.apply_column_overlays(col, col_id, data);
        }

        for (col, data) in columns {
            self.col_data.insert(col, data);
            self.col_data_state.insert(col, ColDataState::Complete);
        }
    }

    fn column_data_size(&self, col: u32, col_id: ColId) -> usize {
        let mut max_row = self.rows as usize;

        for rv in self.range_views.values() {
            if rv.encoding == PayloadEncoding::None {
                continue;
            }
            if rv.col_offset_by_id.contains_key(&col_id) {
                for &row_id in rv.row_offset_by_id.keys() {
                    if let Some(&row_idx) = self.row_to_index.get(&row_id) {
                        max_row = max_row.max(row_idx as usize + 1);
                    }
                }
            }
        }

        for pos in self.pos_to_id.keys() {
            if pos.col() == col {
                max_row = max_row.max(pos.row() as usize + 1);
            }
        }

        max_row.max(self.rows as usize)
    }

    fn apply_column_overlays(&self, col: u32, col_id: ColId, data: &mut [CellValue]) {
        // Layer 2: per-cell overrides overwrite payload values. Imported
        // ghost identities (Null with no formula) carry metadata/addressability
        // only and must not erase range payloads. User-authored blank range
        // overrides are virtual cells and still suppress the payload value.
        for (pos, cell_id) in &self.pos_to_id {
            if pos.col() == col
                && let Some(entry) = self.cells.get(cell_id)
            {
                let is_blank_range_override =
                    cell_id.is_virtual() && entry.value.is_null() && entry.formula.is_none();
                let should_overlay =
                    !entry.value.is_null() || entry.formula.is_some() || is_blank_range_override;
                if !should_overlay {
                    continue;
                }
                let row = pos.row() as usize;
                if row < data.len() {
                    data[row] = entry.value.clone();
                }
            }
        }

        // Layer 3: RangeView overrides that have explicit CellId entries.
        for rv in self.range_views.values() {
            if let Some(&col_offset) = rv.col_offset_by_id.get(&col_id) {
                let _ = col_offset;
                for ((row_id, ov_col_id), cell_id) in &rv.overrides {
                    if *ov_col_id != col_id {
                        continue;
                    }
                    if let Some(entry) = self.cells.get(cell_id)
                        && let Some(&row_idx) = self.row_to_index.get(row_id)
                    {
                        let row = row_idx as usize;
                        if row < data.len() {
                            data[row] = entry.value.clone();
                        }
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Format Range accessors
    // -----------------------------------------------------------------------

    /// Get all format ranges that cover a given cell position.
    ///
    /// Returns an iterator of `(RangeId, &CellFormat)` pairs sorted by RangeId
    /// (ascending) so that callers can merge with higher-RangeId winning on
    /// per-property conflicts.
    pub(crate) fn format_ranges_at(&self, row: u32, col: u32) -> Vec<(RangeId, &CellFormat)> {
        let mut matches: Vec<(RangeId, &CellFormat)> = self
            .format_range_spatial_index
            .query(row, col)
            .into_iter()
            .filter_map(|r| self.range_format_cache.get(&r.id).map(|fmt| (r.id, fmt)))
            .collect();
        // Sort by RangeId ascending so we can merge lower-first, higher-wins.
        matches.sort_by_key(|(id, _)| id.as_u128());
        matches
    }

    pub(crate) fn rebuild_format_range_spatial_index(&mut self) {
        self.format_range_spatial_index = IntervalTree::build(&self.format_ranges);
    }

    /// Get the format ranges spatial index.
    pub(crate) fn format_ranges(&self) -> &[FormatRange] {
        &self.format_ranges
    }

    /// Get the format cache.
    pub(crate) fn range_format_cache(&self) -> &FxHashMap<RangeId, CellFormat> {
        &self.range_format_cache
    }

    /// Get the imported XLSX style id cache for format ranges.
    pub(crate) fn range_xlsx_style_id_cache(&self) -> &FxHashMap<RangeId, u32> {
        &self.range_xlsx_style_id_cache
    }

    pub(crate) fn col_format_ranges_at(&self, col: u32) -> Vec<(RangeId, &CellFormat)> {
        let mut matches: Vec<(RangeId, &CellFormat)> = self
            .col_format_range_spatial_index
            .query(0, col)
            .into_iter()
            .filter_map(|r| {
                self.col_format_range_cache
                    .get(&r.id)
                    .map(|fmt| (r.id, fmt))
            })
            .collect();
        matches.sort_by_key(|(id, _)| id.as_u128());
        matches
    }

    pub(crate) fn rebuild_col_format_range_spatial_index(&mut self) {
        self.col_format_range_spatial_index = IntervalTree::build(&self.col_format_ranges);
    }

    pub(crate) fn col_format_ranges(&self) -> &[ColumnFormatRange] {
        &self.col_format_ranges
    }

    pub(crate) fn col_format_range_cache(&self) -> &FxHashMap<RangeId, CellFormat> {
        &self.col_format_range_cache
    }

    pub(crate) fn col_range_xlsx_style_id_cache(&self) -> &FxHashMap<RangeId, u32> {
        &self.col_range_xlsx_style_id_cache
    }
}
