use crate::identity_formula::{
    IdentityCellRef, IdentityColRangeRef, IdentityFormula, IdentityFormulaRef, IdentityFullColRef,
    IdentityFullRowRef, IdentityRangeRef, IdentityRectRangeRef, IdentityRowRangeRef,
};

use super::helpers::{
    cell, col, external_cell_ref, external_name_ref, external_range_ref, row, sheet,
};

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
fn serde_roundtrip_rect_range_ref() {
    let r = IdentityFormulaRef::RectRange(IdentityRectRangeRef {
        sheet_id: sheet(1),
        start_row_id: row(10),
        start_col_id: col(20),
        end_row_id: row(11),
        end_col_id: col(21),
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

#[test]
fn serde_roundtrip_external_cell_ref() {
    let r = IdentityFormulaRef::ExternalCell(external_cell_ref(1));
    let json = serde_json::to_string(&r).unwrap();
    let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
    assert_eq!(r, r2);
}

#[test]
fn serde_roundtrip_external_range_ref() {
    let r = IdentityFormulaRef::ExternalRange(external_range_ref(2));
    let json = serde_json::to_string(&r).unwrap();
    let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
    assert_eq!(r, r2);
}

#[test]
fn serde_roundtrip_external_name_ref() {
    let r = IdentityFormulaRef::ExternalName(external_name_ref(3));
    let json = serde_json::to_string(&r).unwrap();
    let r2: IdentityFormulaRef = serde_json::from_str(&json).unwrap();
    assert_eq!(r, r2);
}

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
    assert!(!legacy_json.contains("is_aggregate"));

    let f: IdentityFormula = serde_json::from_str(&legacy_json).unwrap();
    assert!(!f.is_aggregate);
    assert_eq!(f.template, "SUM({0})");
}
