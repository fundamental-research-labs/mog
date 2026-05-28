use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::SheetData;

use super::identity::{SheetIdAllocation, allocate_anchored_identities, sheet_identity_extent};
use crate::storage::infra::hydration::IdAllocator;

/// Allocate all IDs for a sheet without performing any Yrs writes.
///
/// Allocation order is deterministic: SheetId, then RowIds (one per row),
/// then ColIds (one per col), then CellIds (one per cell in `sheet.cells`).
/// This matches the allocation order in `hydrate_sheet` so that the same
/// allocator seed produces identical IDs.
pub(crate) fn allocate_sheet_ids(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
) -> SheetIdAllocation {
    let sheet_id = allocator.alloc_sheet_id();
    allocate_sheet_ids_after_sheet_id(sheet, allocator, sheet_id)
}

/// Like `allocate_sheet_ids` but uses a pre-assigned SheetId when provided.
/// Used by deferred hydration to maintain stable sheet IDs between fast
/// and full paths.
pub(crate) fn allocate_sheet_ids_with_sheet_id(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
    fixed_sheet_id: Option<SheetId>,
) -> SheetIdAllocation {
    let sheet_id = match fixed_sheet_id {
        Some(id) => {
            // Consume the allocator's SheetId slot to keep counter in sync.
            let _ = allocator.alloc_sheet_id();
            id
        }
        None => allocator.alloc_sheet_id(),
    };

    allocate_sheet_ids_after_sheet_id(sheet, allocator, sheet_id)
}

fn allocate_sheet_ids_after_sheet_id(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
    sheet_id: SheetId,
) -> SheetIdAllocation {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let (identity_rows, identity_cols) = sheet_identity_extent(sheet);

    let mut row_ids = Vec::with_capacity(identity_rows as usize);
    let mut row_id_hexes = Vec::with_capacity(identity_rows as usize);
    for _ in 0..identity_rows {
        let rid = allocator.alloc_row_id();
        row_id_hexes.push(id_to_hex(rid.as_u128()));
        row_ids.push(rid);
    }

    let mut col_ids = Vec::with_capacity(identity_cols as usize);
    let mut col_id_hexes = Vec::with_capacity(identity_cols as usize);
    for _ in 0..identity_cols {
        let cid = allocator.alloc_col_id();
        col_id_hexes.push(id_to_hex(cid.as_u128()));
        col_ids.push(cid);
    }

    let mut cell_ids = Vec::with_capacity(sheet.cells.len());
    for _ in &sheet.cells {
        cell_ids.push(allocator.alloc_cell_id());
    }

    let identity_only_cells = allocate_anchored_identities(sheet, allocator);

    SheetIdAllocation {
        sheet_id,
        sheet_hex,
        row_ids,
        row_id_hexes,
        col_ids,
        col_id_hexes,
        cell_ids,
        identity_only_cells,
    }
}
