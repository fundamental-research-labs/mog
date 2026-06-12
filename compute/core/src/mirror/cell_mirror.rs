//! The top-level CellMirror struct definition.

use rustc_hash::{FxHashMap, FxHashSet};

use crate::projection::{
    CellRender, MaterializedCellView, PlainCellView, ProjectionRegistry, ProjectionView,
    RegionKind, RegionRef,
};
use cell_types::{CellId, ColId, RowId, SheetId};
use domain_types::domain::table::TableCatalogEntry as CanonicalTable;
use formula_types::TableDef;
use snapshot_types::{DataTableRegionDef, PivotTableDef};

use super::dense::DenseColumnCache;
use super::types::SheetMirror;
use super::variable_store::VariableStore;

/// The top-level cell mirror — identity-indexed, in-process cell store.
///
/// Holds all sheets with their cells, plus workbook-level named ranges and tables.
#[derive(Debug, Clone)]
pub struct CellMirror {
    pub(super) sheets: FxHashMap<SheetId, SheetMirror>,
    /// Lowercase sheet name -> SheetId for case-insensitive lookup.
    pub(super) sheet_names: FxHashMap<String, SheetId>,
    /// Scope-aware variable store (named ranges / variables).
    pub(crate) variables: VariableStore,
    pub(super) tables: Vec<CanonicalTable>,
    /// Formula engine cache — derived from canonical tables via `table_to_table_def`.
    pub(super) table_defs: Vec<TableDef>,
    pub(super) pivot_tables: Vec<PivotTableDef>,
    pub(super) data_table_regions: Vec<DataTableRegionDef>,
    /// Dense columnar cache for SIMD-accelerated aggregation over large ranges.
    pub(super) dense_cache: DenseColumnCache,
    /// Spatial index for array projections.
    pub projection_registry: ProjectionRegistry,
    /// Reverse index: CellId -> SheetId for O(1) sheet lookup.
    pub(super) cell_to_sheet: FxHashMap<CellId, SheetId>,
    /// Reverse index: RowId -> SheetId. Populated from the engine's
    /// `GridIndex` via [`CellMirror::populate_row_col_indexes`] at engine
    /// assembly time and refreshed after structural mutations.
    ///
    /// unified reference model — closes the latent cross-sheet full-row prefix drop
    /// (invariant #9). Today there is no `RowId -> SheetId` index anywhere
    /// else in the engine; adding it here keeps the `WorkbookLookup` trait's
    /// `row_index` signature (`Option<(SheetId, u32)>`) answerable from the
    /// mirror's own data without widening the call graph.
    pub(super) row_to_sheet: FxHashMap<RowId, SheetId>,
    /// Reverse index: ColId -> SheetId. Same shape and motivation as
    /// `row_to_sheet` — closes cross-sheet full-column prefix drop.
    pub(super) col_to_sheet: FxHashMap<ColId, SheetId>,
    /// Monotonically increasing version counter per (SheetId, col).
    /// Bumped on every write; used by range caches to detect staleness.
    pub(super) col_versions: FxHashMap<(SheetId, u32), u64>,
    /// Cells with a legacy CSE (Ctrl+Shift+Enter) 1×1 array_ref.
    /// These formulas contain array-returning functions (e.g., TRANSPOSE) but
    /// must NOT spill — they should implicit-intersect to the top-left scalar.
    /// Populated from XLSX `<f t="array" ref="X1:X1">` during snapshot loading.
    pub(crate) cse_single_cell: FxHashSet<CellId>,
    /// Anchors of multi-cell CSE (`Ctrl+Shift+Enter`) array formulas.
    ///
    /// Distinct from `cse_single_cell` (1×1 implicit-intersection CSE) and
    /// from automatic dynamic-array spills (which carry no CSE marker).
    /// A CSE anchor reserves its full output extent: editing any cell
    /// inside the anchor's projection is rejected as
    /// `ComputeError::PartialArrayWrite`. `cse_single_cell` is the 1×1
    /// degenerate case and lives here too — populated via XLSX hydration
    /// and via `set_array_formula` for in-app entries.
    pub(crate) cse_anchors: FxHashSet<CellId>,
}

impl Default for CellMirror {
    fn default() -> Self {
        Self::new()
    }
}

impl CellMirror {
    /// Total number of cells across all sheets.
    pub fn total_cell_count(&self) -> usize {
        self.cell_to_sheet.len()
    }

    /// Create an empty cell mirror.
    pub fn new() -> Self {
        Self {
            sheets: FxHashMap::default(),
            sheet_names: FxHashMap::default(),
            variables: VariableStore::new(),
            tables: Vec::new(),
            table_defs: Vec::new(),
            pivot_tables: Vec::new(),
            data_table_regions: Vec::new(),
            dense_cache: DenseColumnCache::new(),
            projection_registry: ProjectionRegistry::new(),
            cell_to_sheet: FxHashMap::default(),
            row_to_sheet: FxHashMap::default(),
            col_to_sheet: FxHashMap::default(),
            col_versions: FxHashMap::default(),
            cse_single_cell: FxHashSet::default(),
            cse_anchors: FxHashSet::default(),
        }
    }

    /// Mark `cell_id` as the anchor of a CSE array formula. Idempotent.
    /// Members of the CSE array are identified at query time via the
    /// projection registry: a position is a CSE member iff its
    /// projection source is registered here.
    pub fn mark_cse_anchor(&mut self, cell_id: CellId) {
        self.cse_anchors.insert(cell_id);
    }

    /// Clear a CSE anchor mark. Called when the formula on the anchor is
    /// cleared, replaced with a non-array formula, or the projection is
    /// torn down via `clear_cells`.
    pub fn unmark_cse_anchor(&mut self, cell_id: &CellId) -> bool {
        self.cse_anchors.remove(cell_id)
    }

    /// Returns `true` if `cell_id` is registered as a CSE anchor.
    pub fn is_cse_anchor(&self, cell_id: &CellId) -> bool {
        self.cse_anchors.contains(cell_id)
    }

    /// Returns the CSE anchor whose extent covers `(sheet, row, col)` —
    /// either as the anchor cell itself or a projected member — or
    /// `None` if no CSE anchor covers the position.
    ///
    /// Dynamic-array spill anchors (which are NOT in `cse_anchors`)
    /// return `None` here; use [`Self::dynamic_spill_member_covering`]
    /// for their read-only member guard.
    pub fn cse_anchor_covering(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<(CellId, SheetPos)> {
        let (source, _, _) = self.projection_registry.resolve(sheet, row, col)?;
        if !self.cse_anchors.contains(&source) {
            return None;
        }
        let anchor_pos = self.resolve_position(&source)?;
        Some((source, anchor_pos))
    }

    /// Returns the dynamic-array spill anchor whose extent covers
    /// `(sheet, row, col)` as a non-anchor member.
    ///
    /// Pre-existing real cells can still block a dynamic-array formula when
    /// the formula evaluates. Once a projection exists, however, its
    /// materialized members are not independently editable; user edits must be
    /// rejected before a blocker cell is created.
    pub fn dynamic_spill_member_covering(
        &self,
        sheet: &SheetId,
        row: u32,
        col: u32,
    ) -> Option<(CellId, SheetPos)> {
        let (source, _, _) = self.projection_registry.resolve(sheet, row, col)?;
        if self.cse_anchors.contains(&source) {
            return None;
        }
        let anchor_pos = self.resolve_position(&source)?;
        if anchor_pos.row() == row && anchor_pos.col() == col {
            return None;
        }
        Some((source, anchor_pos))
    }

    /// Look up region membership at `(sheet, row, col)` for non-projection
    /// regions (Data Tables today; forward-compatible with pivot / table
    /// column / defined-name / external).
    ///
    /// THE one read of `data_table_regions` from render code — every other
    /// caller MUST go through `cell_render_at`, which composes this helper
    /// after `projection_at`. The architectural rule (per the projection-
    /// family-unification invariant): no parallel render branch may consult
    /// `mirror.data_table_regions` directly.
    ///
    /// Linear scan over `data_table_regions`. The corpus has dozens of Data
    /// Table regions per workbook max; this is single-digit-microsecond
    /// territory. A sorted per-sheet index parallels
    /// `ProjectionRegistry::sheet_index` if profiling shows hot-path cost.
    pub(super) fn region_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<RegionRef> {
        let sheet_uuid = sheet.to_uuid_string();
        for dt in &self.data_table_regions {
            if dt.sheet != sheet_uuid {
                continue;
            }
            if row >= dt.start_row && row <= dt.end_row && col >= dt.start_col && col <= dt.end_col
            {
                let is_anchor = row == dt.start_row && col == dt.start_col;
                return Some(RegionRef {
                    kind: RegionKind::DataTable,
                    anchor_row: dt.start_row,
                    anchor_col: dt.start_col,
                    is_anchor,
                    rows: dt.end_row - dt.start_row + 1,
                    cols: dt.end_col - dt.start_col + 1,
                });
            }
        }
        None
    }

    /// Projection-aware lookup of cell state at `(sheet, row, col)`. THE
    /// chokepoint for every viewport / active-cell / formula-bar render path.
    ///
    /// The bug class this exists to prevent: render code that branches on
    /// "does this position have a CellId?" silently routes projection
    /// members (CSE and dynamic-array spill) through the no-CellId branch
    /// because spill members do NOT allocate CellIds (see scheduler/spill.rs).
    /// `CellRender::Projection` surfaces them explicitly so the renderer can
    /// apply the projection-region flags from one contract: dynamic spill
    /// members carry `IS_SPILL_MEMBER` without `HAS_FORMULA`, while legacy CSE
    /// members also carry `HAS_FORMULA`.
    ///
    /// The `Plain` arm carries optional `region` membership (Data Table /
    /// future pivot / table column / etc.), composed via `region_at`. This
    /// keeps the render code branchless on region membership — there is one
    /// read for every position, and the result tells the consumer everything
    /// it needs.
    ///
    /// The `(row, col)` argument is the *effective* position — callers
    /// resolve merge children to the merge origin upstream, and the
    /// returned view describes that origin.
    pub fn cell_render_at(&self, sheet: &SheetId, row: u32, col: u32) -> CellRender<'_> {
        if let Some((anchor_id, elem_row, elem_col)) =
            self.projection_registry.resolve(sheet, row, col)
        {
            let anchor_pos = match self.resolve_position(&anchor_id) {
                Some(p) => p,
                None => return CellRender::Empty,
            };

            // Anchor stores `CellValue::Array(..)`; element offsets index
            // into it. The single-cell (1×1) case stores the scalar directly.
            let raw = self
                .get_cell_value_raw(&anchor_id)
                .unwrap_or(&CellValue::Null);
            let value: &CellValue = match raw {
                CellValue::Array(arr) => arr
                    .get(elem_row as usize, elem_col as usize)
                    .unwrap_or(&CellValue::Null),
                scalar if elem_row == 0 && elem_col == 0 => scalar,
                _ => &CellValue::Null,
            };

            return CellRender::Projection(ProjectionView {
                anchor_id,
                anchor_row: anchor_pos.row(),
                anchor_col: anchor_pos.col(),
                value,
                is_cse: self.cse_anchors.contains(&anchor_id),
            });
        }

        // Region membership (Data Table today). Computed once per call so
        // both the `Plain` arm and the no-CellId fallthrough see the same
        // answer.
        let region = self.region_at(sheet, row, col);

        if let Some(cell_id) = self.resolve_cell_id(sheet, SheetPos::new(row, col))
            && let Some(sheet_mirror) = self.sheets.get(sheet)
        {
            if let Some(entry) = sheet_mirror.cells.get(&cell_id) {
                // Mirror auto-unwraps Array sources to top-left scalar for
                // backwards compatibility on the non-projection path; preserve
                // that semantics. Ghost-cell fallback to `col_data` matches
                // `get_cell_value`.
                let value = match &entry.value {
                    CellValue::Array(arr) => arr.get(0, 0).unwrap_or(&CellValue::Null),
                    v if v.is_null() && entry.formula.is_none() => sheet_mirror
                        .col_data
                        .get(&col)
                        .and_then(|v| v.get(row as usize))
                        .filter(|cv| !cv.is_null())
                        .unwrap_or(v),
                    v => v,
                };
                return CellRender::Plain(PlainCellView {
                    cell_id,
                    value,
                    region,
                });
            }

            if let Some(value) = sheet_mirror
                .col_data
                .get(&col)
                .and_then(|v| v.get(row as usize))
                .filter(|cv| !cv.is_null())
            {
                return CellRender::Plain(PlainCellView {
                    cell_id,
                    value,
                    region,
                });
            }

            if cell_id.is_virtual()
                && let Some(value) = sheet_mirror
                    .col_data
                    .get(&col)
                    .and_then(|v| v.get(row as usize))
            {
                return CellRender::Plain(PlainCellView {
                    cell_id,
                    value,
                    region,
                });
            }
        }

        if let Some(sheet_mirror) = self.sheets.get(sheet)
            && let Some(value) = sheet_mirror
                .col_data
                .get(&col)
                .and_then(|v| v.get(row as usize))
                .filter(|cv| !cv.is_null())
        {
            return CellRender::Materialized(MaterializedCellView { value });
        }

        // No CellId or materialized value at this position. If a region
        // rectangle covers it anyway (theoretically possible if hydration is
        // inconsistent), we still return `Empty` - the consumer cannot infer
        // region semantics without a value or identity. The region case is
        // logged via the type shape and surfaces if a future region kind
        // requires it.
        let _ = region;
        CellRender::Empty
    }

    /// Return the current version counter for a column on a sheet.
    /// Returns 0 if no writes have been recorded for that column.
    pub fn col_version(&self, sheet: &SheetId, col: u32) -> u64 {
        self.col_versions.get(&(*sheet, col)).copied().unwrap_or(0)
    }

    /// Resolve a [`RowId`] to `(SheetId, row_index)` for display-time lookups.
    ///
    /// Backs [`crate::mirror::read::MirrorPositionLookup::row_index`]. Returns
    /// `None` if the row was never populated into the mirror or has since been
    /// deleted. unified reference model.
    #[inline]
    pub fn row_index_lookup(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        let sheet_id = self.row_to_sheet.get(row_id).copied()?;
        let idx = self.sheets.get(&sheet_id)?.row_index_of(row_id)?;
        Some((sheet_id, idx))
    }

    #[inline]
    pub fn row_id_lookup(&self, sheet_id: &SheetId, row: u32) -> Option<RowId> {
        self.sheets.get(sheet_id)?.row_id_at(row)
    }

    /// Resolve a [`ColId`] to `(SheetId, col_index)` for display-time lookups.
    #[inline]
    pub fn col_index_lookup(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        let sheet_id = self.col_to_sheet.get(col_id).copied()?;
        let idx = self.sheets.get(&sheet_id)?.col_index_of(col_id)?;
        Some((sheet_id, idx))
    }

    #[inline]
    pub fn col_id_lookup(&self, sheet_id: &SheetId, col: u32) -> Option<ColId> {
        self.sheets.get(sheet_id)?.col_id_at(col)
    }

    /// Install a per-sheet `(RowId, row_index)` / `(ColId, col_index)` mapping
    /// on the mirror.
    ///
    /// Called by the engine during assembly after `build_grid_indexes_from_yrs`
    /// produces the authoritative `GridIndex` set, and again after structural
    /// mutations (insert/delete rows/cols, sort remap) so the mirror's view
    /// matches the grid. unified reference model.
    ///
    /// The `pairs` argument is `(SheetId, row_ids, col_ids)` — `row_ids[i]` is
    /// the RowId currently at row index `i`, same for cols. Replaces any
    /// previous maps for that sheet; cross-sheet maps on `CellMirror` are
    /// rebuilt from the union.
    pub fn install_row_col_indexes(
        &mut self,
        pairs: impl IntoIterator<Item = (SheetId, Vec<RowId>, Vec<ColId>)>,
    ) {
        // Rebuild the workbook-level reverse maps from scratch — mutations that
        // removed a sheet would otherwise leave orphan entries.
        self.row_to_sheet.clear();
        self.col_to_sheet.clear();

        for (sheet_id, row_ids, col_ids) in pairs {
            if let Some(sheet) = self.sheets.get_mut(&sheet_id) {
                sheet.row_to_index.clear();
                sheet.col_to_index.clear();
                sheet.index_to_row.clear();
                sheet.index_to_col.clear();
                sheet.row_to_index.reserve(row_ids.len());
                sheet.col_to_index.reserve(col_ids.len());
                sheet.index_to_row.reserve(row_ids.len());
                sheet.index_to_col.reserve(col_ids.len());
                for (i, rid) in row_ids.iter().enumerate() {
                    sheet.row_to_index.insert(*rid, i as u32);
                    sheet.index_to_row.insert(i as u32, *rid);
                }
                for (i, cid) in col_ids.iter().enumerate() {
                    sheet.col_to_index.insert(*cid, i as u32);
                    sheet.index_to_col.insert(i as u32, *cid);
                }
            }
            for rid in row_ids {
                self.row_to_sheet.insert(rid, sheet_id);
            }
            for cid in col_ids {
                self.col_to_sheet.insert(cid, sheet_id);
            }
        }
    }

    /// Increment the version counter for a column on a sheet.
    pub(crate) fn bump_col_version(&mut self, sheet: &SheetId, col: u32) {
        let entry = self.col_versions.entry((*sheet, col)).or_insert(0);
        *entry += 1;
    }

    /// Complete Range hydration after row/col index maps are populated.
    ///
    /// Must be called after `install_row_col_indexes`. Builds spatial indexes,
    /// eagerly registers virtual CellIds for sub-256 Ranges, and rebuilds
    /// col_data for Range-backed columns.
    pub fn finalize_range_hydration(&mut self) {
        use super::range_view::RangeExtent;
        use cell_types::interval_tree::IntervalTree;

        let sheet_ids: Vec<SheetId> = self
            .sheets
            .iter()
            .filter(|(_, s)| !s.range_views.is_empty())
            .map(|(id, _)| *id)
            .collect();
        for sheet_id in sheet_ids {
            let mut extents: Vec<RangeExtent> = Vec::new();
            let mut virtual_registrations: Vec<(SheetPos, CellId)> = Vec::new();
            let mut range_cols: rustc_hash::FxHashSet<u32> = rustc_hash::FxHashSet::default();

            if let Some(sheet) = self.sheets.get(&sheet_id) {
                for rv in sheet.range_views.values() {
                    let extent_cells = rv.num_rows() as usize * rv.num_cols() as usize;

                    // Sub-256: collect virtual CellId registrations
                    if extent_cells > 0 && extent_cells < 256 {
                        for &row_id in rv.row_offset_by_id.keys() {
                            for &col_id in rv.col_offset_by_id.keys() {
                                if let Some(&row_idx) = sheet.row_to_index.get(&row_id)
                                    && let Some(&col_idx) = sheet.col_to_index.get(&col_id)
                                {
                                    let pos = SheetPos::new(row_idx, col_idx);
                                    if !sheet.pos_to_id.contains_key(&pos) {
                                        let vid = CellId::virtual_at(sheet_id, row_id, col_id);
                                        virtual_registrations.push((pos, vid));
                                    }
                                }
                            }
                        }
                    }

                    // Build spatial extent
                    let mut min_row = u32::MAX;
                    let mut max_row = 0u32;
                    let mut min_col = u32::MAX;
                    let mut max_col = 0u32;
                    for &row_id in rv.row_offset_by_id.keys() {
                        if let Some(&idx) = sheet.row_to_index.get(&row_id) {
                            min_row = min_row.min(idx);
                            max_row = max_row.max(idx);
                        }
                    }
                    for &col_id in rv.col_offset_by_id.keys() {
                        if let Some(&idx) = sheet.col_to_index.get(&col_id) {
                            min_col = min_col.min(idx);
                            max_col = max_col.max(idx);
                        }
                    }
                    if min_row <= max_row && min_col <= max_col {
                        extents.push(RangeExtent {
                            range_id: rv.range_id,
                            kind: rv.kind,
                            start_row: min_row,
                            end_row: max_row,
                            start_col: min_col,
                            end_col: max_col,
                        });
                    }

                    // Collect affected columns for col_data rebuild
                    for col_id in rv.col_offset_by_id.keys() {
                        if let Some(&idx) = sheet.col_to_index.get(col_id) {
                            range_cols.insert(idx);
                        }
                    }
                }
            }

            // Apply virtual CellId registrations
            if let Some(sheet) = self.sheets.get_mut(&sheet_id) {
                for (pos, vid) in &virtual_registrations {
                    sheet.pos_to_id.insert(*pos, *vid);
                    sheet.id_to_pos.insert(*vid, *pos);
                }
                sheet.range_spatial_index = IntervalTree::build(&extents);
                sheet.rebuild_range_columns_data(&range_cols);
            }
            for (_, vid) in virtual_registrations {
                self.cell_to_sheet.insert(vid, sheet_id);
            }
            for col in range_cols {
                self.bump_col_version(&sheet_id, col);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// DataSource implementation — bridges CellMirror to the eval cache layer
// ---------------------------------------------------------------------------

use crate::eval::context::traits::DataSource;
use cell_types::SheetPos;
use compute_graph::positions::{CellPosition, PositionResolver};
use value_types::CellValue;

impl DataSource for CellMirror {
    fn col_version(&self, sheet: &SheetId, col: u32) -> u64 {
        self.col_versions.get(&(*sheet, col)).copied().unwrap_or(0)
    }

    fn sheet_rows(&self, sheet: &SheetId) -> Option<u32> {
        self.sheets.get(sheet).map(|s| s.formula_rows())
    }

    fn sheet_cols(&self, sheet: &SheetId) -> Option<u32> {
        self.sheets.get(sheet).map(|s| s.formula_cols())
    }

    fn col_data_is_empty(&self, sheet: &SheetId) -> bool {
        self.sheets.get(sheet).is_none_or(|s| s.col_data_is_empty())
    }

    fn get_column_slice(&self, sheet: &SheetId, col: u32) -> Option<&[CellValue]> {
        self.sheets.get(sheet)?.get_column_slice(col)
    }

    fn cell_id_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<CellId> {
        CellMirror::resolve_cell_id(self, sheet, SheetPos::new(row, col))
    }

    fn sheet_for_cell(&self, cell_id: &CellId) -> Option<SheetId> {
        CellMirror::sheet_for_cell(self, cell_id)
    }

    fn sheet_by_name(&self, name: &str) -> Option<SheetId> {
        CellMirror::sheet_by_name(self, name)
    }

    fn get_cell_value_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<&CellValue> {
        CellMirror::get_cell_value_at(self, sheet, SheetPos::new(row, col))
    }

    fn position_of(&self, sheet: &SheetId, cell_id: &CellId) -> Option<(u32, u32)> {
        self.sheets
            .get(sheet)?
            .position_of(cell_id)
            .map(|p| (p.row(), p.col()))
    }
}

// ---------------------------------------------------------------------------
// PositionResolver implementation — bridges CellMirror to compute-graph
// geometry-aware analysis (dirty-set expansion, cycle detection, topo sort).
// ---------------------------------------------------------------------------

impl PositionResolver for CellMirror {
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition> {
        let sheet = self.sheet_for_cell(cell_id)?;
        let sheet_mirror = self.get_sheet(&sheet)?;
        let pos = sheet_mirror.position_of(cell_id)?;
        Some(CellPosition {
            sheet,
            row: pos.row(),
            col: pos.col(),
        })
    }
}

/// Reference impl — allows `&CellMirror` to be used as a `PositionResolver`
/// (e.g., as the base resolver in `WithOverrides<&CellMirror>`).
impl PositionResolver for &CellMirror {
    #[inline]
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition> {
        <CellMirror as PositionResolver>::resolve(self, cell_id)
    }
}
