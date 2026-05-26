//! EvaluationContext trait — abstract interface for cell data access.
//!
//! The trait hierarchy is split into three parts:
//!
//! - `EvalDataAccess` — async cell/range value reads (suspension points for DAG-parallel eval)
//! - `EvalMetadata` — synchronous positional/structural queries
//! - `EvaluationContext` — supertrait combining both (used by evaluator generics)
//!
//! A blanket implementation automatically provides `EvaluationContext` for any
//! type that implements both `EvalDataAccess` and `EvalMetadata`.

use crate::formula_text::FormulaTextLookup;
use crate::table::structured_refs::ResolvedStructuredRef;
use cell_types::{CellId, SheetId};
use compute_functions::helpers::sumifs_result_cache::SumifsCacheEpoch;
use formula_types::{CellRef, RangeType, ResolvedName};
use std::sync::Arc;
use value_types::{CellArray, DenseBoolMask, DenseColumn};
use value_types::{CellError, CellValue};

use snapshot_types::PivotTableDef;

// ---------------------------------------------------------------------------
// Data access trait (async)
// ---------------------------------------------------------------------------

/// Data access trait — reads cell/range values.
///
/// Methods are async to support suspension points in demand-driven evaluation:
/// when a cell's dependency hasn't been evaluated yet, the evaluator can
/// suspend and let other work proceed (DAG-parallel execution).
///
/// For synchronous contexts (MirrorContext, OverrideContext), the async
/// methods complete immediately — the compiler elides async state machines.
#[allow(async_fn_in_trait)]
pub trait EvalDataAccess {
    async fn get_cell_value_by_ref(&self, cell_ref: &CellRef) -> CellValue;
    async fn get_cell_value(&self, cell_id: &CellId) -> CellValue;
    async fn get_range_values(
        &self,
        start: &CellRef,
        end: &CellRef,
        range_type: &RangeType,
    ) -> Result<Arc<CellArray>, CellError>;

    /// Get the full dynamic array for a projection source cell.
    ///
    /// Used by `ANCHORARRAY` (the `#` spill range operator). Source cells store
    /// `CellValue::Array` directly, so this returns the raw stored value if the
    /// cell is a projection source. Normal read paths (`get_cell_value`) unwrap
    /// Array to the top-left scalar; this method bypasses that unwrapping.
    ///
    /// Returns `None` if the cell is not a projection source.
    async fn get_source_array(&self, _cell_id: &CellId) -> Option<CellValue> {
        None
    }
}

// ---------------------------------------------------------------------------
// IndexedLookupResult -- return type for cached column index searches
// ---------------------------------------------------------------------------

/// Result of an indexed column search.
///
/// Used by lookup functions (VLOOKUP, MATCH) to leverage the
/// `LookupIndexCache` for O(log n) searches on sorted/hashed columns.
/// Cross-platform (not feature-gated); implementations on non-native
/// targets return `NotAvailable` via the default trait methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexedLookupResult {
    /// Index not available (column not clean, no dense data, etc). Caller should fall back.
    NotAvailable,
    /// Search completed, no match found.
    NotFound,
    /// Match found at this absolute row (0-based sheet row).
    Found(u32),
}

// ---------------------------------------------------------------------------
// DataSource trait (low-level data access for cache infrastructure)
// ---------------------------------------------------------------------------

/// Low-level data access for cache infrastructure and range materialization.
///
/// Separates raw data queries (needed by caches, range stores) from
/// formula-level metadata (needed by evaluator). This is the trait that
/// breaks eval's dependency on CellMirror.
pub trait DataSource {
    /// Column version for staleness checking.
    ///
    /// Returns the monotonic version counter for `(sheet, col)`. Used by
    /// `RangeVersion` and `VersionedEntry` to check cache validity.
    fn col_version(&self, sheet: &SheetId, col: u32) -> u64;

    /// Number of rows in a sheet, or `None` if the sheet doesn't exist.
    fn sheet_rows(&self, sheet: &SheetId) -> Option<u32>;

    /// Number of columns in a sheet, or `None` if the sheet doesn't exist.
    fn sheet_cols(&self, sheet: &SheetId) -> Option<u32>;

    /// Whether the sheet has any column data at all.
    ///
    /// Used to decide between dense column-slice iteration and sparse
    /// cell-by-cell fallback during range materialization.
    fn col_data_is_empty(&self, sheet: &SheetId) -> bool;

    /// Get a column's values as a contiguous slice, or `None` if unavailable.
    ///
    /// The slice is indexed by row number. Used by the dense materialization
    /// tier for direct column-slice iteration.
    fn get_column_slice(&self, sheet: &SheetId, col: u32) -> Option<&[CellValue]>;

    /// Resolve a position to a CellId, or `None` if no cell exists there.
    fn cell_id_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<CellId>;

    /// Find which sheet a cell belongs to.
    fn sheet_for_cell(&self, cell_id: &CellId) -> Option<SheetId>;

    /// Resolve a sheet name to its SheetId.
    fn sheet_by_name(&self, name: &str) -> Option<SheetId>;

    /// Get a cell's value by position (for fallback materialization tier).
    fn get_cell_value_at(&self, sheet: &SheetId, row: u32, col: u32) -> Option<&CellValue>;

    /// Resolve a CellId's position within a sheet.
    ///
    /// Returns `(row, col)` if the cell exists in the given sheet.
    /// Used by range materialization to resolve `CellRef::Resolved` references.
    fn position_of(&self, sheet: &SheetId, cell_id: &CellId) -> Option<(u32, u32)>;

    fn get_column_slice_f64(&self, _sheet: &SheetId, _col: u32) -> Option<&[f64]> {
        None
    }
}

// ---------------------------------------------------------------------------
// Metadata trait (sync)
// ---------------------------------------------------------------------------

/// Positional / structural metadata — synchronous queries passed to functions.
pub trait EvalMetadata {
    fn current_cell(&self) -> CellId;
    fn resolve_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)>;
    fn resolve_cell_id(&self, sheet: &SheetId, row: u32, col: u32) -> Option<CellId>;
    fn resolve_defined_name(&self, name: &str) -> Option<ResolvedName>;

    /// Resolve a named range using a specific sheet's scope chain.
    /// Used when evaluating `'Sheet1'!MyName` where Sheet1 may differ from the current sheet.
    fn resolve_defined_name_for_sheet(&self, name: &str, sheet: SheetId) -> Option<ResolvedName> {
        // Default: ignore sheet context, fall back to standard resolution
        let _ = sheet;
        self.resolve_defined_name(name)
    }

    fn resolve_structured_ref(
        &self,
        ref_: &crate::table::types::StructuredRef,
    ) -> Result<ResolvedStructuredRef, CellError>;
    fn sheet_by_name(&self, name: &str) -> Option<SheetId>;

    /// Return the total number of sheets in the workbook.
    ///
    /// Used by the SHEETS() function. Default returns 1 for contexts
    /// that don't track workbook structure.
    fn sheet_count(&self) -> usize {
        1
    }

    /// Return all sheet IDs between `start` and `end` (inclusive) in
    /// workbook order. Used by 3-D reference evaluation (`Sheet1:Sheet3!A1`).
    ///
    /// Default: returns `[start]` for contexts that don't track sheet order,
    /// which degrades gracefully to single-sheet behaviour.
    fn sheets_in_range(&self, start: &SheetId, end: &SheetId) -> Vec<SheetId> {
        let _ = end;
        vec![*start]
    }

    /// Get the current timestamp as an Excel serial date number.
    fn current_timestamp(&self) -> f64 {
        super::super::clock::get_current_serial_timestamp()
    }

    /// Get a dense column for fast aggregation over large ranges.
    fn get_dense_column(&self, _sheet: &SheetId, _col: u32) -> Option<&DenseColumn> {
        None
    }

    /// Get the boolean mask for a dense column.
    ///
    /// The mask tracks which rows contain boolean-sourced values. Used by
    /// aggregate functions (SUM, AVERAGE, MIN, MAX) to correctly skip
    /// booleans from cell references while including literal booleans.
    fn get_dense_bool_mask(&self, _sheet: &SheetId, _col: u32) -> Option<&DenseBoolMask> {
        None
    }

    /// Get the raw cell values for a column as a borrowed slice.
    ///
    /// Returns the dense column store data for `(sheet, col)` as a contiguous
    /// `&[CellValue]` slice indexed by row number. Used by borrowed aggregate
    /// fast paths to iterate range data without materializing `CellValue::Array`.
    ///
    /// Returns `None` if the sheet/column is not available or not in the dense store.
    fn get_column_values(&self, _sheet: &SheetId, _col: u32) -> Option<&[CellValue]> {
        None
    }

    /// Check if a cell contains a formula.
    fn cell_has_formula(&self, _sheet: &SheetId, _row: u32, _col: u32) -> bool {
        false
    }

    /// Return display/readback formula text for a cell position.
    fn formula_text_at(&self, _sheet: &SheetId, _row: u32, _col: u32) -> FormulaTextLookup {
        FormulaTextLookup::Unavailable
    }

    /// Check if a cell contains a formula classified as dynamic-array capable.
    fn cell_has_dynamic_array_formula(&self, _sheet: &SheetId, _row: u32, _col: u32) -> bool {
        false
    }

    /// Check if a cell's formula is a SUBTOTAL or AGGREGATE call.
    fn cell_has_subtotal_formula(&self, _sheet: &SheetId, _row: u32, _col: u32) -> bool {
        false
    }

    /// Check if a row is hidden (e.g. by autofilter or manual hide).
    ///
    /// Used by SUBTOTAL (func codes 101-111) and AGGREGATE (options 1,3,5,7)
    /// to skip hidden rows when computing aggregates.
    fn is_row_hidden(&self, _sheet: &SheetId, _row: u32) -> bool {
        false
    }

    /// Get a table definition by name.
    fn get_table(&self, _name: &str) -> Option<&formula_types::TableDef> {
        None
    }

    /// Find a pivot table that contains the given cell position.
    ///
    /// Used by GETPIVOTDATA to locate which pivot table a cell reference points into.
    fn find_pivot_table_at(
        &self,
        _sheet: &SheetId,
        _row: u32,
        _col: u32,
    ) -> Option<&PivotTableDef> {
        None
    }

    /// Search a column using a cached lookup index. Returns the matching row.
    ///
    /// `match_mode`: 0 = exact, 1 = largest value <= target, -1 = smallest value >= target.
    /// Default implementation returns `NotAvailable` (triggers materialization fallback).
    fn indexed_column_search(
        &self,
        _sheet: &SheetId,
        _col: u32,
        _target: &CellValue,
        _match_mode: i32,
    ) -> IndexedLookupResult {
        IndexedLookupResult::NotAvailable
    }

    /// Wildcard search on a column using a cached lookup index.
    ///
    /// Default implementation returns `NotAvailable` (triggers materialization fallback).
    fn indexed_column_wildcard_search(
        &self,
        _sheet: &SheetId,
        _col: u32,
        _pattern: &str,
    ) -> IndexedLookupResult {
        IndexedLookupResult::NotAvailable
    }

    /// Get the column version for change detection.
    ///
    /// Returns the monotonic version counter for `(sheet, col)`. Used to check
    /// whether cached data derived from a column is still current.
    ///
    /// Default returns 0, meaning "no version tracking available".
    fn col_version(&self, _sheet: &SheetId, _col: u32) -> u64 {
        0
    }

    /// Current scheduler-owned SUMIFS cache epoch, when evaluation is running
    /// inside a recalc boundary that permits thread-local SUMIFS result caching.
    fn sumifs_cache_epoch(&self) -> Option<SumifsCacheEpoch> {
        None
    }

    /// Get or build a sorted (ascending) numeric array for a single-column range,
    /// with version-based staleness checks.
    ///
    /// Returns `None` by default, signalling the caller to fall back to the
    /// thread-local sorted cache.
    ///
    /// `sheet`: sheet containing the range.
    /// `col`: column index of the single-column range.
    /// `row_start`/`row_end`: inclusive row bounds.
    /// `values`: cell values to extract numerics from and sort (used on cache miss).
    fn get_or_build_sorted_for_range(
        &self,
        _sheet: &SheetId,
        _col: u32,
        _row_start: u32,
        _row_end: u32,
        _values: &[CellValue],
    ) -> Option<Arc<Vec<f64>>> {
        None
    }

    /// Look up (or build) a `CountFrequencyMap` for the given single-column range
    /// and return the count for `criteria`.
    ///
    /// Returns `None` by default, signalling the caller to fall back to the
    /// thread-local frequency cache.
    ///
    /// `sheet`: sheet containing the range.
    /// `col`: column index of the single-column range.
    /// `row_start`/`row_end`: inclusive row bounds.
    /// `values`: cell value refs to build the frequency map from (used on cache miss).
    /// `criteria`: the criteria value to look up in the frequency map.
    fn count_frequency_lookup(
        &self,
        _sheet: &SheetId,
        _col: u32,
        _row_start: u32,
        _row_end: u32,
        _values: &[&CellValue],
        _criteria: &CellValue,
    ) -> Option<u64> {
        None
    }

    /// Look up (or build) a `SumFrequencyMap` for the given criteria+sum range pair
    /// and return the sum for `criteria`.
    ///
    /// Returns `None` if no persistent cache is available. Returns
    /// `Some(Ok(sum))` on success or `Some(Err(CellError))` if the entry is
    /// poisoned (an error cell appeared in the sum range for that criteria key).
    ///
    /// `crit_sheet`/`crit_col`/`crit_row_start`/`crit_row_end`: criteria range.
    /// `sum_sheet`/`sum_col`/`sum_row_start`/`sum_row_end`: sum range.
    /// `crit_values`/`sum_values`: cell value refs (used on cache miss).
    /// `criteria`: the criteria value to look up.
    #[allow(clippy::too_many_arguments)]
    fn sum_frequency_lookup(
        &self,
        _crit_sheet: &SheetId,
        _crit_col: u32,
        _crit_row_start: u32,
        _crit_row_end: u32,
        _sum_sheet: &SheetId,
        _sum_col: u32,
        _sum_row_start: u32,
        _sum_row_end: u32,
        _crit_values: &[&CellValue],
        _sum_values: &[&CellValue],
        _criteria: &CellValue,
    ) -> Option<Result<f64, CellError>> {
        None
    }

    /// Like `sum_frequency_lookup` but returns `(sum, count)` for AVERAGEIF.
    #[allow(clippy::too_many_arguments)]
    fn sum_and_count_frequency_lookup(
        &self,
        _crit_sheet: &SheetId,
        _crit_col: u32,
        _crit_row_start: u32,
        _crit_row_end: u32,
        _sum_sheet: &SheetId,
        _sum_col: u32,
        _sum_row_start: u32,
        _sum_row_end: u32,
        _crit_values: &[&CellValue],
        _sum_values: &[&CellValue],
        _criteria: &CellValue,
    ) -> Option<Result<(f64, u64), CellError>> {
        None
    }

    /// Look up (or build) a criteria bitmask for a single-column range.
    ///
    /// Returns a `ColumnBitset` where bit `i` set = row `i` matches the criteria.
    /// Used by the multi-criteria borrowed path (SUMIFS/COUNTIFS) to cache and
    /// reuse per-criterion match results across cells.
    ///
    /// Returns `None` by default (no persistent cache available).
    fn get_criteria_bitmask(
        &self,
        _sheet: &SheetId,
        _col: u32,
        _row_start: u32,
        _row_end: u32,
        _criteria: &CellValue,
        _col_values: &[CellValue],
    ) -> Option<compute_functions::helpers::column_bitset::ColumnBitset> {
        None
    }

    /// Build a criteria bitmask on cache miss for exact-match criteria.
    ///
    /// Unlike `get_criteria_bitmask` (hit-only), this method builds and caches
    /// the bitmask on miss. Safe to call only for exact-match criteria (no
    /// operators, no wildcards) where the key space is bounded and reuse is high.
    /// For operator-based criteria (>=, <=, etc.), use `get_criteria_bitmask`.
    fn get_or_build_criteria_bitmask(
        &self,
        _sheet: &SheetId,
        _col: u32,
        _row_start: u32,
        _row_end: u32,
        _criteria: &CellValue,
        _col_values: &[CellValue],
    ) -> Option<compute_functions::helpers::column_bitset::ColumnBitset> {
        None
    }
}

// ---------------------------------------------------------------------------
// EvaluationContext — supertrait combining data access + metadata
// ---------------------------------------------------------------------------

/// Combined evaluation context.
///
/// This is a marker trait — all methods come from `EvalDataAccess` and
/// `EvalMetadata`. Any type implementing both automatically satisfies this
/// trait via the blanket impl below.
///
/// Note: since `EvalDataAccess` has async methods (RPITIT), this trait
/// cannot be used as `dyn EvaluationContext`. Use generic bounds instead:
/// `fn foo<C: EvalDataAccess + EvalMetadata>(ctx: &C)`.
pub trait EvaluationContext: EvalDataAccess + EvalMetadata {}

/// Blanket implementation: any type implementing both sub-traits
/// automatically implements EvaluationContext.
impl<T: EvalDataAccess + EvalMetadata> EvaluationContext for T {}

// ---------------------------------------------------------------------------
// sync_block_on — trivial polling executor for sync→async bridge
// ---------------------------------------------------------------------------

/// Synchronously polls a future to completion.
///
/// Used to bridge sync callers with the async `Evaluator`. Since all
/// current `EvalDataAccess` implementations complete immediately (no real
/// suspension), the first `poll` always returns `Ready`. Nested calls are
/// safe because this is a trivial poll loop with no reactor.
///
/// # Panics
///
/// Panics if the future returns `Pending`, which would indicate a truly
/// async data access being called through the sync bridge.
pub fn sync_block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    use std::task::{Context, Poll, Waker};

    let mut cx = Context::from_waker(Waker::noop());
    let mut future = std::pin::pin!(future);

    match future.as_mut().poll(&mut cx) {
        Poll::Ready(val) => val,
        // SAFETY: sync_block_on is only called with EvalDataAccess implementations
        // that resolve synchronously (LocalSheetAccess, CachedSheetAccess). The async
        // bridge (AsyncEvalContext) uses a real executor instead. If this invariant is
        // violated, the panic is correct — silent data corruption would be worse.
        Poll::Pending => panic!(
            "sync_block_on: future returned Pending — \
             cannot use truly-async EvalDataAccess through the sync bridge"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::sync_block_on;

    #[test]
    fn sync_block_on_ready_future_returns_value() {
        assert_eq!(sync_block_on(std::future::ready(42)), 42);
    }

    #[test]
    fn sync_block_on_pending_future_panics() {
        let result = std::panic::catch_unwind(|| {
            sync_block_on(std::future::pending::<()>());
        });

        assert!(result.is_err());
    }
}
