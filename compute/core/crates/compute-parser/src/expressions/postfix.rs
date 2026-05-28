// UTF-8 boundary invariant: direct string slicing in this module consumes
// ASCII postfix operator and parenthesis bytes.
#![allow(clippy::string_slice)]

use winnow::prelude::*;

use crate::ast::{ASTNode, UnaryOp};
use crate::lexer::{self, cut};
use crate::parser::ParseErrorKind;
use crate::state::ParseState;

use super::args::parse_arg_list;
use super::binding::POSTFIX_BP;
use super::range_ops::is_callable;

#[inline]
pub(super) fn try_postfix_hash(input: &mut &str, lhs: ASTNode, min_bp: u8) -> (ASTNode, bool) {
    if !input.starts_with('#') || POSTFIX_BP < min_bp {
        return (lhs, false);
    }
    if input.as_bytes().get(1).is_some_and(u8::is_ascii_alphabetic) {
        return (lhs, false);
    }
    if !is_spillable_anchor(&lhs) {
        return (lhs, false);
    }
    *input = &input[1..];
    (
        ASTNode::Function {
            name: crate::intern::intern_function_name("ANCHORARRAY"),
            args: vec![lhs],
        },
        true,
    )
}

fn is_spillable_anchor(node: &ASTNode) -> bool {
    match node {
        ASTNode::CellReference(_) => true,
        ASTNode::SheetRef { inner, .. } | ASTNode::UnresolvedSheetRef { inner, .. } => {
            matches!(inner.as_ref(), ASTNode::CellReference(_))
        }
        _ => false,
    }
}

#[inline]
pub(super) fn try_postfix_percent(input: &mut &str, lhs: ASTNode, min_bp: u8) -> (ASTNode, bool) {
    if !input.starts_with('%') || POSTFIX_BP < min_bp {
        return (lhs, false);
    }
    *input = &input[1..];
    (
        ASTNode::UnaryOp {
            op: UnaryOp::Percent,
            operand: Box::new(lhs),
        },
        true,
    )
}

pub(super) fn try_call_expression(
    input: &mut &str,
    state: &ParseState,
    lhs: ASTNode,
    min_bp: u8,
) -> ModalResult<(ASTNode, bool)> {
    if !input.starts_with('(') || !is_callable(&lhs) || POSTFIX_BP < min_bp {
        return Ok((lhs, false));
    }
    let open_pos = state.offset(input) as usize;
    let saved = *input;
    *input = &input[1..];
    match parse_arg_list(input, state) {
        Ok(args) => {
            let _ = lexer::ws.parse_next(input)?;
            if !input.starts_with(')') {
                state
                    .last_error_kind
                    .set(Some(ParseErrorKind::UnmatchedParen { open_pos }));
                return Err(cut());
            }
            *input = &input[1..];
            Ok((
                ASTNode::CallExpression {
                    callee: Box::new(lhs),
                    args,
                },
                true,
            ))
        }
        Err(e) => {
            if matches!(e, winnow::error::ErrMode::Cut(_)) {
                return Err(e);
            }
            *input = saved;
            Ok((lhs, false))
        }
    }
}
