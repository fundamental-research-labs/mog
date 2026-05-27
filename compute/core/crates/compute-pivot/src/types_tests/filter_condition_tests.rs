use super::*;
use value_types::CellValue;

// ---- 4d: PivotFilterCondition serde round-trip ----

#[test]
fn filter_condition_nullary_serde() {
    let cond = PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank);
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_unary_serde() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Equals,
        value: CellValue::number(42.0),
    };
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_binary_serde() {
    let cond = PivotFilterCondition::Binary {
        op: BinaryFilterOp::Between,
        value: CellValue::number(10.0),
        value2: CellValue::number(20.0),
    };
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_contains_text_serde() {
    let cond = PivotFilterCondition::Unary {
        op: UnaryFilterOp::Contains,
        value: CellValue::Text("widget".into()),
    };
    let json = serde_json::to_string(&cond).unwrap();
    let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, cond);
}

#[test]
fn filter_condition_all_nullary_variants() {
    for cond in [
        PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank),
        PivotFilterCondition::Nullary(NullaryFilterOp::IsNotBlank),
        PivotFilterCondition::Nullary(NullaryFilterOp::AboveAverage),
        PivotFilterCondition::Nullary(NullaryFilterOp::BelowAverage),
    ] {
        let json = serde_json::to_string(&cond).unwrap();
        let deserialized: PivotFilterCondition = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, cond);
    }
}

// ---- 4d: PivotFilterCondition flat conversion round-trip ----

#[test]
fn filter_condition_flat_to_typed_roundtrip() {
    let flat = PivotFilterConditionFlat {
        operator: FilterOperator::Between,
        value: Some(CellValue::number(10.0)),
        value2: Some(CellValue::number(50.0)),
    };
    let typed = PivotFilterCondition::from_flat(flat.clone());
    match &typed {
        PivotFilterCondition::Binary {
            op: BinaryFilterOp::Between,
            value,
            value2,
        } => {
            assert_eq!(*value, CellValue::number(10.0));
            assert_eq!(*value2, CellValue::number(50.0));
        }
        _ => panic!("Expected Binary Between"),
    }
    let back_to_flat = PivotFilterConditionFlat::from(typed);
    assert_eq!(back_to_flat, flat);
}

#[test]
fn filter_condition_flat_nullary_roundtrip() {
    let flat = PivotFilterConditionFlat {
        operator: FilterOperator::IsBlank,
        value: None,
        value2: None,
    };
    let typed = PivotFilterCondition::from_flat(flat.clone());
    assert_eq!(
        typed,
        PivotFilterCondition::Nullary(NullaryFilterOp::IsBlank)
    );
    let back = PivotFilterConditionFlat::from(typed);
    assert_eq!(back, flat);
}
