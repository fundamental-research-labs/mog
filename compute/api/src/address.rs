//! A1-style address parsing and resolution for the compute-api facade.
//!
//! Provides [`CellAddress`] and [`CellRange`] enums that accept either A1 strings
//! or numeric `(row, col)` positions and resolve them to zero-based coordinates.
//! Column conversion delegates to [`cell_types::letter_to_col`] and
//! [`cell_types::col_to_letter`].

use cell_types::{MAX_COLS, MAX_ROWS, letter_to_col};

use crate::error::ComputeApiError;

// ---------------------------------------------------------------------------
// CellAddress
// ---------------------------------------------------------------------------

/// A cell address that can be specified as an A1 string or numeric position.
///
/// # Examples
///
/// ```ignore
/// use compute_api::CellAddress;
///
/// let a1 = CellAddress::A1("B3".into());
/// assert_eq!(a1.resolve().unwrap(), (2, 1)); // row=2, col=1
///
/// let pos = CellAddress::Position(2, 1);
/// assert_eq!(pos.resolve().unwrap(), (2, 1));
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CellAddress {
    /// An A1-style reference (e.g. `"A1"`, `"$B$3"`, `"XFD1048576"`).
    A1(String),
    /// A zero-based `(row, col)` position.
    Position(u32, u32),
}

impl CellAddress {
    /// Resolve to zero-based `(row, col)`.
    ///
    /// For `A1` variants the string is parsed (stripping optional `$` markers).
    /// For `Position` variants the coordinates are returned directly.
    ///
    /// # Errors
    ///
    /// Returns [`ComputeApiError::InvalidAddress`] when the A1 string is
    /// malformed, the column exceeds XFD (16 383), or the row is outside 1..=1 048 576.
    pub fn resolve(&self) -> Result<(u32, u32), ComputeApiError> {
        match self {
            CellAddress::Position(row, col) => Ok((*row, *col)),
            CellAddress::A1(raw) => parse_a1(raw),
        }
    }
}

impl From<&str> for CellAddress {
    fn from(s: &str) -> Self {
        CellAddress::A1(s.to_owned())
    }
}

impl From<(u32, u32)> for CellAddress {
    fn from((row, col): (u32, u32)) -> Self {
        CellAddress::Position(row, col)
    }
}

// ---------------------------------------------------------------------------
// CellRange
// ---------------------------------------------------------------------------

/// A rectangular cell range specified as an A1 range string or numeric bounds.
///
/// # Examples
///
/// ```ignore
/// use compute_api::CellRange;
///
/// let r = CellRange::A1Range("A1:B2".into());
/// assert_eq!(r.resolve().unwrap(), (0, 0, 1, 1));
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CellRange {
    /// An A1-style range (e.g. `"A1:B2"`, `"$A$1:$C$3"`).
    A1Range(String),
    /// Zero-based `(start_row, start_col, end_row, end_col)`.
    Bounds(u32, u32, u32, u32),
}

impl CellRange {
    /// Resolve to zero-based `(start_row, start_col, end_row, end_col)`.
    ///
    /// # Errors
    ///
    /// Returns [`ComputeApiError::InvalidRange`] when the range string is
    /// malformed or either corner address is invalid.
    pub fn resolve(&self) -> Result<(u32, u32, u32, u32), ComputeApiError> {
        match self {
            CellRange::Bounds(sr, sc, er, ec) => Ok((*sr, *sc, *er, *ec)),
            CellRange::A1Range(raw) => parse_a1_range(raw),
        }
    }
}

impl From<&str> for CellRange {
    fn from(s: &str) -> Self {
        CellRange::A1Range(s.to_owned())
    }
}

impl From<(u32, u32, u32, u32)> for CellRange {
    fn from((sr, sc, er, ec): (u32, u32, u32, u32)) -> Self {
        CellRange::Bounds(sr, sc, er, ec)
    }
}

// ---------------------------------------------------------------------------
// Internal parsing helpers
// ---------------------------------------------------------------------------

/// Parse an A1 reference (e.g. `"A1"`, `"$B$3"`) into zero-based `(row, col)`.
fn parse_a1(raw: &str) -> Result<(u32, u32), ComputeApiError> {
    let addr = |reason: &str| ComputeApiError::InvalidAddress {
        address: raw.to_owned(),
        reason: reason.to_owned(),
    };

    // Strip `$` markers (absolute reference indicators).
    let stripped: String = raw.chars().filter(|&c| c != '$').collect();

    if stripped.is_empty() {
        return Err(addr("empty address"));
    }

    // Split into column letters and row digits.
    let first_digit = stripped
        .find(|c: char| c.is_ascii_digit())
        .ok_or_else(|| addr("no row number"))?;

    if first_digit == 0 {
        return Err(addr("no column letters"));
    }

    let col_str = &stripped[..first_digit];
    let row_str = &stripped[first_digit..];

    if row_str.is_empty() {
        return Err(addr("no row number"));
    }

    // Column — delegate to cell_types (0-based).
    let col = letter_to_col(col_str).ok_or_else(|| addr("invalid column letters"))?;
    if col >= MAX_COLS {
        return Err(addr(&format!("column exceeds maximum ({MAX_COLS})")));
    }

    // Row — A1 is 1-based, we store 0-based.
    let row_1based: u32 = row_str.parse().map_err(|_| addr("invalid row number"))?;

    if row_1based == 0 {
        return Err(addr("row must be >= 1 in A1 notation"));
    }
    if row_1based > MAX_ROWS {
        return Err(addr(&format!("row exceeds maximum ({MAX_ROWS})")));
    }

    Ok((row_1based - 1, col))
}

/// Parse an A1 range (e.g. `"A1:B2"`) into zero-based bounds.
fn parse_a1_range(raw: &str) -> Result<(u32, u32, u32, u32), ComputeApiError> {
    let range_err = |reason: &str| ComputeApiError::InvalidRange {
        range: raw.to_owned(),
        reason: reason.to_owned(),
    };

    let parts: Vec<&str> = raw.split(':').collect();
    if parts.len() != 2 {
        return Err(range_err("expected format A1:B2"));
    }

    let (start_row, start_col) = parse_a1(parts[0]).map_err(|e| match e {
        ComputeApiError::InvalidAddress { reason, .. } => ComputeApiError::InvalidRange {
            range: raw.to_owned(),
            reason: format!("start address: {reason}"),
        },
        other => other,
    })?;

    let (end_row, end_col) = parse_a1(parts[1]).map_err(|e| match e {
        ComputeApiError::InvalidAddress { reason, .. } => ComputeApiError::InvalidRange {
            range: raw.to_owned(),
            reason: format!("end address: {reason}"),
        },
        other => other,
    })?;

    Ok((start_row, start_col, end_row, end_col))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // === CellAddress basic A1 parsing ===

    #[test]
    fn a1_basic() {
        assert_eq!(CellAddress::A1("A1".into()).resolve().unwrap(), (0, 0));
    }

    #[test]
    fn b2() {
        assert_eq!(CellAddress::A1("B2".into()).resolve().unwrap(), (1, 1));
    }

    #[test]
    fn z1() {
        assert_eq!(CellAddress::A1("Z1".into()).resolve().unwrap(), (0, 25));
    }

    #[test]
    fn aa1() {
        assert_eq!(CellAddress::A1("AA1".into()).resolve().unwrap(), (0, 26));
    }

    // === Max address ===

    #[test]
    fn max_address() {
        // XFD = col 16383, row 1048576 -> 0-based row 1048575
        assert_eq!(
            CellAddress::A1("XFD1048576".into()).resolve().unwrap(),
            (1_048_575, 16_383)
        );
    }

    // === Absolute references ===

    #[test]
    fn absolute_a1() {
        assert_eq!(CellAddress::A1("$A$1".into()).resolve().unwrap(), (0, 0));
    }

    #[test]
    fn absolute_b2() {
        assert_eq!(CellAddress::A1("$B2".into()).resolve().unwrap(), (1, 1));
    }

    #[test]
    fn absolute_mixed() {
        assert_eq!(CellAddress::A1("B$2".into()).resolve().unwrap(), (1, 1));
    }

    // === Position round-trip ===

    #[test]
    fn position_passthrough() {
        assert_eq!(CellAddress::Position(5, 3).resolve().unwrap(), (5, 3));
    }

    // === From impls ===

    #[test]
    fn from_str() {
        let addr: CellAddress = "C4".into();
        assert_eq!(addr.resolve().unwrap(), (3, 2));
    }

    #[test]
    fn from_tuple() {
        let addr: CellAddress = (10, 20).into();
        assert_eq!(addr.resolve().unwrap(), (10, 20));
    }

    // === Error cases ===

    #[test]
    fn empty_string() {
        assert!(CellAddress::A1("".into()).resolve().is_err());
    }

    #[test]
    fn digits_only() {
        assert!(CellAddress::A1("123".into()).resolve().is_err());
    }

    #[test]
    fn letters_only() {
        assert!(CellAddress::A1("ABC".into()).resolve().is_err());
    }

    #[test]
    fn row_zero() {
        assert!(CellAddress::A1("A0".into()).resolve().is_err());
    }

    #[test]
    fn row_too_large() {
        assert!(CellAddress::A1("A1048577".into()).resolve().is_err());
    }

    #[test]
    fn col_beyond_xfd() {
        // XFE = col 16384 which is >= MAX_COLS
        assert!(CellAddress::A1("XFE1".into()).resolve().is_err());
    }

    // === Lowercase ===

    #[test]
    fn lowercase_a1() {
        assert_eq!(CellAddress::A1("a1".into()).resolve().unwrap(), (0, 0));
    }

    #[test]
    fn lowercase_aa1() {
        assert_eq!(CellAddress::A1("aa1".into()).resolve().unwrap(), (0, 26));
    }

    // === CellRange tests ===

    #[test]
    fn range_a1_b2() {
        assert_eq!(
            CellRange::A1Range("A1:B2".into()).resolve().unwrap(),
            (0, 0, 1, 1)
        );
    }

    #[test]
    fn range_absolute() {
        assert_eq!(
            CellRange::A1Range("$A$1:$C$3".into()).resolve().unwrap(),
            (0, 0, 2, 2)
        );
    }

    #[test]
    fn range_bounds_passthrough() {
        assert_eq!(
            CellRange::Bounds(5, 3, 10, 7).resolve().unwrap(),
            (5, 3, 10, 7)
        );
    }

    #[test]
    fn range_from_str() {
        let r: CellRange = "D1:F5".into();
        // D=3, F=5; row 1->0, row 5->4
        assert_eq!(r.resolve().unwrap(), (0, 3, 4, 5));
    }

    #[test]
    fn range_from_tuple() {
        let r: CellRange = (0, 0, 9, 9).into();
        assert_eq!(r.resolve().unwrap(), (0, 0, 9, 9));
    }

    #[test]
    fn range_missing_colon() {
        assert!(CellRange::A1Range("A1B2".into()).resolve().is_err());
    }

    #[test]
    fn range_bad_start() {
        assert!(CellRange::A1Range("0:B2".into()).resolve().is_err());
    }

    #[test]
    fn range_bad_end() {
        assert!(CellRange::A1Range("A1:0".into()).resolve().is_err());
    }
}
