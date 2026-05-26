//! Per-sheet access matrix (§3.5) + the `ColumnIndex` trait used by
//! `PolicyEngine::evaluate_sheet` to resolve `ColId` → grid position.
//!
//! The matrix is immutable after construction — `Box<[..]>` over
//! `Vec<..>`. One `AccessLevel` byte per column (bitpacking is left as a
//! single-commit optimisation if the cache profile shows pressure).
//!
//! Row- and cell-level overrides are a future phase; ARCHITECTURE.md §3.5
//! reserves the slots in the struct comment but we intentionally don't
//! allocate them until the resolver supports them.

use cell_types::ColId;

use crate::events::AmbiguityWarning;
use crate::level::AccessLevel;

/// Adapter that lets the pure engine resolve column identities to column
/// positions without depending on the Yrs grid. Tests supply an in-memory
/// stub; `compute-core` wires it to the structural index.
pub trait ColumnIndex {
    fn position_of(&self, col: ColId) -> Option<u32>;
    fn column_count(&self) -> u32;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetAccessMatrix {
    sheet_default: AccessLevel,
    col_overrides: Box<[AccessLevel]>,
    ambiguity_warnings: Box<[AmbiguityWarning]>,
}

impl SheetAccessMatrix {
    pub(crate) fn new(
        sheet_default: AccessLevel,
        col_overrides: Box<[AccessLevel]>,
        ambiguity_warnings: Box<[AmbiguityWarning]>,
    ) -> Self {
        Self {
            sheet_default,
            col_overrides,
            ambiguity_warnings,
        }
    }

    /// Build a synthetic zero-column matrix at a uniform level. Used by
    /// the engine's workbook-scope read fallback (R3.1): the gated
    /// delegate macro emits a uniform `let __matrix = ...;` for
    /// workbook-scope reads, but their post-filter is a passthrough —
    /// the matrix is never actually consulted. This constructor lets
    /// that shape compile without forcing a real `PolicyEngine`
    /// evaluation for a meaningless column-less context.
    #[must_use]
    pub fn new_synthetic_uniform(level: AccessLevel) -> Self {
        Self {
            sheet_default: level,
            col_overrides: Box::new([]),
            ambiguity_warnings: Box::new([]),
        }
    }

    /// O(1) cell lookup. The `row` slot is reserved for future row/cell
    /// overrides — today it's unused.
    #[inline]
    #[must_use]
    pub fn get(&self, _row: u32, col: u32) -> AccessLevel {
        self.col_overrides
            .get(col as usize)
            .copied()
            .unwrap_or(self.sheet_default)
    }

    /// Whole-sheet fast path: viewport filters skip the per-cell walk
    /// entirely when the matrix is uniform. Returns `Some(level)` iff the
    /// matrix has no column overrides (or every override equals
    /// `sheet_default`).
    #[must_use]
    pub fn is_uniform(&self) -> Option<AccessLevel> {
        if self
            .col_overrides
            .iter()
            .all(|lvl| *lvl == self.sheet_default)
        {
            Some(self.sheet_default)
        } else {
            None
        }
    }

    #[must_use]
    pub fn sheet_default(&self) -> AccessLevel {
        self.sheet_default
    }

    #[must_use]
    pub fn column_overrides(&self) -> &[AccessLevel] {
        &self.col_overrides
    }

    #[must_use]
    pub fn warnings(&self) -> &[AmbiguityWarning] {
        &self.ambiguity_warnings
    }
}
