use super::*;

use crate::mirror::CellMirror;
use crate::projection::ProjectionRegistry;
use cell_types::SheetId;
use formula_types::CellRef;

pub(super) fn ref_in_sheet_ctx(cell_ref: &CellRef, sheet_ctx: SheetId) -> CellRef {
    match cell_ref {
        CellRef::Positional { sheet, row, col } if *sheet == SheetId::from_raw(0) => {
            CellRef::Positional {
                sheet: sheet_ctx,
                row: *row,
                col: *col,
            }
        }
        _ => *cell_ref,
    }
}

/// Projection-aware conversion of a CellRef to dependency targets.
///
/// Implements the "dual-edge" model for dynamic array projections:
/// - ALWAYS emits the standard dep (Cell or 1x1 Range) for correctness
/// - ADDITIONALLY, if the referenced position is inside a known projection,
///   emits `DepTarget::Cell(source)` to create a topological ordering edge
///   so the dependent evaluates AFTER the projection source
///
/// The `current_cell` parameter prevents self-dependencies when the source
/// of a projection is the same as the cell being extracted.
///
/// Pushes directly into `out` to avoid per-call Vec allocation (each call
/// typically produces 1-2 targets, so a Vec allocation per call is wasteful).
pub(super) fn push_cell_ref_dep_targets(
    cell_ref: &CellRef,
    mirror: &CellMirror,
    registry: Option<&ProjectionRegistry>,
    current_cell: Option<&CellId>,
    out: &mut Vec<DepTarget>,
) {
    match cell_ref {
        CellRef::Resolved(id) => {
            // Always emit the direct cell dep
            out.push(DepTarget::Cell(*id));

            // If registry is available, check if this resolved cell's position
            // is inside a projection and the source is different from `id`
            if let Some(reg) = registry
                && let Some(sheet_id) = mirror.sheet_for_cell(id)
                && let Some(sheet) = mirror.get_sheet(&sheet_id)
                && let Some(pos) = sheet.position_of(id)
                && let Some((source, _, _)) = reg.resolve(&sheet_id, pos.row(), pos.col())
            {
                // Add topo edge to projection source if it's different
                // from the resolved cell AND different from the current cell
                if source != *id {
                    let is_self = current_cell.is_some_and(|c| source == *c);
                    if !is_self {
                        out.push(DepTarget::Cell(source));
                    }
                }
            }
        }
        CellRef::Positional { sheet, row, col } => {
            // Always emit the 1x1 range dep (safety net)
            out.push(DepTarget::Range(
                RangePos::new(*sheet, *row, *col, *row, *col),
                RangeAccess::Aggregate,
            ));

            // If registry is available, check if this position is inside a projection
            if let Some(reg) = registry
                && let Some((source, _, _)) = reg.resolve(sheet, *row, *col)
            {
                let is_self = current_cell.is_some_and(|c| source == *c);
                if !is_self {
                    out.push(DepTarget::Cell(source));
                }
            }
        }
    }
}

/// Wrapper for backwards compatibility with callers expecting Vec return.
#[cfg(test)]
pub(super) fn cell_ref_to_dep_targets(
    cell_ref: &CellRef,
    mirror: &CellMirror,
    registry: Option<&ProjectionRegistry>,
    current_cell: Option<&CellId>,
) -> Vec<DepTarget> {
    let mut targets = Vec::new();
    push_cell_ref_dep_targets(cell_ref, mirror, registry, current_cell, &mut targets);
    targets
}

/// Extract position info from a CellRef, using mirror for reverse lookup of Resolved refs.
pub(super) fn cell_ref_to_position(
    cell_ref: &CellRef,
    current_sheet: &SheetId,
    mirror: &CellMirror,
) -> Option<(SheetId, u32, u32)> {
    match cell_ref {
        CellRef::Resolved(id) => {
            // O(1) reverse-lookup via cell_to_sheet index
            let sheet_id = mirror.sheet_for_cell(id)?;
            let sheet = mirror.get_sheet(&sheet_id)?;
            let pos = sheet.position_of(id)?;
            let (row, col) = (pos.row(), pos.col());
            Some((sheet_id, row, col))
        }
        CellRef::Positional { sheet, row, col } => {
            let resolved_sheet = if *sheet == SheetId::from_raw(0) {
                *current_sheet
            } else {
                *sheet
            };
            Some((resolved_sheet, *row, *col))
        }
    }
}
