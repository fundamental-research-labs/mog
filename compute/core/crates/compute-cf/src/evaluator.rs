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
            if !rules::time_period::evaluate_time_period(value, period, now) {
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

/// Stateful cascade evaluator that tracks stop-if-true per category.
///
/// Captures the cascade logic (stop-if-true + merge) in one place.
/// Both `evaluate_rules()` and the scheduler delegate to this.
pub struct CascadeEvaluator {
    result: Option<CFMatchResult>,
    style_stopped: bool,
    visual_stopped: bool,
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
            style_stopped: false,
            visual_stopped: false,
        }
    }

    /// Check if a rule's category is already stopped.
    /// Lets the caller skip expensive work (e.g., formula evaluation).
    pub fn is_stopped(&self, rule: &CFRule) -> bool {
        let is_visual = rule.kind.is_visual();
        if is_visual {
            self.visual_stopped
        } else {
            self.style_stopped
        }
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
        let is_visual = rule.kind.is_visual();

        // Skip if this category has been stopped
        if is_visual && self.visual_stopped {
            return self;
        }
        if !is_visual && self.style_stopped {
            return self;
        }

        if let Some(rule_result) =
            evaluate_rule_for_cell(value, rule, stats, formula_result, now, has_formula)
        {
            self.result = Some(match self.result.take() {
                Some(existing) => priority::merge_results(existing, rule_result),
                None => rule_result,
            });

            if rule.stop_if_true {
                if is_visual {
                    self.visual_stopped = true;
                } else {
                    self.style_stopped = true;
                }
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
/// Handles stop-if-true with per-category semantics (matching Excel):
/// - Style rules (CellValue, Formula, Top10, etc.) and visual rules (ColorScale,
///   DataBar, IconSet) are separate categories.
/// - `stop_if_true` on a style rule stops only lower-priority style rules.
/// - `stop_if_true` on a visual rule stops only lower-priority visual rules.
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
    debug_assert!(
        rules.windows(2).all(|w| w[0].priority <= w[1].priority),
        "CF rules must be sorted by priority (ascending)"
    );

    let mut cascade = CascadeEvaluator::new();
    for (i, rule) in rules.iter().enumerate() {
        let formula_result = formula_results.get(i).and_then(|r| r.as_ref());
        cascade.apply(value, rule, stats, formula_result, now);
    }
    cascade.finish()
}

#[cfg(test)]
#[path = "evaluator_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "evaluator_bench_tests.rs"]
mod bench_tests;
