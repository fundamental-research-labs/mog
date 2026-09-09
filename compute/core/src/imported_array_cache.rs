//! Imported dynamic-array spill caches.
//!
//! Spreadsheet packages commonly materialize every member of a dynamic-array
//! result as a cached worksheet cell. Those members are package data, rather
//! than authored cells: keeping them in the authored sparse store makes them
//! block the live spill projection. This type carries the cache and its
//! original range separately so no-recalc reads/export can use it safely.

use cell_types::{CellId, SheetPos};
use formula_types::StructureChange;

#[derive(Debug, Clone)]
pub(crate) struct ImportedArrayCache {
    /// Position of the dynamic-array source cell.
    pub(crate) source: SheetPos,
    /// Stable identity of the dynamic-array source cell.
    ///
    /// Imported spill positions are not authored cells, so their package
    /// coordinates cannot be used as durable keys across row/column edits.
    /// The source identity lets the cache recover its current position from
    /// the mirror's identity map after a structural operation or rebuild.
    pub(crate) source_id: CellId,
    /// Declared spill bounds, inclusive.
    pub(crate) start: SheetPos,
    pub(crate) end: SheetPos,
    /// Original package cells, including their formula/cache metadata.
    pub(crate) cells: Vec<domain_types::CellData>,
    /// Stable identities for the cached package cells, parallel to `cells`.
    /// These identities are retained as metadata-only positions by hydration;
    /// they never become authored value/formula entries in the live mirror.
    pub(crate) cell_ids: Vec<CellId>,
    /// Whether the cached values still represent the current live workbook.
    /// Metadata remains useful after recalc even when values are stale.
    pub(crate) values_current: bool,
}

impl ImportedArrayCache {
    pub(crate) fn contains(&self, pos: SheetPos) -> bool {
        pos.row() >= self.start.row()
            && pos.row() <= self.end.row()
            && pos.col() >= self.start.col()
            && pos.col() <= self.end.col()
    }

    pub(crate) fn invalidate_values(&mut self) {
        self.values_current = false;
    }

    /// Apply a sheet-wide row/column structural change to the cache's
    /// positional compatibility fields.  Stable identities are rebound after
    /// the native operation; this pass also handles deleted members and range
    /// boundaries that straddle an insertion/deletion.
    pub(crate) fn remap_for_structure_change(&mut self, change: &StructureChange) -> bool {
        let Some(source) = map_position(self.source, change) else {
            // The source was deleted. Its package cache can no longer be
            // associated with a live dynamic-array formula.
            return false;
        };
        let start = map_boundary(self.start, change, false);
        let end = map_boundary(self.end, change, true);
        if start.row() > end.row() || start.col() > end.col() {
            return false;
        }

        let mut cells = Vec::with_capacity(self.cells.len());
        let mut cell_ids = Vec::with_capacity(self.cell_ids.len());
        for (mut cell, cell_id) in self.cells.drain(..).zip(self.cell_ids.drain(..)) {
            let Some(position) = map_position(SheetPos::new(cell.row, cell.col), change) else {
                // A child in a deleted band no longer has a package value at
                // any surviving position.
                continue;
            };
            cell.row = position.row();
            cell.col = position.col();
            cells.push(cell);
            cell_ids.push(cell_id);
        }

        self.source = source;
        self.start = start;
        self.end = end;
        self.cells = cells;
        self.cell_ids = cell_ids;
        true
    }

    /// Rebind the source and cached member coordinates to their current native
    /// identities.  Structural edits move those identities while the import
    /// sidecar itself is intentionally value-free, so this is the single
    /// boundary where the sidecar's positional compatibility fields are
    /// refreshed.
    pub(crate) fn rebind_positions(
        &mut self,
        mut resolve: impl FnMut(&CellId) -> Option<SheetPos>,
    ) -> bool {
        let old_source = self.source;
        let Some(new_source) = resolve(&self.source_id) else {
            // A deleted source cannot own a cache anymore, even when a legacy
            // caller has no child identities to resolve.
            return false;
        };

        self.source = new_source;
        let row_delta = new_source.row() as i64 - old_source.row() as i64;
        let col_delta = new_source.col() as i64 - old_source.col() as i64;
        self.start = shift_pos(self.start, row_delta, col_delta);
        self.end = shift_pos(self.end, row_delta, col_delta);

        let mut cells = Vec::with_capacity(self.cells.len());
        let mut cell_ids = Vec::with_capacity(self.cell_ids.len());
        for (mut cell, cell_id) in self.cells.drain(..).zip(self.cell_ids.drain(..)) {
            if let Some(position) = resolve(&cell_id) {
                cell.row = position.row();
                cell.col = position.col();
                cells.push(cell);
                cell_ids.push(cell_id);
            }
        }
        self.cells = cells;
        self.cell_ids = cell_ids;
        true
    }
}

fn shift_pos(pos: SheetPos, row_delta: i64, col_delta: i64) -> SheetPos {
    let row = if row_delta.is_negative() {
        pos.row().saturating_sub(row_delta.unsigned_abs() as u32)
    } else {
        pos.row().saturating_add(row_delta as u32)
    };
    let col = if col_delta.is_negative() {
        pos.col().saturating_sub(col_delta.unsigned_abs() as u32)
    } else {
        pos.col().saturating_add(col_delta as u32)
    };
    SheetPos::new(row, col)
}

fn map_position(pos: SheetPos, change: &StructureChange) -> Option<SheetPos> {
    match change {
        StructureChange::InsertRows { at, count, .. } => Some(if pos.row() >= *at {
            SheetPos::new(pos.row().saturating_add(*count), pos.col())
        } else {
            pos
        }),
        StructureChange::DeleteRows { at, count, .. } => {
            let end = at.saturating_add(*count);
            if pos.row() >= *at && pos.row() < end {
                None
            } else if pos.row() >= end {
                Some(SheetPos::new(pos.row().saturating_sub(*count), pos.col()))
            } else {
                Some(pos)
            }
        }
        StructureChange::InsertCols { at, count, .. } => Some(if pos.col() >= *at {
            SheetPos::new(pos.row(), pos.col().saturating_add(*count))
        } else {
            pos
        }),
        StructureChange::DeleteCols { at, count, .. } => {
            let end = at.saturating_add(*count);
            if pos.col() >= *at && pos.col() < end {
                None
            } else if pos.col() >= end {
                Some(SheetPos::new(pos.row(), pos.col().saturating_sub(*count)))
            } else {
                Some(pos)
            }
        }
        // RemapPositions carries only stable cell IDs. The identity rebinding
        // pass updates members for this operation once those IDs are moved.
        StructureChange::RemapPositions { .. } => Some(pos),
    }
}

fn map_boundary(pos: SheetPos, change: &StructureChange, upper: bool) -> SheetPos {
    match change {
        StructureChange::DeleteRows { at, count, .. } => {
            let end = at.saturating_add(*count);
            if pos.row() >= *at && pos.row() < end {
                SheetPos::new(
                    if upper {
                        at.saturating_sub(1)
                    } else {
                        *at
                    },
                    pos.col(),
                )
            } else {
                map_position(pos, change).unwrap_or(pos)
            }
        }
        StructureChange::DeleteCols { at, count, .. } => {
            let end = at.saturating_add(*count);
            if pos.col() >= *at && pos.col() < end {
                SheetPos::new(
                    pos.row(),
                    if upper {
                        at.saturating_sub(1)
                    } else {
                        *at
                    },
                )
            } else {
                map_position(pos, change).unwrap_or(pos)
            }
        }
        _ => map_position(pos, change).unwrap_or(pos),
    }
}
