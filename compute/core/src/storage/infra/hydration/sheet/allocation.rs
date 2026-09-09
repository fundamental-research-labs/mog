use cell_types::{AxisIdentityId, AxisIdentityStore, SheetId};
use compute_document::hex::id_to_hex;
use domain_types::SheetData;

use super::identity::{SheetIdAllocation, allocate_anchored_identities, sheet_identity_extent};
use crate::storage::infra::hydration::IdAllocator;

/// Allocate all IDs for a sheet for native hydration.
///
/// Allocation order is deterministic: SheetId, then compact row and column axes, then CellIds (one per cell in `sheet.cells`).
/// This matches the allocation order in `hydrate_sheet` so that the same
/// allocator seed produces identical IDs.
pub(crate) fn allocate_sheet_ids(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
) -> SheetIdAllocation {
    let sheet_id = allocator.alloc_sheet_id();
    allocate_sheet_ids_after_sheet_id(sheet, allocator, sheet_id)
}

/// Extend preallocated sheet identities when its deferred payload is loaded.
/// Existing axes retain their UUIDs and only missing positions allocate IDs.
/// The caller remaps value-free metadata anchors by their native positions.
pub(crate) fn allocate_sheet_ids_with_previous_allocation(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
    previous: Option<&SheetIdAllocation>,
) -> SheetIdAllocation {
    let allocated_sheet_id = allocator.alloc_sheet_id();
    let sheet_id = previous
        .map(|allocation| allocation.sheet_id)
        .unwrap_or(allocated_sheet_id);
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    let row_axis = reuse_axis(
        sheet_id,
        previous.map(|a| &a.row_axis),
        identity_rows,
        |len| allocator.alloc_row_axis(len),
    );
    let col_axis = reuse_axis(
        sheet_id,
        previous.map(|a| &a.col_axis),
        identity_cols,
        |len| allocator.alloc_col_axis(len),
    );

    let mut cell_ids = Vec::with_capacity(sheet.cells.len());
    for cell_idx in 0..sheet.cells.len() {
        let allocated = allocator.alloc_cell_id();
        cell_ids.push(
            previous
                .and_then(|allocation| allocation.cell_ids.get(cell_idx).copied())
                .unwrap_or(allocated),
        );
    }

    let mut identity_only_cells = allocate_anchored_identities(sheet, allocator);
    if let Some(previous) = previous {
        let previous_identity_ids: std::collections::HashMap<(u32, u32), _> = previous
            .identity_only_cells
            .iter()
            .map(|identity| ((identity.row, identity.col), identity.cell_id))
            .collect();
        for identity in &mut identity_only_cells {
            if let Some(cell_id) = previous_identity_ids.get(&(identity.row, identity.col)) {
                identity.cell_id = *cell_id;
            }
        }
    }

    SheetIdAllocation {
        sheet_id,
        sheet_hex,
        row_axis,
        col_axis,
        cell_ids,
        identity_only_cells,
    }
}

fn allocate_sheet_ids_after_sheet_id(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
    sheet_id: SheetId,
) -> SheetIdAllocation {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    let row_axis = allocator.alloc_row_axis(identity_rows);
    let col_axis = allocator.alloc_col_axis(identity_cols);

    let mut cell_ids = Vec::with_capacity(sheet.cells.len());
    for _ in &sheet.cells {
        cell_ids.push(allocator.alloc_cell_id());
    }

    let identity_only_cells = allocate_anchored_identities(sheet, allocator);

    SheetIdAllocation {
        sheet_id,
        sheet_hex,
        row_axis,
        col_axis,
        cell_ids,
        identity_only_cells,
    }
}

fn reuse_axis<Id: AxisIdentityId>(
    sheet_id: SheetId,
    previous: Option<&AxisIdentityStore<Id>>,
    len: u32,
    allocate: impl FnOnce(u32) -> AxisIdentityStore<Id>,
) -> AxisIdentityStore<Id> {
    let Some(previous) = previous else {
        return allocate(len);
    };
    let mut axis = previous.clone();
    let old_len = axis.len();
    if len <= old_len {
        axis.delete_range(len, old_len - len);
        return axis;
    }
    match allocate(len - old_len) {
        AxisIdentityStore::Runs(compact) => {
            for segment in compact.segments() {
                axis.insert_run(sheet_id, axis.len(), segment.run);
            }
        }
        AxisIdentityStore::Explicit(new_ids) => {
            let mut ids: Vec<_> = axis.identities_in(sheet_id, 0, old_len).collect();
            ids.extend(new_ids);
            axis = AxisIdentityStore::Explicit(ids);
        }
    }
    axis
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::infra::hydration::DefaultIdAllocator;

    #[test]
    fn sparse_import_allocates_two_compact_axes_for_a_million_rows() {
        let sheet = SheetData {
            rows: 1_000_000,
            cols: 16_384,
            ..Default::default()
        };
        let mut allocator = DefaultIdAllocator::new();
        let allocation = allocate_sheet_ids(&sheet, &mut allocator);
        let AxisIdentityStore::Runs(rows) = &allocation.row_axis else {
            panic!("expanded row identities");
        };
        let AxisIdentityStore::Runs(cols) = &allocation.col_axis else {
            panic!("expanded column identities");
        };
        assert_eq!(rows.segments().len(), 1);
        assert_eq!(cols.segments().len(), 1);
        assert_eq!(allocation.row_axis.len(), 1_000_000);
        assert_eq!(allocation.col_axis.len(), 16_384);
        assert!(allocation.cell_ids.is_empty());
        assert!(allocation.identity_only_cells.is_empty());
        assert_eq!(
            allocator.alloc_cell_id().as_u128(),
            allocation.sheet_id.as_u128() + 1
        );
    }

    #[test]
    fn deferred_axis_growth_keeps_previous_identities_and_reserves_all_runs() {
        let mut original = DefaultIdAllocator::new();
        let sheet = SheetData {
            rows: 100,
            cols: 10,
            ..Default::default()
        };
        let first = allocate_sheet_ids(&sheet, &mut original);
        let second = allocate_sheet_ids(&sheet, &mut original);
        let old_last = first.row_axis.identity_at(first.sheet_id, 99).unwrap();
        let second_first = second.row_axis.identity_at(second.sheet_id, 0).unwrap();
        let mut continuation = DefaultIdAllocator::with_seed(100);
        for allocation in [&first, &second] {
            continuation.reserve_axis(&allocation.row_axis);
            continuation.reserve_axis(&allocation.col_axis);
        }
        let grown = allocate_sheet_ids_with_previous_allocation(
            &SheetData {
                rows: 1_000_000,
                cols: 12,
                ..Default::default()
            },
            &mut continuation,
            Some(&first),
        );
        assert_eq!(grown.sheet_id, first.sheet_id);
        assert_eq!(
            grown.row_axis.identity_at(first.sheet_id, 99),
            Some(old_last)
        );
        let AxisIdentityStore::Runs(rows) = &grown.row_axis else {
            panic!("expanded row identities");
        };
        assert_eq!(rows.segments().len(), 2);
        assert!(
            rows.segments()[1].run.run_id > second_first.compact_axis_identity().unwrap().run_id
        );
        assert_ne!(
            grown.row_axis.identity_at(first.sheet_id, 100),
            Some(old_last)
        );
        let shrunk =
            allocate_sheet_ids_with_previous_allocation(&sheet, &mut continuation, Some(&grown));
        assert_eq!(shrunk.row_axis, first.row_axis);
        assert_eq!(shrunk.col_axis, first.col_axis);
    }
}
