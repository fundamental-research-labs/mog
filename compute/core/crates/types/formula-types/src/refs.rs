//! Cell reference types — used in AST for both resolved and unresolved references.
//!
//! The `CellRef` enum handles the empty-cell problem: in the Cell Identity Model,
//! `CellId`s are created lazily — empty cells don't have them. A formula `=A1+B1`
//! where B1 is empty would fail if we required `CellId`s at parse time.
//! `Positional` refs resolve via `pos_to_id` at eval time and get promoted
//! to `Resolved` when the cell materializes.

use serde::{Deserialize, Serialize};

use cell_types::{CellId, ColId, RangeId, RowId, SheetId};
use value_types::{CellError, CellValue};

/// A reference to a cell, either resolved (has `CellId`) or positional (empty cell).
#[doc(alias = "reference")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CellRef {
    /// Cell has a known `CellId` (resolved at parse time from position index).
    /// Hot path: ~3-5ns lookup via `cells.get(&cell_id)`.
    Resolved(CellId),

    /// Cell is empty / not yet materialized — store position for lazy resolution.
    /// Promoted to `Resolved` when the cell gets a `CellId` (user types into it).
    /// On insert/delete: `row`/`col` are adjusted via the positional reverse index.
    Positional {
        /// Sheet containing the cell.
        sheet: SheetId,
        /// Zero-based row index.
        row: u32,
        /// Zero-based column index.
        col: u32,
    },
}

impl CellRef {
    /// Create a resolved reference.
    ///
    /// # Examples
    ///
    /// ```
    /// use formula_types::CellRef;
    /// use cell_types::CellId;
    ///
    /// let id = CellId::from_raw(42);
    /// let r = CellRef::resolved(id);
    /// assert!(r.is_resolved());
    /// ```
    #[must_use]
    #[inline]
    pub fn resolved(cell_id: CellId) -> Self {
        CellRef::Resolved(cell_id)
    }

    /// Create a positional reference (cell doesn't have a `CellId` yet).
    ///
    /// # Examples
    ///
    /// ```
    /// use formula_types::CellRef;
    /// use cell_types::SheetId;
    ///
    /// let r = CellRef::positional(SheetId::from_raw(1), 5, 10);
    /// assert!(!r.is_resolved());
    /// assert_eq!(r.cell_id(), None);
    /// ```
    #[must_use]
    #[inline]
    pub fn positional(sheet: SheetId, row: u32, col: u32) -> Self {
        CellRef::Positional { sheet, row, col }
    }

    /// Check if this is a resolved reference.
    #[must_use]
    #[inline]
    pub fn is_resolved(&self) -> bool {
        matches!(self, CellRef::Resolved(_))
    }

    /// Get the `CellId` if resolved.
    ///
    /// # Examples
    ///
    /// ```
    /// use formula_types::CellRef;
    /// use cell_types::{CellId, SheetId};
    ///
    /// let id = CellId::from_raw(42);
    /// assert_eq!(CellRef::resolved(id).cell_id(), Some(id));
    /// assert_eq!(CellRef::positional(SheetId::from_raw(1), 0, 0).cell_id(), None);
    /// ```
    #[must_use]
    #[inline]
    pub fn cell_id(&self) -> Option<CellId> {
        match self {
            CellRef::Resolved(id) => Some(*id),
            CellRef::Positional { .. } => None,
        }
    }
}

/// Range type for range references.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[non_exhaustive]
pub enum RangeType {
    /// Standard cell range: A1:B10
    CellRange,
    /// Full column range: A:C
    ColumnRange,
    /// Full row range: 1:5
    RowRange,
}

/// A range reference with corner `CellRef`s (may be Resolved or Positional).
#[doc(alias = "range")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RangeRef {
    /// Start corner of the range.
    pub start: CellRef,
    /// End corner of the range.
    pub end: CellRef,
    /// Whether this is a cell range, column range, or row range.
    pub range_type: RangeType,
}

/// Lexical scope for variable resolution. Resolution walks inner -> outer.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Scope {
    /// Sheet-scoped variable (visible only within a specific sheet).
    Sheet(SheetId),
    /// Workbook-scoped variable (visible everywhere).
    Workbook,
}

/// Named range definition.
///
/// Stores the name and an identity-based formula (`refers_to`) rather than
/// raw positions. Positional data is materialised transiently at eval time
/// via [`ResolvedName`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamedRangeDef {
    /// Name of the defined name.
    pub name: String,
    /// Scope of this variable (sheet-scoped or workbook-scoped).
    pub scope: Scope,
    /// The identity-based formula this name refers to (e.g. a range reference).
    pub refers_to: super::IdentityFormula,
    /// Raw expression string for non-reference variables (constants, formulas).
    /// Always set when available for fallback evaluation.
    #[serde(default)]
    pub raw_expression: Option<String>,
    /// Optional linkage to an existing `RangeKind::Data` Range covering the
    /// same region. Populated at import time; cleared when the linked Range
    /// is deleted.
    #[serde(default)]
    pub linked_range_id: Option<RangeId>,
}

impl NamedRangeDef {
    /// Create a `NamedRangeDef` from positional data (import/snapshot path).
    ///
    /// Generates fresh [`CellId`]s for the corner positions and builds an
    /// [`IdentityFormula`] with either a `Cell` or `Range` ref. Use this when
    /// converting from XLSX position data or hydrating from a legacy snapshot
    /// where only (row, col) bounds are available.
    ///
    /// If `start == end`, a single `Cell` ref is created; otherwise a `Range` ref.
    #[must_use]
    #[allow(clippy::too_many_arguments)]
    pub fn from_positions(
        name: String,
        scope: Scope,
        start_id: CellId,
        end_id: CellId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Self {
        let _ = (start_row, start_col, end_row, end_col); // positions used only for single-cell check
        let is_single_cell = start_id == end_id;
        let refers_to = if is_single_cell {
            super::IdentityFormula {
                template: "{0}".to_string(),
                refs: vec![super::IdentityFormulaRef::Cell(super::IdentityCellRef {
                    id: start_id,
                    row_absolute: true,
                    col_absolute: true,
                })],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }
        } else {
            super::IdentityFormula {
                template: "{0}".to_string(),
                refs: vec![super::IdentityFormulaRef::Range(super::IdentityRangeRef {
                    start_id,
                    end_id,
                    start_row_absolute: true,
                    start_col_absolute: true,
                    end_row_absolute: true,
                    end_col_absolute: true,
                })],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            }
        };
        Self {
            name,
            scope,
            refers_to,
            raw_expression: None,
            linked_range_id: None,
        }
    }

    /// Create a `NamedRangeDef` that always resolves to an error (e.g. #REF!).
    ///
    /// The `refers_to` formula is an empty formula with no refs, which the
    /// evaluator interprets as an unresolvable reference.
    #[must_use]
    pub fn error(name: String, scope: Scope, err: CellError) -> Self {
        // Encode the error string directly in the template so the evaluator
        // can surface it. The refs vec is empty, signalling an error.
        let _ = err; // The error type is conveyed by having zero refs
        Self {
            name,
            scope,
            refers_to: super::IdentityFormula {
                template: String::new(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
            raw_expression: None,
            linked_range_id: None,
        }
    }

    /// Create a `NamedRangeDef` from a raw expression string (constant or formula variable).
    ///
    /// The `refers_to` formula is empty (no refs). The raw expression is stored
    /// and will be parsed at resolution time as either a constant or a formula.
    #[must_use]
    pub fn from_expression(name: String, scope: Scope, raw_expression: String) -> Self {
        Self {
            name,
            scope,
            refers_to: super::IdentityFormula {
                template: String::new(),
                refs: vec![],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
            raw_expression: Some(raw_expression),
            linked_range_id: None,
        }
    }
}

/// Result of resolving a defined name (named range).
/// Contains positional data only — no cell values.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedName {
    /// Error baked into the name definition (e.g. #REF!)
    Error(CellError),
    /// Single cell reference
    Cell {
        /// Sheet containing the cell.
        sheet: SheetId,
        /// Zero-based row index.
        row: u32,
        /// Zero-based column index.
        col: u32,
    },
    /// Range reference
    Range {
        /// Sheet containing the range.
        sheet: SheetId,
        /// Zero-based starting row index.
        start_row: u32,
        /// Zero-based starting column index.
        start_col: u32,
        /// Zero-based ending row index.
        end_row: u32,
        /// Zero-based ending column index.
        end_col: u32,
    },
    /// Constant value (numeric, string, boolean, error, array constant).
    Constant(CellValue),
    /// Formula expression that needs evaluation.
    Formula {
        /// The raw expression string.
        raw_expression: String,
    },
}

/// Table definition (for structured references like `Table1[Col]`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableDef {
    /// Table name.
    pub name: String,
    /// Sheet containing this table.
    pub sheet: SheetId,
    /// Zero-based starting row index.
    pub start_row: u32,
    /// Zero-based starting column index.
    pub start_col: u32,
    /// Zero-based ending row index.
    pub end_row: u32,
    /// Zero-based ending column index.
    pub end_col: u32,
    /// Column names in order.
    pub columns: Vec<String>,
    /// Whether the table has a header row.
    pub has_headers: bool,
    /// Whether the table has a totals row.
    pub has_totals: bool,
}

/// Structural change events sent from TS to Rust.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StructureChange {
    /// Rows inserted at a position.
    InsertRows {
        /// Zero-based row index where insertion starts.
        at: u32,
        /// Number of rows inserted.
        count: u32,
        /// Identity IDs for the newly inserted rows.
        new_row_ids: Vec<RowId>,
    },
    /// Rows deleted from a position.
    DeleteRows {
        /// Zero-based row index where deletion starts.
        at: u32,
        /// Number of rows deleted.
        count: u32,
        /// Cell IDs removed by the deletion.
        deleted_cell_ids: Vec<CellId>,
    },
    /// Columns inserted at a position.
    InsertCols {
        /// Zero-based column index where insertion starts.
        at: u32,
        /// Number of columns inserted.
        count: u32,
        /// Identity IDs for the newly inserted columns.
        new_col_ids: Vec<ColId>,
    },
    /// Columns deleted from a position.
    DeleteCols {
        /// Zero-based column index where deletion starts.
        at: u32,
        /// Number of columns deleted.
        count: u32,
        /// Cell IDs removed by the deletion.
        deleted_cell_ids: Vec<CellId>,
    },
    /// Bulk position remap (used after sort, complex structural ops).
    RemapPositions {
        /// Position updates as (`cell_id`, `new_row`, `new_col`).
        updates: Vec<(CellId, u32, u32)>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{CellId, SheetId};

    #[test]
    fn cell_ref_resolved_constructor() {
        let id = CellId::from_raw(42);
        let r = CellRef::resolved(id);
        assert!(r.is_resolved());
        assert_eq!(r.cell_id(), Some(id));
    }

    #[test]
    fn cell_ref_positional_constructor() {
        let sheet = SheetId::from_raw(1);
        let r = CellRef::positional(sheet, 5, 10);
        assert!(!r.is_resolved());
        assert_eq!(r.cell_id(), None);
        match r {
            CellRef::Positional { sheet: s, row, col } => {
                assert_eq!(s, sheet);
                assert_eq!(row, 5);
                assert_eq!(col, 10);
            }
            CellRef::Resolved(_) => panic!("expected Positional"),
        }
    }

    #[test]
    fn range_ref_construction() {
        let sheet = SheetId::from_raw(1);
        let start = CellRef::positional(sheet, 0, 0);
        let end = CellRef::positional(sheet, 9, 2);
        let range = RangeRef {
            start,
            end,
            range_type: RangeType::CellRange,
        };
        assert_eq!(range.range_type, RangeType::CellRange);
        assert_eq!(range.start, start);
        assert_eq!(range.end, end);
    }

    #[test]
    fn range_type_variants() {
        assert_ne!(RangeType::CellRange, RangeType::ColumnRange);
        assert_ne!(RangeType::ColumnRange, RangeType::RowRange);
    }

    #[test]
    fn named_range_def_serde_roundtrip() {
        use crate::{IdentityFormula, IdentityFormulaRef, IdentityRangeRef};
        use cell_types::CellId;
        let nr = NamedRangeDef {
            name: "MyRange".into(),
            scope: Scope::Sheet(SheetId::from_raw(99)),
            refers_to: IdentityFormula {
                template: "{0}".to_string(),
                refs: vec![IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: CellId::from_raw(1),
                    end_id: CellId::from_raw(2),
                    start_row_absolute: true,
                    start_col_absolute: true,
                    end_row_absolute: true,
                    end_col_absolute: true,
                })],
                is_dynamic_array: false,
                is_volatile: false,
                is_aggregate: false,
            },
            raw_expression: None,
            linked_range_id: None,
        };
        let json = serde_json::to_string(&nr).unwrap();
        let nr2: NamedRangeDef = serde_json::from_str(&json).unwrap();
        assert_eq!(nr2.name, "MyRange");
        assert_eq!(nr2.refers_to.template, "{0}");
        assert_eq!(nr2.refers_to.refs.len(), 1);
        assert!(nr2.raw_expression.is_none());
    }

    #[test]
    fn table_def_serde_roundtrip() {
        let td = TableDef {
            name: "Table1".into(),
            sheet: SheetId::from_raw(1),
            start_row: 0,
            start_col: 0,
            end_row: 100,
            end_col: 5,
            columns: vec!["A".into(), "B".into(), "C".into()],
            has_headers: true,
            has_totals: false,
        };
        let json = serde_json::to_string(&td).unwrap();
        let td2: TableDef = serde_json::from_str(&json).unwrap();
        assert_eq!(td2.name, "Table1");
        assert_eq!(td2.columns.len(), 3);
        assert!(td2.has_headers);
        assert!(!td2.has_totals);
    }

    #[test]
    fn structure_change_insert_rows_serde() {
        let sc = StructureChange::InsertRows {
            at: 5,
            count: 3,
            new_row_ids: vec![
                cell_types::RowId::from_raw(10),
                cell_types::RowId::from_raw(11),
            ],
        };
        let json = serde_json::to_string(&sc).unwrap();
        let sc2: StructureChange = serde_json::from_str(&json).unwrap();
        match sc2 {
            StructureChange::InsertRows {
                at,
                count,
                new_row_ids,
            } => {
                assert_eq!(at, 5);
                assert_eq!(count, 3);
                assert_eq!(new_row_ids.len(), 2);
            }
            _ => panic!("expected InsertRows"),
        }
    }

    #[test]
    fn structure_change_delete_rows_serde() {
        let sc = StructureChange::DeleteRows {
            at: 2,
            count: 1,
            deleted_cell_ids: vec![CellId::from_raw(100)],
        };
        let json = serde_json::to_string(&sc).unwrap();
        let sc2: StructureChange = serde_json::from_str(&json).unwrap();
        match sc2 {
            StructureChange::DeleteRows {
                at,
                count,
                deleted_cell_ids,
            } => {
                assert_eq!(at, 2);
                assert_eq!(count, 1);
                assert_eq!(deleted_cell_ids.len(), 1);
            }
            _ => panic!("expected DeleteRows"),
        }
    }

    #[test]
    fn cell_ref_serde_roundtrip() {
        let id = CellId::from_raw(42);
        let r = CellRef::Resolved(id);
        let json = serde_json::to_string(&r).unwrap();
        let r2: CellRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }

    #[test]
    fn cell_ref_positional_serde_roundtrip() {
        let sheet = SheetId::from_raw(7);
        let r = CellRef::Positional {
            sheet,
            row: 3,
            col: 4,
        };
        let json = serde_json::to_string(&r).unwrap();
        let r2: CellRef = serde_json::from_str(&json).unwrap();
        assert_eq!(r, r2);
    }
}
