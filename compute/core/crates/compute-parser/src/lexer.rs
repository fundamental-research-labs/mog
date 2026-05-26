//! Lexer utilities for the formula parser.
//!
//! Low-level parsers for tokens: whitespace, numbers, strings, identifiers,
//! cell references, error literals, etc. These are composed by the main parser.

// UTF-8 boundary guard: every `&s[..]` in this file uses winnow-tracked byte
// positions (`start.len() - input.len()` after a successful parse, where
// the consumed portion ends at a valid char boundary by winnow contract)
// or offsets produced by char-aware parsers — char-boundary by construction.
#![allow(clippy::string_slice)]

use winnow::combinator::opt;
use winnow::prelude::*;
use winnow::token::{one_of, take_while};

use value_types::CellError;

/// Helper to create a backtrack error.
#[inline]
pub fn backtrack() -> winnow::error::ErrMode<winnow::error::ContextError> {
    winnow::error::ErrMode::Backtrack(winnow::error::ContextError::new())
}

/// Helper to create a fatal (cut) error that prevents backtracking.
///
/// Call this after the parser has committed to a specific path (e.g., after
/// seeing `SUM(` — definitely a function call) to surface precise error
/// messages instead of falling through to a generic "unexpected token".
#[inline]
pub fn cut() -> winnow::error::ErrMode<winnow::error::ContextError> {
    winnow::error::ErrMode::Cut(winnow::error::ContextError::new())
}

/// Skip zero or more whitespace characters.
#[inline]
pub fn ws<'i>(input: &mut &'i str) -> ModalResult<&'i str> {
    take_while(0.., |c: char| {
        c == ' ' || c == '\t' || c == '\r' || c == '\n'
    })
    .parse_next(input)
}

/// Parse a number literal (integer or float, with optional scientific notation).
///
/// Uses a fast path for simple integers (the ~80% common case — row numbers,
/// small constants) that accumulates digits as u64, avoiding the slow libc
/// strtod path. Falls back to `str::parse::`<f64>() for floats and overflow.
pub fn number_literal(input: &mut &str) -> ModalResult<f64> {
    let start = *input;
    // Integer part
    let int_digits = take_while(1.., |c: char| c.is_ascii_digit()).parse_next(input)?;

    // Peek: is this a simple integer?
    let next = input.as_bytes().first().copied();
    if next != Some(b'.') && next != Some(b'e') && next != Some(b'E') {
        // Fast path: no decimal point or exponent — parse directly as u64 → f64
        if let Ok(n) = fast_parse_int(int_digits) {
            #[allow(clippy::cast_precision_loss)]
            // u64 → f64 precision loss is acceptable for spreadsheet numbers
            return Ok(n as f64);
        }
        // Overflow: fall through to f64 parse (very rare — 20+ digit integers)
        let consumed = &start[..start.len() - input.len()];
        return consumed.parse::<f64>().map_err(|_| backtrack());
    }

    // Slow path: has decimal or exponent
    let _ = opt(('.', take_while(1.., |c: char| c.is_ascii_digit()))).parse_next(input)?;
    let _ = opt((
        one_of(['e', 'E']),
        opt(one_of(['+', '-'])),
        take_while(1.., |c: char| c.is_ascii_digit()),
    ))
    .parse_next(input)?;

    let consumed = &start[..start.len() - input.len()];
    consumed.parse::<f64>().map_err(|_| backtrack())
}

/// Fast integer parsing for the common case of simple digit strings.
/// Returns Err for numbers that overflow u64.
#[inline]
fn fast_parse_int(s: &str) -> Result<u64, ()> {
    let mut result: u64 = 0;
    for &b in s.as_bytes() {
        let digit = u64::from(b - b'0');
        result = result
            .checked_mul(10)
            .ok_or(())?
            .checked_add(digit)
            .ok_or(())?;
    }
    Ok(result)
}

/// Parse a number literal that could also start with a dot (like `.5`).
pub fn number_literal_with_leading_dot(input: &mut &str) -> ModalResult<f64> {
    // Try normal number first
    if let Ok(n) = number_literal.parse_next(input) {
        return Ok(n);
    }
    // Try .digits format
    let start = *input;
    let _ = '.'.parse_next(input)?;
    let _ = take_while(1.., |c: char| c.is_ascii_digit()).parse_next(input)?;
    // Optional exponent
    let _ = opt((
        one_of(['e', 'E']),
        opt(one_of(['+', '-'])),
        take_while(1.., |c: char| c.is_ascii_digit()),
    ))
    .parse_next(input)?;

    let consumed = &start[..start.len() - input.len()];
    consumed.parse::<f64>().map_err(|_| backtrack())
}

/// Parse quoted content delimited by `delimiter`, where the escape sequence is
/// a doubled delimiter (e.g. `""` inside `"…"`, or `''` inside `'…'`).
///
/// Fast path: when no escape sequences are present, the content is copied once
/// via `String::from` instead of being built character-by-character.
fn parse_quoted_content(input: &mut &str, mut delimiter: char) -> ModalResult<String> {
    let _ = delimiter.parse_next(input)?;

    // Fast path: scan for closing delimiter without an escape sequence.
    if let Some(end) = input.find(delimiter) {
        let after_delim = end + delimiter.len_utf8();
        let has_escape = input
            .get(after_delim..)
            .is_some_and(|s| s.starts_with(delimiter));
        if !has_escape {
            let content = input[..end].to_string();
            *input = &input[after_delim..];
            return Ok(content);
        }
    }

    // Slow path: escape sequences present — build char-by-char.
    let mut result = String::new();
    loop {
        let chunk: &str = take_while(0.., |c: char| c != delimiter).parse_next(input)?;
        result.push_str(chunk);
        let _ = delimiter.parse_next(input)?;
        if input.starts_with(delimiter) {
            let _ = delimiter.parse_next(input)?;
            result.push(delimiter);
        } else {
            break;
        }
    }
    Ok(result)
}

/// Parse a string literal enclosed in double quotes.
/// Handles escaped double quotes ("" inside the string).
pub fn string_literal(input: &mut &str) -> ModalResult<String> {
    parse_quoted_content(input, '"')
}

/// Parse an Excel error literal: #DIV/0!, #N/A, #NAME?, #NULL!, #NUM!, #REF!, #VALUE!, #SPILL!, #CALC!, #`GETTING_DATA`
///
/// Uses prefix matching (longest first) to avoid greedily consuming operator
/// characters that follow the error literal. For example, in `#REF!/(B16+B22)`,
/// the `/` is a division operator, not part of the error token.
pub fn error_literal(input: &mut &str) -> ModalResult<CellError> {
    // Sorted longest-first so longer prefixes win over shorter ones.
    static ERRORS: &[(&str, CellError)] = &[
        ("#GETTING_DATA", CellError::GettingData),
        ("#VALUE!", CellError::Value),
        ("#SPILL!", CellError::Spill),
        ("#NULL!", CellError::Null),
        ("#NAME?", CellError::Name),
        ("#CALC!", CellError::Calc),
        ("#DIV/0!", CellError::Div0),
        ("#REF!", CellError::Ref),
        ("#NUM!", CellError::Num),
        ("#N/A", CellError::Na),
    ];

    for &(literal, err) in ERRORS {
        if input
            .get(..literal.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(literal))
        {
            *input = &input[literal.len()..];
            return Ok(err);
        }
    }

    Err(backtrack())
}

/// Parse an identifier (letters, digits, underscores, dots — starts with letter or underscore).
pub fn identifier<'i>(input: &mut &'i str) -> ModalResult<&'i str> {
    let start = *input;
    let _first =
        one_of(|c: char| c.is_ascii_alphabetic() || c == '_' || c == '\\').parse_next(input)?;
    let _ = take_while(0.., |c: char| {
        c.is_ascii_alphanumeric() || c == '_' || c == '.'
    })
    .parse_next(input)?;
    let consumed = &start[..start.len() - input.len()];
    Ok(consumed)
}

/// Parse column letters (one or more ASCII letters).
#[inline]
pub fn col_letters<'i>(input: &mut &'i str) -> ModalResult<&'i str> {
    take_while(1.., |c: char| c.is_ascii_alphabetic()).parse_next(input)
}

/// Parse a row number (1-based, as a string).
#[inline]
pub fn row_digits<'i>(input: &mut &'i str) -> ModalResult<&'i str> {
    take_while(1.., |c: char| c.is_ascii_digit()).parse_next(input)
}

/// Parse a quoted sheet name: 'Sheet Name' (single quotes, '' for escaped single quote).
pub fn quoted_sheet_name(input: &mut &str) -> ModalResult<String> {
    parse_quoted_content(input, '\'')
}

/// Parse an unquoted sheet name (letters, digits, underscores — no spaces).
#[inline]
pub fn unquoted_sheet_name<'i>(input: &mut &'i str) -> ModalResult<&'i str> {
    take_while(1.., |c: char| c.is_ascii_alphanumeric() || c == '_').parse_next(input)
}

#[cfg(test)]
#[path = "lexer_tests.rs"]
mod tests;
