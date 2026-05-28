use cell_types::{CellId, SheetId, SheetPos};

use crate::mirror::CellMirror;

// -------------------------------------------------------------------
// Pre-delete re-anchor pass
// -------------------------------------------------------------------

/// Before a `DeleteRows` / `DeleteCols` op tears down the affected CellIds,
/// shrink any `IdentityRangeRef` whose endpoint sits inside the doomed band
/// to the nearest surviving cell so e.g. `SUM(A1:A5)` with row 0 deleted
/// becomes `SUM(A1:A4)` instead of `SUM(#REF!)`.
///
/// Semantics ("shrink to surviving sub-region"):
/// - If the Range's START is doomed and the END survives, clamp START to
///   the first surviving position on the deleted axis (`at + count`),
///   keeping START's other axis.
/// - Symmetric for the END endpoint (clamped to `at - 1`).
/// - If both endpoints are doomed, leave the refs alone — the formula
///   will render as `#REF!`, the truthful fallback.
///
/// Only mutates `CellEntry.formula` in the mirror. Downstream
/// (`structure_change()` → `regenerate_formula_strings` →
/// `invalidate_stale_yrs_formulas`) does the rest.
///
/// Must run BEFORE the structural op removes the doomed cells' identities,
/// so their pre-delete positions can still be resolved via the mirror.
pub(super) fn pre_delete_re_anchor_range_refs(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    at: u32,
    count: u32,
    is_row: bool,
) {
    use formula_types::{IdentityFormulaRef, IdentityRangeRef};

    if count == 0 || mirror.get_sheet(sheet_id).is_none() {
        return;
    }

    let doomed_end = at.saturating_add(count); // exclusive: [at, doomed_end)

    // Decide whether a resolved (sheet, row, col) position lies in the
    // doomed band on the target sheet / axis.
    let in_doomed_band = |pos: Option<(SheetId, u32, u32)>| -> bool {
        match pos {
            Some((sid, row, col)) if sid == *sheet_id => {
                let axis_val = if is_row { row } else { col };
                axis_val >= at && axis_val < doomed_end
            }
            _ => false,
        }
    };

    // Resolve (sheet, row, col) for a CellId by combining `sheet_for_cell`
    // with `resolve_position` (returns `SheetPos`).
    let resolve_pos = |m: &CellMirror, id: &CellId| -> Option<(SheetId, u32, u32)> {
        let sid = m.sheet_for_cell(id)?;
        let p = m.resolve_position(id)?;
        Some((sid, p.row(), p.col()))
    };

    // Pass 1 — read: collect (owning_cell_id, new_refs) updates. We can't
    // mutate the mirror while iterating its sheets.
    struct Update {
        owning_cell: CellId,
        new_refs: Vec<IdentityFormulaRef>,
    }
    let mut updates: Vec<Update> = Vec::new();

    // Iterate every sheet's cells so cross-sheet formulas pointing at
    // `sheet_id` get re-anchored too.
    let all_sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();

    for owning_sheet in &all_sheet_ids {
        let Some(sheet_mirror) = mirror.get_sheet(owning_sheet) else {
            continue;
        };

        for (cell_id, entry) in sheet_mirror.cells_iter() {
            let Some(formula) = &entry.formula else {
                continue;
            };

            let mut new_refs: Vec<IdentityFormulaRef> = Vec::with_capacity(formula.refs.len());
            let mut any_change = false;

            for r in &formula.refs {
                match r {
                    IdentityFormulaRef::Range(rng) => {
                        let start_pos = resolve_pos(mirror, &rng.start_id);
                        let end_pos = resolve_pos(mirror, &rng.end_id);

                        let start_doomed = in_doomed_band(start_pos);
                        let end_doomed = in_doomed_band(end_pos);

                        if !start_doomed && !end_doomed {
                            new_refs.push(r.clone());
                            continue;
                        }

                        let mut new_rng: IdentityRangeRef = *rng;
                        let mut changed = false;

                        // Clamp START if doomed and END survives, so the new
                        // START sits just past the doomed band.
                        if start_doomed {
                            let end_survives = !end_doomed && end_pos.is_some();
                            let start_other_axis = match start_pos {
                                Some((_, row, col)) => {
                                    if is_row {
                                        col
                                    } else {
                                        row
                                    }
                                }
                                None => {
                                    new_refs.push(r.clone());
                                    continue;
                                }
                            };
                            if is_row {
                                let new_row = doomed_end;
                                let end_row = end_pos.map(|(_, r, _)| r);
                                if end_survives
                                    && end_row.is_some_and(|er| new_row <= er)
                                    && let Some(new_id) = mirror.resolve_cell_id(
                                        sheet_id,
                                        SheetPos::new(new_row, start_other_axis),
                                    )
                                {
                                    new_rng.start_id = new_id;
                                    changed = true;
                                }
                            } else {
                                let new_col = doomed_end;
                                let end_col = end_pos.map(|(_, _, c)| c);
                                if end_survives
                                    && end_col.is_some_and(|ec| new_col <= ec)
                                    && let Some(new_id) = mirror.resolve_cell_id(
                                        sheet_id,
                                        SheetPos::new(start_other_axis, new_col),
                                    )
                                {
                                    new_rng.start_id = new_id;
                                    changed = true;
                                }
                            }
                        }

                        // Clamp END if doomed and START survives, so the new
                        // END sits just before the doomed band (`at - 1`).
                        if end_doomed {
                            let start_survives = !start_doomed && start_pos.is_some();
                            let end_other_axis = match end_pos {
                                Some((_, row, col)) => {
                                    if is_row {
                                        col
                                    } else {
                                        row
                                    }
                                }
                                None => {
                                    if changed {
                                        new_refs.push(IdentityFormulaRef::Range(new_rng));
                                        any_change = true;
                                    } else {
                                        new_refs.push(r.clone());
                                    }
                                    continue;
                                }
                            };
                            if is_row {
                                if at > 0 {
                                    let new_row = at - 1;
                                    let start_row = start_pos.map(|(_, r, _)| r);
                                    if start_survives
                                        && start_row.is_some_and(|sr| sr <= new_row)
                                        && let Some(new_id) = mirror.resolve_cell_id(
                                            sheet_id,
                                            SheetPos::new(new_row, end_other_axis),
                                        )
                                    {
                                        new_rng.end_id = new_id;
                                        changed = true;
                                    }
                                }
                                // at == 0 → nothing survives above the deleted band.
                            } else if at > 0 {
                                let new_col = at - 1;
                                let start_col = start_pos.map(|(_, _, c)| c);
                                if start_survives
                                    && start_col.is_some_and(|sc| sc <= new_col)
                                    && let Some(new_id) = mirror.resolve_cell_id(
                                        sheet_id,
                                        SheetPos::new(end_other_axis, new_col),
                                    )
                                {
                                    new_rng.end_id = new_id;
                                    changed = true;
                                }
                            }
                            // at == 0 → nothing survives to the left of the deleted band.
                        }

                        if changed {
                            new_refs.push(IdentityFormulaRef::Range(new_rng));
                            any_change = true;
                        } else {
                            new_refs.push(r.clone());
                        }
                    }
                    other => new_refs.push(other.clone()),
                }
            }

            if any_change {
                updates.push(Update {
                    owning_cell: *cell_id,
                    new_refs,
                });
            }
        }
    }

    // Pass 2 — write: install the re-anchored IdentityFormulas. Only the
    // refs vector changes; template and flags are preserved.
    for Update {
        owning_cell,
        new_refs,
    } in updates
    {
        if let Some(old_formula) = mirror.get_formula(&owning_cell).cloned() {
            let new_formula = formula_types::IdentityFormula {
                template: old_formula.template,
                refs: new_refs,
                is_dynamic_array: old_formula.is_dynamic_array,
                is_volatile: old_formula.is_volatile,
                // Re-anchor only changes refs; formula shape is preserved.
                is_aggregate: old_formula.is_aggregate,
            };
            mirror.set_formula(&owning_cell, Some(new_formula));
        }
    }
}
