//! A1-style cell and range reference parsing utilities.
//!
//! Used by `parse_output_to_snapshot` for converting A1-style range references
//! (e.g., table ranges, pivot table locations) into 0-based row/col coordinates.

/// Parse a single A1-style cell reference (e.g., "A1") into 0-based (row, col).
pub(crate) fn parse_cell_ref(s: &str) -> Option<(u32, u32)> {
    // Delegates to compute-parser; unwraps the positional (row, col).
    let node = compute_parser::parse_a1_cell(s)?;
    match node.reference {
        formula_types::CellRef::Positional { row, col, .. } => Some((row, col)),
        formula_types::CellRef::Resolved(_) => None,
    }
}

/// Parse an A1-style range reference (e.g., "A1:C5") into 0-based
/// (start_row, start_col, end_row, end_col).
pub(crate) fn parse_range_ref(s: &str) -> Option<(u32, u32, u32, u32)> {
    // Delegates to compute-parser; rejects single-cell forms — callers here
    // expect a two-endpoint range (a bare "A1" is handled by parse_cell_ref).
    if !s.contains(':') {
        return None;
    }
    let range = compute_parser::parse_a1_range(s)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    // ---- parse_cell_ref tests ----

    #[test]
    fn parse_cell_ref_a1() {
        assert_eq!(parse_cell_ref("A1"), Some((0, 0)));
    }

    #[test]
    fn parse_cell_ref_z26() {
        assert_eq!(parse_cell_ref("Z26"), Some((25, 25)));
    }

    #[test]
    fn parse_cell_ref_aa1() {
        assert_eq!(parse_cell_ref("AA1"), Some((0, 26)));
    }

    #[test]
    fn parse_cell_ref_xfd1() {
        // XFD = 16384 (max Excel column)
        assert_eq!(parse_cell_ref("XFD1"), Some((0, 16383)));
    }

    #[test]
    fn parse_cell_ref_invalid() {
        assert_eq!(parse_cell_ref(""), None);
        assert_eq!(parse_cell_ref("A"), None);
        assert_eq!(parse_cell_ref("123"), None);
    }

    // ---- parse_range_ref tests ----

    #[test]
    fn parse_range_ref_simple() {
        assert_eq!(parse_range_ref("A1:C5"), Some((0, 0, 4, 2)));
    }

    #[test]
    fn parse_range_ref_single_cell_range() {
        assert_eq!(parse_range_ref("B2:B2"), Some((1, 1, 1, 1)));
    }

    #[test]
    fn parse_range_ref_invalid() {
        assert_eq!(parse_range_ref("A1"), None); // no colon
        assert_eq!(parse_range_ref("A1:B2:C3"), None); // too many parts
    }
}
