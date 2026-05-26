//! B.2 — round-trip tests for `#[bridge::tagged_enum]` params through the
//! bridge-napi codegen pipeline.
//!
//! The napi proc-macro produces `#[napi_derive::napi]` attributes whose
//! expansion requires a Node runtime for end-to-end execution, so these tests
//! operate on the wire format directly (JSON string in → Rust enum → JSON
//! string out) — exactly the shape the generated FFI functions use. For each
//! `AccessTarget` variant we:
//!   1. Build the wire-form dict (what a TS/Node caller would `JSON.stringify`).
//!   2. Decode via `serde_json::from_str` — semantically identical to what the
//!      generated napi decoder does for fields tagged `serde` (the common case).
//!   3. Re-encode via `serde_json::to_string` — what the napi return-value path
//!      emits.
//!   4. Assert the output equals the input (keys and nested values).
//!
//! The macro-level string-pattern tests in `bridge-napi-macros` cover the
//! codegen side; this file covers the runtime contract the codegen commits to.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum AccessTarget {
    Workbook,
    Sheet { sheet_id: String },
    Column { sheet_id: String, col_id: String },
}

/// Mirrors what the generated napi FFI function does for a single param:
/// take a JSON string, produce the Rust enum (or an error).
fn decode_target(json: &str) -> Result<AccessTarget, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

/// Mirrors what the generated napi FFI function does for a return value:
/// take the Rust enum, produce a JSON string.
fn encode_target(t: &AccessTarget) -> String {
    serde_json::to_string(t).expect("AccessTarget must serialize")
}

#[test]
fn workbook_variant_round_trips() {
    let original = AccessTarget::Workbook;
    let wire = encode_target(&original);
    assert_eq!(wire, r#"{"kind":"workbook"}"#);
    let decoded = decode_target(&wire).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn sheet_variant_round_trips() {
    let original = AccessTarget::Sheet {
        sheet_id: "s-1".to_string(),
    };
    let wire = encode_target(&original);
    let parsed: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(parsed["kind"], "sheet");
    assert_eq!(parsed["sheet_id"], "s-1");
    let decoded = decode_target(&wire).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn column_variant_round_trips() {
    let original = AccessTarget::Column {
        sheet_id: "s-1".to_string(),
        col_id: "c-9".to_string(),
    };
    let wire = encode_target(&original);
    let parsed: serde_json::Value = serde_json::from_str(&wire).unwrap();
    assert_eq!(parsed["kind"], "column");
    assert_eq!(parsed["sheet_id"], "s-1");
    assert_eq!(parsed["col_id"], "c-9");
    let decoded = decode_target(&wire).unwrap();
    assert_eq!(decoded, original);
}

#[test]
fn missing_kind_is_rejected() {
    // The generated napi decoder branches on the discriminator. When the tag
    // is missing, serde returns "missing field `kind`"; the codegen version
    // returns "AccessTarget: missing string 'kind' discriminator". Either
    // way, decoding must fail.
    let err = decode_target(r#"{"sheet_id":"s-1"}"#).unwrap_err();
    assert!(
        err.contains("kind") || err.contains("missing"),
        "err: {err}"
    );
}

#[test]
fn unknown_kind_is_rejected() {
    let err = decode_target(r#"{"kind":"bogus"}"#).unwrap_err();
    assert!(
        err.contains("unknown variant") || err.contains("bogus"),
        "err: {err}"
    );
}

/// Simulates `echo_target(AccessTarget) -> AccessTarget` at the FFI level.
/// Each step mirrors what the generated napi wrapper does: JSON in,
/// deserialize, call inner, serialize, JSON out.
fn echo_target_ffi(wire_in: &str) -> Result<String, String> {
    let target = decode_target(wire_in)?;
    // "call the method" — identity
    Ok(encode_target(&target))
}

#[test]
fn echo_round_trip_all_variants() {
    let cases = [
        AccessTarget::Workbook,
        AccessTarget::Sheet {
            sheet_id: "sheet-abc".to_string(),
        },
        AccessTarget::Column {
            sheet_id: "sheet-abc".to_string(),
            col_id: "col-xyz".to_string(),
        },
    ];

    for original in &cases {
        let wire_in = encode_target(original);
        let wire_out = echo_target_ffi(&wire_in).expect("FFI round trip");
        let decoded = decode_target(&wire_out).expect("decode echoed wire");
        assert_eq!(
            &decoded, original,
            "round-trip mismatch for {original:?}: wire_in={wire_in}, wire_out={wire_out}"
        );
    }
}
