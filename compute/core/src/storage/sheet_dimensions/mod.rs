//! Sheet-dimension write facade.
//!
//! Small write-side boundary to unify the
//! two places that can grow a sheet's logical dimensions: the in-memory
//! [`GridIndex`] (authoritative `row_index -> RowId` / `col_index -> ColId`
//! map used by the compute engine) and the yrs `rowOrder` / `colOrder`
//! `YArray`s (authoritative on the CRDT side and the only dimension info
//! that survives XLSX round-trips).
//!
//! # Why this exists
//!
//! Before R49, the batch write paths (`set_cell_values`, `import_values`)
//! read `rowOrder` / `colOrder` once up front and silently skipped every
//! update whose `(row, col)` fell outside the materialized extent. The
//! singular write path (`set_cell_value`) *did* auto-expand the yrs arrays
//! but forgot to tell `GridIndex`, so the two sides drifted.
//!
//! `SheetDimensionsMut::ensure_capacity` makes the two grows atomic:
//! one `GridIndex::ensure_capacity_returning` call allocates new
//! RowId / ColId identities, and the *same* hexes are immediately appended
//! to `rowOrder` / `colOrder` inside the caller-provided
//! `yrs::TransactionMut`. No second allocation, no drift.
//!
//! # Origin
//!
//! Auto-expand on write runs under `ORIGIN_USER_EDIT` — the implicit grow
//! is part of the user action that triggered it, so the undo manager
//! groups it with the edit rather than treating it as a standalone
//! structural op.

use std::sync::Arc;

use rustc_hash::FxHashMap;
use yrs::{Any, Array, ArrayPrelim, Doc, Map, MapRef, Out};

use cell_types::{MAX_COLS, MAX_ROWS, SheetId};
use compute_document::hex::id_to_hex;
use value_types::ComputeError;

use crate::identity::GridIndex;
use crate::storage::infra::grid_helpers::{get_col_order_array, get_row_order_array};

/// Write-side facade that keeps [`GridIndex`] dimensions and the yrs
/// `rowOrder` / `colOrder` `YArray`s in lock-step.
///
/// Instances are cheap — they just bundle references. Two constructors are
/// provided:
///
/// - [`Self::new`] — when the caller holds a full `FxHashMap<SheetId,
///   GridIndex>` (the normal engine store shape) and wants the facade to
///   look up the sheet by ID.
/// - [`Self::from_grid_index`] — when the caller has already borrowed
///   `&mut GridIndex` for a specific sheet. Skips the lookup and its
///   associated `SheetNotFound` case.
pub(crate) struct SheetDimensionsMut<'a> {
    sheets: &'a MapRef,
    target: Target<'a>,
}

enum Target<'a> {
    /// Look up the grid index by SheetId.
    ByMap {
        grid_indexes: &'a mut FxHashMap<SheetId, GridIndex>,
    },
    /// Grid index already resolved by the caller.
    Direct { grid: &'a mut GridIndex },
}

impl<'a> SheetDimensionsMut<'a> {
    /// Construct from a full grid-index store.
    #[allow(dead_code)] // Reserved for cross-sheet callers.
    // Current callers use `from_grid_index` exclusively.
    pub(crate) fn new(
        _doc: &'a Doc,
        sheets: &'a MapRef,
        grid_indexes: &'a mut FxHashMap<SheetId, GridIndex>,
    ) -> Self {
        Self {
            sheets,
            target: Target::ByMap { grid_indexes },
        }
    }

    /// Construct from an already-borrowed grid index. The caller guarantees
    /// the `GridIndex` corresponds to the `SheetId` it will pass to
    /// [`Self::ensure_capacity`].
    pub(crate) fn from_grid_index(
        _doc: &'a Doc,
        sheets: &'a MapRef,
        grid: &'a mut GridIndex,
    ) -> Self {
        Self {
            sheets,
            target: Target::Direct { grid },
        }
    }

    /// Ensure the sheet has at least `row + 1` rows and `col + 1` cols.
    ///
    /// Auto-expands both the in-memory `GridIndex` and the yrs
    /// `rowOrder` / `colOrder` `YArray`s, using the SAME freshly-allocated
    /// RowId / ColId hexes on both sides. No-op if the sheet is already
    /// large enough.
    ///
    /// Clamps `row` / `col` at `MAX_ROWS - 1` / `MAX_COLS - 1` (Excel's
    /// sheet ceiling). Positions above the clamp are still written to
    /// whatever portion of the grid was actually grown — the caller is
    /// expected to have validated the range via `validate_range_bounds`
    /// if it cares about the ceiling.
    ///
    /// Writes to yrs run inside the caller-provided `TransactionMut` so
    /// the grow is batched with the edit that triggered it. Commit origin
    /// (`ORIGIN_USER_EDIT` vs. `ORIGIN_STRUCTURAL`) is whatever the caller
    /// opened the txn with; callers open `ORIGIN_USER_EDIT` so undo groups the
    /// implicit grow with the edit.
    pub(crate) fn ensure_capacity(
        &mut self,
        txn: &mut yrs::TransactionMut<'_>,
        sheet_id: SheetId,
        row: u32,
        col: u32,
    ) -> Result<(), ComputeError> {
        // Clamp at Excel sheet ceiling. MAX_ROWS / MAX_COLS are counts,
        // so valid zero-based indices go up to MAX_* - 1.
        let row = row.min(MAX_ROWS.saturating_sub(1));
        let col = col.min(MAX_COLS.saturating_sub(1));

        let grid: &mut GridIndex = match &mut self.target {
            Target::ByMap { grid_indexes } => {
                grid_indexes
                    .get_mut(&sheet_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    })?
            }
            Target::Direct { grid } => grid,
        };

        // Fast path: already large enough on both axes.
        if row < grid.row_count() && col < grid.col_count() {
            return Ok(());
        }

        // Grow the in-memory index first and capture the freshly allocated
        // identities. These are the authoritative IDs that must also land
        // in the yrs YArrays.
        let (new_row_ids, new_col_ids) = grid.ensure_capacity_returning(row, col);

        if new_row_ids.is_empty() && new_col_ids.is_empty() {
            return Ok(());
        }

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let sheet_map = match self.sheets.get(&*txn, sheet_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                });
            }
        };

        if !new_row_ids.is_empty() {
            let row_order = get_row_order_array(&sheet_map, &*txn).unwrap_or_else(|| {
                sheet_map.insert(
                    txn,
                    compute_document::schema::KEY_ROW_ORDER,
                    ArrayPrelim::default(),
                )
            });
            let start = row_order.len(&*txn);
            let values = new_row_ids.iter().map(|rid| {
                let hex = id_to_hex(rid.as_u128());
                Any::String(Arc::from(hex.as_str()))
            });
            row_order.insert_range(txn, start, values);
        }

        if !new_col_ids.is_empty() {
            let col_order = get_col_order_array(&sheet_map, &*txn).unwrap_or_else(|| {
                sheet_map.insert(
                    txn,
                    compute_document::schema::KEY_COL_ORDER,
                    ArrayPrelim::default(),
                )
            });
            let start = col_order.len(&*txn);
            let values = new_col_ids.iter().map(|cid| {
                let hex = id_to_hex(cid.as_u128());
                Any::String(Arc::from(hex.as_str()))
            });
            col_order.insert_range(txn, start, values);
        }

        Ok(())
    }

    pub(crate) fn ensure_row_capacity(
        &mut self,
        txn: &mut yrs::TransactionMut<'_>,
        sheet_id: SheetId,
        row: u32,
    ) -> Result<(), ComputeError> {
        let row = row.min(MAX_ROWS.saturating_sub(1));

        let grid: &mut GridIndex = match &mut self.target {
            Target::ByMap { grid_indexes } => {
                grid_indexes
                    .get_mut(&sheet_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    })?
            }
            Target::Direct { grid } => grid,
        };

        if row < grid.row_count() {
            return Ok(());
        }

        let new_row_ids = grid.ensure_row_capacity_returning(row);
        if new_row_ids.is_empty() {
            return Ok(());
        }

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let sheet_map = match self.sheets.get(&*txn, sheet_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                });
            }
        };

        let row_order = get_row_order_array(&sheet_map, &*txn).unwrap_or_else(|| {
            sheet_map.insert(
                txn,
                compute_document::schema::KEY_ROW_ORDER,
                ArrayPrelim::default(),
            )
        });
        let start = row_order.len(&*txn);
        let values = new_row_ids.iter().map(|rid| {
            let hex = id_to_hex(rid.as_u128());
            Any::String(Arc::from(hex.as_str()))
        });
        row_order.insert_range(txn, start, values);

        Ok(())
    }

    pub(crate) fn ensure_col_capacity(
        &mut self,
        txn: &mut yrs::TransactionMut<'_>,
        sheet_id: SheetId,
        col: u32,
    ) -> Result<(), ComputeError> {
        let col = col.min(MAX_COLS.saturating_sub(1));

        let grid: &mut GridIndex = match &mut self.target {
            Target::ByMap { grid_indexes } => {
                grid_indexes
                    .get_mut(&sheet_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    })?
            }
            Target::Direct { grid } => grid,
        };

        if col < grid.col_count() {
            return Ok(());
        }

        let new_col_ids = grid.ensure_col_capacity_returning(col);
        if new_col_ids.is_empty() {
            return Ok(());
        }

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let sheet_map = match self.sheets.get(&*txn, sheet_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                });
            }
        };

        let col_order = get_col_order_array(&sheet_map, &*txn).unwrap_or_else(|| {
            sheet_map.insert(
                txn,
                compute_document::schema::KEY_COL_ORDER,
                ArrayPrelim::default(),
            )
        });
        let start = col_order.len(&*txn);
        let values = new_col_ids.iter().map(|cid| {
            let hex = id_to_hex(cid.as_u128());
            Any::String(Arc::from(hex.as_str()))
        });
        col_order.insert_range(txn, start, values);

        Ok(())
    }

    pub(crate) fn materialize_dense_axes_and_remove_compact_keys(
        &mut self,
        txn: &mut yrs::TransactionMut<'_>,
        sheet_id: SheetId,
    ) -> Result<(), ComputeError> {
        let grid: &mut GridIndex = match &mut self.target {
            Target::ByMap { grid_indexes } => {
                grid_indexes
                    .get_mut(&sheet_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: sheet_id.to_uuid_string(),
                    })?
            }
            Target::Direct { grid } => grid,
        };

        let sheet_hex = id_to_hex(sheet_id.as_u128());
        let sheet_map = match self.sheets.get(&*txn, sheet_hex.as_str()) {
            Some(Out::YMap(m)) => m,
            _ => {
                return Err(ComputeError::SheetNotFound {
                    sheet_id: sheet_id.to_uuid_string(),
                });
            }
        };

        let row_order = get_row_order_array(&sheet_map, &*txn).unwrap_or_else(|| {
            sheet_map.insert(
                txn,
                compute_document::schema::KEY_ROW_ORDER,
                ArrayPrelim::default(),
            )
        });
        let existing_rows = row_order.len(&*txn);
        if existing_rows > 0 {
            row_order.remove_range(txn, 0, existing_rows);
        }
        let row_values = (0..grid.row_count()).filter_map(|idx| {
            grid.row_id_hex(idx)
                .map(|hex| Any::String(Arc::from(hex.as_str())))
        });
        row_order.insert_range(txn, 0, row_values);

        let col_order = get_col_order_array(&sheet_map, &*txn).unwrap_or_else(|| {
            sheet_map.insert(
                txn,
                compute_document::schema::KEY_COL_ORDER,
                ArrayPrelim::default(),
            )
        });
        let existing_cols = col_order.len(&*txn);
        if existing_cols > 0 {
            col_order.remove_range(txn, 0, existing_cols);
        }
        let col_values = (0..grid.col_count()).filter_map(|idx| {
            grid.col_id_hex(idx)
                .map(|hex| Any::String(Arc::from(hex.as_str())))
        });
        col_order.insert_range(txn, 0, col_values);

        if let Some(Out::YMap(grid_index)) =
            sheet_map.get(&*txn, compute_document::schema::KEY_GRID_INDEX)
        {
            grid_index.remove(txn, compute_document::schema::KEY_GRID_ROW_AXIS);
            grid_index.remove(txn, compute_document::schema::KEY_GRID_COL_AXIS);
        }
        Ok(())
    }
}
