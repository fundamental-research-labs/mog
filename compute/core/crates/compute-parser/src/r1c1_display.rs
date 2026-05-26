//! `IdentityFormula` -> R1C1 display string conversion.
//!
//! Thin wrapper over the unified [`crate::display::render_identity_formula`]
//! path (unified reference model). Per-variant body rendering lives in the
//! [`formula_types::ReferenceTarget`] impls.

use formula_types::{IdentityFormula, RefStyle, WorkbookLookup};

use crate::display::render_identity_formula;

/// Convert an `IdentityFormula` to an R1C1-style display string.
///
/// Resolves each identity reference to its current position via the `lookup`,
/// then replaces template placeholders `{0}`, `{1}`, etc. with the R1C1 notation.
///
/// `base_row` and `base_col` are the 0-based position of the cell containing
/// this formula, needed to compute relative offsets.
#[must_use]
pub fn to_r1c1_string(
    formula: &IdentityFormula,
    lookup: &dyn WorkbookLookup,
    base_row: u32,
    base_col: u32,
) -> String {
    render_identity_formula(
        formula,
        lookup,
        RefStyle::R1C1 { base_row, base_col },
        false,
    )
}

/// Like [`to_r1c1_string`], but always includes the sheet prefix on every
/// reference — even when same-sheet.
#[must_use]
pub fn to_r1c1_string_qualified(
    formula: &IdentityFormula,
    lookup: &dyn WorkbookLookup,
    base_row: u32,
    base_col: u32,
) -> String {
    render_identity_formula(formula, lookup, RefStyle::R1C1 { base_row, base_col }, true)
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
    fn simple_cell_ref_relative() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(10), (s1, 0, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(10),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 1, 1), "=R[-1]C[-1]");
    }

    #[test]
    fn simple_cell_ref_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(20), (s1, 0, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(20),
                row_absolute: true,
                col_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 5, 5), "=R1C1");
    }

    #[test]
    fn same_cell_ref_zero_offset() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(30), (s1, 0, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(30),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=RC");
    }

    #[test]
    fn cell_range_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(40), (s1, 0, 0));
        lookup.cell_positions.insert(cell(41), (s1, 9, 1));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(40),
                end_id: cell(41),
                start_row_absolute: true,
                start_col_absolute: true,
                end_row_absolute: true,
                end_col_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=R1C1:R10C2");
    }

    #[test]
    fn cell_range_relative() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(50), (s1, 0, 0));
        lookup.cell_positions.insert(cell(51), (s1, 9, 1));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(50),
                end_id: cell(51),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            })],
        );

        assert_eq!(
            to_r1c1_string(&formula, &lookup, 2, 2),
            "=R[-2]C[-2]:R[7]C[-1]"
        );
    }

    #[test]
    fn cell_range_mixed_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(60), (s1, 0, 0));
        lookup.cell_positions.insert(cell(61), (s1, 9, 1));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(60),
                end_id: cell(61),
                start_row_absolute: false,
                start_col_absolute: true,
                end_row_absolute: true,
                end_col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 2, 2), "=R[-2]C1:R10C[-1]");
    }

    #[test]
    fn full_row_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(70), (s1, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(70),
                absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 5, 5), "=R1:R1");
    }

    #[test]
    fn full_row_relative() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(80), (s1, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(80),
                absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 2, 0), "=R[-2]:R[-2]");
    }

    #[test]
    fn row_range_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(90), (s1, 0));
        lookup.row_indices.insert(row(91), (s1, 4));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row(90),
                end_row_id: row(91),
                start_absolute: true,
                end_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=R1:R5");
    }

    #[test]
    fn full_col_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(100), (s1, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(100),
                absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 5), "=C1:C1");
    }

    #[test]
    fn full_col_relative() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(110), (s1, 0));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(110),
                absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 2), "=C[-2]:C[-2]");
    }

    #[test]
    fn col_range_absolute() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(120), (s1, 0));
        lookup.col_indices.insert(col(121), (s1, 2));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col(120),
                end_col_id: col(121),
                start_absolute: true,
                end_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=C1:C3");
    }

    #[test]
    fn cross_sheet_ref() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(130), (s2, 0, 0));
        lookup.sheet_names.insert(s2, "Sheet2".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(130),
                row_absolute: true,
                col_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=Sheet2!R1C1");
    }

    #[test]
    fn cross_sheet_quoted_name() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(140), (s2, 0, 0));
        lookup.sheet_names.insert(s2, "My Sheet".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(140),
                row_absolute: true,
                col_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "='My Sheet'!R1C1");
    }

    #[test]
    fn deleted_cell_ref() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(150),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=#REF!");
    }

    #[test]
    fn deleted_row_ref() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(160),
                absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=SUM(#REF!)");
    }

    #[test]
    fn no_refs() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);
        let formula = make_formula("1+2", vec![]);
        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=1+2");
    }

    #[test]
    fn multiple_refs() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(180), (s1, 0, 0));
        lookup.cell_positions.insert(cell(181), (s1, 9, 1));
        lookup.cell_positions.insert(cell(182), (s1, 0, 2));

        let formula = make_formula(
            "SUM({0})+{1}*2",
            vec![
                IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: cell(180),
                    end_id: cell(181),
                    start_row_absolute: true,
                    start_col_absolute: true,
                    end_row_absolute: true,
                    end_col_absolute: true,
                }),
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: cell(182),
                    row_absolute: true,
                    col_absolute: true,
                }),
            ],
        );

        assert_eq!(
            to_r1c1_string(&formula, &lookup, 3, 3),
            "=SUM(R1C1:R10C2)+R1C3*2"
        );
    }

    #[test]
    fn positive_relative_offset() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(190), (s1, 4, 2));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(190),
                row_absolute: false,
                col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=R[4]C[2]");
    }

    #[test]
    fn full_row_zero_offset() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(200), (s1, 3));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullRow(IdentityFullRowRef {
                row_id: row(200),
                absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 3, 0), "=R:R");
    }

    #[test]
    fn full_col_zero_offset() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(210), (s1, 2));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(210),
                absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 2), "=C:C");
    }

    #[test]
    fn qualified_same_sheet() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(220), (s1, 0, 0));
        lookup.sheet_names.insert(s1, "Sheet1".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(220),
                row_absolute: true,
                col_absolute: true,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=R1C1");
        assert_eq!(
            to_r1c1_string_qualified(&formula, &lookup, 0, 0),
            "=Sheet1!R1C1"
        );
    }

    #[test]
    fn deleted_range_ref() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(230), (s1, 0, 0));

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: cell(230),
                end_id: cell(231),
                start_row_absolute: false,
                start_col_absolute: false,
                end_row_absolute: false,
                end_col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=SUM(#REF!)");
    }

    #[test]
    fn deleted_col_ref() {
        let s1 = sheet(1);
        let lookup = MockLookup::new(s1);

        let formula = make_formula(
            "SUM({0})",
            vec![IdentityFormulaRef::FullCol(IdentityFullColRef {
                col_id: col(240),
                absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 0), "=SUM(#REF!)");
    }

    #[test]
    fn row_range_relative() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.row_indices.insert(row(250), (s1, 1));
        lookup.row_indices.insert(row(251), (s1, 5));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::RowRange(IdentityRowRangeRef {
                start_row_id: row(250),
                end_row_id: row(251),
                start_absolute: false,
                end_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 3, 0), "=R[-2]:R[2]");
    }

    #[test]
    fn col_range_relative() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.col_indices.insert(col(260), (s1, 0));
        lookup.col_indices.insert(col(261), (s1, 4));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::ColRange(IdentityColRangeRef {
                start_col_id: col(260),
                end_col_id: col(261),
                start_absolute: false,
                end_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 0, 2), "=C[-2]:C[2]");
    }

    #[test]
    fn cross_sheet_name_with_apostrophe() {
        let s1 = sheet(1);
        let s2 = sheet(2);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(270), (s2, 0, 0));
        lookup.sheet_names.insert(s2, "Bob's Sheet".to_string());

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(270),
                row_absolute: true,
                col_absolute: true,
            })],
        );

        assert_eq!(
            to_r1c1_string(&formula, &lookup, 0, 0),
            "='Bob''s Sheet'!R1C1"
        );
    }

    #[test]
    fn mixed_cell_ref() {
        let s1 = sheet(1);
        let mut lookup = MockLookup::new(s1);
        lookup.cell_positions.insert(cell(280), (s1, 2, 1));

        let formula = make_formula(
            "{0}",
            vec![IdentityFormulaRef::Cell(IdentityCellRef {
                id: cell(280),
                row_absolute: true,
                col_absolute: false,
            })],
        );

        assert_eq!(to_r1c1_string(&formula, &lookup, 4, 3), "=R3C[-2]");
    }
}
