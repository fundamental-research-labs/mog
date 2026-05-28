// UTF-8 boundary invariant: direct string slicing in this module consumes
// ASCII array delimiters and signs.
#![allow(clippy::string_slice)]

use winnow::prelude::*;

use crate::ast::{ASTNode, UnaryOp};
use crate::lexer::{self, backtrack, cut};
use crate::parser::ParseErrorKind;
use crate::references::consume_ref_suffix;
use crate::state::ParseState;
use value_types::CellError;

use super::alpha::try_parse_boolean;

/// Parse an array literal: {expr, expr; expr, expr}
pub(super) fn parse_array_literal(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let open_pos = state.offset(input) as usize;
    let _ = '{'.parse_next(input)?;
    let _ = lexer::ws.parse_next(input)?;

    let mut rows = Vec::new();
    let mut current_row = Vec::new();

    current_row.push(parse_array_element(input, state)?);

    loop {
        let _ = lexer::ws.parse_next(input)?;
        if input.starts_with(',') {
            *input = &input[1..];
            let _ = lexer::ws.parse_next(input)?;
            current_row.push(parse_array_element(input, state)?);
        } else if input.starts_with(';') {
            *input = &input[1..];
            let _ = lexer::ws.parse_next(input)?;
            rows.push(current_row);
            current_row = vec![parse_array_element(input, state)?];
        } else {
            break;
        }
    }
    rows.push(current_row);

    let _ = lexer::ws.parse_next(input)?;
    if !input.starts_with('}') {
        state
            .last_error_kind
            .set(Some(ParseErrorKind::UnmatchedBrace { open_pos }));
        return Err(cut());
    }
    *input = &input[1..];

    Ok(ASTNode::Array { rows })
}

fn parse_array_element(input: &mut &str, _state: &ParseState) -> ModalResult<ASTNode> {
    let _ = lexer::ws.parse_next(input)?;

    if input.is_empty() {
        return Err(backtrack());
    }

    let Some(first) = input.chars().next() else {
        return Err(backtrack());
    };
    match first {
        '"' => {
            let s = lexer::string_literal.parse_next(input)?;
            Ok(ASTNode::Text(s))
        }
        '#' => {
            let e = lexer::error_literal.parse_next(input)?;
            if e == CellError::Ref {
                consume_ref_suffix(input);
            }
            Ok(ASTNode::Error(e))
        }
        '-' => {
            *input = &input[1..];
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::UnaryOp {
                op: UnaryOp::Minus,
                operand: Box::new(ASTNode::Number(n)),
            })
        }
        '+' => {
            *input = &input[1..];
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::UnaryOp {
                op: UnaryOp::Plus,
                operand: Box::new(ASTNode::Number(n)),
            })
        }
        c if c.is_ascii_digit() || c == '.' => {
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::Number(n))
        }
        c if c.is_ascii_alphabetic() => {
            let saved = *input;
            if let Ok(b) = try_parse_boolean(input) {
                return Ok(ASTNode::Boolean(b));
            }
            *input = saved;
            Err(backtrack())
        }
        _ => Err(backtrack()),
    }
}
