use crate::identity_formula::{IdentityCellRef, IdentityFormula, IdentityFormulaRef};

use super::helpers::cell;

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

    let json = serde_json::to_string(&formula).unwrap();
    let f2: IdentityFormula = serde_json::from_str(&json).unwrap();
    assert!(f2.is_volatile);
}
