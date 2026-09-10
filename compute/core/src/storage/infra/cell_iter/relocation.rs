use std::collections::HashSet;

use crate::cells::CellStore;
use crate::storage::WorkbookStorage;

use super::clear::clear_range_and_return_ids;
use super::types::RelocationResult;
use cell_types::{CellId, RangePos, SheetId, SheetPos};

fn parse_local_a1_bounds(value: &str) -> Option<(u32, u32, u32, u32)> {
    if value.contains('!') {
        return None;
    }
    let range = compute_parser::parse_a1_range(value)?;
    let formula_types::CellRef::Positional {
        row: sr, col: sc, ..
    } = range.start
    else {
        return None;
    };
    let formula_types::CellRef::Positional {
        row: er, col: ec, ..
    } = range.end
    else {
        return None;
    };
    Some((sr, sc, er, ec))
}

fn translate_complete_range(
    value: &str,
    bounds: (u32, u32, u32, u32),
    row: u32,
    col: u32,
) -> Option<String> {
    if parse_local_a1_bounds(value)? != bounds {
        return None;
    }
    let end = SheetPos::new(
        row.checked_add(bounds.2.checked_sub(bounds.0)?)?,
        col.checked_add(bounds.3.checked_sub(bounds.1)?)?,
    );
    Some(format!("{}:{end}", SheetPos::new(row, col)))
}

/// Only complete shared/array families can retain executable geometry after a move.
fn sanitize_moved_formula_metadata(
    metadata: &mut crate::storage::CellMetadata,
    bounds: (u32, u32, u32, u32),
    row: u32,
    col: u32,
    shared: &HashSet<u32>,
) {
    use ooxml_types::worksheet::CellFormulaType;
    let array = metadata
        .array_ref
        .as_deref()
        .and_then(|value| translate_complete_range(value, bounds, row, col));
    let stale_array = metadata.array_ref.is_some() && array.is_none();
    let mut remove = false;
    if let Some(formula) = metadata.formula.as_mut() {
        match formula.t {
            CellFormulaType::Normal => {}
            CellFormulaType::DataTable => remove = true,
            CellFormulaType::Shared | CellFormulaType::Array => {
                let translated = formula
                    .r#ref
                    .as_deref()
                    .and_then(|value| translate_complete_range(value, bounds, row, col));
                if formula.t == CellFormulaType::Shared
                    && formula.r#ref.is_none()
                    && formula.si.is_some_and(|si| shared.contains(&si))
                {
                    // A complete matching anchor moved with this follower.
                } else if translated.is_some()
                    && !(formula.t == CellFormulaType::Array && stale_array)
                {
                    formula.r#ref = translated;
                } else {
                    remove = true;
                }
            }
        }
    }
    if remove {
        metadata.formula = None;
    }
    metadata.array_ref = if remove { None } else { array };
}

/// Transfer metadata for a relocation and report the source/target identities.
/// The compute caller moves values and identity bindings together after clearing targets.
#[allow(clippy::too_many_arguments)]
pub fn relocate_cells(
    storage: &mut WorkbookStorage,
    source_sheet: SheetId,
    source_range: &RangePos,
    target_sheet: SheetId,
    target_start_row: u32,
    target_start_col: u32,
    cells: &CellStore,
) -> RelocationResult {
    let same_sheet = source_sheet == target_sheet;
    // --- 1. Snapshot source cells (CellId + original position) ---
    let source_cells: Vec<(CellId, u32, u32)> = cells
        .cells_in_range(
            &source_sheet,
            source_range.start_row(),
            source_range.start_col(),
            source_range.end_row(),
            source_range.end_col(),
        )
        .collect();

    if source_cells.is_empty() {
        return RelocationResult {
            moved_cell_ids: vec![],
            source_positions_vacated: vec![],
            target_cells_cleared: vec![],
            success: true,
            error: None,
        };
    }

    // --- 2. Calculate deltas ---
    let row_delta = target_start_row as i64 - source_range.start_row() as i64;
    let col_delta = target_start_col as i64 - source_range.start_col() as i64;

    // --- 3. Build set of moving CellIds for exclude ---
    let moving_ids: HashSet<CellId> = source_cells.iter().map(|(id, _, _)| *id).collect();

    // --- 4. Clear target range (excluding cells being moved) ---
    let target_range = RangePos::new(
        target_sheet,
        target_start_row,
        target_start_col,
        (source_range.end_row() as i64 + row_delta) as u32,
        (source_range.end_col() as i64 + col_delta) as u32,
    );

    let cleared = clear_range_and_return_ids(
        storage,
        target_sheet,
        cells,
        &target_range,
        Some(&moving_ids),
    );

    let bounds = (
        source_range.start_row(),
        source_range.start_col(),
        source_range.end_row(),
        source_range.end_col(),
    );
    let complete_shared: HashSet<u32> = source_cells
        .iter()
        .filter_map(|(id, _, _)| {
            let formula = storage.cell_metadata(id)?.formula.as_ref()?;
            (formula.t == ooxml_types::worksheet::CellFormulaType::Shared
                && formula.r#ref.as_deref().and_then(parse_local_a1_bounds) == Some(bounds))
            .then_some(formula.si)
            .flatten()
        })
        .collect();
    for (id, _, _) in &source_cells {
        if let Some(mut metadata) = storage.cell_metadata(id).cloned() {
            sanitize_moved_formula_metadata(
                &mut metadata,
                bounds,
                target_start_row,
                target_start_col,
                &complete_shared,
            );
            storage.set_cell_metadata(*id, metadata);
        }
    }

    // --- 5. Apply moves ---
    // Move properties with the identity across worksheets.
    if !same_sheet {
        if storage.history.is_active() {
            for &(id, _, _) in &source_cells {
                crate::storage::engine::history::metadata::capture_cell_properties(
                    storage,
                    source_sheet,
                    id,
                );
                crate::storage::engine::history::metadata::capture_cell_properties(
                    storage,
                    target_sheet,
                    id,
                );
            }
        }
        crate::storage::engine::history::metadata::capture_sheet_field!(
            storage,
            source_sheet,
            hyperlinks
        );
        crate::storage::engine::history::metadata::capture_sheet_field!(
            storage,
            target_sheet,
            hyperlinks
        );
        let mut links = Vec::new();
        if let Some(sheet) = storage.sheet_metadata.get_mut(&source_sheet) {
            sheet.hyperlinks = std::mem::take(&mut sheet.hyperlinks)
                .into_iter()
                .filter_map(|link| {
                    let start_moves = moving_ids.contains(&link.start_id);
                    let end_moves = link.end_id.is_none_or(|id| moving_ids.contains(&id));
                    if start_moves && end_moves {
                        links.push(link);
                        None
                    } else if start_moves || link.end_id.is_some_and(|id| moving_ids.contains(&id))
                    {
                        None
                    } else {
                        Some(link)
                    }
                })
                .collect();
        }
        if let Some(sheet) = storage.sheet_metadata.get_mut(&target_sheet) {
            sheet.hyperlinks.extend(links);
        }
        let properties: Vec<_> = storage
            .sheet_metadata
            .get_mut(&source_sheet)
            .into_iter()
            .flat_map(|sheet| {
                source_cells
                    .iter()
                    .filter_map(|(id, _, _)| {
                        sheet.cell_properties.remove(id).map(|props| (*id, props))
                    })
                    .collect::<Vec<_>>()
            })
            .collect();
        if let Some(sheet) = storage.sheet_metadata.get_mut(&target_sheet) {
            sheet.cell_properties.extend(properties);
        }
    }

    let moved_ids: Vec<CellId> = source_cells.iter().map(|(id, _, _)| *id).collect();
    let source_positions_vacated: Vec<(u32, u32)> =
        source_cells.iter().map(|(_, r, c)| (*r, *c)).collect();

    RelocationResult {
        moved_cell_ids: moved_ids,
        source_positions_vacated,
        target_cells_cleared: cleared,
        success: true,
        error: None,
    }
}
