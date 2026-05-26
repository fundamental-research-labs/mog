//! RangeStore — unified data scheduling layer for range materialization.
//!
//! Sits between the mirror (raw data) and evaluation contexts, providing
//! a strategy-agnostic cache for materialized range data. Supports three modes:
//! - Eager: bulk pre-materialize via DataPlan (topo/ready-queue)
//! - Lazy: on-demand materialization on first access (demand)
//! - Hybrid: pre-scan + on-demand fallback (parallel demand)

use std::sync::Arc;

use rustc_hash::{FxHashMap, FxHashSet};

use cell_types::{CellId, RangePos, SheetId};
use compute_parser::{ASTNode, AstVisitor};
use formula_types::{CellRef, RangeType};
use value_types::{CellArray, CellValue};

use crate::eval::context::traits::DataSource;

#[cfg(feature = "native")]
use crate::eval::lookup::index_cache::LookupIndexCache;
#[cfg(feature = "native")]
use dashmap::DashMap;
#[cfg(not(feature = "native"))]
use std::cell::RefCell;

// ---------------------------------------------------------------------------
// RangeKey — type alias for RangePos
// ---------------------------------------------------------------------------

/// Cache key for materialized range data.
/// Two range requests resolving to the same sheet + bounding rectangle yield identical data.
/// This is a type alias for `RangePos` from `cell_types`.
pub type RangeKey = RangePos;

// ---------------------------------------------------------------------------
// materialize_range — free function
// ---------------------------------------------------------------------------

/// Materialize range data from a data source using the 3-tier strategy.
///
/// Tiers:
/// 1. Single-column dense: use column slice directly
/// 2. Multi-column dense: iterate column slices
/// 3. Fallback: hash-map cell-by-cell lookup
///
/// When `overrides` is Some, checks the override map before reading from the source.
/// This supports What-If analysis (Goal Seek, Data Tables) without duplicating
/// the materialization logic.
pub fn materialize_range(
    key: &RangeKey,
    source: &dyn DataSource,
    overrides: Option<&FxHashMap<CellId, CellValue>>,
) -> Arc<CellArray> {
    if source.sheet_rows(&key.sheet()).is_none() {
        return Arc::new(CellArray::empty());
    }

    let _mat_span = tracing::info_span!(
        "range_materialize",
        rows = (key.end_row().saturating_sub(key.start_row()) + 1) as u64,
        cols = (key.end_col().saturating_sub(key.start_col()) + 1) as u64,
        single_col = (key.start_col() == key.end_col()) as u64,
    )
    .entered();

    let min_row = key.start_row();
    let max_row = key.end_row();
    let min_col = key.start_col();
    let max_col = key.end_col();

    // Guard: inverted range (can happen after clamping to sheet bounds)
    if max_row < min_row || max_col < min_col {
        return Arc::new(CellArray::empty());
    }

    // Helper closure: read a single cell value, checking overrides first.
    let read_cell = |r: u32, c: u32, source_val: Option<&CellValue>| -> CellValue {
        if let Some(ovs) = overrides
            && let Some(cid) = source.cell_id_at(&key.sheet(), r, c)
            && let Some(ov) = ovs.get(&cid)
        {
            return ov.clone();
        }
        source_val.cloned().unwrap_or(CellValue::Null)
    };

    // Tier 1: Single-column range using dense column store
    if min_col == max_col {
        if let Some(col_slice) = source.get_column_slice(&key.sheet(), min_col) {
            let row_count_u64 = (max_row as u64) - (min_row as u64) + 1;
            let total = row_count_u64 as usize;
            let start = min_row as usize;
            let end = ((max_row + 1) as usize).min(col_slice.len());

            if start < end {
                let mut result: Vec<Vec<CellValue>> = (min_row
                    ..min_row.saturating_add((end - start) as u32))
                    .enumerate()
                    .map(|(i, r)| {
                        let source_val = Some(&col_slice[start + i]);
                        vec![read_cell(r, min_col, source_val)]
                    })
                    .collect();
                // Pad trailing Nulls when col_slice is shorter than the requested range.
                while result.len() < total {
                    let r = min_row + result.len() as u32;
                    result.push(vec![read_cell(r, min_col, None)]);
                }
                return Arc::new(CellArray::from_rows(result));
            } else {
                return Arc::new(CellArray::from_rows(
                    (min_row..=max_row)
                        .map(|r| vec![read_cell(r, min_col, None)])
                        .collect(),
                ));
            }
        }
        // Column not in col_data — all nulls (but still check overrides)
        return Arc::new(CellArray::from_rows(
            (min_row..=max_row)
                .map(|r| vec![read_cell(r, min_col, None)])
                .collect(),
        ));
    }

    // Tier 2: Multi-column range using dense column store
    if !source.col_data_is_empty(&key.sheet()) {
        let num_rows = ((max_row as u64) - (min_row as u64) + 1) as usize;
        let num_cols = ((max_col as u64) - (min_col as u64) + 1) as usize;
        let mut rows = Vec::with_capacity(num_rows);
        for r in min_row..=max_row {
            let mut row = Vec::with_capacity(num_cols);
            for c in min_col..=max_col {
                let source_val = source
                    .get_column_slice(&key.sheet(), c)
                    .and_then(|col| col.get(r as usize));
                row.push(read_cell(r, c, source_val));
            }
            rows.push(row);
        }
        return Arc::new(CellArray::from_rows(rows));
    }

    // Tier 3: Fallback — hash-map-based cell-by-cell lookup
    let mut rows = Vec::with_capacity(((max_row as u64) - (min_row as u64) + 1) as usize);
    for r in min_row..=max_row {
        let mut row = Vec::with_capacity(((max_col as u64) - (min_col as u64) + 1) as usize);
        for c in min_col..=max_col {
            // Check overrides via resolved cell ID
            if let Some(ovs) = overrides
                && let Some(cid) = source.cell_id_at(&key.sheet(), r, c)
                && let Some(ov) = ovs.get(&cid)
            {
                row.push(ov.clone());
                continue;
            }
            let val = source
                .get_cell_value_at(&key.sheet(), r, c)
                .cloned()
                .unwrap_or(CellValue::Null);
            row.push(val);
        }
        rows.push(row);
    }
    Arc::new(CellArray::from_rows(rows))
}

// ---------------------------------------------------------------------------
// DataPlan — AST scanner for pre-materialization
// ---------------------------------------------------------------------------

/// Set of range keys to pre-materialize before parallel evaluation.
pub type DataPlan = FxHashSet<RangeKey>;

/// Scan a set of cells' ASTs to determine which ranges they'll need.
/// Returns a DataPlan containing all statically-resolvable range references.
///
/// Accepts `&FxHashMap<CellId, &ASTNode>` — the caller projects AST
/// references out of whatever cache shape it uses (e.g. `AstEntry`),
/// keeping this module free of scheduler types.
#[allow(dead_code)]
pub fn scan_data_requirements(
    cells: &[CellId],
    ast_lookup: &FxHashMap<CellId, &ASTNode>,
    source: &dyn DataSource,
) -> DataPlan {
    let mut plan = DataPlan::default();
    for &cell_id in cells {
        if let Some(ast) = ast_lookup.get(&cell_id) {
            // Determine the sheet context for this cell
            let sheet_ctx = source.sheet_for_cell(&cell_id);
            collect_static_ranges(ast, sheet_ctx, source, &mut plan);
        }
    }
    plan
}

/// Public entry point for pre-computing per-cell range keys.
/// Same as `collect_static_ranges` but with a public API.
pub fn collect_static_ranges_pub(
    node: &ASTNode,
    sheet_ctx: Option<SheetId>,
    source: &dyn DataSource,
    out: &mut DataPlan,
) {
    collect_static_ranges(node, sheet_ctx, source, out);
}

/// Recursively walk an AST node and collect all statically-resolvable range references.
fn collect_static_ranges(
    node: &ASTNode,
    sheet_ctx: Option<SheetId>,
    source: &dyn DataSource,
    out: &mut DataPlan,
) {
    let mut collector = StaticRangeCollector {
        sheet_ctx,
        source,
        out,
    };
    collector.visit(node);
}

struct StaticRangeCollector<'a> {
    sheet_ctx: Option<SheetId>,
    source: &'a dyn DataSource,
    out: &'a mut DataPlan,
}

impl AstVisitor for StaticRangeCollector<'_> {
    fn visit_range(&mut self, r: &compute_parser::RangeRef) {
        if let Some(key) = resolve_range_to_key(r, self.sheet_ctx, self.source) {
            self.out.insert(key);
        }
    }

    fn visit_sheet_ref(&mut self, sheet: &SheetId, inner: &ASTNode) {
        // Save/restore sheet_ctx around recursion
        let saved = self.sheet_ctx;
        self.sheet_ctx = Some(*sheet);
        self.visit(inner);
        self.sheet_ctx = saved;
    }

    fn visit_unresolved_sheet_ref(&mut self, name: &str, inner: &ASTNode) {
        // Try to resolve sheet name, override sheet_ctx for inner
        let saved = self.sheet_ctx;
        let resolved_sheet = self.source.sheet_by_name(name);
        self.sheet_ctx = resolved_sheet.or(self.sheet_ctx);
        self.visit(inner);
        self.sheet_ctx = saved;
    }
}

/// Try to resolve a parser RangeRef to a RangeKey by resolving endpoints to positions.
/// Returns None if either endpoint can't be resolved.
fn resolve_range_to_key(
    range_ref: &compute_parser::RangeRef,
    sheet_ctx: Option<SheetId>,
    source: &dyn DataSource,
) -> Option<RangeKey> {
    let (s_sheet, s_row, s_col) = resolve_cell_ref_to_pos(&range_ref.start, sheet_ctx, source)?;
    let (e_sheet, e_row, e_col) = resolve_cell_ref_to_pos(&range_ref.end, sheet_ctx, source)?;

    if s_sheet != e_sheet {
        return None; // Cross-sheet ranges are #REF!
    }

    let mut min_row = s_row.min(e_row);
    let mut max_row = s_row.max(e_row);
    let mut min_col = s_col.min(e_col);
    let mut max_col = s_col.max(e_col);

    // Expand sentinel values for ColumnRange / RowRange
    match range_ref.range_type {
        RangeType::ColumnRange => {
            min_row = 0;
            max_row = u32::MAX;
        }
        RangeType::RowRange => {
            min_col = 0;
            max_col = u32::MAX;
        }
        _ => {}
    }

    // Clamp to actual sheet dimensions (same as mirror_access.rs get_range_values)
    let sheet_rows = source.sheet_rows(&s_sheet);
    let sheet_cols = source.sheet_cols(&s_sheet);
    if let (Some(rows), Some(cols)) = (sheet_rows, sheet_cols) {
        if max_row >= rows {
            if rows > 0 {
                max_row = rows - 1;
            } else {
                return Some(RangeKey::new(s_sheet, 0, 0, 0, 0));
            }
        }
        if max_col >= cols {
            if cols > 0 {
                max_col = cols - 1;
            } else {
                return Some(RangeKey::new(s_sheet, 0, 0, 0, 0));
            }
        }
        // After clamping max, min may exceed max if the range was entirely
        // out of bounds. Return empty for such ranges.
        if min_row >= rows || min_col >= cols {
            return Some(RangeKey::new(s_sheet, 0, 0, 0, 0));
        }
    } else if max_row > 1000 || max_col > 1000 {
        // No sheet info — don't pre-materialize huge ranges
        return None;
    }

    Some(RangeKey::new(s_sheet, min_row, min_col, max_row, max_col))
}

/// Resolve a CellRef to (SheetId, row, col) using the data source.
/// Similar to MirrorAccess::resolve_ref_to_pos but takes sheet_ctx instead of self.
fn resolve_cell_ref_to_pos(
    cell_ref: &CellRef,
    sheet_ctx: Option<SheetId>,
    source: &dyn DataSource,
) -> Option<(SheetId, u32, u32)> {
    match cell_ref {
        CellRef::Resolved(id) => {
            let sheet_id = source.sheet_for_cell(id).or(sheet_ctx)?;
            let (row, col) = source.position_of(&sheet_id, id)?;
            Some((sheet_id, row, col))
        }
        CellRef::Positional { sheet, row, col } => {
            let resolved_sheet = if *sheet == SheetId::from_raw(0) {
                sheet_ctx?
            } else {
                *sheet
            };
            Some((resolved_sheet, *row, *col))
        }
    }
}

// ---------------------------------------------------------------------------
// RangeStore
// ---------------------------------------------------------------------------

/// Unified data scheduling layer for range materialization.
///
/// Provides a two-tier cache: pre-materialized ranges (populated once before
/// compute, zero sync cost) and on-demand ranges (populated lazily during
/// compute for dynamic references like INDIRECT/OFFSET).
pub struct RangeStore {
    /// Pre-materialized ranges (populated once, read-only during compute). Zero sync cost.
    pre_materialized: FxHashMap<RangeKey, Arc<CellArray>>,

    /// On-demand cache for dynamic ranges (INDIRECT, OFFSET, RangeOp).
    #[cfg(feature = "native")]
    on_demand: DashMap<RangeKey, Arc<CellArray>>,
    #[cfg(not(feature = "native"))]
    on_demand: RefCell<FxHashMap<RangeKey, Arc<CellArray>>>,

    /// Unified lookup index cache for O(1) VLOOKUP/MATCH.
    #[cfg(feature = "native")]
    lookup_indexes: LookupIndexCache,
}

impl RangeStore {
    /// Create a new empty RangeStore.
    pub fn new() -> Self {
        Self {
            pre_materialized: FxHashMap::default(),
            #[cfg(feature = "native")]
            on_demand: DashMap::new(),
            #[cfg(not(feature = "native"))]
            on_demand: RefCell::new(FxHashMap::default()),
            #[cfg(feature = "native")]
            lookup_indexes: LookupIndexCache::new(),
        }
    }

    /// Create a RangeStore with pre-materialized ranges from a DataPlan.
    /// Used for eager mode (topo, ready-queue).
    pub fn with_plan(plan: &DataPlan, source: &dyn DataSource) -> Self {
        let mut pre_materialized = FxHashMap::default();
        pre_materialized.reserve(plan.len());
        for key in plan {
            let data = materialize_range(key, source, None);
            pre_materialized.insert(*key, data);
        }
        Self {
            pre_materialized,
            #[cfg(feature = "native")]
            on_demand: DashMap::new(),
            #[cfg(not(feature = "native"))]
            on_demand: RefCell::new(FxHashMap::default()),
            #[cfg(feature = "native")]
            lookup_indexes: LookupIndexCache::new(),
        }
    }

    /// Look up a materialized range, or materialize it on-demand from the mirror.
    ///
    /// Check order:
    /// 1. Pre-materialized map (populated before compute — zero sync cost)
    /// 2. On-demand cache (DashMap on native, RefCell<FxHashMap> on WASM)
    /// 3. Cache miss: materialize from mirror and insert into on-demand cache
    pub fn get_or_materialize(&self, key: RangeKey, source: &dyn DataSource) -> Arc<CellArray> {
        // 1. Check pre-materialized (fast, no sync)
        if let Some(data) = self.pre_materialized.get(&key) {
            #[cfg(feature = "journal")]
            {
                let sheet_str = &key.sheet().to_uuid_string()[..8];
                crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                    cell: None,
                    tier: "range_store_pre",
                    key_summary: format!(
                        "{}:{}-{}:{}-{}",
                        sheet_str,
                        key.start_row(),
                        key.end_row(),
                        key.start_col(),
                        key.end_col()
                    ),
                    hit: true,
                });
            }
            return Arc::clone(data);
        }

        // 2 + 3. Check on-demand cache, materializing on miss
        #[cfg(feature = "native")]
        {
            if let Some(entry) = self.on_demand.get(&key) {
                #[cfg(feature = "journal")]
                {
                    let sheet_str = &key.sheet().to_uuid_string()[..8];
                    crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                        cell: None,
                        tier: "range_store_demand",
                        key_summary: format!(
                            "{}:{}-{}:{}-{}",
                            sheet_str,
                            key.start_row(),
                            key.end_row(),
                            key.start_col(),
                            key.end_col()
                        ),
                        hit: true,
                    });
                }
                return Arc::clone(entry.value());
            }
            #[cfg(feature = "journal")]
            {
                let sheet_str = &key.sheet().to_uuid_string()[..8];
                crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                    cell: None,
                    tier: "range_store",
                    key_summary: format!(
                        "{}:{}-{}:{}-{}",
                        sheet_str,
                        key.start_row(),
                        key.end_row(),
                        key.start_col(),
                        key.end_col()
                    ),
                    hit: false,
                });
            }
            let data = materialize_range(&key, source, None);
            self.on_demand.insert(key, Arc::clone(&data));
            data
        }

        #[cfg(not(feature = "native"))]
        {
            if let Some(data) = self.on_demand.borrow().get(&key) {
                #[cfg(feature = "journal")]
                {
                    let sheet_str = &key.sheet().to_uuid_string()[..8];
                    crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                        cell: None,
                        tier: "range_store_demand",
                        key_summary: format!(
                            "{}:{}-{}:{}-{}",
                            sheet_str,
                            key.start_row(),
                            key.end_row(),
                            key.start_col(),
                            key.end_col()
                        ),
                        hit: true,
                    });
                }
                return Arc::clone(data);
            }
            #[cfg(feature = "journal")]
            {
                let sheet_str = &key.sheet().to_uuid_string()[..8];
                crate::journal::record(crate::journal::JournalEvent::CacheAccess {
                    cell: None,
                    tier: "range_store",
                    key_summary: format!(
                        "{}:{}-{}:{}-{}",
                        sheet_str,
                        key.start_row(),
                        key.end_row(),
                        key.start_col(),
                        key.end_col()
                    ),
                    hit: false,
                });
            }
            let data = materialize_range(&key, source, None);
            self.on_demand.borrow_mut().insert(key, Arc::clone(&data));
            data
        }
    }

    /// Check if a key is already cached (either pre-materialized or on-demand).
    /// Returns the cached data without materializing.
    pub fn get_cached(&self, key: &RangeKey) -> Option<Arc<CellArray>> {
        if let Some(data) = self.pre_materialized.get(key) {
            return Some(Arc::clone(data));
        }
        #[cfg(feature = "native")]
        {
            if let Some(entry) = self.on_demand.get(key) {
                return Some(Arc::clone(entry.value()));
            }
        }
        #[cfg(not(feature = "native"))]
        {
            if let Some(data) = self.on_demand.borrow().get(key) {
                return Some(Arc::clone(data));
            }
        }
        None
    }

    /// Insert a range into the on-demand cache.
    /// Used by demand contexts that compute range data with dirty-cell awareness.
    pub fn insert(&self, key: RangeKey, data: Arc<CellArray>) {
        #[cfg(feature = "native")]
        {
            self.on_demand.insert(key, data);
        }
        #[cfg(not(feature = "native"))]
        {
            self.on_demand.borrow_mut().insert(key, data);
        }
    }

    /// Like with_plan(), but additive: skips keys already in the cache.
    /// Used for epoch-scoped RangeStore that persists across topological levels.
    ///
    /// Safety: `invalidate_dirty` / `invalidate_dirty_ranges` already remove
    /// overlapping entries from the cache, so a `contains_key` hit means the
    /// entry is still valid — no redundant dirty-overlap scan needed.
    pub fn pre_materialize_additive(&mut self, plan: &DataPlan, source: &dyn DataSource) {
        for key in plan {
            if self.pre_materialized.contains_key(key) {
                continue;
            }
            let data = materialize_range(key, source, None);
            self.pre_materialized.insert(*key, data);
        }
    }

    /// Invalidate cached ranges that overlap any of the changed cells.
    /// Call this after each topological level's apply phase so that
    /// subsequent levels see fresh data instead of stale cached ranges.
    ///
    /// Uses a single `retain()` pass over each cache map (O(changes + cached)),
    /// plus a spatial index on the dirty cells for O(1) per-key overlap checks.
    pub fn invalidate_dirty(&mut self, changes: &[(SheetId, u32, u32)]) {
        if changes.is_empty() {
            return;
        }

        // Build a spatial index: (sheet, col) → sorted Vec<row> for O(log N) overlap.
        let mut col_index: FxHashMap<(SheetId, u32), Vec<u32>> = FxHashMap::default();
        for &(sheet, row, col) in changes {
            col_index.entry((sheet, col)).or_default().push(row);
        }
        for rows in col_index.values_mut() {
            rows.sort_unstable();
            rows.dedup();
        }

        // Single retain pass over pre_materialized
        let overlaps = |key: &RangeKey| -> bool {
            for col in key.start_col()..=key.end_col() {
                if let Some(rows) = col_index.get(&(key.sheet(), col)) {
                    // Binary search for any row in [start_row, end_row]
                    let lo = rows.partition_point(|&r| r < key.start_row());
                    if lo < rows.len() && rows[lo] <= key.end_row() {
                        return true;
                    }
                }
            }
            false
        };

        self.pre_materialized.retain(|key, _| !overlaps(key));

        #[cfg(feature = "native")]
        {
            self.on_demand.retain(|key, _| !overlaps(key));
        }
        #[cfg(not(feature = "native"))]
        {
            self.on_demand.borrow_mut().retain(|key, _| !overlaps(key));
        }

        #[cfg(feature = "native")]
        {
            for &(sheet, _row, col) in changes {
                self.lookup_indexes.remove_column(sheet, col);
            }
        }
    }

    /// Invalidate cached ranges that overlap any of the given rectangular regions.
    ///
    /// Range-based variant of [`invalidate_dirty`] — avoids materializing every
    /// cell position for large projection spills. Each tuple is
    /// `(sheet, start_row, start_col, end_row, end_col)`.
    ///
    /// Semantically equivalent to calling `invalidate_dirty` with every
    /// `(sheet, r, c)` for `r in start_row..=end_row, c in start_col..=end_col`,
    /// but without constructing the full position list.
    pub fn invalidate_dirty_ranges(&mut self, ranges: &[(SheetId, u32, u32, u32, u32)]) {
        if ranges.is_empty() {
            return;
        }

        // Single retain pass: check each cached key against all dirty rectangles.
        let rect_overlaps = |key: &RangeKey| -> bool {
            ranges.iter().any(|&(sheet, sr, sc, er, ec)| {
                key.sheet() == sheet
                    && key.start_row() <= er
                    && key.end_row() >= sr
                    && key.start_col() <= ec
                    && key.end_col() >= sc
            })
        };

        self.pre_materialized.retain(|key, _| !rect_overlaps(key));

        #[cfg(feature = "native")]
        {
            self.on_demand.retain(|key, _| !rect_overlaps(key));
        }
        #[cfg(not(feature = "native"))]
        {
            self.on_demand
                .borrow_mut()
                .retain(|key, _| !rect_overlaps(key));
        }

        #[cfg(feature = "native")]
        {
            for &(_sheet, _sr, sc, _er, ec) in ranges {
                let sheet = _sheet;
                for col in sc..=ec {
                    self.lookup_indexes.remove_column(sheet, col);
                }
            }
        }
    }

    /// Access the unified lookup index cache (native only).
    #[cfg(feature = "native")]
    pub fn lookup_cache(&self) -> &LookupIndexCache {
        &self.lookup_indexes
    }
}

impl Default for RangeStore {
    fn default() -> Self {
        Self::new()
    }
}
