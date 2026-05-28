use value_types::CellValue;

use super::text::{
    contains_case_insensitive, ends_with_case_insensitive, starts_with_case_insensitive,
};
use super::wildcard::{has_wildcards, matches_wildcard_pattern};
use crate::types::{BinaryFilterOp, NullaryFilterOp, PivotFilterCondition, UnaryFilterOp};
use crate::values::cell_value_eq;

/// Check if a value matches a filter condition.
///
/// Pattern-matches on the type-safe [`PivotFilterCondition`] enum. Each variant
/// carries exactly the operands it needs — no `Option<CellValue>` guessing.
///
/// # `AboveAverage` / `BelowAverage`
///
/// These conditions require full-column context to compute the average. When called
/// directly (without column context), they return `true` (pass-through). The
/// orchestration layer handles them specially by computing the column average first.
///
/// # Wildcard support
///
/// Text conditions (Contains, `StartsWith`, `EndsWith`, Equals) support `*` (any chars)
/// and `?` (single char) wildcards. If no wildcards are present, simple string
/// matching is used for performance.
#[must_use]
pub fn matches_condition(value: &CellValue, condition: &PivotFilterCondition) -> bool {
    match condition {
        // -- Nullary: no operands --
        PivotFilterCondition::Nullary(op) => match op {
            NullaryFilterOp::IsBlank => value.is_visually_blank(),
            NullaryFilterOp::IsNotBlank => !value.is_visually_blank(),
            // AboveAverage/BelowAverage need full-column context; handled by orchestration layer.
            // When called directly, pass through.
            NullaryFilterOp::AboveAverage | NullaryFilterOp::BelowAverage => true,
        },

        // -- Unary: one operand --
        PivotFilterCondition::Unary { op, value: target } => match op {
            UnaryFilterOp::Equals => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &p_lower)
                    } else {
                        s.eq_ignore_ascii_case(pattern)
                            || (!s.is_ascii() || !pattern.is_ascii())
                                && s.to_lowercase() == pattern.to_lowercase()
                    }
                }
                _ => cell_value_eq(value, target),
            },
            UnaryFilterOp::NotEquals => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        !matches_wildcard_pattern(&s_lower, &p_lower)
                    } else {
                        !s.eq_ignore_ascii_case(pattern)
                            && (s.is_ascii() && pattern.is_ascii()
                                || s.to_lowercase() != pattern.to_lowercase())
                    }
                }
                _ => !cell_value_eq(value, target),
            },
            UnaryFilterOp::Contains => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &format!("*{p_lower}*"))
                    } else {
                        contains_case_insensitive(s, pattern)
                    }
                }
                _ => false,
            },
            UnaryFilterOp::NotContains => {
                match (value, target) {
                    (CellValue::Text(s), CellValue::Text(pattern)) => {
                        if has_wildcards(pattern) {
                            let s_lower = s.to_lowercase();
                            let p_lower = pattern.to_lowercase();
                            !matches_wildcard_pattern(&s_lower, &format!("*{p_lower}*"))
                        } else {
                            !contains_case_insensitive(s, pattern)
                        }
                    }
                    // Non-text values don't contain any text pattern.
                    _ => true,
                }
            }
            UnaryFilterOp::StartsWith => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &format!("{p_lower}*"))
                    } else {
                        starts_with_case_insensitive(s, pattern)
                    }
                }
                _ => false,
            },
            UnaryFilterOp::EndsWith => match (value, target) {
                (CellValue::Text(s), CellValue::Text(pattern)) => {
                    if has_wildcards(pattern) {
                        let s_lower = s.to_lowercase();
                        let p_lower = pattern.to_lowercase();
                        matches_wildcard_pattern(&s_lower, &format!("*{p_lower}"))
                    } else {
                        ends_with_case_insensitive(s, pattern)
                    }
                }
                _ => false,
            },
            UnaryFilterOp::GreaterThan => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => a > b,
                _ => false,
            },
            UnaryFilterOp::GreaterThanOrEqual => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => a >= b,
                _ => false,
            },
            UnaryFilterOp::LessThan => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => *a < *b,
                _ => false,
            },
            UnaryFilterOp::LessThanOrEqual => match (value, target) {
                (CellValue::Number(a), CellValue::Number(b)) => *a <= *b,
                _ => false,
            },
        },

        // -- Binary: two operands (range operations) --
        PivotFilterCondition::Binary {
            op,
            value: lo,
            value2: hi,
        } => match op {
            BinaryFilterOp::Between => match (value, lo, hi) {
                (CellValue::Number(v), CellValue::Number(a), CellValue::Number(b)) => {
                    *v >= *a && *v <= *b
                }
                _ => false,
            },
            BinaryFilterOp::NotBetween => {
                match (value, lo, hi) {
                    (CellValue::Number(v), CellValue::Number(a), CellValue::Number(b)) => {
                        *v < *a || *v > *b
                    }
                    // Non-number is not between anything (mirrors Excel/TS behavior).
                    _ => true,
                }
            }
        },
        _ => false, // future PivotFilterCondition variants
    }
}
