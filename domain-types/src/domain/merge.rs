//! Canonical merge-cell domain types.
//!
//! Every merge representation is a view of the same rectangle at a different
//! lifecycle stage:
//!
//! - `MergeRegion`           — position-keyed (XLSX import, parse output)
//! - `IdentityMergedRegion`  — CellId-keyed (CRDT storage, stable under edits)
//! - `ResolvedMergedRegion`  — resolved (identity + positions, query result)
//! - `CellMergeInfo`         — per-cell wrapper (query result with is_origin flag)

use serde::{Deserialize, Serialize};

// ── Position-based merge (XLSX import, hydration input) ─────────────────────

/// A merged cell region defined by coordinates.
/// This is the parse-output representation — no CellId references.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeRegion {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
}

impl MergeRegion {
    /// Number of rows spanned.
    pub fn row_span(&self) -> u32 {
        self.end_row - self.start_row + 1
    }

    /// Number of columns spanned.
    pub fn col_span(&self) -> u32 {
        self.end_col - self.start_col + 1
    }

    /// Whether the given position falls within this region (inclusive).
    pub fn contains(&self, row: u32, col: u32) -> bool {
        row >= self.start_row && row <= self.end_row && col >= self.start_col && col <= self.end_col
    }

    /// Whether two regions overlap (share at least one cell).
    pub fn overlaps(&self, other: &MergeRegion) -> bool {
        self.start_row <= other.end_row
            && self.end_row >= other.start_row
            && self.start_col <= other.end_col
            && self.end_col >= other.start_col
    }
}

// ── Identity-based merge (CRDT storage, stable under structure changes) ─────

/// Identity-based merged region using CellId hex references.
/// Stable under row/col insert/delete because CellIds don't move.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityMergedRegion {
    /// CellId hex of the top-left (origin) cell.
    pub top_left_id: String,
    /// CellId hex of the bottom-right cell.
    pub bottom_right_id: String,
}

// ── Resolved merge (query result — identity + positions) ────────────────────

/// Resolved merged region with both identity and positional data.
/// Produced by resolving an `IdentityMergedRegion` against the grid index.
///
/// `row_span` and `col_span` are private computed fields — use the getter
/// methods. They are serialized for TS wire compat but not deserialized.
/// All construction MUST go through `new()`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedMergedRegion {
    /// The identity-based merge this was resolved from.
    pub merge: IdentityMergedRegion,
    /// First row of the merged region (0-based).
    pub start_row: u32,
    /// First column of the merged region (0-based).
    pub start_col: u32,
    /// Last row of the merged region (inclusive, 0-based).
    pub end_row: u32,
    /// Last column of the merged region (inclusive, 0-based).
    pub end_col: u32,
    /// Computed: `end_row - start_row + 1`. Private to enforce constructor use.
    #[serde(skip_deserializing)]
    row_span: u32,
    /// Computed: `end_col - start_col + 1`. Private to enforce constructor use.
    #[serde(skip_deserializing)]
    col_span: u32,
}

impl ResolvedMergedRegion {
    /// Construct a resolved merge. Auto-computes `row_span` and `col_span`.
    pub fn new(
        merge: IdentityMergedRegion,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Self {
        debug_assert!(
            end_row >= start_row && end_col >= start_col,
            "ResolvedMergedRegion: invalid rectangle ({start_row},{start_col})-({end_row},{end_col})"
        );
        Self {
            merge,
            start_row,
            start_col,
            end_row,
            end_col,
            row_span: end_row - start_row + 1,
            col_span: end_col - start_col + 1,
        }
    }

    /// Number of rows spanned.
    pub fn row_span(&self) -> u32 {
        self.row_span
    }

    /// Number of columns spanned.
    pub fn col_span(&self) -> u32 {
        self.col_span
    }

    /// Extract the position-only `MergeRegion`.
    pub fn to_region(&self) -> MergeRegion {
        MergeRegion {
            start_row: self.start_row,
            start_col: self.start_col,
            end_row: self.end_row,
            end_col: self.end_col,
        }
    }
}

// ── Per-cell query result ───────────────────────────────────────────────────

/// Info about a cell's relationship to a merge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellMergeInfo {
    /// The resolved merge containing this cell.
    pub merge: ResolvedMergedRegion,
    /// Whether this cell is the origin (top-left) of the merge.
    pub is_origin: bool,
}

// ── Conversions ─────────────────────────────────────────────────────────────

impl From<ResolvedMergedRegion> for MergeRegion {
    fn from(r: ResolvedMergedRegion) -> Self {
        r.to_region()
    }
}

// ── MergeRange ↔ MergeRegion conversions ────────────────────────────────

impl From<ooxml_types::worksheet::MergeRange> for MergeRegion {
    fn from(mr: ooxml_types::worksheet::MergeRange) -> Self {
        Self {
            start_row: mr.start_row,
            start_col: mr.start_col,
            end_row: mr.end_row,
            end_col: mr.end_col,
        }
    }
}

impl From<MergeRegion> for ooxml_types::worksheet::MergeRange {
    fn from(r: MergeRegion) -> Self {
        ooxml_types::worksheet::MergeRange::from_coords(
            r.start_row,
            r.start_col,
            r.end_row,
            r.end_col,
        )
    }
}
