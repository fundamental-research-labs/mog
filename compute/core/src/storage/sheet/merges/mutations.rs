use super::StoredMerge;
use crate::identity::GridIndex;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::merge::IdentityMergedRegion;
use value_types::ComputeError;

/// Register a merge. The engine owns clearing covered cell contents and recalculation.
pub fn merge_range(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> Result<Option<IdentityMergedRegion>, ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    if sr > er || sc > ec || (sr == er && sc == ec) {
        return Ok(None);
    }
    let meta =
        storage
            .sheet_metadata
            .get_mut(&sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    if meta
        .merges
        .iter()
        .filter_map(|merge| merge.resolve(grid))
        .any(|merge| {
            merge.start_row <= er
                && merge.end_row >= sr
                && merge.start_col <= ec
                && merge.end_col >= sc
        })
    {
        return Ok(None);
    }
    let merge = StoredMerge {
        top_left_id: grid.ensure_cell_id(sr, sc),
        bottom_right_id: grid.ensure_cell_id(er, ec),
        ord: None,
    };
    let region = merge.to_identity();
    meta.merges.push(merge);
    Ok(Some(region))
}

pub fn merge_across(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> Vec<IdentityMergedRegion> {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    if sc >= ec || sr > er {
        return vec![];
    }
    (sr..=er)
        .filter_map(|row| {
            merge_range(storage, sheet_id, grid, row, sc, row, ec)
                .ok()
                .flatten()
        })
        .collect()
}

pub fn merge_and_center(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> Result<Option<IdentityMergedRegion>, ComputeError> {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    if sr > er || sc > ec || (sr == er && sc == ec) {
        return Ok(None);
    }
    if let Some(meta) = storage.sheet_metadata.get_mut(&sheet_id) {
        meta.merges.retain(|entry| {
            entry.resolve(grid).is_some_and(|merge| {
                merge.start_row > er
                    || merge.end_row < sr
                    || merge.start_col > ec
                    || merge.end_col < sc
            })
        });
    }
    merge_range(storage, sheet_id, grid, sr, sc, er, ec)
}

/// Remove merges whose origins lie in the selected rectangle.
pub fn unmerge_range(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
    sr: u32,
    sc: u32,
    er: u32,
    ec: u32,
) -> u32 {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    let Some(meta) = storage.sheet_metadata.get_mut(&sheet_id) else {
        return 0;
    };
    let before = meta.merges.len();
    meta.merges.retain(|entry| {
        entry.resolve(grid).is_some_and(|merge| {
            merge.start_row < sr
                || merge.start_row > er
                || merge.start_col < sc
                || merge.start_col > ec
        })
    });
    (before - meta.merges.len()) as u32
}

pub fn clear_all_merges(storage: &mut WorkbookStorage, sheet_id: SheetId) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    if let Some(meta) = storage.sheet_metadata.get_mut(&sheet_id) {
        meta.merges.clear();
    }
}

pub fn validate_and_clean_merges(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &GridIndex,
) -> u32 {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    let Some(meta) = storage.sheet_metadata.get_mut(&sheet_id) else {
        return 0;
    };
    let before = meta.merges.len();
    meta.merges.retain(|merge| merge.resolve(grid).is_some());
    (before - meta.merges.len()) as u32
}

/// Re-anchor partially deleted merges to surviving corners before axis identities disappear.
pub(crate) fn reanchor_before_delete(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    grid: &mut GridIndex,
    mirror: &mut crate::mirror::CellMirror,
    at: u32,
    count: u32,
    rows: bool,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, merges);
    if count == 0 {
        return;
    }
    let Some(meta) = storage.sheet_metadata.get_mut(&sheet_id) else {
        return;
    };
    meta.merges.retain_mut(|entry| {
        let Some((start, end)) = super::super::anchor_ranges::reanchor_corners(
            entry.top_left_id,
            entry.bottom_right_id,
            grid,
            mirror,
            sheet_id,
            at,
            count,
            rows,
        ) else {
            return false;
        };
        entry.top_left_id = start;
        entry.bottom_right_id = end;
        true
    });
}
