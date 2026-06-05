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

/// Like `allocate_sheet_ids`, but reuses IDs from an earlier allocation where
/// possible while still consuming allocator slots for the current sheet shape.
///
/// Deferred XLSX import first hydrates one critical worksheet and later reparses
/// the whole workbook. If the critical worksheet is not sheet 0, earlier sheets
/// gain cells during the full parse and would otherwise shift the critical
/// sheet's row/column/cell IDs. This helper preserves any previously allocated
/// IDs by positional contract and consumes new slots for missing positions so
/// later allocations remain collision-free.
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

    let mut row_ids = Vec::with_capacity(identity_rows as usize);
    let mut row_id_hexes = Vec::with_capacity(identity_rows as usize);
    for row_idx in 0..identity_rows as usize {
        let allocated = allocator.alloc_row_id();
        let rid = previous
            .and_then(|allocation| allocation.row_ids.get(row_idx).copied())
            .unwrap_or(allocated);
        row_id_hexes.push(id_to_hex(rid.as_u128()));
        row_ids.push(rid);
    }

    let mut col_ids = Vec::with_capacity(identity_cols as usize);
    let mut col_id_hexes = Vec::with_capacity(identity_cols as usize);
    for col_idx in 0..identity_cols as usize {
        let allocated = allocator.alloc_col_id();
        let cid = previous
            .and_then(|allocation| allocation.col_ids.get(col_idx).copied())
            .unwrap_or(allocated);
        col_id_hexes.push(id_to_hex(cid.as_u128()));
        col_ids.push(cid);
    }

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
        row_ids,
        row_id_hexes,
        col_ids,
        col_id_hexes,
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
