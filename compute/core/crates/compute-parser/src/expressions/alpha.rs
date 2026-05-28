// UTF-8 boundary invariant: direct string slicing in this module consumes
// ASCII function-call delimiters.
#![allow(clippy::string_slice)]

use winnow::prelude::*;
use winnow::token::take_while;

use crate::ast::ASTNode;
use crate::lexer::{self, backtrack, cut};
use crate::parser::ParseErrorKind;
use crate::references::{
    cell_ref_to_range_or_single, parse_cell_ref_parts, try_parse_col_range,
    try_parse_sheet_ref_unquoted, try_parse_structured_ref,
};
use crate::state::{MAX_DEPTH, ParseState};
use cell_types::SheetId;

use super::args::parse_arg_list_for_function;

/// Try to parse a cell reference, range, column range, or function call.
pub fn try_parse_cell_or_range_or_func(
    input: &mut &str,
    state: &ParseState,
) -> ModalResult<ASTNode> {
    let saved = *input;

    if let Ok(node) = try_parse_col_range(input, state, None) {
        return Ok(node);
    }
    *input = saved;

    if let Ok((abs_col, col, abs_row, row)) = parse_cell_ref_parts(input) {
        if input
            .as_bytes()
            .first()
            .is_some_and(|&next| next.is_ascii_alphanumeric() || next == b'_')
        {
            *input = saved;
            return Err(backtrack());
        }

        let sheet = state
            .resolver
            .map_or(SheetId::from_raw(0), crate::CellRefResolver::current_sheet);

        return Ok(cell_ref_to_range_or_single(
            input,
            state.resolver,
            sheet,
            abs_col,
            col,
            abs_row,
            row,
        ));
    }
    *input = saved;

    if let Ok(node) = try_parse_function_call(input, state) {
        return Ok(node);
    }
    *input = saved;

    Err(backtrack())
}

/// Parse something that starts with an alphabetic character.
pub(super) fn parse_alpha_starting(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let saved = *input;
    let first_after = peek_past_ident(saved);

    match first_after {
        Some(b'!') => {
            if let Ok(node) = try_alpha_sheet_ref(input, state) {
                return Ok(node);
            }
            *input = saved;
        }
        Some(b':') => {
            if let Ok(node) = try_alpha_sheet_ref(input, state) {
                return Ok(node);
            }
            *input = saved;
        }
        Some(b'[') => {
            if let Ok(node) = try_alpha_structured_ref(input) {
                return Ok(node);
            }
            *input = saved;
        }
        Some(b'(') => {
            return try_alpha_function_or_boolean(input, state, saved);
        }
        _ => {}
    }

    if let Some(node) = try_alpha_boolean(input, saved) {
        return Ok(node);
    }

    if let Ok(node) = try_parse_cell_or_range_or_func(input, state) {
        return Ok(node);
    }
    *input = saved;

    try_alpha_identifier_fallback(input, saved)
}

#[inline]
fn peek_past_ident(s: &str) -> Option<u8> {
    let bytes = s.as_bytes();
    if bytes.is_empty()
        || !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_' || bytes[0] == b'\\')
    {
        return bytes.first().copied();
    }
    let mut i = 1;
    while i < bytes.len() {
        let b = bytes[i];
        if b.is_ascii_alphanumeric() || b == b'_' || b == b'.' {
            i += 1;
        } else {
            break;
        }
    }
    bytes.get(i).copied()
}

fn try_alpha_sheet_ref(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    try_parse_sheet_ref_unquoted(input, state)
}

fn try_alpha_structured_ref(input: &mut &str) -> ModalResult<ASTNode> {
    try_parse_structured_ref(input)
}

fn try_alpha_function_or_boolean<'a>(
    input: &mut &'a str,
    state: &ParseState,
    saved: &'a str,
) -> ModalResult<ASTNode> {
    let bytes = saved.as_bytes();
    let first_upper = bytes[0].to_ascii_uppercase();
    if first_upper == b'T' || first_upper == b'F' {
        if let Ok(b) = try_parse_boolean(input) {
            return Ok(ASTNode::Boolean(b));
        }
        *input = saved;
    }

    if let Ok(node) = try_parse_function_call(input, state) {
        return Ok(node);
    }
    *input = saved;

    Err(backtrack())
}

fn try_alpha_boolean<'a>(input: &mut &'a str, saved: &'a str) -> Option<ASTNode> {
    let first_upper = saved.as_bytes()[0].to_ascii_uppercase();
    if first_upper != b'T' && first_upper != b'F' {
        return None;
    }
    if let Ok(b) = try_parse_boolean(input) {
        return Some(ASTNode::Boolean(b));
    }
    *input = saved;
    None
}

fn try_alpha_identifier_fallback<'a>(input: &mut &'a str, saved: &'a str) -> ModalResult<ASTNode> {
    let ident = lexer::identifier.parse_next(input)?;
    let after_ident = *input;
    let _ = lexer::ws.parse_next(input);
    if input.starts_with('(') {
        *input = saved;
        return Err(backtrack());
    }
    *input = after_ident;
    Ok(ASTNode::Identifier(ident.to_string()))
}

pub(super) fn try_parse_boolean(input: &mut &str) -> ModalResult<bool> {
    let saved = *input;
    let ident: &str = take_while(1.., |c: char| c.is_ascii_alphabetic()).parse_next(input)?;
    if input
        .chars()
        .next()
        .is_some_and(|next| next.is_ascii_alphanumeric() || next == '_' || next == '(')
    {
        *input = saved;
        return Err(backtrack());
    }
    if ident.eq_ignore_ascii_case("TRUE") {
        Ok(true)
    } else if ident.eq_ignore_ascii_case("FALSE") {
        Ok(false)
    } else {
        *input = saved;
        Err(backtrack())
    }
}

pub fn try_parse_function_call(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    if state.depth.get() > MAX_DEPTH {
        state.depth_exceeded.set(true);
        return Err(backtrack());
    }
    let name = lexer::identifier.parse_next(input)?;
    let _ = lexer::ws.parse_next(input)?;
    if !input.starts_with('(') {
        return Err(backtrack());
    }
    let open_pos = state.offset(input) as usize;
    *input = &input[1..];

    let args = match parse_arg_list_for_function(input, state, Some(name)) {
        Ok(args) => args,
        Err(e) => {
            if matches!(e, winnow::error::ErrMode::Cut(_)) {
                return Err(e);
            }
            if state.depth_exceeded.get() {
                return Err(cut());
            }
            state
                .last_error_kind
                .set(Some(ParseErrorKind::ExpectedArgument));
            return Err(cut());
        }
    };
    let _ = lexer::ws.parse_next(input)?;
    if !input.starts_with(')') {
        state
            .last_error_kind
            .set(Some(ParseErrorKind::UnmatchedParen { open_pos }));
        return Err(cut());
    }
    *input = &input[1..];

    Ok(ASTNode::Function {
        name: crate::intern::intern_function_name(name),
        args,
    })
}
