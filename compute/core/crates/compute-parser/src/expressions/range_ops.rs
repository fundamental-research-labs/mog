// UTF-8 boundary invariant: direct string slicing in this module consumes
// ASCII range, comma, and parenthesis delimiters.
#![allow(clippy::string_slice)]

use winnow::prelude::*;

use crate::ast::{ASTNode, BinOp};
use crate::lexer::{self, cut};
use crate::parser::ParseErrorKind;
use crate::state::ParseState;

use super::atom::parse_atomic;
use super::binding::{RANGE_L_BP, RANGE_R_BP, infix_bp};
use super::pratt::{parse_expr_bp, parse_expression};

pub(super) fn try_intersection(
    input: &mut &str,
    state: &ParseState,
    lhs: ASTNode,
    min_bp: u8,
) -> ModalResult<(ASTNode, bool)> {
    if !is_range_like(&lhs) || input.is_empty() {
        return Ok((lhs, false));
    }
    let first_byte = input.as_bytes()[0];
    if !first_byte.is_ascii_alphabetic() && first_byte != b'$' {
        return Ok((lhs, false));
    }
    let (l_bp, _r_bp) = infix_bp(BinOp::Intersect);
    if l_bp < min_bp {
        return Ok((lhs, false));
    }
    let saved = *input;
    match parse_atomic(input, state) {
        Ok(rhs) if is_range_like(&rhs) => {
            return Ok((
                ASTNode::BinaryOp {
                    op: BinOp::Intersect,
                    left: Box::new(lhs),
                    right: Box::new(rhs),
                },
                true,
            ));
        }
        Err(e) if matches!(e, winnow::error::ErrMode::Cut(_)) => {
            return Err(e);
        }
        _ => {}
    }
    *input = saved;
    Ok((lhs, false))
}

pub(super) fn try_expression_range_op(
    input: &mut &str,
    state: &ParseState,
    lhs: ASTNode,
    min_bp: u8,
) -> ModalResult<(ASTNode, bool)> {
    if !input.starts_with(':') || !is_range_endpoint(&lhs) {
        return Ok((lhs, false));
    }
    if RANGE_L_BP < min_bp {
        return Ok((lhs, false));
    }
    *input = &input[1..];
    let _ = lexer::ws.parse_next(input)?;
    let rhs = parse_expr_bp(input, state, RANGE_R_BP)?;
    Ok((
        ASTNode::RangeOp {
            start: Box::new(lhs),
            end: Box::new(rhs),
        },
        true,
    ))
}

pub(super) fn parse_paren_or_union(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let open_pos = state.offset(input) as usize;
    *input = &input[1..];
    let _ = lexer::ws.parse_next(input)?;
    let inner = match parse_expression(input, state) {
        Ok(expr) => expr,
        Err(e) => {
            if matches!(e, winnow::error::ErrMode::Cut(_)) {
                return Err(e);
            }
            if state.depth_exceeded.get() {
                return Err(cut());
            }
            state
                .last_error_kind
                .set(Some(ParseErrorKind::ExpectedExpression));
            return Err(cut());
        }
    };
    let _ = lexer::ws.parse_next(input)?;
    if input.starts_with(')') {
        *input = &input[1..];
        Ok(ASTNode::Paren(Box::new(inner)))
    } else if input.starts_with(',') && is_range_like(&inner) {
        let mut ranges = vec![inner];
        while input.starts_with(',') {
            *input = &input[1..];
            let _ = lexer::ws.parse_next(input)?;
            let next = parse_expression(input, state)?;
            ranges.push(next);
            let _ = lexer::ws.parse_next(input)?;
        }
        if input.starts_with(')') {
            *input = &input[1..];
            Ok(ASTNode::Union { ranges })
        } else {
            state
                .last_error_kind
                .set(Some(ParseErrorKind::UnmatchedParen { open_pos }));
            Err(cut())
        }
    } else {
        state
            .last_error_kind
            .set(Some(ParseErrorKind::UnmatchedParen { open_pos }));
        Err(cut())
    }
}

#[inline]
pub fn is_callable(node: &ASTNode) -> bool {
    match node {
        ASTNode::Paren(_) | ASTNode::CallExpression { .. } => true,
        ASTNode::Function { name, .. } => name.eq_ignore_ascii_case("LAMBDA"),
        _ => false,
    }
}

#[inline]
pub const fn is_range_endpoint(node: &ASTNode) -> bool {
    matches!(
        node,
        ASTNode::CellReference(..)
            | ASTNode::Range(..)
            | ASTNode::RangeOp { .. }
            | ASTNode::SheetRef { .. }
            | ASTNode::UnresolvedSheetRef { .. }
            | ASTNode::ThreeDRef { .. }
            | ASTNode::UnresolvedThreeDRef { .. }
            | ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. }
            | ASTNode::Function { .. }
            | ASTNode::Paren(..)
    )
}

#[inline]
pub const fn is_range_like(node: &ASTNode) -> bool {
    matches!(
        node,
        ASTNode::CellReference(..)
            | ASTNode::Range(..)
            | ASTNode::RangeOp { .. }
            | ASTNode::SheetRef { .. }
            | ASTNode::UnresolvedSheetRef { .. }
            | ASTNode::ThreeDRef { .. }
            | ASTNode::UnresolvedThreeDRef { .. }
            | ASTNode::ExternalSheetRef { .. }
            | ASTNode::ExternalThreeDRef { .. }
            | ASTNode::ExternalNameRef { .. }
            | ASTNode::BinaryOp {
                op: BinOp::Intersect,
                ..
            }
            | ASTNode::Union { .. }
    )
}
