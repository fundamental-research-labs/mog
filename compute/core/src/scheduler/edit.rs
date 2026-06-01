//! Cell editing — set, clear, apply changes, and structural mutations.

use super::*;
use crate::storage::engine::mutation::CellInput;
use formula_types::WorkbookLookup;

/// Trust level for value-typed `set_cells_raw` writes.
///
/// **Stream A′ trust marker** (per `cse-display-and-batch-write.md`).
/// `set_cells_raw` is value-typed: there's no string parser between the
/// caller's intent and the mirror, which means it has historically been
/// an unguarded backdoor for partial-array writes. The trust marker
/// distinguishes:
///
/// - `UserEdit` — the call originates from a user-driven path
///   (`import_values`, range fill, structural value-replay). These MUST
///   reject partial writes into a CSE / Data Table region with
///   `PartialArrayWrite`.
/// - `TrustedReplay` — the call originates from a Yrs replay or other
///   path whose upstream op already passed its guard (or is the
///   array re-materialization itself). These skip the guard.
///
/// `set_cells_raw` ships this enum inline as part of D1.5; if Stream A′
/// has already landed when D1.5 merges, the merge is a no-op (same
/// shape, same semantics).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteTrust {
    UserEdit,
    TrustedReplay,
}

/// Outcome of the shared region partial-write guard.
///
/// - `Continue` — no region conflict (or the edit is permitted, e.g.,
///   anchor Clear of a CSE that tore down the array). The caller
///   proceeds with the original `(cell_id, row, col, input)`.
pub(super) enum RegionGuardOutcome {
    Continue,
}

/// Excel rejection family — what the engine does when an edit lands
/// inside an existing region rectangle (CSE anchor/member or Data
/// Table master/body):
///
/// | Input + Region kind                    | Behavior                                  |
/// |----------------------------------------|-------------------------------------------|
/// | `Clear` (CSE anchor)                   | Tear down the whole CSE; proceed at anchor |
/// | `Clear` (CSE non-anchor member)        | Reject as `PartialArrayWrite`             |
/// | `Literal { text }` (any CSE cell)      | Reject as `PartialArrayWrite`             |
/// | `Parse  { text }`  (any CSE cell)      | Reject as `PartialArrayWrite`             |
/// | `Clear` (Data Table any cell)          | Reject as `PartialArrayWrite`             |
/// | `Literal { text }` (Data Table master) | Reject as `PartialArrayWrite`             |
/// | `Parse  { text }`  (Data Table master) | Reject as `PartialArrayWrite`             |
/// | `Literal { text }` (Data Table body)   | Reject as `PartialArrayWrite`             |
/// | `Parse  { text }`  (Data Table body)   | Reject as `PartialArrayWrite`             |
///
/// Excel parity: pressing Delete on a **single** cell of a CSE
/// rectangle (anchor or member) is rejected — "You cannot change part
/// of an array." The user must select the entire CSE extent; when the
/// anchor-Clear is included in a batch, it tears down the CSE and
/// subsequent member-Clears land on plain cells. **Data Tables reject ALL partial writes** —
/// including master cell edits and body cell clears — because the
/// region's single source-of-truth is the master's `=TABLE(r2,r1)`
/// expression and the surrounding header cells; any partial write would
/// orphan the body cells. Users must clear the entire Data Table
/// rectangle explicitly to remove it.
///
/// Run BEFORE any mutation work so rejection is atomic. Used by
/// `set_cell` (single-cell), `set_cells` (batch), and `set_cells_raw`
/// (`UserEdit` trust). One helper, one path; no parallel `check_data_table_partial_write`.
pub(super) fn check_region_partial_write(
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    cell_id: CellId,
    row: u32,
    col: u32,
    input: &CellInput,
) -> Result<RegionGuardOutcome, ComputeError> {
    // 1. CSE check — anchor-Clear tears down the array; all other
    //    inputs (member-Clear, Literal, Parse) are rejected. Excel
    //    requires selecting the entire CSE extent to delete; a single-
    //    cell Delete on a member is "You cannot change part of an
    //    array." In batch paths the anchor is processed first (row-
    //    order), so by the time members are checked the CSE is gone.
    if let Some((anchor_id, anchor_pos)) = mirror.cse_anchor_covering(sheet_id, row, col) {
        match input {
            CellInput::Clear if anchor_id == cell_id => {
                // Anchor-Clear: tear down the array and proceed.
                mirror.unmark_cse_anchor(&anchor_id);
                mirror.cse_single_cell.remove(&anchor_id);
                return Ok(RegionGuardOutcome::Continue);
            }
            // Member-Clear, Literal, Parse: reject.
            _ => {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row,
                    col,
                    anchor_row: anchor_pos.row(),
                    anchor_col: anchor_pos.col(),
                });
            }
        }
    }

    // 2. Data Table region check — same conceptual guard. Members of a
    //    Data Table region (master + body cells) cannot be edited or
    //    cleared piecewise: the region is a single semantic unit. Any
    //    partial write returns `PartialArrayWrite` reporting the
    //    master's coordinates as the anchor.
    //
    //    Note: Data Tables differ from CSE in that BOTH master and body
    //    cells reject all input kinds (Literal, Parse, Clear). Editing
    //    the master's TABLE formula would orphan body cells; editing a
    //    body cell would diverge from the synthesized formula text.
    //    Users must clear the entire region to remove it.
    if let Some(dt) = mirror.find_data_table_at(sheet_id, row, col) {
        let anchor_row = dt.start_row;
        let anchor_col = dt.start_col;
        return Err(ComputeError::PartialArrayWrite {
            sheet_id: sheet_id.to_uuid_string(),
            row,
            col,
            anchor_row,
            anchor_col,
        });
    }

    Ok(RegionGuardOutcome::Continue)
}

impl ComputeCore {
    // -----------------------------------------------------------------------
    // Cell editing
    // -----------------------------------------------------------------------

    /// Validate user-originating cell edits against region atomicity rules
    /// before any storage or mirror mutation happens.
    ///
    /// This is the preflight counterpart to `check_region_partial_write`.
    /// Storage-level mutation handlers call it before writing to Yrs so a
    /// rejected CSE/Data Table partial edit is genuinely atomic.
    pub fn validate_region_partial_writes(
        &self,
        mirror: &CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellInput)],
    ) -> Result<(), ComputeError> {
        let anchors_being_cleared: std::collections::HashSet<CellId> = edits
            .iter()
            .filter(|(_, _, _, _, input)| matches!(input, CellInput::Clear))
            .filter_map(|(sheet_id, cell_id, row, col, _)| {
                mirror
                    .cse_anchor_covering(sheet_id, *row, *col)
                    .filter(|(anchor_id, _)| *anchor_id == *cell_id)
                    .map(|(anchor_id, _)| anchor_id)
            })
            .collect();

        for (sheet_id, cell_id, row, col, input) in edits {
            if let Some((anchor_id, anchor_pos)) = mirror.cse_anchor_covering(sheet_id, *row, *col)
            {
                match input {
                    CellInput::Literal { .. } | CellInput::Parse { .. } => {
                        return Err(ComputeError::PartialArrayWrite {
                            sheet_id: sheet_id.to_uuid_string(),
                            row: *row,
                            col: *col,
                            anchor_row: anchor_pos.row(),
                            anchor_col: anchor_pos.col(),
                        });
                    }
                    CellInput::Clear
                        if *cell_id != anchor_id && !anchors_being_cleared.contains(&anchor_id) =>
                    {
                        return Err(ComputeError::PartialArrayWrite {
                            sheet_id: sheet_id.to_uuid_string(),
                            row: *row,
                            col: *col,
                            anchor_row: anchor_pos.row(),
                            anchor_col: anchor_pos.col(),
                        });
                    }
                    _ => {}
                }
            }

            if let Some(dt) = mirror.find_data_table_at(sheet_id, *row, *col) {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: dt.start_row,
                    anchor_col: dt.start_col,
                });
            }
        }

        Ok(())
    }

    /// Validate lossless value-typed user edits against CSE/Data Table
    /// region atomicity before storage writes.
    ///
    /// Value-typed edits do not carry a `CellInput::Clear` discriminator, so
    /// every user edit inside a guarded region is a partial write. Trusted
    /// replay paths intentionally skip this method and use
    /// `set_cells_raw_with_trust(TrustedReplay)`.
    pub fn validate_raw_user_edit_region_writes(
        &self,
        mirror: &CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellValue, Option<String>)],
    ) -> Result<(), ComputeError> {
        for (sheet_id, _cell_id, row, col, _value, _formula) in edits {
            if let Some((_anchor_id, anchor_pos)) = mirror.cse_anchor_covering(sheet_id, *row, *col)
            {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: anchor_pos.row(),
                    anchor_col: anchor_pos.col(),
                });
            }

            if let Some(dt) = mirror.find_data_table_at(sheet_id, *row, *col) {
                return Err(ComputeError::PartialArrayWrite {
                    sheet_id: sheet_id.to_uuid_string(),
                    row: *row,
                    col: *col,
                    anchor_row: dt.start_row,
                    anchor_col: dt.start_col,
                });
            }
        }

        Ok(())
    }

    /// Set a single cell's value or formula, triggering partial recalculation.
    ///
    /// Accepts anything convertible into `CellInput` — so tests and engine-
    /// internal callers can pass `&str` (treated as `Parse`/`Clear` for empty)
    /// while boundary-aware callers build `CellInput` explicitly.
    ///
    /// Rejects writes to any position that falls inside an existing CSE
    /// (`Ctrl+Shift+Enter`) array formula extent — anchor or member —
    /// with [`ComputeError::PartialArrayWrite`]. The caller must clear
    /// the entire array (`clear_cells` on the anchor) and re-enter via
    /// [`ComputeCore::set_array_formula`].
    pub fn set_cell<I: Into<CellInput>>(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: I,
    ) -> Result<RecalcResult, ComputeError> {
        let input = input.into();
        // Excel region rejection family — see `check_region_partial_write`
        // for the full rejection table covering CSE rectangles and Data
        // Table regions. The shared helper rejects partial writes
        // uniformly; CSE anchor-Clear is the one allowed case (tears
        // down the whole array). Both `set_cell` and the batch path
        // `set_cells` route through it; production user edits go
        // through `set_cells`.
        check_region_partial_write(mirror, sheet_id, cell_id, row, col, &input)?;
        self.set_cell_inner(mirror, sheet_id, cell_id, row, col, input)
    }

    /// Internal: skips the CSE-anchor partial-write check.
    /// Used by both [`set_cell`] (post-check) and [`set_array_formula`]
    /// (which establishes the anchor itself).
    fn set_cell_inner(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: CellInput,
    ) -> Result<RecalcResult, ComputeError> {
        self.ensure_graph_built(mirror)?;
        let (extra, teardown_pcs) =
            self.process_input(mirror, sheet_id, cell_id, row, col, &input, false);
        let mut dirty = vec![cell_id];
        dirty.extend(extra);
        let mut result = self.recalc(mirror, &dirty)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Format-aware variant of [`set_cell`].
    ///
    /// Same CSE rejection family as [`set_cell`], but threads the cell's
    /// effective number-format category (`target`) through the Parse arm
    /// of `process_input` so G1 (percent ÷100 on bare numbers), G2 (text
    /// format → store as string), and G3 (fraction parse) apply during
    /// the scheduler-side classification. `target == None` is identical
    /// to [`set_cell`].
    pub fn set_cell_with_target<I: Into<CellInput>>(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: I,
        target: Option<compute_formats::FormatType>,
    ) -> Result<RecalcResult, ComputeError> {
        let input = input.into();
        check_region_partial_write(mirror, sheet_id, cell_id, row, col, &input)?;
        self.ensure_graph_built(mirror)?;
        let (extra, teardown_pcs) = self
            .process_input_with_target(mirror, sheet_id, cell_id, row, col, &input, false, target);
        let mut dirty = vec![cell_id];
        dirty.extend(extra);
        let mut result = self.recalc(mirror, &dirty)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Enter a CSE (`Ctrl+Shift+Enter`) array formula on
    /// `(top_row..=bottom_row, left_col..=right_col)`.
    ///
    /// Excel CSE semantics:
    /// - The formula is stored only on the anchor (top-left); members
    ///   are projections of the array result.
    /// - The anchor is marked `is_cse_anchor` in metadata; every
    ///   covered position carries `is_array_formula` for display.
    /// - Editing any covered position via [`set_cell`] is rejected
    ///   with [`ComputeError::PartialArrayWrite`]; the user must
    ///   clear the anchor (which tears down the CSE) before
    ///   re-entering.
    ///
    /// `formula` is the formula body — leading `=` is optional.
    pub fn set_array_formula(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        anchor_id: CellId,
        top_row: u32,
        left_col: u32,
        bottom_row: u32,
        right_col: u32,
        formula: &str,
    ) -> Result<RecalcResult, ComputeError> {
        if bottom_row < top_row || right_col < left_col {
            return Err(ComputeError::InvalidInput {
                message: format!(
                    "set_array_formula: invalid range ({},{})..=({},{})",
                    top_row, left_col, bottom_row, right_col
                ),
            });
        }
        // Cross-CSE overlap check — scan the **whole new rectangle**,
        // not just the top-left corner. The unified-reference implementation only
        // resolved `(top_row, left_col)`, which missed cases where the
        // new top-left lives outside the old CSE but interior cells
        // fall inside it (e.g. new C1:D3 vs existing A2:E2 — top-left
        // C1 is outside the old extent, but C2/D2 are inside).
        //
        // Use `projections_in_range` so the check is O(num_projections)
        // rather than O(rows * cols). Any overlapping projection whose
        // source is registered as a CSE anchor (i.e. exists in
        // `mirror.cse_anchors`) is a blocker, except the anchor we are
        // about to re-establish — self-overlap is resolved below by
        // tearing down the prior registration.
        let new_end_row = bottom_row + 1;
        let new_end_col = right_col + 1;
        for proj in mirror.projection_registry.projections_in_range(
            sheet_id,
            top_row,
            left_col,
            new_end_row,
            new_end_col,
        ) {
            if proj.source == anchor_id {
                continue; // self-overlap → tear down + re-install below
            }
            if !mirror.is_cse_anchor(&proj.source) {
                continue; // dynamic-array spill, not a CSE blocker
            }
            // First overlapping CSE wins for the error report. The
            // anchor row/col reported is the existing CSE's anchor —
            // that's what the user-facing error message points at.
            let existing_anchor_pos = mirror
                .resolve_position(&proj.source)
                .map(|p| (p.row(), p.col()))
                .unwrap_or((proj.origin_row, proj.origin_col));
            return Err(ComputeError::PartialArrayWrite {
                sheet_id: sheet_id.to_uuid_string(),
                row: top_row,
                col: left_col,
                anchor_row: existing_anchor_pos.0,
                anchor_col: existing_anchor_pos.1,
            });
        }
        // Tear down any prior CSE registration on this anchor — we
        // re-establish it below with the (possibly new) extent.
        mirror.cse_single_cell.remove(&anchor_id);
        let is_multi_cell = bottom_row > top_row || right_col > left_col;
        if is_multi_cell {
            mirror.mark_cse_anchor(anchor_id);
        } else {
            mirror.unmark_cse_anchor(&anchor_id);
        }

        // Normalize the formula string to canonical `=<body>` form so
        // the formula bar / Yrs storage / parser all see the same
        // shape downstream.
        let formula_str = if formula.trim_start().starts_with('=') {
            formula.trim_start().to_string()
        } else {
            format!("={}", formula.trim_start())
        };
        let input = CellInput::Parse { text: formula_str };

        // Run the formula through the regular pipeline. The scheduler
        // already produces an `Array` value for array-returning
        // formulas and registers the projection in
        // `mirror.projection_registry` via the spill handler.
        let result = self.set_cell_inner(mirror, sheet_id, anchor_id, top_row, left_col, input)?;

        // Mark this cell as a CSE anchor *after* recalc so the
        // process_input projection-cleanup branch (which clears any
        // pre-existing projection on this cell) doesn't see a stale
        // CSE marker. The 1×1 case is also routed through
        // `cse_single_cell` so the existing spill path applies
        // implicit intersection rather than spilling the array result.
        let rows = bottom_row - top_row + 1;
        let cols = right_col - left_col + 1;
        if rows == 1 && cols == 1 {
            mirror.cse_single_cell.insert(anchor_id);
        }
        mirror.mark_cse_anchor(anchor_id);

        // Spill registration is best-effort: if the formula's actual
        // array result didn't cover the requested extent, the
        // projection registry holds whatever the scheduler computed.
        // Excel parity allows the requested extent to differ — the
        // CSE marker still claims the user's selection. Force the
        // projection registry to match the requested extent so
        // partial-array rejection covers exactly the cells the user
        // selected, even when the result is a scalar.
        mirror
            .projection_registry
            .register(anchor_id, *sheet_id, top_row, left_col, rows, cols);
        Ok(result)
    }

    /// Set multiple cells at once, triggering a single recalculation pass.
    ///
    /// When `skip_cycle_check` is true, per-edge DFS cycle detection is skipped
    /// during formula registration. This is safe for trusted bulk operations
    /// because the topological sort in `recalc()` will catch any cycles.
    pub fn set_cells(
        &mut self,
        mirror: &mut CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellInput)],
        skip_cycle_check: bool,
    ) -> Result<RecalcResult, ComputeError> {
        self.validate_region_partial_writes(mirror, edits)?;
        self.ensure_graph_built(mirror)?;

        // Pass 2: apply edits. `check_region_partial_write` is the
        // per-cell safety net — anchor-Clear tears down the CSE;
        // member-Clear / Literal / Parse reject (caught by pass 1
        // for batches, but `set_cell` callers hit pass 2 directly).
        let mut changed = Vec::with_capacity(edits.len());
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();
        for (sheet_id, cell_id, row, col, input) in edits {
            check_region_partial_write(mirror, sheet_id, *cell_id, *row, *col, input)?;
            let (extra, pcs) = self.process_input(
                mirror,
                sheet_id,
                *cell_id,
                *row,
                *col,
                input,
                skip_cycle_check,
            );
            changed.push(*cell_id);
            changed.extend(extra);
            teardown_pcs.extend(pcs);
        }
        let mut result = self.recalc(mirror, &changed)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Format-aware variant of [`set_cells`].
    ///
    /// Threads a per-edit `Option<FormatType>` hint through `process_input`
    /// so the Parse arm classifies in step with the cell's effective
    /// number format (G1 percent ÷100 on bare numbers, G2 text format →
    /// store as string, G3 fraction parse). `targets` MUST have the same
    /// length as `edits`. `targets[i] == None` is identical to the
    /// format-blind [`set_cells`] behaviour.
    pub fn set_cells_with_targets(
        &mut self,
        mirror: &mut CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellInput)],
        targets: &[Option<compute_formats::FormatType>],
        skip_cycle_check: bool,
    ) -> Result<RecalcResult, ComputeError> {
        let contexts: Vec<crate::storage::cells::values::InputParseContext> = targets
            .iter()
            .copied()
            .map(crate::storage::cells::values::InputParseContext::default_for_target)
            .collect();
        self.set_cells_with_contexts(mirror, edits, &contexts, skip_cycle_check)
    }

    pub fn set_cells_with_contexts(
        &mut self,
        mirror: &mut CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellInput)],
        contexts: &[crate::storage::cells::values::InputParseContext],
        skip_cycle_check: bool,
    ) -> Result<RecalcResult, ComputeError> {
        debug_assert_eq!(
            edits.len(),
            contexts.len(),
            "set_cells_with_contexts: contexts length must match edits length"
        );

        self.validate_region_partial_writes(mirror, edits)?;
        self.ensure_graph_built(mirror)?;

        let mut changed = Vec::with_capacity(edits.len());
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();
        for (idx, (sheet_id, cell_id, row, col, input)) in edits.iter().enumerate() {
            check_region_partial_write(mirror, sheet_id, *cell_id, *row, *col, input)?;
            let (extra, pcs) = self.process_input_with_context(
                mirror,
                sheet_id,
                *cell_id,
                *row,
                *col,
                input,
                skip_cycle_check,
                &contexts[idx],
            );
            changed.push(*cell_id);
            changed.extend(extra);
            teardown_pcs.extend(pcs);
        }
        let mut result = self.recalc(mirror, &changed)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Set multiple cells with typed `CellValue` + optional formula, lossless.
    ///
    /// The honest counterpart to [`set_cells`]: string-typed input is correct for
    /// user-typed input (where the string *is* the authoritative form and parsing
    /// is part of the semantics), but callers that already own a typed `CellValue`
    /// must use this entry point. Routing a typed value through `set_cells`
    /// requires rendering to a string and re-parsing, which is lossy — it coerces
    /// `Text("42")` → `Number(42)`, strips leading apostrophes, drops `Error(..)`
    /// and `Array(..)` values, and misinterprets cells whose text happens to start
    /// with `=`.
    ///
    /// Each edit is `(sheet, cell_id, row, col, value, Option<formula_body>)`:
    /// - `formula = Some(body)` — register `body` as a formula (body is the raw
    ///   expression; the leading `=` is optional, it will be prepended if absent).
    ///   The provided `value` is used as a convergence seed for iterative calc.
    /// - `formula = None` — store `value` verbatim. No parser, no coercion.
    ///
    /// `skip_cycle_check` is forwarded to formula registration, same semantics as
    /// [`set_cells`].
    pub fn set_cells_raw(
        &mut self,
        mirror: &mut CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellValue, Option<String>)],
        skip_cycle_check: bool,
    ) -> Result<RecalcResult, ComputeError> {
        // Default trust for the legacy two-argument signature is
        // `TrustedReplay`. Callers that originate from user-driven paths
        // MUST migrate to `set_cells_raw_with_trust(WriteTrust::UserEdit)`.
        // See `WriteTrust` for the Stream A′ rationale.
        self.set_cells_raw_with_trust(mirror, edits, skip_cycle_check, WriteTrust::TrustedReplay)
    }

    /// Value-typed batch write with explicit trust marker (Stream A′).
    ///
    /// `WriteTrust::UserEdit` runs the same region partial-write guard
    /// as `set_cells` (CSE rectangles + Data Table regions). Use this
    /// for any caller that originates from a user op (`import_values`,
    /// fill operations, structural value-replays). `TrustedReplay`
    /// skips the guard for Yrs replays and engine-internal writes whose
    /// upstream op already cleared the guard.
    pub fn set_cells_raw_with_trust(
        &mut self,
        mirror: &mut CellMirror,
        edits: &[(SheetId, CellId, u32, u32, CellValue, Option<String>)],
        skip_cycle_check: bool,
        trust: WriteTrust,
    ) -> Result<RecalcResult, ComputeError> {
        // For UserEdit trust, run the unified region partial-write guard
        // up front so rejection is atomic. `set_cells_raw` is value-typed:
        // there's no `CellInput::Clear` discriminator, so any value-write
        // into a region (CSE or Data Table) is treated as a partial
        // write. The guard rejects with `PartialArrayWrite`.
        if matches!(trust, WriteTrust::UserEdit) {
            for (sheet_id, _cell_id, row, col, _value, _formula) in edits {
                if let Some((_anchor_id, anchor_pos)) =
                    mirror.cse_anchor_covering(sheet_id, *row, *col)
                {
                    return Err(ComputeError::PartialArrayWrite {
                        sheet_id: sheet_id.to_uuid_string(),
                        row: *row,
                        col: *col,
                        anchor_row: anchor_pos.row(),
                        anchor_col: anchor_pos.col(),
                    });
                }
                if let Some(dt) = mirror.find_data_table_at(sheet_id, *row, *col) {
                    return Err(ComputeError::PartialArrayWrite {
                        sheet_id: sheet_id.to_uuid_string(),
                        row: *row,
                        col: *col,
                        anchor_row: dt.start_row,
                        anchor_col: dt.start_col,
                    });
                }
            }
        }
        self.ensure_graph_built(mirror)?;

        let mut changed = Vec::with_capacity(edits.len());
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();
        for (sheet_id, cell_id, row, col, value, formula) in edits {
            let (extra, pcs) = self.process_value_input(
                mirror,
                sheet_id,
                *cell_id,
                *row,
                *col,
                value.clone(),
                formula.as_deref(),
                skip_cycle_check,
            );
            changed.push(*cell_id);
            changed.extend(extra);
            teardown_pcs.extend(pcs);
        }
        let mut result = self.recalc(mirror, &changed)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Apply changes from remote collaboration, undo, or redo.
    ///
    /// When `skip_cycle_check` is true, per-edge DFS cycle detection is skipped
    /// during formula registration. This is safe for trusted bulk operations
    /// (undo/redo, collaboration sync) because the topological sort in `recalc()`
    /// will catch any cycles. Skipping saves O(N * edges * graph_depth) work.
    pub fn apply_changes(
        &mut self,
        mirror: &mut CellMirror,
        changes: &[CellEdit],
        skip_cycle_check: bool,
    ) -> Result<RecalcResult, ComputeError> {
        self.ensure_graph_built(mirror)?;
        let mut changed = Vec::with_capacity(changes.len());
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();
        for edit in changes {
            let sheet_id = SheetId::from_uuid_str(&edit.sheet_id)?;
            let cell_id = CellId::from_uuid_str(&edit.cell_id)?;

            // Projection invalidation
            if let Some((proj_source, old_proj)) =
                self.invalidate_projection_at(mirror, &sheet_id, edit.row, edit.col, cell_id)
            {
                changed.push(proj_source);
                if let Some(pc) =
                    super::spill::build_teardown_projection_change(proj_source, &old_proj)
                {
                    teardown_pcs.push(pc);
                }
            }

            // Projection cleanup: if this cell has a registered projection, clear it
            if let Some(old_proj) = self.clear_projection_for_cell(mirror, &cell_id)
                && let Some(pc) = super::spill::build_teardown_projection_change(cell_id, &old_proj)
            {
                teardown_pcs.push(pc);
            }

            // Apply edit to mirror with IdentityFormula from CellEdit when available.
            mirror.apply_edit(
                &sheet_id,
                cell_id,
                SheetPos::new(edit.row, edit.col),
                edit.value.clone(),
                edit.identity_formula.clone(),
            );

            // If there's a formula, parse and register it
            if let Some(formula) = &edit.formula {
                self.parse_and_register_formula(
                    mirror,
                    cell_id,
                    sheet_id,
                    formula.clone(),
                    skip_cycle_check,
                );
            } else {
                // Plain value — remove own formula deps, keep dependents intact
                self.clear_formula_deps(mirror, cell_id);
            }

            changed.push(cell_id);
        }
        let mut result = self.recalc(mirror, &changed)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Clear one or more cells — removes values, formulas, and dependencies.
    /// Also tears down any CSE registration on the cleared anchors so a
    /// subsequent edit at that position is no longer rejected as
    /// `PartialArrayWrite`. Clearing a CSE *member* (not the anchor)
    /// also tears down the whole array — Excel parity, matching
    /// `set_cell`'s rejection-family table.
    pub fn clear_cells(
        &mut self,
        mirror: &mut CellMirror,
        cell_ids: &[CellId],
    ) -> Result<RecalcResult, ComputeError> {
        self.ensure_graph_built(mirror)?;
        // First pass: if any cleared cell is a CSE member (not anchor),
        // collect the anchor cell IDs so the caller-issued list is
        // expanded to include them. Excel: Clear on any cell of a CSE
        // rectangle clears the whole array.
        let mut expanded: Vec<CellId> = Vec::with_capacity(cell_ids.len());
        for cell_id in cell_ids {
            if !expanded.contains(cell_id) {
                expanded.push(*cell_id);
            }
            if let Some(sheet_id) = mirror.sheet_for_cell(cell_id)
                && let Some(pos) = mirror.resolve_position(cell_id)
                && let Some((anchor_id, _)) =
                    mirror.cse_anchor_covering(&sheet_id, pos.row(), pos.col())
                && anchor_id != *cell_id
                && !expanded.contains(&anchor_id)
            {
                expanded.push(anchor_id);
            }
        }
        let cell_ids: &[CellId] = &expanded;

        let mut dirty = Vec::with_capacity(cell_ids.len());
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();
        for cell_id in cell_ids {
            // Tear down any CSE registration on this cell — clearing
            // the anchor cancels the array formula entirely.
            mirror.unmark_cse_anchor(cell_id);
            mirror.cse_single_cell.remove(cell_id);

            // If clearing a projection source, clean up its projection
            if let Some(old_proj) = self.clear_projection_for_cell(mirror, cell_id)
                && let Some(pc) =
                    super::spill::build_teardown_projection_change(*cell_id, &old_proj)
            {
                teardown_pcs.push(pc);
            }

            // If the cleared cell's position falls in a projection, invalidate its source
            if let Some(sheet_id) = mirror.sheet_for_cell(cell_id)
                && let Some(pos) = mirror.resolve_position(cell_id)
                && let Some((proj_source, old_proj)) =
                    self.invalidate_projection_at(mirror, &sheet_id, pos.row(), pos.col(), *cell_id)
            {
                dirty.push(proj_source);
                if let Some(pc) =
                    super::spill::build_teardown_projection_change(proj_source, &old_proj)
                {
                    teardown_pcs.push(pc);
                }
            }

            // Set value to Null in mirror
            mirror.set_value_mut(cell_id, CellValue::Null);
            mirror.set_formula(cell_id, None);
            // Remove own formula deps, keep dependents intact
            self.clear_formula_deps(mirror, *cell_id);
            dirty.push(*cell_id);

            // If this cell was blocking a spill projection, re-dirty the spill
            // source so recalc can attempt to restore the projection. Mirrors
            // the same logic in `process_input`'s `CellInput::Clear` branch.
            if let Some(spill_source) = self.spill_blockers.remove(cell_id) {
                dirty.push(spill_source);
            }
        }
        let mut result = self.recalc(mirror, &dirty)?;
        super::spill::append_filtered_teardowns(&mut result, teardown_pcs);
        Ok(result)
    }

    /// Handle a structural change (insert/delete rows/cols).
    ///
    /// **Identity-stable refs**: `CellRef::Resolved(CellId)` and
    /// `IdentityFormula` refs (which carry `CellId`s) auto-track position
    /// shifts via the mirror — no rewrite needed for those.
    ///
    /// **Positional refs**: `CellRef::Positional { sheet, row, col }` in
    /// cached ASTs encode a snapshot position with no implicit shift, so
    /// they DO need rewriting:
    ///   - Refs in the deleted band → `ASTNode::Error(CellError::Ref)`
    ///   - Refs past the deleted band → shifted by `-count`
    ///   - Refs at/past an insertion point → shifted by `+count`
    ///
    /// These appear in cached ASTs whenever a formula was parsed before its
    /// referenced cells materialized (the formula reaches an empty cell).
    pub fn structure_change(
        &mut self,
        mirror: &mut CellMirror,
        change: Option<(&formula_types::StructureChange, SheetId)>,
    ) -> Result<RecalcResult, ComputeError> {
        // NOTE: mirror.apply_structure_change() is NOT called here — the caller
        // (StructuralOps) already updated the mirror before delegating to ComputeCore.
        // Calling it again would double-shift cell positions.

        // Invalidate ALL workbook-lifetime caches. Structural changes shift row
        // positions, which invalidates not just lookup indexes (Tier 0) but also
        // sorted column caches, frequency caches, and bitmask caches (Tier 1).
        self.workbook_cache.clear_all();

        // 2. Shift `CellRef::Positional` refs in every cached AST to mirror
        //    the structural op. Refs in the deleted band collapse to
        //    `ASTNode::Error(CellError::Ref)` — producing `#REF!` propagation
        //    at eval time without depending on IdentityFormula display
        //    semantics (which can mis-render when a ghost CellId got
        //    shadowed by a real cell after `to_identity_formula` allocated
        //    it). See `shift_ast_for_structure_change` for the full
        //    rewrite contract.
        //
        //    `change = None` is the observer-driven rebuild path: yrs has
        //    already been re-read into mirror+grid_index, so positional
        //    refs in cached ASTs from that previous in-memory state would
        //    not re-derive from yrs. The rebuild path predates this
        //    invariant; it's safe today only because formulas with
        //    `Positional` refs aren't a steady-state shape on the rebuild
        //    path (caller re-parses legacy formula strings into fresh
        //    `IdentityFormula`s). The `None` arm is preserved for that
        //    legacy contract.
        if let Some((change, target_sheet)) = change {
            self.shift_positional_refs_for_structure_change(target_sheet, change);
        }

        // 3. Update formula_strings cache (A1 display strings).
        //    Since positions changed, the A1 representation changes. Refs that
        //    pointed at deleted cells render as `#REF!` (their backing
        //    CellId / RowId / ColId is unregistered after the structural op).
        self.regenerate_formula_strings(mirror);

        // 4. Rebuild dep graph edges.
        //    Inserting/deleting between range corners changes the range
        //    extent; with positional refs already shifted in step 2, the
        //    dep graph rebuild lands on the correct precedent set.
        self.rebuild_dep_graph_from_asts(mirror);

        // 5. Full recalc (safe: evaluates all formula cells)
        self.full_recalc(mirror)
    }

    /// Walk the cached ASTs and apply `shift_ast_for_structure_change`.
    fn shift_positional_refs_for_structure_change(
        &mut self,
        target_sheet: SheetId,
        change: &formula_types::StructureChange,
    ) {
        use crate::eval::GLOBAL_REGISTRY;
        // Snapshot the keys so we don't borrow the ast_cache while we
        // mutate it.
        let cell_ids: Vec<CellId> = self.ast_cache.keys().copied().collect();
        for cell_id in cell_ids {
            let Some(entry) = self.ast_cache.get(&cell_id) else {
                continue;
            };
            let new_ast =
                ast_transform::shift_ast_for_structure_change(&entry.ast, target_sheet, change);
            // Recompute is_dynamic_array — a ref-collapse to `Error(Ref)`
            // can't change array-function status, but a future variant
            // might; keep the recompute defensive.
            let is_dynamic_array = Self::ast_contains_array_function(&new_ast, &GLOBAL_REGISTRY);
            self.ast_cache.insert(
                cell_id,
                AstEntry {
                    ast: new_ast,
                    is_dynamic_array,
                },
            );
        }
    }

    /// Regenerate all `formula_strings` entries from CellEntry.formula IdentityFormulas.
    ///
    /// Walks all sheets, finds cells with IdentityFormulas, and converts them back
    /// to A1 notation using the mirror's current position mappings. This is needed
    /// after structural changes because positions have shifted.
    pub(crate) fn regenerate_formula_strings(&mut self, mirror: &CellMirror) {
        self.formula_strings.clear();
        let sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();
        for sheet_id in sheet_ids {
            if let Some(sheet) = mirror.get_sheet(&sheet_id) {
                let lookup = MirrorPositionLookup::new(mirror, sheet_id);
                for (cell_id, entry) in sheet.cells_iter() {
                    if let Some(formula) = &entry.formula {
                        let a1 = compute_parser::to_a1_string(formula, &lookup);
                        self.formula_strings.insert(*cell_id, a1.clone());
                        self.cell_formula_text.insert(*cell_id, a1);
                    }
                }
            }
        }
    }

    /// Regenerate display formula text while a sheet is still present in the
    /// mirror, but render references to that sheet as a deleted-sheet `#REF!`
    /// prefix. This preserves the referenced row/column body (`#REF!$A$1`)
    /// before the mirror loses the deleted sheet's position mappings.
    pub(crate) fn regenerate_formula_strings_for_sheet_delete(
        &mut self,
        mirror: &CellMirror,
        deleted_sheet_id: &SheetId,
    ) {
        self.formula_strings.clear();
        let sheet_ids: Vec<SheetId> = mirror.sheet_ids().copied().collect();
        for sheet_id in sheet_ids {
            if sheet_id == *deleted_sheet_id {
                continue;
            }
            if let Some(sheet) = mirror.get_sheet(&sheet_id) {
                let lookup = DeletedSheetDisplayLookup::new(mirror, sheet_id, *deleted_sheet_id);
                for (cell_id, entry) in sheet.cells_iter() {
                    if let Some(formula) = &entry.formula {
                        let a1 = compute_parser::to_a1_string(formula, &lookup);
                        self.formula_strings.insert(*cell_id, a1.clone());
                        self.cell_formula_text.insert(*cell_id, a1);
                    }
                }
            }
        }
    }

    /// Rebuild the dependency graph from the cached ASTs.
    ///
    /// Clears the graph and re-extracts dependencies from all cached ASTs.
    /// This is needed after structural changes because range extents may have
    /// changed (e.g., inserting a row between range corners expands the range).
    fn rebuild_dep_graph_from_asts(&mut self, mirror: &CellMirror) {
        self.graph.clear();
        self.formula_text_deps.clear_all();

        // Collect (cell_id, sheet_id, ast, is_dynamic_array) to avoid borrow conflicts.
        // For regular cells, sheet_id comes from the mirror. For variable synthetic
        // CellIds, sheet_id comes from the variable's scope.
        let entries: Vec<(CellId, SheetId, ASTNode, bool)> = self
            .ast_cache
            .iter()
            .filter_map(|(cell_id, entry)| {
                let sheet_id = if mirror.variables.is_variable(cell_id) {
                    // Variable: derive sheet from scope
                    match mirror.variables.get_variable_by_cell_id(cell_id) {
                        Some((formula_types::Scope::Sheet(s), _, _)) => *s,
                        _ => SheetId::from_raw(0),
                    }
                } else {
                    // Regular cell: look up in mirror
                    mirror.sheet_for_cell(cell_id)?
                };
                Some((
                    *cell_id,
                    sheet_id,
                    entry.ast.clone(),
                    entry.is_dynamic_array,
                ))
            })
            .collect();

        // Rebuild range keys: structure changes may alter sheet dimensions,
        // invalidating clamped range bounds. Recompute from ASTs.
        self.cell_range_keys.clear();

        let mut volatile_cells = Vec::new();
        let ordered_sheets = self.ordered_sheets().to_vec();
        {
            let mut batch = self.graph.batch_mutations();
            for (cell_id, sheet_id, ast, _) in &entries {
                let current_row = mirror.resolve_position(cell_id).map(|pos| pos.row());
                let extracted = extract_deps_and_volatility(
                    ast,
                    sheet_id,
                    mirror,
                    &ordered_sheets,
                    current_row,
                );
                batch.set_precedents_fresh(cell_id, extracted.value_deps);
                self.formula_text_deps
                    .replace(*cell_id, extracted.formula_text_deps);
                if extracted.is_volatile {
                    volatile_cells.push(*cell_id);
                }

                // Recompute range keys for this cell
                let sheet_ctx = mirror.sheet_for_cell(cell_id);
                let mut plan = crate::eval::cache::range_store::DataPlan::default();
                crate::eval::cache::range_store::collect_static_ranges_pub(
                    ast, sheet_ctx, mirror, &mut plan,
                );
                if !plan.is_empty() {
                    self.cell_range_keys
                        .insert(*cell_id, plan.into_iter().collect());
                }
            }
        } // rebuild_range_index() called on drop

        for cell_id in volatile_cells {
            self.graph.mark_volatile(&cell_id);
        }
    }
}

struct DeletedSheetDisplayLookup<'a> {
    inner: MirrorPositionLookup<'a>,
    deleted_sheet_id: SheetId,
}

impl<'a> DeletedSheetDisplayLookup<'a> {
    fn new(mirror: &'a CellMirror, formula_sheet: SheetId, deleted_sheet_id: SheetId) -> Self {
        Self {
            inner: MirrorPositionLookup::new(mirror, formula_sheet),
            deleted_sheet_id,
        }
    }
}

impl WorkbookLookup for DeletedSheetDisplayLookup<'_> {
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
        self.inner.cell_position(cell_id)
    }

    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
        self.inner.row_index(row_id)
    }

    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
        self.inner.col_index(col_id)
    }

    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
        if *sheet_id == self.deleted_sheet_id {
            None
        } else {
            self.inner.sheet_name(sheet_id)
        }
    }

    fn formula_sheet(&self) -> SheetId {
        self.inner.formula_sheet()
    }
}
