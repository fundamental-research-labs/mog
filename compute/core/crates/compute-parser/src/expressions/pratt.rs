// UTF-8 boundary invariant: direct string slicing in this module consumes
// ASCII prefix/infix operator bytes discovered with starts_with or binding
// lookup.
#![allow(clippy::string_slice)]

use winnow::prelude::*;

use crate::ast::{ASTNode, BinOp, UnaryOp};
use crate::lexer::{self, backtrack};
use crate::parser::ParseErrorKind;
use crate::state::{MAX_DEPTH, ParseState};

use super::atom::parse_atomic;
use super::binding::{PREFIX_BP, infix_bp, peek_infix};
use super::postfix::{try_call_expression, try_postfix_hash, try_postfix_percent};
use super::range_ops::{try_expression_range_op, try_intersection};

#[inline]
pub(super) fn stash_if_empty(state: &ParseState, kind: ParseErrorKind) {
    let existing = state.last_error_kind.take();
    if existing.is_none() {
        state.last_error_kind.set(Some(kind));
    } else {
        state.last_error_kind.set(existing);
    }
}

/// Parse an expression (entry point — delegates to the Pratt loop).
pub fn parse_expression(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    parse_expr_bp(input, state, 0)
}

/// Core Pratt (precedence-climbing) parser.
pub(super) fn parse_expr_bp(
    input: &mut &str,
    state: &ParseState,
    min_bp: u8,
) -> ModalResult<ASTNode> {
    let _depth_guard = state.depth_guard();
    if state.depth.get() > MAX_DEPTH {
        state.depth_exceeded.set(true);
        return Err(backtrack());
    }

    let _ = lexer::ws.parse_next(input)?;
    let mut lhs = if input.starts_with('-') {
        *input = &input[1..];
        let _ = lexer::ws.parse_next(input)?;
        let operand = parse_expr_bp(input, state, PREFIX_BP).inspect_err(|_e| {
            stash_if_empty(state, ParseErrorKind::ExpectedOperand);
        })?;
        ASTNode::UnaryOp {
            op: UnaryOp::Minus,
            operand: Box::new(operand),
        }
    } else if input.starts_with('+') {
        *input = &input[1..];
        let _ = lexer::ws.parse_next(input)?;
        let operand = parse_expr_bp(input, state, PREFIX_BP).inspect_err(|_e| {
            stash_if_empty(state, ParseErrorKind::ExpectedOperand);
        })?;
        ASTNode::UnaryOp {
            op: UnaryOp::Plus,
            operand: Box::new(operand),
        }
    } else if input.starts_with('@') {
        *input = &input[1..];
        let _ = lexer::ws.parse_next(input)?;
        let operand = parse_expr_bp(input, state, PREFIX_BP).inspect_err(|_e| {
            stash_if_empty(state, ParseErrorKind::ExpectedOperand);
        })?;
        ASTNode::UnaryOp {
            op: UnaryOp::ImplicitIntersection,
            operand: Box::new(operand),
        }
    } else {
        parse_atomic(input, state)?
    };

    loop {
        let _ = lexer::ws.parse_next(input)?;

        let (next, consumed) = try_postfix_hash(input, lhs, min_bp);
        lhs = next;
        if consumed {
            continue;
        }

        let (next, consumed) = try_postfix_percent(input, lhs, min_bp);
        lhs = next;
        if consumed {
            continue;
        }

        let (next, consumed) = try_intersection(input, state, lhs, min_bp)?;
        lhs = next;
        if consumed {
            continue;
        }

        let (next, consumed) = try_call_expression(input, state, lhs, min_bp)?;
        lhs = next;
        if consumed {
            continue;
        }

        let (next, consumed) = try_expression_range_op(input, state, lhs, min_bp)?;
        lhs = next;
        if consumed {
            continue;
        }

        let (next, consumed) = try_infix_binary(input, state, lhs, min_bp)?;
        lhs = next;
        if consumed {
            continue;
        }

        break;
    }

    Ok(lhs)
}

fn try_infix_binary(
    input: &mut &str,
    state: &ParseState,
    lhs: ASTNode,
    min_bp: u8,
) -> ModalResult<(ASTNode, bool)> {
    let Some((op, len)) = peek_infix(input) else {
        return Ok((lhs, false));
    };
    let (l_bp, r_bp) = infix_bp(op);
    if l_bp < min_bp {
        return Ok((lhs, false));
    }
    *input = &input[len..];
    let _ = lexer::ws.parse_next(input)?;
    let rhs = parse_expr_bp(input, state, r_bp).inspect_err(|_e| {
        stash_if_empty(state, ParseErrorKind::ExpectedOperand);
    })?;
    Ok((
        ASTNode::BinaryOp {
            op,
            left: Box::new(lhs),
            right: Box::new(rhs),
        },
        true,
    ))
}
