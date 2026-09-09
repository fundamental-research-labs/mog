//! Main CF evaluation entry point.
//!
//! Dispatches to individual rule matchers and visual computations.
//! Ported from TypeScript `evaluateRule` and `evaluateRules` in
//! `spreadsheet-model/src/conditional-format/rule-evaluator.ts` (lines 625-703).

use crate::priority;
use crate::rules;
use crate::stats::RangeStatistics;
use crate::types::{CFMatchResult, CFRule, CFRuleKind};
use crate::visual;
use chrono::NaiveDate;
use value_types::CellValue;
use value_types::date_serial::DateSystem;

/// Calendar context for conditional formatting. Cell values and numeric rule
/// thresholds remain in workbook units; only time-period rules interpret dates.
#[derive(Debug, Clone, Copy)]
pub struct CFEvaluationContext {
    pub now: NaiveDate,
    pub date_system: DateSystem,
}

impl CFEvaluationContext {
    /// Compatibility context for callers using the Excel 1900 date system.
    pub fn new(now: NaiveDate) -> Self {
        Self {
            now,
            date_system: DateSystem::default(),
        }
    }
}

// =============================================================================
// Helper: coerce to visual number
// =============================================================================

/// Coerce a CellValue to f64 for visual rules (ColorScale, DataBar, IconSet).
/// Boolean TRUE = 1.0, FALSE = 0.0 (Excel behavior).
fn coerce_to_visual_number(value: &CellValue) -> Option<f64> {
    match value {
        CellValue::Number(n) => Some(n.get()),
        CellValue::Boolean(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

// =============================================================================
// evaluate_rule
// =============================================================================

/// Evaluate a single CF rule against a cell value.
///
/// Returns `Some(CFMatchResult)` if the rule matches, `None` otherwise.
///
/// For style-based rules, the result contains the matched style.
/// For visual rules (ColorScale, DataBar, IconSet), the result contains
/// the computed visual data. Non-numeric values return `None` for visual rules.
///
/// The `formula_result` parameter is the pre-evaluated result of the formula
/// (for formula-based rules). The caller is responsible for evaluating the formula
/// and passing the result here.
pub fn evaluate_rule(
    value: &CellValue,
    rule: &CFRule,
    stats: &RangeStatistics,
    formula_result: Option<&CellValue>,
    now: NaiveDate,
) -> Option<CFMatchResult> {
    evaluate_rule_for_cell(value, rule, stats, formula_result, now, false)
}

/// Evaluate a single CF rule with metadata for the target cell.
pub fn evaluate_rule_for_cell(
    value: &CellValue,
    rule: &CFRule,
    stats: &RangeStatistics,
    formula_result: Option<&CellValue>,
    now: NaiveDate,
    has_formula: bool,
) -> Option<CFMatchResult> {
    evaluate_rule_for_cell_with_context(
        value,
        rule,
        stats,
        formula_result,
        CFEvaluationContext::new(now),
        has_formula,
    )
}

/// Evaluate a rule using the workbook's calendar context and target-cell metadata.
pub fn evaluate_rule_for_cell_with_context(
    value: &CellValue,
    rule: &CFRule,
    stats: &RangeStatistics,
    formula_result: Option<&CellValue>,
    context: CFEvaluationContext,
    has_formula: bool,
) -> Option<CFMatchResult> {
    match &rule.kind {
        // -----------------------------------------------------------------
        // Style-based rules: return CFMatchResult with style
        // -----------------------------------------------------------------
        CFRuleKind::CellValue { comparison } => {
            if !rules::cell_value::evaluate_cell_value(value, comparison) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::Formula { .. } => {
            if !rules::formula::evaluate_formula(formula_result) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::Top10 {
            rank,
            percent,
            bottom,
        } => {
            if !rules::top_bottom::evaluate_top_bottom(value, *rank, *percent, *bottom, stats) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::AboveAverage {
            above,
            equal_average,
            std_dev,
        } => {
            if !rules::above_average::evaluate_above_average(
                value,
                *above,
                *equal_average,
                *std_dev,
                stats,
            ) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::DuplicateValues { unique } => {
            if !rules::duplicate::evaluate_duplicate(value, *unique, stats) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::ContainsText { operator, text } => {
            if !rules::text::evaluate_text(value, operator, text) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::ContainsBlanks { blanks } => {
            if !rules::blanks_errors::evaluate_blanks_for_cell(value, *blanks, has_formula) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::ContainsErrors { errors } => {
            if !rules::blanks_errors::evaluate_errors(value, *errors) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        CFRuleKind::TimePeriod { period } => {
            if !rules::time_period::evaluate_time_period_with_date_system(
                value,
                period,
                context.now,
                context.date_system,
            ) {
                return None;
            }
            Some(CFMatchResult::from_style(rule.style.clone()))
        }

        // -----------------------------------------------------------------
        // Visual rules: return CFMatchResult with computed visual data
        // Booleans coerce to numbers: TRUE=1.0, FALSE=0.0 (Excel behavior).
        // -----------------------------------------------------------------
        CFRuleKind::ColorScale(cs) => {
            let num = coerce_to_visual_number(value)?;
            let color_scale_result = visual::color_scale::compute_color_scale(num, cs, stats);
            Some(CFMatchResult {
                color_scale: Some(color_scale_result),
                ..Default::default()
            })
        }

        CFRuleKind::DataBar(db) => {
            let num = coerce_to_visual_number(value)?;
            let data_bar_result = visual::data_bar::compute_data_bar(num, db, stats);
            Some(CFMatchResult {
                data_bar: Some(data_bar_result),
                ..Default::default()
            })
        }

        CFRuleKind::IconSet(is) => {
            let num = coerce_to_visual_number(value)?;
            let icon_result = visual::icon_set::compute_icon(num, is, stats)?;
            Some(CFMatchResult {
                icon: Some(icon_result),
                ..Default::default()
            })
        }
    }
}

// =============================================================================
// CascadeEvaluator
// =============================================================================

/// Stateful cascade evaluator that stops all lower-priority rules after a match.
///
/// Captures the cascade logic (stop-if-true + merge) in one place.
/// Both `evaluate_rules()` and the scheduler delegate to this.
pub struct CascadeEvaluator {
    result: Option<CFMatchResult>,
    stopped: bool,
}

impl Default for CascadeEvaluator {
    fn default() -> Self {
        Self::new()
    }
}

impl CascadeEvaluator {
    pub fn new() -> Self {
        Self {
            result: None,
            stopped: false,
        }
    }

    /// Check whether a matching higher-priority rule stopped this cell's cascade.
    /// Lets the caller skip expensive work (e.g., formula evaluation).
    pub fn is_stopped(&self) -> bool {
        self.stopped
    }

    /// Evaluate a single rule and merge the result if it matches.
    pub fn apply(
        &mut self,
        value: &CellValue,
        rule: &CFRule,
        stats: &RangeStatistics,
        formula_result: Option<&CellValue>,
        now: NaiveDate,
    ) -> &mut Self {
        self.apply_for_cell(value, rule, stats, formula_result, now, false)
    }

    /// Evaluate a single rule with metadata for the target cell and merge the
    /// result if it matches.
    pub fn apply_for_cell(
        &mut self,
        value: &CellValue,
        rule: &CFRule,
        stats: &RangeStatistics,
        formula_result: Option<&CellValue>,
        now: NaiveDate,
        has_formula: bool,
    ) -> &mut Self {
        self.apply_for_cell_with_context(
            value,
            rule,
            stats,
            formula_result,
            CFEvaluationContext::new(now),
            has_formula,
        )
    }

    /// Merge a rule using the workbook's calendar context and cell metadata.
    pub fn apply_for_cell_with_context(
        &mut self,
        value: &CellValue,
        rule: &CFRule,
        stats: &RangeStatistics,
        formula_result: Option<&CellValue>,
        context: CFEvaluationContext,
        has_formula: bool,
    ) -> &mut Self {
        if self.stopped {
            return self;
        }

        if let Some(rule_result) = evaluate_rule_for_cell_with_context(
            value,
            rule,
            stats,
            formula_result,
            context,
            has_formula,
        ) {
            self.result = Some(match self.result.take() {
                Some(existing) => priority::merge_results(existing, rule_result),
                None => rule_result,
            });

            if rule.stop_if_true {
                self.stopped = true;
            }
        }

        self
    }

    /// Consume and return the accumulated result.
    pub fn finish(self) -> Option<CFMatchResult> {
        self.result
    }
}

// =============================================================================
// evaluate_rules
// =============================================================================

/// Evaluate multiple CF rules against a cell value.
///
/// Rules should be sorted by priority (lower number = higher priority = first).
/// A matching `stop_if_true` rule stops every lower-priority rule for the cell,
/// including rules with different visual or style properties. A matching rule
/// with no style still stops the cascade; earlier results remain intact.
///
/// Returns combined `CFMatchResult` from all matching rules, or `None` if no rules match.
///
/// Port of TypeScript `evaluateRules` (lines 681-703):
/// - Higher priority (earlier) rules' results take precedence.
/// - Style properties merge per-field (higher priority wins per-property).
/// - DataBar, ColorScale, Icon are exclusive (higher priority wins entirely).
///
/// **Limitation**: This function takes a single `RangeStatistics` which is only correct
/// when all rules share the same range. For per-rule statistics (when rules have different
/// ranges), use [`evaluate_rule`] directly for each rule with its own stats, as the
/// scheduler does.
///
/// `formula_results` provides per-rule pre-evaluated formula results.
/// `formula_results[i]` corresponds to `rules[i]`. If the slice is shorter than
/// `rules`, missing entries are treated as `None`.
pub fn evaluate_rules(
    value: &CellValue,
    rules: &[CFRule],
    stats: &RangeStatistics,
    formula_results: &[Option<CellValue>],
    now: NaiveDate,
) -> Option<CFMatchResult> {
    evaluate_rules_with_context(
        value,
        rules,
        stats,
        formula_results,
        CFEvaluationContext::new(now),
    )
}

/// Evaluate multiple rules in a workbook calendar context. Statistics and
/// non-calendar rule values retain their original numeric units.
pub fn evaluate_rules_with_context(
    value: &CellValue,
    rules: &[CFRule],
    stats: &RangeStatistics,
    formula_results: &[Option<CellValue>],
    context: CFEvaluationContext,
) -> Option<CFMatchResult> {
    debug_assert!(
        rules.windows(2).all(|w| w[0].priority <= w[1].priority),
        "CF rules must be sorted by priority (ascending)"
    );

    let mut cascade = CascadeEvaluator::new();
    for (i, rule) in rules.iter().enumerate() {
        let formula_result = formula_results.get(i).and_then(|r| r.as_ref());
        cascade.apply_for_cell_with_context(value, rule, stats, formula_result, context, false);
    }
    cascade.finish()
}

#[cfg(test)]
#[path = "evaluator_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "evaluator_bench_tests.rs"]
mod bench_tests;
