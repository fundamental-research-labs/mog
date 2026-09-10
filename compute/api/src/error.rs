//! Rich error types for compute-api.
//!
//! `ComputeApiError` wraps `ComputeError` from the engine and adds
//! facade-level error variants (address validation, sheet lookup, etc.).
//!
//! `ComputeApiError` implements [`bridge_types::BridgeStructuredError`] so
//! bridge macros emit the same tagged-JSON envelope:
//! `[BRIDGE_ERROR]{"kind":"...","message":"...", ...}`.

use value_types::ComputeError;

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

    /// Wrapped error from the underlying compute engine.
    #[error(transparent)]
    Compute(#[from] ComputeError),
}

// Bridge tagged-error contract.
//
// `ComputeApiError` is the type returned by every `#[bridge::api]` method
// on `ComputeService`, so its `to_bridge_value` defines the wire shape
// the TS `BridgeError` discriminated union must match.
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
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
