//! Level-based formula evaluation — sequential and parallel strategies.

use super::*;
use crate::eval::Evaluator;
use crate::eval_bridge::MirrorContext;
use crate::formula_text::FormulaTextProvider;

/// Minimum number of cells in a topological level before rayon parallelism kicks in.
/// Below this threshold, sequential evaluation avoids rayon's per-batch overhead
/// (thread wake-up, work-stealing dispatch, synchronization). Profiling shows that
/// with 213 levels where most have < 100 cells, rayon workers spend 77% of their
/// time sleeping (`wait_until_cold`). A threshold of 500 ensures only levels with
/// enough work to amortize the ~10-50us dispatch overhead use parallelism.
#[cfg(feature = "native")]
pub(super) const PARALLEL_THRESHOLD: usize = 500;

impl ComputeCore {
    /// Evaluate a single level of cells sequentially (unified: works on both native and WASM).
    #[allow(clippy::too_many_arguments)]
    pub(super) fn topo_evaluate_level_sequential(
        &mut self,
        mirror: &mut CellMirror,
        level: &[CellId],
        changed_cells: &mut Vec<CellChange>,
        projection_changes: &mut Vec<ProjectionChange>,
        errors: &mut Vec<CellErrorInfo>,
        range_store: &crate::eval::cache::range_store::RangeStore,
        projection_deltas: &mut Vec<ProjectionDelta>,
        metrics: &mut RecalcMetrics,
    ) {
        let ordered_sheets = self.ordered_sheets_cache.clone();
        let has_subscriber = tracing::dispatcher::has_been_set();

        for &cell_id in level {
            let entry = match self.ast_cache.get(&cell_id) {
                Some(entry) => entry,
                None => continue,
            };

            let sheet_id = match self.find_sheet_for_cell(mirror, &cell_id) {
                Some(sid) => sid,
                None => continue,
            };

            #[cfg(feature = "native")]
            let mut ctx = MirrorContext::with_range_store(mirror, cell_id, sheet_id, range_store)
                .with_sumifs_cache_epoch(self.current_sumifs_cache_epoch());
            #[cfg(not(feature = "native"))]
            let mut ctx = {
                let mut c = MirrorContext::new(mirror, cell_id, sheet_id);
                c.range_store = Some(range_store);
                c.sumifs_cache_epoch = self.current_sumifs_cache_epoch();
                c
            };
            ctx.ast_cache = Some(&self.ast_cache);
            ctx.access.ordered_sheets = ordered_sheets.clone();
            ctx.access.formula_text_provider = self.formula_text_provider();
            #[cfg(feature = "native")]
            {
                ctx.workbook_cache = Some(&self.workbook_cache);
            }

            let (formula_str, row, col, sheet_name_owned);
            if has_subscriber || cfg!(feature = "journal") {
                formula_str = self
                    .formula_strings
                    .get(&cell_id)
                    .map(|s| truncate_chars(s, 120))
                    .unwrap_or("");
                let pos = mirror
                    .resolve_position(&cell_id)
                    .unwrap_or(SheetPos::new(0, 0));
                row = pos.row();
                col = pos.col();
                sheet_name_owned = mirror
                    .get_sheet(&sheet_id)
                    .map(|s| s.name.clone())
                    .unwrap_or_default();
            } else {
                formula_str = "";
                row = 0;
                col = 0;
                sheet_name_owned = String::new();
            }
            let _eval_span = if has_subscriber {
                tracing::info_span!(
                    "eval_formula",
                    sheet = sheet_name_owned.as_str(),
                    row = row,
                    col = col,
                    formula = formula_str,
                )
                .entered()
            } else {
                tracing::Span::none().entered()
            };

            #[cfg(feature = "journal")]
            {
                crate::journal::record(crate::journal::JournalEvent::EvalStart {
                    cell: cell_id,
                    sheet: sheet_name_owned.clone(),
                    row,
                    col,
                    formula: formula_str.to_string(),
                });
            }

            let mut new_value =
                match crate::eval::sync_block_on(Evaluator::evaluate(&entry.ast, &ctx, &ctx)) {
                    Ok(val) => {
                        metrics.cells_evaluated += 1;
                        if matches!(val, CellValue::Error(..)) {
                            metrics.cells_with_errors += 1;
                        }
                        val
                    }
                    Err(e) => {
                        metrics.cells_evaluated += 1;
                        metrics.cells_with_errors += 1;
                        errors.push(CellErrorInfo {
                            cell_id: cell_id.to_uuid_string(),
                            sheet_id: sheet_id.to_uuid_string(),
                            error: e.to_string(),
                        });
                        CellValue::Error(CellError::Calc, None)
                    }
                };

            #[cfg(feature = "journal")]
            {
                let value_type = match &new_value {
                    CellValue::Number(_) => "Number",
                    CellValue::Text(_) => "Text",
                    CellValue::Boolean(_) => "Boolean",
                    CellValue::Error(..) => "Error",
                    CellValue::Null => "Null",
                    CellValue::Array(_) => "Array",
                    CellValue::Image(_) => "Image",
                };
                crate::journal::record(crate::journal::JournalEvent::EvalResult {
                    cell: cell_id,
                    value_type,
                    value_summary: crate::journal::journal_fmt_value(&new_value),
                });
            }

            drop(_eval_span);

            // Dynamic array spill handling
            self.apply_spill_handling_with_deltas(
                mirror,
                cell_id,
                sheet_id,
                &mut new_value,
                projection_changes,
                projection_deltas,
            );

            // Excel coercion: a formula whose final result is Null produces Number(0).
            // Intermediate Null is preserved during evaluation (so ISBLANK works).
            if matches!(new_value, CellValue::Null) {
                new_value = CellValue::number(0.0);
            }

            // Dynamic array source cells: store Array in the cell entry,
            // but write the top-left scalar to col_data so aggregation reads
            // (SUM, DenseColumn, etc.) see the scalar, not the full array.
            if let CellValue::Array(ref arr) = new_value {
                let top_left = arr.get(0, 0).cloned().unwrap_or(CellValue::Null);
                // Compare by reference first to avoid cloning old_value when unchanged.
                let stored = mirror.get_cell_value(&cell_id);
                let changed = stored.is_none_or(|s| !values_equal(s, &top_left));
                let old_value = if changed {
                    stored.cloned().unwrap_or(CellValue::Null)
                } else {
                    CellValue::Null // won't be used
                };
                mirror.set_value_mut(&cell_id, top_left.clone());
                mirror.set_entry_value_only(&cell_id, new_value.clone());

                if changed
                    && let Some((_sid, mut change)) =
                        self.make_cell_change(mirror, &cell_id, &top_left)
                {
                    change.old_value = Some(old_value);
                    changed_cells.push(change);
                }
            } else {
                // Compare by reference first to avoid cloning old_value when unchanged.
                let stored = mirror.get_cell_value(&cell_id);
                let changed = stored.is_none_or(|s| !values_equal(s, &new_value));
                let old_value = if changed {
                    stored.cloned().unwrap_or(CellValue::Null)
                } else {
                    CellValue::Null // won't be used
                };
                mirror.set_value_mut(&cell_id, new_value.clone());

                if changed
                    && let Some((_sid, mut change)) =
                        self.make_cell_change(mirror, &cell_id, &new_value)
                {
                    change.old_value = Some(old_value);
                    changed_cells.push(change);
                }
            }
        }
    }

    /// Evaluate a level of cells in parallel using rayon (two-phase approach).
    ///
    /// Pass 1: Evaluate all formulas concurrently using shared `&self` references.
    ///          Each cell reads from the mirror but does not write.
    /// Pass 2: Apply results sequentially (writes to mirror, spill handling).
    ///
    /// `sumifs_warm_data`: pre-warmed SUMIFS result cache entries from the agg
    /// prepass. If `Some`, each rayon worker thread seeds its thread-local cache
    /// before evaluating formulas, enabling O(1) cache hits for SUMIFS lookups
    /// that were pre-computed on the main thread.
    #[cfg(feature = "native")]
    #[allow(clippy::too_many_arguments)]
    pub(super) fn topo_evaluate_level_parallel(
        &mut self,
        mirror: &mut CellMirror,
        level: &[CellId],
        changed_cells: &mut Vec<CellChange>,
        projection_changes: &mut Vec<ProjectionChange>,
        errors: &mut Vec<CellErrorInfo>,
        range_store: &crate::eval::cache::range_store::RangeStore,
        projection_deltas: &mut Vec<ProjectionDelta>,
        metrics: &mut RecalcMetrics,
        sumifs_warm_data: &Option<compute_functions::helpers::sumifs_result_cache::SumifsWarmData>,
    ) {
        use rayon::prelude::*;

        // Pass 1: Parallel read-only evaluation with per-formula timing
        let results: Vec<(CellId, SheetId, CellValue, Option<String>, u64)> = {
            let _span = tracing::info_span!("par_eval_phase", cells = level.len()).entered();
            let mirror_ref = &*mirror;
            let ast_cache = &self.ast_cache;
            let formula_strings = &self.formula_strings;
            let cell_formula_text = &self.cell_formula_text;
            let workbook_cache = &self.workbook_cache;
            let sumifs_epoch = self.current_sumifs_cache_epoch();

            level
                .par_iter()
                .filter_map(|&cell_id| {
                    // Seed the SUMIFS result cache on this rayon worker thread.
                    // The helper is epoch-aware, so stale warm data is ignored
                    // and same-epoch entries are replaced with the prepass map.
                    if let (Some(epoch), Some(warm)) = (sumifs_epoch, sumifs_warm_data.as_ref()) {
                        compute_functions::helpers::sumifs_result_cache::seed_warm_data(
                            epoch, warm,
                        );
                    }
                    let entry = ast_cache.get(&cell_id)?;
                    let sheet_id = Self::find_sheet_for_cell_in_mirror(mirror_ref, &cell_id)?;

                    let mut ctx =
                        MirrorContext::with_range_store(mirror, cell_id, sheet_id, range_store)
                            .with_sumifs_cache_epoch(sumifs_epoch);
                    ctx.ast_cache = Some(ast_cache);
                    ctx.access.formula_text_provider =
                        FormulaTextProvider::new(cell_formula_text, formula_strings);
                    {
                        ctx.workbook_cache = Some(workbook_cache);
                    }

                    // Only compute span fields and timing when a tracing subscriber
                    // is active. This avoids 3 HashMap lookups + string truncation +
                    // Instant::now() per formula when profiling is off.
                    let has_subscriber = tracing::dispatcher::has_been_set();
                    let _eval_span = if has_subscriber {
                        let formula_str = formula_strings
                            .get(&cell_id)
                            .map(|s| truncate_chars(s, 120))
                            .unwrap_or("");
                        let pos = mirror
                            .resolve_position(&cell_id)
                            .unwrap_or(SheetPos::new(0, 0));
                        let (row, col) = (pos.row(), pos.col());
                        let sheet_name = mirror
                            .get_sheet(&sheet_id)
                            .map(|s| s.name.as_str())
                            .unwrap_or("");
                        tracing::info_span!(
                            "eval_formula",
                            sheet = sheet_name,
                            row = row,
                            col = col,
                            formula = formula_str,
                        )
                        .entered()
                    } else {
                        tracing::Span::none().entered()
                    };

                    let start = if has_subscriber {
                        Some(crate::time_compat::WasmSafeInstant::now())
                    } else {
                        None
                    };
                    let (value, error_msg) = match crate::eval::sync_block_on(Evaluator::evaluate(
                        &entry.ast, &ctx, &ctx,
                    )) {
                        Ok(val) => (val, None),
                        Err(e) => (CellValue::Error(CellError::Calc, None), Some(e.to_string())),
                    };
                    let elapsed_us = start.map(|s| s.elapsed().as_micros() as u64).unwrap_or(0);

                    drop(_eval_span);

                    Some((cell_id, sheet_id, value, error_msg, elapsed_us))
                })
                .collect()
        };

        // Emit per-formula timing histogram (captured by profiling layer)
        if !results.is_empty() {
            let mut times_us: Vec<u64> = results.iter().map(|r| r.4).collect();
            times_us.sort_unstable();
            let count = times_us.len();
            let sum: u64 = times_us.iter().sum();
            let slow_1ms = times_us.iter().filter(|&&t| t > 1000).count() as u64;
            let slow_10ms = times_us.iter().filter(|&&t| t > 10_000).count() as u64;

            let _timing = tracing::info_span!(
                "formula_eval_timing",
                level_cells = count as u64,
                cpu_sum_us = sum,
                min_us = times_us[0],
                max_us = *times_us.last().unwrap(),
                avg_us = sum / count as u64,
                median_us = times_us[count / 2],
                p95_us = times_us[count * 95 / 100],
                p99_us = times_us[count.saturating_sub(1) * 99 / 100],
                slow_1ms_count = slow_1ms,
                slow_10ms_count = slow_10ms,
            )
            .entered();
        }

        // Pass 2: Sequential apply (writes to mirror + spill handling)
        #[cfg(feature = "journal")]
        {
            crate::journal::record(crate::journal::JournalEvent::ParallelApplyStart {
                level: 0, // Level index not available in this scope
                cell_count: results.len() as u32,
            });
        }

        let _apply_span =
            tracing::info_span!("apply_results_phase", results = results.len()).entered();
        for (cell_id, sheet_id, mut new_value, error_msg, _eval_us) in results {
            // Track metrics for parallel-evaluated cells (Task 1.5b)
            metrics.cells_evaluated += 1;
            if error_msg.is_some() || matches!(new_value, CellValue::Error(..)) {
                metrics.cells_with_errors += 1;
            }

            if let Some(msg) = error_msg {
                errors.push(CellErrorInfo {
                    cell_id: cell_id.to_uuid_string(),
                    sheet_id: sheet_id.to_uuid_string(),
                    error: msg,
                });
            }

            #[cfg(feature = "journal")]
            {
                // Reconstruct EvalStart from captured data
                let formula_str_j = self
                    .formula_strings
                    .get(&cell_id)
                    .map(|s| super::truncate_chars(s, 120).to_string())
                    .unwrap_or_default();
                let pos = mirror
                    .resolve_position(&cell_id)
                    .unwrap_or(cell_types::SheetPos::new(0, 0));
                let sheet_name_j = mirror
                    .get_sheet(&sheet_id)
                    .map(|s| s.name.clone())
                    .unwrap_or_default();
                crate::journal::record(crate::journal::JournalEvent::EvalStart {
                    cell: cell_id,
                    sheet: sheet_name_j,
                    row: pos.row(),
                    col: pos.col(),
                    formula: formula_str_j,
                });
                let value_type = match &new_value {
                    CellValue::Number(_) => "Number",
                    CellValue::Text(_) => "Text",
                    CellValue::Boolean(_) => "Boolean",
                    CellValue::Error(..) => "Error",
                    CellValue::Null => "Null",
                    CellValue::Array(_) => "Array",
                    CellValue::Image(_) => "Image",
                };
                crate::journal::record(crate::journal::JournalEvent::EvalResult {
                    cell: cell_id,
                    value_type,
                    value_summary: crate::journal::journal_fmt_value(&new_value),
                });
            }

            // Dynamic array spill handling (must be sequential)
            self.apply_spill_handling_with_deltas(
                mirror,
                cell_id,
                sheet_id,
                &mut new_value,
                projection_changes,
                projection_deltas,
            );

            // Excel coercion: a formula whose final result is Null produces Number(0).
            // Intermediate Null is preserved during evaluation (so ISBLANK works).
            if matches!(new_value, CellValue::Null) {
                new_value = CellValue::number(0.0);
            }

            // Dynamic array source cells: store Array in the cell entry,
            // but write the top-left scalar to col_data so aggregation reads
            // (SUM, DenseColumn, etc.) see the scalar, not the full array.
            if let CellValue::Array(ref arr) = new_value {
                let top_left = arr.get(0, 0).cloned().unwrap_or(CellValue::Null);
                // Compare by reference first to avoid cloning old_value when unchanged.
                let stored = mirror.get_cell_value(&cell_id);
                let changed = stored.is_none_or(|s| !values_equal(s, &top_left));
                let old_value = if changed {
                    stored.cloned().unwrap_or(CellValue::Null)
                } else {
                    CellValue::Null // won't be used
                };
                // Write top-left scalar to both entry.value and col_data
                mirror.set_value_mut(&cell_id, top_left.clone());
                // Overwrite entry.value with the full Array (col_data keeps scalar)
                mirror.set_entry_value_only(&cell_id, new_value.clone());

                if changed
                    && let Some((_sid, mut change)) =
                        self.make_cell_change(mirror, &cell_id, &top_left)
                {
                    change.old_value = Some(old_value);
                    changed_cells.push(change);
                }
            } else {
                // Compare by reference first to avoid cloning old_value when unchanged.
                let stored = mirror.get_cell_value(&cell_id);
                let changed = stored.is_none_or(|s| !values_equal(s, &new_value));
                let old_value = if changed {
                    stored.cloned().unwrap_or(CellValue::Null)
                } else {
                    CellValue::Null // won't be used
                };
                mirror.set_value_mut(&cell_id, new_value.clone());

                if changed
                    && let Some((_sid, mut change)) =
                        self.make_cell_change(mirror, &cell_id, &new_value)
                {
                    change.old_value = Some(old_value);
                    changed_cells.push(change);
                }
            }
        }
    }

    /// Find which sheet a cell belongs to (static helper for parallel evaluation).
    /// Takes `&CellMirror` instead of `&self` to avoid capturing `&mut self`.
    /// Uses O(1) reverse index lookup.
    #[cfg(feature = "native")]
    pub(super) fn find_sheet_for_cell_in_mirror(
        mirror: &CellMirror,
        cell_id: &CellId,
    ) -> Option<SheetId> {
        mirror.sheet_for_cell(cell_id)
    }
}
