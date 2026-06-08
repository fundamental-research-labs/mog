use std::collections::HashMap;

use cell_types::{CellId, SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::mirror::{CellEntry, CellMirror};
use crate::snapshot::{CellChange, CellPosition, RecalcResult};
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use compute_document::hex::id_to_hex;

use super::AdjustedFormulaResult;
use super::cell_mutations::mutation_set_cells_by_position_raw;

fn source_formula_at(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> (
    Option<formula_types::IdentityFormula>,
    Vec<compute_fill::formula_adjust::RefPosition>,
) {
    let pos = SheetPos::new(row, col);
    let cell_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| mirror.resolve_cell_id(sheet_id, pos));

    let formula = cell_id
        .and_then(|id| mirror.get_formula(&id).cloned())
        .or_else(|| {
            let formula_text =
                cell_id.and_then(|id| stores.compute.get_formula(&id).map(str::to_owned));
            formula_text.and_then(|text| {
                stores
                    .compute
                    .to_identity_formula(mirror, sheet_id, &text)
                    .ok()
            })
        });

    let ref_positions = formula
        .as_ref()
        .map(|id_formula| {
            id_formula
                .refs
                .iter()
                .map(|r| resolve_identity_ref_to_fill_position(mirror, sheet_id, r, row, col))
                .collect()
        })
        .unwrap_or_default();

    (formula, ref_positions)
}

fn source_format_at(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> domain_types::CellFormat {
    use crate::storage::properties;

    let pos = SheetPos::new(row, col);
    let cell_id = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| mirror.resolve_cell_id(sheet_id, pos));
    let table_fmt = super::super::tables::resolve_table_format_at_cell(mirror, sheet_id, row, col);

    if let Some(cell_id) = cell_id {
        let cell_hex = id_to_hex(cell_id.as_u128());
        properties::get_effective_format(
            &stores.storage,
            sheet_id,
            &cell_hex,
            row,
            col,
            table_fmt.as_ref(),
            stores.grid_indexes.get(sheet_id),
            mirror.get_sheet(sheet_id),
        )
    } else {
        properties::get_positional_format(
            &stores.storage,
            sheet_id,
            row,
            col,
            stores.grid_indexes.get(sheet_id),
            mirror.get_sheet(sheet_id),
        )
    }
}

// ---------------------------------------------------------------------------
// mutation_auto_fill
// ---------------------------------------------------------------------------

/// Gather source cell data, run the fill engine, and apply updates.
///
/// The `resolve_table_format_fn` callback resolves table format at a cell position.
/// The `set_cells_by_position_fn` callback applies cell edits through the standard mutation path.
pub(in crate::storage::engine) fn mutation_auto_fill(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeAutoFillRequest,
) -> Result<(RecalcResult, compute_fill::types::FillResultSummary), ComputeError> {
    use crate::storage::sheet::{dimensions, merges};
    use compute_fill::types::{
        FillInput, FillResultSummary, FillUpdate, LocaleNames, MergeRegion as FillMerge, SourceCell,
    };

    let fill_request = request.to_fill_request();
    let src = fill_request.source_range;

    // -- 1. Gather source cells --
    let mut source_cells: Vec<SourceCell> = Vec::new();

    for row in src.start_row..=src.end_row {
        for col in src.start_col..=src.end_col {
            let pos = SheetPos::new(row, col);

            let value = mirror
                .get_cell_value_at(sheet_id, pos)
                .cloned()
                .unwrap_or(CellValue::Null);

            let (formula, ref_positions) = source_formula_at(stores, mirror, sheet_id, row, col);

            let format = Some(source_format_at(stores, mirror, sheet_id, row, col));

            source_cells.push(SourceCell {
                row,
                col,
                value,
                formula,
                format,
                ref_positions,
            });
        }
    }

    // -- 2. Gather merges overlapping source+target area --
    let combined_start_row = src.start_row.min(fill_request.target_range.start_row);
    let combined_start_col = src.start_col.min(fill_request.target_range.start_col);
    let combined_end_row = src.end_row.max(fill_request.target_range.end_row);
    let combined_end_col = src.end_col.max(fill_request.target_range.end_col);

    let resolved_merges = match stores.grid_indexes.get(sheet_id) {
        Some(grid) => merges::get_merges_in_range(
            stores.storage.doc(),
            stores.storage.sheets(),
            *sheet_id,
            grid,
            combined_start_row,
            combined_start_col,
            combined_end_row,
            combined_end_col,
        ),
        None => Vec::new(),
    };
    let fill_merges: Vec<FillMerge> = resolved_merges
        .iter()
        .map(|m| FillMerge {
            start_row: m.start_row,
            start_col: m.start_col,
            end_row: m.end_row,
            end_col: m.end_col,
        })
        .collect();

    // -- 3. Gather hidden rows/cols --
    let hidden_rows_vec =
        dimensions::get_hidden_rows(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let hidden_cols_vec =
        dimensions::get_hidden_columns(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    let hidden_rows: std::collections::BTreeSet<u32> = hidden_rows_vec.into_iter().collect();
    let hidden_cols: std::collections::BTreeSet<u32> = hidden_cols_vec.into_iter().collect();

    // -- 4. Build fill input and compute --
    let fill_input = FillInput {
        request: fill_request,
        source_cells,
        merges: fill_merges,
        hidden_rows,
        hidden_cols,
        custom_lists: Vec::new(),
        locale: LocaleNames::default(),
    };

    let fill_result = compute_fill::engine::compute_fill(&fill_input);

    let changes: Vec<compute_fill::types::FillChangeSummary> = fill_result
        .updates
        .iter()
        .map(|u| {
            let (row, col, change_type) = match u {
                FillUpdate::Value { row, col, .. } => (*row, *col, "value"),
                FillUpdate::Formula { row, col, .. } => (*row, *col, "formula"),
                FillUpdate::Format { row, col, .. } => (*row, *col, "format"),
                FillUpdate::Clear { row, col } => (*row, *col, "clear"),
            };
            compute_fill::types::FillChangeSummary {
                row,
                col,
                change_type: change_type.to_string(),
            }
        })
        .collect();

    let summary = FillResultSummary {
        pattern_type: fill_result.detected_pattern.pattern_type.clone(),
        filled_cell_count: fill_result.filled_cell_count,
        warnings: fill_result.warnings.clone(),
        changes,
    };

    // -- 5. Apply fill updates to storage --
    let mut cell_edits: Vec<(SheetId, u32, u32, CellValue, Option<String>)> = Vec::new();
    let mut format_edits: Vec<(u32, u32, domain_types::CellFormat)> = Vec::new();

    mutation.observer.set_suppressed(true);

    for update in &fill_result.updates {
        match update {
            FillUpdate::Value { row, col, value } => {
                cell_edits.push((*sheet_id, *row, *col, value.clone(), None));
            }
            FillUpdate::Formula {
                row,
                col,
                source_formula,
                adjusted_refs,
            } => {
                let (new_formula, overrides) = match build_adjusted_formula(
                    stores,
                    mirror,
                    sheet_id,
                    source_formula,
                    adjusted_refs,
                ) {
                    Some(result) => result,
                    None => continue,
                };
                let lookup = AdjustedPositionLookup {
                    mirror,
                    formula_sheet: *sheet_id,
                    overrides,
                };
                let a1 = compute_parser::to_a1_string(&new_formula, &lookup);
                // `to_a1_string` prepends '='; body is what follows. An empty
                // body (len <= 1, just "=") means the formula rendered to nothing
                // — treat as a clear.
                let body = a1.strip_prefix('=').unwrap_or(&a1);
                if body.is_empty() {
                    cell_edits.push((*sheet_id, *row, *col, CellValue::Null, None));
                } else {
                    cell_edits.push((
                        *sheet_id,
                        *row,
                        *col,
                        CellValue::Null,
                        Some(body.to_string()),
                    ));
                }
            }
            FillUpdate::Format { row, col, format } => {
                format_edits.push((*row, *col, format.clone()));
            }
            FillUpdate::Clear { row, col } => {
                cell_edits.push((*sheet_id, *row, *col, CellValue::Null, None));
            }
        }
    }

    mutation.observer.set_suppressed(false);

    let mut recalc = if cell_edits.is_empty() {
        RecalcResult::empty()
    } else {
        mutation_set_cells_by_position_raw(stores, &mut *mirror, mutation, cell_edits, false)?
    };

    let mut format_changes: Vec<CellChange> = Vec::with_capacity(format_edits.len());
    mutation.observer.set_suppressed(true);
    for (row, col, format) in &format_edits {
        let Some(cell_id) = super::super::cell_editing::ensure_cell_id_mirrored(
            stores, mirror, sheet_id, *row, *col,
        ) else {
            continue;
        };
        let cell_hex = id_to_hex(cell_id.as_u128());
        crate::storage::properties::replace_cell_format(
            stores.storage.doc(),
            stores.storage.workbook_map(),
            stores.storage.sheets(),
            sheet_id,
            &cell_hex,
            format,
        );
        let value = mirror
            .get_cell_value_at(sheet_id, SheetPos::new(*row, *col))
            .cloned()
            .unwrap_or(CellValue::Null);
        format_changes.push(CellChange {
            cell_id: cell_id.to_uuid_string(),
            sheet_id: sheet_id.to_uuid_string(),
            position: Some(CellPosition {
                row: *row,
                col: *col,
            }),
            value,
            display_text: None,
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        });
    }
    mutation.observer.set_suppressed(false);

    for change in format_changes {
        let Some(position) = &change.position else {
            recalc.changed_cells.push(change);
            continue;
        };
        let already_changed = recalc.changed_cells.iter().any(|existing| {
            existing.sheet_id == change.sheet_id
                && existing.position.as_ref().is_some_and(|existing_pos| {
                    existing_pos.row == position.row && existing_pos.col == position.col
                })
        });
        if !already_changed {
            recalc.changed_cells.push(change);
        }
    }
    Ok((recalc, summary))
}

/// Flash fill mutation handler.
///
/// Reads source and target (example) values from the sheet, runs the flash fill
/// algorithm, and writes results back to storage.
pub fn mutation_flash_fill(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    sheet_id: &SheetId,
    request: crate::engine_types::fill::BridgeFlashFillRequest,
) -> Result<
    (
        RecalcResult,
        crate::engine_types::fill::BridgeFlashFillResult,
    ),
    ComputeError,
> {
    use compute_fill::flash_fill::{FlashFillInput, FlashFillResult as FFResult};

    let src = &request.source_range;
    let tgt = &request.target_range;

    // Source and target must span the same number of rows.
    let src_rows = src.end_row.saturating_sub(src.start_row) + 1;
    let tgt_rows = tgt.end_row.saturating_sub(tgt.start_row) + 1;
    let n = src_rows.min(tgt_rows) as usize;

    // Read source values (single column).
    let mut source_values = Vec::with_capacity(n);
    for row in src.start_row..src.start_row + n as u32 {
        let val = mirror
            .get_cell_value_at(sheet_id, SheetPos::new(row, src.start_col))
            .cloned()
            .unwrap_or(CellValue::Null);
        source_values.push(val);
    }

    // Read example values from target column.
    let mut example_values = Vec::with_capacity(n);
    for row in tgt.start_row..tgt.start_row + n as u32 {
        let val = mirror
            .get_cell_value_at(sheet_id, SheetPos::new(row, tgt.start_col))
            .cloned()
            .unwrap_or(CellValue::Null);
        example_values.push(val);
    }

    let input = FlashFillInput {
        source_values: source_values.clone(),
        example_values: example_values.clone(),
    };

    let result: FFResult = compute_fill::flash_fill::flash_fill(&input);

    let summary = crate::engine_types::fill::BridgeFlashFillResult {
        success: result.success,
        pattern_description: result.pattern_description,
        filled_cell_count: 0,
    };

    if !result.success {
        return Ok((RecalcResult::empty(), summary));
    }

    // Write back only cells that were Null in examples and are now filled.
    let mut cell_edits: Vec<(SheetId, u32, u32, CellValue, Option<String>)> = Vec::new();
    let mut filled_count: u32 = 0;

    for (i, example_value) in example_values.iter().enumerate().take(n) {
        if matches!(example_value, CellValue::Null) {
            let filled_val = &result.filled_values[i];
            if !matches!(filled_val, CellValue::Null) {
                let row = tgt.start_row + i as u32;
                cell_edits.push((*sheet_id, row, tgt.start_col, filled_val.clone(), None));
                filled_count += 1;
            }
        }
    }

    let summary = crate::engine_types::fill::BridgeFlashFillResult {
        success: true,
        pattern_description: summary.pattern_description,
        filled_cell_count: filled_count,
    };

    if cell_edits.is_empty() {
        return Ok((RecalcResult::empty(), summary));
    }

    mutation.observer.set_suppressed(true);
    let recalc = mutation_set_cells_by_position_raw(stores, mirror, mutation, cell_edits, false)?;
    mutation.observer.set_suppressed(false);

    Ok((recalc, summary))
}

/// Resolve an `IdentityFormulaRef` to a [`compute_fill::formula_adjust::RefPosition`].
///
/// Uses `CellMirror::resolve_position` (global cross-sheet lookup) instead of
/// looking up on a single sheet. This correctly handles cross-sheet formula
/// references — a formula on Sheet A that references a cell on Sheet B will
/// resolve the CellId to its actual position on Sheet B, not default to (0, 0).
///
/// When a CellId cannot be resolved at all (orphaned, mirror out of sync),
/// falls back to the source cell's own position. This keeps the ref fixed
/// (same as absolute behaviour) rather than silently using (0, 0) which
/// would produce wildly wrong adjustments.
pub(super) fn resolve_identity_ref_to_fill_position(
    mirror: &CellMirror,
    _sheet_id: &SheetId,
    r: &formula_types::IdentityFormulaRef,
    source_row: u32,
    source_col: u32,
) -> compute_fill::formula_adjust::RefPosition {
    use compute_fill::formula_adjust::RefPosition;
    use formula_types::IdentityFormulaRef;
    match r {
        IdentityFormulaRef::Cell(cell_ref) => {
            let (row, col) = mirror
                .resolve_position(&cell_ref.id)
                .map(|p| (p.row(), p.col()))
                .unwrap_or((source_row, source_col));
            RefPosition::Cell { row, col }
        }
        IdentityFormulaRef::Range(range_ref) => {
            let (start_row, start_col) = mirror
                .resolve_position(&range_ref.start_id)
                .map(|p| (p.row(), p.col()))
                .unwrap_or((source_row, source_col));
            let (end_row, end_col) = mirror
                .resolve_position(&range_ref.end_id)
                .map(|p| (p.row(), p.col()))
                .unwrap_or((source_row, source_col));
            RefPosition::Range {
                start_row,
                start_col,
                end_row,
                end_col,
            }
        }
        IdentityFormulaRef::RectRange(rect_ref) => {
            let start_row = mirror
                .row_index_lookup(&rect_ref.start_row_id)
                .map(|(_, row)| row)
                .unwrap_or(source_row);
            let start_col = mirror
                .col_index_lookup(&rect_ref.start_col_id)
                .map(|(_, col)| col)
                .unwrap_or(source_col);
            let end_row = mirror
                .row_index_lookup(&rect_ref.end_row_id)
                .map(|(_, row)| row)
                .unwrap_or(start_row);
            let end_col = mirror
                .col_index_lookup(&rect_ref.end_col_id)
                .map(|(_, col)| col)
                .unwrap_or(start_col);
            RefPosition::Range {
                start_row,
                start_col,
                end_row,
                end_col,
            }
        }
        IdentityFormulaRef::FullRow(row_ref) => {
            let _ = row_ref;
            RefPosition::FullRow { row: 0 }
        }
        IdentityFormulaRef::RowRange(rr) => {
            let _ = rr;
            RefPosition::RowRange {
                start_row: 0,
                end_row: 0,
            }
        }
        IdentityFormulaRef::FullCol(col_ref) => {
            let _ = col_ref;
            RefPosition::FullCol { col: 0 }
        }
        IdentityFormulaRef::ColRange(cr) => {
            let _ = cr;
            RefPosition::ColRange {
                start_col: 0,
                end_col: 0,
            }
        }
        IdentityFormulaRef::ExternalCell(_)
        | IdentityFormulaRef::ExternalRange(_)
        | IdentityFormulaRef::ExternalName(_) => RefPosition::Cell {
            row: source_row,
            col: source_col,
        },
    }
}

/// Build a new `IdentityFormula` with adjusted refs from fill results.
pub(super) fn build_adjusted_formula(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    source: &formula_types::IdentityFormula,
    adjusted_refs: &[compute_fill::types::AdjustedRef],
) -> AdjustedFormulaResult {
    use formula_types::{
        IdentityCellRef, IdentityFormulaRef, IdentityRangeRef, IdentityRectRangeRef,
    };

    let mut new_refs = Vec::with_capacity(source.refs.len());
    let mut overrides: HashMap<CellId, (SheetId, u32, u32)> = HashMap::new();

    for (i, src_ref) in source.refs.iter().enumerate() {
        let adj = adjusted_refs.iter().find(|a| a.ref_index == i);
        match adj {
            Some(adj) if !adj.out_of_bounds => match src_ref {
                IdentityFormulaRef::Cell(cell_ref) => {
                    // Resolve which sheet the original ref pointed to (may differ
                    // from the fill operation's sheet for cross-sheet references).
                    let ref_sheet = mirror.sheet_for_cell(&cell_ref.id).unwrap_or(*sheet_id);
                    let pos = SheetPos::new(adj.target_row, adj.target_col);
                    let existing = mirror
                        .get_sheet(&ref_sheet)
                        .and_then(|sm| sm.cell_id_at(pos));
                    let cell_id = match existing {
                        Some(id) => id,
                        None => {
                            let new_id = stores.grid_id_alloc.next_cell_id();
                            if let Some(grid) = stores.grid_indexes.get_mut(&ref_sheet) {
                                grid.register_cell(new_id, adj.target_row, adj.target_col);
                            }
                            mirror.insert_cell(
                                &ref_sheet,
                                new_id,
                                pos,
                                CellEntry {
                                    value: CellValue::Null,
                                    formula: None,
                                },
                            );
                            overrides.insert(new_id, (ref_sheet, adj.target_row, adj.target_col));
                            new_id
                        }
                    };
                    new_refs.push(IdentityFormulaRef::Cell(IdentityCellRef {
                        id: cell_id,
                        row_absolute: cell_ref.row_absolute,
                        col_absolute: cell_ref.col_absolute,
                    }));
                }
                IdentityFormulaRef::Range(range_ref) => {
                    // Use the start ref's sheet for the entire range.
                    let ref_sheet = mirror
                        .sheet_for_cell(&range_ref.start_id)
                        .unwrap_or(*sheet_id);
                    let start_pos = SheetPos::new(adj.target_row, adj.target_col);
                    let existing_start = mirror
                        .get_sheet(&ref_sheet)
                        .and_then(|sm| sm.cell_id_at(start_pos));
                    let start_id = match existing_start {
                        Some(id) => id,
                        None => {
                            let new_id = stores.grid_id_alloc.next_cell_id();
                            if let Some(grid) = stores.grid_indexes.get_mut(&ref_sheet) {
                                grid.register_cell(new_id, adj.target_row, adj.target_col);
                            }
                            mirror.insert_cell(
                                &ref_sheet,
                                new_id,
                                start_pos,
                                CellEntry {
                                    value: CellValue::Null,
                                    formula: None,
                                },
                            );
                            overrides.insert(new_id, (ref_sheet, adj.target_row, adj.target_col));
                            new_id
                        }
                    };

                    let end_row = adj.target_end_row.unwrap_or(adj.target_row);
                    let end_col = adj.target_end_col.unwrap_or(adj.target_col);
                    let end_pos = SheetPos::new(end_row, end_col);
                    let existing_end = mirror
                        .get_sheet(&ref_sheet)
                        .and_then(|sm| sm.cell_id_at(end_pos));
                    let end_id = match existing_end {
                        Some(id) => id,
                        None => {
                            let new_id = stores.grid_id_alloc.next_cell_id();
                            if let Some(grid) = stores.grid_indexes.get_mut(&ref_sheet) {
                                grid.register_cell(new_id, end_row, end_col);
                            }
                            mirror.insert_cell(
                                &ref_sheet,
                                new_id,
                                end_pos,
                                CellEntry {
                                    value: CellValue::Null,
                                    formula: None,
                                },
                            );
                            overrides.insert(new_id, (ref_sheet, end_row, end_col));
                            new_id
                        }
                    };

                    new_refs.push(IdentityFormulaRef::Range(IdentityRangeRef {
                        start_id,
                        end_id,
                        start_row_absolute: range_ref.start_row_absolute,
                        start_col_absolute: range_ref.start_col_absolute,
                        end_row_absolute: range_ref.end_row_absolute,
                        end_col_absolute: range_ref.end_col_absolute,
                    }));
                }
                IdentityFormulaRef::RectRange(rect_ref) => {
                    let end_row = adj.target_end_row.unwrap_or(adj.target_row);
                    let end_col = adj.target_end_col.unwrap_or(adj.target_col);
                    let (
                        Some(start_row_id),
                        Some(start_col_id),
                        Some(end_row_id),
                        Some(end_col_id),
                    ) = (
                        mirror.row_id_lookup(&rect_ref.sheet_id, adj.target_row),
                        mirror.col_id_lookup(&rect_ref.sheet_id, adj.target_col),
                        mirror.row_id_lookup(&rect_ref.sheet_id, end_row),
                        mirror.col_id_lookup(&rect_ref.sheet_id, end_col),
                    )
                    else {
                        new_refs.push(src_ref.clone());
                        continue;
                    };
                    new_refs.push(IdentityFormulaRef::RectRange(IdentityRectRangeRef {
                        sheet_id: rect_ref.sheet_id,
                        start_row_id,
                        start_col_id,
                        end_row_id,
                        end_col_id,
                        start_row_absolute: rect_ref.start_row_absolute,
                        start_col_absolute: rect_ref.start_col_absolute,
                        end_row_absolute: rect_ref.end_row_absolute,
                        end_col_absolute: rect_ref.end_col_absolute,
                    }));
                }
                other => new_refs.push(other.clone()),
            },
            _ => new_refs.push(src_ref.clone()),
        }
    }

    Some((
        formula_types::IdentityFormula {
            template: source.template.clone(),
            refs: new_refs,
            is_dynamic_array: source.is_dynamic_array,
            is_volatile: source.is_volatile,
            // Fill-down preserves formula shape — a SUBTOTAL/AGGREGATE call
            // remains a SUBTOTAL/AGGREGATE call. Propagate the flag from
            // the source formula.
            is_aggregate: source.is_aggregate,
        },
        overrides,
    ))
}

// ---------------------------------------------------------------------------
// AdjustedPositionLookup — layers override positions on top of the mirror
// ---------------------------------------------------------------------------

/// Lightweight [`WorkbookLookup`] that resolves freshly-allocated CellIds
/// (not yet registered in the mirror) via an overrides map, falling back to
/// the mirror for all existing cells.
pub(super) struct AdjustedPositionLookup<'a> {
    pub(super) mirror: &'a CellMirror,
    pub(super) formula_sheet: SheetId,
    pub(super) overrides: HashMap<CellId, (SheetId, u32, u32)>,
}

impl<'a> formula_types::WorkbookLookup for AdjustedPositionLookup<'a> {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        if let Some(pos) = self.overrides.get(cell_id) {
            return Some(*pos);
        }
        let sheet_id = self.mirror.sheet_for_cell(cell_id)?;
        let pos = self.mirror.resolve_position(cell_id)?;
        Some((sheet_id, pos.row(), pos.col()))
    }
    fn row_index(&self, row_id: &cell_types::RowId) -> Option<(SheetId, u32)> {
        self.mirror.row_index_lookup(row_id)
    }
    fn col_index(&self, col_id: &cell_types::ColId) -> Option<(SheetId, u32)> {
        self.mirror.col_index_lookup(col_id)
    }
    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        self.mirror.get_sheet(sheet_id).map(|s| s.name.as_str())
    }
    fn formula_sheet(&self) -> SheetId {
        self.formula_sheet
    }
}
