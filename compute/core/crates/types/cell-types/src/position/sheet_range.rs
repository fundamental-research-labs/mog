use std::fmt;
use std::str::FromStr;

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

use super::a1::{ParsePosError, col_to_letter, parse_cell_ref};

/// A rectangular range within a sheet — no [`crate::SheetId`], just row/col bounds.
///
/// **Invariant**: `start_row <= end_row` and `start_col <= end_col` — enforced at construction.
/// Fields are private; use [`SheetRange::new`] to construct and accessor methods to read.
///
/// Naming follows the existing cell-types convention:
/// - [`super::SheetPos`] = position without [`crate::SheetId`] → `SheetRange` = range without [`crate::SheetId`]
/// - [`super::CellPos`] = position with [`crate::SheetId`] → [`super::RangePos`] = range with [`crate::SheetId`]
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetRange {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

/// Deserialization helper — fields mirror `SheetRange` but are public for serde.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SheetRangeRaw {
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl<'de> Deserialize<'de> for SheetRange {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = SheetRangeRaw::deserialize(deserializer)?;
        Ok(Self::new(
            raw.start_row,
            raw.start_col,
            raw.end_row,
            raw.end_col,
        ))
    }
}

impl SheetRange {
    /// Create a normalized range. Automatically swaps start/end if inverted.
    #[must_use]
    #[inline]
    pub fn new(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> Self {
        Self {
            start_row: start_row.min(end_row),
            start_col: start_col.min(end_col),
            end_row: start_row.max(end_row),
            end_col: start_col.max(end_col),
        }
    }

    /// Construct a range from bounds that callers have already normalized.
    #[must_use]
    pub(super) fn from_normalized(
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Self {
        Self {
            start_row,
            start_col,
            end_row,
            end_col,
        }
    }

    /// Create a single-cell range.
    #[must_use]
    #[inline]
    pub fn single(row: u32, col: u32) -> Self {
        Self {
            start_row: row,
            start_col: col,
            end_row: row,
            end_col: col,
        }
    }

    /// Zero-based starting row index (inclusive). Guaranteed `<= end_row`.
    #[must_use]
    #[inline]
    pub fn start_row(&self) -> u32 {
        self.start_row
    }

    /// Zero-based starting column index (inclusive). Guaranteed `<= end_col`.
    #[must_use]
    #[inline]
    pub fn start_col(&self) -> u32 {
        self.start_col
    }

    /// Zero-based ending row index (inclusive). Guaranteed `>= start_row`.
    #[must_use]
    #[inline]
    pub fn end_row(&self) -> u32 {
        self.end_row
    }

    /// Zero-based ending column index (inclusive). Guaranteed `>= start_col`.
    #[must_use]
    #[inline]
    pub fn end_col(&self) -> u32 {
        self.end_col
    }

    /// Number of rows in this range.
    #[must_use]
    #[inline]
    pub fn row_count(&self) -> u32 {
        self.end_row - self.start_row + 1
    }

    /// Number of columns in this range.
    #[must_use]
    #[inline]
    pub fn col_count(&self) -> u32 {
        self.end_col - self.start_col + 1
    }

    /// Total number of cells in this range.
    #[must_use]
    #[inline]
    pub fn cell_count(&self) -> u64 {
        u64::from(self.row_count()) * u64::from(self.col_count())
    }

    /// Check if a position falls within this range.
    #[must_use]
    #[inline]
    pub fn contains(&self, row: u32, col: u32) -> bool {
        row >= self.start_row && row <= self.end_row && col >= self.start_col && col <= self.end_col
    }

    /// Check if another range is fully contained within this range.
    #[must_use]
    #[inline]
    pub fn contains_range(&self, other: &SheetRange) -> bool {
        other.start_row >= self.start_row
            && other.end_row <= self.end_row
            && other.start_col >= self.start_col
            && other.end_col <= self.end_col
    }

    /// Check if two ranges overlap.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetRange;
    ///
    /// let a = SheetRange::new(0, 0, 5, 5);
    /// let b = SheetRange::new(3, 3, 8, 8);
    /// assert!(a.intersects(&b));
    ///
    /// let c = SheetRange::new(6, 6, 10, 10);
    /// assert!(!a.intersects(&c));
    /// ```
    #[must_use]
    #[inline]
    pub fn intersects(&self, other: &SheetRange) -> bool {
        self.start_row <= other.end_row
            && self.end_row >= other.start_row
            && self.start_col <= other.end_col
            && self.end_col >= other.start_col
    }

    /// Return the intersection of two ranges, or `None` if they don't overlap.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetRange;
    ///
    /// let a = SheetRange::new(0, 0, 5, 5);
    /// let b = SheetRange::new(3, 3, 8, 8);
    /// let inter = a.intersection(&b).unwrap();
    /// assert_eq!(inter, SheetRange::new(3, 3, 5, 5));
    ///
    /// let c = SheetRange::new(6, 6, 10, 10);
    /// assert!(a.intersection(&c).is_none());
    /// ```
    #[must_use]
    pub fn intersection(&self, other: &SheetRange) -> Option<SheetRange> {
        if !self.intersects(other) {
            return None;
        }
        // Intersection of two normalized ranges is always normalized.
        Some(SheetRange::from_normalized(
            self.start_row.max(other.start_row),
            self.start_col.max(other.start_col),
            self.end_row.min(other.end_row),
            self.end_col.min(other.end_col),
        ))
    }

    /// Return the bounding box that contains both ranges.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetRange;
    ///
    /// let a = SheetRange::new(2, 3, 5, 6);
    /// let b = SheetRange::new(0, 1, 4, 8);
    /// let u = a.union_bounding(&b);
    /// assert_eq!(u, SheetRange::new(0, 1, 5, 8));
    /// ```
    #[must_use]
    pub fn union_bounding(&self, other: &SheetRange) -> SheetRange {
        // Union of two normalized ranges is always normalized.
        SheetRange::from_normalized(
            self.start_row.min(other.start_row),
            self.start_col.min(other.start_col),
            self.end_row.max(other.end_row),
            self.end_col.max(other.end_col),
        )
    }

    /// Iterate over all (row, col) positions in this range, row by row.
    pub fn iter_positions(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        (self.start_row..=self.end_row)
            .flat_map(move |r| (self.start_col..=self.end_col).map(move |c| (r, c)))
    }
}

impl fmt::Display for SheetRange {
    /// Formats as `A1:C10` (1-based rows, letter columns).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetRange;
    ///
    /// let range = SheetRange::new(0, 0, 9, 2);
    /// assert_eq!(range.to_string(), "A1:C10");
    /// ```
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sc = col_to_letter(self.start_col);
        let sr = self.start_row + 1;
        let ec = col_to_letter(self.end_col);
        let er = self.end_row + 1;
        write!(f, "{sc}{sr}:{ec}{er}")
    }
}

impl FromStr for SheetRange {
    type Err = ParsePosError;

    /// Parse from `"A1:C10"` notation (1-based rows).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::SheetRange;
    ///
    /// let range: SheetRange = "A1:C10".parse().unwrap();
    /// assert_eq!(range, SheetRange::new(0, 0, 9, 2));
    ///
    /// assert!("A1".parse::<SheetRange>().is_err()); // missing ':'
    /// assert!("A1:".parse::<SheetRange>().is_err());
    /// ```
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let colon = s.find(':').ok_or_else(ParsePosError::invalid_range)?;
        let (start_str, end_str) = (&s[..colon], &s[colon + 1..]);
        if start_str.is_empty() || end_str.is_empty() {
            return Err(ParsePosError::invalid_range());
        }
        let (sc, sr) = parse_cell_ref(start_str)?;
        let (ec, er) = parse_cell_ref(end_str)?;
        Ok(Self::new(sr, sc, er, ec))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::a1::{MAX_COLS, MAX_ROWS};
    use proptest::prelude::*;

    #[test]
    fn sheet_range_new() {
        let r = SheetRange::new(1, 2, 10, 5);
        assert_eq!(r.start_row(), 1);
        assert_eq!(r.start_col(), 2);
        assert_eq!(r.end_row(), 10);
        assert_eq!(r.end_col(), 5);
    }

    #[test]
    fn sheet_range_single() {
        let r = SheetRange::single(3, 7);
        assert_eq!(r.row_count(), 1);
        assert_eq!(r.col_count(), 1);
        assert_eq!(r.cell_count(), 1);
        assert!(r.contains(3, 7));
        assert!(!r.contains(3, 8));
    }

    #[test]
    fn sheet_range_dimensions() {
        let r = SheetRange::new(0, 0, 9, 2);
        assert_eq!(r.row_count(), 10);
        assert_eq!(r.col_count(), 3);
        assert_eq!(r.cell_count(), 30);
    }

    #[test]
    fn sheet_range_contains() {
        let r = SheetRange::new(2, 3, 8, 6);
        assert!(r.contains(2, 3));
        assert!(r.contains(8, 6));
        assert!(r.contains(5, 4));
        assert!(!r.contains(1, 3));
        assert!(!r.contains(9, 3));
        assert!(!r.contains(5, 2));
        assert!(!r.contains(5, 7));
    }

    #[test]
    fn sheet_range_contains_range() {
        let outer = SheetRange::new(0, 0, 10, 10);
        let inner = SheetRange::new(2, 3, 8, 7);
        assert!(outer.contains_range(&inner));
        assert!(!inner.contains_range(&outer));

        let partial = SheetRange::new(5, 5, 15, 15);
        assert!(!outer.contains_range(&partial));
    }

    #[test]
    fn sheet_range_new_normalizes_inverted() {
        // SheetRange::new auto-normalizes
        let range = SheetRange::new(9, 5, 0, 2);
        assert_eq!(range.start_row(), 0);
        assert_eq!(range.start_col(), 2);
        assert_eq!(range.end_row(), 9);
        assert_eq!(range.end_col(), 5);
    }

    #[test]
    fn sheet_range_intersects() {
        let a = SheetRange::new(0, 0, 5, 5);
        let b = SheetRange::new(3, 3, 8, 8);
        let c = SheetRange::new(6, 6, 10, 10);
        assert!(a.intersects(&b));
        assert!(b.intersects(&a));
        assert!(!a.intersects(&c));
        assert!(b.intersects(&c));
    }

    #[test]
    fn sheet_range_intersection() {
        let a = SheetRange::new(0, 0, 5, 5);
        let b = SheetRange::new(3, 3, 8, 8);
        let inter = a.intersection(&b).unwrap();
        assert_eq!(inter, SheetRange::new(3, 3, 5, 5));

        let c = SheetRange::new(6, 6, 10, 10);
        assert!(a.intersection(&c).is_none());
    }

    #[test]
    fn sheet_range_union_bounding() {
        let a = SheetRange::new(2, 3, 5, 6);
        let b = SheetRange::new(0, 1, 4, 8);
        let u = a.union_bounding(&b);
        assert_eq!(u, SheetRange::new(0, 1, 5, 8));
    }

    #[test]
    fn sheet_range_iter_positions() {
        let r = SheetRange::new(1, 2, 2, 3);
        let positions: Vec<(u32, u32)> = r.iter_positions().collect();
        assert_eq!(positions, vec![(1, 2), (1, 3), (2, 2), (2, 3)]);
    }

    #[test]
    fn sheet_range_serde_camel_case() {
        let r = SheetRange::new(1, 2, 10, 5);
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains("startRow"));
        assert!(json.contains("startCol"));
        assert!(json.contains("endRow"));
        assert!(json.contains("endCol"));
        let r2: SheetRange = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn sheet_range_deserialize_normalizes_inverted() {
        let json = r#"{"startRow":9,"startCol":5,"endRow":0,"endCol":2}"#;
        let r: SheetRange = serde_json::from_str(json).unwrap();
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.start_col(), 2);
        assert_eq!(r.end_row(), 9);
        assert_eq!(r.end_col(), 5);
    }

    #[test]
    fn sheet_range_ord() {
        // Row-major ordering from derive
        let a = SheetRange::new(0, 0, 5, 5);
        let b = SheetRange::new(1, 0, 5, 5);
        assert!(a < b);
    }

    #[test]
    fn sheet_range_zero_size_is_one_cell() {
        let r = SheetRange::new(5, 5, 5, 5);
        assert_eq!(r.cell_count(), 1);
        assert_eq!(r.row_count(), 1);
        assert_eq!(r.col_count(), 1);
    }

    #[test]
    fn display_fromstr_roundtrip_sheet_range() {
        let r = SheetRange::new(0, 0, 9, 2);
        let s = r.to_string();
        assert_eq!(s, "A1:C10");
        let parsed: SheetRange = s.parse().unwrap();
        assert_eq!(r, parsed);
    }

    #[test]
    fn parse_sheet_range_invalid_inputs() {
        assert!("".parse::<SheetRange>().is_err());
        assert!("A1".parse::<SheetRange>().is_err());
        assert!(":B2".parse::<SheetRange>().is_err());
        assert!("A1:".parse::<SheetRange>().is_err());
        assert!("123:456".parse::<SheetRange>().is_err());
        assert!("A0:B1".parse::<SheetRange>().is_err()); // row 0 invalid in A1 notation
    }

    proptest! {
        /// SheetRange::new always normalizes: start <= end.
        #[test]
        fn sheet_range_always_normalized(
            sr in 0u32..MAX_ROWS,
            sc in 0u32..MAX_COLS,
            er in 0u32..MAX_ROWS,
            ec in 0u32..MAX_COLS,
        ) {
            let r = SheetRange::new(sr, sc, er, ec);
            prop_assert!(r.start_row() <= r.end_row());
            prop_assert!(r.start_col() <= r.end_col());
        }

        /// intersection is commutative.
        #[test]
        fn sheet_range_intersection_commutative(
            ar in 0u32..1000, ac in 0u32..1000, br in 0u32..1000, bc in 0u32..1000,
            cr in 0u32..1000, cc in 0u32..1000, dr in 0u32..1000, dc in 0u32..1000,
        ) {
            let a = SheetRange::new(ar, ac, br, bc);
            let b = SheetRange::new(cr, cc, dr, dc);
            prop_assert_eq!(a.intersection(&b), b.intersection(&a));
        }

        /// intersects is commutative.
        #[test]
        fn sheet_range_intersects_commutative(
            ar in 0u32..1000, ac in 0u32..1000, br in 0u32..1000, bc in 0u32..1000,
            cr in 0u32..1000, cc in 0u32..1000, dr in 0u32..1000, dc in 0u32..1000,
        ) {
            let a = SheetRange::new(ar, ac, br, bc);
            let b = SheetRange::new(cr, cc, dr, dc);
            prop_assert_eq!(a.intersects(&b), b.intersects(&a));
        }

        /// union_bounding is commutative.
        #[test]
        fn sheet_range_union_commutative(
            ar in 0u32..1000, ac in 0u32..1000, br in 0u32..1000, bc in 0u32..1000,
            cr in 0u32..1000, cc in 0u32..1000, dr in 0u32..1000, dc in 0u32..1000,
        ) {
            let a = SheetRange::new(ar, ac, br, bc);
            let b = SheetRange::new(cr, cc, dr, dc);
            prop_assert_eq!(a.union_bounding(&b), b.union_bounding(&a));
        }

        /// cell_count matches actual iteration count.
        #[test]
        fn sheet_range_cell_count_matches_iter(
            sr in 0u32..100, sc in 0u32..100,
            er in 0u32..100, ec in 0u32..100,
        ) {
            let r = SheetRange::new(sr, sc, er, ec);
            let iter_count = r.iter_positions().count() as u64;
            prop_assert_eq!(r.cell_count(), iter_count);
        }

        /// SheetRange Display/FromStr roundtrip.
        #[test]
        fn sheet_range_display_fromstr_roundtrip(
            sr in 0u32..1000, sc in 0u32..1000,
            er in 0u32..1000, ec in 0u32..1000,
        ) {
            let r = SheetRange::new(sr, sc, er, ec);
            let s = r.to_string();
            let parsed: SheetRange = s.parse().unwrap();
            prop_assert_eq!(r, parsed);
        }

        /// contains is consistent: every iterated position is contained.
        #[test]
        fn sheet_range_contains_all_iterated(
            sr in 0u32..50, sc in 0u32..50,
            er in 0u32..50, ec in 0u32..50,
        ) {
            let r = SheetRange::new(sr, sc, er, ec);
            for (row, col) in r.iter_positions() {
                prop_assert!(r.contains(row, col));
            }
        }
    }
}
