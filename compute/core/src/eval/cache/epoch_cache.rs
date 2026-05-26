//! Ephemeral per-epoch cache.
//!
//! `EpochCache` is created fresh each recalc epoch and discarded afterwards.
//! It contains evaluation state that depends on the current dirty set and
//! cannot persist across epochs.
//!
//! ## Old-value snapshots
//!
//! Before recalc writes new results to the mirror, `snapshot_old_value` captures
//! the pre-recalc value for each dirty cell. These old values enable incremental
//! incremental cache maintenance: instead of a full rebuild, caches can apply
//! O(delta) updates by comparing old vs new values.
//!
//! ## Tier 2 caches (epoch-scoped)
//!
//! `EpochCache` owns the epoch-scoped cache data:
//!
//! - **subexpr_cache**: Deduplicates AST subtree evaluation. Actual access still
//!   goes through thread-local in `subexpr_cache.rs` for zero-refactor ergonomics;
//!   `EpochCache::new()` clears it, and `stats()` reports hit/miss counts.
//! - **sheet_names**: Sheet name normalization cache. Actual access still goes
//!   through thread-local in `mirror/mod.rs`; `EpochCache::new()` clears it.
//!
//! ## Future consolidation
//!
//! The remaining per-epoch state (results, cell_state, spill_zones, range_cache)
//! currently lives scattered across `RecalcSession` and `ParallelDemandExecutor`.
//! This struct will consolidate those fields into a single cache tier.
//!
//! ## Full migration TODO
//!
//! When the evaluator is refactored to pass `&EpochCache` through the evaluation
//! call stack (touches evaluator.rs, eval_primitives.rs, and all call sites),
//! the thread-local backing stores in `subexpr_cache.rs` and `mirror/mod.rs`
//! can be replaced with direct field access on this struct.

use cell_types::CellId;
use compute_parser::ASTNode;
use rustc_hash::FxHashMap;
use std::cell::RefCell;
use value_types::CellValue;

// ---------------------------------------------------------------------------
// Subexpression cache entry (same as in subexpr_cache.rs)
// ---------------------------------------------------------------------------

/// A cached subexpression evaluation result, keyed by AST content hash.
/// The full AST is retained for collision verification via `PartialEq`.
pub(crate) struct SubexprEntry {
    /// The AST subtree — kept for collision verification via PartialEq.
    pub(crate) ast: ASTNode,
    /// The evaluated array result.
    pub(crate) value: CellValue,
}

// ---------------------------------------------------------------------------
// EpochCache
// ---------------------------------------------------------------------------

/// Ephemeral cache created fresh each recalc epoch.
///
/// Contains evaluation state that depends on dirty cells and cannot persist.
///
/// ## Old-value snapshots
///
/// `old_values` stores pre-recalc cell values snapshotted before result application.
/// Used by incremental cache maintenance to compute deltas.
///
/// ## Tier 2 caches (epoch-scoped)
///
/// - **subexpr**: Deduplicates AST subtree evaluation within a recalc epoch.
/// - **sheet_names**: Sheet name normalization (NFC + lowercase) cache.
///
/// These fields represent the canonical ownership of epoch-scoped cache data.
/// The thread-local accessors in `subexpr_cache.rs` and `mirror/mod.rs` remain
/// the actual access path during evaluation; `EpochCache` clears them at epoch
/// boundaries and collects stats at epoch end.
pub struct EpochCache {
    /// Pre-recalc cell values, snapshotted before result application begins.
    /// Key: cell ID of a dirty cell. Value: the cell's value before this epoch's writes.
    ///
    /// Wrapped in `RefCell` so that `clear()` (which takes `&self`) can clear it.
    old_values: RefCell<FxHashMap<CellId, CellValue>>,

    /// Tier 2: subexpression dedup cache (AST subtree hash -> entry).
    ///
    /// Canonical data container. During evaluation, the thread-local in
    /// `subexpr_cache.rs` is the actual access path. This field is populated
    /// at epoch end via `capture_stats()` for diagnostics.
    ///
    /// TODO(full-migration): When the evaluator threads `&EpochCache` through
    /// the call stack, `subexpr_cache.rs` thread-local will be replaced by
    /// direct access to this field.
    subexpr: RefCell<FxHashMap<u64, SubexprEntry>>,

    /// Tier 2: sheet name normalization cache (raw name -> NFC+lowercase).
    ///
    /// Canonical data container. During evaluation, the thread-local in
    /// `mirror/mod.rs` is the actual access path. This field is populated
    /// at epoch end via `capture_stats()` for diagnostics.
    ///
    /// TODO(full-migration): When the evaluator threads `&EpochCache` through
    /// the call stack, the mirror thread-local will be replaced by direct
    /// access to this field.
    sheet_names: RefCell<FxHashMap<String, String>>,
}

impl EpochCache {
    /// Create a new empty epoch cache, clearing all thread-local epoch-scoped
    /// caches as part of epoch initialization.
    ///
    /// This ensures no stale data from a previous epoch leaks into the new one.
    pub fn new() -> Self {
        // Clear the thread-local caches that are the actual access paths
        // during evaluation. This replaces the scattered clear() calls
        // that previously lived at recalc entry points.
        crate::eval::cache::subexpr_cache::clear();
        crate::mirror::clear_caches();

        Self {
            old_values: RefCell::new(FxHashMap::default()),
            subexpr: RefCell::new(FxHashMap::default()),
            sheet_names: RefCell::new(FxHashMap::default()),
        }
    }

    /// Clear all epoch-scoped caches (both owned fields and thread-locals).
    ///
    /// Useful for mid-epoch resets (e.g. iterative convergence retries).
    pub fn clear(&self) {
        self.old_values.borrow_mut().clear();
        self.subexpr.borrow_mut().clear();
        self.sheet_names.borrow_mut().clear();

        // Also clear the thread-local backing stores
        crate::eval::cache::subexpr_cache::clear();
        crate::mirror::clear_caches();
    }

    /// Snapshot the old (pre-recalc) value for a cell before writing the new result.
    ///
    /// Must be called for ALL dirty cells BEFORE any writes begin — not interleaved
    /// with writes — so that incremental cache updates see a consistent "before" state.
    pub fn snapshot_old_value(&mut self, cell_id: CellId, value: CellValue) {
        self.old_values.borrow_mut().insert(cell_id, value);
    }

    /// Retrieve the old (pre-recalc) value for a cell, if it was snapshotted.
    pub fn get_old_value(&self, cell_id: &CellId) -> Option<CellValue> {
        self.old_values.borrow().get(cell_id).cloned()
    }

    /// Collect stats from the thread-local caches at epoch end.
    ///
    /// Call this before the epoch cache is dropped to capture diagnostic
    /// information about cache effectiveness.
    pub fn stats(&self) -> EpochCacheStats {
        let subexpr_entries = crate::eval::cache::subexpr_cache::entry_count();
        let sheet_name_entries = crate::mirror::sheet_name_cache_entry_count();

        EpochCacheStats {
            subexpr_entries,
            sheet_name_entries,
        }
    }
}

impl Default for EpochCache {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/// Diagnostic stats collected from an epoch's caches.
///
/// Populated by `EpochCache::stats()` at epoch end.
#[derive(Debug, Default, Clone)]
pub struct EpochCacheStats {
    /// Number of entries in the subexpression cache at epoch end.
    pub subexpr_entries: usize,
    /// Number of entries in the sheet name normalization cache at epoch end.
    pub sheet_name_entries: usize,
}
