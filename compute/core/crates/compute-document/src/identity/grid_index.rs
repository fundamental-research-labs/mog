use std::sync::Arc;

use cell_types::{AxisIdentityStore, CellId, ColId, IdAllocator, RowId, SheetId};
use rustc_hash::FxHashMap;

/// Tracks identity-position mappings for a single sheet.
///
/// Design: CellIds are created lazily. Empty cells don't have CellIds.
/// When a cell is first written to, a CellId is generated.
/// When a row is inserted, RowIds are generated for the new rows.
/// When a column is inserted, ColIds are generated for the new columns.
///
/// The GridIndex maintains:
/// - Row identities: row_index -> RowId, RowId -> row_index
/// - Column identities: col_index -> ColId, ColId -> col_index
/// - Cell identities: (row, col) -> CellId, CellId -> (row, col)
#[derive(Debug, Clone)]
pub struct GridIndex {
    pub(super) sheet_id: SheetId,
    /// Shared monotonic ID allocator — `Arc` so `Clone` is cheap and all
    /// clones share the same counter (no duplicate IDs across copies).
    pub(super) id_alloc: Arc<IdAllocator>,

    // Row identity tracking. Legacy rowOrder hydrates as Explicit; compact
    // persisted axes hydrate as Runs and resolve reverse lookups without a
    // dense RowId -> row_index map.
    pub(super) row_axis: AxisIdentityStore<RowId>,

    // Column identity tracking. See row_axis.
    pub(super) col_axis: AxisIdentityStore<ColId>,

    // Cell identity tracking (SPARSE -- only materialized cells)
    pub(super) cell_at_pos: FxHashMap<(u32, u32), CellId>, // (row, col) -> CellId
    pub(super) cell_to_pos: FxHashMap<CellId, (u32, u32)>, // CellId -> (row, col)
}
