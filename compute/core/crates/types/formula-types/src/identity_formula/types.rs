use serde::{Deserialize, Serialize};

use cell_types::{CellId, ColId, RowId, SheetId};
use workbook_types::{ExternalCellRef, ExternalNameRef, ExternalRangeRef};

/// A single cell reference stored by [`CellId`].
///
/// The `row_absolute` and `col_absolute` flags track whether the original
/// formula text used `$` anchors (e.g. `$A$1`). They have no effect on
/// identity resolution but are needed for display round-tripping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityCellRef {
    /// The stable identity of the referenced cell.
    pub id: CellId,
    /// Whether the row part was absolute (`$1`).
    pub row_absolute: bool,
    /// Whether the column part was absolute (`$A`).
    pub col_absolute: bool,
}

/// A cell range reference stored by corner [`CellId`]s (e.g. `A1:B10`).
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityRangeRef {
    /// The stable identity of the top-left corner cell.
    pub start_id: CellId,
    /// The stable identity of the bottom-right corner cell.
    pub end_id: CellId,
    /// Whether the start row was absolute.
    pub start_row_absolute: bool,
    /// Whether the start column was absolute.
    pub start_col_absolute: bool,
    /// Whether the end row was absolute.
    pub end_row_absolute: bool,
    /// Whether the end column was absolute.
    pub end_col_absolute: bool,
}

/// A rectangular cell range stored by sheet plus durable row/column identities.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityRectRangeRef {
    /// The sheet that owns the row and column identities.
    pub sheet_id: SheetId,
    /// The stable identity of the start row.
    pub start_row_id: RowId,
    /// The stable identity of the start column.
    pub start_col_id: ColId,
    /// The stable identity of the end row.
    pub end_row_id: RowId,
    /// The stable identity of the end column.
    pub end_col_id: ColId,
    /// Whether the start row was absolute.
    pub start_row_absolute: bool,
    /// Whether the start column was absolute.
    pub start_col_absolute: bool,
    /// Whether the end row was absolute.
    pub end_row_absolute: bool,
    /// Whether the end column was absolute.
    pub end_col_absolute: bool,
}

/// A single full-row reference stored by [`RowId`] (e.g. `1:1`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityFullRowRef {
    /// The stable identity of the referenced row.
    pub row_id: RowId,
    /// Whether the row reference was absolute.
    pub absolute: bool,
}

/// A full-row range reference stored by corner [`RowId`]s (e.g. `1:5`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityRowRangeRef {
    /// The stable identity of the start row.
    pub start_row_id: RowId,
    /// The stable identity of the end row.
    pub end_row_id: RowId,
    /// Whether the start row was absolute.
    pub start_absolute: bool,
    /// Whether the end row was absolute.
    pub end_absolute: bool,
}

/// A single full-column reference stored by [`ColId`] (e.g. `A:A`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityFullColRef {
    /// The stable identity of the referenced column.
    pub col_id: ColId,
    /// Whether the column reference was absolute.
    pub absolute: bool,
}

/// A full-column range reference stored by corner [`ColId`]s (e.g. `A:C`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct IdentityColRangeRef {
    /// The stable identity of the start column.
    pub start_col_id: ColId,
    /// The stable identity of the end column.
    pub end_col_id: ColId,
    /// Whether the start column was absolute.
    pub start_absolute: bool,
    /// Whether the end column was absolute.
    pub end_absolute: bool,
}

/// A single identity-based formula reference.
///
/// Each variant wraps one of the concrete ref structs and corresponds to an
/// Excel-style reference pattern (`=A1`, `=A1:B10`, `=1:1`, `=1:5`, `=A:A`, `=A:C`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum IdentityFormulaRef {
    /// Single cell: `=A1`
    Cell(IdentityCellRef),
    /// Cell range: `=A1:B10`
    Range(IdentityRangeRef),
    /// Cell range by sheet plus row/column identities: `=A1:B10`
    RectRange(IdentityRectRangeRef),
    /// Single full row: `=1:1`
    FullRow(IdentityFullRowRef),
    /// Full row range: `=1:5`
    RowRange(IdentityRowRangeRef),
    /// Single full column: `=A:A`
    FullCol(IdentityFullColRef),
    /// Full column range: `=A:C`
    ColRange(IdentityColRangeRef),
    /// External single cell keyed by destination-scoped `LinkId`.
    ExternalCell(ExternalCellRef),
    /// External range keyed by destination-scoped `LinkId`.
    ExternalRange(ExternalRangeRef),
    /// External defined name keyed by destination-scoped `LinkId`.
    ExternalName(ExternalNameRef),
}

/// An identity-based formula: a template string with numbered placeholders
/// and a parallel vec of identity refs.
///
/// Example: the formula `=SUM(A1:B10)+C1*2` is stored as
/// `template = "SUM({0})+{1}*2"` with `refs = [Range(A1:B10), Cell(C1)]`.
///
/// This representation is CRDT-safe — structural operations (insert/delete
/// rows/cols) never need to rewrite the template string. Only the identity →
/// position mapping changes.
///
/// # Examples
///
/// ```
/// use formula_types::{IdentityFormula, IdentityFormulaRef, IdentityCellRef};
/// use cell_types::CellId;
///
/// let formula = IdentityFormula {
///     template: "{0}+1".to_string(),
///     refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
///         id: CellId::from_raw(42),
///         row_absolute: false,
///         col_absolute: false,
///     })],
///     is_dynamic_array: false,
///     is_volatile: false,
///     is_aggregate: false,
/// };
/// assert_eq!(formula.template, "{0}+1");
/// assert_eq!(formula.refs.len(), 1);
/// ```
#[doc(alias = "CRDT")]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityFormula {
    /// Template with numbered placeholders: `"SUM({0})+{1}*2"`.
    pub template: String,
    /// Ordered refs that fill the placeholders.
    pub refs: Vec<IdentityFormulaRef>,
    /// `true` if this formula produces a dynamic array (SEQUENCE, SORT, FILTER, etc.).
    pub is_dynamic_array: bool,
    /// `true` if this formula is volatile (NOW, TODAY, RAND, etc.).
    pub is_volatile: bool,
    /// `true` if the top-level call is `SUBTOTAL` or `AGGREGATE` (including the
    /// XLSX-normalized `_XLFN.SUBTOTAL` / `_XLFN.AGGREGATE` prefixes, which the
    /// parser's normalize pass strips before producing the AST).
    ///
    /// Precomputed at construction from the AST so [`SUBTOTAL`]'s
    /// skip-nested-aggregates rule evaluates as `O(1)` per query instead of
    /// re-parsing the template string. See `cell_has_subtotal_formula` in
    /// `compute-core/src/eval_bridge/mirror_access.rs`.
    ///
    /// `#[serde(default)]` so Yrs / snapshot documents authored before this
    /// field existed deserialize to `false` (correct — no aggregate inference
    /// without the flag would report a false positive).
    #[serde(default)]
    pub is_aggregate: bool,
}
