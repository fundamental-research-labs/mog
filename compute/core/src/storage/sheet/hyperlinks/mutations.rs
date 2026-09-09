use cell_types::{CellId, SheetId};
use domain_types::domain::hyperlink::{
    Hyperlink, HyperlinkTargetKind, hyperlink_target_kind_for_target,
};

use super::StoredHyperlink;
use crate::storage::WorkbookStorage;

/// Set metadata without authoring a value or replacing a cell identity.
pub fn set_hyperlink(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    cell_id: CellId,
    url: &str,
    display: Option<String>,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, hyperlinks);
    let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    let kind = hyperlink_target_kind_for_target(url);
    let data = Hyperlink {
        target: (kind == HyperlinkTargetKind::Relationship).then(|| url.to_owned()),
        location: (kind == HyperlinkTargetKind::InlineLocation).then(|| url.to_owned()),
        target_mode: (kind == HyperlinkTargetKind::Relationship && !url.starts_with('#'))
            .then(|| "External".to_owned()),
        target_kind: Some(kind),
        display,
        ..Default::default()
    };
    if let Some(link) = metadata
        .hyperlinks
        .iter_mut()
        .find(|link| link.start_id == cell_id)
    {
        link.data = data;
    } else {
        metadata.hyperlinks.push(StoredHyperlink {
            start_id: cell_id,
            end_id: None,
            data,
        });
    }
}

/// Removing metadata retains identities referenced by formulas and other features.
pub fn remove_hyperlink(storage: &mut WorkbookStorage, sheet_id: &SheetId, cell_id: CellId) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, hyperlinks);
    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) {
        metadata.hyperlinks.retain(|link| link.start_id != cell_id);
    }
}

pub fn clear_hyperlinks_in_range(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    grid: &crate::cells::SheetStore,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, hyperlinks);
    if let Some(metadata) = storage.sheet_metadata.get_mut(sheet_id) {
        metadata.hyperlinks.retain(|link| {
            !grid
                .cell_position(&link.start_id)
                .is_some_and(|(row, col)| {
                    (start_row..=end_row).contains(&row) && (start_col..=end_col).contains(&col)
                })
        });
    }
}

/// Shrink partially deleted ranges and remove links whose entire anchor is deleted.
pub(crate) fn reanchor_before_delete(
    storage: &mut WorkbookStorage,
    sheet_id: SheetId,
    cell_store: &mut crate::cells::CellStore,
    at: u32,
    count: u32,
    rows: bool,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, sheet_id, hyperlinks);
    if count == 0 {
        return;
    }
    let Some(metadata) = storage.sheet_metadata.get_mut(&sheet_id) else {
        return;
    };
    metadata.hyperlinks.retain_mut(|link| {
        let Some((start, end)) = super::super::anchor_ranges::reanchor_corners(
            link.start_id,
            link.end_id.unwrap_or(link.start_id),
            cell_store,
            sheet_id,
            at,
            count,
            rows,
        ) else {
            return false;
        };
        link.start_id = start;
        if link.end_id.is_some() {
            link.end_id = Some(end);
        }
        true
    });
}
