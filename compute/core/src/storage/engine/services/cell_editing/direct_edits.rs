use cell_types::{CellId, SheetId};
use value_types::ComputeError;

use crate::mirror::CellMirror;
use crate::snapshot::RecalcResult;
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

use super::super::mutation_handlers::{mutation_set_cells, mutation_set_cells_by_position};

pub(in crate::storage::engine) fn set_cell_value_parsed(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    raw_input: &str,
) -> Result<RecalcResult, ComputeError> {
    let input = if raw_input.trim().is_empty() {
        CellInput::Clear
    } else {
        CellInput::Parse {
            text: raw_input.to_owned(),
        }
    };
    mutation_set_cells_by_position(stores, mirror, vec![(*sheet_id, row, col, input)], false)
}

/// Force text after stripping the optional Excel apostrophe prefix.
/// Empty input clears the cell; an explicit Literal("") retains empty text.
pub(in crate::storage::engine) fn set_cell_value_as_text(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
) -> Result<RecalcResult, ComputeError> {
    let input = if value.is_empty() {
        CellInput::Clear
    } else {
        CellInput::Literal {
            text: value.strip_prefix('\'').unwrap_or(value).to_owned(),
        }
    };
    mutation_set_cells_by_position(stores, mirror, vec![(*sheet_id, row, col, input)], false)
}

pub(in crate::storage::engine) fn set_cell(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    input: &CellInput,
) -> Result<RecalcResult, ComputeError> {
    mutation_set_cells(
        stores,
        mirror,
        vec![(*sheet_id, cell_id, row, col, input.clone())],
        false,
    )
}
