use std::sync::Arc;

use cell_types::{ColId, IdAllocator, RowId, SheetId};

/// Compact row and column identity indexes for a single sheet.
/// Authored cell identities belong to the cell store; positions derive from these axes.
#[derive(Debug, Clone)]
pub struct GridIndex {
    pub(super) sheet_id: SheetId,
    /// Shared monotonic ID allocator — `Arc` so `Clone` is cheap and all
    /// clones share the same counter (no duplicate IDs across copies).
    pub(super) id_alloc: Arc<IdAllocator>,

    // Row identity tracking. Legacy rowOrder hydrates as Explicit; compact
    // persisted axes hydrate as Runs and resolve reverse lookups without a
    // dense RowId -> row_index map.
    pub(super) row_axis: Arc<super::AxisIndex<RowId>>,

    // Column identity tracking. See row_axis.
    pub(super) col_axis: Arc<super::AxisIndex<ColId>>,
}
