//! Expression grammar — Pratt parser (precedence climbing).
//!
//! Operator precedence (lowest to highest):
//! 1. Comparison: =, <>, <, >, <=, >=
//! 2. Concatenation: &
//! 3. Addition/Subtraction: +, -
//! 4. Multiplication/Division: *, /
//! 5. Power: ^ (right-associative)
//! 6. Unary: +, -
//! 7. Percent: %
//! 8. Intersection: implicit whitespace between range-like expressions
//! 9. Atomic: literals, references, function calls, parens
//!
//! All infix operators are handled by a single iterative loop in
//! [`parse_expr_bp`], eliminating the 7-function call chain of the
//! classic recursive-descent approach. This reduces the stack footprint
//! from ~9 frames per nesting level to ~3, allowing `MAX_DEPTH = 128`
//! to fit comfortably in a 2 MB thread stack (or even 1 MB WASM stack).
//!
//! UTF-8 boundary guard: every `&input[1..]` / `&start[..consumed]` in this
//! file advances past an ASCII operator or function-name byte recognized
//! by `starts_with(char)` / winnow combinators — char-boundary by
//! construction. File-scope allow documented here; per-site repetition
//! would add noise without adding safety.
//!
//! # Intersection operator (space)
//!
//! Excel's intersection operator is implicit whitespace between two range
//! expressions: `A1:B10 B5:C20` returns the overlapping cells. The parser
//! handles this by speculatively trying to parse a range-like expression
//! after consuming whitespace when the current LHS is itself range-like.
//! If the speculative parse succeeds, `BinOp::Intersect` is emitted;
//! otherwise the parser backtracks and continues with normal operator dispatch.
//!
//! # Union operator (comma in range context)
//!
//! Excel's union operator uses a comma inside parenthesized range contexts:
//! `SUM((A1:A5,C1:C5))`. The comma already serves as the function argument
//! separator, so the parser distinguishes the two uses based on context:
//! when parsing a parenthesized expression (not a function call's argument
//! list) and the first sub-expression is range-like, commas are treated as
//! the union operator. This produces `ASTNode::Union { ranges }`.
//! Precedence: union is implicitly lowest since it's only parsed inside
//! explicit parentheses.

// See the module-level comment above for the char-boundary invariant.
#![allow(clippy::string_slice)]

use winnow::prelude::*;
use winnow::token::take_while;

use super::ast::{ASTNode, BinOp, UnaryOp};
use super::lexer;
use super::references::{
    cell_ref_to_range_or_single, consume_ref_suffix, parse_cell_or_range, parse_cell_ref_parts,
    parse_ref_after_external_sheet, parse_sheet_ref_quoted, try_parse_col_range,
    try_parse_row_range, try_parse_sheet_ref_unquoted, try_parse_structured_ref,
};
use super::state::{MAX_DEPTH, ParseState};
use cell_types::SheetId;
use formula_types::ExternalWorkbookToken;
use value_types::CellError;

use lexer::{backtrack, cut};

/// Stash a specific error kind if nothing more specific is already stored.
#[inline]
fn stash_if_empty(state: &ParseState, kind: super::parser::ParseErrorKind) {
    let existing = state.last_error_kind.take();
    if existing.is_none() {
        state.last_error_kind.set(Some(kind));
    } else {
        state.last_error_kind.set(existing);
    }
}

// ── Binding powers ───────────────────────────────────────────────────
//
// Each infix operator has a left and right binding power (l_bp, r_bp).
//   Left-associative:  r_bp = l_bp + 1
//   Right-associative: r_bp = l_bp - 1

/// Returns (`left_bp`, `right_bp`) for an infix binary operator.
#[inline]
const fn infix_bp(op: BinOp) -> (u8, u8) {
    match op {
        BinOp::Eq | BinOp::Neq | BinOp::Lt | BinOp::Gt | BinOp::Lte | BinOp::Gte => (2, 3),
        BinOp::Concat => (4, 5),
        BinOp::Add | BinOp::Sub => (6, 7),
        BinOp::Mul | BinOp::Div => (8, 9),
        BinOp::Pow => (11, 10),       // right-associative
        BinOp::Intersect => (15, 16), // tighter than postfix %, left-associative
    }
}

/// Prefix unary operators (+, -) bind tighter than multiplication/division
/// but looser than exponentiation, matching Excel semantics:
///   `-2^3` → `-(2^3)` = -8, not `(-2)^3` = -8
///   `-2^2` → `-(2^2)` = -4, not `(-2)^2` = 4
const PREFIX_BP: u8 = 10;

/// Postfix operators (%, call) bind tightest.
const POSTFIX_BP: u8 = 14;

/// Expression-level range operator `:` — tighter than intersection.
const RANGE_L_BP: u8 = 18;
const RANGE_R_BP: u8 = 19;

/// Peek at the current position and identify an infix binary operator.
/// Returns `(BinOp, byte_length)` without consuming input.
#[inline]
fn peek_infix(input: &str) -> Option<(BinOp, usize)> {
    let bytes = input.as_bytes();
    match bytes.first()? {
        b'<' => match bytes.get(1) {
            Some(b'>') => Some((BinOp::Neq, 2)),
            Some(b'=') => Some((BinOp::Lte, 2)),
            _ => Some((BinOp::Lt, 1)),
        },
        b'>' => match bytes.get(1) {
            Some(b'=') => Some((BinOp::Gte, 2)),
            _ => Some((BinOp::Gt, 1)),
        },
        b'=' => Some((BinOp::Eq, 1)),
        b'&' => Some((BinOp::Concat, 1)),
        b'+' => Some((BinOp::Add, 1)),
        b'-' => Some((BinOp::Sub, 1)),
        b'*' => Some((BinOp::Mul, 1)),
        b'/' => Some((BinOp::Div, 1)),
        b'^' => Some((BinOp::Pow, 1)),
        _ => None,
    }
}

// ── Pratt parser ─────────────────────────────────────────────────────

/// Parse an expression (entry point — delegates to the Pratt loop).
pub fn parse_expression(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    parse_expr_bp(input, state, 0)
}

/// Core Pratt (precedence-climbing) parser.
///
/// `min_bp` is the minimum left-binding-power an infix operator must
/// have to capture the current left-hand operand.  Top-level calls use 0.
///
/// Every recursive entry increments `state.depth` by 1, providing an
/// accurate measure of actual stack depth for the overflow guard.
fn parse_expr_bp(input: &mut &str, state: &ParseState, min_bp: u8) -> ModalResult<ASTNode> {
    // ── Depth guard ──────────────────────────────────────────────────
    let _depth_guard = state.depth_guard();
    if state.depth.get() > MAX_DEPTH {
        state.depth_exceeded.set(true);
        return Err(backtrack());
    }

    // ── Prefix: unary +/-/@ or atom ─────────────────────────────────
    let _ = lexer::ws.parse_next(input)?;
    let mut lhs = if input.starts_with('-') {
        *input = &input[1..];
        let _ = lexer::ws.parse_next(input)?;
        let operand = parse_expr_bp(input, state, PREFIX_BP).inspect_err(|_e| {
            stash_if_empty(state, super::parser::ParseErrorKind::ExpectedOperand);
        })?;
        ASTNode::UnaryOp {
            op: UnaryOp::Minus,
            operand: Box::new(operand),
        }
    } else if input.starts_with('+') {
        *input = &input[1..];
        let _ = lexer::ws.parse_next(input)?;
        let operand = parse_expr_bp(input, state, PREFIX_BP).inspect_err(|_e| {
            stash_if_empty(state, super::parser::ParseErrorKind::ExpectedOperand);
        })?;
        ASTNode::UnaryOp {
            op: UnaryOp::Plus,
            operand: Box::new(operand),
        }
    } else if input.starts_with('@') {
        // Excel implicit-intersection prefix operator. Forces a multi-cell
        // range/array operand to collapse to a single scalar (row/col aligned
        // to the calling cell). Inside `[...]` (structured table refs), `@`
        // is part of the table-ref syntax — but the structured-ref parser
        // dispatches via `parse_atomic` BEFORE we reach this branch when the
        // formula starts with an identifier, so `Table[@Col]` is unaffected.
        *input = &input[1..];
        let _ = lexer::ws.parse_next(input)?;
        let operand = parse_expr_bp(input, state, PREFIX_BP).inspect_err(|_e| {
            stash_if_empty(state, super::parser::ParseErrorKind::ExpectedOperand);
        })?;
        ASTNode::UnaryOp {
            op: UnaryOp::ImplicitIntersection,
            operand: Box::new(operand),
        }
    } else {
        parse_atomic(input, state)?
    };

    // ── Postfix + infix loop ────────────────────────────────────────
    //
    // Each try_* helper takes `lhs` by value (move) and returns it back
    // (possibly wrapped in a new node). This avoids cloning the entire
    // left-hand subtree on every operator attachment — O(N) instead of O(N²).
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

// ── Pratt loop helpers ──────────────────────────────────────────────
//
// Each helper handles one concern from the Pratt loop. Returns
// `Some(new_lhs)` when it consumes input, `None` to try the next.

/// Try to consume a postfix `#` operator (Excel's spilled-range operator).
///
/// `A1#` desugars to `ANCHORARRAY(A1)` — the full dynamic-array spill anchored
/// at A1. Only applies when `lhs` is a cell reference (optionally sheet-qualified)
/// and the `#` is not the start of a recognized error literal (`#NAME?`,
/// `#REF!`, …); error literals all begin with `#` followed by an ASCII letter,
/// so a non-alpha (or end-of-input) follower disambiguates the postfix use.
#[inline]
fn try_postfix_hash(input: &mut &str, lhs: ASTNode, min_bp: u8) -> (ASTNode, bool) {
    if !input.starts_with('#') || POSTFIX_BP < min_bp {
        return (lhs, false);
    }
    // Avoid swallowing `#` from `#NAME?`, `#REF!`, etc.
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

/// Whether a node is a valid `#`-suffix anchor: a cell reference, optionally
/// wrapped in a sheet qualifier (resolved or unresolved).
fn is_spillable_anchor(node: &ASTNode) -> bool {
    match node {
        ASTNode::CellReference(_) => true,
        ASTNode::SheetRef { inner, .. } | ASTNode::UnresolvedSheetRef { inner, .. } => {
            matches!(inner.as_ref(), ASTNode::CellReference(_))
        }
        _ => false,
    }
}

/// Try to consume a postfix `%` operator.
/// Takes `lhs` by value; returns `(node, true)` on success, `(lhs, false)` on no-match.
#[inline]
fn try_postfix_percent(input: &mut &str, lhs: ASTNode, min_bp: u8) -> (ASTNode, bool) {
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

/// Try to detect an implicit intersection operator (space between range-like exprs).
/// Takes `lhs` by value; returns `Ok((node, true))` on success, `Ok((lhs, false))` on no-match.
/// Returns `Err` on unrecoverable (Cut) errors from `parse_atomic`.
fn try_intersection(
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
    // Speculatively try parsing an atomic (range-level) expression.
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
    // Backtrack if it wasn't a range-like expression.
    *input = saved;
    Ok((lhs, false))
}

/// Try to parse a postfix call expression: `(expr)(args)`.
/// Takes `lhs` by value; returns `Ok((node, true))` on success, `Ok((lhs, false))` on no-match.
/// Returns `Err` only on unrecoverable parse errors (e.g. ws parse failure).
fn try_call_expression(
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
    *input = &input[1..]; // consume '('
    match parse_arg_list(input, state) {
        Ok(args) => {
            let _ = lexer::ws.parse_next(input)?;
            if !input.starts_with(')') {
                state
                    .last_error_kind
                    .set(Some(crate::parser::ParseErrorKind::UnmatchedParen {
                        open_pos,
                    }));
                return Err(cut());
            }
            *input = &input[1..]; // consume ')'
            Ok((
                ASTNode::CallExpression {
                    callee: Box::new(lhs),
                    args,
                },
                true,
            ))
        }
        Err(e) => {
            // Propagate cut errors
            if matches!(e, winnow::error::ErrMode::Cut(_)) {
                return Err(e);
            }
            *input = saved;
            Ok((lhs, false))
        }
    }
}

/// Try to parse an expression-level range operator `:` between range endpoints.
/// Takes `lhs` by value; returns `Ok((node, true))` on success, `Ok((lhs, false))` on no-match.
///
/// Excel's `:` operator works between any two cell-returning expressions.
/// For literal refs (A1:B5), the `:` is already consumed during atomic
/// parsing. This path fires when the left side is a non-literal expression
/// (e.g. `INDEX()`, `OFFSET()`) or when the literal parser backtracked.
///
/// Binding power: very high (18, 19) — tighter than intersection (15, 16).
fn try_expression_range_op(
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
    *input = &input[1..]; // consume ':'
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

/// Try to parse an infix binary operator (+, -, *, /, ^, &, =, <>, etc.).
/// Takes `lhs` by value; returns `Ok((node, true))` on success, `Ok((lhs, false))` on no-match.
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
    *input = &input[len..]; // consume operator token
    let _ = lexer::ws.parse_next(input)?;
    let rhs = parse_expr_bp(input, state, r_bp).inspect_err(|_e| {
        stash_if_empty(state, super::parser::ParseErrorKind::ExpectedOperand);
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

/// Maximum number of arguments in a single function call or argument list.
/// Excel's own limit is 255 for most functions; 4096 is generous enough
/// to handle any reasonable formula while guarding against pathological input.
const MAX_ARGS: usize = 4096;

/// Parse a comma-separated argument list (between parens, but NOT consuming the parens).
/// Handles omitted arguments (empty positions become `ASTNode::Omitted`).
/// Callers are responsible for consuming the opening `(` before and closing `)` after.
fn parse_arg_list(input: &mut &str, state: &ParseState) -> ModalResult<Vec<ASTNode>> {
    let _ = lexer::ws.parse_next(input)?;
    let mut args = Vec::with_capacity(4);
    if input.starts_with(')') {
        return Ok(args);
    }
    // Parse first argument (may be omitted if leading comma)
    if input.starts_with(',') {
        args.push(ASTNode::Omitted);
    } else {
        args.push(parse_expression(input, state)?);
    }
    loop {
        let _ = lexer::ws.parse_next(input)?;
        if input.starts_with(',') {
            if args.len() >= MAX_ARGS {
                state
                    .last_error_kind
                    .set(Some(crate::parser::ParseErrorKind::TooManyArguments));
                return Err(cut());
            }
            *input = &input[1..];
            let _ = lexer::ws.parse_next(input)?;
            if input.starts_with(',') || input.starts_with(')') {
                args.push(ASTNode::Omitted);
            } else {
                args.push(parse_expression(input, state)?);
            }
        } else {
            break;
        }
    }
    Ok(args)
}

/// Check if an AST node can be the callee of a call expression.
///
/// Only `Paren` (wrapping a lambda/expression) and `CallExpression` are callable.
/// `Identifier` is intentionally excluded: function calls like `SUM(1)` are
/// handled by `try_parse_function_call` in `parse_alpha_starting`, not here.
/// Including `Identifier` would cause exponential backtracking on deeply nested
/// formulas like `SUM(SUM(SUM(...)))` because both `try_parse_function_call`
/// and the postfix call-expression path would attempt to parse the same argument list.
#[inline]
pub const fn is_callable(node: &ASTNode) -> bool {
    matches!(node, ASTNode::Paren(_) | ASTNode::CallExpression { .. })
}

/// Check if an AST node could be a range endpoint for the infix `:` operator.
///
/// This is more permissive than `is_range_like`: it includes function calls
/// (INDEX, OFFSET, etc.) and parenthesized expressions that could return cell
/// positions. Numbers, strings, booleans, and plain identifiers are excluded
/// since they can't be range endpoints.
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

/// Check if an AST node is a range-like expression (cell ref, range, or sheet-qualified ref).
/// Used for intersection operator detection â only range-like expressions can be intersection operands.
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
            // An intersection of ranges is itself range-like, enabling chaining:
            // `A1:B10 B5:C20 C1:D5` parses as `(A1:B10 intersect B5:C20) intersect C1:D5`
            | ASTNode::BinaryOp {
                op: BinOp::Intersect,
                ..
            }
            | ASTNode::Union { .. }
    )
}

/// Parse a parenthesized expression or a union of ranges: `(expr)` or `(A1:A5,C1:C5)`.
fn parse_paren_or_union(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let open_pos = state.offset(input) as usize;
    *input = &input[1..];
    let _ = lexer::ws.parse_next(input)?;
    let inner = match parse_expression(input, state) {
        Ok(expr) => expr,
        Err(e) => {
            // Propagate cut errors as-is (they already carry error info)
            if matches!(e, winnow::error::ErrMode::Cut(_)) {
                return Err(e);
            }
            // Depth exceeded should propagate without masking
            if state.depth_exceeded.get() {
                return Err(cut());
            }
            state
                .last_error_kind
                .set(Some(crate::parser::ParseErrorKind::ExpectedExpression));
            return Err(cut());
        }
    };
    let _ = lexer::ws.parse_next(input)?;
    if input.starts_with(')') {
        *input = &input[1..];
        Ok(ASTNode::Paren(Box::new(inner)))
    } else if input.starts_with(',') && is_range_like(&inner) {
        // Union operator: comma inside parens where the first expr is range-like.
        let mut ranges = vec![inner];
        while input.starts_with(',') {
            *input = &input[1..]; // consume ','
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
                .set(Some(crate::parser::ParseErrorKind::UnmatchedParen {
                    open_pos,
                }));
            Err(cut())
        }
    } else {
        state
            .last_error_kind
            .set(Some(crate::parser::ParseErrorKind::UnmatchedParen {
                open_pos,
            }));
        Err(cut())
    }
}

/// Level 8: Atomic expressions — literals, references, function calls, parens, arrays.
fn parse_atomic(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let _ = lexer::ws.parse_next(input)?;

    if input.is_empty() {
        return Err(backtrack());
    }

    // Early bail if we're already past the depth limit — prevents expensive
    // backtracking cascades when deeply nested structures fail.
    if state.depth.get() > MAX_DEPTH {
        state.depth_exceeded.set(true);
        return Err(backtrack());
    }

    let first = input
        .chars()
        .next()
        .expect("non-empty input verified above");

    match first {
        // External workbook reference: [1]Sheet!A1 or [Book.xlsx]Sheet!A1
        // Extract the sheet name and resolve it — if the sheet exists locally,
        // produce a normal SheetRef/UnresolvedSheetRef instead of #REF!.
        '[' => parse_external_ref_or_error(input, state),
        // String literal — after opening `"`, unterminated string is a hard error
        '"' => match lexer::string_literal.parse_next(input) {
            Ok(s) => Ok(ASTNode::Text(s)),
            Err(e) => {
                if matches!(e, winnow::error::ErrMode::Cut(_)) {
                    return Err(e);
                }
                state
                    .last_error_kind
                    .set(Some(crate::parser::ParseErrorKind::MalformedString));
                Err(cut())
            }
        },
        // Array literal
        '{' => parse_array_literal(input, state),
        // Parenthesized expression — may also be a union: (A1:A5,C1:C5)
        '(' => parse_paren_or_union(input, state),
        // Error literal (possibly followed by cell/range ref for deleted-sheet references)
        '#' => {
            let e = lexer::error_literal.parse_next(input)?;
            // In Excel, #REF! can act as a deleted-sheet prefix: #REF!A1, #REF!$A$1:$B$10,
            // #REF!A:C, #REF!1:5, or even #REF!#REF! (both sheet and cell deleted).
            // Consume any trailing reference suffix so the parse succeeds.
            if e == CellError::Ref {
                consume_ref_suffix(input);
            }
            Ok(ASTNode::Error(e))
        }
        // Quoted sheet reference
        '\'' => parse_sheet_ref_quoted(input, state),
        // Number or numeric row range like 1:5
        c if c.is_ascii_digit() => {
            // Try row range first: digits : digits
            let saved = *input;
            if let Ok(node) = try_parse_row_range(input, state, None) {
                return Ok(node);
            }
            *input = saved;
            // Regular number
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::Number(n))
        }
        // Dot-prefixed number
        '.' => {
            let n = lexer::number_literal_with_leading_dot.parse_next(input)?;
            Ok(ASTNode::Number(n))
        }
        // Letter: could be cell ref, range, function call, boolean, sheet ref, identifier
        c if c.is_ascii_alphabetic() || c == '_' => parse_alpha_starting(input, state),
        // Dollar sign: absolute cell/row reference ($A$1, $A:$C, $1:$5)
        '$' => {
            let saved = *input;
            // Try absolute row range first: $1:$5
            if let Ok(node) = try_parse_row_range(input, state, None) {
                return Ok(node);
            }
            *input = saved;
            parse_cell_or_range(input, state, None)
        }
        _ => Err(backtrack()),
    }
}

/// Try to parse a cell reference, range, column range, or function call.
pub fn try_parse_cell_or_range_or_func(
    input: &mut &str,
    state: &ParseState,
) -> ModalResult<ASTNode> {
    let saved = *input;

    // Try column range first: A:C
    if let Ok(node) = try_parse_col_range(input, state, None) {
        return Ok(node);
    }
    *input = saved;

    // Try cell ref with possible range
    if let Ok((abs_col, col, abs_row, row)) = parse_cell_ref_parts(input) {
        // Word-boundary check: if the next character is an identifier continuation
        // character (alphanumeric or underscore), the cell ref is just a prefix of a
        // longer identifier (e.g., "t1Payment" → "t1" consumed as CellRef(T1) but
        // "Payment" remains). Backtrack and let the identifier fallback handle it.
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
            .map_or(SheetId::from_raw(0), super::CellRefResolver::current_sheet);

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

    // Try function call: IDENTIFIER(...)
    if let Ok(node) = try_parse_function_call(input, state) {
        return Ok(node);
    }
    *input = saved;

    Err(backtrack())
}

/// Parse something that starts with an alphabetic character.
/// Could be: boolean, function call, cell ref, range, sheet ref, structured ref, or identifier.
///
/// Uses lookahead dispatch: scan the identifier-like prefix without consuming it,
/// then peek at the character immediately after to choose the right parser path.
/// This avoids trying 3-4 parsers that are guaranteed to fail for a given input.
fn parse_alpha_starting(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let saved = *input;
    let first_after = peek_past_ident(saved);

    // Dispatch based on what follows the identifier-like prefix.
    match first_after {
        Some(b'!') => {
            if let Ok(node) = try_alpha_sheet_ref(input, state) {
                return Ok(node);
            }
            *input = saved;
        }
        Some(b':') => {
            // Could be a 3-D reference: Sheet1:Sheet3!A1. Try parsing it via
            // try_alpha_sheet_ref which now handles the colon-separated case.
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

    // Try boolean (only for identifiers starting with T/F)
    if let Some(node) = try_alpha_boolean(input, saved) {
        return Ok(node);
    }

    // Try cell reference or range or function call
    if let Ok(node) = try_parse_cell_or_range_or_func(input, state) {
        return Ok(node);
    }
    *input = saved;

    // Fall back to identifier (with backtracking guard)
    try_alpha_identifier_fallback(input, saved)
}

// ── Alpha-starting dispatch helpers ─────────────────────────────────

/// Peek past identifier-like characters to find what follows.
/// Returns the byte immediately after the identifier prefix, or `None`.
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

/// Try unquoted sheet ref: `SheetName!CellRef`.
fn try_alpha_sheet_ref(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    try_parse_sheet_ref_unquoted(input, state)
}

/// Try structured table ref: `TableName[...]`.
fn try_alpha_structured_ref(input: &mut &str) -> ModalResult<ASTNode> {
    try_parse_structured_ref(input)
}

/// Try function call: `NAME(args)`, with boolean check for TRUE/FALSE.
/// When followed by `(`, this is the only valid path — never falls through
/// to identifier (that would cause exponential backtracking).
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

    // Function call failed (e.g. depth limit). Do NOT fall back to identifier
    // when followed by '(' — that would cause exponential backtracking via
    // the postfix call-expression path in the Pratt loop.
    Err(backtrack())
}

/// Try boolean literal for identifiers starting with T/F.
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

/// Fall back to identifier — but NOT if it's followed by '(' (that's a function
/// call that failed above). Returning it as an identifier would cause the Pratt
/// loop's postfix call-expression path to retry the same function-call parse.
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

/// Try to parse a boolean literal, ensuring it's not a prefix of a longer identifier.
fn try_parse_boolean(input: &mut &str) -> ModalResult<bool> {
    let saved = *input;
    let ident: &str = take_while(1.., |c: char| c.is_ascii_alphabetic()).parse_next(input)?;
    // Make sure next char is not alphanumeric/underscore (i.e., it's not part of a longer identifier)
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

/// Try to parse a function call: NAME(arg1, arg2, ...)
///
/// Supports omitted (empty) arguments. In Excel, `TABLE(,B3)` or `IF(A1,,0)`
/// have empty argument positions. These are represented as `ASTNode::Omitted`
/// in the AST, letting downstream code distinguish omitted from explicit zero.
pub fn try_parse_function_call(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    // Early bail: if we're past the depth limit, function args would fail anyway
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
    *input = &input[1..]; // consume '('

    // ── Committed to function call after NAME( ──
    let args = match parse_arg_list(input, state) {
        Ok(args) => args,
        Err(e) => {
            // If the arg list itself raised a cut error, propagate it.
            if matches!(e, winnow::error::ErrMode::Cut(_)) {
                return Err(e);
            }
            // Depth exceeded should propagate without masking
            if state.depth_exceeded.get() {
                return Err(cut());
            }
            // Otherwise, set ExpectedArgument and cut.
            state
                .last_error_kind
                .set(Some(crate::parser::ParseErrorKind::ExpectedArgument));
            return Err(cut());
        }
    };
    let _ = lexer::ws.parse_next(input)?;
    if !input.starts_with(')') {
        state
            .last_error_kind
            .set(Some(crate::parser::ParseErrorKind::UnmatchedParen {
                open_pos,
            }));
        return Err(cut());
    }
    *input = &input[1..]; // consume ')'

    // Function name normalization: uppercase only. XLSX-specific prefixes
    // (_xlfn., _xlpm., etc.) are stripped by the normalization layer at the
    // import boundary (mirror::add_sheet), so the parser stays format-agnostic.
    Ok(ASTNode::Function {
        name: crate::intern::intern_function_name(name),
        args,
    })
}

/// Parse an array literal: {expr, expr; expr, expr}
fn parse_array_literal(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let open_pos = state.offset(input) as usize;
    let _ = '{'.parse_next(input)?;
    let _ = lexer::ws.parse_next(input)?;

    let mut rows = Vec::new();
    let mut current_row = Vec::new();

    // Parse first element
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
            .set(Some(crate::parser::ParseErrorKind::UnmatchedBrace {
                open_pos,
            }));
        return Err(cut());
    }
    *input = &input[1..];

    Ok(ASTNode::Array { rows })
}

/// Parse an element within an array literal (numbers, strings, booleans, errors, unary negation).
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

/// Parse an external workbook reference: `[N]Sheet!Ref`, `[Name]Sheet!Ref`, or
/// `[Name]DefinedName`.
fn parse_external_ref_or_error(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let saved = *input;
    if !input.starts_with('[') {
        return Err(backtrack());
    }
    // Find the closing bracket
    let Some(bracket_end) = input.find(']') else {
        *input = saved;
        return Err(backtrack());
    };
    let workbook = ExternalWorkbookToken::new(input[..=bracket_end].to_string());
    *input = &input[bracket_end + 1..];

    // Parse the sheet/name that follows the bracket.
    let sheet_name: String = if input.starts_with('\'') {
        if let Ok(name) = lexer::quoted_sheet_name.parse_next(input) {
            name
        } else {
            *input = saved;
            return Err(backtrack());
        }
    } else {
        // Unquoted sheet name: everything up to '!'
        if let Ok(name) = lexer::unquoted_sheet_name.parse_next(input) {
            name.to_string()
        } else {
            *input = saved;
            return Err(backtrack());
        }
    };

    if !input.starts_with('!') {
        return Ok(ASTNode::ExternalNameRef {
            workbook,
            name: sheet_name,
        });
    }
    *input = &input[1..];

    let Ok(inner) = parse_ref_after_external_sheet(input, state) else {
        *input = saved;
        return Err(backtrack());
    };

    if let Some((start_sheet, end_sheet)) = sheet_name.split_once(':') {
        Ok(ASTNode::ExternalThreeDRef {
            workbook,
            start_sheet: start_sheet.to_string(),
            end_sheet: end_sheet.to_string(),
            inner: Box::new(inner),
        })
    } else {
        Ok(ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner: Box::new(inner),
        })
    }
}
