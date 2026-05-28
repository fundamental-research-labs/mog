use winnow::prelude::*;

use crate::ast::ASTNode;
use crate::lexer::{self, backtrack, cut};
use crate::parser::ParseErrorKind;
use crate::references::{
    consume_ref_suffix, parse_cell_or_range, parse_sheet_ref_quoted, try_parse_row_range,
};
use crate::state::{MAX_DEPTH, ParseState};
use value_types::CellError;

use super::alpha::parse_alpha_starting;
use super::arrays::parse_array_literal;
use super::external::parse_external_ref_or_error;
use super::range_ops::parse_paren_or_union;

/// Atomic expressions: literals, references, function calls, parens, arrays.
pub(super) fn parse_atomic(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let _ = lexer::ws.parse_next(input)?;

    if input.is_empty() {
        return Err(backtrack());
    }

    if state.depth.get() > MAX_DEPTH {
        state.depth_exceeded.set(true);
        return Err(backtrack());
    }

    let first = input
        .chars()
        .next()
        .expect("non-empty input verified above");

    match first {
        '[' => parse_external_ref_or_error(input, state),
        '"' => match lexer::string_literal.parse_next(input) {
            Ok(s) => Ok(ASTNode::Text(s)),
            Err(e) => {
                if matches!(e, winnow::error::ErrMode::Cut(_)) {
                    return Err(e);
                }
                state
                    .last_error_kind
                    .set(Some(ParseErrorKind::MalformedString));
                Err(cut())
            }
        },
        '{' => parse_array_literal(input, state),
        '(' => parse_paren_or_union(input, state),
        '#' => {
            let e = lexer::error_literal.parse_next(input)?;
            if e == CellError::Ref {
                consume_ref_suffix(input);
            }
            Ok(ASTNode::Error(e))
        }
        '\'' => parse_sheet_ref_quoted(input, state),
        c if c.is_ascii_digit() => {
            let saved = *input;
            if let Ok(node) = try_parse_row_range(input, state, None) {
                return Ok(node);
            }
            *input = saved;
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::Number(n))
        }
        '.' => {
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::Number(n))
        }
        c if c.is_ascii_alphabetic() || c == '_' => parse_alpha_starting(input, state),
        '$' => {
            let saved = *input;
            if let Ok(node) = try_parse_row_range(input, state, None) {
                return Ok(node);
            }
            *input = saved;
            parse_cell_or_range(input, state, None)
        }
        _ => Err(backtrack()),
    }
}
