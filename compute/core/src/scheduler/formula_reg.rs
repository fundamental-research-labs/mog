//! Formula parsing, registration, and variable DAG management.

use super::*;
use crate::storage::engine::mutation::CellInput;

impl ComputeCore {
    // -----------------------------------------------------------------------
    // Internal: input processing
    // -----------------------------------------------------------------------

    /// Process a typed cell input: clear, literal text, or parsed value/formula.
    ///
    /// Returns `(extra_dirty, teardown_pcs)`:
    /// - `extra_dirty` — projection-source CellIds that need recalculation
    ///   because editing a projected position invalidated its source.
    /// - `teardown_pcs` — synthetic `ProjectionChange` entries (cells with
    ///   `Null` values) covering positions whose spill was torn down by this
    ///   edit. Callers must merge these into the recalc result so the
    ///   viewport buffer can patch the cleared positions to empty; otherwise
    ///   the previously-spilled values remain visible in the UI.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn process_input(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: &CellInput,
        skip_cycle_check: bool,
    ) -> (Vec<CellId>, Vec<ProjectionChange>) {
        self.process_input_with_target(
            mirror,
            sheet_id,
            cell_id,
            row,
            col,
            input,
            skip_cycle_check,
            None,
        )
    }

    /// Format-aware variant of [`process_input`].
    ///
    /// `target` is the cell's effective number-format category. Used by
    /// the Parse arm to apply G1 (percent ÷100 on bare numbers), G2 (text
    /// format → store as string, beats formula prefix), and G3 (fraction
    /// `"n/d"` → f64) before the value reaches the mirror. `target == None`
    /// preserves the format-blind path verbatim.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn process_input_with_target(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: &CellInput,
        skip_cycle_check: bool,
        target: Option<compute_formats::FormatType>,
    ) -> (Vec<CellId>, Vec<ProjectionChange>) {
        self.process_input_with_context(
            mirror,
            sheet_id,
            cell_id,
            row,
            col,
            input,
            skip_cycle_check,
            &crate::storage::cells::values::InputParseContext::default_for_target(target),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn process_input_with_context(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        input: &CellInput,
        skip_cycle_check: bool,
        context: &crate::storage::cells::values::InputParseContext,
    ) -> (Vec<CellId>, Vec<ProjectionChange>) {
        let mut extra_dirty = Vec::new();
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();

        // Projection invalidation — if the target position falls within a
        // projection (but is NOT the source cell), the user's edit creates a real cell
        // that blocks the projection. Find the source and mark it for re-eval (#SPILL!).
        if let Some((proj_source, old_proj)) =
            self.invalidate_projection_at(mirror, sheet_id, row, col, cell_id)
        {
            extra_dirty.push(proj_source);
            if let Some(pc) = super::spill::build_teardown_projection_change(proj_source, &old_proj)
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

        match input {
            CellInput::Clear => {
                // Clear the cell
                mirror.apply_edit(
                    sheet_id,
                    cell_id,
                    SheetPos::new(row, col),
                    CellValue::Null,
                    None,
                );
                // Only remove precedents (own deps), not dependents (what depends on us)
                self.clear_formula_deps(mirror, cell_id);
                // If this cell was blocking a spill projection, re-dirty the
                // spill source so recalc can attempt to restore the projection.
                if let Some(spill_source) = self.spill_blockers.remove(&cell_id) {
                    extra_dirty.push(spill_source);
                }
            }
            CellInput::Literal { text } => {
                // Store the exact text — no coercion, no trimming, no formula parsing.
                let value = CellValue::Text(text.clone().into());
                mirror.apply_edit(sheet_id, cell_id, SheetPos::new(row, col), value, None);
                self.clear_formula_deps(mirror, cell_id);
            }
            CellInput::Parse { text } => {
                // Trim only for dispatch decisions (formula detection, empty check).
                // Plain text values preserve original whitespace.
                let trimmed = text.trim();
                debug_assert!(
                    !text.is_empty(),
                    "Parse(\"\") violates the CellInput invariant — SDK callers must emit Clear for empty values"
                );
                if trimmed.is_empty() {
                    // Whitespace-only Parse: fall through to Clear semantics to
                    // match the legacy behaviour. This is reachable only by
                    // internal paths; the SDK boundary must emit Clear.
                    mirror.apply_edit(
                        sheet_id,
                        cell_id,
                        SheetPos::new(row, col),
                        CellValue::Null,
                        None,
                    );
                    self.clear_formula_deps(mirror, cell_id);
                } else if matches!(context.target, Some(compute_formats::FormatType::Text)) {
                    // Text-formatted cell stores any
                    // input — including formula-shaped strings and apostrophe
                    // prefixes — as the literal string. Beats both the `'`
                    // strip and the `=` formula branch.
                    let value = CellValue::Text(text.clone().into());
                    mirror.apply_edit(sheet_id, cell_id, SheetPos::new(row, col), value, None);
                    self.clear_formula_deps(mirror, cell_id);
                } else if let Some(stripped) = trimmed.strip_prefix('\'') {
                    // Leading apostrophe = forced text mode (Excel convention).
                    // Strip the prefix and store as literal text — no formula
                    // interpretation, no type coercion.
                    let value = CellValue::Text(stripped.to_string().into());
                    mirror.apply_edit(sheet_id, cell_id, SheetPos::new(row, col), value, None);
                    self.clear_formula_deps(mirror, cell_id);
                } else if trimmed.starts_with('=') {
                    // Formula — store None for CellEntry.formula (IdentityFormula);
                    // the formula string goes into formula_strings via parse_and_register_formula.
                    let formula_str = trimmed.to_string();

                    // When re-entering the same formula (e.g., after changing iterative calc
                    // settings), preserve the existing cell value as a convergence seed.
                    // Resetting to Null would lose converged cycle values and force
                    // re-convergence from 0, producing poor results with loose thresholds.
                    //
                    // Exception: if the cell holds an Error (e.g., #REF! from incremental
                    // cycle detection), always reset — errors are not valid seeds.
                    let current_is_error = mirror
                        .get_cell_value(&cell_id)
                        .is_some_and(|v| matches!(v, CellValue::Error(..)));
                    let same_formula = !current_is_error
                        && self
                            .formula_strings
                            .get(&cell_id)
                            .is_some_and(|existing| *existing == formula_str);
                    if !same_formula {
                        mirror.apply_edit(
                            sheet_id,
                            cell_id,
                            SheetPos::new(row, col),
                            CellValue::Null,
                            None,
                        );
                    }

                    self.parse_and_register_formula(
                        mirror,
                        cell_id,
                        *sheet_id,
                        formula_str,
                        skip_cycle_check,
                    );
                } else {
                    // Plain value — format-aware classification via
                    // `parse_plain_value_with_target`. G1 (percent ÷100) and
                    // G3 (fraction parse) apply when `target` matches; the
                    // None case is identical to the legacy `parse_plain_value`.
                    let (value, _) =
                        super::value_utils::parse_plain_value_with_context(text, context);
                    mirror.apply_edit(sheet_id, cell_id, SheetPos::new(row, col), value, None);
                    self.clear_formula_deps(mirror, cell_id);
                }
            }
        }

        (extra_dirty, teardown_pcs)
    }

    /// Process a value-typed cell input: a typed `CellValue` with an optional formula body.
    ///
    /// This is the lossless counterpart to [`process_input`]. Callers that already
    /// own a typed `CellValue` (fill, paste, move, collaboration sync, programmatic
    /// import) must route through here — rendering to a string and re-parsing via
    /// `process_input` is lossy (strips `'` prefix, coerces `Text("42")` → `Number(42)`,
    /// drops `Error` / `Array` values, etc.).
    ///
    /// - `formula = Some(body)` — body is parsed and registered exactly like the
    ///   `=…` branch of [`process_input`]. The leading `=` is optional: if present
    ///   it passes through, if absent it is prepended before parsing. Callers that
    ///   route through `read_cell_from_yrs` (which re-prepends `=`) and callers
    ///   that strip `=` ahead of time are both accepted.
    /// - `formula = None` — store `value` directly via `mirror.apply_edit` and
    ///   clear any pre-existing formula deps. No parser involvement, no coercion.
    ///
    /// Returns `(extra_dirty, teardown_pcs)`. See [`process_input`] for details.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn process_value_input(
        &mut self,
        mirror: &mut CellMirror,
        sheet_id: &SheetId,
        cell_id: CellId,
        row: u32,
        col: u32,
        value: CellValue,
        formula: Option<&str>,
        skip_cycle_check: bool,
    ) -> (Vec<CellId>, Vec<ProjectionChange>) {
        let mut extra_dirty = Vec::new();
        let mut teardown_pcs: Vec<ProjectionChange> = Vec::new();

        // Projection invalidation — same bookkeeping as process_input. If the
        // target position falls within a projection (but is NOT the source),
        // mark the source dirty so it re-evaluates to #SPILL!.
        if let Some((proj_source, old_proj)) =
            self.invalidate_projection_at(mirror, sheet_id, row, col, cell_id)
        {
            extra_dirty.push(proj_source);
            if let Some(pc) = super::spill::build_teardown_projection_change(proj_source, &old_proj)
            {
                teardown_pcs.push(pc);
            }
        }
        if let Some(old_proj) = self.clear_projection_for_cell(mirror, &cell_id)
            && let Some(pc) = super::spill::build_teardown_projection_change(cell_id, &old_proj)
        {
            teardown_pcs.push(pc);
        }

        match formula {
            Some(formula_body) => {
                // Formula path — mirror the `starts_with('=')` branch of process_input.
                // The formula body here is the raw expression without the leading '='.
                // Prepend '=' so downstream consumers (formula_strings, normalize)
                // see the canonical form.
                let formula_str = if formula_body.starts_with('=') {
                    formula_body.to_string()
                } else {
                    format!("={}", formula_body)
                };

                // Preserve the existing cell value when re-entering the same formula —
                // matches process_input's convergence-seed behavior for iterative calc.
                let current_is_error = mirror
                    .get_cell_value(&cell_id)
                    .is_some_and(|v| matches!(v, CellValue::Error(..)));
                let same_formula = !current_is_error
                    && self
                        .formula_strings
                        .get(&cell_id)
                        .is_some_and(|existing| *existing == formula_str);
                if !same_formula {
                    mirror.apply_edit(
                        sheet_id,
                        cell_id,
                        SheetPos::new(row, col),
                        CellValue::Null,
                        None,
                    );
                }

                self.parse_and_register_formula(
                    mirror,
                    cell_id,
                    *sheet_id,
                    formula_str,
                    skip_cycle_check,
                );
            }
            None => {
                // Plain value path — store verbatim, no parser involvement.
                mirror.apply_edit(sheet_id, cell_id, SheetPos::new(row, col), value, None);
                self.clear_formula_deps(mirror, cell_id);
            }
        }

        (extra_dirty, teardown_pcs)
    }

    /// Clear a cell's own formula dependencies without removing it as a dependency target.
    ///
    /// When a formula cell becomes a plain value cell, we need to remove its own
    /// precedents (what it depends on) and its AST cache, but we must NOT remove
    /// other cells' dependencies on this cell. `graph.remove_cell` would remove
    /// the `dependents[cell_id]` entry, severing the reverse edge that tells us
    /// which formulas depend on this cell.
    ///
    /// Instead, we set its precedents to empty (which cleans up old reverse edges
    /// for its own deps) and then remove the precedents entry entirely.
    pub(super) fn clear_formula_deps(&mut self, mirror: &mut CellMirror, cell_id: CellId) {
        if self.ast_cache.contains_key(&cell_id) {
            // Clear its own deps by setting empty precedents
            // (this removes old reverse edges via remove_old_edges internally)
            self.graph.set_precedents(&cell_id, vec![]);
        }
        self.graph.unmark_volatile(&cell_id);
        self.formula_text_deps.clear_formula(&cell_id);
        self.ast_cache.remove(&cell_id);
        self.formula_strings.remove(&cell_id);
        self.cell_formula_text.remove(&cell_id);
        self.cell_range_keys.remove(&cell_id);
        // Clear IdentityFormula from CellEntry
        mirror.set_formula(&cell_id, None);
    }

    // -----------------------------------------------------------------------
    // Internal: formula parsing and dependency registration
    // -----------------------------------------------------------------------

    pub fn validate_formula_circular_reference(
        &self,
        mirror: &CellMirror,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        formula: &str,
    ) -> Option<crate::engine_types::FormulaCircularReferenceValidation> {
        let formula = {
            let sheet_names: Vec<&str> = mirror
                .sheet_ids()
                .filter_map(|id| mirror.get_sheet(id).map(|s| s.name.as_str()))
                .collect();
            compute_parser::normalize_formula_input(formula, &sheet_names)
        };

        let resolver = CoreResolver {
            mirror,
            current_sheet: *sheet_id,
        };
        let ast = parse_formula(&formula, Some(&resolver)).ok()?.into_inner();

        let target_pos = SheetPos::new(row, col);
        let cell_id = mirror
            .resolve_cell_id(sheet_id, target_pos)
            .unwrap_or_else(|| CellId::from_raw(u128::MAX));

        let extracted =
            extract_deps_and_volatility(&ast, sheet_id, mirror, self.ordered_sheets(), Some(row));
        let edit = compute_graph::HypotheticalDependencyEdit {
            cell: cell_id,
            new_precedents: extracted.value_deps,
        };
        let positions = compute_graph::positions::WithOverrides::new(mirror).with_override(
            cell_id,
            compute_graph::positions::CellPosition {
                sheet: *sheet_id,
                row,
                col,
            },
        );

        if self
            .graph
            .would_create_cycle(&edit, &positions)
            .into_value()
        {
            Some(crate::engine_types::FormulaCircularReferenceValidation {
                cell_address: crate::range_manager::pos_to_a1(row, col),
                formula,
            })
        } else {
            None
        }
    }

    /// Parse a formula, extract dependencies, and register them in the graph.
    ///
    /// Also generates an [`IdentityFormula`] and stores it in the cell's
    /// [`CellEntry`] for position-independent formula persistence.
    ///
    /// When `skip_cycle_check` is false, performs incremental cycle detection at
    /// registration time: if any new dependency edge would create a cycle, the
    /// cell is set to #REF! and its precedents are NOT registered. This avoids
    /// the need for a full O(V+E) cycle detection pass during every recalculation.
    ///
    /// When `skip_cycle_check` is true (used during bulk init from snapshot),
    /// the per-edge cycle detection is skipped entirely. This avoids the O(F^2*D)
    /// cost of running a DFS for every dependency of every formula cell. Instead,
    /// cycles are caught later by the topological sort in `full_recalc`, which
    /// calls `get_evaluation_order` and handles cycles via `handle_cycles_and_recalc`.
    pub(super) fn parse_and_register_formula(
        &mut self,
        mirror: &mut CellMirror,
        cell_id: CellId,
        sheet_id: SheetId,
        formula: String,
        skip_cycle_check: bool,
    ) {
        // Qualify implicit structured refs: [@Col] → TableName[@Col]
        // when the cell is inside a table.
        let formula = {
            let table_name = mirror.resolve_position(&cell_id).and_then(|pos| {
                let sheet_hex = sheet_id.to_uuid_string();
                mirror
                    .all_tables()
                    .iter()
                    .find(|t| {
                        t.sheet_id == sheet_hex
                            && pos.row() >= t.range.start_row()
                            && pos.row() <= t.range.end_row()
                            && pos.col() >= t.range.start_col()
                            && pos.col() <= t.range.end_col()
                    })
                    .map(|t| t.name.clone())
            });
            compute_parser::qualify_implicit_structured_refs(&formula, table_name.as_deref())
        };

        // Normalize: auto-quote sheet names, close parens, canonicalize refs
        let formula = {
            let sheet_names: Vec<&str> = mirror
                .sheet_ids()
                .filter_map(|id| mirror.get_sheet(id).map(|s| s.name.as_str()))
                .collect();
            compute_parser::normalize_formula_input(&formula, &sheet_names)
        };

        // Step 1: Parse to AST with immutable resolver (resolves existing CellIds)
        let ast = {
            let resolver = CoreResolver {
                mirror: &*mirror,
                current_sheet: sheet_id,
            };
            parse_formula(&formula, Some(&resolver))
        };

        match ast {
            Ok(spanned) => {
                let ast = spanned.into_inner();
                // Step 2: Convert to IdentityFormula (needs &mut mirror for ensure_cell_id).
                //         This is done BEFORE dep extraction so ghost cells created by
                //         ensure_cell_id are visible to extract_deps_and_volatility.
                let identity_formula = {
                    let id_resolver = CoreIdentityResolver {
                        mirror: std::cell::RefCell::new(mirror),
                        id_alloc: &self.id_alloc,
                        current_sheet: sheet_id,
                    };
                    compute_parser::to_identity_formula(&formula, &id_resolver).ok()
                };

                // Step 3: Store IdentityFormula in CellEntry
                mirror.set_formula(&cell_id, identity_formula);

                // Step 4: Extract dependencies and check volatility in a single AST walk
                let current_row = mirror.resolve_position(&cell_id).map(|pos| pos.row());
                let extracted = extract_deps_and_volatility(
                    &ast,
                    &sheet_id,
                    &*mirror,
                    self.ordered_sheets(),
                    current_row,
                );
                let deps = extracted.value_deps;
                let formula_text_deps = extracted.formula_text_deps;
                let is_volatile = extracted.is_volatile;

                // Incremental cycle detection — range-aware via HypotheticalDependencyEdit.
                // Catches both cell-to-cell and range-mediated cycles at edit time.
                if !skip_cycle_check {
                    let edit = compute_graph::HypotheticalDependencyEdit {
                        cell: cell_id,
                        new_precedents: deps.clone(),
                    };
                    // The cell's position is already in the mirror (set by apply_edit above),
                    // so no WithOverrides needed — the mirror resolves it directly.
                    let creates_cycle = self.graph.would_create_cycle(&edit, &*mirror).into_value();

                    if creates_cycle {
                        // Cycle detected — set cell to #REF! and skip registration
                        mirror.set_value_mut(&cell_id, CellValue::Error(CellError::Ref, None));
                        // Clear any existing deps for this cell (but keep it as a dependency target)
                        self.graph.set_precedents(&cell_id, vec![]);
                        self.graph.unmark_volatile(&cell_id);
                        self.formula_text_deps.clear_formula(&cell_id);
                        self.ast_cache.remove(&cell_id);
                        self.cell_range_keys.remove(&cell_id);
                        self.formula_strings.insert(cell_id, formula.clone());
                        self.cell_formula_text.insert(cell_id, formula);
                        return;
                    }
                }

                // No cycle (or check skipped) — register in dependency graph
                self.graph.set_precedents(&cell_id, deps);
                self.formula_text_deps.replace(cell_id, formula_text_deps);

                // Apply volatility from the single-pass check
                if is_volatile {
                    self.graph.mark_volatile(&cell_id);
                } else {
                    self.graph.unmark_volatile(&cell_id);
                }

                // Cache the AST and formula string
                use crate::eval::GLOBAL_REGISTRY;
                let is_dynamic_array = Self::ast_contains_array_function(&ast, &GLOBAL_REGISTRY);

                // Update pre-computed range keys for this cell
                {
                    let sheet_ctx = mirror.sheet_for_cell(&cell_id);
                    let mut plan = crate::eval::cache::range_store::DataPlan::default();
                    crate::eval::cache::range_store::collect_static_ranges_pub(
                        &ast, sheet_ctx, &*mirror, &mut plan,
                    );
                    if plan.is_empty() {
                        self.cell_range_keys.remove(&cell_id);
                    } else {
                        self.cell_range_keys
                            .insert(cell_id, plan.into_iter().collect());
                    }
                }

                self.ast_cache.insert(
                    cell_id,
                    AstEntry {
                        ast,
                        is_dynamic_array,
                    },
                );
                self.formula_strings.insert(cell_id, formula.clone());
                self.cell_formula_text.insert(cell_id, formula);
            }
            Err(_parse_err) => {
                // Parse failed — set cell to #NAME? error
                mirror.set_value_mut(&cell_id, CellValue::Error(CellError::Name, None));
                self.graph.remove_cell(&cell_id);
                self.formula_text_deps.clear_formula(&cell_id);
                self.ast_cache.remove(&cell_id);
                self.cell_range_keys.remove(&cell_id);
                self.formula_strings.insert(cell_id, formula.clone());
                self.cell_formula_text.insert(cell_id, formula);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Internal: variable DAG registration
    // -----------------------------------------------------------------------

    /// Register ALL variables from the VariableStore as DAG nodes.
    ///
    /// For each variable with a `raw_expression`, parses the expression into
    /// an AST, caches it under the variable's synthetic CellId, extracts
    /// dependencies, and registers them in the `DependencyGraph`.
    ///
    /// Called during `init_from_snapshot` after cell formulas are registered
    /// and during `rebuild_dep_graph_from_asts`.
    pub(super) fn register_all_variables(&mut self, mirror: &CellMirror) {
        // Collect variable data to avoid borrow conflicts with self
        let vars: Vec<(formula_types::Scope, String, Option<String>)> = mirror
            .variables
            .all_variables()
            .map(|(scope, name, def)| (scope.clone(), name.clone(), def.raw_expression.clone()))
            .collect();

        for (scope, name, raw_expr) in vars {
            self.register_single_variable(mirror, &scope, &name, raw_expr.as_deref());
        }
    }

    /// Register a single variable as a DAG node.
    ///
    /// If the variable has a `raw_expression`:
    /// 1. Parse it with `compute_parser::parse_formula()`
    /// 2. Cache the AST under the variable's synthetic CellId
    /// 3. Extract dependencies via `extract_deps_and_volatility()`
    /// 4. Register deps in the `DependencyGraph`
    /// 5. Mark volatile if expression contains NOW(), RAND(), etc.
    pub(super) fn register_single_variable(
        &mut self,
        mirror: &CellMirror,
        scope: &formula_types::Scope,
        name: &str,
        raw_expr: Option<&str>,
    ) {
        let cell_id = match mirror.variables.get_variable_cell_id(scope, name) {
            Some(id) => id,
            None => return, // Variable not in store
        };

        let raw_expr = match raw_expr {
            Some(expr) if !expr.is_empty() => expr,
            _ => return, // No expression to parse — range-ref variables don't need AST nodes
        };

        // Determine sheet context for parsing: sheet-scoped variables use their
        // sheet, workbook-scoped variables use a dummy sheet (they can't have
        // sheet-relative references anyway).
        let sheet_id = match scope {
            formula_types::Scope::Sheet(s) => *s,
            formula_types::Scope::Workbook => SheetId::from_raw(0),
        };

        // Try to parse the expression as a formula (prepend '=' if needed).
        let formula_str = if raw_expr.starts_with('=') {
            raw_expr.to_string()
        } else {
            format!("={}", raw_expr)
        };

        // Normalize the formula string (sheet name quoting, paren closing, etc.)
        let formula_str = {
            let sheet_names: Vec<&str> = mirror
                .sheet_ids()
                .filter_map(|id| mirror.get_sheet(id).map(|s| s.name.as_str()))
                .collect();
            compute_parser::normalize_formula_input(&formula_str, &sheet_names)
        };

        let resolver = CoreResolver {
            mirror,
            current_sheet: sheet_id,
        };

        match parse_formula(&formula_str, Some(&resolver)) {
            Ok(spanned) => {
                let ast = spanned.into_inner();

                // Extract deps and volatility
                let extracted = extract_deps_and_volatility(
                    &ast,
                    &sheet_id,
                    mirror,
                    self.ordered_sheets(),
                    None,
                );

                // Register in graph. Use set_precedents (not set_precedents_fresh)
                // since the variable may already have edges from a prior registration.
                self.graph.set_precedents(&cell_id, extracted.value_deps);
                if extracted.is_volatile {
                    self.graph.mark_volatile(&cell_id);
                } else {
                    self.graph.unmark_volatile(&cell_id);
                }

                // Cache AST (variables are never dynamic arrays)
                self.ast_cache.insert(
                    cell_id,
                    AstEntry {
                        ast,
                        is_dynamic_array: false,
                    },
                );
                self.formula_strings.insert(cell_id, formula_str);
            }
            Err(_) => {
                // Parse failed — variable will resolve to #NAME? at eval time.
                // No DAG entry needed.
            }
        }
    }
}
