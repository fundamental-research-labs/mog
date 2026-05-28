//! Cell value serialization between Rust types and Yrs `Any` values.

use crate::DocumentError;
use crate::schema::*;
use formula_types::{IdentityFormula, IdentityFormulaRef};
use std::sync::Arc;
use value_types::CellValue;
use yrs::{Any, Map, MapPrelim, MapRef, Out};

const KEY_RICH_STRING: &str = "rt";

/// Build a `MapPrelim` for a cell entry.
pub fn build_cell_prelim(
    value: &CellValue,
    formula: Option<&str>,
    _identity_formula: Option<&IdentityFormula>,
) -> MapPrelim {
    let v = cell_value_to_any(value);
    match formula {
        Some(f) => MapPrelim::from([(KEY_VALUE, v), (KEY_FORMULA, Any::String(Arc::from(f)))]),
        None => MapPrelim::from([(KEY_VALUE, v)]),
    }
}

/// Write the CSE array-formula range string (e.g. `"A1:C5"`) onto an
/// existing yrs cell map. Used by `set_array_formula` so the CSE marker
/// survives Yrs undo/redo — pre-Legacy0, the marker was runtime-only
/// (in `mirror.cse_anchors`) and was lost on undo, leaving the value
/// but losing the array-formula brace.
///
/// To clear, use [`clear_array_ref_on_yrs`] (or write a value of `Null`
/// — but `remove` is the canonical "no longer a CSE" operation).
pub fn write_array_ref_to_yrs(
    cell_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    range_a1: &str,
) {
    cell_map.insert(txn, KEY_ARRAY_REF, Any::String(Arc::from(range_a1)));
}

/// Remove the CSE array-formula range from a yrs cell map. No-op when
/// absent. Companion to [`write_array_ref_to_yrs`].
pub fn clear_array_ref_on_yrs(cell_map: &MapRef, txn: &mut yrs::TransactionMut<'_>) {
    cell_map.remove(txn, KEY_ARRAY_REF);
}

/// Read the CSE array-formula range from a yrs cell map. Returns the
/// raw A1 range string (`"A1:C5"`) without parsing — callers parse it
/// via the existing snapshot machinery (`parse_a1_range`).
pub fn read_array_ref_from_yrs<T: yrs::ReadTxn>(cell_map: &MapRef, txn: &T) -> Option<String> {
    match cell_map.get(txn, KEY_ARRAY_REF) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}

/// Write cell-owned rich shared-string state onto an existing yrs cell map.
pub fn write_rich_string_to_yrs(
    cell_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    rich_string: &domain_types::RichSharedString,
) {
    let json = serde_json::to_string(rich_string)
        .expect("rich shared-string state should be JSON-serializable");
    cell_map.insert(txn, KEY_RICH_STRING, Any::String(Arc::from(json)));
}

/// Read cell-owned rich shared-string state from a yrs cell map.
pub fn read_rich_string_from_yrs<T: yrs::ReadTxn>(
    cell_map: &MapRef,
    txn: &T,
) -> Option<domain_types::RichSharedString> {
    match cell_map.get(txn, KEY_RICH_STRING) {
        Some(Out::Any(Any::String(json))) => serde_json::from_str(&json).ok(),
        _ => None,
    }
}

/// Write identity formula fields into an existing yrs cell map.
pub fn write_identity_formula_to_yrs(
    cell_map: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    idf: &IdentityFormula,
) -> Result<(), DocumentError> {
    cell_map.insert(
        txn,
        KEY_FORMULA_TEMPLATE,
        Any::String(Arc::from(idf.template.as_str())),
    );
    cell_map.insert(
        txn,
        KEY_FORMULA_REFS,
        Any::String(Arc::from(identity_refs_to_json(&idf.refs)?.as_str())),
    );
    if idf.is_dynamic_array {
        cell_map.insert(txn, KEY_FORMULA_DYNAMIC_ARRAY, Any::Bool(true));
    }
    if idf.is_volatile {
        cell_map.insert(txn, KEY_FORMULA_VOLATILE, Any::Bool(true));
    }
    if idf.is_aggregate {
        cell_map.insert(txn, KEY_FORMULA_AGGREGATE, Any::Bool(true));
    }
    Ok(())
}

/// Convert a [`CellValue`] to a `yrs::Any` for storage.
pub fn cell_value_to_any(value: &CellValue) -> Any {
    match value {
        CellValue::Number(n) => Any::Number(n.get()),
        CellValue::Text(s) => Any::String(Arc::clone(s)),
        CellValue::Boolean(b) => Any::Bool(*b),
        CellValue::Null => Any::Null,
        CellValue::Error(e, _) => Any::String(Arc::from(e.as_str())),
        CellValue::Array(_) => Any::String(Arc::from(format!("{}", value).as_str())),
        CellValue::Control(c) => Any::Bool(c.value),
        CellValue::Image(image) => Any::String(Arc::from(image.fallback_text())),
    }
}

/// Read a cell value from a yrs cell map.
pub fn yrs_any_to_cell_value<T: yrs::ReadTxn>(cell_map: &MapRef, txn: &T) -> CellValue {
    match cell_map.get(txn, KEY_VALUE) {
        Some(Out::Any(Any::Number(n))) => CellValue::number(n),
        Some(Out::Any(Any::String(s))) => {
            if let Some(err) = value_types::CellError::parse_error_str(&s) {
                CellValue::Error(err, None)
            } else {
                CellValue::Text(Arc::clone(&s))
            }
        }
        Some(Out::Any(Any::Bool(b))) => CellValue::Boolean(b),
        Some(Out::Any(Any::Null)) | Some(Out::Any(Any::Undefined)) => CellValue::Null,
        _ => CellValue::Null,
    }
}

/// Read an [`IdentityFormula`] from yrs cell map.
pub fn read_identity_formula_from_yrs<T: yrs::ReadTxn>(
    cell_map: &MapRef,
    txn: &T,
) -> Option<IdentityFormula> {
    let template = match cell_map.get(txn, KEY_FORMULA_TEMPLATE) {
        Some(Out::Any(Any::String(s))) => s.to_string(),
        _ => return None,
    };
    let refs_json = match cell_map.get(txn, KEY_FORMULA_REFS) {
        Some(Out::Any(Any::String(s))) => s.to_string(),
        _ => return None,
    };
    let refs = identity_refs_from_json(&refs_json)?;
    let is_dynamic_array = matches!(
        cell_map.get(txn, KEY_FORMULA_DYNAMIC_ARRAY),
        Some(Out::Any(Any::Bool(true)))
    );
    let is_volatile = matches!(
        cell_map.get(txn, KEY_FORMULA_VOLATILE),
        Some(Out::Any(Any::Bool(true)))
    );
    let is_aggregate = matches!(
        cell_map.get(txn, KEY_FORMULA_AGGREGATE),
        Some(Out::Any(Any::Bool(true)))
    );
    Some(IdentityFormula {
        template,
        refs,
        is_dynamic_array,
        is_volatile,
        is_aggregate,
    })
}

/// Serialize refs to JSON.
pub fn identity_refs_to_json(refs: &[IdentityFormulaRef]) -> Result<String, DocumentError> {
    serde_json::to_string(refs).map_err(|e| {
        DocumentError::CellSerialization(format!("IdentityFormulaRef serialization failed: {e}"))
    })
}

/// Deserialize refs from JSON.
pub fn identity_refs_from_json(json: &str) -> Option<Vec<IdentityFormulaRef>> {
    serde_json::from_str(json).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::CellId;
    use formula_types::{IdentityCellRef, IdentityFormulaRef, IdentityRangeRef};
    use value_types::{CellError, CellValue};
    use yrs::{Any, Doc, Map, Transact};

    // ── Helpers ─────────────────────────────────────────────────────

    /// Insert a single Any value under "v" in a fresh yrs doc, then read it back.
    fn roundtrip_via_yrs(any_val: Any) -> CellValue {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, KEY_VALUE, any_val);
        }
        let txn = doc.transact();
        yrs_any_to_cell_value(&map, &txn)
    }

    /// Read from an empty yrs map (no "v" key).
    fn read_empty_map() -> CellValue {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        let txn = doc.transact();
        yrs_any_to_cell_value(&map, &txn)
    }

    // ── 1. cell_value_to_any ────────────────────────────────────────

    #[test]
    fn to_any_number_zero() {
        let v = CellValue::number(0.0);
        match cell_value_to_any(&v) {
            Any::Number(n) => assert_eq!(n, 0.0),
            other => panic!("expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn to_any_number_positive_integer() {
        let v = CellValue::number(42.0);
        match cell_value_to_any(&v) {
            Any::Number(n) => assert_eq!(n, 42.0),
            other => panic!("expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn to_any_number_negative() {
        let v = CellValue::number(-3.14);
        match cell_value_to_any(&v) {
            Any::Number(n) => assert!((n - (-3.14)).abs() < f64::EPSILON),
            other => panic!("expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn to_any_number_fractional() {
        let v = CellValue::number(0.1);
        match cell_value_to_any(&v) {
            Any::Number(n) => assert_eq!(n, 0.1),
            other => panic!("expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn to_any_number_very_large() {
        let v = CellValue::number(1e300);
        match cell_value_to_any(&v) {
            Any::Number(n) => assert_eq!(n, 1e300),
            other => panic!("expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn to_any_number_very_small() {
        let v = CellValue::number(5e-324);
        match cell_value_to_any(&v) {
            Any::Number(n) => assert_eq!(n, 5e-324),
            other => panic!("expected Any::Number, got {:?}", other),
        }
    }

    #[test]
    fn to_any_text_normal() {
        let v = CellValue::Text(Arc::from("hello"));
        match cell_value_to_any(&v) {
            Any::String(s) => assert_eq!(&*s, "hello"),
            other => panic!("expected Any::String, got {:?}", other),
        }
    }

    #[test]
    fn to_any_text_empty() {
        let v = CellValue::Text(Arc::from(""));
        match cell_value_to_any(&v) {
            Any::String(s) => assert_eq!(&*s, ""),
            other => panic!("expected Any::String, got {:?}", other),
        }
    }

    #[test]
    fn to_any_text_that_looks_like_error() {
        // A Text value whose string content is "#DIV/0!" should still be serialized
        // as Any::String — the type is Text, not Error.
        let v = CellValue::Text(Arc::from("#DIV/0!"));
        match cell_value_to_any(&v) {
            Any::String(s) => assert_eq!(&*s, "#DIV/0!"),
            other => panic!("expected Any::String, got {:?}", other),
        }
    }

    #[test]
    fn to_any_boolean_true() {
        let v = CellValue::Boolean(true);
        assert_eq!(cell_value_to_any(&v), Any::Bool(true));
    }

    #[test]
    fn to_any_boolean_false() {
        let v = CellValue::Boolean(false);
        assert_eq!(cell_value_to_any(&v), Any::Bool(false));
    }

    #[test]
    fn to_any_null() {
        let v = CellValue::Null;
        assert_eq!(cell_value_to_any(&v), Any::Null);
    }

    #[test]
    fn to_any_error_all_variants() {
        let errors = [
            (CellError::Div0, "#DIV/0!"),
            (CellError::Na, "#N/A"),
            (CellError::Name, "#NAME?"),
            (CellError::Null, "#NULL!"),
            (CellError::Num, "#NUM!"),
            (CellError::Ref, "#REF!"),
            (CellError::Value, "#VALUE!"),
            (CellError::Spill, "#SPILL!"),
            (CellError::Calc, "#CALC!"),
            (CellError::GettingData, "#GETTING_DATA"),
        ];
        for (err, expected_str) in &errors {
            let v = CellValue::Error(*err, None);
            match cell_value_to_any(&v) {
                Any::String(s) => assert_eq!(&*s, *expected_str, "error {:?}", err),
                other => panic!("expected Any::String for {:?}, got {:?}", err, other),
            }
        }
    }

    // ── 2. yrs_any_to_cell_value round-trip via yrs map ─────────────

    #[test]
    fn roundtrip_number_integer() {
        let result = roundtrip_via_yrs(Any::Number(42.0));
        assert_eq!(result, CellValue::number(42.0));
    }

    #[test]
    fn roundtrip_number_negative() {
        let result = roundtrip_via_yrs(Any::Number(-99.5));
        assert_eq!(result, CellValue::number(-99.5));
    }

    #[test]
    fn roundtrip_number_zero() {
        let result = roundtrip_via_yrs(Any::Number(0.0));
        assert_eq!(result, CellValue::number(0.0));
    }

    #[test]
    fn roundtrip_number_nan_becomes_error() {
        // NaN stored as Any::Number should come back as Error(Num) because
        // CellValue::number(NaN) returns Error(Num).
        let result = roundtrip_via_yrs(Any::Number(f64::NAN));
        assert_eq!(result, CellValue::Error(CellError::Num, None));
    }

    #[test]
    fn roundtrip_number_infinity_becomes_error() {
        let result = roundtrip_via_yrs(Any::Number(f64::INFINITY));
        assert_eq!(result, CellValue::Error(CellError::Num, None));
    }

    #[test]
    fn roundtrip_string_normal_text() {
        let result = roundtrip_via_yrs(Any::String(Arc::from("hello world")));
        assert_eq!(result, CellValue::Text(Arc::from("hello world")));
    }

    #[test]
    fn roundtrip_string_empty() {
        let result = roundtrip_via_yrs(Any::String(Arc::from("")));
        assert_eq!(result, CellValue::Text(Arc::from("")));
    }

    #[test]
    fn roundtrip_string_error_div0() {
        // A string that IS an error string should be parsed as CellValue::Error
        let result = roundtrip_via_yrs(Any::String(Arc::from("#DIV/0!")));
        assert_eq!(result, CellValue::Error(CellError::Div0, None));
    }

    #[test]
    fn roundtrip_string_error_na() {
        let result = roundtrip_via_yrs(Any::String(Arc::from("#N/A")));
        assert_eq!(result, CellValue::Error(CellError::Na, None));
    }

    #[test]
    fn roundtrip_string_error_value() {
        let result = roundtrip_via_yrs(Any::String(Arc::from("#VALUE!")));
        assert_eq!(result, CellValue::Error(CellError::Value, None));
    }

    #[test]
    fn roundtrip_string_not_an_error() {
        // Strings that look like errors but aren't valid should stay as Text
        let result = roundtrip_via_yrs(Any::String(Arc::from("#UNKNOWN!")));
        assert_eq!(result, CellValue::Text(Arc::from("#UNKNOWN!")));
    }

    #[test]
    fn roundtrip_string_partial_error() {
        // "#DIV" is not a valid error string
        let result = roundtrip_via_yrs(Any::String(Arc::from("#DIV")));
        assert_eq!(result, CellValue::Text(Arc::from("#DIV")));
    }

    #[test]
    fn roundtrip_bool_true() {
        let result = roundtrip_via_yrs(Any::Bool(true));
        assert_eq!(result, CellValue::Boolean(true));
    }

    #[test]
    fn roundtrip_bool_false() {
        let result = roundtrip_via_yrs(Any::Bool(false));
        assert_eq!(result, CellValue::Boolean(false));
    }

    #[test]
    fn roundtrip_null() {
        let result = roundtrip_via_yrs(Any::Null);
        assert_eq!(result, CellValue::Null);
    }

    #[test]
    fn roundtrip_undefined() {
        let result = roundtrip_via_yrs(Any::Undefined);
        assert_eq!(result, CellValue::Null);
    }

    #[test]
    fn read_missing_v_key_returns_null() {
        let result = read_empty_map();
        assert_eq!(result, CellValue::Null);
    }

    // ── Full cell_value round-trip: CellValue → Any → yrs → CellValue ──

    #[test]
    fn full_roundtrip_number() {
        let original = CellValue::number(123.456);
        let any = cell_value_to_any(&original);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, KEY_VALUE, any);
        }
        let txn = doc.transact();
        let recovered = yrs_any_to_cell_value(&map, &txn);
        assert_eq!(recovered, original);
    }

    #[test]
    fn full_roundtrip_text() {
        let original = CellValue::Text(Arc::from("spreadsheet data"));
        let any = cell_value_to_any(&original);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, KEY_VALUE, any);
        }
        let txn = doc.transact();
        let recovered = yrs_any_to_cell_value(&map, &txn);
        assert_eq!(recovered, original);
    }

    #[test]
    fn full_roundtrip_boolean() {
        for b in [true, false] {
            let original = CellValue::Boolean(b);
            let any = cell_value_to_any(&original);
            let doc = Doc::new();
            let map = doc.get_or_insert_map("test");
            {
                let mut txn = doc.transact_mut();
                map.insert(&mut txn, KEY_VALUE, any);
            }
            let txn = doc.transact();
            let recovered = yrs_any_to_cell_value(&map, &txn);
            assert_eq!(recovered, original);
        }
    }

    #[test]
    fn full_roundtrip_null() {
        let original = CellValue::Null;
        let any = cell_value_to_any(&original);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, KEY_VALUE, any);
        }
        let txn = doc.transact();
        let recovered = yrs_any_to_cell_value(&map, &txn);
        assert_eq!(recovered, original);
    }

    #[test]
    fn full_roundtrip_error_all_variants() {
        // Errors round-trip through their string representation.
        // Note: Circ and Ref both serialize to "#REF!" so Circ round-trips as Ref.
        let errors = [
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
            CellError::Spill,
            CellError::Calc,
            CellError::GettingData,
        ];
        for err in &errors {
            let original = CellValue::Error(*err, None);
            let any = cell_value_to_any(&original);
            let doc = Doc::new();
            let map = doc.get_or_insert_map("test");
            {
                let mut txn = doc.transact_mut();
                map.insert(&mut txn, KEY_VALUE, any);
            }
            let txn = doc.transact();
            let recovered = yrs_any_to_cell_value(&map, &txn);
            assert_eq!(recovered, original, "error {:?} did not round-trip", err);
        }
    }

    #[test]
    fn full_roundtrip_circ_becomes_ref() {
        // Circ.as_str() == "#REF!", and "#REF!" parses as Ref (not Circ).
        // So Circ cannot round-trip — this is expected and by design.
        let original = CellValue::Error(CellError::Circ, None);
        let any = cell_value_to_any(&original);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, KEY_VALUE, any);
        }
        let txn = doc.transact();
        let recovered = yrs_any_to_cell_value(&map, &txn);
        // Circ serializes as "#REF!" which deserializes as Ref
        assert_eq!(recovered, CellValue::Error(CellError::Ref, None));
    }

    // ── 3. build_cell_prelim ────────────────────────────────────────

    #[test]
    fn build_cell_prelim_value_only() {
        let prelim = build_cell_prelim(&CellValue::number(10.0), None, None);
        // Insert it into a yrs doc to verify the keys
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, "cell", prelim);
        }
        let txn = doc.transact();
        // The prelim should have created a nested map at "cell"
        let cell_map = map.get(&txn, "cell").expect("cell key should exist");
        // We can't directly inspect MapPrelim, but by inserting into yrs
        // we can verify the nested map has "v" and no "f"
        if let yrs::Out::YMap(nested) = cell_map {
            assert!(nested.get(&txn, KEY_VALUE).is_some(), "should have 'v' key");
            assert!(
                nested.get(&txn, KEY_FORMULA).is_none(),
                "should NOT have 'f' key"
            );
        } else {
            panic!("expected nested map");
        }
    }

    #[test]
    fn build_cell_prelim_with_formula() {
        let prelim = build_cell_prelim(&CellValue::number(10.0), Some("=A1+B1"), None);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(&mut txn, "cell", prelim);
        }
        let txn = doc.transact();
        let cell_map = map.get(&txn, "cell").expect("cell key should exist");
        if let yrs::Out::YMap(nested) = cell_map {
            assert!(nested.get(&txn, KEY_VALUE).is_some(), "should have 'v' key");
            match nested.get(&txn, KEY_FORMULA) {
                Some(yrs::Out::Any(Any::String(s))) => {
                    assert_eq!(&*s, "=A1+B1");
                }
                other => panic!("expected formula string, got {:?}", other),
            }
        } else {
            panic!("expected nested map");
        }
    }

    // ── 4. Identity formula round-trip via yrs ──────────────────────

    fn make_test_identity_formula(dynamic: bool, volatile: bool) -> IdentityFormula {
        make_test_identity_formula_full(dynamic, volatile, false)
    }

    fn make_test_identity_formula_full(
        dynamic: bool,
        volatile: bool,
        aggregate: bool,
    ) -> IdentityFormula {
        IdentityFormula {
            template: "SUM({0})+{1}".to_string(),
            refs: vec![
                IdentityFormulaRef::Range(IdentityRangeRef {
                    start_id: CellId::from_raw(10),
                    end_id: CellId::from_raw(20),
                    start_row_absolute: false,
                    start_col_absolute: false,
                    end_row_absolute: false,
                    end_col_absolute: false,
                }),
                IdentityFormulaRef::Cell(IdentityCellRef {
                    id: CellId::from_raw(30),
                    row_absolute: true,
                    col_absolute: false,
                }),
            ],
            is_dynamic_array: dynamic,
            is_volatile: volatile,
            is_aggregate: aggregate,
        }
    }

    #[test]
    fn identity_formula_roundtrip_with_flags() {
        let idf = make_test_identity_formula(true, true);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            write_identity_formula_to_yrs(&map, &mut txn, &idf).unwrap();
        }
        let txn = doc.transact();
        let recovered =
            read_identity_formula_from_yrs(&map, &txn).expect("should recover identity formula");
        assert_eq!(recovered.template, idf.template);
        assert_eq!(recovered.refs, idf.refs);
        assert!(recovered.is_dynamic_array);
        assert!(recovered.is_volatile);
    }

    #[test]
    fn identity_formula_roundtrip_without_flags() {
        let idf = make_test_identity_formula(false, false);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            write_identity_formula_to_yrs(&map, &mut txn, &idf).unwrap();
        }
        let txn = doc.transact();
        let recovered =
            read_identity_formula_from_yrs(&map, &txn).expect("should recover identity formula");
        assert_eq!(recovered.template, idf.template);
        assert_eq!(recovered.refs, idf.refs);
        assert!(!recovered.is_dynamic_array);
        assert!(!recovered.is_volatile);
    }

    #[test]
    fn identity_formula_roundtrip_dynamic_only() {
        let idf = make_test_identity_formula(true, false);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            write_identity_formula_to_yrs(&map, &mut txn, &idf).unwrap();
        }
        let txn = doc.transact();
        let recovered = read_identity_formula_from_yrs(&map, &txn).unwrap();
        assert!(recovered.is_dynamic_array);
        assert!(!recovered.is_volatile);
    }

    #[test]
    fn identity_formula_roundtrip_volatile_only() {
        let idf = make_test_identity_formula(false, true);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            write_identity_formula_to_yrs(&map, &mut txn, &idf).unwrap();
        }
        let txn = doc.transact();
        let recovered = read_identity_formula_from_yrs(&map, &txn).unwrap();
        assert!(!recovered.is_dynamic_array);
        assert!(recovered.is_volatile);
    }

    #[test]
    fn identity_formula_roundtrip_aggregate_true() {
        // Typed formula boundary: is_aggregate survives a Yrs round-trip independently
        // of the other flags.
        let idf = make_test_identity_formula_full(false, false, true);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            write_identity_formula_to_yrs(&map, &mut txn, &idf).unwrap();
        }
        let txn = doc.transact();
        let recovered = read_identity_formula_from_yrs(&map, &txn).unwrap();
        assert!(recovered.is_aggregate);
        assert!(!recovered.is_dynamic_array);
        assert!(!recovered.is_volatile);
    }

    #[test]
    fn identity_formula_roundtrip_all_flags() {
        // All three flags survive a round-trip together.
        let idf = make_test_identity_formula_full(true, true, true);
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            write_identity_formula_to_yrs(&map, &mut txn, &idf).unwrap();
        }
        let txn = doc.transact();
        let recovered = read_identity_formula_from_yrs(&map, &txn).unwrap();
        assert!(recovered.is_dynamic_array);
        assert!(recovered.is_volatile);
        assert!(recovered.is_aggregate);
    }

    #[test]
    fn read_identity_formula_legacy_yrs_defaults_aggregate_false() {
        // Pre-W7 Yrs documents never wrote KEY_FORMULA_AGGREGATE. Reading
        // such a map must default is_aggregate to false (matching the
        // #[serde(default)] on the struct).
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            // Write a minimal formula map without KEY_FORMULA_AGGREGATE.
            map.insert(
                &mut txn,
                KEY_FORMULA_TEMPLATE,
                Any::String(std::sync::Arc::from("SUM({0})")),
            );
            map.insert(
                &mut txn,
                KEY_FORMULA_REFS,
                Any::String(std::sync::Arc::from("[]")),
            );
        }
        let txn = doc.transact();
        let recovered = read_identity_formula_from_yrs(&map, &txn).unwrap();
        assert!(!recovered.is_aggregate);
        assert!(!recovered.is_dynamic_array);
        assert!(!recovered.is_volatile);
    }

    #[test]
    fn read_identity_formula_from_empty_map_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        let txn = doc.transact();
        assert!(read_identity_formula_from_yrs(&map, &txn).is_none());
    }

    #[test]
    fn read_identity_formula_missing_refs_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            // Write template but not refs
            map.insert(
                &mut txn,
                KEY_FORMULA_TEMPLATE,
                Any::String(Arc::from("SUM({0})")),
            );
        }
        let txn = doc.transact();
        assert!(read_identity_formula_from_yrs(&map, &txn).is_none());
    }

    #[test]
    fn read_identity_formula_missing_template_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            // Write refs but not template
            map.insert(&mut txn, KEY_FORMULA_REFS, Any::String(Arc::from("[]")));
        }
        let txn = doc.transact();
        assert!(read_identity_formula_from_yrs(&map, &txn).is_none());
    }

    #[test]
    fn read_identity_formula_invalid_refs_json_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            map.insert(
                &mut txn,
                KEY_FORMULA_TEMPLATE,
                Any::String(Arc::from("{0}+1")),
            );
            map.insert(
                &mut txn,
                KEY_FORMULA_REFS,
                Any::String(Arc::from("not valid json")),
            );
        }
        let txn = doc.transact();
        assert!(read_identity_formula_from_yrs(&map, &txn).is_none());
    }

    // ── 5. identity_refs JSON round-trip ────────────────────────────

    #[test]
    fn refs_json_roundtrip_empty() {
        let refs: Vec<IdentityFormulaRef> = vec![];
        let json = identity_refs_to_json(&refs).unwrap();
        let recovered = identity_refs_from_json(&json).expect("should parse");
        assert!(recovered.is_empty());
    }

    #[test]
    fn refs_json_roundtrip_single_cell() {
        let refs = vec![IdentityFormulaRef::Cell(IdentityCellRef {
            id: CellId::from_raw(42),
            row_absolute: false,
            col_absolute: true,
        })];
        let json = identity_refs_to_json(&refs).unwrap();
        let recovered = identity_refs_from_json(&json).expect("should parse");
        assert_eq!(recovered, refs);
    }

    #[test]
    fn refs_json_roundtrip_multiple_mixed() {
        let refs = vec![
            IdentityFormulaRef::Cell(IdentityCellRef {
                id: CellId::from_raw(1),
                row_absolute: false,
                col_absolute: false,
            }),
            IdentityFormulaRef::Range(IdentityRangeRef {
                start_id: CellId::from_raw(10),
                end_id: CellId::from_raw(20),
                start_row_absolute: true,
                start_col_absolute: true,
                end_row_absolute: true,
                end_col_absolute: true,
            }),
        ];
        let json = identity_refs_to_json(&refs).unwrap();
        let recovered = identity_refs_from_json(&json).expect("should parse");
        assert_eq!(recovered, refs);
    }

    #[test]
    fn refs_json_invalid_returns_none() {
        assert!(identity_refs_from_json("not json").is_none());
    }

    #[test]
    fn refs_json_empty_string_returns_none() {
        assert!(identity_refs_from_json("").is_none());
    }

    #[test]
    fn refs_json_wrong_type_returns_none() {
        // Valid JSON but wrong shape
        assert!(identity_refs_from_json(r#"{"key": "value"}"#).is_none());
    }
}
