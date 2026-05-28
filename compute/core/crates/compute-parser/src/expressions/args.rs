// UTF-8 boundary invariant: direct string slicing in this module consumes
// ASCII argument delimiters and brackets.
#![allow(clippy::string_slice)]

use winnow::prelude::*;

use crate::ast::ASTNode;
use crate::lexer::{self, backtrack, cut};
use crate::parser::ParseErrorKind;
use crate::state::ParseState;

use super::pratt::parse_expression;

/// Maximum number of arguments in a single function call or argument list.
const MAX_ARGS: usize = 4096;

pub(super) fn parse_arg_list(input: &mut &str, state: &ParseState) -> ModalResult<Vec<ASTNode>> {
    parse_arg_list_for_function(input, state, None)
}

pub(super) fn parse_arg_list_for_function(
    input: &mut &str,
    state: &ParseState,
    function_name: Option<&str>,
) -> ModalResult<Vec<ASTNode>> {
    let _ = lexer::ws.parse_next(input)?;
    let mut args = Vec::with_capacity(4);
    if input.starts_with(')') {
        return Ok(args);
    }
    if input.starts_with(',') {
        args.push(ASTNode::Omitted);
    } else {
        args.push(parse_function_argument(input, state, function_name)?);
    }
    loop {
        let _ = lexer::ws.parse_next(input)?;
        if input.starts_with(',') {
            if args.len() >= MAX_ARGS {
                state
                    .last_error_kind
                    .set(Some(ParseErrorKind::TooManyArguments));
                return Err(cut());
            }
            *input = &input[1..];
            let _ = lexer::ws.parse_next(input)?;
            if input.starts_with(',') || input.starts_with(')') {
                args.push(ASTNode::Omitted);
            } else {
                args.push(parse_function_argument(input, state, function_name)?);
            }
        } else {
            break;
        }
    }
    Ok(args)
}

fn parse_function_argument(
    input: &mut &str,
    state: &ParseState,
    function_name: Option<&str>,
) -> ModalResult<ASTNode> {
    if function_name.is_some_and(|name| name.eq_ignore_ascii_case("LAMBDA")) {
        let saved = *input;
        if let Ok(param) = parse_optional_lambda_param(input) {
            return Ok(param);
        }
        *input = saved;
    }
    parse_expression(input, state)
}

fn parse_optional_lambda_param(input: &mut &str) -> ModalResult<ASTNode> {
    if !input.starts_with('[') {
        return Err(backtrack());
    }
    *input = &input[1..];
    let name = lexer::identifier.parse_next(input)?;
    if !input.starts_with(']') {
        return Err(backtrack());
    }
    *input = &input[1..];
    Ok(ASTNode::OptionalLambdaParam(name.to_string()))
}
