//! Error recovery functions for the cell parser.
//!
//! These functions provide error handling and recovery capabilities
//! for parsing cells with malformed or invalid data.

use super::adapters::{find_byte, find_sequence};
use super::helpers::{extract_attribute, parse_u32};
use super::types::{
    CELL_TYPE_BOOL, CELL_TYPE_ERROR, CELL_TYPE_FORMULA_STRING, CELL_TYPE_NUMBER, CELL_TYPE_STRING,
    CellData, VALUE_TYPE_CACHED_FORMULA, VALUE_TYPE_FORMULA, VALUE_TYPE_INLINE, VALUE_TYPE_NONE,
    VALUE_TYPE_SHARED_STRING,
};
use crate::infra::error::{
    ErrorCode, ErrorLocation, ParseContext, ParseErrorDetail, recover_cell_reference,
    recover_number, recover_shared_string, recover_style_index,
};

fn diagnostic_utf8(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(value) => value.to_owned(),
        Err(err) => format!("<invalid utf-8 at byte {}>", err.valid_up_to()),
    }
}

/// Result of parsing a single cell element
#[derive(Debug)]
pub(crate) enum CellParseResult {
    /// Cell parsed successfully
    Success(CellData),
    /// Cell was skipped due to an error
    Skipped,
    /// Parsing should stop (fatal error or strict mode)
    Stop,
}

/// Parse a single cell element with error recovery.
///
/// When `is_self_closing` is true the element is `<c ... />` and cannot
/// contain children — skip type/value extraction (same fast-path as
/// `parse_cell_element`).
pub(crate) fn parse_cell_element_with_context(
    xml: &[u8],
    fallback_row: u32,
    shared_strings: &[&str],
    strings: &mut Vec<u8>,
    context: &mut ParseContext,
    is_self_closing: bool,
) -> CellParseResult {
    // Parse cell reference (r attribute) for row and column
    let (row, col) = match super::helpers::parse_cell_ref_fast(xml) {
        Some((r, c)) => (r, c),
        None => {
            // Try to extract the raw reference for error reporting
            let raw_ref = extract_attribute(xml, b"r")
                .map(diagnostic_utf8)
                .unwrap_or_else(|| "<missing>".to_string());

            // Report the error
            let should_continue = context.report_error_detail(
                ParseErrorDetail::error(
                    ErrorCode::InvalidCellReference,
                    format!("Invalid cell reference: {}", raw_ref),
                )
                .with_location(ErrorLocation::cell(
                    &context.current_part,
                    fallback_row + 1,
                    0,
                ))
                .with_raw_data(raw_ref.clone())
                .with_fallback(format!("row={}, col=0", fallback_row)),
            );

            if !should_continue {
                return CellParseResult::Stop;
            }

            // In permissive mode, use fallback values
            if context.mode == crate::infra::error::ParseMode::Permissive {
                let (recovered_row, recovered_col) = recover_cell_reference(&raw_ref);
                if recovered_row == 0 && recovered_col == 0 {
                    // Use fallback row and column 0
                    (fallback_row, 0)
                } else {
                    (recovered_row, recovered_col)
                }
            } else {
                // In lenient mode, skip this cell
                return CellParseResult::Skipped;
            }
        }
    };

    // Parse style index (s attribute) with recovery — needed for both paths
    let style_idx = parse_style_idx_with_recovery(xml, context, row, col);

    // Fast-path: self-closing cells have no children
    let (cell_type, value_type, value_bytes): (u8, u8, &[u8]) = if is_self_closing {
        (CELL_TYPE_NUMBER, VALUE_TYPE_NONE, b"" as &[u8])
    } else {
        let ct = parse_cell_type_with_recovery(xml, context, row, col);
        let (vt, vb) =
            extract_cell_value_with_context(xml, shared_strings, strings, context, row, col, ct);
        (ct, vt, vb)
    };

    // The error-recovery path has no ParseExtras side channel. Preserve
    // authored style-only cells as sparse cells here so callers do not lose
    // the explicit `s` attribute when the fast path cannot be used.

    let value_offset = strings.len() as u32;
    let value_len = value_bytes.len() as u32;
    strings.extend_from_slice(value_bytes);

    CellParseResult::Success(CellData {
        row,
        col,
        cell_type,
        style_idx,
        value_type,
        value_offset,
        value_len,
    })
}

/// Parse cell type with error recovery
pub(crate) fn parse_cell_type_with_recovery(
    xml: &[u8],
    context: &mut ParseContext,
    _row: u32,
    _col: u32,
) -> u8 {
    // Look for t=" attribute
    if let Some(t_pos) = find_sequence(xml, b"t=\"", 0) {
        let start = t_pos + 3;

        // Read the type value (up to closing quote)
        if start < xml.len() {
            match xml[start] {
                b'n' => CELL_TYPE_NUMBER,
                b's' => {
                    // Could be "s" (shared string) or "str" (inline formula string)
                    if start + 1 < xml.len() && xml[start + 1] == b't' {
                        // "str" - inline formula string result (<v> is literal text)
                        CELL_TYPE_FORMULA_STRING
                    } else {
                        // "s" - shared string reference (<v> is an index)
                        CELL_TYPE_STRING
                    }
                }
                b'i' => {
                    // "inlineStr"
                    CELL_TYPE_STRING
                }
                b'b' => CELL_TYPE_BOOL,
                b'e' => CELL_TYPE_ERROR,
                b'"' => CELL_TYPE_NUMBER, // Empty t="" defaults to number
                _ => {
                    // Unknown type - report warning and default to string
                    let raw_type = extract_attribute(xml, b"t")
                        .map(diagnostic_utf8)
                        .unwrap_or_else(|| "<unknown>".to_string());

                    context.report_warning(
                        ErrorCode::InvalidElement,
                        &format!("Unknown cell type '{}', defaulting to string", raw_type),
                    );

                    CELL_TYPE_STRING
                }
            }
        } else {
            CELL_TYPE_NUMBER
        }
    } else {
        // No t attribute means number
        CELL_TYPE_NUMBER
    }
}

/// Parse style index with error recovery
pub(crate) fn parse_style_idx_with_recovery(
    xml: &[u8],
    context: &mut ParseContext,
    _row: u32,
    _col: u32,
) -> u16 {
    // Look for s=" attribute (space before to avoid matching other attrs ending in 's')
    let patterns: [&[u8]; 2] = [b" s=\"", b"<c s=\""];

    for pattern in patterns {
        if let Some(s_pos) = find_sequence(xml, pattern, 0) {
            let start = s_pos + pattern.len();
            let mut style_idx: u32 = 0;
            let mut pos = start;
            let mut valid = true;
            let mut digits_found = false;

            while pos < xml.len() && xml[pos] != b'"' {
                if xml[pos].is_ascii_digit() {
                    style_idx = style_idx
                        .saturating_mul(10)
                        .saturating_add((xml[pos] - b'0') as u32);
                    digits_found = true;
                } else {
                    valid = false;
                    break;
                }
                pos += 1;
            }

            if !valid || !digits_found {
                // Invalid style index - extract raw value for error reporting
                let raw_style = extract_attribute(xml, b"s")
                    .map(diagnostic_utf8)
                    .unwrap_or_else(|| "<invalid>".to_string());

                context.report_warning(
                    ErrorCode::InvalidStyleIndex,
                    &format!("Invalid style index '{}', using default style 0", raw_style),
                );

                return recover_style_index(&raw_style) as u16;
            }

            // Check for overflow
            if style_idx > u16::MAX as u32 {
                context.report_warning(
                    ErrorCode::InvalidStyleIndex,
                    &format!("Style index {} exceeds maximum, using 0", style_idx),
                );
                return 0;
            }

            return style_idx as u16;
        }
    }

    0 // Default style
}

/// Extract cell value with error recovery
pub(crate) fn extract_cell_value_with_context<'a>(
    xml: &'a [u8],
    shared_strings: &'a [&'a str],
    _strings: &mut Vec<u8>,
    context: &mut ParseContext,
    row: u32,
    col: u32,
    cell_type: u8,
) -> (u8, &'a [u8]) {
    // Check for formula first (<f>)
    if let Some(f_start) = find_sequence(xml, b"<f>", 0) {
        let content_start = f_start + 3;
        if let Some(f_end) = find_sequence(xml, b"</f>", content_start) {
            return (VALUE_TYPE_FORMULA, &xml[content_start..f_end]);
        } else {
            // Malformed formula element
            context.report_warning(ErrorCode::MalformedXml, "Unclosed <f> element in cell");
        }
    }

    // Also check for formula with attributes (<f ...>)
    if let Some(f_start) = find_sequence(xml, b"<f ", 0) {
        if let Some(gt) = find_byte(xml, b'>', f_start) {
            // Check for self-closing formula tag like <f t="shared" si="4"/>
            if gt > f_start && xml[gt - 1] == b'/' {
                // Self-closing formula reference - extract cached <v> value
                // Handles both <v>text</v> and <v xml:space="preserve">text</v>
                let v_content_start = if let Some(v_start) = find_sequence(xml, b"<v>", 0) {
                    Some(v_start + 3)
                } else if let Some(v_start) = find_sequence(xml, b"<v ", 0) {
                    find_byte(xml, b'>', v_start).map(|gt| gt + 1)
                } else {
                    None
                };
                if let Some(v_content_start) = v_content_start {
                    if let Some(v_end) = find_sequence(xml, b"</v>", v_content_start) {
                        let value_bytes = &xml[v_content_start..v_end];
                        if cell_type == CELL_TYPE_STRING {
                            if let Some(idx) = parse_u32(value_bytes) {
                                if let Some(shared_str) = shared_strings.get(idx as usize) {
                                    return (VALUE_TYPE_CACHED_FORMULA, shared_str.as_bytes());
                                }
                            }
                        }
                        return (VALUE_TYPE_CACHED_FORMULA, value_bytes);
                    }
                }
                return (VALUE_TYPE_CACHED_FORMULA, b"" as &[u8]);
            }
            let content_start = gt + 1;
            if let Some(f_end) = find_sequence(xml, b"</f>", content_start) {
                return (VALUE_TYPE_FORMULA, &xml[content_start..f_end]);
            }
        }
    }

    // Check for value (<v>) — handles both <v>text</v> and <v xml:space="preserve">text</v>
    let v_content_start = if let Some(v_start) = find_sequence(xml, b"<v>", 0) {
        Some(v_start + 3)
    } else if let Some(v_start) = find_sequence(xml, b"<v ", 0) {
        find_byte(xml, b'>', v_start).map(|gt| gt + 1)
    } else {
        None
    };
    if let Some(content_start) = v_content_start {
        if let Some(v_end) = find_sequence(xml, b"</v>", content_start) {
            let value_bytes = &xml[content_start..v_end];

            // Check if this is a shared string reference (using passed cell_type)
            if cell_type == CELL_TYPE_STRING {
                // Parse the shared string index
                match parse_u32(value_bytes) {
                    Some(idx) => {
                        let idx_usize = idx as usize;
                        if let Some(shared_str) = shared_strings.get(idx_usize) {
                            // Return the actual string from shared strings
                            return (VALUE_TYPE_SHARED_STRING, shared_str.as_bytes());
                        } else {
                            // Invalid shared string index - report error
                            context.report_error_detail(
                                ParseErrorDetail::error(
                                    ErrorCode::InvalidSharedStringIndex,
                                    format!(
                                        "Shared string index {} out of bounds (max: {})",
                                        idx,
                                        shared_strings.len()
                                    ),
                                )
                                .with_location(ErrorLocation::cell(
                                    &context.current_part,
                                    row + 1,
                                    col + 1,
                                ))
                                .with_raw_data(format!("{}", idx))
                                .with_fallback("#REF!"),
                            );

                            // Return placeholder
                            let placeholder =
                                recover_shared_string(idx_usize, shared_strings.len());
                            return (VALUE_TYPE_INLINE, placeholder.as_bytes());
                        }
                    }
                    None => {
                        // Cannot parse shared string index
                        let raw_value = diagnostic_utf8(value_bytes);
                        context.report_error_detail(
                            ParseErrorDetail::error(
                                ErrorCode::InvalidCellValue,
                                "Cannot parse shared string index",
                            )
                            .with_location(ErrorLocation::cell(
                                &context.current_part,
                                row + 1,
                                col + 1,
                            ))
                            .with_raw_data(raw_value)
                            .with_fallback("#REF!"),
                        );

                        return (VALUE_TYPE_INLINE, b"#REF!");
                    }
                }
            }

            // For number types, validate the value
            if cell_type == CELL_TYPE_NUMBER {
                let value_str = std::str::from_utf8(value_bytes).unwrap_or("");
                if !value_str.is_empty() && value_str.parse::<f64>().is_err() {
                    // Invalid number - report warning and use recovery
                    let recovered = recover_number(value_str);
                    context.report_warning(
                        ErrorCode::InvalidCellValue,
                        &format!("Invalid number '{}', recovered as {}", value_str, recovered),
                    );
                    // We still return the original bytes as we don't want to allocate
                    // The consumer will need to handle the invalid value
                }
            }

            return (VALUE_TYPE_INLINE, value_bytes);
        } else {
            // Unclosed <v> element
            context.report_warning(ErrorCode::MalformedXml, "Unclosed <v> element in cell");
        }
    }

    // Check for inline string (<is><t>)
    if let Some(is_start) = find_sequence(xml, b"<is>", 0) {
        if let Some(t_start) = find_sequence(xml, b"<t>", is_start) {
            let content_start = t_start + 3;
            if let Some(t_end) = find_sequence(xml, b"</t>", content_start) {
                return (VALUE_TYPE_INLINE, &xml[content_start..t_end]);
            }
        }
        // Handle <t xml:space="preserve"> variant
        if let Some(t_start) = find_sequence(xml, b"<t ", is_start) {
            if let Some(gt) = find_byte(xml, b'>', t_start) {
                let content_start = gt + 1;
                if let Some(t_end) = find_sequence(xml, b"</t>", content_start) {
                    return (VALUE_TYPE_INLINE, &xml[content_start..t_end]);
                }
            }
        }
    }

    // Self-closing value element <v/>
    if find_sequence(xml, b"<v/>", 0).is_some() {
        return (VALUE_TYPE_INLINE, b"");
    }

    (VALUE_TYPE_NONE, b"")
}
