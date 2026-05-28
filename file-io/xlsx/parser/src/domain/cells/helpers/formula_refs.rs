use super::a1::{col_to_letters, format_u32};

/// Adjust A1 cell references in a formula string by row and column offsets.
///
/// This function scans a formula for A1-style cell references (e.g., `A1`, `$B$2`,
/// `AA100`) and adjusts them by the given row and column offsets, respecting
/// absolute reference markers (`$`).
///
/// # Rules
/// - `$` before column letters: column is absolute (not adjusted)
/// - `$` before row digits: row is absolute (not adjusted)
/// - References inside string literals (double-quoted) are not adjusted
/// - Sheet-qualified references like `Sheet1!A1` are handled (the A1 part is adjusted)
///
/// # Arguments
/// * `formula` - The formula text as a byte slice
/// * `row_offset` - Number of rows to shift (positive = down, negative = up)
/// * `col_offset` - Number of columns to shift (positive = right, negative = left)
///
/// # Returns
/// The adjusted formula as a String
pub fn adjust_formula_references(formula: &[u8], row_offset: i32, col_offset: i32) -> String {
    if row_offset == 0 && col_offset == 0 {
        return std::str::from_utf8(formula)
            .expect("worksheet formula XML text was validated as UTF-8 at the archive boundary")
            .to_owned();
    }

    let mut result = Vec::with_capacity(formula.len() + 16);
    let mut pos = 0;

    while pos < formula.len() {
        let b = formula[pos];

        // Skip string literals (double-quoted in formulas)
        if b == b'"' {
            result.push(b);
            pos += 1;
            while pos < formula.len() {
                result.push(formula[pos]);
                if formula[pos] == b'"' {
                    pos += 1;
                    break;
                }
                pos += 1;
            }
            continue;
        }

        // Skip single-quoted sheet names (e.g., 'Sheet 1'!A1)
        if b == b'\'' {
            result.push(b);
            pos += 1;
            while pos < formula.len() {
                result.push(formula[pos]);
                if formula[pos] == b'\'' {
                    pos += 1;
                    break;
                }
                pos += 1;
            }
            continue;
        }

        // Check if we're at the start of a potential cell reference
        // A cell reference is: optional $ + column letters + optional $ + row digits
        // It must NOT be preceded by an alphanumeric character (to avoid matching
        // function names like SUM, IF, etc.)
        let is_ref_start = (b == b'$' || b.is_ascii_uppercase())
            && (pos == 0 || !formula[pos - 1].is_ascii_alphanumeric() && formula[pos - 1] != b'_');

        if is_ref_start {
            if let Some((ref_len, adjusted)) =
                try_adjust_reference(&formula[pos..], row_offset, col_offset)
            {
                result.extend_from_slice(adjusted.as_bytes());
                pos += ref_len;
                continue;
            }
        }

        result.push(b);
        pos += 1;
    }

    std::str::from_utf8(&result)
        .expect("adjusted worksheet formula remains valid UTF-8")
        .to_owned()
}

/// Try to parse and adjust a single A1 reference at the start of `input`.
///
/// Returns `Some((bytes_consumed, adjusted_string))` if a valid reference was found,
/// or `None` if the input doesn't start with a valid A1 reference.
fn try_adjust_reference(input: &[u8], row_offset: i32, col_offset: i32) -> Option<(usize, String)> {
    let mut pos = 0;

    // Check for $ before column
    let col_absolute = if pos < input.len() && input[pos] == b'$' {
        pos += 1;
        true
    } else {
        false
    };

    // Parse column letters (must have at least one)
    let col_start = pos;
    let mut col_val: u32 = 0;
    while pos < input.len() && input[pos].is_ascii_uppercase() {
        col_val = col_val
            .saturating_mul(26)
            .saturating_add((input[pos] - b'A' + 1) as u32);
        pos += 1;
    }

    if pos == col_start || col_val == 0 {
        return None; // No column letters found
    }
    let col_0indexed = col_val - 1; // Convert to 0-indexed

    // Check for $ before row
    let row_absolute = if pos < input.len() && input[pos] == b'$' {
        pos += 1;
        true
    } else {
        false
    };

    // Parse row digits (must have at least one)
    let row_start = pos;
    let mut row_val: u32 = 0;
    while pos < input.len() && input[pos].is_ascii_digit() {
        row_val = row_val
            .saturating_mul(10)
            .saturating_add((input[pos] - b'0') as u32);
        pos += 1;
    }

    if pos == row_start || row_val == 0 {
        return None; // No row digits found
    }
    let row_0indexed = row_val - 1; // Convert to 0-indexed (A1 references are 1-based for rows)

    // Make sure the character after the reference is not alphanumeric
    // (to avoid partial matches like "A1B" being treated as ref "A1" + "B")
    if pos < input.len() && (input[pos].is_ascii_alphanumeric() || input[pos] == b'_') {
        return None;
    }

    // Apply offsets
    let new_col = if col_absolute {
        col_0indexed
    } else {
        let adjusted = col_0indexed as i32 + col_offset;
        if adjusted < 0 || adjusted > 16383 {
            return None; // Out of range, leave reference unchanged
        }
        adjusted as u32
    };

    let new_row = if row_absolute {
        row_0indexed
    } else {
        let adjusted = row_0indexed as i32 + row_offset;
        if adjusted < 0 || adjusted > 1048575 {
            return None; // Out of range, leave reference unchanged
        }
        adjusted as u32
    };

    // Build the adjusted reference string
    let mut adjusted = String::with_capacity(10);

    if col_absolute {
        adjusted.push('$');
    }

    // Convert column back to letters
    let col_letters = col_to_letters(new_col);
    for &letter in &col_letters {
        if letter != 0 {
            adjusted.push(letter as char);
        }
    }

    if row_absolute {
        adjusted.push('$');
    }

    // Row is 1-based in A1 notation
    let row_1based = new_row + 1;
    let mut row_buf = [0u8; 10]; // Max 10 digits for u32
    let row_str = format_u32(row_1based, &mut row_buf);
    adjusted.push_str(row_str);

    Some((pos, adjusted))
}
