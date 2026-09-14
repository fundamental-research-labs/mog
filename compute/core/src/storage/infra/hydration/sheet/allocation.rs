use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::SheetData;

use super::identity::{allocate_anchored_identities, sheet_identity_extent, SheetIdAllocation};
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::infra::hydration::DefaultIdAllocator;
    use cell_types::AxisIdentityStore;

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
}
