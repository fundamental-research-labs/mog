use value_types::CellValue;

use crate::ast::{CellRefNode, RangeRef};

use super::FormulaSource;
use super::sqref::SqrefList;

/// Sheet qualifier parsed from an A1 expression -- the textual sheet name, not a
/// resolved [`cell_types::SheetId`].
///
/// `ParsedExpr::BrokenRef { sheet: Some(SheetName(..)) }` records the author's
/// original sheet prefix when an XLSX field like `'Deleted Sheet'!#REF!`
/// survives sheet deletion. The name is **not** resolved -- we intentionally do
/// not require a workbook-level sheet table to classify.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SheetName(pub String);

impl SheetName {
    /// Borrow the underlying name.
    #[must_use]
    #[inline]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for SheetName {
    #[inline]
    fn from(s: String) -> Self {
        Self(s)
    }
}

impl From<&str> for SheetName {
    #[inline]
    fn from(s: &str) -> Self {
        Self(s.to_owned())
    }
}

/// Typed umbrella for any "`refers_to`-shaped" XLSX field.
///
/// Every variant is reachable from [`ParsedExpr::classify`]; classification is
/// total over UTF-8. See the module-level docs for the totality contract and
/// match order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParsedExpr {
    /// Empty or whitespace-only input.
    Empty,
    /// `#REF!` token, optionally with a surviving sheet qualifier
    /// (e.g. `'Deleted Sheet'!#REF!`).
    BrokenRef {
        /// Original sheet qualifier, if the `#REF!` was sheet-prefixed.
        sheet: Option<SheetName>,
    },
    /// Single-cell A1 reference.
    Cell(CellRefNode),
    /// Single A1 range reference.
    Range(RangeRef),
    /// `sqref`-style space-separated range list with at least two entries.
    SqrefList(SqrefList),
    /// Literal scalar value: number, boolean, quoted text, or error token.
    Constant(CellValue),
    /// Anything else. Preserves original bytes for writer fidelity.
    Formula(FormulaSource),
}
