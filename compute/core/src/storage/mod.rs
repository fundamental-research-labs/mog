//! Yrs-backed CRDT storage layer.
//!
//! Implements the **Hybrid Storage** pattern: a `yrs::Doc` provides CRDT
//! semantics for collaborative sync, while a [`CellMirror`] provides fast
//! read access (~3-5ns identity-keyed lookups).  Writes go through the
//! yrs document (via `TransactionMut`) and are mirrored into the `CellMirror`
//! so that the compute engine never needs to touch the CRDT on the hot path.
//!
//! # Yrs Document Schema
//!
//! ```text
//! Y.Doc
//! +-- workbook: Y.Map
//!     +-- sheetOrder: Y.Array<SheetId>
//!     +-- stylePalette: Y.Map<index, JSON CellFormat>
//!     +-- workbookSettings: Y.Map
//!     +-- namedRanges: Y.Map
//!     +-- tables: Y.Map
//!     +-- slicers: Y.Map
//!     +-- powerQuery: Y.Map
//!     +-- scenarios: Y.Map
//! +-- security: Y.Map
//!     +-- policies: Y.Map
//!     +-- version: Y.Map
//!     +-- templates: Y.Map
//! +-- sheets: Y.Map<SheetId, Y.Map>
//!     +-- {sheetId}: Y.Map
//!         +-- cells: Y.Map<CellId, Y.Map { v, f, ft, fr, fda, fv }>
//!         +-- properties: Y.Map<CellId, Y.Map>
//!         +-- gridIndex: Y.Map { posToId, idToPos }
//!             // cellGrid / cellPos retired in GridIndex migration;
//!             // gridIndex/{posToId,idToPos} is the authoritative
//!             // yrs-side identity store.
//!         +-- rowHeights: Y.Map<RowId, number>
//!         +-- colWidths: Y.Map<ColId, number>
//!         +-- meta: Y.Map { name, rows, cols }
//!         +-- schemas: Y.Map
//!         +-- charts: Y.Map
//!         +-- merges: Y.Map
//!         +-- hiddenRows: Y.Map
//!         +-- hiddenCols: Y.Map
//!         +-- rows: Y.Map (RowId registry)
//!         +-- cols: Y.Map (ColId registry)
//!         +-- rowIndex: Y.Map (position→RowId)
//!         +-- colIndex: Y.Map (position→ColId)
//!         +-- rowFormats: Y.Map
//!         +-- colFormats: Y.Map
//!         +-- comments: Y.Map
//!         +-- filters: Y.Map
//!         +-- sparklines: Y.Map
//!         +-- conditionalFormat: Y.Map
//!         +-- bindings: Y.Map
//!         +-- grouping: Y.Map
//!         +-- sorting: Y.Map
//!         +-- floatingObjects: Y.Map
//!         +-- floatingObjectGroups: Y.Map
//!         +-- rangeFormats: Y.Map<RangeId, Y.Map { CellFormat fields + _sr, _sc, _er, _ec }>
//! ```

// ---------------------------------------------------------------------------
// Public API (used by compute-core-wasm and external consumers)
// ---------------------------------------------------------------------------
pub mod engine;
pub mod properties;
pub mod security_cache;
pub mod security_state;

// ---------------------------------------------------------------------------
// Sub-directories (internal organization)
// ---------------------------------------------------------------------------
pub mod cells;
pub(crate) mod infra;
pub mod sheet;
pub(crate) mod sheet_dimensions;
pub mod table_format;
pub mod workbook;

use yrs::{Any, ArrayPrelim, Doc, Map, MapPrelim, MapRef, Out, Transact};

use crate::snapshot::WorkbookSnapshot;
use value_types::ComputeError;

// Schema constants (moved to compute-document crate)
use compute_document::schema::*;

// Hex helpers (private — tests access via `use super::*`, sub-modules import directly)
use compute_document::hex::id_to_hex;

// ---------------------------------------------------------------------------
// Storage-layer ID generation (replaces uuid::Uuid::new_v4 calls)
// ---------------------------------------------------------------------------

/// Module-level allocator for storage operations (user-interactive frequency).
/// Using a global avoids threading `&IdAllocator` through 20+ function signatures
/// for operations that fire at most once per user action.
pub(crate) static STORAGE_ID_ALLOC: std::sync::LazyLock<cell_types::IdAllocator> =
    std::sync::LazyLock::new(cell_types::IdAllocator::new);

/// Generate a unique hex ID string for storage (replaces `id_to_hex(uuid::Uuid::new_v4().as_u128())`).
///
/// **Deprecated**: Use `EngineStores::next_id_hex()` for production code.
/// This global allocator is retained for test code and the import pipeline.
#[allow(dead_code)] // Test utility: called from hyperlinks test helpers
pub(crate) fn next_id_hex() -> String {
    id_to_hex(STORAGE_ID_ALLOC.next_u128()).to_string()
}

/// Generate a unique standard UUID-format string (replaces `uuid::Uuid::new_v4().to_string()`).
///
/// **Deprecated**: Use `EngineStores::next_id_uuid_string()` for production code.
/// This global allocator is retained for test code and the import pipeline.
#[allow(dead_code)] // Deprecated: retained for future import pipeline use
pub(crate) fn next_id_uuid_string() -> String {
    cell_types::CellId::from_raw(STORAGE_ID_ALLOC.next_u128()).to_uuid_string()
}
#[cfg(test)]
use compute_document::cell_serde::{identity_refs_from_json, identity_refs_to_json};

// ---------------------------------------------------------------------------
// YrsStorage
// ---------------------------------------------------------------------------

/// Yrs CRDT storage layer.
///
/// Owns the `yrs::Doc` and provides methods to read/write the CRDT
/// document. The `CellMirror` (fast read cache) is owned externally
/// by `YrsComputeEngine` as a sibling field, enabling simultaneous
/// borrows of storage and mirror without borrow conflicts.
pub struct YrsStorage {
    /// The yrs CRDT document.
    doc: Doc,

    /// Top-level "workbook" map ref (cached for convenience).
    workbook: MapRef,

    /// Top-level "sheets" map ref (cached for convenience).
    sheets: MapRef,
}

impl YrsStorage {
    // -------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------

    /// Create a new empty `YrsStorage` with the document schema initialised.
    ///
    /// **Provider Protocol fix** (lifecycle/refresh-persistence): only
    /// the **root** maps (`workbook`, `sheets`, `security`) are created here.
    /// The workbook-level domain sub-maps (`sheetOrder`, `workbookSettings`,
    /// `namedRanges`, `tables`, `slicers`, `powerQuery`, `scenarios`,
    /// `documentProperties`, `fileVersion`, `fileSharing`) are **lazy-created
    /// on first write** via per-domain `ensure_*` helpers (see
    /// `ensure_workbook_child_map`).
    ///
    /// **Why?** When a fresh session re-creates a Doc and immediately replays
    /// a foreign-client update via `apply_sync_update` (the IndexedDB Provider
    /// post-reload path), **eager workbook-child inserts cause a Map LWW
    /// clash**: both sessions independently inserted (e.g.) `sheetOrder` under
    /// the workbook root map, each under their own client_id. yrs Map LWW
    /// resolution picks one as the visible value and silently shadows the
    /// other. Writes to the loser are still in the doc, but `workbook.get
    /// (KEY_SHEET_ORDER)` returns the winner — and the winner is the local
    /// session's empty array.
    ///
    /// Result: the original session's cells were physically present in yrs but
    /// invisible through the map-get path, and the post-reload viewport showed
    /// blank (issue #112). Root maps don't have this issue (they merge by
    /// name), but workbook *sub-maps* do.
    ///
    /// The fix: don't eagerly create sub-maps. Each writer uses
    /// `ensure_workbook_child_map` (or its array equivalent) which checks for
    /// existence before inserting. After `apply_sync_update` runs, the
    /// sub-maps already exist (from the replayed bytes), so subsequent
    /// `ensure_*` calls find them and skip the insert. For genuinely fresh
    /// (no replay) docs, the first write creates them once, deterministically
    /// owned by that session's client_id.
    ///
    /// See: `compute-collab/tests/provider_replay.rs` test
    /// `provider_replay_after_independent_bootstrap`.
    pub fn new() -> Self {
        let doc = Doc::new();

        // Pre-create the **root** maps so they exist for all future txns.
        // Root maps in yrs are interned by name and merge cleanly across
        // sessions (`apply_update` from a foreign client integrates cleanly).
        let workbook = doc.get_or_insert_map(KEY_WORKBOOK);
        let sheets = doc.get_or_insert_map(KEY_SHEETS);
        let _security = doc.get_or_insert_map(KEY_SECURITY);

        // INTENTIONALLY EMPTY — see doc-comment above. Workbook-level domain
        // sub-maps are lazy-created by their writers via `ensure_workbook_child_map`.
        // The root-level schemaVersion scalar is also deferred: a blank
        // Provider-replay target must not commit any local state before the
        // remote update stream applies. Real document writers stamp it in
        // their first transaction.

        Self {
            doc,
            workbook,
            sheets,
        }
    }

    /// Build a `YrsStorage` from a [`WorkbookSnapshot`], populating only the
    /// yrs document. The `CellMirror` is created externally by the caller.
    pub fn from_snapshot(snapshot: WorkbookSnapshot) -> Result<Self, ComputeError> {
        let mut storage = Self::new();
        storage.populate_yrs_only(snapshot)?;
        Ok(storage)
    }

    /// Build a `YrsStorage` from raw Yrs state bytes (the output of
    /// `compute_collab::encode_full_state()`).
    ///
    /// Creates a fresh `Doc`, applies the encoded state, and caches the
    /// top-level `MapRef`s. The resulting storage is ready for reading —
    /// all maps and arrays populated by the source engine are present.
    pub fn from_yrs_state(state: &[u8]) -> Result<Self, compute_collab::SyncError> {
        use yrs::updates::decoder::Decode;

        // Apply the state as a FULL document load, not as an incremental
        // update to a fresh doc. The Yrs Update contains root-level type
        // definitions with specific internal IDs. If we call
        // `get_or_insert_map` before or after `apply_update`, we get map
        // refs with DIFFERENT internal IDs than the ones in the update,
        // resulting in empty maps.
        //
        // Solution: decode the update and apply it, then use
        // `doc.get_or_insert_map()` which should find the existing maps.
        // But since `get_or_insert_map` creates new empty maps if none
        // exist yet (and in a fresh doc none do), we need to apply the
        // state first and then retrieve the already-existing maps.
        //
        // The trick: use `transact_mut().apply_update()` first, THEN
        // use `get_or_insert_map`. After the update is applied, the
        // root types exist in the doc, and `get_or_insert_map` finds
        // them by name.

        let doc = Doc::new();
        {
            let update = yrs::Update::decode_v1(state)
                .map_err(|e| compute_collab::SyncError::UpdateDecode(e.to_string()))?;
            let mut txn = doc.transact_mut();
            txn.apply_update(update)
                .map_err(|e| compute_collab::SyncError::ApplyUpdate(e.to_string()))?;
        }
        // After the transaction commits, root-level types from the
        // update are now part of this doc.
        let workbook = doc.get_or_insert_map(KEY_WORKBOOK);
        let sheets = doc.get_or_insert_map(KEY_SHEETS);

        Ok(Self {
            doc,
            workbook,
            sheets,
        })
    }

    // -------------------------------------------------------------------
    // Access to internals
    // -------------------------------------------------------------------

    /// Get a reference to the underlying yrs `Doc`.
    pub fn doc(&self) -> &Doc {
        &self.doc
    }

    /// Get a reference to the top-level "workbook" `MapRef`.
    pub fn workbook_map(&self) -> &MapRef {
        &self.workbook
    }

    /// Get a reference to the top-level "sheets" `MapRef`.
    pub fn sheets(&self) -> &MapRef {
        &self.sheets
    }

    /// Get a cloned reference to the sheets `MapRef`.
    ///
    /// This provides access to the top-level "sheets" map for
    /// per-sheet domain modules that need an owned `MapRef`.
    pub fn sheets_ref(&self) -> MapRef {
        self.sheets.clone()
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------

    /// Get the sheetOrder array from the workbook map.
    pub(crate) fn get_sheet_order_array<T: yrs::ReadTxn>(&self, txn: &T) -> Option<yrs::ArrayRef> {
        match self.workbook.get(txn, KEY_SHEET_ORDER) {
            Some(Out::YArray(arr)) => Some(arr),
            _ => None,
        }
    }

    /// Lazy-create the workbook `sheetOrder` array if missing, returning the
    /// resolved `ArrayRef`. Must run inside a write transaction. See
    /// [`YrsStorage::new`] for why eager creation was removed.
    pub(crate) fn ensure_sheet_order_array(
        &self,
        txn: &mut yrs::TransactionMut<'_>,
    ) -> yrs::ArrayRef {
        match self.workbook.get(txn, KEY_SHEET_ORDER) {
            Some(Out::YArray(arr)) => arr,
            _ => self
                .workbook
                .insert(txn, KEY_SHEET_ORDER, ArrayPrelim::from([] as [Any; 0])),
        }
    }
}

// ---------------------------------------------------------------------------
// Free-function helpers — Lazy workbook-child bootstrap
// ---------------------------------------------------------------------------

/// Lazy-create a workbook-level child map (e.g. `workbookSettings`,
/// `namedRanges`, `tables`, …) if missing.
///
/// The Provider Protocol fix removed eager `workbook.insert(KEY, ...)`
/// calls from `YrsStorage::new()` because two independent sessions
/// independently inserting the same key under the workbook root map causes a
/// yrs Map LWW clash that silently shadows one session's writes. Replacing
/// the eager bootstrap with this lazy `ensure_*` helper means: (a) the first
/// writer creates the sub-map deterministically owned by *that* session's
/// client_id, and (b) post-replay, the sub-map is already present from the
/// applied bytes and this helper short-circuits to the existing ref.
///
/// Generalises across every workbook-child sub-map; per-domain wrappers
/// (`ensure_named_ranges_map`, `ensure_tables_map`, …) call this and forward
/// the right `KEY_*` constant.
///
/// See `YrsStorage::new` doc-comment for the architectural reasoning.
pub(crate) fn ensure_workbook_child_map(
    workbook: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    key: &'static str,
) -> MapRef {
    match workbook.get(txn, key) {
        Some(Out::YMap(m)) => m,
        _ => {
            let empty = MapPrelim::from([] as [(&str, Any); 0]);
            workbook.insert(txn, key, empty)
        }
    }
}

impl Default for YrsStorage {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for YrsStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("YrsStorage")
            .field("sheet_order", &self.sheet_order())
            .finish()
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests;
