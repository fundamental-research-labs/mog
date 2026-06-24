use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::{CellValue, ComputeError};

use crate::mirror::CellMirror;
use crate::snapshot::{CellChange, CellPosition, RecalcResult};
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;

use super::super::cell_mutations::mutation_set_cells_by_position_raw;
use super::super::fill::{
    AdjustedPositionLookup, build_adjusted_formula, resolve_identity_ref_to_fill_position,
};
use super::formula_rebase::build_cross_sheet_adjusted_formula;

fn source_format_at(
    stores: &EngineStores,
    mirror: &CellMirror,
    source_sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> domain_types::CellFormat {
    use crate::storage::properties;

    let pos = SheetPos::new(row, col);
    let cell_id = stores
        .grid_indexes
        .get(source_sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
        .or_else(|| mirror.resolve_cell_id(source_sheet_id, pos));
    let table_fmt =
        super::super::super::resolve_structured_format_at_cell(mirror, source_sheet_id, row, col);

    if let Some(cell_id) = cell_id {
        let cell_hex = id_to_hex(cell_id.as_u128());
        properties::get_effective_format(
            &stores.storage,
            source_sheet_id,
            &cell_hex,
            row,
            col,
            table_fmt.as_ref(),
            stores.grid_indexes.get(source_sheet_id),
            mirror.get_sheet(source_sheet_id),
        )
    } else {
        properties::get_positional_format(
            &stores.storage,
            source_sheet_id,
            row,
            col,
            stores.grid_indexes.get(source_sheet_id),
            mirror.get_sheet(source_sheet_id),
        )
    }
}

// ---------------------------------------------------------------------------
// mutation_copy_range
// ---------------------------------------------------------------------------

/// Copy cells from source range to target position with full 5-store sync.
///
/// Unlike `mutation_relocate_cells`, the source range is preserved.
/// Supports:
/// - `CopyType::All` — values + formulas + formats
/// - `CopyType::Values` — computed values only (no formulas)
/// - `CopyType::Formulas` — formulas with reference adjustment, values for non-formula cells
/// - `CopyType::Formats` — formats only, preserve target values
/// - `skip_blanks` — skip source cells that are blank
/// - `transpose` — swap row/col offsets
///
/// Cross-sheet copy uses [`build_cross_sheet_adjusted_formula`] for the
/// formula rebind so naked refs follow the cell to the new sheet (Excel
/// behavior); same-sheet copy stays on the direct `build_adjusted_formula`
/// path.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_copy_range(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation: &mut MutationCoordinator,
    source_sheet_id: &SheetId,
    src_start_row: u32,
    src_start_col: u32,
    src_end_row: u32,
    src_end_col: u32,
    target_sheet_id: &SheetId,
    target_row: u32,
    target_col: u32,
    copy_type: domain_types::CopyType,
    skip_blanks: bool,
    transpose: bool,
) -> Result<RecalcResult, ComputeError> {
    use crate::storage::properties;
    use domain_types::CopyType;

    // Range guard: reject if the destination sheet is Range-backed.
    if mirror
        .get_sheet(target_sheet_id)
        .is_some_and(|s| !s.range_views_is_empty())
    {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: target_sheet_id.to_uuid_string(),
            operation: "copy_range".to_string(),
        });
    }

    // ── Pass 1: Collect all source data (immutable borrows only) ──
    // This avoids borrow conflicts when we later need &mut mirror for
    // build_adjusted_formula in pass 2.

    struct SourceCellData {
        src_row: u32,
        src_col: u32,
        tgt_row: u32,
        tgt_col: u32,
        value: CellValue,
        formula: Option<formula_types::IdentityFormula>,
        formula_text: Option<String>,
        ref_positions: Vec<compute_fill::formula_adjust::RefPosition>,
        format: Option<domain_types::CellFormat>,
    }

    let mut source_data: Vec<SourceCellData> = Vec::new();

    {
        let sheet_mirror = mirror.get_sheet(source_sheet_id);

        for src_row in src_start_row..=src_end_row {
            for src_col in src_start_col..=src_end_col {
                let row_offset = src_row - src_start_row;
                let col_offset = src_col - src_start_col;

                // Apply transpose: swap row/col offsets
                let (tgt_row, tgt_col) = if transpose {
                    (target_row + col_offset, target_col + row_offset)
                } else {
                    (target_row + row_offset, target_col + col_offset)
                };

                let pos = SheetPos::new(src_row, src_col);

                // Read source value
                let value = mirror
                    .get_cell_value_at(source_sheet_id, pos)
                    .cloned()
                    .unwrap_or(CellValue::Null);

                // Read source formula (identity formula for ref adjustment)
                let (formula, formula_text, ref_positions) = if let Some(sm) = sheet_mirror {
                    if let Some(cell_id) = sm.cell_id_at(pos) {
                        if let Some(entry) = sm.get_cell(&cell_id) {
                            if let Some(ref id_formula) = entry.formula {
                                let formula_text =
                                    stores.compute.get_formula(&cell_id).map(str::to_string);
                                let positions: Vec<compute_fill::formula_adjust::RefPosition> =
                                    id_formula
                                        .refs
                                        .iter()
                                        .map(|r| {
                                            resolve_identity_ref_to_fill_position(
                                                mirror,
                                                source_sheet_id,
                                                r,
                                                src_row,
                                                src_col,
                                            )
                                        })
                                        .collect();
                                (Some((**id_formula).clone()), formula_text, positions)
                            } else {
                                (None, None, Vec::new())
                            }
                        } else {
                            (None, None, Vec::new())
                        }
                    } else {
                        (None, None, Vec::new())
                    }
                } else {
                    (None, None, Vec::new())
                };

                // Skip blank cells when skip_blanks is enabled
                if skip_blanks && value == CellValue::Null && formula.is_none() {
                    continue;
                }

                // Read source format (only needed for All and Formats modes)
                let format = match copy_type {
                    CopyType::All | CopyType::Formats => Some(source_format_at(
                        stores,
                        mirror,
                        source_sheet_id,
                        src_row,
                        src_col,
                    )),
                    _ => None,
                };

                source_data.push(SourceCellData {
                    src_row,
                    src_col,
                    tgt_row,
                    tgt_col,
                    value,
                    formula,
                    formula_text,
                    ref_positions,
                    format,
                });
            }
        }
    } // sheet_mirror borrow ends here

    // ── Pass 2: Process collected data with mutable access to mirror ──

    let mut cell_edits: Vec<(SheetId, u32, u32, CellValue, Option<String>)> = Vec::new();
    let mut format_edits: Vec<(SheetId, u32, u32, domain_types::CellFormat)> = Vec::new();

    mutation.observer.set_suppressed(true);

    let is_cross_sheet = source_sheet_id != target_sheet_id;

    // Render an IdentityFormula to an A1 body against the target position. Returns
    // None if the result is empty (no body after stripping '=').
    //
    // Same-sheet path: feed the source IdentityFormula directly into
    // `build_adjusted_formula`. Refs stay bound to the source (== target) sheet.
    //
    // Cross-sheet path: round-trip through the parser so naked refs rebind to
    // the target sheet. Without this, naked `A1` on Sheet1!C1 copied to Sheet2!C1
    // would render as `Sheet1!A1` (because the IdentityCellRef's `id` still
    // resolves to a cell on Sheet1). See `build_cross_sheet_adjusted_formula`.
    let render_formula_body = |stores: &mut EngineStores,
                               mirror: &mut CellMirror,
                               src: &SourceCellData|
     -> Option<String> {
        let id_formula = src.formula.as_ref()?;
        if is_cross_sheet {
            return build_cross_sheet_adjusted_formula(
                stores,
                mirror,
                source_sheet_id,
                target_sheet_id,
                id_formula,
                src.formula_text.as_deref(),
                src.src_row,
                src.src_col,
                src.tgt_row,
                src.tgt_col,
            );
        }
        let adjusted_refs = compute_fill::formula_adjust::calculate_adjusted_positions(
            id_formula,
            (src.src_row, src.src_col),
            (src.tgt_row, src.tgt_col),
            &src.ref_positions,
        );
        let (new_formula, overrides) =
            build_adjusted_formula(stores, mirror, target_sheet_id, id_formula, &adjusted_refs)?;
        let lookup = AdjustedPositionLookup {
            mirror,
            formula_sheet: *target_sheet_id,
            overrides,
        };
        let a1 = compute_parser::to_a1_string(&new_formula, &lookup);
        let body = a1.strip_prefix('=').unwrap_or(&a1).to_string();
        if body.is_empty() { None } else { Some(body) }
    };

    for src in &source_data {
        match copy_type {
            CopyType::All => {
                // Prefer formula (with adjustment); fall back to typed value.
                let formula_body = render_formula_body(stores, mirror, src);
                match formula_body {
                    Some(body) => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        CellValue::Null,
                        Some(body),
                    )),
                    None => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        src.value.clone(),
                        None,
                    )),
                }
                if let Some(ref fmt) = src.format {
                    format_edits.push((*target_sheet_id, src.tgt_row, src.tgt_col, fmt.clone()));
                }
            }

            CopyType::Formulas => {
                let formula_body = render_formula_body(stores, mirror, src);
                match formula_body {
                    Some(body) => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        CellValue::Null,
                        Some(body),
                    )),
                    None => cell_edits.push((
                        *target_sheet_id,
                        src.tgt_row,
                        src.tgt_col,
                        src.value.clone(),
                        None,
                    )),
                }
            }

            CopyType::Values => {
                cell_edits.push((
                    *target_sheet_id,
                    src.tgt_row,
                    src.tgt_col,
                    src.value.clone(),
                    None,
                ));
            }

            CopyType::Formats => {
                if let Some(ref fmt) = src.format {
                    format_edits.push((*target_sheet_id, src.tgt_row, src.tgt_col, fmt.clone()));
                }
            }
        }
    }

    // Apply format edits and surface them as changed cells so viewport patches
    // refresh format-only pastes even when no value/formula changes.
    let mut format_changes: Vec<CellChange> = Vec::with_capacity(format_edits.len());
    for (sheet_id, row, col, format) in &format_edits {
        let Some(cell_id) = super::super::super::cell_editing::ensure_cell_id_mirrored(
            stores, mirror, sheet_id, *row, *col,
        ) else {
            continue;
        };
        let cell_hex = id_to_hex(cell_id.as_u128());
        properties::replace_cell_format(
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
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        });
    }

    mutation.observer.set_suppressed(false);

    let mut format_recalc = RecalcResult::empty();
    format_recalc.changed_cells = format_changes;

    if cell_edits.is_empty() {
        return Ok(format_recalc);
    }

    let mut recalc =
        mutation_set_cells_by_position_raw(stores, mirror, mutation, cell_edits, false)?;
    super::patches::merge_recalc_results(&mut recalc, format_recalc);
    Ok(recalc)
}
