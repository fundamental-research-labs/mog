use crate::snapshot::{CellEdit, MutationResult};
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::mutation::{EngineMutation, MutationOutput};
use crate::storage::engine::{mutation, services};
use cell_types::{CellId, SheetId};
use compute_formats;
use value_types::ComputeError;

pub(in crate::storage::engine) fn batch_set_cells(
    engine: &mut ComputeEngine,
    edits: Vec<(SheetId, CellId, u32, u32, mutation::CellInput)>,
    skip_cycle_check: bool,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::SetCells {
        edits,
        skip_cycle_check,
    })? {
        mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn batch_clear_cells(
    engine: &mut ComputeEngine,
    cell_ids: Vec<CellId>,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::ClearCells { cell_ids })? {
        mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn batch_set_cells_by_position(
    engine: &mut ComputeEngine,
    edits: Vec<(SheetId, u32, u32, mutation::CellInput)>,
    skip_cycle_check: bool,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::SetCellsByPosition {
        edits,
        skip_cycle_check,
    })? {
        mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn set_cells_batch(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    cells: Vec<crate::snapshot::BatchCellInput>,
) -> Result<crate::snapshot::SetCellsBatchResult, ComputeError> {
    use std::collections::HashMap;

    if cells.is_empty() {
        return Ok(crate::snapshot::SetCellsBatchResult {
            cells_written: 0,
            duplicates_removed: 0,
        });
    }

    use mutation::CellInput;
    let mut edits: Vec<(u32, u32, CellInput)> = Vec::with_capacity(cells.len());
    for cell in &cells {
        let (row, col) = if let Some(ref addr) = cell.addr {
            let parsed =
                crate::range_manager::parse_cell(addr).ok_or_else(|| ComputeError::Eval {
                    message: format!("Invalid cell address: {}", addr),
                })?;
            (parsed.row, parsed.col)
        } else {
            match (cell.row, cell.col) {
                (Some(r), Some(c)) => (r, c),
                _ => {
                    return Err(ComputeError::Eval {
                        message: "Cell must have either addr or both row and col".to_string(),
                    });
                }
            }
        };

        let input = match &cell.value {
            None => CellInput::Clear,
            Some(v) if v.is_empty() => CellInput::Literal {
                text: String::new(),
            },
            Some(v) => CellInput::Parse { text: v.clone() },
        };

        edits.push((row, col, input));
    }

    let original_count = edits.len();
    let mut deduped: HashMap<(u32, u32), CellInput> = HashMap::with_capacity(original_count);
    for (row, col, input) in edits {
        deduped.insert((row, col), input);
    }
    let duplicates_removed = (original_count - deduped.len()) as u32;

    let mutation_edits: Vec<(SheetId, u32, u32, CellInput)> = deduped
        .into_iter()
        .map(|((row, col), input)| (*sheet_id, row, col, input))
        .collect();
    let cells_written = mutation_edits.len() as u32;

    engine.apply_mutation(EngineMutation::SetCellsByPosition {
        edits: mutation_edits,
        skip_cycle_check: true,
    })?;

    Ok(crate::snapshot::SetCellsBatchResult {
        cells_written,
        duplicates_removed,
    })
}

pub(in crate::storage::engine) fn set_date_value(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    year: i32,
    month: u32,
    day: u32,
) -> Result<MutationResult, ComputeError> {
    let existing_format = {
        let cell_id =
            services::cell_editing::find_cell_id_at(&engine.cell_store, sheet_id, row, col);
        cell_id.and_then(|cid| {
            let table_fmt =
                services::resolve_structured_format_at_cell(&engine.cell_store, sheet_id, row, col);
            let fmt = crate::storage::properties::get_effective_format_by_id(
                &engine.stores.storage,
                sheet_id,
                Some(&cid),
                row,
                col,
                table_fmt.as_ref(),
                engine.stores.grid_indexes.get(sheet_id),
                engine.cell_store.get_sheet(sheet_id),
            );
            fmt.number_format
        })
    };

    let result = compute_formats::prepare_date_value(year, month, day, existing_format.as_deref());

    let mutation_result = {
        let edits = vec![(
            *sheet_id,
            row,
            col,
            mutation::CellInput::Parse {
                text: result.serial.to_string(),
            },
        )];
        let output = engine.apply_mutation(EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check: true,
        })?;

        if let Some(ref fmt_code) = result.format_to_apply {
            let ranges = vec![(row, col, row, col)];
            let format = domain_types::CellFormat {
                number_format: Some(fmt_code.clone()),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                &ranges,
                &format,
            )?;
        }

        match output {
            MutationOutput::Recalc(r)
            | MutationOutput::SheetId(_, r)
            | MutationOutput::Plain(r) => r,
        }
    };
    Ok(mutation_result)
}

pub(in crate::storage::engine) fn set_time_value(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    hours: u32,
    minutes: u32,
    seconds: u32,
) -> Result<MutationResult, ComputeError> {
    let existing_format = {
        let cell_id =
            services::cell_editing::find_cell_id_at(&engine.cell_store, sheet_id, row, col);
        cell_id.and_then(|cid| {
            let table_fmt =
                services::resolve_structured_format_at_cell(&engine.cell_store, sheet_id, row, col);
            let fmt = crate::storage::properties::get_effective_format_by_id(
                &engine.stores.storage,
                sheet_id,
                Some(&cid),
                row,
                col,
                table_fmt.as_ref(),
                engine.stores.grid_indexes.get(sheet_id),
                engine.cell_store.get_sheet(sheet_id),
            );
            fmt.number_format
        })
    };

    let result =
        compute_formats::prepare_time_value(hours, minutes, seconds, existing_format.as_deref());

    let mutation_result = {
        let edits = vec![(
            *sheet_id,
            row,
            col,
            mutation::CellInput::Parse {
                text: result.serial.to_string(),
            },
        )];
        let output = engine.apply_mutation(EngineMutation::SetCellsByPosition {
            edits,
            skip_cycle_check: true,
        })?;

        if let Some(ref fmt_code) = result.format_to_apply {
            let ranges = vec![(row, col, row, col)];
            let format = domain_types::CellFormat {
                number_format: Some(fmt_code.clone()),
                ..Default::default()
            };
            services::formatting::set_format_for_ranges(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                &ranges,
                &format,
            )?;
        }

        match output {
            MutationOutput::Recalc(r)
            | MutationOutput::SheetId(_, r)
            | MutationOutput::Plain(r) => r,
        }
    };
    Ok(mutation_result)
}

pub(in crate::storage::engine) fn clear_range_by_position(
    engine: &mut ComputeEngine,
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(mutation::EngineMutation::ClearRangeByPosition {
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
    })? {
        mutation::MutationOutput::Recalc(r) => Ok(r),
        _ => Ok(MutationResult::empty()),
    }
}

pub(in crate::storage::engine) fn apply_changes(
    engine: &mut ComputeEngine,
    changes: Vec<CellEdit>,
    skip_cycle_check: bool,
) -> Result<MutationResult, ComputeError> {
    for edit in &changes {
        if let (Ok(sheet), Ok(cell)) = (
            SheetId::from_uuid_str(&edit.sheet_id),
            CellId::from_uuid_str(&edit.cell_id),
        ) {
            crate::storage::engine::history::cells::capture_cell(
                &engine.stores,
                &engine.cell_store,
                sheet,
                cell,
                edit.row,
                edit.col,
            );
        }
    }
    let mut recalc =
        engine
            .stores
            .compute
            .apply_changes(&mut engine.cell_store, &changes, skip_cycle_check)?;
    engine.postprocess_mutation_recalc(&mut recalc);

    Ok(MutationResult::from_recalc(recalc))
}
