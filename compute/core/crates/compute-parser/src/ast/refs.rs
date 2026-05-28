use cell_types::SheetId;
use formula_types::{CellRef, RangeType};

/// A cell reference with absoluteness flags for `$`-prefixed row/column components.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode};
///
/// let ast = parse_formula("=$A$1", None).unwrap().into_inner();
/// match ast {
///     ASTNode::CellReference(r) => {
///         assert!(r.abs_row);
///         assert!(r.abs_col);
///     }
///     _ => panic!("expected cell ref"),
/// }
/// ```
#[must_use]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CellRefNode {
    pub reference: CellRef,
    pub abs_row: bool,
    pub abs_col: bool,
}

/// Absoluteness flags for a single endpoint of a range reference.
///
/// Each flag controls whether the corresponding component is prefixed with `$`
/// in A1 notation (e.g. `$A$1` has both `row` and `col` set to `true`).
///
/// # Examples
///
/// ```
/// use compute_parser::AbsFlags;
///
/// let flags = AbsFlags { row: true, col: false };
/// assert!(flags.row);   // $-prefixed row
/// assert!(!flags.col);  // relative column
///
/// let default = AbsFlags::default();
/// assert!(!default.row && !default.col); // fully relative
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct AbsFlags {
    pub row: bool,
    pub col: bool,
}

/// A range reference (cell range, row range, or column range) with absoluteness flags.
///
/// # Examples
///
/// ```
/// use compute_parser::{parse_formula, ASTNode};
///
/// let ast = parse_formula("=A1:B10", None).unwrap().into_inner();
/// match ast {
///     ASTNode::Range(r) => {
///         // Both endpoints default to relative (no $)
///         assert!(!r.abs_start.row && !r.abs_start.col);
///         assert!(!r.abs_end.row && !r.abs_end.col);
///     }
///     _ => panic!("expected range"),
/// }
/// ```
#[must_use]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RangeRef {
    pub start: CellRef,
    pub end: CellRef,
    pub abs_start: AbsFlags,
    pub abs_end: AbsFlags,
    pub range_type: RangeType,
}

impl RangeRef {
    /// Create a new `RangeRef` with all absoluteness flags set to `false` (the common case).
    #[inline]
    pub const fn new(start: CellRef, end: CellRef, range_type: RangeType) -> Self {
        Self {
            start,
            end,
            abs_start: AbsFlags {
                row: false,
                col: false,
            },
            abs_end: AbsFlags {
                row: false,
                col: false,
            },
            range_type,
        }
    }

    /// Create a new `RangeRef` with explicit absoluteness flags.
    ///
    /// Each flag in `abs_start` / `abs_end` controls the `$` prefix for that
    /// component of the reference (e.g. `$A$1:$B$10` has all four set to `true`).
    #[inline]
    pub const fn with_abs(
        start: CellRef,
        end: CellRef,
        range_type: RangeType,
        abs_start: AbsFlags,
        abs_end: AbsFlags,
    ) -> Self {
        Self {
            start,
            end,
            abs_start,
            abs_end,
            range_type,
        }
    }

    /// Builder: set `abs_start.row`.
    #[inline]
    pub const fn with_abs_start_row(mut self, abs: bool) -> Self {
        self.abs_start.row = abs;
        self
    }

    /// Builder: set `abs_start.col`.
    #[inline]
    pub const fn with_abs_start_col(mut self, abs: bool) -> Self {
        self.abs_start.col = abs;
        self
    }

    /// Builder: set `abs_end.row`.
    #[inline]
    pub const fn with_abs_end_row(mut self, abs: bool) -> Self {
        self.abs_end.row = abs;
        self
    }

    /// Builder: set `abs_end.col`.
    #[inline]
    pub const fn with_abs_end_col(mut self, abs: bool) -> Self {
        self.abs_end.col = abs;
        self
    }

    /// Validate that both corners of the range are on the same sheet.
    ///
    /// Returns the common `SheetId` if both refs are positional and on the same sheet,
    /// or `None` if the refs are resolved (CellId-based) or on different sheets.
    /// Callers can use this for early validation instead of waiting for a runtime #REF!.
    #[must_use]
    pub fn same_sheet(&self) -> Option<SheetId> {
        match (&self.start, &self.end) {
            (CellRef::Positional { sheet: s1, .. }, CellRef::Positional { sheet: s2, .. }) => {
                if s1 == s2 { Some(*s1) } else { None }
            }
            _ => None,
        }
    }
}
