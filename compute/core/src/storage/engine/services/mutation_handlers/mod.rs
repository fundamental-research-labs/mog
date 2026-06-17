//! Mutation handler implementations extracted as free functions.
//!
//! These functions implement the `mutation_*` methods that were previously
//! on `YrsComputeEngine`. Each takes explicit references to the stores,
//! mirror, and mutation coordinator it needs.

use std::collections::HashMap;

use cell_types::{CellId, SheetId};

use crate::snapshot::ChangeKind;
use crate::storage::engine::stores::EngineStores;
use compute_document::observe::CellChangeKind;

mod cell_mutations;
mod fill;
mod fill_preview;
mod find_replace;
mod named_ranges;
mod range_operations;
mod result_building;
mod sheet_mutations;

pub(in crate::storage::engine) use cell_mutations::*;
pub(in crate::storage::engine) use fill::*;
pub(in crate::storage::engine) use find_replace::*;
pub(in crate::storage::engine) use named_ranges::*;
pub(in crate::storage::engine) use range_operations::*;
pub(in crate::storage::engine) use result_building::*;
pub(in crate::storage::engine) use sheet_mutations::*;

/// Result of building an adjusted formula: the new identity formula plus cell-id overrides.
type AdjustedFormulaResult = Option<(
    formula_types::IdentityFormula,
    HashMap<CellId, (SheetId, u32, u32)>,
)>;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Convert an observer `CellChangeKind` to a snapshot `ChangeKind`.
fn observer_kind_to_change_kind(kind: CellChangeKind) -> ChangeKind {
    match kind {
        CellChangeKind::Modified => ChangeKind::Set,
        CellChangeKind::Removed => ChangeKind::Removed,
    }
}

/// Collect all CellIds in the given range using the sparse grid index.
/// Falls back to position-by-position lookup when no grid index exists.
pub(in crate::storage::engine) fn collect_cell_ids_in_range(
    stores: &EngineStores,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Vec<CellId> {
    if let Some(grid) = stores.grid_indexes.get(sheet_id) {
        grid.cells_in_range(start_row, start_col, end_row, end_col)
            .map(|(cell_id, _, _)| cell_id)
            .collect()
    } else {
        let mut ids = Vec::new();
        for row in start_row..=end_row {
            for col in start_col..=end_col {
                if let Some(cell_id) =
                    super::cell_editing::find_cell_id_at(stores, sheet_id, row, col)
                {
                    ids.push(cell_id);
                }
            }
        }
        ids
    }
}

/// Resolve a RowId hex to its current row index.
fn resolve_row_id_to_index(stores: &EngineStores, sheet_id: &SheetId, row_id: &str) -> Option<u32> {
    super::mutation::resolve_hex_id_to_position(stores, sheet_id, row_id, true)
}

/// Resolve a ColId hex to its current column index.
fn resolve_col_id_to_index(stores: &EngineStores, sheet_id: &SheetId, col_id: &str) -> Option<u32> {
    super::mutation::resolve_hex_id_to_position(stores, sheet_id, col_id, false)
}
