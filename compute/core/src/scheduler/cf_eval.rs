//! Conditional formatting evaluation.
//!
//! Contains the `eval_cf` method on `ComputeCore` which evaluates all CF rules
//! for a sheet — resolving ranges, computing statistics, evaluating formula-based
//! rules per cell, and returning visual properties for matching cells.

use super::ast_transform::shift_ast_for_cf;
use super::*;

use crate::eval::Evaluator;
use crate::eval_bridge::MirrorContext;
use cell_types::CellId;
use compute_parser::ASTNode;
use compute_parser::parse_formula;

/// Applicable CF rule entry: (rule, range_statistics, optional parsed formula).
type ApplicableCFEntry<'a> = (
    &'a crate::cf::types::CFRule,
    &'a crate::cf::stats::RangeStatistics,
    Option<&'a (ASTNode, u32, u32)>,
);

impl ComputeCore {
    /// Evaluate all CF rules for a sheet. Pure computation: reads from CellMirror.
    ///
    /// Called via IPC (Tauri) or WASM (web). Each rule carries its own applies-to
    /// ranges as `Vec<RangePos>` (position-native, resolved at read time by the
    /// engine boundary layer). Stats are computed per-rule.
    ///
    /// Returns fully resolved visual properties for each cell that matches at
    /// least one rule. The TS bridge caches these, the renderer reads from cache.
    pub fn eval_cf(
        &self,
        mirror: &CellMirror,
        sheet_id: &SheetId,
        rules: &[crate::cf::types::CFRule],
    ) -> Vec<crate::cf::types::CellCFResult> {
        use crate::cf::stats::compute_range_stats;
        use cell_types::RangePos;

        let sheet = match mirror.get_sheet(sheet_id) {
            Some(s) => s,
            None => return Vec::new(),
        };

        // Compute "now" once for all time-period rules. Reads through the
        // injected clock so cloud workers honor the session userTimezone.
        let now = crate::eval::clock::current_calendar_date();

        // 1. Process each rule's RangePos ranges: clamp to sheet bounds,
        //    compute statistics, and parse formula ASTs.
        struct ResolvedRule {
            rule_idx: usize,
            ranges: Vec<RangePos>,
            stats: crate::cf::stats::RangeStatistics,
            /// Pre-parsed AST for Formula rules (None for non-formula rules).
            /// The origin_row/origin_col are the top-left of the first range,
            /// used as the base for relative reference shifting.
            parsed_formula: Option<(ASTNode, u32, u32)>,
        }

        let mut resolved_rules: Vec<ResolvedRule> = Vec::with_capacity(rules.len());

        for (i, rule) in rules.iter().enumerate() {
            let mut ranges = Vec::with_capacity(rule.ranges.len());
            let mut all_range_stats: Vec<crate::cf::stats::RangeStatistics> = Vec::new();

            for rp in &rule.ranges {
                // Clamp the range to the sheet's actual dimensions to avoid
                // iterating over millions of empty cells when a CF rule
                // covers the "full sheet" (e.g. 1M x 16K).
                let clamped_end_row = rp.end_row().min(sheet.rows.saturating_sub(1));
                let clamped_end_col = rp.end_col().min(sheet.cols.saturating_sub(1));

                // Skip ranges that are entirely outside the sheet bounds.
                if rp.start_row() > clamped_end_row || rp.start_col() > clamped_end_col {
                    continue;
                }

                // Guard: if the clamped range still exceeds 1M cells,
                // further clip to the sheet's populated data bounds to avoid
                // CPU spin on sparse ranges.
                let total_cells = (clamped_end_row as u64 - rp.start_row() as u64 + 1)
                    * (clamped_end_col as u64 - rp.start_col() as u64 + 1);
                if total_cells > 1_000_000 {
                    // For very large ranges, iterate only over cells that
                    // actually exist in the mirror rather than the full grid.
                    let range_stats = compute_range_stats_from_mirror(
                        mirror,
                        sheet_id,
                        rp,
                        clamped_end_row,
                        clamped_end_col,
                    );
                    all_range_stats.push(range_stats);
                    ranges.push(*rp);
                    continue;
                }

                let effective_end_row = clamped_end_row;
                let effective_end_col = clamped_end_col;

                // Collect cell values from the mirror for this range
                let mut range_values: Vec<value_types::CellValue> = Vec::new();
                for r in rp.start_row()..=effective_end_row {
                    for c in rp.start_col()..=effective_end_col {
                        if let Some(cv) = mirror.get_cell_value_at(sheet_id, SheetPos::new(r, c)) {
                            range_values.push(cv.clone());
                        }
                    }
                }

                // Accumulate stats across all ranges for this rule
                let range_stats = compute_range_stats(&range_values);
                all_range_stats.push(range_stats);

                ranges.push(*rp);
            }

            if ranges.is_empty() {
                continue;
            }

            let stats = crate::cf::stats::RangeStatistics::merge(&all_range_stats);

            // For formula-based rules, parse the formula once and record the
            // origin (top-left of the first range) for reference shifting.
            let parsed_formula =
                if let crate::cf::types::CFRuleKind::Formula { ref formula, .. } = rule.kind {
                    // Normalize: ensure the formula starts with '=' for the parser
                    let formula_str = if formula.starts_with('=') {
                        formula.clone()
                    } else {
                        format!("={}", formula)
                    };
                    // Parse without a resolver so all refs become Positional with SheetId(0)
                    match parse_formula(&formula_str, None) {
                        Ok(spanned) => {
                            let ast = spanned.into_inner();
                            let origin_row = ranges[0].start_row();
                            let origin_col = ranges[0].start_col();
                            Some((ast, origin_row, origin_col))
                        }
                        Err(_) => None, // Invalid formula — will be skipped during eval
                    }
                } else {
                    None
                };

            resolved_rules.push(ResolvedRule {
                rule_idx: i,
                ranges,
                stats,
                parsed_formula,
            });
        }

        if resolved_rules.is_empty() {
            return Vec::new();
        }

        // 2. Collect all unique cells covered by any rule's resolved ranges.
        //    Clamp to sheet dimensions to avoid materializing billions of
        //    positions when a rule covers the full sheet.
        let sheet_max_row = sheet.rows.saturating_sub(1);
        let sheet_max_col = sheet.cols.saturating_sub(1);
        let mut cell_positions: FxHashSet<(u32, u32)> = FxHashSet::default();
        for rr in &resolved_rules {
            for rp in &rr.ranges {
                let eff_end_row = rp.end_row().min(sheet_max_row);
                let eff_end_col = rp.end_col().min(sheet_max_col);
                let range_size = (eff_end_row as u64 - rp.start_row() as u64 + 1)
                    * (eff_end_col as u64 - rp.start_col() as u64 + 1);
                if range_size > 1_000_000 {
                    // For very large ranges, only evaluate cells that actually
                    // have data. Iterate column-by-column using dense storage.
                    for c in rp.start_col()..=eff_end_col {
                        if let Some(col_slice) = sheet.get_column_slice(c) {
                            let row_end = (col_slice.len() as u32).min(eff_end_row + 1);
                            for r in rp.start_row()..row_end {
                                if !matches!(
                                    col_slice.get(r as usize),
                                    Some(value_types::CellValue::Null) | None
                                ) {
                                    cell_positions.insert((r, c));
                                }
                            }
                        }
                    }
                } else {
                    for row in rp.start_row()..=eff_end_row {
                        for col in rp.start_col()..=eff_end_col {
                            cell_positions.insert((row, col));
                        }
                    }
                }
            }
        }

        // 3. Precompute cell→rules mapping by iterating rules (in order) and
        //    marking which cells each rule applies to. This replaces the previous
        //    O(cells × rules × ranges_per_rule) linear scan with a single pass
        //    that builds per-cell applicable-rule lists.
        //    Rule iteration order is preserved per cell (important for priority sort stability).
        let mut cell_applicable: FxHashMap<(u32, u32), Vec<ApplicableCFEntry<'_>>> =
            FxHashMap::default();
        for rr in &resolved_rules {
            let entry: ApplicableCFEntry<'_> =
                (&rules[rr.rule_idx], &rr.stats, rr.parsed_formula.as_ref());
            for rp in &rr.ranges {
                let eff_end_row = rp.end_row().min(sheet_max_row);
                let eff_end_col = rp.end_col().min(sheet_max_col);
                let range_size = (eff_end_row as u64 - rp.start_row() as u64 + 1)
                    * (eff_end_col as u64 - rp.start_col() as u64 + 1);
                if range_size > 1_000_000 {
                    // Large range: only check cells that exist in cell_positions
                    for &(row, col) in &cell_positions {
                        if row >= rp.start_row()
                            && row <= eff_end_row
                            && col >= rp.start_col()
                            && col <= eff_end_col
                        {
                            cell_applicable.entry((row, col)).or_default().push(entry);
                        }
                    }
                } else {
                    // Normal range: iterate range cells and check membership
                    for row in rp.start_row()..=eff_end_row {
                        for col in rp.start_col()..=eff_end_col {
                            if cell_positions.contains(&(row, col)) {
                                cell_applicable.entry((row, col)).or_default().push(entry);
                            }
                        }
                    }
                }
            }
        }

        let mut results = Vec::new();

        for &(row, col) in &cell_positions {
            let mut applicable = match cell_applicable.remove(&(row, col)) {
                Some(a) if !a.is_empty() => a,
                _ => continue,
            };

            let value = mirror
                .get_cell_value_at(sheet_id, SheetPos::new(row, col))
                .cloned()
                .unwrap_or(value_types::CellValue::Null);
            let has_formula = mirror
                .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                .is_some_and(|cell_id| mirror.get_formula(&cell_id).is_some());

            // Sort applicable rules by priority (lower number = higher priority = first)
            applicable.sort_by_key(|(r, _, _)| r.priority);

            // Evaluate all applicable rules for this cell using CascadeEvaluator.
            let mut cascade = crate::cf::evaluator::CascadeEvaluator::new();

            for (rule, stats, parsed_formula_opt) in &applicable {
                // Skip if this rule's category is already stopped
                if cascade.is_stopped(rule) {
                    continue;
                }

                // For formula-based rules, shift the AST to this cell's position
                // and evaluate it. The result is passed to evaluate_rule as formula_result.
                let formula_eval_result: Option<CellValue> =
                    if let Some((ast, origin_row, origin_col)) = parsed_formula_opt {
                        let row_delta = row as i64 - *origin_row as i64;
                        let col_delta = col as i64 - *origin_col as i64;
                        let shifted_ast = shift_ast_for_cf(ast, row_delta, col_delta, *sheet_id);

                        let cell_id = mirror
                            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
                            .unwrap_or(CellId::from_raw(0));
                        let ctx = MirrorContext::new(mirror, cell_id, *sheet_id);

                        crate::eval::sync_block_on(Evaluator::evaluate(&shifted_ast, &ctx, &ctx))
                            .ok()
                    } else {
                        None
                    };

                cascade.apply_for_cell(
                    &value,
                    rule,
                    stats,
                    formula_eval_result.as_ref(),
                    now,
                    has_formula,
                );
            }

            if let Some(m) = cascade.finish()
                && m.has_any()
            {
                results.push(m.into_cell_result(row, col));
            }
        }

        results
    }
}

/// Compute range statistics for a large CF range by iterating column-by-column
/// using dense column storage, avoiding the O(rows × cols) full-grid scan.
///
/// Only cells within the clamped range that have non-null values are included.
fn compute_range_stats_from_mirror(
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    rp: &cell_types::RangePos,
    clamped_end_row: u32,
    clamped_end_col: u32,
) -> crate::cf::stats::RangeStatistics {
    use crate::cf::stats::compute_range_stats;

    let sheet = match mirror.get_sheet(sheet_id) {
        Some(s) => s,
        None => return crate::cf::stats::RangeStatistics::default(),
    };

    // Collect values using dense column storage (fast path) rather than
    // iterating every cell in the range.
    let mut range_values: Vec<value_types::CellValue> = Vec::new();
    for c in rp.start_col()..=clamped_end_col {
        if let Some(col_slice) = sheet.get_column_slice(c) {
            let row_end = (col_slice.len() as u32).min(clamped_end_row + 1);
            for r in rp.start_row()..row_end {
                if let Some(cv) = col_slice.get(r as usize)
                    && !matches!(cv, value_types::CellValue::Null)
                {
                    range_values.push(cv.clone());
                }
            }
        }
    }

    compute_range_stats(&range_values)
}
