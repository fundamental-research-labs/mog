use std::sync::Arc;

use cell_types::{AxisIdentityId, AxisIdentityStore, ColId, IdAllocator, RowId, SheetId};
use rustc_hash::FxHashMap;

use super::GridIndex;

impl GridIndex {
    /// Create a new GridIndex for a sheet with the given dimensions.
    /// Generates RowIds and ColIds for all initial rows/columns.
    pub fn new(sheet_id: SheetId, rows: u32, cols: u32, id_alloc: Arc<IdAllocator>) -> Self {
        let mut row_ids = Vec::with_capacity(rows as usize);
        for _ in 0..rows {
            let rid = id_alloc.next_row_id();
            row_ids.push(rid);
        }

        let mut col_ids = Vec::with_capacity(cols as usize);
        for _ in 0..cols {
            let cid = id_alloc.next_col_id();
            col_ids.push(cid);
        }

        Self {
            sheet_id,
            id_alloc,
            row_axis: AxisIdentityStore::Explicit(row_ids),
            col_axis: AxisIdentityStore::Explicit(col_ids),
            cell_at_pos: FxHashMap::default(),
            cell_to_pos: FxHashMap::default(),
        }
    }

    /// Create a GridIndex from Yrs YArray data (for rebuild from CRDT state).
    ///
    /// Takes the ordered RowId and ColId hex strings from the rowOrder/colOrder
    /// YArrays. This avoids allocating fresh random IDs and instead uses the
    /// stable identities already stored in the CRDT document.
    pub fn from_yrs_arrays(
        sheet_id: SheetId,
        row_id_hexes: &[String],
        col_id_hexes: &[String],
        id_alloc: Arc<IdAllocator>,
    ) -> Self {
        let mut row_ids = Vec::with_capacity(row_id_hexes.len());
        for hex in row_id_hexes {
            if let Some(raw) = crate::hex::hex_to_id(hex) {
                id_alloc.ensure_past(raw);
                let rid = RowId::from_raw(raw);
                row_ids.push(rid);
            }
        }

        let mut col_ids = Vec::with_capacity(col_id_hexes.len());
        for hex in col_id_hexes {
            if let Some(raw) = crate::hex::hex_to_id(hex) {
                id_alloc.ensure_past(raw);
                let cid = ColId::from_raw(raw);
                col_ids.push(cid);
            }
        }

        Self {
            sheet_id,
            id_alloc,
            row_axis: AxisIdentityStore::Explicit(row_ids),
            col_axis: AxisIdentityStore::Explicit(col_ids),
            cell_at_pos: FxHashMap::default(),
            cell_to_pos: FxHashMap::default(),
        }
    }

    /// Create a GridIndex from persisted compact/explicit axis identity stores.
    ///
    /// This path is used when the document carries compact row/column axis
    /// metadata under `gridIndex`. Unlike [`Self::from_yrs_arrays`], reverse
    /// lookups for compact axes do not build dense maps.
    pub fn from_axis_stores(
        sheet_id: SheetId,
        row_axis: AxisIdentityStore<RowId>,
        col_axis: AxisIdentityStore<ColId>,
        id_alloc: Arc<IdAllocator>,
    ) -> Self {
        ensure_allocator_past_axis_store(&id_alloc, sheet_id, &row_axis);
        ensure_allocator_past_axis_store(&id_alloc, sheet_id, &col_axis);

        Self {
            sheet_id,
            id_alloc,
            row_axis,
            col_axis,
            cell_at_pos: FxHashMap::default(),
            cell_to_pos: FxHashMap::default(),
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

    /// Number of materialized cells (cells with CellIds).
    #[inline]
    pub fn cell_count(&self) -> u32 {
        self.cell_at_pos.len() as u32
    }
}

fn ensure_allocator_past_axis_store<Id>(
    id_alloc: &IdAllocator,
    sheet_id: SheetId,
    store: &AxisIdentityStore<Id>,
) where
    Id: AxisIdentityId,
{
    let AxisIdentityStore::Explicit(_) = store else {
        return;
    };
    for id in store.identities_in(sheet_id, 0, store.len()) {
        id_alloc.ensure_past(id.as_raw());
    }
}
