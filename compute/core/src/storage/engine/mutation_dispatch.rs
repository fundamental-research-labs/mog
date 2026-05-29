use cell_types::{SheetId, SheetPos};
use compute_document::hex::id_to_hex;
use value_types::ComputeError;

use crate::snapshot::{
    ChangeKind, MutationResult, RecalcResult, SheetLifecycleRuntimeHint, SortingChange,
};

use super::format_inference::is_formula_parse_input;
use super::mutation::{self, EngineMutation, MutationOutput};
use super::mutation_coordinator::SheetLifecycleHistoryHint;
use super::{YrsComputeEngine, services, validation};

impl YrsComputeEngine {
    pub(super) fn attach_sheet_lifecycle_runtime_hint(
        result: &mut MutationResult,
        hint: SheetLifecycleRuntimeHint,
    ) {
        result.sheet_lifecycle_runtime_hint = Some(hint);
    }

    pub(in crate::storage::engine) fn record_sheet_lifecycle_history_hint(
        &mut self,
        undo_depth_after: usize,
        hint: SheetLifecycleHistoryHint,
    ) {
        self.mutation
            .sheet_lifecycle_history
            .record_forward(undo_depth_after, hint);
    }

    pub(super) fn with_undo_group_if<T>(
        &mut self,
        enabled: bool,
        f: impl FnOnce(&mut Self) -> Result<T, ComputeError>,
    ) -> Result<T, ComputeError> {
        if enabled {
            self.mutation.undo_manager.begin_undo_group();
        }
        let result = f(self);
        if enabled {
            self.mutation.undo_manager.end_undo_group();
        }
        result
    }

    /// Central dispatch for all mutations. Keeps all five stores in sync.
    pub(crate) fn apply_mutation(
        &mut self,
        mutation: EngineMutation,
    ) -> Result<MutationOutput, ComputeError> {
        validation::validate_mutation(&mutation, self)?;

        self.with_undo_group_if(mutation.should_auto_group_undo(), |engine| {
            engine.apply_mutation_inner(mutation)
        })
    }

    fn apply_mutation_inner(
        &mut self,
        mutation: EngineMutation,
    ) -> Result<MutationOutput, ComputeError> {
        let output = match mutation {
            EngineMutation::SetCell {
                sheet_id,
                cell_id,
                row,
                col,
                input,
            } => {
                let (_patches, mutation_result) =
                    self.set_cell(&sheet_id, cell_id, row, col, input)?;
                MutationOutput::Recalc(mutation_result)
            }

            EngineMutation::SetCells {
                edits,
                skip_cycle_check,
            } => {
                let formula_format_candidates: Vec<(SheetId, u32, u32)> = edits
                    .iter()
                    .filter_map(|(sid, _cid, row, col, input)| {
                        is_formula_parse_input(input).then_some((*sid, *row, *col))
                    })
                    .collect();
                let mut recalc = services::mutation_handlers::mutation_set_cells(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    edits,
                    skip_cycle_check,
                )?;
                let format_result =
                    self.apply_formula_inherited_number_formats(&formula_format_candidates)?;
                self.prepare_recalc_for_flush(&mut recalc);
                let mut result = MutationResult::from_recalc(recalc);
                result
                    .property_changes
                    .extend(format_result.property_changes);
                MutationOutput::Recalc(result)
            }

            EngineMutation::ClearCells { cell_ids } => {
                let mut recalc = services::mutation_handlers::mutation_clear_cells(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    cell_ids,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::SetCellsByPosition {
                edits,
                skip_cycle_check,
            } => {
                // Snapshot Parse-text edits so we can run locale-aware date format
                // inference after the value writes land in the mirror. Doing this
                // here (rather than in TS) keeps the value write and the format
                // application atomic from the caller's perspective.
                let inferred_format_candidates: Vec<(SheetId, u32, u32, String)> = edits
                    .iter()
                    .filter_map(|(sid, row, col, input)| match input {
                        mutation::CellInput::Parse { text } => {
                            Some((*sid, *row, *col, text.clone()))
                        }
                        _ => None,
                    })
                    .collect();
                let formula_format_candidates: Vec<(SheetId, u32, u32)> = edits
                    .iter()
                    .filter_map(|(sid, row, col, input)| {
                        is_formula_parse_input(input).then_some((*sid, *row, *col))
                    })
                    .collect();

                let mut recalc = services::mutation_handlers::mutation_set_cells_by_position(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    edits,
                    skip_cycle_check,
                )?;
                let format_result =
                    self.apply_formula_inherited_number_formats(&formula_format_candidates)?;
                self.prepare_recalc_for_flush(&mut recalc);

                if !inferred_format_candidates.is_empty() {
                    self.apply_inferred_date_formats(&inferred_format_candidates)?;
                    self.apply_inferred_time_formats(&inferred_format_candidates)?;
                }

                let mut result = MutationResult::from_recalc(recalc);
                result
                    .property_changes
                    .extend(format_result.property_changes);
                MutationOutput::Recalc(result)
            }

            EngineMutation::ClearRangeByPosition {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let mut recalc = services::mutation_handlers::mutation_clear_range_by_position(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::CreateDataTable { input } => {
                let (region, data) =
                    crate::data_table::prepare_data_table_creation(&self.mirror, &input)?;
                crate::storage::workbook::data_tables::upsert_data_table_region(
                    self.stores.storage.doc(),
                    self.stores.storage.workbook_map(),
                    &region,
                );
                self.mirror.upsert_data_table_region(region);
                MutationOutput::Plain(MutationResult::empty().with_data(&data)?)
            }

            EngineMutation::ApplyScenario { scenario_id } => {
                let baseline_id =
                    cell_types::CellId::from_raw(self.stores.id_alloc.next_u128()).to_uuid_string();
                let plan = match crate::what_if::scenarios::prepare_apply(
                    &self.stores.storage,
                    &self.mirror,
                    &self.stores.compute,
                    &self.scenario_session,
                    &scenario_id,
                    baseline_id,
                ) {
                    Ok(plan) => plan,
                    Err(result) => {
                        return Ok(MutationOutput::Plain(
                            MutationResult::empty().with_data(&result)?,
                        ));
                    }
                };

                let mut recalc = services::mutation_handlers::mutation_set_cells_raw(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    plan.edits,
                    true,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);

                self.scenario_session.active = Some(crate::snapshot::ScenarioActiveState {
                    scenario_id: plan.result.scenario_id.clone(),
                    baseline_id: plan.baseline.baseline_id.clone(),
                    document_id: plan.baseline.document_id.clone(),
                    definition_status: Some("current".to_string()),
                    cell_mutation_status: Some("clean".to_string()),
                });
                self.scenario_session
                    .baselines
                    .insert(plan.baseline.baseline_id.clone(), plan.baseline);

                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&plan.result)?)
            }

            EngineMutation::RestoreScenario { baseline_id } => {
                let plan = match crate::what_if::scenarios::prepare_restore(
                    &self.mirror,
                    &self.stores.compute,
                    &self.scenario_session,
                    &baseline_id,
                ) {
                    Ok(plan) => plan,
                    Err(result) => {
                        return Ok(MutationOutput::Plain(
                            MutationResult::empty().with_data(&result)?,
                        ));
                    }
                };

                let mut recalc = services::mutation_handlers::mutation_set_cells_raw(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    plan.edits,
                    true,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);

                self.scenario_session.baselines.remove(&plan.baseline_id);
                if self
                    .scenario_session
                    .active
                    .as_ref()
                    .is_some_and(|active| active.baseline_id == plan.baseline_id)
                {
                    self.scenario_session.active = None;
                }

                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&plan.result)?)
            }

            EngineMutation::CreateSheet { name } => {
                let (hex, result) = services::mutation_handlers::mutation_create_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &name,
                )?;
                // R2.3 — new sheet added; any cached matrix that keyed
                // on a prior layout stays in the cache but is now
                // orphaned. Bump so workbook-scope lookups see the
                // fresh structure.
                self.security.bump_structure_version();
                // A new sheet can cause previously-#REF! cross-sheet
                // refs to resolve on next recalc — must not short-circuit.
                self.stores.compute.mark_dirty();
                let new_sheet_id =
                    SheetId::from_raw(compute_document::hex::hex_to_id(&hex).ok_or_else(|| {
                        ComputeError::Eval {
                            message: format!("Invalid created SheetId: {}", hex),
                        }
                    })?);
                self.record_sheet_lifecycle_history_hint(
                    self.mutation.undo_manager.undo_depth(),
                    SheetLifecycleHistoryHint {
                        undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                        redo: Some(SheetLifecycleRuntimeHint::focus(new_sheet_id)),
                    },
                );
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::CreateDefaultSheet { name } => {
                // Same store-sync invariants as CreateSheet, but the underlying
                // Yrs transaction is tagged ORIGIN_BOOTSTRAP so it stays out of
                // the undo stack (a fresh workbook must report canUndo == false).
                let (hex, result) = services::mutation_handlers::mutation_create_default_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &name,
                )?;
                self.security.bump_structure_version();
                self.stores.compute.mark_dirty();
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::DeleteSheet { sheet_id } => {
                let (mut result, mut recalc) = services::mutation_handlers::mutation_delete_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                result.recalc = recalc;
                // R2.3 — sheet gone; every cached matrix for that
                // sheet id is now a lie. Let the LRU age them out.
                self.security.bump_structure_version();
                self.record_sheet_lifecycle_history_hint(
                    self.mutation.undo_manager.undo_depth(),
                    SheetLifecycleHistoryHint {
                        undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                        redo: Some(SheetLifecycleRuntimeHint::reconcile()),
                    },
                );
                MutationOutput::Recalc(result)
            }

            EngineMutation::CopySheet {
                source_sheet_id,
                new_name,
            } => {
                let (hex, result) = services::mutation_handlers::mutation_copy_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &source_sheet_id,
                    &new_name,
                )?;
                // R2.3 — new sheet; same reasoning as CreateSheet.
                self.security.bump_structure_version();
                // Copied sheet adds new formula cells — next recalc has work.
                self.stores.compute.mark_dirty();
                let new_sheet_id =
                    SheetId::from_raw(compute_document::hex::hex_to_id(&hex).ok_or_else(|| {
                        ComputeError::Eval {
                            message: format!("Invalid copied SheetId: {}", hex),
                        }
                    })?);
                self.record_sheet_lifecycle_history_hint(
                    self.mutation.undo_manager.undo_depth(),
                    SheetLifecycleHistoryHint {
                        undo: Some(SheetLifecycleRuntimeHint::reconcile()),
                        redo: Some(SheetLifecycleRuntimeHint::focus(new_sheet_id)),
                    },
                );
                MutationOutput::SheetId(hex, result)
            }

            EngineMutation::RenameSheet { sheet_id, name } => {
                let result = services::mutation_handlers::mutation_rename_sheet(
                    &mut self.stores,
                    &mut self.mirror,
                    &sheet_id,
                    &name,
                )?;
                // R2.3 — sheet identity is unchanged by rename (sheet
                // policies key on `SheetId`, not name), but rename is
                // structural in the bridge taxonomy and other layers
                // may key on name; bumping is cheap and keeps the
                // invariant "every structural op bumps" uniform.
                self.security.bump_structure_version();
                // Formula display strings key on sheet names — rename
                // can change A1 rendering; be safe and force next recalc.
                self.stores.compute.mark_dirty();
                MutationOutput::Plain(result)
            }

            EngineMutation::SortRange {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
                options,
            } => {
                let mut recalc = services::mutation_handlers::mutation_sort_range(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    &options,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                let rows_moved = recalc.changed_cells.len() as u32;
                let mut result = MutationResult::from_recalc(recalc);
                result.sorting_changes.push(SortingChange {
                    sheet_id: sheet_id.to_uuid_string(),
                    kind: ChangeKind::Set,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    rows_moved,
                });
                MutationOutput::Recalc(result)
            }

            EngineMutation::RemoveDuplicates {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
                columns,
                has_headers,
            } => {
                let (mut recalc, data) = services::mutation_handlers::mutation_remove_duplicates(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    &columns,
                    has_headers,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&data)?)
            }

            EngineMutation::ClearRange {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let mut recalc = services::mutation_handlers::mutation_clear_range(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }

            EngineMutation::ClearRangeAndReturnIds {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
            } => {
                let cell_ids = services::mutation_handlers::collect_cell_ids_in_range(
                    &self.stores,
                    &sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                );
                let hex_ids: Vec<String> = cell_ids
                    .iter()
                    .map(|id| id_to_hex(id.as_u128()).into())
                    .collect();

                if cell_ids.is_empty() {
                    MutationOutput::Recalc(MutationResult::empty().with_data(&hex_ids)?)
                } else {
                    let mut recalc = services::mutation_handlers::mutation_clear_cells(
                        &mut self.stores,
                        &mut self.mirror,
                        &mut self.mutation,
                        cell_ids,
                    )?;
                    self.prepare_recalc_for_flush(&mut recalc);
                    MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&hex_ids)?)
                }
            }

            EngineMutation::CreateNamedRange { input } => {
                // Capture data needed for mirror sync before passing input to Yrs handler
                let nr_name = input.name.clone();
                let nr_refers_to = input.refers_to.clone();
                let nr_scope = input.scope.clone();
                let output =
                    services::mutation_handlers::mutation_named_range_create(&self.stores, input)?;
                // Sync the named range to the in-memory mirror/scheduler so the
                // formula evaluator can resolve it immediately.
                let scope = match nr_scope {
                    Some(ref s) => match SheetId::from_uuid_str(s) {
                        Ok(sid) => formula_types::Scope::Sheet(sid),
                        Err(_) => formula_types::Scope::Workbook,
                    },
                    None => formula_types::Scope::Workbook,
                };
                let def = formula_types::NamedRangeDef::from_expression(
                    nr_name.clone(),
                    scope,
                    nr_refers_to,
                );
                self.stores
                    .compute
                    .set_named_range(&mut self.mirror, nr_name, def);
                // Formulas that reference this name now resolve to a real
                // range — next recalc must re-evaluate them.
                self.stores.compute.mark_dirty();
                output
            }

            EngineMutation::UpdateNamedRange { id, mut updates } => {
                // Yrs storage contract (typed formula boundary): `DefinedName.refers_to`
                // must be `serde_json::to_string(&IdentityFormula)`. The
                // inbound `updates.refers_to` is an A1 expression — convert it
                // here so the storage layer writes the canonical format.
                // Without this, `get_all_named_ranges_wire` silently filters
                // the entry out (the wire reader's IdentityFormula JSON parse
                // fails) and dependents see the name disappear. Mirrors the
                // logic in `set_named_range` (delegations.rs).
                let original_refers_to_a1 = updates.refers_to.clone();
                let is_rename = updates.name.is_some();
                if let Some(a1_expr) = updates.refers_to.take() {
                    let a1 = if a1_expr.starts_with('=') {
                        a1_expr
                    } else {
                        format!("={}", a1_expr)
                    };
                    // Determine a context sheet for parsing: prefer the
                    // existing entry's scope; fall back to the first sheet.
                    let existing = crate::storage::workbook::named_ranges::get_named_range_by_id(
                        self.stores.storage.doc(),
                        self.stores.storage.workbook_map(),
                        &id,
                    );
                    let context_sheet = existing
                        .as_ref()
                        .and_then(|dn| dn.scope.as_deref())
                        .and_then(|s| SheetId::from_uuid_str(s).ok())
                        .or_else(|| self.mirror.sheet_ids().next().copied());

                    let identity = match context_sheet {
                        Some(ctx) => self
                            .stores
                            .compute
                            .to_identity_formula(&mut self.mirror, &ctx, &a1)
                            .unwrap_or_else(|_| formula_types::IdentityFormula {
                                template: a1.strip_prefix('=').unwrap_or(&a1).to_string(),
                                refs: vec![],
                                is_dynamic_array: false,
                                is_volatile: false,
                                is_aggregate: false,
                            }),
                        None => formula_types::IdentityFormula {
                            template: a1.strip_prefix('=').unwrap_or(&a1).to_string(),
                            refs: vec![],
                            is_dynamic_array: false,
                            is_volatile: false,
                            is_aggregate: false,
                        },
                    };

                    // Persist identity mappings so remote peers can resolve
                    // the IdentityFormula's CellIds back to (sheet, row, col).
                    services::cell_editing::persist_identity_formula_cell_identities(
                        &mut self.stores,
                        &self.mirror,
                        &identity,
                    );

                    let refers_to_json = serde_json::to_string(&identity)
                        .expect("IdentityFormula serialization should not fail");
                    updates.refers_to = Some(refers_to_json);
                }

                let output = services::mutation_handlers::mutation_named_range_update(
                    &self.stores,
                    &mut self.mirror,
                    id,
                    updates,
                )?;
                // Mirror sync uses the ORIGINAL A1 expression — `from_expression`
                // stores it as `raw_expression` for the evaluator to parse at
                // resolution time. Passing the JSON would break evaluation.
                let mut recalc_result: Option<RecalcResult> = None;
                if let Some(refers_to) = original_refers_to_a1
                    && let MutationOutput::Plain(ref result) = output
                    && let Some(ref data) = result.data
                    && let Ok(dn) =
                        serde_json::from_value::<domain_types::DefinedName>(data.clone())
                {
                    let scope = match dn.scope {
                        Some(ref s) => match SheetId::from_uuid_str(s) {
                            Ok(sid) => formula_types::Scope::Sheet(sid),
                            Err(_) => formula_types::Scope::Workbook,
                        },
                        None => formula_types::Scope::Workbook,
                    };
                    let scope_for_seed = scope.clone();
                    let key_for_seed = dn.name.to_ascii_lowercase();
                    let def = formula_types::NamedRangeDef::from_expression(
                        dn.name.clone(),
                        scope,
                        refers_to,
                    );
                    self.stores
                        .compute
                        .set_named_range(&mut self.mirror, dn.name, def);

                    // Excel parity: redefining a name immediately recomputes
                    // every formula that references it. Seed an incremental
                    // recalc from the variable's synthetic CellId — every
                    // dependent formula has a graph edge into it.
                    let seed_id = self
                        .mirror
                        .variables
                        .get_variable_cell_id(&scope_for_seed, &key_for_seed);
                    if let Some(cell_id) = seed_id
                        && let Ok(recalc) = self.stores.compute.recalc(&mut self.mirror, &[cell_id])
                    {
                        recalc_result = Some(recalc);
                    } else {
                        self.stores.compute.mark_dirty();
                    }
                }
                if is_rename {
                    // Mirror IdentityFormula.template strings just changed; the
                    // A1 display cache used by `get_formula` reads from those,
                    // so it needs regenerating.
                    self.stores.compute.regenerate_formula_strings(&self.mirror);
                }
                if let Some(mut recalc) = recalc_result {
                    self.prepare_recalc_for_flush(&mut recalc);
                    let mut merged = MutationResult::from_recalc(recalc);
                    if let MutationOutput::Plain(plain) = output {
                        merged.named_range_changes = plain.named_range_changes;
                        merged.data = plain.data;
                    }
                    MutationOutput::Recalc(merged)
                } else {
                    output
                }
            }

            EngineMutation::ImportNamedRanges { names } => {
                // Capture name data for mirror sync
                let name_data: Vec<_> = names
                    .iter()
                    .map(|n| (n.name.clone(), n.refers_to.clone(), n.scope.clone()))
                    .collect();
                let output =
                    services::mutation_handlers::mutation_named_ranges_import(&self.stores, names)?;
                // Sync each imported named range to the mirror
                for (name, refers_to, scope_str) in name_data {
                    let scope = match scope_str {
                        Some(ref s) => match SheetId::from_uuid_str(s) {
                            Ok(sid) => formula_types::Scope::Sheet(sid),
                            Err(_) => formula_types::Scope::Workbook,
                        },
                        None => formula_types::Scope::Workbook,
                    };
                    let def = formula_types::NamedRangeDef::from_expression(
                        name.clone(),
                        scope,
                        refers_to,
                    );
                    self.stores
                        .compute
                        .set_named_range(&mut self.mirror, name, def);
                }
                // Any imported name may enable new formula resolutions.
                self.stores.compute.mark_dirty();
                output
            }

            EngineMutation::CreateSubtotals {
                sheet_id,
                start_row,
                start_col,
                end_row,
                end_col,
                options,
            } => {
                let (mut recalc, subtotal_result) = self.mutation_create_subtotals(
                    &sheet_id, start_row, start_col, end_row, end_col, options,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(
                    MutationResult::from_recalc(recalc).with_data(&subtotal_result)?,
                )
            }

            EngineMutation::AutoFill { sheet_id, request } => {
                let (mut recalc, summary) = services::mutation_handlers::mutation_auto_fill(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    request,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&summary)?)
            }

            EngineMutation::FlashFill { sheet_id, request } => {
                let (mut recalc, summary) = services::mutation_handlers::mutation_flash_fill(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &sheet_id,
                    request,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc).with_data(&summary)?)
            }

            EngineMutation::RelocateCells {
                source_sheet_id,
                src_start_row,
                src_start_col,
                src_end_row,
                src_end_col,
                target_sheet_id,
                target_row,
                target_col,
            } => {
                let (mut recalc, relocate_result, table_changes) =
                    services::mutation_handlers::mutation_relocate_cells(
                        &mut self.stores,
                        &mut self.mirror,
                        &mut self.mutation,
                        &source_sheet_id,
                        src_start_row,
                        src_start_col,
                        src_end_row,
                        src_end_col,
                        &target_sheet_id,
                        target_row,
                        target_col,
                    )?;
                self.prepare_recalc_for_flush(&mut recalc);
                let mut result = MutationResult::from_recalc(recalc).with_data(&relocate_result)?;
                result.table_changes.extend(table_changes);
                MutationOutput::Recalc(result)
            }

            EngineMutation::CopyRange {
                source_sheet_id,
                src_start_row,
                src_start_col,
                src_end_row,
                src_end_col,
                target_sheet_id,
                target_row,
                target_col,
                copy_type,
                skip_blanks,
                transpose,
            } => {
                let mut recalc = services::mutation_handlers::mutation_copy_range(
                    &mut self.stores,
                    &mut self.mirror,
                    &mut self.mutation,
                    &source_sheet_id,
                    src_start_row,
                    src_start_col,
                    src_end_row,
                    src_end_col,
                    &target_sheet_id,
                    target_row,
                    target_col,
                    copy_type,
                    skip_blanks,
                    transpose,
                )?;
                self.prepare_recalc_for_flush(&mut recalc);
                MutationOutput::Recalc(MutationResult::from_recalc(recalc))
            }
        };

        Ok(output)
    }

    /// Create a new sheet (used by objects.rs for pivot table creation).
    pub(in crate::storage::engine) fn mutation_create_sheet(
        &mut self,
        name: &str,
    ) -> Result<(String, MutationResult), ComputeError> {
        services::mutation_handlers::mutation_create_sheet(
            &mut self.stores,
            &mut self.mirror,
            &mut self.mutation,
            name,
        )
    }

    // -------------------------------------------------------------------
    // CreateSubtotals — insert rows + SUBTOTAL formulas with recalc
    // -------------------------------------------------------------------

    /// Create subtotal rows and groups with full store synchronization.
    /// The domain function writes to yrs; we then sync all cells in the
    /// affected range with compute for recalc.
    fn mutation_create_subtotals(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        options: crate::storage::sheet::grouping::SubtotalOptions,
    ) -> Result<
        (
            RecalcResult,
            crate::storage::sheet::grouping::SubtotalResult,
        ),
        ComputeError,
    > {
        use crate::storage::sheet::grouping;

        let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);
        let doc = self.stores.storage.doc().clone();
        let sheets_map = doc.get_or_insert_map("sheets");

        // The Accessor struct needs &mut YrsComputeEngine because set_cell and
        // structure_change are engine methods that coordinate all five stores.
        struct Accessor<'a> {
            engine: &'a mut YrsComputeEngine,
        }
        impl<'a> grouping::SubtotalsCellAccessor for Accessor<'a> {
            fn get_cell_value(&self, sid: &SheetId, row: u32, col: u32) -> String {
                self.engine
                    .mirror
                    .get_cell_value_at(sid, SheetPos::new(row, col))
                    .map(|v| format!("{}", v))
                    .unwrap_or_default()
            }
            fn set_cell_value(&mut self, sid: &SheetId, row: u32, col: u32, value: &str) {
                if let Some(grid) = self.engine.stores.grid_indexes.get_mut(sid) {
                    let cell_id = grid.ensure_cell_id(row, col);
                    let _ = self.engine.set_cell(sid, cell_id, row, col, value.into());
                }
            }
            fn insert_rows(&mut self, sid: &SheetId, at_row: u32, count: u32) {
                let change = formula_types::StructureChange::InsertRows {
                    at: at_row,
                    count,
                    new_row_ids: Vec::new(),
                };
                let _ = self.engine.structure_change(sid, &change);
            }
            fn delete_rows(&mut self, sid: &SheetId, at_row: u32, count: u32) {
                let change = formula_types::StructureChange::DeleteRows {
                    at: at_row,
                    count,
                    deleted_cell_ids: Vec::new(),
                };
                let _ = self.engine.structure_change(sid, &change);
            }
            fn get_cell_raw_value(&self, sid: &SheetId, row: u32, col: u32) -> String {
                self.engine
                    .mirror
                    .get_cell_value_at(sid, SheetPos::new(row, col))
                    .map(|v| format!("{}", v))
                    .unwrap_or_default()
            }
        }

        self.mutation.observer.set_suppressed(true);
        let mut accessor = Accessor { engine: self };
        let subtotal_result = grouping::create_subtotals(
            &doc,
            &sheets_map,
            &mut accessor,
            sheet_id,
            &range,
            &options,
        );
        self.mutation.observer.set_suppressed(false);

        // Sync all cells in the expanded range with compute.
        let actual_end_row = end_row + subtotal_result.subtotal_rows_inserted;
        let recalc = services::cell_editing::sync_range_with_compute(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            start_row,
            start_col,
            actual_end_row,
            end_col,
        )?;
        Ok((recalc, subtotal_result))
    }
}
