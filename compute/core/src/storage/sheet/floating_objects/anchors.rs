//! Drawing anchor projection through the native identity grid.

use crate::cells::CellStore;
use crate::storage::WorkbookStorage;
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_document::identity::GridIndex;
use domain_types::domain::floating_object::{AnchorMode, FloatingObject};
use formula_types::StructureChange;

fn cell_id(reference: &str) -> Option<CellId> {
    hex_to_id(reference)
        .map(CellId::from_raw)
        .or_else(|| CellId::from_uuid_str(reference).ok())
}

/// Project durable anchor identities into the positions needed by drawing export.
pub(crate) fn project_anchor_positions(
    object: &mut FloatingObject,
    grid: &crate::cells::SheetStore,
) {
    let common = &mut object.common;
    if common.anchor.anchor_mode == AnchorMode::Absolute {
        return;
    }
    if let Some((row, col)) = common
        .anchor_cell_id
        .as_deref()
        .and_then(cell_id)
        .and_then(|id| grid.cell_position(&id))
    {
        common.anchor.anchor_row = row;
        common.anchor.anchor_col = col;
    }
    if let Some((row, col)) = common
        .to_anchor_cell_id
        .as_deref()
        .and_then(cell_id)
        .and_then(|id| grid.cell_position(&id))
    {
        common.anchor.end_row = Some(row);
        common.anchor.end_col = Some(col);
    }
}

/// Retain drawings whose anchor row or column was deleted at the nearest surviving position.
pub(crate) fn sync_after_structure(
    storage: &mut WorkbookStorage,
    grid: &mut GridIndex,
    cell_store: &mut CellStore,
    sheet_id: SheetId,
    change: &StructureChange,
) {
    fn shift(position: u32, at: u32, count: u32, insert: bool) -> u32 {
        if position < at {
            position
        } else if insert {
            position.saturating_add(count)
        } else {
            position.saturating_sub(count).max(at.min(position))
        }
    }
    if storage.history.is_active() {
        if let Some(meta) = storage.sheet_metadata.get(&sheet_id) {
            for (id, object) in &meta.floating_objects.objects {
                if object.common.anchor.anchor_mode != AnchorMode::Absolute {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage,
                        sheet_id,
                        floating_objects.objects,
                        id
                    );
                }
            }
        }
    }
    let Some(metadata) = storage.sheet_metadata.get_mut(&sheet_id) else {
        return;
    };
    for object in metadata.floating_objects.objects.values_mut() {
        if object.common.anchor.anchor_mode == AnchorMode::Absolute {
            continue;
        }
        let mut resolve = |reference: &mut Option<String>, row: &mut u32, col: &mut u32| {
            if let Some((r, c)) = reference
                .as_deref()
                .and_then(cell_id)
                .and_then(|id| cell_store.get_sheet(&sheet_id)?.cell_position(&id))
            {
                *row = r;
                *col = c;
                return;
            }
            match change {
                StructureChange::InsertRows { at, count, .. } => {
                    *row = shift(*row, *at, *count, true)
                }
                StructureChange::DeleteRows { at, count, .. } => {
                    *row = shift(*row, *at, *count, false)
                }
                StructureChange::InsertCols { at, count, .. } => {
                    *col = shift(*col, *at, *count, true)
                }
                StructureChange::DeleteCols { at, count, .. } => {
                    *col = shift(*col, *at, *count, false)
                }
                StructureChange::RemapPositions { .. } => {}
            }
            if grid.row_count() == 0 || grid.col_count() == 0 {
                *reference = None;
                return;
            }
            *row = (*row).min(grid.row_count() - 1);
            *col = (*col).min(grid.col_count() - 1);
            let pos = SheetPos::new(*row, *col);
            let id = cell_store
                .ensure_identity_at(&sheet_id, pos)
                .expect("drawing sheet exists");
            *reference = Some(id_to_hex(id.as_u128()).to_string());
        };
        let common = &mut object.common;
        resolve(
            &mut common.anchor_cell_id,
            &mut common.anchor.anchor_row,
            &mut common.anchor.anchor_col,
        );
        if let (Some(row), Some(col)) = (&mut common.anchor.end_row, &mut common.anchor.end_col) {
            resolve(&mut common.to_anchor_cell_id, row, col);
        }
    }
}
