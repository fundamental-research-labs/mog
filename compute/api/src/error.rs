//! Rich error types for compute-api.
//!
//! `ComputeApiError` wraps `ComputeError` from the engine and adds
//! facade-level error variants (address validation, sheet lookup, etc.).
//!
//! `ComputeApiError` implements [`bridge_types::BridgeStructuredError`] so the
//! bridge macros (WASM,
//! NAPI, Tauri) emit the **same** tagged-JSON envelope across every
//! transport: `[BRIDGE_ERROR]{"kind":"...","message":"...", ...}`. The
//! TS-side discriminated union (`kernel/src/types/bridge-error.ts`)
//! mirrors this shape exactly.

use compute_security::{AccessLevel, AccessTarget, SecurityError};
use value_types::ComputeError;

/// Wire-friendly access target for SDK bindings. Mirrors
/// `compute_security::AccessTarget` but renders UUIDs as strings so the
/// shape crosses NAPI/PyO3/WASM without a typed-enum codegen round-trip
/// (that codegen lands in B.2 for the policy-add/list paths — the error
/// path doesn't need it yet).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccessTargetWire {
    /// Whole-workbook scope.
    Workbook,
    /// A single sheet.
    Sheet {
        /// Sheet UUID as hex.
        sheet_id: String,
    },
    /// A single column on a sheet.
    Column {
        /// Sheet UUID as hex.
        sheet_id: String,
        /// Column UUID as hex.
        col_id: String,
    },
}

impl From<AccessTarget> for AccessTargetWire {
    fn from(t: AccessTarget) -> Self {
        match t {
            AccessTarget::Workbook => AccessTargetWire::Workbook,
            AccessTarget::Sheet { sheet_id } => AccessTargetWire::Sheet {
                sheet_id: sheet_id.to_uuid_string(),
            },
            AccessTarget::Column { sheet_id, col_id } => AccessTargetWire::Column {
                sheet_id: sheet_id.to_uuid_string(),
                col_id: col_id.to_uuid_string(),
            },
        }
    }
}

/// Error type for all compute-api operations.
#[derive(Debug, thiserror::Error)]
pub enum ComputeApiError {
    /// Sheet ID was not found in the workbook.
    #[error("sheet not found: {id}")]
    SheetNotFound { id: String },

    /// Invalid A1 address string (e.g., malformed column letters, row out of range).
    #[error("invalid address: {address} — {reason}")]
    InvalidAddress { address: String, reason: String },

    /// Invalid range specification.
    #[error("invalid range: {range} — {reason}")]
    InvalidRange { range: String, reason: String },

    /// Operation not valid in current state (e.g., writing to a protected sheet).
    #[error("invalid operation: {0}")]
    InvalidOperation(String),

    /// Engine returned a cell-level error.
    #[error("cell error: {0:?}")]
    CellError(value_types::CellError),

    /// The engine thread has shut down (channel disconnected).
    #[error("engine shut down")]
    EngineShutdown,

    /// Failed to spawn the engine thread (resource exhaustion).
    #[error("failed to spawn compute-engine thread: {0}")]
    ThreadSpawn(#[from] std::io::Error),

    /// Access denied by the privacy policy engine (R3.3). Both SDK
    /// bindings surface this as a typed exception class via the
    /// `#[bridge::api]` machinery.
    ///
    /// Constructed from a `SecurityError::Denied` via `From` — the
    /// caller (delegate macro) produces a `ComputeError::SecurityDenied`
    /// payload with flat strings, and the `From<ComputeError>` impl
    /// re-hydrates those into this typed shape when the error crosses
    /// into compute-api.
    #[error(
        "security denied: principal [{principal_tags:?}] lacks {required:?} access to {target:?} (actual: {actual:?}, operation: {operation})"
    )]
    SecurityDenied {
        /// Tag list from the principal that was denied.
        principal_tags: Vec<String>,
        /// Target the principal tried to reach.
        target: AccessTargetWire,
        /// Required access level.
        required: AccessLevel,
        /// Effective access level the caller actually had.
        actual: AccessLevel,
        /// Engine method label for diagnostics (bridge method name).
        operation: String,
    },

    /// Wrapped error from the underlying compute engine.
    #[error(transparent)]
    Compute(#[from] ComputeError),
}

// Bridge tagged-error contract.
//
// `ComputeApiError` is the type returned by every `#[bridge::api]` method
// on `ComputeService`, so its `to_bridge_value` defines the wire shape
// the TS `BridgeError` discriminated union must mirror.
//
// Variants are camelCase-fielded; the discriminator is `kind` and uses
// the variant name as PascalCase. `Compute(ComputeError)` flattens —
// the inner `ComputeError`'s tagged shape passes through unchanged so
// callers don't need to peel a wrapper.
impl bridge_types::BridgeError for ComputeApiError {}

impl bridge_types::BridgeStructuredError for ComputeApiError {
    fn to_bridge_value(&self) -> serde_json::Value {
        match self {
            // Pass-through: the inner ComputeError's tagged shape is
            // already the wire contract. No "ComputeApiError::Compute"
            // wrapper appears on the wire.
            ComputeApiError::Compute(inner) => {
                <ComputeError as bridge_types::BridgeStructuredError>::to_bridge_value(inner)
            }
            ComputeApiError::SheetNotFound { id } => serde_json::json!({
                "kind": "SheetNotFound",
                "message": self.to_string(),
                "id": id,
            }),
            ComputeApiError::InvalidAddress { address, reason } => serde_json::json!({
                "kind": "InvalidAddress",
                "message": self.to_string(),
                "address": address,
                "reason": reason,
            }),
            ComputeApiError::InvalidRange { range, reason } => serde_json::json!({
                "kind": "InvalidRange",
                "message": self.to_string(),
                "range": range,
                "reason": reason,
            }),
            ComputeApiError::InvalidOperation(msg) => serde_json::json!({
                "kind": "InvalidOperation",
                "message": msg,
            }),
            ComputeApiError::CellError(err) => serde_json::json!({
                "kind": "CellError",
                "message": self.to_string(),
                "error": err.as_str(),
            }),
            ComputeApiError::EngineShutdown => serde_json::json!({
                "kind": "EngineShutdown",
                "message": self.to_string(),
            }),
            ComputeApiError::ThreadSpawn(io_err) => serde_json::json!({
                "kind": "ThreadSpawn",
                "message": io_err.to_string(),
            }),
            ComputeApiError::SecurityDenied {
                principal_tags,
                target,
                required,
                actual,
                operation,
            } => serde_json::json!({
                "kind": "SecurityDenied",
                "message": self.to_string(),
                "principalTags": principal_tags,
                "target": target,
                "required": required,
                "actual": actual,
                "operation": operation,
            }),
        }
    }
}

/// Direct conversion for callers that surface `SecurityError` without a
/// detour through `ComputeError` (e.g. policy-CRUD methods that
/// short-circuit on attenuation).
impl From<SecurityError> for ComputeApiError {
    fn from(err: SecurityError) -> Self {
        match err {
            SecurityError::Denied {
                principal,
                target,
                required,
                actual,
                operation,
            } => ComputeApiError::SecurityDenied {
                principal_tags: principal
                    .tags()
                    .iter()
                    .map(|t| t.as_str().to_string())
                    .collect(),
                target: AccessTargetWire::from(target),
                required,
                actual,
                operation: operation.to_string(),
            },
            SecurityError::AttenuationViolation { requested, caller } => {
                ComputeApiError::SecurityDenied {
                    principal_tags: Vec::new(),
                    target: AccessTargetWire::Workbook,
                    required: requested,
                    actual: caller,
                    operation: "attenuation_violation".to_string(),
                }
            }
        }
    }
}

/// Parse-level helpers to rehydrate a `SecurityDenied` from the
/// flat-string form stored in `ComputeError::SecurityDenied`. R3.3's
/// shape-mirroring: the engine-level `ComputeError` carries strings
/// (because value-types can't name compute-security types), and this
/// layer reconstructs the typed shape before the error reaches an SDK.
///
/// The flat-string form uses fixed tokens (`"workbook"`, `"sheet:<id>"`,
/// `"column:<sheet>:<col>"`, `"read"/"write"/"admin"/"structure"/"none"`).
/// Anything that doesn't parse maps to `InvalidOperation` rather than
/// silently losing the error.
fn rehydrate_security_denied(
    principal_tags: &str,
    target: &str,
    required: &str,
    actual: &str,
    operation: &str,
) -> ComputeApiError {
    let parsed_target = parse_target(target);
    let parsed_required = parse_level(required);
    let parsed_actual = parse_level(actual);
    let tags: Vec<String> = if principal_tags.is_empty() {
        Vec::new()
    } else {
        principal_tags.split(',').map(|s| s.to_string()).collect()
    };
    match (parsed_target, parsed_required, parsed_actual) {
        (Some(target), Some(required), Some(actual)) => ComputeApiError::SecurityDenied {
            principal_tags: tags,
            target,
            required,
            actual,
            operation: operation.to_string(),
        },
        _ => ComputeApiError::InvalidOperation(format!(
            "malformed security-denied payload: target={target} required={required} actual={actual}"
        )),
    }
}

fn parse_target(s: &str) -> Option<AccessTargetWire> {
    if s == "workbook" {
        return Some(AccessTargetWire::Workbook);
    }
    if let Some(rest) = s.strip_prefix("sheet:") {
        return Some(AccessTargetWire::Sheet {
            sheet_id: rest.to_string(),
        });
    }
    if let Some(rest) = s.strip_prefix("column:") {
        let (sheet_id, col_id) = rest.split_once(':')?;
        return Some(AccessTargetWire::Column {
            sheet_id: sheet_id.to_string(),
            col_id: col_id.to_string(),
        });
    }
    None
}

fn parse_level(s: &str) -> Option<AccessLevel> {
    match s {
        "none" => Some(AccessLevel::None),
        "structure" => Some(AccessLevel::Structure),
        "read" => Some(AccessLevel::Read),
        "write" => Some(AccessLevel::Write),
        "admin" => Some(AccessLevel::Admin),
        _ => None,
    }
}

impl ComputeApiError {
    /// If the inner error is a `ComputeError::SecurityDenied`, promote
    /// it to the typed `SecurityDenied` variant on this layer. Callers
    /// apply this transform at the ComputeService boundary so SDKs see
    /// the typed form, not the flat-string engine error.
    #[must_use]
    pub fn promote_security_denied(self) -> Self {
        match self {
            ComputeApiError::Compute(ComputeError::SecurityDenied {
                principal_tags,
                target,
                required,
                actual,
                operation,
            }) => {
                rehydrate_security_denied(&principal_tags, &target, &required, &actual, &operation)
            }
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rehydrate_round_trips_a_simple_denial() {
        let err = rehydrate_security_denied(
            "agent:copilot,user:alice",
            "sheet:00000000-0000-0000-0000-000000000001",
            "write",
            "read",
            "set_cell",
        );
        match err {
            ComputeApiError::SecurityDenied {
                principal_tags,
                target,
                required,
                actual,
                operation,
            } => {
                assert_eq!(principal_tags, vec!["agent:copilot", "user:alice"]);
                assert!(matches!(target, AccessTargetWire::Sheet { .. }));
                assert_eq!(required, AccessLevel::Write);
                assert_eq!(actual, AccessLevel::Read);
                assert_eq!(operation, "set_cell");
            }
            other => panic!("expected SecurityDenied, got {other:?}"),
        }
    }

    #[test]
    fn rehydrate_workbook_target() {
        let err = rehydrate_security_denied("", "workbook", "admin", "read", "foo");
        match err {
            ComputeApiError::SecurityDenied { target, .. } => {
                assert_eq!(target, AccessTargetWire::Workbook);
            }
            _ => panic!("expected SecurityDenied"),
        }
    }

    #[test]
    fn rehydrate_malformed_falls_through_to_invalid_operation() {
        let err = rehydrate_security_denied("", "bogus-target", "weird", "huh", "op");
        assert!(matches!(err, ComputeApiError::InvalidOperation(_)));
    }

    #[test]
    fn promote_security_denied_transforms_wrapped_compute_error() {
        let inner = ComputeError::SecurityDenied {
            principal_tags: "mog:owner".to_string(),
            target: "workbook".to_string(),
            required: "admin".to_string(),
            actual: "write".to_string(),
            operation: "attenuation_violation".to_string(),
        };
        let promoted = ComputeApiError::Compute(inner).promote_security_denied();
        assert!(matches!(
            promoted,
            ComputeApiError::SecurityDenied {
                principal_tags: _,
                target: AccessTargetWire::Workbook,
                required: AccessLevel::Admin,
                actual: AccessLevel::Write,
                ..
            }
        ));
    }

    // -----------------------------------------------------------------
    // Bridge tagged-error contract
    // -----------------------------------------------------------------

    #[test]
    fn bridge_value_compute_passes_through_inner_compute_error() {
        // ComputeApiError::Compute should NOT add a wrapper to the wire
        // — the inner ComputeError's tagged shape is the contract.
        use bridge_types::BridgeStructuredError;
        let inner = ComputeError::PartialArrayWrite {
            sheet_id: "s".into(),
            row: 1,
            col: 2,
            anchor_row: 0,
            anchor_col: 0,
        };
        let api_err = ComputeApiError::Compute(inner);
        let v = api_err.to_bridge_value();
        assert_eq!(v["kind"], "PartialArrayWrite");
        assert_eq!(v["sheetId"], "s");
        assert_eq!(v["row"], 1);
        // No "Compute" wrapper at the top level.
        assert!(v.get("compute").is_none());
    }

    #[test]
    fn bridge_value_slicer_errors_pass_through_with_camel_case_fields() {
        use bridge_types::BridgeStructuredError;

        let not_found = ComputeApiError::Compute(ComputeError::SlicerNotFound {
            sheet_id: "sheet-1".into(),
            slicer_id: "slicer-1".into(),
        })
        .to_bridge_value();
        assert_eq!(not_found["kind"], "SlicerNotFound");
        assert_eq!(not_found["sheetId"], "sheet-1");
        assert_eq!(not_found["slicerId"], "slicer-1");
        assert!(not_found.get("sheet_id").is_none());

        let conflict = ComputeApiError::Compute(ComputeError::SlicerIdConflict {
            slicer_id: "slicer-1".into(),
        })
        .to_bridge_value();
        assert_eq!(conflict["kind"], "SlicerIdConflict");
        assert_eq!(conflict["slicerId"], "slicer-1");

        let mismatch = ComputeApiError::Compute(ComputeError::SlicerSheetMismatch {
            receiver_sheet_id: "sheet-1".into(),
            requested_sheet_id: "sheet-2".into(),
        })
        .to_bridge_value();
        assert_eq!(mismatch["kind"], "SlicerSheetMismatch");
        assert_eq!(mismatch["receiverSheetId"], "sheet-1");
        assert_eq!(mismatch["requestedSheetId"], "sheet-2");
        assert!(mismatch.get("receiver_sheet_id").is_none());
    }

    #[test]
    fn bridge_value_invalid_address_round_trips() {
        use bridge_types::BridgeStructuredError;
        let err = ComputeApiError::InvalidAddress {
            address: "ZZZZZZZ".into(),
            reason: "out of range".into(),
        };
        let v = err.to_bridge_value();
        assert_eq!(v["kind"], "InvalidAddress");
        assert_eq!(v["address"], "ZZZZZZZ");
        assert_eq!(v["reason"], "out of range");
        assert!(v["message"].as_str().unwrap_or("").contains("ZZZZZZZ"));
    }

    #[test]
    fn bridge_value_security_denied_uses_camel_case() {
        use bridge_types::BridgeStructuredError;
        let err = ComputeApiError::SecurityDenied {
            principal_tags: vec!["agent:copilot".into()],
            target: AccessTargetWire::Workbook,
            required: AccessLevel::Write,
            actual: AccessLevel::Read,
            operation: "set_cell".into(),
        };
        let v = err.to_bridge_value();
        assert_eq!(v["kind"], "SecurityDenied");
        // camelCase per the wire contract.
        assert!(v.get("principalTags").is_some());
        assert!(v.get("principal_tags").is_none());
    }

    #[test]
    fn bridge_format_err_macro_emits_sentinel_envelope_for_compute_api_error() {
        let err = ComputeApiError::Compute(ComputeError::PartialArrayWrite {
            sheet_id: "abc".into(),
            row: 5,
            col: 3,
            anchor_row: 4,
            anchor_col: 2,
        });
        let wire = bridge_types::bridge_format_err!(err);
        assert!(
            wire.starts_with(bridge_types::BRIDGE_ERROR_SENTINEL),
            "got: {wire}"
        );
        let parsed = bridge_types::parse_bridge_error(&wire).unwrap();
        assert_eq!(parsed["kind"], "PartialArrayWrite");
        assert_eq!(parsed["row"], 5);
        assert_eq!(parsed["col"], 3);
        assert_eq!(parsed["anchorRow"], 4);
        assert_eq!(parsed["anchorCol"], 2);
        // Human message survives via the auto-injected `message` field —
        // legacy app-eval scenarios that grep for "part of an array"
        // continue to match.
        assert!(
            parsed["message"]
                .as_str()
                .unwrap_or_default()
                .contains("part of an array formula")
        );
    }
}
