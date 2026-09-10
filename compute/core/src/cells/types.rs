//! Core types for the cell store.

use cell_types::interval_tree::{IntervalTree, RectLike};
use cell_types::{CellId, ColId, PayloadEncoding, RangeId, RowId, SheetId, SheetPos};
use domain_types::CellFormat;
use formula_types::{IdentityFormula, StructureChange};
use rustc_hash::{FxHashMap, FxHashSet};
use value_types::CellValue;

use super::range_view::{RangeExtent, RangeView};
use crate::imported_array_cache::ImportedArrayCache;

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

/// The resident value of an authored cell. Optional properties live in sidecars.
#[derive(Debug, Clone, PartialEq)]
pub struct CellEntry {
    pub value: CellValue,
}

/// Per-sheet values and a sparse bijection between cells and stable axis pairs.
#[derive(Debug, Clone)]
pub struct SheetStore {
    pub(crate) history: crate::storage::engine::history::HistoryCapture,
    pub(crate) id_alloc: std::sync::Arc<cell_types::IdAllocator>,
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
    /// Sparse stable axis pair -> CellId index.
    pub(crate) cell_by_axes: FxHashMap<(RowId, ColId), CellId>,
    /// CellId -> stable axis pair reverse index.
    pub(crate) axes_by_cell: FxHashMap<CellId, (RowId, ColId)>,
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
    /// Imported dynamic-array spill members are cached package values, not
    /// authored cells. They remain outside `cells`/`pos_to_id` so they cannot
    /// block a live projection, but are available while loading without recalc.
    pub(crate) imported_array_caches: Vec<ImportedArrayCache>,
    /// Position index into `imported_array_caches` for O(1) cache reads.
    imported_array_cache_positions: FxHashMap<SheetPos, (usize, usize)>,
    /// Source-position index into `imported_array_caches` for O(1) owner
    /// invalidation when a live array publishes a result.
    imported_array_cache_sources: FxHashMap<SheetPos, usize>,
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

impl SheetStore {
    /// Create an empty sheet store.
    pub fn new(id: SheetId, name: String, rows: u32, cols: u32) -> Self {
        let id_alloc = std::sync::Arc::new(cell_types::IdAllocator::new());
        let grid = compute_document::identity::GridIndex::new(id, rows, cols, id_alloc.clone());
        Self {
            id_alloc,
            history: Default::default(),
            id,
            name,
            rows,
            cols,
            grid_rows: rows,
            grid_cols: cols,
            identity_rows: rows,
            identity_cols: cols,
            cell_by_axes: FxHashMap::default(),
            axes_by_cell: FxHashMap::default(),
            column_lengths: FxHashMap::default(),
            columns_with_overlays: FxHashSet::default(),
            range_row_starts: FxHashMap::default(),
            generated_values: FxHashMap::default(),
            projected_columns: FxHashMap::default(),
            range_columns: FxHashMap::default(),
            imported_array_caches: Vec::new(),
            imported_array_cache_positions: FxHashMap::default(),
            imported_array_cache_sources: FxHashMap::default(),
            row_axis: grid.row_axis(),
            col_axis: grid.col_axis(),
            range_views: FxHashMap::default(),
            range_spatial_index: IntervalTree::new(),
            merge_regions: Vec::new(),
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

    /// Create a sheet store with pre-sized identity maps.
    ///
    /// Pre-allocates `cell_by_axes` and `axes_by_cell` to avoid incremental
    /// rehashing during snapshot loading. Payload maps live on `CellStore`.
    pub fn with_capacity(
        id: SheetId,
        name: String,
        rows: u32,
        cols: u32,
        cell_capacity: usize,
    ) -> Self {
        let mut sheet = Self::new(id, name, rows, cols);
        sheet.cell_by_axes.reserve(cell_capacity);
        sheet.axes_by_cell.reserve(cell_capacity);
        sheet
    }

    pub(crate) fn set_id_alloc(&mut self, allocator: std::sync::Arc<cell_types::IdAllocator>) {
        allocator.reserve_from(&self.id_alloc);
        // Reserve persisted IDs before any local capacity growth or first write.
        let _ = compute_document::identity::GridIndex::from_shared_axes(
            self.id,
            self.row_axis.clone(),
            self.col_axis.clone(),
            allocator.clone(),
        );
        for cell in self.axes_by_cell.keys().filter(|cell| !cell.is_virtual()) {
            allocator.ensure_past(cell.as_u128());
        }
        self.id_alloc = allocator;
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

    pub(crate) fn strided_column_view(&self, col: u32) -> Option<value_types::ColumnView<'_>> {
        let rows = *self.column_lengths.get(&col)?;
        if !self.columns_with_overlays.contains(&col)
            && let Some(ranges) = self.range_columns.get(&col)
            && let [range_id] = ranges.as_slice()
            && let Some(&row_start) = self.range_row_starts.get(range_id)
            && let Some(col_id) = self.col_id_at(col)
        {
            let range = &self.range_views[range_id];
            if let Some(offset) = range.col_offset_by_id.get(&col_id) {
                return Some(value_types::ColumnView::from_strided(
                    &range.values,
                    range.payload_cols as usize,
                    offset as usize,
                    row_start,
                    rows,
                ));
            }
        }
        None
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
    pub fn value_at<'a>(
        &'a self,
        pos: SheetPos,
        cells: &'a FxHashMap<CellId, CellEntry>,
        formulas: &'a FxHashMap<CellId, IdentityFormula>,
    ) -> Option<&'a CellValue> {
        let cell = self.authored_cell_id_at(pos);
        let entry = cell.and_then(|id| cells.get(&id));
        if let Some(entry) = entry {
            if !entry.value.is_null()
                || cell.is_some_and(|id| formulas.contains_key(&id) || id.is_virtual())
            {
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
        if let Some(&(cache_index, cell_index)) = self.imported_array_cache_positions.get(&pos)
            // Formula dependency resolution may register a ghost CellId at a
            // cached spill position. Such an identity is bookkeeping, not an
            // authored value, so it must not hide the package cache. A real
            // entry (including a formula) and virtual range identities remain
            // authoritative.
            && cell.is_none_or(|id| self.is_ghost(&id, cells, formulas))
            && cell.is_none_or(|id| !id.is_virtual())
            && let Some(cache) = self.imported_array_caches.get(cache_index)
            && cache.values_current
            && let Some(cell) = cache.cells.get(cell_index)
        {
            return Some(&cell.value);
        }
        entry.map(|entry| &entry.value)
    }

    /// Install package-cached values for imported dynamic-array spill members.
    /// Metadata-only identities may exist for these positions, but the cached
    /// values remain outside authored storage slots and are a read/export
    /// fallback until a live recalc supersedes them.
    pub(crate) fn install_imported_array_cache(
        &mut self,
        caches: impl IntoIterator<Item = ImportedArrayCache>,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) {
        self.imported_array_caches.clear();
        self.imported_array_cache_positions.clear();
        self.imported_array_cache_sources.clear();
        for cache in caches {
            let mut cache = cache;
            if cache.rebind_positions(|cell_id| self.position_of(cell_id)) {
                self.imported_array_caches.push(cache);
            }
        }
        self.rebuild_imported_array_cache_index();
        self.rebuild_column_index(cells, formulas);
    }

    /// Rebind imported cache positions after native identities have moved.
    /// Missing source identities retire their cache; missing child identities
    /// are pruned so deleted spill members cannot resurrect stale values.
    pub(crate) fn rebind_imported_array_caches(
        &mut self,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) {
        if self.imported_array_caches.is_empty() {
            return;
        }
        let caches = std::mem::take(&mut self.imported_array_caches);
        let mut rebound = Vec::with_capacity(caches.len());
        for mut cache in caches {
            if cache.rebind_positions(|cell_id| self.position_of(cell_id))
                && !cache.cells.is_empty()
            {
                rebound.push(cache);
            }
        }
        self.imported_array_caches = rebound;
        self.rebuild_imported_array_cache_index();
        self.rebuild_column_index(cells, formulas);
    }

    /// Apply the positional part of a structural change before native cell
    /// identities are shifted, then rebind every surviving cache member to its
    /// post-operation identity.
    pub(crate) fn apply_structure_change_to_imported_array_caches(
        &mut self,
        change: &StructureChange,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) {
        if self.imported_array_caches.is_empty() {
            return;
        }
        let caches = std::mem::take(&mut self.imported_array_caches);
        self.imported_array_caches = caches
            .into_iter()
            .filter_map(|mut cache| cache.remap_for_structure_change(change).then_some(cache))
            .collect();
        self.rebuild_imported_array_cache_index();
        self.rebuild_column_index(cells, formulas);
    }

    fn rebuild_imported_array_cache_index(&mut self) {
        self.imported_array_cache_positions.clear();
        self.imported_array_cache_sources.clear();
        for (cache_index, cache) in self.imported_array_caches.iter().enumerate() {
            self.imported_array_cache_sources
                .insert(cache.source, cache_index);
            for (cell_index, cell) in cache.cells.iter().enumerate() {
                self.imported_array_cache_positions
                    .entry(SheetPos::new(cell.row, cell.col))
                    .or_insert((cache_index, cell_index));
            }
        }
    }

    /// Drop imported package caches and restore column indexes to live values.
    pub(crate) fn clear_imported_array_cache(
        &mut self,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) {
        if self.imported_array_caches.is_empty() {
            return;
        }
        self.imported_array_caches.clear();
        self.imported_array_cache_positions.clear();
        self.imported_array_cache_sources.clear();
        self.rebuild_column_index(cells, formulas);
    }

    pub(crate) fn imported_array_caches(&self) -> &[ImportedArrayCache] {
        &self.imported_array_caches
    }

    pub(crate) fn imported_array_cache_value_at(&self, pos: SheetPos) -> Option<&CellValue> {
        let (cache_index, cell_index) = *self.imported_array_cache_positions.get(&pos)?;
        let cache = self.imported_array_caches.get(cache_index)?;
        if !cache.values_current {
            return None;
        }
        Some(&cache.cells.get(cell_index)?.value)
    }

    /// Stream live materialized projection values as sheet coordinates.
    pub(crate) fn visit_projected_values_for_export(
        &self,
        mut visit: impl FnMut(u32, u32, CellValue),
    ) {
        for (&col, projections) in &self.projected_columns {
            for projection in projections {
                for row in 0..projection.array.rows() {
                    let Some(value) = projection.array.get(row, projection.array_col) else {
                        continue;
                    };
                    visit(projection.origin_row + row as u32, col, value.clone());
                }
            }
        }
    }

    /// Mark only caches whose declared source/range intersects a live change.
    pub(crate) fn invalidate_imported_array_caches_at(
        &mut self,
        positions: impl IntoIterator<Item = SheetPos>,
    ) {
        let mut cache_indices = FxHashSet::default();
        for position in positions {
            if let Some(&cache_index) = self.imported_array_cache_sources.get(&position) {
                cache_indices.insert(cache_index);
            }
            if let Some(&(cache_index, _)) = self.imported_array_cache_positions.get(&position) {
                cache_indices.insert(cache_index);
            }
        }
        for cache_index in cache_indices {
            if let Some(cache) = self.imported_array_caches.get_mut(cache_index) {
                cache.invalidate_values();
            }
        }
    }

    pub(crate) fn has_authored_overlay(
        &self,
        id: &CellId,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) -> bool {
        cells.get(id).is_some_and(|entry| {
            !entry.value.is_null() || formulas.contains_key(id) || id.is_virtual()
        })
    }

    // -----------------------------------------------------------------------
    // Read accessors (encapsulate map fields)
    // -----------------------------------------------------------------------

    /// Resolve a cell's stable axis identities through the current axis order.
    pub fn position_of(&self, cell_id: &CellId) -> Option<SheetPos> {
        let (row, col) = self.axes_by_cell.get(cell_id)?;
        Some(SheetPos::new(
            self.row_index_of(row)?,
            self.col_index_of(col)?,
        ))
    }

    pub fn cell_position(&self, cell_id: &CellId) -> Option<(u32, u32)> {
        self.position_of(cell_id).map(|pos| (pos.row(), pos.col()))
    }

    /// Sparse identity lookup; empty slots have no entry.
    pub fn authored_cell_id_at(&self, pos: SheetPos) -> Option<CellId> {
        let axes = (self.row_id_at(pos.row())?, self.col_id_at(pos.col())?);
        self.cell_by_axes.get(&axes).copied()
    }

    /// Register a stable identity at its current position.
    pub fn register_cell(&mut self, cell_id: CellId, row: u32, col: u32) {
        if self.row_id_at(row).is_none() || self.col_id_at(col).is_none() {
            let mut grid = compute_document::identity::GridIndex::from_shared_axes(
                self.id,
                self.row_axis.clone(),
                self.col_axis.clone(),
                self.id_alloc.clone(),
            );
            grid.ensure_capacity(row, col);
            self.row_axis = grid.row_axis();
            self.col_axis = grid.col_axis();
        }
        if !cell_id.is_virtual() {
            self.id_alloc.ensure_past(cell_id.as_u128());
        }
        let axes = (self.row_id_at(row).unwrap(), self.col_id_at(col).unwrap());
        if let Some(old_axes) = self.axes_by_cell.insert(cell_id, axes) {
            if self.cell_by_axes.get(&old_axes) == Some(&cell_id) {
                self.cell_by_axes.remove(&old_axes);
            }
        }
        if let Some(displaced) = self.cell_by_axes.insert(axes, cell_id) {
            if displaced != cell_id {
                self.axes_by_cell.remove(&displaced);
            }
        }
    }

    pub fn remove_cell_identity(&mut self, cell_id: &CellId) -> Option<SheetPos> {
        let position = self.position_of(cell_id);
        if let Some(axes) = self.axes_by_cell.remove(cell_id) {
            if self.cell_by_axes.get(&axes) == Some(cell_id) {
                self.cell_by_axes.remove(&axes);
            }
        }
        position
    }

    /// All registered authored identities at their current coordinates.
    pub fn cells(&self) -> impl Iterator<Item = (CellId, u32, u32)> + '_ {
        self.axes_by_cell.keys().filter_map(|cell| {
            let pos = self.position_of(cell)?;
            Some((*cell, pos.row(), pos.col()))
        })
    }

    pub fn cells_in_range(
        &self,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> impl Iterator<Item = (CellId, u32, u32)> + '_ {
        self.cells().filter(move |(_, row, col)| {
            *row >= start_row && *row <= end_row && *col >= start_col && *col <= end_col
        })
    }

    /// Resolve a position to its CellId.
    ///
    /// Checks authored axis pairs first, then falls back to the
    /// Range spatial index to synthesize a virtual CellId.
    pub fn cell_id_at(&self, pos: SheetPos) -> Option<CellId> {
        if let Some(id) = self.authored_cell_id_at(pos) {
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

    pub fn is_ghost(
        &self,
        cell_id: &CellId,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) -> bool {
        cells
            .get(cell_id)
            .is_none_or(|entry| entry.value.is_null())
            && !formulas.contains_key(cell_id)
    }

    pub fn position_for_diagnostics(&self, cell_id: &CellId) -> Option<SheetPos> {
        self.position_of(cell_id)
    }

    /// Whether the sheet has any value-bearing columns.
    pub fn column_values_are_empty(&self) -> bool {
        self.column_lengths.is_empty()
    }

    /// Bounds of visible non-null content, including generated output.
    pub(crate) fn dense_content_bounds(
        &self,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) -> Option<(u32, u32, u32, u32)> {
        let mut bounds = None;
        let mut include = |row: u32, col: u32| {
            if self
                .value_at(SheetPos::new(row, col), cells, formulas)
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
        for pos in self
            .cells()
            .map(|(_, row, col)| SheetPos::new(row, col))
            .chain(self.generated_values.keys().copied())
        {
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
                if let Some(row) = self.row_axis.position_of(self.id, row_id) {
                    for col_id in range.col_offset_by_id.keys() {
                        if let Some(col) = self.col_axis.position_of(self.id, col_id) {
                            include(row, col);
                        }
                    }
                }
            }
        }
        bounds
    }

    /// Number of payload-bearing cells whose identity is registered on this sheet.
    pub fn cell_count(&self, cells: &FxHashMap<CellId, CellEntry>) -> usize {
        self.axes_by_cell
            .keys()
            .filter(|id| cells.contains_key(id))
            .count()
    }

    /// Resolve a [`RowId`] to its 0-based row index within this sheet.
    ///
    /// Uses the shared native axis index.
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

    pub fn iter_anchored_cells<'a>(
        &'a self,
        cells: &'a FxHashMap<CellId, CellEntry>,
    ) -> impl Iterator<Item = (&'a CellId, &'a CellEntry)> {
        self.axes_by_cell
            .keys()
            .filter_map(move |id| cells.get_key_value(id))
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

    pub fn rebuild_column_index(
        &mut self,
        cells: &FxHashMap<CellId, CellEntry>,
        formulas: &FxHashMap<CellId, IdentityFormula>,
    ) {
        self.column_lengths.clear();
        self.columns_with_overlays.clear();
        self.range_row_starts.clear();
        self.range_columns.clear();
        for (&id, &(row_id, col_id)) in &self.axes_by_cell {
            let Some(row) = self.row_axis.position_of(self.id, row_id) else {
                continue;
            };
            let Some(col) = self.col_axis.position_of(self.id, col_id) else {
                continue;
            };
            let pos = SheetPos::new(row, col);
            if self.has_authored_overlay(&id, cells, formulas) {
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
            if let Some(start) = range
                .row_offset_by_id
                .contiguous_start(self.id, &self.row_axis)
            {
                self.range_row_starts.insert(*id, start);
            }
            let rows = range
                .row_offset_by_id
                .position_bounds(self.id, &self.row_axis)
                .map_or(0, |(_, last)| last as usize + 1);
            self.rows = self.rows.max(rows as u32);
            for col_id in range.col_offset_by_id.keys() {
                if let Some(col) = self.col_axis.position_of(self.id, col_id) {
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
        let imported_cache_positions: Vec<_> = self
            .imported_array_caches
            .iter()
            .filter(|cache| cache.values_current)
            .flat_map(|cache| {
                cache
                    .cells
                    .iter()
                    .map(|cell| SheetPos::new(cell.row, cell.col))
            })
            .collect();
        for pos in imported_cache_positions {
            self.note_column_position(pos);
        }
        let authored_positions: Vec<_> = self
            .cells()
            .filter(|(id, _, _)| self.has_authored_overlay(id, cells, formulas))
            .map(|(_, row, col)| SheetPos::new(row, col))
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


