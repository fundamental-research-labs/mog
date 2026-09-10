use std::sync::Arc;

use cell_types::{AxisIdentityId, AxisIdentityStore, ColId, IdAllocator, RowId, SheetId};

use super::GridIndex;

impl GridIndex {
    /// Create a new GridIndex for a sheet with the given dimensions.
    /// Allocates one compact identity run per axis.
    pub fn new(sheet_id: SheetId, rows: u32, cols: u32, id_alloc: Arc<IdAllocator>) -> Self {
        let row_axis = native_axis(rows, &id_alloc);
        let col_axis = native_axis(cols, &id_alloc);
        Self::from_axis_stores(sheet_id, row_axis, col_axis, id_alloc)
    }

    /// Create a GridIndex from persisted compact/explicit axis identity stores.
    ///
    /// Compact axes retain generated runs and build no dense identity maps.
    pub fn from_axis_stores(
        sheet_id: SheetId,
        row_axis: AxisIdentityStore<RowId>,
        col_axis: AxisIdentityStore<ColId>,
        id_alloc: Arc<IdAllocator>,
    ) -> Self {
        ensure_allocator_past_axis_store(&id_alloc, &row_axis);
        ensure_allocator_past_axis_store(&id_alloc, &col_axis);

        Self {
            sheet_id,
            id_alloc,
            row_axis: Arc::new(super::AxisIndex::new(sheet_id, row_axis)),
            col_axis: Arc::new(super::AxisIndex::new(sheet_id, col_axis)),
        }
    }

    /// Build a grid sharing existing native axis indexes.
    pub fn from_shared_axes(
        sheet_id: SheetId,
        row_axis: Arc<super::AxisIndex<RowId>>,
        col_axis: Arc<super::AxisIndex<ColId>>,
        id_alloc: Arc<IdAllocator>,
    ) -> Self {
        ensure_allocator_past_axis_store(&id_alloc, row_axis.store());
        ensure_allocator_past_axis_store(&id_alloc, col_axis.store());
        Self {
            sheet_id,
            id_alloc,
            row_axis,
            col_axis,
        }
    }

    /// Get the SheetId this GridIndex belongs to.
    #[inline]
    pub fn sheet_id(&self) -> SheetId {
        self.sheet_id
    }

    /// Number of rows.
    #[inline]
    pub fn row_count(&self) -> u32 {
        self.row_axis.len()
    }

    /// Number of columns.
    #[inline]
    pub fn col_count(&self) -> u32 {
        self.col_axis.len()
    }
}

fn ensure_allocator_past_axis_store<Id>(id_alloc: &IdAllocator, store: &AxisIdentityStore<Id>)
where
    Id: AxisIdentityId,
{
    if let Some(run_id) = store.max_run_id() {
        id_alloc.ensure_axis_run_past(run_id);
    }
    match store {
        AxisIdentityStore::Explicit(ids) => {
            for id in ids {
                id_alloc.ensure_past(id.as_raw());
            }
        }
        AxisIdentityStore::Runs(_) => {}
    }
}

fn native_axis<Id: AxisIdentityId>(len: u32, allocator: &IdAllocator) -> AxisIdentityStore<Id> {
    AxisIdentityStore::from_runs([allocator.next_axis_run(len)])
}
