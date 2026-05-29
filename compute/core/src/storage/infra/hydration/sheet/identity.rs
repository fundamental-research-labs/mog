use std::collections::{HashMap, HashSet};

use cell_types::{CellId, ColId, RowId, SheetId};
use compute_document::hex::{SmallHex, id_to_hex};
use domain_types::SheetData;

use crate::import::parse_output_to_snapshot::anchor_collection::collect_identity_required_anchors;
use crate::storage::infra::hydration::{AnchoredCellIdentity, IdAllocator};

pub(crate) fn cell_keeps_import_identity(cell: &domain_types::CellData) -> bool {
    cell.formula.is_some()
        || !cell.value.is_null()
        || cell.style_id.is_some()
        || cell.cell_metadata_index.is_some()
        || cell.vm.is_some()
        || cell.formula_result_type.is_some()
        || cell.has_empty_cached_value
        || !cell.formula_cache_provenance.is_absent_or_unknown()
        || cell.original_sst_index.is_some()
        || cell.original_value.is_some()
}

pub(crate) fn sheet_identity_extent(sheet: &SheetData) -> (u32, u32) {
    let mut rows = sheet.rows;
    let mut cols = sheet.cols;

    for cell in &sheet.cells {
        rows = rows.max(cell.row.saturating_add(1));
        cols = cols.max(cell.col.saturating_add(1));
    }

    for &(row, col) in collect_identity_required_anchors(sheet).keys() {
        rows = rows.max(row.saturating_add(1));
        cols = cols.max(col.saturating_add(1));
    }

    (rows, cols)
}

pub(crate) fn allocate_anchored_identities(
    sheet: &SheetData,
    allocator: &mut impl IdAllocator,
) -> Vec<AnchoredCellIdentity> {
    let occupied: HashSet<(u32, u32)> = sheet
        .cells
        .iter()
        .filter(|cell| cell_keeps_import_identity(cell))
        .map(|cell| (cell.row, cell.col))
        .collect();
    let anchors = collect_identity_required_anchors(sheet);
    let mut positions: Vec<(u32, u32)> = anchors.keys().copied().collect();
    positions.sort_unstable();

    positions
        .into_iter()
        .filter(|pos| !occupied.contains(pos))
        .filter_map(|(row, col)| {
            let reasons = anchors.get(&(row, col))?.clone();
            Some(AnchoredCellIdentity {
                cell_id: allocator.alloc_cell_id(),
                row,
                col,
                reasons,
            })
        })
        .collect()
}

pub(crate) fn allocate_missing_anchored_identities(
    sheet: &SheetData,
    pos_map: &HashMap<String, String>,
    allocator: &mut impl IdAllocator,
) -> Vec<AnchoredCellIdentity> {
    let anchors = collect_identity_required_anchors(sheet);
    let mut positions: Vec<(u32, u32)> = anchors.keys().copied().collect();
    positions.sort_unstable();

    positions
        .into_iter()
        .filter(|(row, col)| !pos_map.contains_key(&format!("{}:{}", row, col)))
        .filter_map(|(row, col)| {
            let reasons = anchors.get(&(row, col))?.clone();
            Some(AnchoredCellIdentity {
                cell_id: allocator.alloc_cell_id(),
                row,
                col,
                reasons,
            })
        })
        .collect()
}

pub(crate) fn insert_missing_anchored_identities(
    pos_map: &mut HashMap<String, String>,
    identities: &[AnchoredCellIdentity],
) -> Vec<(CellId, u32, u32)> {
    let mut inserted = Vec::new();
    for identity in identities {
        debug_assert!(!identity.reasons.is_empty());
        let pos_key = format!("{}:{}", identity.row, identity.col);
        if pos_map.contains_key(&pos_key) {
            continue;
        }
        let cell_hex = id_to_hex(identity.cell_id.as_u128()).to_string();
        pos_map.insert(pos_key, cell_hex);
        inserted.push((identity.cell_id, identity.row, identity.col));
    }
    inserted
}

/// Pre-allocated IDs for a single sheet, computed before any Yrs writes.
///
/// This allows the Range classifier to run between ID allocation and Yrs
/// hydration, so that ranged cells can be skipped during per-cell Yrs writes.
pub(crate) struct SheetIdAllocation {
    pub sheet_id: SheetId,
    pub sheet_hex: SmallHex,
    pub row_ids: Vec<RowId>,
    pub row_id_hexes: Vec<SmallHex>,
    pub col_ids: Vec<ColId>,
    pub col_id_hexes: Vec<SmallHex>,
    pub cell_ids: Vec<CellId>,
    pub identity_only_cells: Vec<AnchoredCellIdentity>,
}
