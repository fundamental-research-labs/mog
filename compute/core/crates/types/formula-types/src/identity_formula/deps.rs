use cell_types::{CellId, ColId, NameId, RowId, SheetId};
use workbook_types::ExternalDepTarget;

use super::lookup::ReferenceTarget;
use super::types::IdentityFormula;

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
