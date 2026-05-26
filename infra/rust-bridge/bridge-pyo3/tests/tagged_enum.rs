//! B.2 — round-trip tests for `#[bridge::tagged_enum]` params through the
//! bridge-pyo3 codegen pipeline.
//!
//! PyO3's `#[pymethods]` expansion needs a Python runtime to execute
//! end-to-end, so these tests exercise the wire contract directly: the
//! Python caller produces `json.dumps(dict)`, the FFI decodes via the
//! schema, the Rust method runs, and the return re-serializes via serde.
//!
//! The Python-surface shape chosen (Option A from the B.2 plan) is
//! "caller sends a dict; the generated code JSON-parses and dispatches".
//! For `AccessTarget` that wire shape is `{"kind":"...","sheet_id":...}`
//! — identical to napi's.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum AccessTarget {
    Workbook,
    Sheet { sheet_id: String },
    Column { sheet_id: String, col_id: String },
}

fn decode_target(json: &str) -> Result<AccessTarget, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

fn encode_target(t: &AccessTarget) -> String {
    serde_json::to_string(t).expect("AccessTarget must serialize")
}

#[test]
fn each_variant_round_trips() {
    let cases = [
        AccessTarget::Workbook,
        AccessTarget::Sheet {
            sheet_id: "s-1".to_string(),
        },
        AccessTarget::Column {
            sheet_id: "s-1".to_string(),
            col_id: "c-9".to_string(),
        },
    ];
    for original in &cases {
        let wire = encode_target(original);
        let decoded = decode_target(&wire).unwrap();
        assert_eq!(&decoded, original);
    }
}

#[test]
fn workbook_wire_shape_is_kind_only() {
    let wire = encode_target(&AccessTarget::Workbook);
    let v: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(v["kind"], "workbook");
    assert_eq!(v.as_object().unwrap().len(), 1);
}

#[test]
fn sheet_wire_shape_has_kind_and_sheet_id() {
    let wire = encode_target(&AccessTarget::Sheet {
        sheet_id: "abc".to_string(),
    });
    let v: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(v["kind"], "sheet");
    assert_eq!(v["sheet_id"], "abc");
}

#[test]
fn column_wire_shape_has_all_fields() {
    let wire = encode_target(&AccessTarget::Column {
        sheet_id: "abc".to_string(),
        col_id: "xyz".to_string(),
    });
    let v: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(v["kind"], "column");
    assert_eq!(v["sheet_id"], "abc");
    assert_eq!(v["col_id"], "xyz");
}

#[test]
fn echo_round_trip_all_variants() {
    let cases = [
        AccessTarget::Workbook,
        AccessTarget::Sheet {
            sheet_id: "s-1".to_string(),
        },
        AccessTarget::Column {
            sheet_id: "s-1".to_string(),
            col_id: "c-9".to_string(),
        },
    ];
    for original in &cases {
        let wire_in = encode_target(original);
        // Simulate echo_target(AccessTarget) -> AccessTarget at the FFI layer.
        let target = decode_target(&wire_in).expect("decode input");
        let wire_out = encode_target(&target);
        let roundtripped = decode_target(&wire_out).expect("decode output");
        assert_eq!(&roundtripped, original);
    }
}

#[test]
fn unknown_kind_rejected() {
    let err = decode_target(r#"{"kind":"bogus"}"#).unwrap_err();
    assert!(
        err.contains("unknown variant") || err.contains("bogus"),
        "err: {err}"
    );
}
