use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

use super::a1::{ParsePosError, col_to_letter, parse_cell_ref};
use crate::SheetId;

/// A cell position (ephemeral — derived from position index, not stable across structural changes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CellPos {
    /// Sheet containing this cell.
    sheet: SheetId,
    /// Zero-based row index.
    row: u32,
    /// Zero-based column index.
    col: u32,
}

impl CellPos {
    /// Convenience constructor.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::{CellPos, SheetId};
    ///
    /// let pos = CellPos::new(SheetId::from_raw(1), 5, 3);
    /// assert_eq!(pos.row(), 5);
    /// assert_eq!(pos.col(), 3);
    /// ```
    #[must_use]
    #[inline]
    pub const fn new(sheet: SheetId, row: u32, col: u32) -> Self {
        Self { sheet, row, col }
    }

    /// Sheet containing this cell.
    #[must_use]
    #[inline]
    pub const fn sheet(&self) -> SheetId {
        self.sheet
    }

    /// Zero-based row index.
    #[must_use]
    #[inline]
    pub const fn row(&self) -> u32 {
        self.row
    }

    /// Zero-based column index.
    #[must_use]
    #[inline]
    pub const fn col(&self) -> u32 {
        self.col
    }
}

/// A position within a sheet — (row, col) without sheet identity.
///
/// Unlike [`CellPos`] which includes a [`SheetId`], `SheetPos` represents
/// a position relative to a specific sheet. Used internally by `SheetMirror`
/// for the bidirectional position↔identity index.
///
/// Field ordering gives row-major `Ord`: row 0 col 1 < row 1 col 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct SheetPos {
    /// Zero-based row index.
    row: u32,
    /// Zero-based column index.
    col: u32,
}

impl SheetPos {
    /// Convenience constructor.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetPos;
    ///
    /// let pos = SheetPos::new(10, 20);
    /// assert_eq!(pos.row(), 10);
    /// assert_eq!(pos.col(), 20);
    /// ```
    #[must_use]
    #[inline]
    pub const fn new(row: u32, col: u32) -> Self {
        Self { row, col }
    }

    /// Zero-based row index.
    #[must_use]
    #[inline]
    pub const fn row(&self) -> u32 {
        self.row
    }

    /// Zero-based column index.
    #[must_use]
    #[inline]
    pub const fn col(&self) -> u32 {
        self.col
    }
}

impl fmt::Display for CellPos {
    /// Formats as `A1` (1-based row, letter column).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::{CellPos, SheetId};
    ///
    /// let pos = CellPos::new(SheetId::from_raw(1), 0, 0);
    /// assert_eq!(pos.to_string(), "A1");
    ///
    /// let pos = CellPos::new(SheetId::from_raw(1), 9, 2);
    /// assert_eq!(pos.to_string(), "C10");
    /// ```
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let col = col_to_letter(self.col);
        let row = self.row + 1;
        write!(f, "{col}{row}")
    }
}

impl fmt::Display for SheetPos {
    /// Formats as `A1` (1-based row, letter column).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetPos;
    ///
    /// let pos = SheetPos::new(0, 0);
    /// assert_eq!(pos.to_string(), "A1");
    ///
    /// let pos = SheetPos::new(9, 2);
    /// assert_eq!(pos.to_string(), "C10");
    /// ```
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let col = col_to_letter(self.col);
        let row = self.row + 1;
        write!(f, "{col}{row}")
    }
}

impl FromStr for SheetPos {
    type Err = ParsePosError;

    /// Parse from `"A1"` notation (1-based row).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetPos;
    ///
    /// let pos: SheetPos = "C10".parse().unwrap();
    /// assert_eq!(pos, SheetPos::new(9, 2));
    ///
    /// assert!("".parse::<SheetPos>().is_err());
    /// assert!("123".parse::<SheetPos>().is_err());
    /// ```
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (col, row) = parse_cell_ref(s)?;
        Ok(Self::new(row, col))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::a1::{MAX_COLS, MAX_ROWS};
    use proptest::prelude::*;

    #[test]
    fn cell_pos_new() {
        let sheet = SheetId::from_raw(42);
        let pos = CellPos::new(sheet, 10, 20);
        assert_eq!(pos.sheet(), sheet);
        assert_eq!(pos.row(), 10);
        assert_eq!(pos.col(), 20);
    }

    #[test]
    fn cell_pos_serde_roundtrip() {
        let pos = CellPos::new(SheetId::from_raw(1), 5, 3);
        let json = serde_json::to_string(&pos).unwrap();
        let pos2: CellPos = serde_json::from_str(&json).unwrap();
        assert_eq!(pos, pos2);
    }

    #[test]
    fn cell_pos_display() {
        assert_eq!(CellPos::new(SheetId::from_raw(1), 0, 0).to_string(), "A1");
        assert_eq!(CellPos::new(SheetId::from_raw(1), 9, 2).to_string(), "C10");
    }

    #[test]
    fn sheet_pos_new() {
        let pos = SheetPos::new(10, 20);
        assert_eq!(pos.row(), 10);
        assert_eq!(pos.col(), 20);
    }

    #[test]
    fn sheet_pos_eq_and_hash() {
        use std::collections::HashSet;
        let a = SheetPos::new(3, 7);
        let b = SheetPos::new(3, 7);
        let c = SheetPos::new(7, 3);
        assert_eq!(a, b);
        assert_ne!(a, c);
        let mut set = HashSet::new();
        set.insert(a);
        assert!(set.contains(&b));
        assert!(!set.contains(&c));
    }

    #[test]
    fn sheet_pos_ord_row_major() {
        // Row-major ordering: row compared first, then col
        assert!(SheetPos::new(0, 1) < SheetPos::new(1, 0));
        assert!(SheetPos::new(0, 0) < SheetPos::new(0, 1));
        assert!(SheetPos::new(2, 5) > SheetPos::new(2, 4));
        assert!(SheetPos::new(1, 0) > SheetPos::new(0, 99));
    }

    #[test]
    fn sheet_pos_serde_roundtrip() {
        let pos = SheetPos::new(5, 3);
        let json = serde_json::to_string(&pos).unwrap();
        let pos2: SheetPos = serde_json::from_str(&json).unwrap();
        assert_eq!(pos, pos2);
    }

    #[test]
    fn sheet_pos_copy() {
        let a = SheetPos::new(1, 2);
        let b = a; // Copy
        assert_eq!(a, b); // a still usable
    }

    #[test]
    fn display_fromstr_roundtrip_sheet_pos() {
        let pos = SheetPos::new(0, 0);
        let s = pos.to_string();
        assert_eq!(s, "A1");
        let parsed: SheetPos = s.parse().unwrap();
        assert_eq!(pos, parsed);
    }

    #[test]
    fn parse_sheet_pos_invalid_inputs() {
        assert!("".parse::<SheetPos>().is_err());
        assert!("123".parse::<SheetPos>().is_err());
        assert!("A0".parse::<SheetPos>().is_err()); // row 0 invalid
        assert!("A".parse::<SheetPos>().is_err()); // no row
    }

    proptest! {
        /// SheetPos Display/FromStr roundtrip.
        #[test]
        fn sheet_pos_display_fromstr_roundtrip(
            row in 0u32..MAX_ROWS,
            col in 0u32..MAX_COLS,
        ) {
            let pos = SheetPos::new(row, col);
            let s = pos.to_string();
            let parsed: SheetPos = s.parse().unwrap();
            prop_assert_eq!(pos, parsed);
        }
    }
}
