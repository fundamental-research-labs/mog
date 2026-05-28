use cell_types::{CellId, ColId, NameId, RowId, SheetId, TableId};

use super::deps::DepEdges;

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
