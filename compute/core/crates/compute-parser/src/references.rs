//! Reference-parsing functions extracted from parser.rs.
//!
//! Handles cell references, ranges, sheet-qualified references, and structured references.
//!
//! UTF-8 boundary guard: every `&s[n..]` in this file advances past an ASCII
//! reference delimiter (`$`, `!`, `:`, column-letter byte, digit byte)
//! identified by char-aware tests (`starts_with(char)`,
//! `is_ascii_*`) or by winnow-tracked offsets (`start.len() -
//! input.len()` after a parser commits). Char-boundary by
//! construction. File-scope allow documented here.

#![allow(clippy::string_slice)]

use winnow::prelude::*;

use super::CellRefResolver;
use super::ast::{ASTNode, AbsFlags, CellRefNode, RangeRef};
use super::lexer;
use super::state::ParseState;
use cell_types::SheetId;
use formula_types::{CellRef, ExternalWorkbookToken, RangeType};

use lexer::backtrack;

/// Resolve `sheet_override` to a concrete `SheetId`, falling back to the
/// resolver's current sheet or sheet-id 0.
#[inline]
fn resolve_current_sheet(
    sheet_override: Option<SheetId>,
    resolver: Option<&dyn CellRefResolver>,
) -> SheetId {
    sheet_override.unwrap_or_else(|| {
        resolver.map_or(SheetId::from_raw(0), super::CellRefResolver::current_sheet)
    })
}

/// Create a `CellRef` using the resolver if available, otherwise Positional.
#[inline]
pub fn make_cell_ref(
    resolver: Option<&dyn CellRefResolver>,
    sheet: &SheetId,
    row: u32,
    col: u32,
) -> CellRef {
    resolver.map_or(
        CellRef::Positional {
            sheet: *sheet,
            row,
            col,
        },
        |r| r.resolve(sheet, row, col),
    )
}

/// Parse $?[A-Z]+$?[0-9]+ and return (`abs_col`, col, `abs_row`, row).
#[inline]
pub fn parse_cell_ref_parts(input: &mut &str) -> ModalResult<(bool, u32, bool, u32)> {
    let abs_col = parse_abs_marker(input);

    let col_str = lexer::col_letters.parse_next(input)?;
    let col = cell_types::letter_to_col(col_str).ok_or_else(backtrack)?;

    // Validate column bounds (max col is 16383, i.e., XFD)
    // NOTE: ParseErrorKind::InvalidColumnNumber exists but backtrack() is
    // correct here — we haven't committed to a cell ref yet, and the
    // combinator needs to try other alternatives (e.g. identifier).
    if col >= cell_types::MAX_COLS {
        return Err(backtrack());
    }

    let abs_row = parse_abs_marker(input);

    let row_str = lexer::row_digits.parse_next(input)?;
    let row: u32 = row_str.parse().map_err(|_| backtrack())?;
    if row == 0 {
        return Err(backtrack());
    }

    // Validate row bounds (max row is 1048576)
    // NOTE: ParseErrorKind::InvalidRowNumber exists but backtrack() is correct
    // here — the combinator caller needs Err to try other parse alternatives.
    if row > cell_types::MAX_ROWS {
        return Err(backtrack());
    }

    Ok((abs_col, col, abs_row, row - 1)) // Convert to 0-based row
}

/// Parse column-only reference: $?[A-Z]+
#[inline]
pub fn parse_col_only(input: &mut &str) -> ModalResult<(bool, u32)> {
    let abs_col = parse_abs_marker(input);

    let col_str = lexer::col_letters.parse_next(input)?;
    let col = cell_types::letter_to_col(col_str).ok_or_else(backtrack)?;

    // Validate column bounds (max col is 16383, i.e., XFD)
    // NOTE: ParseErrorKind::InvalidColumnNumber exists but backtrack() is
    // correct here — combinator callers rely on Err to try alternatives.
    if col >= cell_types::MAX_COLS {
        return Err(backtrack());
    }

    // Make sure next char is NOT a digit (otherwise it would be a cell ref, not col-only)
    if !input.is_empty() {
        let next = input.as_bytes()[0];
        if next.is_ascii_digit() || next == b'$' {
            return Err(backtrack());
        }
    }

    Ok((abs_col, col))
}

/// Try to parse a row range like `1:5`.
///
/// When `sheet_override` is `Some`, it is used directly as the sheet for the
/// resulting references (used by `parse_ref_after_sheet`).  When `None`, the
/// sheet falls back to the resolver's current sheet or sheet-id 0.
pub fn try_parse_row_range(
    input: &mut &str,
    state: &ParseState,
    sheet_override: Option<SheetId>,
) -> ModalResult<ASTNode> {
    let resolver = state.resolver;

    // Parse optional $ before first row
    let abs_row1 = parse_abs_marker(input);

    let row1_str = lexer::row_digits.parse_next(input)?;
    let row1: u32 = row1_str.parse().map_err(|_| backtrack())?;
    if row1 == 0 {
        return Err(backtrack());
    }
    // Validate row bounds (max row is 1048576)
    // NOTE: ideally we'd return ParseErrorKind::InvalidRowNumber here, but at
    // this point we haven't yet seen the ':' so we're not committed to a row
    // range — backtrack lets the combinator try other alternatives.
    if row1 > cell_types::MAX_ROWS {
        return Err(backtrack());
    }
    let _ = ':'.parse_next(input)?;

    // Parse optional $ before second row
    let abs_row2 = parse_abs_marker(input);

    let row2_str = lexer::row_digits.parse_next(input)?;
    let row2: u32 = row2_str.parse().map_err(|_| backtrack())?;
    if row2 == 0 {
        return Err(backtrack());
    }
    // Validate row bounds (max row is 1048576)
    // NOTE: After the ':', we're committed to a row range, so
    // ParseErrorKind::InvalidRowNumber would be more descriptive. However,
    // callers use `if let Ok(..)` and fall through to other alternatives on
    // any Err, so switching away from backtrack() would require propagating
    // a cut error — deferred to avoid changing combinator control flow.
    if row2 > cell_types::MAX_ROWS {
        return Err(backtrack());
    }

    let sheet = resolve_current_sheet(sheet_override, resolver);

    // Row range: col=0 for start, col=MAX for end
    let start = make_cell_ref(resolver, &sheet, row1 - 1, 0);
    let end = make_cell_ref(resolver, &sheet, row2 - 1, cell_types::MAX_COLS - 1);

    Ok(ASTNode::Range(
        RangeRef::new(start, end, RangeType::RowRange)
            .with_abs_start_row(abs_row1)
            .with_abs_end_row(abs_row2),
    ))
}

/// Try to parse a column range: A:C
///
/// When `sheet_override` is `Some`, it is used directly as the sheet.
/// When `None`, falls back to the resolver's current sheet or sheet-id 0.
pub fn try_parse_col_range(
    input: &mut &str,
    state: &ParseState,
    sheet_override: Option<SheetId>,
) -> ModalResult<ASTNode> {
    let resolver = state.resolver;
    let (abs_col1, col1) = parse_col_only(input)?;
    let _ = ':'.parse_next(input)?;
    let (abs_col2, col2) = parse_col_only(input)?;

    let sheet = resolve_current_sheet(sheet_override, resolver);

    let start_ref = make_cell_ref(resolver, &sheet, 0, col1);
    let end_ref = make_cell_ref(resolver, &sheet, cell_types::MAX_ROWS - 1, col2);

    Ok(ASTNode::Range(
        RangeRef::new(start_ref, end_ref, RangeType::ColumnRange)
            .with_abs_start_col(abs_col1)
            .with_abs_end_col(abs_col2),
    ))
}

/// Given already-parsed first cell-ref parts, try to parse a range continuation
/// (`:` followed by another cell ref or column), or return a single cell reference.
pub fn cell_ref_to_range_or_single(
    input: &mut &str,
    resolver: Option<&dyn CellRefResolver>,
    sheet: SheetId,
    abs_col: bool,
    col: u32,
    abs_row: bool,
    row: u32,
) -> ASTNode {
    // Check for range
    if input.starts_with(':') {
        let saved_colon = *input;
        *input = &input[1..];

        // Try full cell range: A1:B10
        let saved2 = *input;
        if let Ok((abs_col2, col2, abs_row2, row2)) = parse_cell_ref_parts(input) {
            // Word-boundary check on range end: reject if followed by identifier char
            let boundary_ok = match input.as_bytes().first() {
                Some(&b) => !(b.is_ascii_alphanumeric() || b == b'_'),
                None => true,
            };
            if boundary_ok {
                let start_ref = make_cell_ref(resolver, &sheet, row, col);
                let end_ref = make_cell_ref(resolver, &sheet, row2, col2);
                return ASTNode::Range(RangeRef::with_abs(
                    start_ref,
                    end_ref,
                    RangeType::CellRange,
                    AbsFlags {
                        row: abs_row,
                        col: abs_col,
                    },
                    AbsFlags {
                        row: abs_row2,
                        col: abs_col2,
                    },
                ));
            }
        }
        *input = saved2;

        // Try column-only end for column range: A1:C
        if let Ok((abs_col2, col2)) = parse_col_only(input) {
            let start_ref = make_cell_ref(resolver, &sheet, 0, col);
            let end_ref = make_cell_ref(resolver, &sheet, cell_types::MAX_ROWS - 1, col2);
            return ASTNode::Range(
                RangeRef::new(start_ref, end_ref, RangeType::ColumnRange)
                    .with_abs_start_col(abs_col)
                    .with_abs_end_col(abs_col2),
            );
        }

        // Try #REF! as end of range: A1:#REF!
        if input.starts_with("#REF!") {
            *input = &input[5..]; // consume #REF!
            // In Excel, a range with a #REF! endpoint evaluates to #REF!
            // Consume any trailing ref suffix (e.g. #REF!#REF!)
            consume_ref_suffix(input);
            return ASTNode::Error(value_types::CellError::Ref);
        }

        // Restore to before colon
        *input = saved_colon;
    }

    // Single cell reference
    let cell_ref = make_cell_ref(resolver, &sheet, row, col);
    ASTNode::CellReference(CellRefNode {
        reference: cell_ref,
        abs_row,
        abs_col,
    })
}

/// Parse a cell reference or range starting with '$'.
///
/// When `sheet_override` is `Some`, it is used directly as the sheet.
/// When `None`, falls back to the resolver's current sheet or sheet-id 0.
pub fn parse_cell_or_range(
    input: &mut &str,
    state: &ParseState,
    sheet_override: Option<SheetId>,
) -> ModalResult<ASTNode> {
    let saved = *input;

    // Try column range first: $A:$C
    if let Ok(node) = try_parse_col_range(input, state, sheet_override) {
        return Ok(node);
    }
    *input = saved;

    let (abs_col, col, abs_row, row) = parse_cell_ref_parts(input)?;

    // Word-boundary check: a cell ref must not be followed by an identifier
    // continuation character (same logic as try_parse_cell_or_range_or_func).
    if input
        .as_bytes()
        .first()
        .is_some_and(|&next| next.is_ascii_alphanumeric() || next == b'_')
    {
        *input = saved;
        return Err(backtrack());
    }

    let resolver = state.resolver;
    let sheet = resolve_current_sheet(sheet_override, resolver);

    Ok(cell_ref_to_range_or_single(
        input, resolver, sheet, abs_col, col, abs_row, row,
    ))
}

/// Try to parse an unquoted sheet reference: SheetName!CellRef
/// Also handles 3-D references: Sheet1:Sheet3!CellRef
pub fn try_parse_sheet_ref_unquoted(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let saved = *input;
    let sheet_name: &str = lexer::unquoted_sheet_name.parse_next(input)?;

    // Check for 3-D reference: SheetName:SheetName!CellRef
    if input.starts_with(':') {
        let after_colon = &input[1..];
        // Peek at the second sheet name — must be alphanumeric/underscore followed by '!'
        let mut temp = after_colon;
        if let Ok(end_name) = lexer::unquoted_sheet_name.parse_next(&mut temp)
            && temp.starts_with('!')
        {
            // This is a 3-D reference. Consume the colon, end sheet name, and '!'.
            *input = &input[1..]; // consume ':'
            let _end_name_str: &str = lexer::unquoted_sheet_name.parse_next(input)?;
            *input = &input[1..]; // consume '!'

            let resolved_start = state
                .resolver
                .and_then(|r| r.resolve_sheet_name(sheet_name));
            let resolved_end = state.resolver.and_then(|r| r.resolve_sheet_name(end_name));

            // Parse the inner reference as sheet-relative position data. A
            // 3-D ref expands the same row/col across many sheets at eval
            // time, so resolving `A1` to the start sheet's CellId here would
            // incorrectly pin every expanded sheet to that one cell.
            let inner = parse_ref_after_3d_sheet(input, state)?;

            return match (resolved_start, resolved_end) {
                (Some(start_id), Some(end_id)) => Ok(ASTNode::ThreeDRef {
                    start_sheet: start_id,
                    end_sheet: end_id,
                    inner: Box::new(inner),
                }),
                _ => Ok(ASTNode::UnresolvedThreeDRef {
                    start_name: sheet_name.to_string(),
                    end_name: end_name.to_string(),
                    inner: Box::new(inner),
                }),
            };
        }
    }

    // Regular single-sheet reference: SheetName!CellRef
    if !input.starts_with('!') {
        *input = saved;
        return Err(backtrack());
    }
    *input = &input[1..]; // consume '!'

    // Try to resolve the sheet name
    let resolved_sheet = state
        .resolver
        .and_then(|r| r.resolve_sheet_name(sheet_name));

    // Parse the inner reference with the sheet context
    let inner = parse_ref_after_sheet(input, state, resolved_sheet)?;

    match resolved_sheet {
        Some(sheet_id) => Ok(ASTNode::SheetRef {
            sheet: sheet_id,
            inner: Box::new(inner),
        }),
        None => Ok(ASTNode::UnresolvedSheetRef {
            sheet_name: sheet_name.to_string(),
            inner: Box::new(inner),
        }),
    }
}

/// Parse a quoted sheet reference: 'Sheet Name'!`CellRef`
pub fn parse_sheet_ref_quoted(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let raw_name = lexer::quoted_sheet_name.parse_next(input)?;
    // Must be followed by !
    if !input.starts_with('!') {
        return Err(backtrack());
    }
    *input = &input[1..]; // consume '!'

    if let Some((workbook, sheet_name)) = split_external_quoted_name(&raw_name) {
        let inner = parse_ref_after_external_sheet(input, state)?;
        if let Some((start_sheet, end_sheet)) = sheet_name.split_once(':') {
            return Ok(ASTNode::ExternalThreeDRef {
                workbook,
                start_sheet: start_sheet.to_string(),
                end_sheet: end_sheet.to_string(),
                inner: Box::new(inner),
            });
        }
        return Ok(ASTNode::ExternalSheetRef {
            workbook,
            sheet_name,
            inner: Box::new(inner),
        });
    }

    let sheet_name = raw_name;

    if let Some((start_name, end_name)) = sheet_name.split_once(':') {
        let resolved_start = state
            .resolver
            .and_then(|r| r.resolve_sheet_name(start_name));
        let resolved_end = state.resolver.and_then(|r| r.resolve_sheet_name(end_name));

        let inner = parse_ref_after_3d_sheet(input, state)?;

        return match (resolved_start, resolved_end) {
            (Some(start_id), Some(end_id)) => Ok(ASTNode::ThreeDRef {
                start_sheet: start_id,
                end_sheet: end_id,
                inner: Box::new(inner),
            }),
            _ => Ok(ASTNode::UnresolvedThreeDRef {
                start_name: start_name.to_string(),
                end_name: end_name.to_string(),
                inner: Box::new(inner),
            }),
        };
    }

    let resolved_sheet = state
        .resolver
        .and_then(|r| r.resolve_sheet_name(&sheet_name));

    let inner = parse_ref_after_sheet(input, state, resolved_sheet)?;

    match resolved_sheet {
        Some(sheet_id) => Ok(ASTNode::SheetRef {
            sheet: sheet_id,
            inner: Box::new(inner),
        }),
        None => Ok(ASTNode::UnresolvedSheetRef {
            sheet_name,
            inner: Box::new(inner),
        }),
    }
}

/// Split quoted external syntax into workbook token and sheet name.
///
/// Handles `[Book.xlsx]Sheet`, `C:\Reports\[Budget.xlsx]Annual`, and URL-like
/// forms by preserving the complete token through the closing `]`.
#[must_use]
pub fn split_external_quoted_name(raw_name: &str) -> Option<(ExternalWorkbookToken, String)> {
    let open = raw_name.find('[')?;
    let close_rel = raw_name[open..].find(']')?;
    let close = open + close_rel;
    if close + 1 >= raw_name.len() {
        return None;
    }
    let workbook = ExternalWorkbookToken::new(raw_name[..=close].to_string());
    let sheet_name = raw_name[close + 1..].to_string();
    Some((workbook, sheet_name))
}

/// Parse a cell reference or range after a sheet prefix (Sheet1!...).
pub fn parse_ref_after_sheet(
    input: &mut &str,
    state: &ParseState,
    sheet_id: Option<SheetId>,
) -> ModalResult<ASTNode> {
    // Could be a cell ref, range, column range, or row range
    let saved = *input;

    // Try row range: 1:5
    if let Ok(node) = try_parse_row_range(input, state, sheet_id) {
        return Ok(node);
    }
    *input = saved;

    // Try cell ref / range / column range
    if let Ok(node) = parse_cell_or_range(input, state, sheet_id) {
        return Ok(node);
    }
    *input = saved;

    // Try identifier (named range): Sheet1!MyName
    if let Ok(ident) = lexer::identifier.parse_next(input) {
        // Not a function call — reject if followed by '('
        let after = *input;
        let _ = lexer::ws.parse_next(input);
        if input.starts_with('(') {
            *input = saved;
            // Fall through to other options
        } else {
            *input = after; // restore to right after identifier (before any ws we consumed)
            return Ok(ASTNode::Identifier(ident.to_string()));
        }
    }
    *input = saved;

    // Try #REF! (deleted reference on this sheet): Sheet1!#REF!
    if input.starts_with("#REF!") {
        *input = &input[5..]; // consume #REF!
        consume_ref_suffix(input); // handle #REF!A1, #REF!#REF!, etc.
        return Ok(ASTNode::Error(value_types::CellError::Ref));
    }

    Err(backtrack())
}

/// Parse a reference body after an external sheet prefix without local sheet resolution.
pub fn parse_ref_after_external_sheet(
    input: &mut &str,
    state: &ParseState,
) -> ModalResult<ASTNode> {
    let positional_state = ParseState::new(None, state.formula_input);
    parse_ref_after_sheet(input, &positional_state, None)
}

/// Parse the reference body after a 3-D sheet span.
///
/// The body is deliberately parsed without a [`CellRefResolver`] so cell/range
/// refs remain positional. A 3-D ref is not a reference to the start sheet's
/// identity; it is a reference shape that must be applied to each sheet in the
/// span.
fn parse_ref_after_3d_sheet(input: &mut &str, state: &ParseState) -> ModalResult<ASTNode> {
    let positional_state = ParseState::new(None, state.formula_input);
    parse_ref_after_sheet(input, &positional_state, None)
}

/// Try to parse a structured reference: `TableName`[...]
pub fn try_parse_structured_ref(input: &mut &str) -> ModalResult<ASTNode> {
    let saved = *input;
    let table_name = lexer::identifier.parse_next(input)?;

    if !input.starts_with('[') {
        *input = saved;
        return Err(backtrack());
    }

    // Find the matching outer bracket using the table module's bracket-aware parser
    let Some(bracket_end) = crate::structured_ref_parsing::find_outer_matching_bracket(input, 0)
    else {
        *input = saved;
        return Err(backtrack());
    };

    // Build the full reference string: "TableName[...]"
    let bracket_expr = &(*input)[..=bracket_end];
    let full_ref = format!("{table_name}{bracket_expr}");

    // Delegate to the table module's comprehensive parser
    let Ok(structured_ref) = crate::structured_ref_parsing::parse_structured_ref(&full_ref) else {
        *input = saved;
        return Err(backtrack());
    };

    // Advance input past the closing bracket
    *input = &(*input)[bracket_end + 1..];

    Ok(ASTNode::StructuredRef(structured_ref))
}

/// Parse and consume an optional `$` absolute-reference marker,
/// returning `true` if one was present.
#[inline]
fn parse_abs_marker(input: &mut &str) -> bool {
    if input.starts_with('$') {
        *input = &input[1..];
        true
    } else {
        false
    }
}

/// Skip an optional `$` prefix (absolute-reference marker).
fn skip_dollar(input: &mut &str) {
    if input.starts_with('$') {
        *input = &input[1..];
    }
}

/// Try to consume a reference endpoint: `$?[A-Z]*$?[0-9]*`.
///
/// Handles cell refs (`A1`, `$A$1`), column-only (`A`, `$A`), row-only (`5`, `$5`),
/// or any combination. Returns `true` if any characters were consumed.
fn skip_ref_endpoint(input: &mut &str) -> bool {
    let before = *input;
    skip_dollar(input);
    let _ = lexer::col_letters.parse_next(input).ok();
    skip_dollar(input);
    let _ = lexer::row_digits.parse_next(input).ok();
    *input != before
}

/// Consume a trailing cell/range reference suffix after `#REF!`.
///
/// In Excel, `#REF!` can act as a deleted-sheet prefix followed by a cell or
/// range reference (e.g. `#REF!A1`, `#REF!$A$1:$B$10`, `#REF!A:C`, `#REF!1:5`,
/// `#REF!#REF!`). The entire construct evaluates to `#REF!`.
pub fn consume_ref_suffix(input: &mut &str) {
    // Consume chained #REF! prefixes: #REF!#REF!#REF!
    while input.starts_with("#REF!") {
        *input = &input[5..];
    }

    // Try to consume a reference: $?[A-Z]*$?[0-9]* (cell, column, or row)
    let saved = *input;
    if !skip_ref_endpoint(input) {
        *input = saved;
    }

    // Iteratively consume colon-separated suffixes: :$?[A-Z]*$?[0-9]* or :#REF!...
    loop {
        if !input.starts_with(':') {
            break;
        }
        let colon_saved = *input;
        *input = &input[1..];

        if input.starts_with("#REF!") {
            *input = &input[5..];
            // Continue loop to handle chained #REF! and further colon suffixes
            while input.starts_with("#REF!") {
                *input = &input[5..];
            }
            let _ = skip_ref_endpoint(input);
            // Continue the loop in case there's another `:` suffix
        } else if skip_ref_endpoint(input) {
            // Consumed a valid endpoint after ':', check for more
        } else {
            *input = colon_saved; // not a valid endpoint after ':', restore
            break;
        }
    }
}
