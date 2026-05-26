//! Shared test helpers for snapshot module tests.

use cell_types::CellId;
use formula_types::{IdentityCellRef, IdentityFormula, IdentityFormulaRef};

/// Create a sample IdentityFormula for testing.
pub(super) fn sample_identity_formula() -> IdentityFormula {
    IdentityFormula {
        template: "SUM({0})".to_string(),
        refs: vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: CellId::from_raw(42),
            row_absolute: false,
            col_absolute: false,
        })],
        is_dynamic_array: false,
        is_volatile: false,
        is_aggregate: false,
    }
}
