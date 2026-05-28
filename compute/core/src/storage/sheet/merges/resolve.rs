use cell_types::CellId;
use compute_document::hex::hex_to_id;
use compute_document::identity::GridIndex;
use domain_types::domain::merge::{IdentityMergedRegion, ResolvedMergedRegion};
use yrs::{Any, Out};

use super::codec::{StoredMerge, stored_merge_from_yrs_map};

/// Check if two axis-aligned rectangles overlap.
#[allow(clippy::too_many_arguments)]
pub(super) fn ranges_overlap(
    r1_sr: u32,
    r1_sc: u32,
    r1_er: u32,
    r1_ec: u32,
    r2_sr: u32,
    r2_sc: u32,
    r2_er: u32,
    r2_ec: u32,
) -> bool {
    !(r1_er < r2_sr || r1_sr > r2_er || r1_ec < r2_sc || r1_sc > r2_ec)
}

/// Parse a cell-id hex string into a `CellId`.
fn parse_cell_id_hex(hex: &str) -> Option<CellId> {
    hex_to_id(hex).map(CellId::from_raw)
}

/// Resolve an `IdentityMergedRegion` to row/col positions by looking up both
/// CellId hexes in the `GridIndex` -- the sole identity authority.
fn resolve_region(grid: &GridIndex, merge: &IdentityMergedRegion) -> Option<ResolvedMergedRegion> {
    let tl_id = parse_cell_id_hex(&merge.top_left_id)?;
    let br_id = parse_cell_id_hex(&merge.bottom_right_id)?;

    let (sr, sc) = grid.cell_position(&tl_id)?;
    let (er, ec) = grid.cell_position(&br_id)?;

    Some(ResolvedMergedRegion::new(merge.clone(), sr, sc, er, ec))
}

/// Try to resolve a merge entry from either format:
/// 1. Structured Y.Map (preferred -- full StoredMerge with cell IDs, or legacy coords-only)
/// 2. JSON string (`StoredMerge` -- legacy format, covers both StoredMerge and old IdentityMergedRegion)
pub(super) fn resolve_merge_entry<T: yrs::ReadTxn>(
    txn: &T,
    grid: &GridIndex,
    value: &Out,
) -> Option<ResolvedMergedRegion> {
    // Try structured Y.Map first (preferred)
    if let Out::YMap(map) = value {
        // Full StoredMerge with cell identity fields
        if let Some(stored) = stored_merge_from_yrs_map(map, txn) {
            return resolve_region(grid, &stored.to_identity());
        }
        // Legacy structured format without cell IDs (coords only)
        if let Some(region) = domain_types::yrs_schema::merge::from_yrs_map(map, txn) {
            return Some(ResolvedMergedRegion::new(
                IdentityMergedRegion {
                    top_left_id: String::new(),
                    bottom_right_id: String::new(),
                },
                region.start_row,
                region.start_col,
                region.end_row,
                region.end_col,
            ));
        }
    }
    // Try JSON string (StoredMerge -- written by hydration since cec2a6c5)
    if let Out::Any(Any::String(json_str)) = value
        && let Ok(stored) = serde_json::from_str::<StoredMerge>(json_str)
    {
        return resolve_region(grid, &stored.to_identity());
    }
    None
}

/// Resolve a merge entry using inline positions.
pub(super) fn resolve_merge_from_stored<T: yrs::ReadTxn>(
    value: &Out,
    txn: &T,
) -> Option<ResolvedMergedRegion> {
    if let Out::YMap(map) = value
        && let Some(stored) = stored_merge_from_yrs_map(map, txn)
    {
        let identity = stored.to_identity();
        return Some(ResolvedMergedRegion::new(
            identity, stored.sr, stored.sc, stored.er, stored.ec,
        ));
    }
    // JSON string (StoredMerge -- written by hydration since cec2a6c5)
    if let Out::Any(Any::String(json_str)) = value
        && let Ok(stored) = serde_json::from_str::<StoredMerge>(json_str)
    {
        let identity = stored.to_identity();
        return Some(ResolvedMergedRegion::new(
            identity, stored.sr, stored.sc, stored.er, stored.ec,
        ));
    }
    None
}
