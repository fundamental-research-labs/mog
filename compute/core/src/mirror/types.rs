//! Core types for the cell mirror.

use cell_types::interval_tree::{IntervalTree, RectLike};
use cell_types::{CellId, ColId, PayloadEncoding, RangeId, RowId, SheetId, SheetPos};
use domain_types::CellFormat;
use formula_types::IdentityFormula;
use rustc_hash::{FxHashMap, FxHashSet};
use std::collections::hash_map;
use value_types::CellValue;

use super::range_view::{RangeExtent, RangeView};

// =============================================================================
// Format Range types
// =============================================================================

/// Imported/style-range defaults precede table styles; user range edits follow them.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum FormatRangeLayer {
    #[default]
    Inherited,
    Direct,
}

/// A Format Range — a rectangular region carrying a CellFormat overlay.
///
/// Inherited ranges precede table styles; direct user patches follow them.
/// Overlapping rectangles merge field by field in stable precedence order.
/// Splitting a rectangle retains its precedence, while each new edit comes last.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FormatRange {
    /// Stable identity for this range.
    pub id: RangeId,
    /// Stable precedence survives rectangle splitting without changing identity order.
    pub precedence: u128,
    pub layer: FormatRangeLayer,
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
#[derive(Debug, Clone, Copy, PartialEq)]
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
#[derive(Debug, Clone, PartialEq)]
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
    pub(crate) history: crate::storage::engine::history::HistoryCapture,
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
    /// Column extents contain positions only, never duplicate cell values.
    pub(crate) column_lengths: FxHashMap<u32, usize>,
    /// Columns with authored or generated values require layered reads.
    columns_with_overlays: FxHashSet<u32>,
    /// Contiguous imported row axes permit direct borrowed column iteration.
    range_row_starts: FxHashMap<RangeId, u32>,
    /// Generated pivot output has no authored cell entry.
    pub(crate) generated_values: FxHashMap<SheetPos, CellValue>,
    /// Array columns borrow the same Arc payload as their source cell.
    pub(crate) projected_columns: FxHashMap<u32, Vec<ProjectionColumn>>,
    pub(crate) range_columns: FxHashMap<u32, Vec<RangeId>>,
    /// Native axis identities shared with the grid index.
    pub(crate) row_axis: std::sync::Arc<compute_document::identity::AxisIndex<RowId>>,
    pub(crate) col_axis: std::sync::Arc<compute_document::identity::AxisIndex<ColId>>,

    // --- Range storage ---
    pub(crate) range_views: FxHashMap<RangeId, RangeView>,
    pub(crate) range_spatial_index: IntervalTree<RangeExtent>,

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
    /// Native format associated with each format range.
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
            history: Default::default(),
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
            column_lengths: FxHashMap::default(),
            columns_with_overlays: FxHashSet::default(),
            range_row_starts: FxHashMap::default(),
            generated_values: FxHashMap::default(),
            projected_columns: FxHashMap::default(),
            range_columns: FxHashMap::default(),
            row_axis: std::sync::Arc::new(compute_document::identity::AxisIndex::new(
                cell_types::AxisIdentityStore::Explicit(Vec::new()),
            )),
            col_axis: std::sync::Arc::new(compute_document::identity::AxisIndex::new(
                cell_types::AxisIdentityStore::Explicit(Vec::new()),
            )),
            range_views: FxHashMap::default(),
            range_spatial_index: IntervalTree::new(),
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
            history: Default::default(),
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
            column_lengths: FxHashMap::default(),
            columns_with_overlays: FxHashSet::default(),
            range_row_starts: FxHashMap::default(),
            generated_values: FxHashMap::default(),
            projected_columns: FxHashMap::default(),
            range_columns: FxHashMap::default(),
            row_axis: std::sync::Arc::new(compute_document::identity::AxisIndex::new(
                cell_types::AxisIdentityStore::Explicit(Vec::new()),
            )),
            col_axis: std::sync::Arc::new(compute_document::identity::AxisIndex::new(
                cell_types::AxisIdentityStore::Explicit(Vec::new()),
            )),
            range_views: FxHashMap::default(),
            range_spatial_index: IntervalTree::new(),
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

    /// Borrow existing values without creating a dense CellValue copy.
    pub fn get_column_view(&self, col: u32) -> Option<value_types::ColumnView<'_>> {
        let rows = *self.column_lengths.get(&col)?;
        if !self.columns_with_overlays.contains(&col)
            && let Some(ranges) = self.range_columns.get(&col)
            && let [range_id] = ranges.as_slice()
            && let Some(&row_start) = self.range_row_starts.get(range_id)
            && let Some(col_id) = self.col_id_at(col)
        {
            let range = &self.range_views[range_id];
            if let Some(&offset) = range.col_offset_by_id.get(&col_id) {
                return Some(value_types::ColumnView::from_strided(
                    &range.values,
                    range.payload_cols as usize,
                    offset as usize,
                    row_start,
                    rows,
                ));
            }
        }
        Some(value_types::ColumnView::from_grid(self, col, rows))
    }

    pub(crate) fn note_column_position(&mut self, pos: SheetPos) {
        self.columns_with_overlays.insert(pos.col());
        self.column_lengths
            .entry(pos.col())
            .and_modify(|len| *len = (*len).max(pos.row() as usize + 1))
            .or_insert(pos.row() as usize + 1);
    }

    pub(crate) fn consume_range_value(&mut self, pos: SheetPos) {
        let Some(row_id) = self.row_id_at(pos.row()) else {
            return;
        };
        let Some(col_id) = self.col_id_at(pos.col()) else {
            return;
        };
        if let Some(ranges) = self.range_columns.get(&pos.col()) {
            for id in ranges {
                if let Some(range) = self.range_views.get_mut(id) {
                    range.consume_value(&row_id, &col_id);
                }
            }
        }
    }

    /// Read the authored value, or its range/generated source, by position.
    pub fn value_at(&self, pos: SheetPos) -> Option<&CellValue> {
        let cell = self.pos_to_id.get(&pos);
        let entry = cell.and_then(|id| self.cells.get(id));
        if let Some(entry) = entry {
            if !entry.is_ghost() || cell.is_some_and(|id| id.is_virtual()) {
                return match &entry.value {
                    CellValue::Array(array) => array.get(0, 0),
                    value => Some(value),
                };
            }
        }
        if let Some(columns) = self.projected_columns.get(&pos.col()) {
            for column in columns.iter().rev() {
                if let Some(row) = pos.row().checked_sub(column.origin_row)
                    && let Some(value) = column.array.get(row as usize, column.array_col)
                    && (row != 0 || column.array_col != 0)
                {
                    return Some(value);
                }
            }
        }
        if let Some(value) = self.generated_values.get(&pos) {
            return Some(value);
        }
        if let Some(ranges) = self.range_columns.get(&pos.col())
            && let Some(row_id) = self.row_id_at(pos.row())
            && let Some(col_id) = self.col_id_at(pos.col())
        {
            for range_id in ranges.iter().rev() {
                let range = &self.range_views[range_id];
                if let Some(value) = range.value_at(&row_id, &col_id) {
                    return Some(value);
                }
            }
        }
        entry.map(|entry| &entry.value)
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
        let row_id = self.row_id_at(pos.row())?;
        let col_id = self.col_id_at(pos.col())?;
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

    /// Whether the sheet has any value-bearing columns.
    pub fn column_values_are_empty(&self) -> bool {
        self.column_lengths.is_empty()
    }

    /// Bounds of visible non-null content, including generated output.
    pub(crate) fn dense_content_bounds(&self) -> Option<(u32, u32, u32, u32)> {
        let mut bounds = None;
        let mut include = |row: u32, col: u32| {
            if self
                .value_at(SheetPos::new(row, col))
                .is_none_or(CellValue::is_null)
            {
                return;
            }
            let (min_row, min_col, max_row, max_col) = bounds.get_or_insert((row, col, row, col));
            *min_row = (*min_row).min(row);
            *max_row = (*max_row).max(row);
            *min_col = (*min_col).min(col);
            *max_col = (*max_col).max(col);
        };
        for pos in self.pos_to_id.keys().chain(self.generated_values.keys()) {
            include(pos.row(), pos.col());
        }
        for (&col, projections) in &self.projected_columns {
            for projection in projections {
                for row in 0..projection.array.rows() {
                    include(projection.origin_row + row as u32, col);
                }
            }
        }
        for range in self.range_views.values() {
            for row_id in range.row_offset_by_id.keys() {
                if let Some(row) = self.row_axis.position_of(self.id, *row_id) {
                    for col_id in range.col_offset_by_id.keys() {
                        if let Some(col) = self.col_axis.position_of(self.id, *col_id) {
                            include(row, col);
                        }
                    }
                }
            }
        }
        bounds
    }

    /// Number of cells in this sheet.
    pub fn cell_count(&self) -> usize {
        self.cells.len()
    }

    /// Resolve a [`RowId`] to its 0-based row index within this sheet.
    ///
    /// Populated by [`crate::mirror::CellMirror::install_row_col_indexes`].
    #[inline]
    pub fn row_index_of(&self, row_id: &RowId) -> Option<u32> {
        self.row_axis.position_of(self.id, *row_id)
    }

    /// Resolve a [`ColId`] to its 0-based column index within this sheet.
    #[inline]
    pub fn col_index_of(&self, col_id: &ColId) -> Option<u32> {
        self.col_axis.position_of(self.id, *col_id)
    }

    /// Resolve a row index to its [`RowId`].
    #[inline]
    pub fn row_id_at(&self, index: u32) -> Option<RowId> {
        self.row_axis.identity_at(self.id, index)
    }

    /// Resolve a column index to its [`ColId`].
    #[inline]
    pub fn col_id_at(&self, index: u32) -> Option<ColId> {
        self.col_axis.identity_at(self.id, index)
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
    // Range and column position indexes
    // -----------------------------------------------------------------------

    pub fn rebuild_column_index(&mut self) {
        self.column_lengths.clear();
        self.columns_with_overlays.clear();
        self.range_row_starts.clear();
        self.range_columns.clear();
        for (id, pos) in &self.id_to_pos {
            if self
                .cells
                .get(id)
                .is_some_and(|entry| !entry.is_ghost() || id.is_virtual())
            {
                self.columns_with_overlays.insert(pos.col());
                self.column_lengths
                    .entry(pos.col())
                    .and_modify(|len| *len = (*len).max(self.rows as usize))
                    .or_insert(self.rows as usize);
            }
        }
        for pos in self.generated_values.keys() {
            self.columns_with_overlays.insert(pos.col());
            self.column_lengths
                .entry(pos.col())
                .and_modify(|len| *len = (*len).max(pos.row() as usize + 1))
                .or_insert(pos.row() as usize + 1);
        }
        for (&col, projections) in &self.projected_columns {
            self.columns_with_overlays.insert(col);
            for projection in projections {
                let end = projection.origin_row as usize + projection.array.rows();
                self.column_lengths
                    .entry(col)
                    .and_modify(|len| *len = (*len).max(end))
                    .or_insert(end);
            }
        }
        for (id, range) in &self.range_views {
            if range.encoding == PayloadEncoding::None {
                continue;
            }
            if range.payload_cols != 0
                && range.row_offset_by_id.len() == range.values.len() / range.payload_cols as usize
                && let Some((first_id, _)) = range
                    .row_offset_by_id
                    .iter()
                    .find(|(_, offset)| **offset == 0)
                && let Some(start) = self.row_axis.position_of(self.id, *first_id)
                && range.row_offset_by_id.iter().all(|(id, offset)| {
                    self.row_axis.position_of(self.id, *id) == start.checked_add(*offset)
                })
            {
                self.range_row_starts.insert(*id, start);
            }
            let rows = range
                .row_offset_by_id
                .keys()
                .filter_map(|id| self.row_axis.position_of(self.id, *id))
                .max()
                .map_or(0, |row| row as usize + 1);
            self.rows = self.rows.max(rows as u32);
            for col_id in range.col_offset_by_id.keys() {
                if let Some(col) = self.col_axis.position_of(self.id, *col_id) {
                    self.cols = self.cols.max(col.saturating_add(1));
                    self.range_columns.entry(col).or_default().push(*id);
                    self.column_lengths
                        .entry(col)
                        .and_modify(|len| *len = (*len).max(rows))
                        .or_insert(rows);
                }
            }
        }
        for ranges in self.range_columns.values_mut() {
            ranges.sort_by_key(|id| id.as_u128());
        }
        let authored_positions: Vec<_> = self
            .pos_to_id
            .iter()
            .filter_map(|(pos, id)| {
                self.cells
                    .get(id)
                    .filter(|entry| !entry.is_ghost() || id.is_virtual())
                    .map(|_| *pos)
            })
            .collect();
        for pos in authored_positions {
            self.consume_range_value(pos);
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
        self.format_ranges_at_layer(row, col, None)
    }

    pub(crate) fn format_ranges_at_layer(
        &self,
        row: u32,
        col: u32,
        layer: Option<FormatRangeLayer>,
    ) -> Vec<(RangeId, &CellFormat)> {
        let mut ranges = self.format_range_spatial_index.query(row, col);
        ranges.retain(|range| layer.is_none_or(|layer| range.layer == layer));
        ranges.sort_by_key(|range| (range.layer, range.precedence, range.id.as_u128()));
        ranges
            .into_iter()
            .filter_map(|range| {
                self.range_format_cache
                    .get(&range.id)
                    .map(|format| (range.id, format))
            })
            .collect()
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

#[derive(Debug, Clone)]
pub(crate) struct ProjectionColumn {
    pub origin_row: u32,
    pub origin_col: u32,
    pub array_col: usize,
    pub array: std::sync::Arc<value_types::CellArray>,
}

impl value_types::ValueGrid for SheetMirror {
    fn value_at(&self, row: u32, col: u32) -> Option<&CellValue> {
        self.value_at(SheetPos::new(row, col))
    }
}
