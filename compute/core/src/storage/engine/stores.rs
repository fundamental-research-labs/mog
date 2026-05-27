//! Shared data layer for all engine services.
//!
//! `EngineStores` groups the storage, indexes, and compute scheduler that are
//! accessed by every service module within the engine. Splitting these into a
//! dedicated sub-struct is Phase 1a of the engine decomposition: it makes borrow
//! boundaries explicit so that service modules can take `&mut EngineStores`
//! without borrowing unrelated fields (observer, undo manager, viewport, etc.).

use std::sync::Arc;

use rustc_hash::FxHashMap;

use cell_types::{IdAllocator, SheetId};
use compute_layout_index::LayoutIndex;

use compute_cf::types::CellCFResult;

use crate::identity::GridIndex;
use crate::range_manager::RangeSpatialIndex;
use crate::scheduler::ComputeCore;
use crate::storage::YrsStorage;

use super::merge_index::MergeSpatialItem;

/// Per-sheet cache of conditional formatting evaluation results.
pub(crate) struct CFCacheEntry {
    pub results: FxHashMap<(u32, u32), CellCFResult>,
    #[allow(dead_code)]
    pub dirty: bool,
}

/// Shared data layer for all engine services.
///
/// Groups the CRDT storage, per-sheet indexes, compute scheduler, and caches
/// that are read or mutated by virtually every engine operation. Extracting
/// these into a single struct lets service modules borrow them as a unit
/// without conflicting with borrows of orthogonal engine state (observer,
/// undo manager, viewport registry, etc.).
pub(crate) struct EngineStores {
    /// Yrs CRDT storage (persistence layer).
    pub(super) storage: YrsStorage,

    /// Shared ID allocator for GridIndex operations (RowId/ColId).
    pub(super) grid_id_alloc: Arc<IdAllocator>,

    /// Client-partitioned ID allocator for all metadata IDs (comments, filters,
    /// merges, hyperlinks, named ranges, pivots, floating objects, bindings,
    /// scenarios). Each collaborative engine gets a non-overlapping ID range
    /// via `IdAllocator::with_client_partition(client_id)`, preventing CRDT
    /// key collisions in multi-process mode.
    pub(crate) id_alloc: Arc<IdAllocator>,

    /// Per-sheet identity-position tracking.
    pub(super) grid_indexes: FxHashMap<SheetId, GridIndex>,

    /// Per-sheet spatial layout index for cell-to-pixel mapping.
    ///
    /// Built from dimension data (custom row heights, column widths,
    /// hidden rows/cols) during construction. Updated incrementally
    /// on dimension mutations. Enables O(log k) position lookups.
    pub(super) layout_indexes: FxHashMap<SheetId, LayoutIndex>,

    /// Per-sheet spatial index for efficient merge region lookups.
    ///
    /// Populated from the yrs Doc during construction and updated
    /// during structural operations (merge/unmerge). Enables O(n)
    /// viewport queries instead of O(n*m) linear scans.
    pub(super) merge_indexes: FxHashMap<SheetId, RangeSpatialIndex<MergeSpatialItem>>,

    /// Formula parser, dep graph, recalc scheduler.
    pub(super) compute: ComputeCore,

    /// Per-sheet conditional formatting evaluation cache.
    /// Populated lazily during viewport rendering; invalidated on cell/CF mutations.
    pub(super) cf_cache: FxHashMap<SheetId, CFCacheEntry>,

    /// Font database for text measurement (autofit, PDF export).
    /// Loaded once at engine init with metric-compatible Latin fonts.
    pub(super) font_db: compute_text_measurement::FontDb,

    /// Text measurement cache (shared across autofit calls).
    pub(super) measurement_cache: compute_text_measurement::MeasurementCache,

    /// In-memory store for custom table styles (keyed by style name).
    pub(super) custom_table_styles:
        FxHashMap<String, compute_table::custom_styles::CustomTableStyleConfig>,

    /// In-memory store for custom cell styles (keyed by style ID).
    /// Backed by Yrs map `KEY_CUSTOM_CELL_STYLES` for persistence.
    pub(super) custom_cell_styles:
        FxHashMap<String, domain_types::domain::cell_style::CellStyleDef>,
}

impl EngineStores {
    /// Generate a unique hex ID string using the client-partitioned allocator.
    #[allow(dead_code)]
    pub(crate) fn next_id_hex(&self) -> String {
        compute_document::hex::id_to_hex(self.id_alloc.next_u128()).into()
    }

    /// Generate a unique 32-char hex ID using the full client-partitioned u128.
    pub(crate) fn next_id_simple(&self) -> String {
        let n = self.id_alloc.next_u128();
        format!("{:032x}", n)
    }

    /// Generate a unique standard UUID-format string.
    #[allow(dead_code)]
    pub(crate) fn next_id_uuid_string(&self) -> String {
        cell_types::CellId::from_raw(self.id_alloc.next_u128()).to_uuid_string()
    }
}
