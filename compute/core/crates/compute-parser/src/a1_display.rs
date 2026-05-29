//! `IdentityFormula` -> A1 display string conversion.
//!
//! Thin wrapper over the unified [`crate::display::render_identity_formula`]
//! path. The heavy lifting (sheet-prefix emission, per-variant body rendering)
//! lives in the [`formula_types::ReferenceTarget`] impls on each ref struct;
//! see `compute/core/crates/types/formula-types/src/identity_formula.rs`.

use formula_types::{IdentityFormula, RefStyle, WorkbookLookup};

use crate::display::render_identity_formula;

/// Convert an `IdentityFormula` to an A1-style display string.
///
/// Resolves each identity reference to its current position via the `lookup`,
/// then replaces template placeholders `{0}`, `{1}`, etc. with the A1 notation.
///
/// # Cross-sheet references
/// If a ref's resolved sheet differs from `lookup.formula_sheet()`, the sheet
/// name is prepended (e.g., `Sheet2!A1`). This now applies uniformly to cell,
/// range, full-row, row-range, full-col, and col-range refs — previously the
/// row/col variants silently dropped the prefix (unified-reference invariant #9).
///
/// # Deleted references
/// If an identity ID cannot be resolved (deleted row/col/cell), `#REF!` is emitted.
///
/// # Examples
///
/// ```
/// # use std::collections::HashMap;
/// # use cell_types::{CellId, ColId, RowId, SheetId};
/// # use formula_types::{WorkbookLookup, IdentityCellRef, IdentityFormula, IdentityFormulaRef};
/// use compute_parser::to_a1_string;
///
/// # struct MockLookup {
/// #     cells: HashMap<CellId, (SheetId, u32, u32)>,
/// #     sheet: SheetId,
/// # }
/// # impl WorkbookLookup for MockLookup {
/// #     fn cell_position(&self, id: &CellId) -> Option<(SheetId, u32, u32)> { self.cells.get(id).copied() }
/// #     fn row_index(&self, _: &RowId) -> Option<(SheetId, u32)> { None }
/// #     fn col_index(&self, _: &ColId) -> Option<(SheetId, u32)> { None }
/// #     fn sheet_name(&self, _: &SheetId) -> Option<&str> { None }
/// #     fn formula_sheet(&self) -> SheetId { self.sheet }
/// # }
/// # let sheet = SheetId::from_raw(1);
/// # let cell_a1 = CellId::from_raw(10);
/// # let mut cells = HashMap::new();
/// # cells.insert(cell_a1, (sheet, 0, 0));
/// # let lookup = MockLookup { cells, sheet };
/// let formula = IdentityFormula {
///     template: "{0}+1".to_string(),
///     refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
///         id: cell_a1,
///         row_absolute: false,
///         col_absolute: false,
///     })],
///     is_dynamic_array: false,
///     is_volatile: false,
///     is_aggregate: false,
/// };
/// assert_eq!(to_a1_string(&formula, &lookup), "=A1+1");
/// ```
#[must_use]
pub fn to_a1_string(formula: &IdentityFormula, lookup: &dyn WorkbookLookup) -> String {
    render_identity_formula(formula, lookup, RefStyle::A1, false)
}

/// Like [`to_a1_string`], but always includes the sheet prefix on every
/// reference — even when the reference lives on the same sheet as
/// `lookup.formula_sheet()`.
///
/// Used for named-range `refers_to` display where the sheet context is
/// ambiguous and the fully-qualified `Sheet1!A1:B10` form is required.
#[must_use]
pub fn to_a1_string_qualified(formula: &IdentityFormula, lookup: &dyn WorkbookLookup) -> String {
    render_identity_formula(formula, lookup, RefStyle::A1, true)
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::{CellId, ColId, RowId, SheetId};
    use formula_types::{
        IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef,
        IdentityFullColRef, IdentityFullRowRef, IdentityRangeRef, IdentityRowRangeRef,
        WorkbookLookup,
    };
    use std::collections::HashMap;

    struct MockLookup {
        formula_sheet: SheetId,
        cell_positions: HashMap<CellId, (SheetId, u32, u32)>,
        row_indices: HashMap<RowId, (SheetId, u32)>,
        col_indices: HashMap<ColId, (SheetId, u32)>,
        sheet_names: HashMap<SheetId, String>,
    }

    impl MockLookup {
        fn new(formula_sheet: SheetId) -> Self {
            Self {
                formula_sheet,
                cell_positions: HashMap::new(),
                row_indices: HashMap::new(),
                col_indices: HashMap::new(),
                sheet_names: HashMap::new(),
            }
        }
    }

    impl WorkbookLookup for MockLookup {
        fn cell_position(&self, cell_id: &CellId) -> Option<(SheetId, u32, u32)> {
            self.cell_positions.get(cell_id).copied()
        }
        fn row_index(&self, row_id: &RowId) -> Option<(SheetId, u32)> {
            self.row_indices.get(row_id).copied()
        }
        fn col_index(&self, col_id: &ColId) -> Option<(SheetId, u32)> {
            self.col_indices.get(col_id).copied()
        }
        fn sheet_name(&self, sheet_id: &SheetId) -> Option<&str> {
            self.sheet_names
                .get(sheet_id)
                .map(std::string::String::as_str)
        }
        fn formula_sheet(&self) -> SheetId {
            self.formula_sheet
        }
    }

    fn cell(n: u128) -> CellId {
        CellId::from_raw(n)
    }
    fn row(n: u128) -> RowId {
        RowId::from_raw(n)
    }
    fn col(n: u128) -> ColId {
        ColId::from_raw(n)
    }
    fn sheet(n: u128) -> SheetId {
        SheetId::from_raw(n)
    }

    fn make_formula(template: &str, refs: Vec<IdentityFormulaRef>) -> IdentityFormula {
        IdentityFormula {
            template: template.to_string(),
            refs,
            is_dynamic_array: false,
            is_volatile: false,
            is_aggregate: false,
        }
    }

    #[test]
    fn simple_cell_refs() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(10), (s1, 0, 0));
        lookup.cell_positions.insert(cell(11), (s1, 0, 1));

        let formula = make_formula(
            "{0}+{1}",
            vec![
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(10),
                    row_absolute: false,
                    col_absolute: false,
                }),
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(11),
                    row_absolute: false,
                    col_absolute: false,
                }),
            ],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=A1+B1");
    }

    #[test]
    fn cell_range() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(20), (s1, 0, 0));
        lookup.cell_positions.insert(cell(21), (s1, 9, 1));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(20),
                end_id: cell(21),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(A1:B10)");
    }

    #[test]
    fn absolute_ref() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(30), (s1, 0, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(30),
                row_absolute: true,
                col_absolute: true,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=$A$1");
    }

    #[test]
    fn full_row() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(40), (s1, 0));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(40),
                absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(1:1)");
    }

    #[test]
    fn row_range() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(50), (s1, 0));
        lookup.row_indices.insert(row(51), (s1, 4));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row(50),
                end_row_id: row(51),
                start_absolute: false,
                end_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(1:5)");
    }

    #[test]
    fn full_col() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(60), (s1, 0));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(60),
                absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(A:A)");
    }

    #[test]
    fn col_range() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(70), (s1, 0));
        lookup.col_indices.insert(col(71), (s1, 2));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col(70),
                end_col_id: col(71),
                start_absolute: false,
                end_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(A:C)");
    }

    #[test]
    fn cross_sheet_ref() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(80), (s2, 0, 0));
        lookup.sheet_names.insert(s2, "Sheet2".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(80),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=Sheet2!A1");
    }

    #[test]
    fn cross_sheet_quoted_name() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(90), (s2, 0, 0));
        lookup.sheet_names.insert(s2, "My Sheet".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(90),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "='My Sheet'!A1");
    }

    #[test]
    fn cross_sheet_reference_like_sheet_name_is_quoted() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(91), (s2, 6, 18));
        lookup.sheet_names.insert(s2, "RC".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(91),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "='RC'!S7");
    }

    #[test]
    fn deleted_cell_ref() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(100),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=#REF!");
    }

    #[test]
    fn deleted_row_ref() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(110),
                absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(#REF!)");
    }

    #[test]
    fn no_refs() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);
        let formula = make_formula("1+2", vec![]);
        assert_eq!(to_a1_string(&formula, &lookup), "=1+2");
    }

    #[test]
    fn multiple_refs() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(130), (s1, 0, 0));
        lookup.cell_positions.insert(cell(131), (s1, 9, 1));
        lookup.cell_positions.insert(cell(132), (s1, 0, 2));

        let formula = make_formula(
            "SUM({0})+{1}*2",
            vec![
                IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: cell(130),
                    end_id: cell(131),
                    start_row_absolute: false,
                    start_col_absolute: false,
                    end_row_absolute: false,
                    end_col_absolute: false,
                }),
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(132),
                    row_absolute: false,
                    col_absolute: false,
                }),
            ],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(A1:B10)+C1*2");
    }

    #[test]
    fn after_position_shift() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(140), (s1, 5, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(140),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=A6");
    }

    #[test]
    fn cross_sheet_name_with_apostrophe() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(150), (s2, 0, 0));
        lookup.sheet_names.insert(s2, "Bob's Sheet".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(150),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "='Bob''s Sheet'!A1");
    }

    #[test]
    fn range_mixed_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(160), (s1, 0, 0));
        lookup.cell_positions.insert(cell(161), (s1, 9, 1));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(160),
                end_id: cell(161),
                start_row_absolute: false,
                start_col_absolute: true,
                end_row_absolute: true,
                end_col_absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM($A1:B$10)");
    }

    #[test]
    fn deleted_col_ref() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(170),
                absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=SUM(#REF!)");
    }

    #[test]
    fn cross_sheet_full_row_emits_prefix() {
        // unified-reference invariant #9 — smoke test from the a1_display unit layer.
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(300), (s2, 0));
        lookup.sheet_names.insert(s2, "Sheet2".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(300),
                absolute: false,
            })],
        );

        assert_eq!(to_a1_string(&formula, &lookup), "=Sheet2!1:1");
    }
}
