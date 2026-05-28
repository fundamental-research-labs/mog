use crate::a1_entry::{parse_a1_cell, parse_a1_range, split_sheet_prefix};
use crate::ast::CellRefNode;

use super::broken_ref::classify_broken_ref;
use super::literal::try_parse_constant_literal;
use super::{FormulaSource, ParsedExpr, SqrefList};

impl ParsedExpr {
    /// Total classification of an arbitrary UTF-8 string.
    ///
    /// See the module-level docs for the precedence order.
    #[must_use]
    pub fn classify(input: &str) -> Self {
        if input.trim().is_empty() {
            return Self::Empty;
        }

        if let Some(expr) = classify_broken_ref(input) {
            return expr;
        }

        if let Some(node) = parse_a1_cell(input) {
            return Self::Cell(node);
        }
        if let Some(node) = parse_sheet_qualified_cell(input) {
            return Self::Cell(node);
        }

        if let Some(r) = parse_a1_range(input) {
            return Self::Range(r);
        }

        if input.split_whitespace().count() >= 2
            && let Some(list) = SqrefList::parse(input)
        {
            return Self::SqrefList(list);
        }

        if let Some(v) = try_parse_constant_literal(input) {
            return Self::Constant(v);
        }

        Self::Formula(FormulaSource::parse(input))
    }
}

/// Peel a `Sheet!` or `'Quoted Sheet'!` prefix, then re-classify the remainder
/// as a bare A1 cell.
fn parse_sheet_qualified_cell(input: &str) -> Option<CellRefNode> {
    let trimmed = input.trim();
    let stripped = trimmed.strip_prefix('=').unwrap_or(trimmed);
    let (sheet, rest) = split_sheet_prefix(stripped);
    sheet?;
    parse_a1_cell(rest)
}
