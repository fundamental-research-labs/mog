//! A1-style cell reference utilities.
//!
//! This module provides canonical functions for converting between
//! 0-indexed (row, col) coordinates and A1-style string references
//! (e.g., "A1", "AA10", "XFD1048576").
//!
//! All column/row indices are 0-based unless otherwise noted.

/// Convert 0-indexed column to A1-style letter(s).
///
/// # Examples
/// - 0 -> "A"
/// - 25 -> "Z"
/// - 26 -> "AA"
/// - 701 -> "ZZ"
/// - 702 -> "AAA"
/// - 16383 -> "XFD"
pub fn col_to_letter(col: u32) -> String {
    let mut result = String::new();
    let mut n = col + 1; // Convert to 1-indexed

    while n > 0 {
        n -= 1;
        result.insert(0, (b'A' + (n % 26) as u8) as char);
        n /= 26;
    }

    result
}

/// Convert 0-indexed column to A1-style letters as a fixed-size byte array.
///
/// This is a performance-optimized variant that avoids heap allocation.
/// Returns `[u8; 3]` where trailing zeros indicate unused positions.
/// Letters are left-aligned: e.g., column 0 returns `[b'A', 0, 0]`.
///
/// # Examples
/// - 0 -> `[b'A', 0, 0]`
/// - 25 -> `[b'Z', 0, 0]`
/// - 26 -> `[b'A', b'A', 0]`
/// - 16383 -> `[b'X', b'F', b'D']`
pub fn col_to_letters(col: u32) -> [u8; 3] {
    let mut letters = [0u8; 3];
    let mut c = col + 1; // Convert to 1-indexed for calculation
    let mut i = 2;

    while c > 0 {
        c -= 1;
        letters[i] = b'A' + (c % 26) as u8;
        c /= 26;
        if i == 0 {
            break;
        }
        i -= 1;
    }

    // Shift letters to start
    if letters[0] == 0 && letters[1] == 0 {
        letters[0] = letters[2];
        letters[1] = 0;
        letters[2] = 0;
    } else if letters[0] == 0 {
        letters[0] = letters[1];
        letters[1] = letters[2];
        letters[2] = 0;
    }

    letters
}

/// Convert row and column (0-indexed) to A1-style reference.
///
/// # Examples
/// - (0, 0) -> "A1"
/// - (9, 26) -> "AA10"
/// - (1048575, 16383) -> "XFD1048576"
pub fn to_a1(row: u32, col: u32) -> String {
    format!("{}{}", col_to_letter(col), row + 1)
}

/// Convert row and column (0-indexed) to absolute A1-style reference (e.g., `$A$1`).
///
/// Used by the data-table writer (typed data-table input refs) to emit XLSX `r1`/`r2`
/// attributes from typed `CellRef::Positional` values. XLSX always writes
/// these attributes in fully-absolute form (`$A$1`, never `A1`).
#[must_use]
pub fn to_absolute_a1(row: u32, col: u32) -> String {
    format!("${}${}", col_to_letter(col), row + 1)
}

/// Serialize a typed `formula_types::CellRef` into the absolute A1 form
/// (`$A$1`-style) expected at XLSX writer boundaries.
///
/// `CellRef::Resolved` yields `None` (resolved IDs cannot be re-emitted as
/// A1 without a workbook lookup; data-table input refs are always
/// positional). `CellRef::Positional` yields `Some("$<col>$<row>")`.
#[must_use]
pub fn cell_ref_to_absolute_a1(r: &formula_types::CellRef) -> Option<String> {
    match r {
        formula_types::CellRef::Positional { row, col, .. } => Some(to_absolute_a1(*row, *col)),
        formula_types::CellRef::Resolved(_) => None,
    }
}

/// Format a cell reference from row and column indices (0-based).
///
/// This is an alias for [`to_a1`] provided for backward compatibility.
pub fn format_cell_ref(row: u32, col: u32) -> String {
    to_a1(row, col)
}

/// Parse an A1-style range reference (e.g., "A1:Q34") into 0-based coordinates.
///
/// Returns `(start_row, start_col, end_row, end_col)` all 0-based.
/// Supports absolute references with `$` markers (e.g., "$A$1:$Q$34").
///
/// Returns `None` if the range is not valid.
pub fn parse_a1_range(ref_range: &str) -> Option<(u32, u32, u32, u32)> {
    // Delegates to compute_parser::parse_a1_range; rejects single-cell forms
    // since prior callers expected a two-endpoint range (kept for behavior
    // parity).
    if !ref_range.contains(':') {
        return None;
    }
    let range = compute_parser::parse_a1_range(ref_range)?;
    let (sr, sc) = match range.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (er, ec) = match range.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some((sr, sc, er, ec))
}

/// Parse a single A1-style cell reference (e.g., "Q34") into 0-based (row, col).
///
/// Supports absolute references with `$` markers (e.g., "$A$1").
/// Returns `None` if the reference is not valid.
pub fn parse_a1_cell(cell_ref: &str) -> Option<(u32, u32)> {
    // Delegates to compute_parser::parse_a1_cell. Fixes a latent
    // lowercase-column silent-drop bug in the previous byte-level scan:
    // it checked `is_ascii_uppercase` without uppercasing first, so "a1"
    // returned None. See regression test `test_parse_a1_cell_lowercase`.
    let node = compute_parser::parse_a1_cell(cell_ref)?;
    match node.reference {
        formula_types::CellRef::Positional { row, col, .. } => Some((row, col)),
        formula_types::CellRef::Resolved(_) => None,
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // col_to_letter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_col_to_letter() {
        assert_eq!(col_to_letter(0), "A");
        assert_eq!(col_to_letter(1), "B");
        assert_eq!(col_to_letter(25), "Z");
        assert_eq!(col_to_letter(26), "AA");
        assert_eq!(col_to_letter(27), "AB");
        assert_eq!(col_to_letter(51), "AZ");
        assert_eq!(col_to_letter(52), "BA");
        assert_eq!(col_to_letter(701), "ZZ");
        assert_eq!(col_to_letter(702), "AAA");
        assert_eq!(col_to_letter(16383), "XFD");
    }

    // -------------------------------------------------------------------------
    // col_to_letters (byte array) tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_col_to_letters() {
        assert_eq!(&col_to_letters(0)[0..1], b"A");
        assert_eq!(&col_to_letters(25)[0..1], b"Z");
        assert_eq!(&col_to_letters(26)[0..2], b"AA");
        assert_eq!(&col_to_letters(27)[0..2], b"AB");
        assert_eq!(&col_to_letters(701)[0..2], b"ZZ");
        assert_eq!(&col_to_letters(702)[0..3], b"AAA");
        assert_eq!(&col_to_letters(16383)[0..3], b"XFD");
    }

    // -------------------------------------------------------------------------
    // to_a1 tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_to_a1() {
        assert_eq!(to_a1(0, 0), "A1");
        assert_eq!(to_a1(0, 1), "B1");
        assert_eq!(to_a1(1, 0), "A2");
        assert_eq!(to_a1(9, 26), "AA10");
        assert_eq!(to_a1(1048575, 16383), "XFD1048576");
    }

    // -------------------------------------------------------------------------
    // format_cell_ref tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_format_cell_ref() {
        assert_eq!(format_cell_ref(0, 0), "A1");
        assert_eq!(format_cell_ref(0, 1), "B1");
        assert_eq!(format_cell_ref(9, 0), "A10");
        assert_eq!(format_cell_ref(0, 26), "AA1");
    }

    // -------------------------------------------------------------------------
    // parse_a1_range tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_a1_range() {
        assert_eq!(parse_a1_range("A1:Q34"), Some((0, 0, 33, 16)));
        assert_eq!(parse_a1_range("B2:B2"), Some((1, 1, 1, 1)));
        assert_eq!(
            parse_a1_range("A1:XFD1048576"),
            Some((0, 0, 1048575, 16383))
        );
        assert_eq!(parse_a1_range("$A$1:$Q$34"), Some((0, 0, 33, 16)));
    }

    #[test]
    fn test_parse_a1_range_invalid() {
        assert_eq!(parse_a1_range("A1"), None);
        assert_eq!(parse_a1_range(""), None);
    }

    // -------------------------------------------------------------------------
    // parse_a1_cell tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_a1_cell() {
        assert_eq!(parse_a1_cell("A1"), Some((0, 0)));
        assert_eq!(parse_a1_cell("B2"), Some((1, 1)));
        assert_eq!(parse_a1_cell("Q34"), Some((33, 16)));
        assert_eq!(parse_a1_cell("$A$1"), Some((0, 0)));
        assert_eq!(parse_a1_cell("XFD1048576"), Some((1048575, 16383)));
    }

    #[test]
    fn test_parse_a1_cell_invalid() {
        assert_eq!(parse_a1_cell(""), None);
        assert_eq!(parse_a1_cell("123"), None);
    }

    // Regression: prior byte-level scan used `is_ascii_uppercase()` without
    // an uppercasing step, silently dropping lowercase column letters.
    // After consolidation onto compute-parser, lowercase is accepted.
    #[test]
    fn test_parse_a1_cell_lowercase() {
        assert_eq!(parse_a1_cell("a1"), Some((0, 0)));
        assert_eq!(parse_a1_cell("ab100"), Some((99, 27)));
        assert_eq!(parse_a1_cell("$a$1"), Some((0, 0)));
    }

    #[test]
    fn test_parse_a1_range_lowercase() {
        assert_eq!(parse_a1_range("a1:b2"), Some((0, 0, 1, 1)));
    }
}
