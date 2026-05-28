use std::fmt;
use std::str::FromStr;

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

use super::a1::{ParsePosError, col_to_letter};
use super::sheet_range::SheetRange;
use crate::SheetId;

/// A rectangular range of cells by position.
///
/// **Invariant**: `start_row <= end_row` and `start_col <= end_col` — enforced at construction.
/// Fields are private; use [`RangePos::new`] to construct and accessor methods to read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct RangePos {
    sheet: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

/// Deserialization helper — fields mirror `RangePos` but are public for serde.
#[derive(Deserialize)]
struct RangePosRaw {
    sheet: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
}

impl<'de> Deserialize<'de> for RangePos {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = RangePosRaw::deserialize(deserializer)?;
        Ok(Self::new(
            raw.sheet,
            raw.start_row,
            raw.start_col,
            raw.end_row,
            raw.end_col,
        ))
    }
}

impl RangePos {
    /// Construct a normalized range. Automatically swaps start/end if inverted.
    #[must_use]
    #[inline]
    pub fn new(sheet: SheetId, start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> Self {
        Self {
            sheet,
            start_row: start_row.min(end_row),
            start_col: start_col.min(end_col),
            end_row: start_row.max(end_row),
            end_col: start_col.max(end_col),
        }
    }

    /// Construct a range from bounds that callers have already normalized.
    #[must_use]
    pub(super) fn from_normalized(
        sheet: SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Self {
        Self {
            sheet,
            start_row,
            start_col,
            end_row,
            end_col,
        }
    }

    /// Sheet containing this range.
    #[must_use]
    #[inline]
    pub fn sheet(&self) -> SheetId {
        self.sheet
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

    /// Strip the sheet to get a `SheetRange`.
    #[must_use]
    #[inline]
    pub fn to_sheet_range(&self) -> SheetRange {
        SheetRange::from_normalized(self.start_row, self.start_col, self.end_row, self.end_col)
    }

    /// Check if two ranges overlap (must be on the same sheet).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::{RangePos, SheetId};
    ///
    /// let sheet = SheetId::from_raw(1);
    /// let a = RangePos::new(sheet, 0, 0, 5, 5);
    /// let b = RangePos::new(sheet, 3, 3, 8, 8);
    /// assert!(a.intersects(&b));
    ///
    /// let c = RangePos::new(sheet, 6, 6, 10, 10);
    /// assert!(!a.intersects(&c));
    ///
    /// // Different sheets never intersect.
    /// let other = SheetId::from_raw(2);
    /// let d = RangePos::new(other, 0, 0, 5, 5);
    /// assert!(!a.intersects(&d));
    /// ```
    #[must_use]
    #[inline]
    pub fn intersects(&self, other: &RangePos) -> bool {
        self.sheet == other.sheet
            && self.start_row <= other.end_row
            && self.end_row >= other.start_row
            && self.start_col <= other.end_col
            && self.end_col >= other.start_col
    }

    /// Return the intersection of two ranges, or `None` if they don't overlap or are on different sheets.
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::{RangePos, SheetId};
    ///
    /// let sheet = SheetId::from_raw(1);
    /// let a = RangePos::new(sheet, 0, 0, 5, 5);
    /// let b = RangePos::new(sheet, 3, 3, 8, 8);
    /// let inter = a.intersection(&b).unwrap();
    /// assert_eq!(inter.start_row(), 3);
    /// assert_eq!(inter.end_row(), 5);
    /// assert_eq!(inter.start_col(), 3);
    /// assert_eq!(inter.end_col(), 5);
    ///
    /// // Disjoint ranges return None.
    /// let c = RangePos::new(sheet, 6, 6, 10, 10);
    /// assert!(a.intersection(&c).is_none());
    /// ```
    #[must_use]
    pub fn intersection(&self, other: &RangePos) -> Option<RangePos> {
        if !self.intersects(other) {
            return None;
        }
        // Intersection of two normalized ranges is always normalized.
        Some(RangePos::from_normalized(
            self.sheet,
            self.start_row.max(other.start_row),
            self.start_col.max(other.start_col),
            self.end_row.min(other.end_row),
            self.end_col.min(other.end_col),
        ))
    }

    /// Check if a position on a given sheet falls within this range.
    /// Unlike `contains(row, col)`, this also checks the sheet.
    #[must_use]
    #[inline]
    pub fn contains_pos(&self, sheet: SheetId, row: u32, col: u32) -> bool {
        self.sheet == sheet && self.contains(row, col)
    }

    /// Iterate over all (row, col) positions in this range, row by row.
    pub fn iter_positions(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        (self.start_row..=self.end_row)
            .flat_map(move |r| (self.start_col..=self.end_col).map(move |c| (r, c)))
    }
}

impl fmt::Display for RangePos {
    /// Formats as `A1:C10` (1-based rows, letter columns).
    ///
    /// # Examples
    ///
    /// ```
    /// use cell_types::{RangePos, SheetId};
    ///
    /// let range = RangePos::new(SheetId::from_raw(1), 0, 0, 9, 2);
    /// assert_eq!(range.to_string(), "A1:C10");
    ///
    /// // Single-cell range.
    /// let single = RangePos::new(SheetId::from_raw(1), 4, 1, 4, 1);
    /// assert_eq!(single.to_string(), "B5:B5");
    /// ```
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sc = col_to_letter(self.start_col);
        let sr = self.start_row + 1;
        let ec = col_to_letter(self.end_col);
        let er = self.end_row + 1;
        write!(f, "{sc}{sr}:{ec}{er}")
    }
}

impl FromStr for RangePos {
    type Err = ParsePosError;

    /// Parse from `"A1:C10"` notation (1-based rows). Requires a default sheet.
    ///
    /// Since `RangePos` includes a `SheetId`, parsing uses `SheetId::from_raw(0)`
    /// as a placeholder. Use [`SheetRange::from_str`] when no sheet is needed,
    /// or construct via `SheetRange::from_str(s)?.with_sheet(id)`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let sr: SheetRange = s.parse()?;
        Ok(sr.with_sheet(SheetId::from_raw(0)))
    }
}

impl SheetRange {
    /// Attach a sheet to produce a cross-sheet `RangePos`.
    #[must_use]
    #[inline]
    pub fn with_sheet(self, sheet: SheetId) -> RangePos {
        RangePos::from_normalized(
            sheet,
            self.start_row(),
            self.start_col(),
            self.end_row(),
            self.end_col(),
        )
    }
}

impl From<RangePos> for SheetRange {
    fn from(r: RangePos) -> Self {
        SheetRange::from_normalized(r.start_row, r.start_col, r.end_row, r.end_col)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::position::a1::{MAX_COLS, MAX_ROWS};
    use proptest::prelude::*;

    #[test]
    fn test_range_pos() {
        let range = RangePos::new(SheetId::from_raw(1), 0, 0, 9, 2);
        assert_eq!(range.row_count(), 10);
        assert_eq!(range.col_count(), 3);
        assert_eq!(range.cell_count(), 30);
        assert!(range.contains(5, 1));
        assert!(!range.contains(10, 0));
    }

    #[test]
    fn range_pos_new_normalizes_inverted() {
        // Constructing with inverted coords auto-normalizes
        let range = RangePos::new(SheetId::from_raw(1), 9, 5, 0, 2);
        assert_eq!(range.start_row(), 0);
        assert_eq!(range.start_col(), 2);
        assert_eq!(range.end_row(), 9);
        assert_eq!(range.end_col(), 5);
    }

    #[test]
    fn range_pos_new_already_normal() {
        let range = RangePos::new(SheetId::from_raw(1), 0, 0, 5, 3);
        assert_eq!(range.start_row(), 0);
        assert_eq!(range.start_col(), 0);
        assert_eq!(range.end_row(), 5);
        assert_eq!(range.end_col(), 3);
    }

    #[test]
    fn range_pos_single_cell() {
        let range = RangePos::new(SheetId::from_raw(1), 5, 3, 5, 3);
        assert_eq!(range.row_count(), 1);
        assert_eq!(range.col_count(), 1);
        assert_eq!(range.cell_count(), 1);
        assert!(range.contains(5, 3));
        assert!(!range.contains(5, 4));
    }

    #[test]
    fn range_pos_deserialize_normalizes_inverted_and_keeps_snake_case() {
        let normal = RangePos::new(SheetId::from_raw(1), 0, 0, 5, 3);
        let json = serde_json::to_string(&normal).unwrap();
        assert!(json.contains("start_row"));
        assert!(json.contains("start_col"));
        assert!(json.contains("end_row"));
        assert!(json.contains("end_col"));
        // Manually craft inverted JSON by swapping start/end
        let inverted_json = json
            .replace("\"start_row\":0", "\"start_row\":5")
            .replace("\"end_row\":5", "\"end_row\":0");
        let r: RangePos = serde_json::from_str(&inverted_json).unwrap();
        assert!(r.start_row() <= r.end_row());
    }

    #[test]
    fn sheet_range_from_range_pos() {
        let rp = RangePos::new(SheetId::from_raw(42), 1, 2, 10, 5);
        let sr: SheetRange = rp.into();
        assert_eq!(sr, SheetRange::new(1, 2, 10, 5));
    }

    #[test]
    fn sheet_range_with_sheet() {
        let sr = SheetRange::new(1, 2, 10, 5);
        let sheet = SheetId::from_raw(42);
        let rp = sr.with_sheet(sheet);
        assert_eq!(rp.sheet(), sheet);
        assert_eq!(rp.start_row(), 1);
        assert_eq!(rp.end_col(), 5);
    }

    #[test]
    fn range_pos_to_sheet_range() {
        let rp = RangePos::new(SheetId::from_raw(1), 3, 4, 7, 8);
        let sr = rp.to_sheet_range();
        assert_eq!(sr, SheetRange::new(3, 4, 7, 8));
    }

    #[test]
    fn range_pos_intersects() {
        let sheet = SheetId::from_raw(1);
        let other_sheet = SheetId::from_raw(2);
        let a = RangePos::new(sheet, 0, 0, 5, 5);
        let b = RangePos::new(sheet, 3, 3, 8, 8);
        let c = RangePos::new(other_sheet, 3, 3, 8, 8);
        assert!(a.intersects(&b));
        assert!(!a.intersects(&c)); // different sheet
    }

    #[test]
    fn range_pos_intersection() {
        let sheet = SheetId::from_raw(1);
        let a = RangePos::new(sheet, 0, 0, 5, 5);
        let b = RangePos::new(sheet, 3, 3, 8, 8);
        let inter = a.intersection(&b).unwrap();
        assert_eq!(inter.start_row(), 3);
        assert_eq!(inter.end_row(), 5);
        assert_eq!(inter.start_col(), 3);
        assert_eq!(inter.end_col(), 5);
    }

    #[test]
    fn range_pos_intersection_none_for_different_sheets() {
        let a = RangePos::new(SheetId::from_raw(1), 0, 0, 5, 5);
        let b = RangePos::new(SheetId::from_raw(2), 3, 3, 8, 8);
        assert!(a.intersection(&b).is_none());
    }

    #[test]
    fn range_pos_contains_pos() {
        let sheet = SheetId::from_raw(1);
        let other = SheetId::from_raw(2);
        let r = RangePos::new(sheet, 0, 0, 9, 2);
        assert!(r.contains_pos(sheet, 5, 1));
        assert!(!r.contains_pos(other, 5, 1)); // different sheet
        assert!(!r.contains_pos(sheet, 10, 0)); // out of range
    }

    #[test]
    fn range_pos_iter_positions() {
        let r = RangePos::new(SheetId::from_raw(1), 1, 2, 2, 3);
        let positions: Vec<(u32, u32)> = r.iter_positions().collect();
        assert_eq!(positions, vec![(1, 2), (1, 3), (2, 2), (2, 3)]);
    }

    #[test]
    fn range_pos_max_bounds() {
        let sheet = SheetId::from_raw(1);
        let r = RangePos::new(sheet, 0, 0, u32::MAX, u32::MAX);
        assert_eq!(r.start_row(), 0);
        assert_eq!(r.end_row(), u32::MAX);
        assert!(r.contains(u32::MAX / 2, u32::MAX / 2));
    }

    #[test]
    fn range_pos_from_str_uses_placeholder_sheet() {
        let r: RangePos = "A1:C10".parse().unwrap();
        assert_eq!(r.sheet(), SheetId::from_raw(0));
        assert_eq!(r, RangePos::new(SheetId::from_raw(0), 0, 0, 9, 2));
    }

    #[test]
    fn range_pos_display_roundtrip() {
        let r = RangePos::new(SheetId::from_raw(7), 0, 0, 9, 2);
        assert_eq!(r.to_string(), "A1:C10");
        let parsed: RangePos = r.to_string().parse().unwrap();
        assert_eq!(parsed, RangePos::new(SheetId::from_raw(0), 0, 0, 9, 2));
    }

    proptest! {
        /// RangePos::new always normalizes: start <= end.
        #[test]
        fn range_pos_always_normalized(
            sr in 0u32..MAX_ROWS,
            sc in 0u32..MAX_COLS,
            er in 0u32..MAX_ROWS,
            ec in 0u32..MAX_COLS,
        ) {
            let r = RangePos::new(SheetId::from_raw(1), sr, sc, er, ec);
            prop_assert!(r.start_row() <= r.end_row());
            prop_assert!(r.start_col() <= r.end_col());
        }
    }
}
