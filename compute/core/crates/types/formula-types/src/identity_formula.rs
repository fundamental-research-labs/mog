//! Identity-based formula storage types.
//!
//! Formulas are stored as a template with numbered placeholders and a list of
//! identity-based references. This is CRDT-safe and survives structural changes
//! (insert/delete rows/cols) without formula rewriting.
//!
//! # unified reference model — unified reference model
//!
//! Every reference variant implements [`ReferenceTarget`], which answers:
//!  - `resolved_sheet`: which sheet does this ref point at (drives prefix emission)?
//!  - `display_body`: how do I render the body (A1 or R1C1) without the prefix?
//!  - `dep_edges`: what dependency edges do I emit for the graph?
//!
//! Display collapses to a single `format_ref` in `compute_parser` that consults
//! `resolved_sheet` + `display_body` and emits the sheet prefix iff the ref's
//! sheet differs from the formula's own sheet.
//!
//! Workbook-scoped names return `resolved_sheet → None` → no prefix ever.
//! Sheet-scoped names return `Some(scope_sheet)` → prefix iff cross-sheet.
//! Cells/rows/cols return `Some(sheet)`. Tables (future) return `Some(table.sheet)`.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use cell_types::{CellId, ColId, NameId, RowId, SheetId, TableId, col_to_letter_buf};
use workbook_types::{ExternalCellRef, ExternalDepTarget, ExternalNameRef, ExternalRangeRef};

// ── Single cell ref ──────────────────────────────────────────────────

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

// ── Cell range ref ───────────────────────────────────────────────────

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

// ── Full row refs ────────────────────────────────────────────────────

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

// ── Full column refs ─────────────────────────────────────────────────

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

// ── Ref enum ─────────────────────────────────────────────────────────

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

// ── Main formula type ────────────────────────────────────────────────

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

// ── Dependency extraction ────────────────────────────────────────────

/// The result of extracting dependency IDs from an [`IdentityFormula`].
///
/// Cell/Range refs contribute [`CellId`]s (corner cells only for ranges).
/// FullRow/RowRange refs contribute [`RowId`]s.
/// FullCol/ColRange refs contribute [`ColId`]s.
///
/// **Compatibility shim**: PR 1 introduces [`DepEdges`] as the typed-edge enum
/// replacement. `FormulaDeps` is populated by flattening `DepEdges` via
/// [`FormulaDeps::from_edges`]. PR 4 migrates graph consumers to `DepEdges`
/// directly and removes this shim.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FormulaDeps {
    /// Cell IDs from Cell and Range refs (corner `CellId`s only).
    pub cell_ids: Vec<CellId>,
    /// Row IDs from `FullRow` and `RowRange` refs.
    pub row_ids: Vec<RowId>,
    /// Column IDs from `FullCol` and `ColRange` refs.
    pub col_ids: Vec<ColId>,
    /// External dependencies keyed separately from local cell/range targets.
    pub external: Vec<ExternalDepTarget>,
}

impl FormulaDeps {
    /// Build a [`FormulaDeps`] from typed dependency edges.
    ///
    /// `DepEdge::Name` is dropped silently; PR 4 migrates graph consumers to
    /// `DepEdges` and removes this shim.
    #[must_use]
    pub fn from_edges(edges: &DepEdges) -> Self {
        let mut out = Self::default();
        for e in &edges.edges {
            match e {
                DepEdge::Cell(id) => out.cell_ids.push(*id),
                DepEdge::Range { start, end } => {
                    out.cell_ids.push(*start);
                    out.cell_ids.push(*end);
                }
                DepEdge::RectRange {
                    start_row,
                    end_row,
                    start_col,
                    end_col,
                    ..
                } => {
                    out.row_ids.push(*start_row);
                    out.row_ids.push(*end_row);
                    out.col_ids.push(*start_col);
                    out.col_ids.push(*end_col);
                }
                DepEdge::Row(id) => out.row_ids.push(*id),
                DepEdge::RowRange { start, end } => {
                    out.row_ids.push(*start);
                    out.row_ids.push(*end);
                }
                DepEdge::Col(id) => out.col_ids.push(*id),
                DepEdge::ColRange { start, end } => {
                    out.col_ids.push(*start);
                    out.col_ids.push(*end);
                }
                // `NameId` edges exist in the enum for future PRs; PR 4 migrates
                // consumers to `DepEdges` and removes this shim entirely.
                DepEdge::Name(_) => {}
                DepEdge::External(target) => out.external.push(target.clone()),
            }
        }
        out
    }
}

// ── Typed dependency edges ───────────────────────────────────────────

/// Typed dependency edges emitted by [`ReferenceTarget::dep_edges`].
///
/// Single source of truth for formula invalidation. PR 4 migrates graph
/// consumers from [`FormulaDeps`] to this enum, at which point the
/// back-compat shim ([`FormulaDeps::from_edges`]) is removed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DepEdges {
    /// Ordered edges as discovered during ref traversal. The ordering matches
    /// the ref order in `IdentityFormula::refs`.
    pub edges: Vec<DepEdge>,
}

/// A single typed dependency edge.
///
/// Reserved variants (`Name`, future `Table`, `External`) keep the enum closed
/// under future PR additions without churning match exhaustiveness each time.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DepEdge {
    /// Single cell.
    Cell(CellId),
    /// Cell range by corner IDs.
    Range {
        /// Top-left corner.
        start: CellId,
        /// Bottom-right corner.
        end: CellId,
    },
    /// Rectangular cell range by sheet plus row/column identities.
    RectRange {
        /// Referenced sheet.
        sheet: SheetId,
        /// Start row.
        start_row: RowId,
        /// End row.
        end_row: RowId,
        /// Start column.
        start_col: ColId,
        /// End column.
        end_col: ColId,
    },
    /// Single full row.
    Row(RowId),
    /// Full-row range by corner IDs.
    RowRange {
        /// Start row.
        start: RowId,
        /// End row.
        end: RowId,
    },
    /// Single full column.
    Col(ColId),
    /// Full-column range by corner IDs.
    ColRange {
        /// Start column.
        start: ColId,
        /// End column.
        end: ColId,
    },
    /// Named-range dependency (reserved for future named-range parser work — parser doesn't
    /// emit this yet, but the enum variant is present so match-exhaustive
    /// graph consumers compile cleanly once PR 4 lands).
    Name(NameId),
    /// External dependency keyed by `ExternalRefKey`.
    External(ExternalDepTarget),
    // Reserved:
    // Table(TableId) — table dependency work.
    // External { wb: WorkbookId, inner: Box<DepEdge> } — future.
}

impl IdentityFormula {
    /// Extract all referenced identity IDs for dependency tracking.
    ///
    /// Cell/Range refs contribute `CellId`s (corner cells only for ranges).
    /// FullRow/RowRange contribute `RowId`s. FullCol/ColRange contribute `ColId`s.
    ///
    /// Implemented as a back-compat shim over [`Self::extract_dep_edges`].
    /// PR 4 migrates graph consumers to `DepEdges` directly and removes this.
    ///
    /// # Examples
    ///
    /// ```
    /// use formula_types::{IdentityFormula, IdentityFormulaRef, IdentityCellRef};
    /// use cell_types::CellId;
    ///
    /// let formula = IdentityFormula {
    ///     template: "{0}+{1}".to_string(),
    ///     refs: vec![
    ///         IdentityFormulaRef::Cell(IdentityCellRef {
    ///             id: CellId::from_raw(1),
    ///             row_absolute: false,
    ///             col_absolute: false,
    ///         }),
    ///         IdentityFormulaRef::Cell(IdentityCellRef {
    ///             id: CellId::from_raw(2),
    ///             row_absolute: false,
    ///             col_absolute: false,
    ///         }),
    ///     ],
    ///     is_dynamic_array: false,
    ///     is_volatile: false,
    ///     is_aggregate: false,
    /// };
    /// let deps = formula.extract_dep_ids();
    /// assert_eq!(deps.cell_ids, vec![CellId::from_raw(1), CellId::from_raw(2)]);
    /// ```
    #[must_use]
    pub fn extract_dep_ids(&self) -> FormulaDeps {
        FormulaDeps::from_edges(&self.extract_dep_edges())
    }

    /// Extract typed dependency edges from the formula's refs.
    ///
    /// Dispatches to each ref's [`ReferenceTarget::dep_edges`] impl.
    #[must_use]
    pub fn extract_dep_edges(&self) -> DepEdges {
        let mut out = DepEdges::default();
        for r in &self.refs {
            r.dep_edges(&mut out);
        }
        out
    }
}

// ── Reference target trait ───────────────────────────────────────────

/// Borrowed view over a named-range definition for display-time resolution.
///
/// PR 2 populates this from the workbook's named-range store; PR 1 only
/// declares the shape so the [`WorkbookLookup`] trait signature compiles.
#[derive(Debug, Clone, Copy)]
pub struct NameDef<'a> {
    /// Current display name (reflects rename since the ref was stored).
    pub name: &'a str,
    /// Scope: `None` → workbook-scoped (no prefix), `Some(sid)` → sheet-scoped.
    pub scope: Option<SheetId>,
}

/// Borrowed view over a table definition for display-time resolution.
///
/// table dependency work populates this from the workbook's table store; PR 1 only
/// declares the shape so the [`WorkbookLookup`] trait signature compiles.
/// Does **not** collide with the owned [`crate::TableDef`] in `refs.rs` —
/// that struct carries persistence data, this one is a zero-copy borrow view.
#[derive(Debug, Clone, Copy)]
pub struct TableDefLookup<'a> {
    /// Current display name (reflects rename).
    pub name: &'a str,
    /// Sheet containing the table.
    pub sheet: SheetId,
}

/// Display-time lookup from identity IDs to their current workbook state.
///
/// Previously named `CellPositionLookup` (older implementations). Broadened in
/// unified reference model so every reference variant — existing six plus future Name,
/// Table, External — can answer `resolved_sheet` + `display_body` from a
/// single trait.
///
/// **Row/col lookups now return `Option<(SheetId, u32)>`**. The `SheetId` is
/// load-bearing: full-row/full-col refs must emit a sheet prefix when their
/// row/col's sheet differs from the formula's sheet — `'Sheet2'!1:1` is valid
/// A1 syntax the parser already accepts, and the prior `Option<u32>` signature
/// silently dropped the prefix on display (invariant #9).
pub trait WorkbookLookup {
    /// Resolve a [`CellId`] to its current (sheet, row, col) position.
    fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)>;
    /// Resolve a [`RowId`] to `(sheet, row_index)`.
    fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)>;
    /// Resolve a [`ColId`] to `(sheet, col_index)`.
    fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)>;
    /// Get the display name of a sheet.
    fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str>;
    /// Get the [`SheetId`] of the sheet this formula lives in (for cross-sheet display).
    fn formula_sheet(&self) -> SheetId;

    /// Resolve a [`NameId`] to a borrowed named-range view.
    ///
    /// Default: `None`. PR 2 overrides this on the workbook/storage impl.
    fn name_def(&self, _id: &NameId) -> Option<NameDef<'_>> {
        None
    }
    /// Resolve a [`TableId`] to a borrowed table view.
    ///
    /// Default: `None`. table dependency work overrides this on the workbook/storage impl.
    fn table_def(&self, _id: &TableId) -> Option<TableDefLookup<'_>> {
        None
    }
}

/// Display style (A1 vs R1C1). A1 takes no context; R1C1 needs the formula's
/// own row/col for relative-offset arithmetic.
#[derive(Debug, Clone, Copy)]
pub enum RefStyle {
    /// A1 notation (e.g., `A1`, `$A$1`, `A:C`).
    A1,
    /// R1C1 notation with the formula-cell's own position as origin.
    R1C1 {
        /// Formula-cell's 0-based row for computing relative offsets.
        base_row: u32,
        /// Formula-cell's 0-based column for computing relative offsets.
        base_col: u32,
    },
}

/// A formula reference target — what a ref "points at" and how it renders.
///
/// Implemented per-variant so adding a new reference kind (Name, Table,
/// External) is a trivial one-impl addition with no churn in the display or
/// dep-graph layers. The enum-level impl dispatches via `match` for static
/// dispatch (no `dyn ReferenceTarget` in hot paths).
pub trait ReferenceTarget {
    /// The sheet this ref resolves to at display time. Controls sheet-prefix
    /// emission: prefix emits iff `Some(sid)` and `sid != formula_sheet()`.
    ///
    /// - Positional targets (Cell/Range/Row/Col): sheet of the resolved ID.
    /// - Named range sheet-scoped: the scope sheet (future).
    /// - Named range workbook-scoped: `None` (never prefix) (future).
    /// - Deleted/dangling target: `None` (body emits `#REF!`).
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId>;

    /// Render the ref body — `A1`, `MyName`, `Tbl[col]` — without sheet prefix.
    /// Writes to `out`; emits `#REF!` on a dangling target.
    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String);

    /// Emit this ref's dependency edges into the graph.
    fn dep_edges(&self, out: &mut DepEdges);
}

// ---------------------------------------------------------------------------
// R1C1 helpers used by the ReferenceTarget impls.
// ---------------------------------------------------------------------------

fn write_r1c1_row(out: &mut String, row: u32, absolute: bool, base_row: u32) {
    out.push('R');
    if absolute {
        write!(out, "{}", row + 1).unwrap();
    } else {
        let offset = i64::from(row) - i64::from(base_row);
        if offset != 0 {
            write!(out, "[{offset}]").unwrap();
        }
    }
}

fn write_r1c1_col(out: &mut String, col: u32, absolute: bool, base_col: u32) {
    out.push('C');
    if absolute {
        write!(out, "{}", col + 1).unwrap();
    } else {
        let offset = i64::from(col) - i64::from(base_col);
        if offset != 0 {
            write!(out, "[{offset}]").unwrap();
        }
    }
}

// ---------------------------------------------------------------------------
// ReferenceTarget impls for the six existing variants.
// ---------------------------------------------------------------------------

impl ReferenceTarget for IdentityCellRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.cell_position(&self.id).map(|(s, _, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let Some((_, row, col)) = l.cell_position(&self.id) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(col, out);
                if self.row_absolute {
                    out.push('$');
                }
                write!(out, "{}", row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, base_col } => {
                write_r1c1_row(out, row, self.row_absolute, base_row);
                write_r1c1_col(out, col, self.col_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Cell(self.id));
    }
}

impl ReferenceTarget for IdentityRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        // Sheet is determined by the start corner; that's the historical contract.
        l.cell_position(&self.start_id).map(|(s, _, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((_, s_row, s_col)), Some((_, e_row, e_col))) = (
            l.cell_position(&self.start_id),
            l.cell_position(&self.end_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.start_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(s_col, out);
                if self.start_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", s_row + 1).unwrap();
                out.push(':');
                if self.end_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(e_col, out);
                if self.end_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", e_row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, base_col } => {
                write_r1c1_row(out, s_row, self.start_row_absolute, base_row);
                write_r1c1_col(out, s_col, self.start_col_absolute, base_col);
                out.push(':');
                write_r1c1_row(out, e_row, self.end_row_absolute, base_row);
                write_r1c1_col(out, e_col, self.end_col_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Range {
            start: self.start_id,
            end: self.end_id,
        });
    }
}

impl ReferenceTarget for IdentityRectRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        let (Some((start_row_sheet, _)), Some((end_row_sheet, _))) = (
            l.row_index(&self.start_row_id),
            l.row_index(&self.end_row_id),
        ) else {
            return None;
        };
        let (Some((start_col_sheet, _)), Some((end_col_sheet, _))) = (
            l.col_index(&self.start_col_id),
            l.col_index(&self.end_col_id),
        ) else {
            return None;
        };
        (start_row_sheet == self.sheet_id
            && end_row_sheet == self.sheet_id
            && start_col_sheet == self.sheet_id
            && end_col_sheet == self.sheet_id)
            .then_some(self.sheet_id)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((start_row_sheet, s_row)), Some((end_row_sheet, e_row))) = (
            l.row_index(&self.start_row_id),
            l.row_index(&self.end_row_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        let (Some((start_col_sheet, s_col)), Some((end_col_sheet, e_col))) = (
            l.col_index(&self.start_col_id),
            l.col_index(&self.end_col_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        if start_row_sheet != self.sheet_id
            || end_row_sheet != self.sheet_id
            || start_col_sheet != self.sheet_id
            || end_col_sheet != self.sheet_id
        {
            out.push_str("#REF!");
            return;
        }
        match style {
            RefStyle::A1 => {
                if self.start_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(s_col, out);
                if self.start_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", s_row + 1).unwrap();
                out.push(':');
                if self.end_col_absolute {
                    out.push('$');
                }
                col_to_letter_buf(e_col, out);
                if self.end_row_absolute {
                    out.push('$');
                }
                write!(out, "{}", e_row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, base_col } => {
                write_r1c1_row(out, s_row, self.start_row_absolute, base_row);
                write_r1c1_col(out, s_col, self.start_col_absolute, base_col);
                out.push(':');
                write_r1c1_row(out, e_row, self.end_row_absolute, base_row);
                write_r1c1_col(out, e_col, self.end_col_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::RectRange {
            sheet: self.sheet_id,
            start_row: self.start_row_id,
            end_row: self.end_row_id,
            start_col: self.start_col_id,
            end_col: self.end_col_id,
        });
    }
}

impl ReferenceTarget for IdentityFullRowRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.row_index(&self.row_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let Some((_, row)) = l.row_index(&self.row_id) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.absolute {
                    out.push('$');
                }
                write!(out, "{}", row + 1).unwrap();
                out.push(':');
                if self.absolute {
                    out.push('$');
                }
                write!(out, "{}", row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, .. } => {
                write_r1c1_row(out, row, self.absolute, base_row);
                out.push(':');
                write_r1c1_row(out, row, self.absolute, base_row);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Row(self.row_id));
    }
}

impl ReferenceTarget for IdentityRowRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.row_index(&self.start_row_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((_, s_row)), Some((_, e_row))) = (
            l.row_index(&self.start_row_id),
            l.row_index(&self.end_row_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.start_absolute {
                    out.push('$');
                }
                write!(out, "{}", s_row + 1).unwrap();
                out.push(':');
                if self.end_absolute {
                    out.push('$');
                }
                write!(out, "{}", e_row + 1).unwrap();
            }
            RefStyle::R1C1 { base_row, .. } => {
                write_r1c1_row(out, s_row, self.start_absolute, base_row);
                out.push(':');
                write_r1c1_row(out, e_row, self.end_absolute, base_row);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::RowRange {
            start: self.start_row_id,
            end: self.end_row_id,
        });
    }
}

impl ReferenceTarget for IdentityFullColRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.col_index(&self.col_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let Some((_, col)) = l.col_index(&self.col_id) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.absolute {
                    out.push('$');
                }
                col_to_letter_buf(col, out);
                out.push(':');
                if self.absolute {
                    out.push('$');
                }
                col_to_letter_buf(col, out);
            }
            RefStyle::R1C1 { base_col, .. } => {
                write_r1c1_col(out, col, self.absolute, base_col);
                out.push(':');
                write_r1c1_col(out, col, self.absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::Col(self.col_id));
    }
}

impl ReferenceTarget for IdentityColRangeRef {
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        l.col_index(&self.start_col_id).map(|(s, _)| s)
    }

    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        let (Some((_, s_col)), Some((_, e_col))) = (
            l.col_index(&self.start_col_id),
            l.col_index(&self.end_col_id),
        ) else {
            out.push_str("#REF!");
            return;
        };
        match style {
            RefStyle::A1 => {
                if self.start_absolute {
                    out.push('$');
                }
                col_to_letter_buf(s_col, out);
                out.push(':');
                if self.end_absolute {
                    out.push('$');
                }
                col_to_letter_buf(e_col, out);
            }
            RefStyle::R1C1 { base_col, .. } => {
                write_r1c1_col(out, s_col, self.start_absolute, base_col);
                out.push(':');
                write_r1c1_col(out, e_col, self.end_absolute, base_col);
            }
        }
    }

    fn dep_edges(&self, out: &mut DepEdges) {
        out.edges.push(DepEdge::ColRange {
            start: self.start_col_id,
            end: self.end_col_id,
        });
    }
}

impl ReferenceTarget for IdentityFormulaRef {
    #[inline]
    fn resolved_sheet(&self, l: &dyn WorkbookLookup) -> Option<SheetId> {
        match self {
            Self::Cell(r) => r.resolved_sheet(l),
            Self::Range(r) => r.resolved_sheet(l),
            Self::RectRange(r) => r.resolved_sheet(l),
            Self::FullRow(r) => r.resolved_sheet(l),
            Self::RowRange(r) => r.resolved_sheet(l),
            Self::FullCol(r) => r.resolved_sheet(l),
            Self::ColRange(r) => r.resolved_sheet(l),
            Self::ExternalCell(_) | Self::ExternalRange(_) | Self::ExternalName(_) => None,
        }
    }

    #[inline]
    fn display_body(&self, l: &dyn WorkbookLookup, style: RefStyle, out: &mut String) {
        match self {
            Self::Cell(r) => r.display_body(l, style, out),
            Self::Range(r) => r.display_body(l, style, out),
            Self::RectRange(r) => r.display_body(l, style, out),
            Self::FullRow(r) => r.display_body(l, style, out),
            Self::RowRange(r) => r.display_body(l, style, out),
            Self::FullCol(r) => r.display_body(l, style, out),
            Self::ColRange(r) => r.display_body(l, style, out),
            Self::ExternalCell(_) | Self::ExternalRange(_) | Self::ExternalName(_) => {
                out.push_str("#REF!");
            }
        }
    }

    #[inline]
    fn dep_edges(&self, out: &mut DepEdges) {
        match self {
            Self::Cell(r) => r.dep_edges(out),
            Self::Range(r) => r.dep_edges(out),
            Self::RectRange(r) => r.dep_edges(out),
            Self::FullRow(r) => r.dep_edges(out),
            Self::RowRange(r) => r.dep_edges(out),
            Self::FullCol(r) => r.dep_edges(out),
            Self::ColRange(r) => r.dep_edges(out),
            Self::ExternalCell(r) => out
                .edges
                .push(DepEdge::External(ExternalDepTarget::Cell(r.clone()))),
            Self::ExternalRange(r) => out
                .edges
                .push(DepEdge::External(ExternalDepTarget::Range(r.clone()))),
            Self::ExternalName(r) => out
                .edges
                .push(DepEdge::External(ExternalDepTarget::Name(r.clone()))),
        }
    }
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use cell_types::{CellId, ColId, RowId, SheetId};

    // Helper: create distinct IDs for readability.
    fn cell(n: u128) -> CellId {
        CellId::from_raw(n)
    }
    fn row(n: u128) -> RowId {
        RowId::from_raw(n)
    }
    fn col(n: u128) -> ColId {
        ColId::from_raw(n)
    }

    // ── Serde roundtrip: each IdentityFormulaRef variant ─────────────

    #[test]
    fn serde_roundtrip_cell_ref() {
        let r = IdentityFormulaRef::Cell(IdentityCellRef {
            id: cell(1),
            row_absolute: true,
            col_absolute: false,
        });
        let json = serde_json::to_string(&r).unwrap();
        let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn serde_roundtrip_range_ref() {
        let r = IdentityFormulaRef::Range(IdentityRangeRef {
            start_id: cell(10),
            end_id: cell(20),
            start_row_absolute: true,
            start_col_absolute: false,
            end_row_absolute: false,
            end_col_absolute: true,
        });
        let json = serde_json::to_string(&r).unwrap();
        let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn serde_roundtrip_full_row_ref() {
        let r = IdentityFormulaRef::FullRow(IdentityFullRowRef {
            row_id: row(100),
            absolute: true,
        });
        let json = serde_json::to_string(&r).unwrap();
        let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn serde_roundtrip_row_range_ref() {
        let r = IdentityFormulaRef::RowRange(IdentityRowRangeRef {
            start_row_id: row(200),
            end_row_id: row(205),
            start_absolute: false,
            end_absolute: true,
        });
        let json = serde_json::to_string(&r).unwrap();
        let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn serde_roundtrip_full_col_ref() {
        let r = IdentityFormulaRef::FullCol(IdentityFullColRef {
            col_id: col(300),
            absolute: false,
        });
        let json = serde_json::to_string(&r).unwrap();
        let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn serde_roundtrip_col_range_ref() {
        let r = IdentityFormulaRef::ColRange(IdentityColRangeRef {
            start_col_id: col(400),
            end_col_id: col(403),
            start_absolute: true,
            end_absolute: false,
        });
        let json = serde_json::to_string(&r).unwrap();
        let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    // ── Serde roundtrip: full IdentityFormula ────────────────────────

    #[test]
    fn serde_roundtrip_identity_formula() {
        let formula = IdentityFormula {
            template: "SUM({0})+{1}*2".to_string(),
            refs: vec![
                IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: cell(10),
                    end_id: cell(20),
                    start_row_absolute: false,
                    start_col_absolute: false,
                    end_row_absolute: false,
                    end_col_absolute: false,
                }),
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(30),
                    row_absolute: false,
                    col_absolute: false,
                }),
            ],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let json = serde_json::to_string(&formula).unwrap();
        let f2: IdentityFormula = serde_json::from_str(&json).unwrap();
        assert_eq!(formula, f2);
    }

    #[test]
    fn serde_roundtrip_is_aggregate_true() {
        // Positive: is_aggregate=true survives round-trip.
        let formula = IdentityFormula {
            template: "SUBTOTAL(1,{0})".to_string(),
            refs: vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(10),
                end_id: cell(20),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: true,
        };
        let json = serde_json::to_string(&formula).unwrap();
        let f2: IdentityFormula = serde_json::from_str(&json).unwrap();
        assert_eq!(formula, f2);
        assert!(f2.is_aggregate);
    }

    #[test]
    fn serde_default_is_aggregate_for_legacy_json() {
        // Legacy JSON written before `is_aggregate` existed must deserialize
        // cleanly with the flag defaulting to `false`. This is the Yrs
        // on-disk compatibility guarantee (W7). To construct realistic
        // legacy JSON, serialize a current formula and strip the
        // `is_aggregate` field (which #[serde(default)] makes optional).
        let formula = IdentityFormula {
            template: "SUM({0})".to_string(),
            refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(42),
                row_absolute: false,
                col_absolute: false,
            })],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let mut value: serde_json::Value = serde_json::to_value(&formula).unwrap();
        let obj = value.as_object_mut().unwrap();
        obj.remove("is_aggregate");
        let legacy_json = serde_json::to_string(&value).unwrap();
        // Sanity: the legacy string must not contain `is_aggregate`.
        assert!(!legacy_json.contains("is_aggregate"));

        let f: IdentityFormula = serde_json::from_str(&legacy_json).unwrap();
        assert!(!f.is_aggregate);
        assert_eq!(f.template, "SUM({0})");
    }

    // ── extract_dep_ids ──────────────────────────────────────────────

    #[test]
    fn extract_dep_ids_mixed_refs() {
        let formula = IdentityFormula {
            template: "{0}+{1}+{2}+{3}".to_string(),
            refs: vec![
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(1),
                    row_absolute: false,
                    col_absolute: false,
                }),
                IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: cell(10),
                    end_id: cell(20),
                    start_row_absolute: false,
                    start_col_absolute: false,
                    end_row_absolute: false,
                    end_col_absolute: false,
                }),
                IdentityFormulaRef::FullRow(IdentityFullRowRef {
                    row_id: row(100),
                    absolute: false,
                }),
                IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                    start_row_id: row(200),
                    end_row_id: row(205),
                    start_absolute: false,
                    end_absolute: false,
                }),
                IdentityFormulaRef::FullCol(IdentityFullColRef {
                    col_id: col(300),
                    absolute: false,
                }),
                IdentityFormulaRef::ColRange(IdentityColRangeRef {
                    start_col_id: col(400),
                    end_col_id: col(403),
                    start_absolute: false,
                    end_absolute: false,
                }),
            ],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };

        let deps = formula.extract_dep_ids();

        // Cell + Range corners
        assert_eq!(deps.cell_ids, vec![cell(1), cell(10), cell(20)]);
        // FullRow + RowRange
        assert_eq!(deps.row_ids, vec![row(100), row(200), row(205)]);
        // FullCol + ColRange
        assert_eq!(deps.col_ids, vec![col(300), col(400), col(403)]);
    }

    #[test]
    fn extract_dep_ids_empty_refs() {
        let formula = IdentityFormula {
            template: "42".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let deps = formula.extract_dep_ids();
        assert!(deps.cell_ids.is_empty());
        assert!(deps.row_ids.is_empty());
        assert!(deps.col_ids.is_empty());
    }

    #[test]
    fn extract_dep_edges_mixed_refs() {
        let formula = IdentityFormula {
            template: "{0}+{1}".to_string(),
            refs: vec![
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(1),
                    row_absolute: false,
                    col_absolute: false,
                }),
                IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: cell(2),
                    end_id: cell(3),
                    start_row_absolute: false,
                    start_col_absolute: false,
                    end_row_absolute: false,
                    end_col_absolute: false,
                }),
            ],
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        };
        let edges = formula.extract_dep_edges();
        assert_eq!(
            edges.edges,
            vec![
                DepEdge::Cell(cell(1)),
                DepEdge::Range {
                    start: cell(2),
                    end: cell(3)
                }
            ]
        );
    }

    // ── Flag tests ───────────────────────────────────────────────────

    #[test]
    fn identity_formula_dynamic_array() {
        let formula = IdentityFormula {
            template: "SEQUENCE({0})".to_string(),
            refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(1),
                row_absolute: false,
                col_absolute: false,
            })],
            is_dynamic_array: true,
            is_volatile: false,
            is_aggregate: false,
        };
        assert!(formula.is_dynamic_array);
        assert!(!formula.is_volatile);

        // Also verify serde preserves the flag
        let json = serde_json::to_string(&formula).unwrap();
        let f2: IdentityFormula = serde_json::from_str(&json).unwrap();
        assert!(f2.is_dynamic_array);
    }

    #[test]
    fn identity_formula_volatile() {
        let formula = IdentityFormula {
            template: "NOW()".to_string(),
            refs: vec![],
            is_dynamic_array: false,
            is_volatile: true,
            is_aggregate: false,
        };
        assert!(formula.is_volatile);
        assert!(!formula.is_dynamic_array);

        // Also verify serde preserves the flag
        let json = serde_json::to_string(&formula).unwrap();
        let f2: IdentityFormula = serde_json::from_str(&json).unwrap();
        assert!(f2.is_volatile);
    }

    // ── ReferenceTarget structure tests ──────────────────────────────

    struct TestLookup {
        formula_sheet: SheetId,
        cells: std::collections::HashMap<CellId, (SheetId, u32, u32)>,
        rows: std::collections::HashMap<RowId, (SheetId, u32)>,
        cols: std::collections::HashMap<ColId, (SheetId, u32)>,
        sheet_names: std::collections::HashMap<SheetId, String>,
    }

    impl WorkbookLookup for TestLookup {
        fn cell_position(&self, id: &CellId) -> Option<(SheetId, u32, u32)> {
            self.cells.get(id).copied()
        }
        fn row_index(&self, id: &RowId) -> Option<(SheetId, u32)> {
            self.rows.get(id).copied()
        }
        fn col_index(&self, id: &ColId) -> Option<(SheetId, u32)> {
            self.cols.get(id).copied()
        }
        fn sheet_name(&self, id: &SheetId) -> Option<&str> {
            self.sheet_names.get(id).map(String::as_str)
        }
        fn formula_sheet(&self) -> SheetId {
            self.formula_sheet
        }
    }

    #[test]
    fn cell_ref_resolved_sheet_returns_cells_sheet() {
        let mut lookup = TestLookup {
            formula_sheet: SheetId::from_raw(1),
            cells: HashMap::default(),
            rows: HashMap::default(),
            cols: HashMap::default(),
            sheet_names: HashMap::default(),
        };
        lookup.cells.insert(cell(1), (SheetId::from_raw(7), 0, 0));
        let r = IdentityCellRef {
            id: cell(1),
            row_absolute: false,
            col_absolute: false,
        };
        assert_eq!(r.resolved_sheet(&lookup), Some(SheetId::from_raw(7)));
    }

    #[test]
    fn cell_ref_dep_edges_emits_cell_edge() {
        let r = IdentityCellRef {
            id: cell(1),
            row_absolute: false,
            col_absolute: false,
        };
        let mut edges = DepEdges::default();
        r.dep_edges(&mut edges);
        assert_eq!(edges.edges, vec![DepEdge::Cell(cell(1))]);
    }

    #[test]
    fn full_row_ref_resolved_sheet_returns_row_sheet() {
        let mut lookup = TestLookup {
            formula_sheet: SheetId::from_raw(1),
            cells: HashMap::default(),
            rows: HashMap::default(),
            cols: HashMap::default(),
            sheet_names: HashMap::default(),
        };
        lookup.rows.insert(row(10), (SheetId::from_raw(2), 5));
        let r = IdentityFullRowRef {
            row_id: row(10),
            absolute: false,
        };
        assert_eq!(r.resolved_sheet(&lookup), Some(SheetId::from_raw(2)));
    }
}
