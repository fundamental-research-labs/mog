//! Positional address types — used for range iteration and display, NOT for identity.
//!
//! [`CellPos`] and [`RangePos`] use zero-based `(row, col)` indices within a sheet.
//! These are ephemeral coordinates derived from the position index; they change when
//! rows/columns are inserted or deleted. For stable identity, use [`super::CellId`].

use std::fmt;
use std::str::FromStr;

use serde::de::Deserializer;
use serde::{Deserialize, Serialize};

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

/// Error returned when parsing a cell or range reference from a string fails.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsePosError {
    kind: ParsePosErrorKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ParsePosErrorKind {
    /// The input string was empty or missing required components.
    Empty,
    /// The column letters were invalid.
    InvalidColumn,
    /// The row number was invalid or out of range.
    InvalidRow,
    /// Range syntax was malformed (missing `:` separator, etc.).
    InvalidRange,
}

impl fmt::Display for ParsePosError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.kind {
            ParsePosErrorKind::Empty => write!(f, "empty cell reference"),
            ParsePosErrorKind::InvalidColumn => write!(f, "invalid column letters"),
            ParsePosErrorKind::InvalidRow => write!(f, "invalid row number"),
            ParsePosErrorKind::InvalidRange => write!(f, "invalid range syntax"),
        }
    }
}

impl std::error::Error for ParsePosError {}

/// Parse a cell reference like "A1" into (col, row) zero-based indices.
///
/// Returns `Err` if the string is not a valid cell reference.
fn parse_cell_ref(s: &str) -> Result<(u32, u32), ParsePosError> {
    if s.is_empty() {
        return Err(ParsePosError {
            kind: ParsePosErrorKind::Empty,
        });
    }
    // Find the boundary between letters and digits
    let digit_start = s.find(|c: char| c.is_ascii_digit()).ok_or(ParsePosError {
        kind: ParsePosErrorKind::InvalidRow,
    })?;
    if digit_start == 0 {
        return Err(ParsePosError {
            kind: ParsePosErrorKind::InvalidColumn,
        });
    }
    let col_part = &s[..digit_start];
    let row_part = &s[digit_start..];
    let col = letter_to_col(col_part).ok_or(ParsePosError {
        kind: ParsePosErrorKind::InvalidColumn,
    })?;
    let row_1based: u32 = row_part.parse().map_err(|_| ParsePosError {
        kind: ParsePosErrorKind::InvalidRow,
    })?;
    if row_1based == 0 {
        return Err(ParsePosError {
            kind: ParsePosErrorKind::InvalidRow,
        });
    }
    Ok((col, row_1based - 1))
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
        // Safety: RangePos is already normalized, so we use new_unchecked.
        SheetRange {
            start_row: self.start_row,
            start_col: self.start_col,
            end_row: self.end_row,
            end_col: self.end_col,
        }
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
        Some(RangePos {
            sheet: self.sheet,
            start_row: self.start_row.max(other.start_row),
            start_col: self.start_col.max(other.start_col),
            end_row: self.end_row.min(other.end_row),
            end_col: self.end_col.min(other.end_col),
        })
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

/// A rectangular range within a sheet — no [`SheetId`], just row/col bounds.
///
/// **Invariant**: `start_row <= end_row` and `start_col <= end_col` — enforced at construction.
/// Fields are private; use [`SheetRange::new`] to construct and accessor methods to read.
///
/// Naming follows the existing cell-types convention:
/// - [`SheetPos`] = position without [`SheetId`] → `SheetRange` = range without [`SheetId`]
/// - [`CellPos`] = position with [`SheetId`] → [`RangePos`] = range with [`SheetId`]
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
        Some(SheetRange {
            start_row: self.start_row.max(other.start_row),
            start_col: self.start_col.max(other.start_col),
            end_row: self.end_row.min(other.end_row),
            end_col: self.end_col.min(other.end_col),
        })
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
        SheetRange {
            start_row: self.start_row.min(other.start_row),
            start_col: self.start_col.min(other.start_col),
            end_row: self.end_row.max(other.end_row),
            end_col: self.end_col.max(other.end_col),
        }
    }

    /// Attach a sheet to produce a cross-sheet `RangePos`.
    #[must_use]
    #[inline]
    pub fn with_sheet(self, sheet: SheetId) -> RangePos {
        // SheetRange is already normalized, so construct directly.
        RangePos {
            sheet,
            start_row: self.start_row,
            start_col: self.start_col,
            end_row: self.end_row,
            end_col: self.end_col,
        }
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
        let colon = s.find(':').ok_or(ParsePosError {
            kind: ParsePosErrorKind::InvalidRange,
        })?;
        let (start_str, end_str) = (&s[..colon], &s[colon + 1..]);
        if start_str.is_empty() || end_str.is_empty() {
            return Err(ParsePosError {
                kind: ParsePosErrorKind::InvalidRange,
            });
        }
        let (sc, sr) = parse_cell_ref(start_str)?;
        let (ec, er) = parse_cell_ref(end_str)?;
        Ok(Self::new(sr, sc, er, ec))
    }
}

impl From<RangePos> for SheetRange {
    fn from(r: RangePos) -> Self {
        // RangePos is already normalized, so construct directly.
        SheetRange {
            start_row: r.start_row,
            start_col: r.start_col,
            end_row: r.end_row,
            end_col: r.end_col,
        }
    }
}

/// Excel column limits.
pub const MAX_ROWS: u32 = 1_048_576;
/// Excel column limits.
pub const MAX_COLS: u32 = 16_384;

/// Convert a 0-based column index to Excel column letter(s).
/// 0 → "A", 25 → "Z", 26 → "AA", etc.
///
/// Uses a stack-allocated buffer internally (column names are at most 3 chars
/// for valid Excel columns, or up to 7 chars for `u32::MAX`).
///
/// # Examples
///
/// ```
/// use cell_types::col_to_letter;
///
/// assert_eq!(col_to_letter(0), "A");
/// assert_eq!(col_to_letter(25), "Z");
/// assert_eq!(col_to_letter(26), "AA");
/// ```
#[must_use]
pub fn col_to_letter(col: u32) -> String {
    let mut s = String::with_capacity(3);
    col_to_letter_buf(col, &mut s);
    s
}

/// Write a 0-based column index as Excel column letter(s) into `buf`.
///
/// This avoids allocation when the caller already has a `String` to append to.
///
/// # Examples
///
/// ```
/// use cell_types::col_to_letter_buf;
///
/// let mut s = String::new();
/// col_to_letter_buf(0, &mut s);
/// assert_eq!(s, "A");
/// ```
///
/// # Panics
/// This function will not panic under normal usage. The internal `expect` call
/// guards a UTF-8 conversion that cannot fail because all generated bytes are
/// ASCII uppercase `A`-`Z`.
pub fn col_to_letter_buf(col: u32, buf: &mut String) {
    // Excel columns are at most 3 letters (XFD = 16383).
    // For arbitrary u32, 7 chars suffice (26^7 > u32::MAX).
    let mut tmp = [0u8; 7];
    let mut pos = tmp.len();
    let mut c = col;
    loop {
        pos -= 1;
        tmp[pos] = b'A' + (c % 26) as u8;
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }
    // All bytes in tmp[pos..] are ASCII uppercase A-Z, so from_utf8 cannot fail.
    let s = std::str::from_utf8(&tmp[pos..]).expect("col_to_letter produced non-UTF8");
    buf.push_str(s);
}

/// Convert Excel column letter(s) to a 0-based column index.
/// "A" → 0, "Z" → 25, "AA" → 26, etc.
///
/// # Examples
///
/// ```
/// use cell_types::letter_to_col;
///
/// assert_eq!(letter_to_col("A"), Some(0));
/// assert_eq!(letter_to_col("AA"), Some(26));
/// assert_eq!(letter_to_col(""), None);
/// assert_eq!(letter_to_col("1"), None);
/// ```
#[must_use]
pub fn letter_to_col(letters: &str) -> Option<u32> {
    if letters.is_empty() {
        return None;
    }
    let mut result: u32 = 0;
    for ch in letters.chars() {
        if !ch.is_ascii_alphabetic() {
            return None;
        }
        result = result
            .checked_mul(26)?
            .checked_add(ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1)?;
    }
    result.checked_sub(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_col_to_letter() {
        assert_eq!(col_to_letter(0), "A");
        assert_eq!(col_to_letter(25), "Z");
        assert_eq!(col_to_letter(26), "AA");
        assert_eq!(col_to_letter(701), "ZZ");
        assert_eq!(col_to_letter(702), "AAA");
    }

    #[test]
    fn test_letter_to_col() {
        assert_eq!(letter_to_col("A"), Some(0));
        assert_eq!(letter_to_col("Z"), Some(25));
        assert_eq!(letter_to_col("AA"), Some(26));
        assert_eq!(letter_to_col("ZZ"), Some(701));
        assert_eq!(letter_to_col("XFD"), Some(16383));
    }

    #[test]
    fn test_roundtrip() {
        for i in 0..=16383 {
            assert_eq!(letter_to_col(&col_to_letter(i)), Some(i));
        }
    }

    #[test]
    fn test_range_pos() {
        let range = RangePos::new(SheetId::from_raw(1), 0, 0, 9, 2);
        assert_eq!(range.row_count(), 10);
        assert_eq!(range.col_count(), 3);
        assert_eq!(range.cell_count(), 30);
        assert!(range.contains(5, 1));
        assert!(!range.contains(10, 0));
    }

    // === 5h: edge case tests ===

    #[test]
    fn col_to_letter_zero() {
        assert_eq!(col_to_letter(0), "A");
    }

    #[test]
    fn col_to_letter_max_cols_minus_1() {
        assert_eq!(col_to_letter(MAX_COLS - 1), "XFD");
    }

    #[test]
    fn letter_to_col_empty() {
        assert_eq!(letter_to_col(""), None);
    }

    #[test]
    fn letter_to_col_digits_rejected() {
        assert_eq!(letter_to_col("123"), None);
    }

    #[test]
    fn letter_to_col_mixed_rejected() {
        assert_eq!(letter_to_col("A1"), None);
    }

    #[test]
    fn letter_to_col_lowercase() {
        assert_eq!(letter_to_col("a"), Some(0));
        assert_eq!(letter_to_col("z"), Some(25));
        assert_eq!(letter_to_col("aa"), Some(26));
        assert_eq!(letter_to_col("xfd"), Some(16383));
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
    fn range_pos_single_cell() {
        let range = RangePos::new(SheetId::from_raw(1), 5, 3, 5, 3);
        assert_eq!(range.row_count(), 1);
        assert_eq!(range.col_count(), 1);
        assert_eq!(range.cell_count(), 1);
        assert!(range.contains(5, 3));
        assert!(!range.contains(5, 4));
    }

    #[test]
    fn max_constants() {
        assert_eq!(MAX_ROWS, 1_048_576);
        assert_eq!(MAX_COLS, 16_384);
    }

    // === SheetPos tests ===

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

    // === SheetRange tests ===

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
    fn range_pos_deserialize_normalizes_inverted() {
        let normal = RangePos::new(SheetId::from_raw(1), 0, 0, 5, 3);
        let json = serde_json::to_string(&normal).unwrap();
        // Manually craft inverted JSON by swapping start/end
        let inverted_json = json
            .replace("\"start_row\":0", "\"start_row\":5")
            .replace("\"end_row\":5", "\"end_row\":0");
        let r: RangePos = serde_json::from_str(&inverted_json).unwrap();
        assert!(r.start_row() <= r.end_row());
    }

    #[test]
    fn sheet_range_ord() {
        // Row-major ordering from derive
        let a = SheetRange::new(0, 0, 5, 5);
        let b = SheetRange::new(1, 0, 5, 5);
        assert!(a < b);
    }

    // === SheetRange <-> RangePos conversion tests ===

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

    // === RangePos new method tests ===

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

    // === Adversarial / boundary tests ===

    #[test]
    fn letter_to_col_overflow_returns_none() {
        // Very long column string that would overflow u32
        assert_eq!(letter_to_col("ZZZZZZZZZ"), None);
    }

    #[test]
    fn col_to_letter_large_value() {
        // Beyond Excel max but still valid conversion
        let s = col_to_letter(u32::MAX);
        assert!(!s.is_empty());
        // Roundtrip may not work due to overflow in letter_to_col
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
    fn sheet_range_zero_size_is_one_cell() {
        let r = SheetRange::new(5, 5, 5, 5);
        assert_eq!(r.cell_count(), 1);
        assert_eq!(r.row_count(), 1);
        assert_eq!(r.col_count(), 1);
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

    #[test]
    fn parse_sheet_pos_invalid_inputs() {
        assert!("".parse::<SheetPos>().is_err());
        assert!("123".parse::<SheetPos>().is_err());
        assert!("A0".parse::<SheetPos>().is_err()); // row 0 invalid
        assert!("A".parse::<SheetPos>().is_err()); // no row
    }

    // === Property-based tests ===

    mod proptests {
        use super::*;
        use proptest::prelude::*;

        proptest! {
            /// col_to_letter → letter_to_col roundtrip for all valid Excel columns.
            #[test]
            fn col_letter_roundtrip(col in 0u32..MAX_COLS) {
                let letters = col_to_letter(col);
                prop_assert_eq!(letter_to_col(&letters), Some(col));
            }

            /// letter_to_col → col_to_letter roundtrip for valid inputs.
            #[test]
            fn letter_col_roundtrip(col in 0u32..MAX_COLS) {
                let letters = col_to_letter(col);
                let back = letter_to_col(&letters).unwrap();
                prop_assert_eq!(col_to_letter(back), letters);
            }

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
}
