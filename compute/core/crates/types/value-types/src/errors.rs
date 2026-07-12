//! Error types for the compute engine.
//!
//! Two layers: [`CellError`] represents Excel-compatible cell errors (#DIV/0!, #N/A, etc.)
//! that live inside [`super::CellValue::Error`]. [`ComputeError`] represents engine-level
//! failures (parse errors, cycle detection, missing documents) returned from IPC commands.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Error returned when parsing a string into a [`CellError`] fails.
///
/// This is the `Err` type for [`CellError`]'s [`FromStr`] implementation.
///
/// # Examples
///
/// ```
/// use value_types::CellError;
///
/// let err = "HELLO".parse::<CellError>().unwrap_err();
/// assert_eq!(err.to_string(), r#"unknown cell error string: "HELLO""#);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseCellErrorError {
    input: String,
}

impl fmt::Display for ParseCellErrorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "unknown cell error string: {:?}", self.input)
    }
}

impl std::error::Error for ParseCellErrorError {}

/// Excel-compatible cell error types.
///
/// Every spreadsheet error that can appear in a cell is represented by one of
/// these variants. The display format matches Excel exactly (e.g., `#DIV/0\!`).
///
/// # Parsing from strings
///
/// `CellError` implements [`FromStr`], so you can use `.parse()`:
///
/// ```
/// use value_types::CellError;
///
/// let err: CellError = "#DIV/0!".parse().unwrap();
/// assert_eq!(err, CellError::Div0);
///
/// // Case-insensitive:
/// let err: CellError = "#value!".parse().unwrap();
/// assert_eq!(err, CellError::Value);
///
/// // Invalid strings return an error:
/// assert!("not-an-error".parse::<CellError>().is_err());
/// ```
#[doc(alias = "DIV/0")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CellError {
    /// #DIV/0! — Division by zero
    Div0,
    /// #N/A — Value not available
    Na,
    /// #NAME? — Unrecognized formula name
    Name,
    /// #NULL! — Incorrect range operator
    Null,
    /// #NUM! — Invalid numeric value
    Num,
    /// #REF! — Invalid cell reference
    Ref,
    /// #VALUE! — Wrong type of argument
    Value,
    /// #SPILL! — Spill range blocked
    Spill,
    /// #CALC! — Calculation error
    Calc,
    /// `#GETTING_DATA` — Async data loading
    GettingData,
    /// Circular reference — displays as `#REF!` for Excel compatibility,
    /// but is semantically distinct so the UI can show circular-reference
    /// indicators and diagnostics can be specific.
    Circ,
}

impl CellError {
    /// Display string matching Excel's error format.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellError;
    ///
    /// assert_eq!(CellError::Div0.as_str(), "#DIV/0!");
    /// assert_eq!(CellError::Na.as_str(), "#N/A");
    /// assert_eq!(CellError::Value.as_str(), "#VALUE!");
    /// assert_eq!(CellError::GettingData.as_str(), "#GETTING_DATA");
    /// ```
    #[must_use]
    #[inline]
    #[allow(clippy::match_same_arms)] // Circ intentionally displays as "#REF!" but is semantically distinct
    pub fn as_str(&self) -> &'static str {
        match self {
            CellError::Div0 => "#DIV/0!",
            CellError::Na => "#N/A",
            CellError::Name => "#NAME?",
            CellError::Null => "#NULL!",
            CellError::Num => "#NUM!",
            CellError::Ref => "#REF!",
            CellError::Value => "#VALUE!",
            CellError::Spill => "#SPILL!",
            CellError::Calc => "#CALC!",
            CellError::GettingData => "#GETTING_DATA",
            CellError::Circ => "#REF!",
        }
    }

    /// Returns `true` if this error represents a circular reference.
    ///
    /// The `Circ` variant displays as `#REF!` for Excel compatibility but
    /// can be distinguished programmatically for UI indicators and diagnostics.
    #[must_use]
    #[inline]
    pub fn is_circular(&self) -> bool {
        matches!(self, CellError::Circ)
    }

    /// Parse from Excel error string (case-insensitive).
    ///
    /// Convenience wrapper around [`FromStr`]. Returns `None` if the string
    /// does not match any known error format.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellError;
    ///
    /// assert_eq!(CellError::parse_error_str("#DIV/0!"), Some(CellError::Div0));
    /// assert_eq!(CellError::parse_error_str("#value!"), Some(CellError::Value));
    /// assert_eq!(CellError::parse_error_str("HELLO"), None);
    /// ```
    #[doc(alias = "parse")]
    #[must_use]
    pub fn parse_error_str(s: &str) -> Option<Self> {
        s.parse::<CellError>().ok()
    }
}

/// Convert a `CellError` to its Excel display string.
///
/// # Examples
///
/// ```
/// use value_types::CellError;
///
/// let s: String = CellError::Div0.into();
/// assert_eq!(s, "#DIV/0!");
/// ```
impl From<CellError> for String {
    fn from(e: CellError) -> Self {
        e.as_str().to_owned()
    }
}

impl FromStr for CellError {
    type Err = ParseCellErrorError;

    /// Parse a cell error from its Excel string representation.
    ///
    /// Matching is **case-insensitive**.
    ///
    /// # Examples
    ///
    /// ```
    /// use value_types::CellError;
    ///
    /// let err: CellError = "#REF!".parse().unwrap();
    /// assert_eq!(err, CellError::Ref);
    ///
    /// let err: CellError = "#calc!".parse().unwrap();
    /// assert_eq!(err, CellError::Calc);
    ///
    /// assert!("#UNKNOWN".parse::<CellError>().is_err());
    /// ```
    ///
    /// # Errors
    ///
    /// Returns [`ParseCellErrorError`] if `s` does not match any known error format.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.eq_ignore_ascii_case("#DIV/0!") {
            Ok(CellError::Div0)
        } else if s.eq_ignore_ascii_case("#N/A") {
            Ok(CellError::Na)
        } else if s.eq_ignore_ascii_case("#NAME?") {
            Ok(CellError::Name)
        } else if s.eq_ignore_ascii_case("#NULL!") {
            Ok(CellError::Null)
        } else if s.eq_ignore_ascii_case("#NUM!") {
            Ok(CellError::Num)
        } else if s.eq_ignore_ascii_case("#REF!") {
            Ok(CellError::Ref)
        } else if s.eq_ignore_ascii_case("#VALUE!") {
            Ok(CellError::Value)
        } else if s.eq_ignore_ascii_case("#SPILL!") {
            Ok(CellError::Spill)
        } else if s.eq_ignore_ascii_case("#CALC!") {
            Ok(CellError::Calc)
        } else if s.eq_ignore_ascii_case("#GETTING_DATA") {
            Ok(CellError::GettingData)
        } else {
            Err(ParseCellErrorError {
                input: s.to_owned(),
            })
        }
    }
}

impl fmt::Display for CellError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Compute engine errors (returned from IPC commands).
///
/// These represent engine-level failures that are not cell errors but rather
/// problems with the computation infrastructure itself.
///
/// # Examples
///
/// ```
/// use value_types::ComputeError;
///
/// let err = ComputeError::Parse {
///     message: "unexpected token".into(),
///     position: 5,
/// };
/// assert_eq!(err.to_string(), "Parse error: unexpected token");
///
/// let err = ComputeError::Cycle { cell_count: 3 };
/// assert_eq!(err.to_string(), "Cycle detected involving 3 cells");
/// ```
/// Track R3 — tagged-JSON wire shape.
///
/// The serde representation is **externally tagged with `kind`** and uses
/// **camelCase field names**, matching the TS `BridgeError` discriminated
/// union (`kernel/src/types/bridge-error.ts`). The same JSON shape is
/// produced across WASM, NAPI, and Tauri transports because the bridge
/// macros call `bridge_types::WrapErr(&e).bridge_format()`, which
/// dispatches to [`BridgeStructuredError::to_bridge_value`] when the
/// error type implements [`bridge_types::BridgeStructuredError`].
///
/// Wire example:
///
/// ```json
/// {"kind":"PartialArrayWrite","sheetId":"...","row":2,"col":3,
///  "anchorRow":1,"anchorCol":1}
/// ```
///
/// The Rust `Display` impl is unchanged and remains the human-readable
/// form used in logs and internal traces.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[non_exhaustive]
#[serde(tag = "kind")]
pub enum ComputeError {
    /// Formula parse error at a specific position.
    #[error("Parse error: {message}")]
    #[serde(rename_all = "camelCase")]
    Parse {
        /// Human-readable parse error description.
        message: String,
        /// Character offset where parsing failed.
        position: usize,
    },

    /// Formula evaluation error.
    #[error("Evaluation error: {message}")]
    #[serde(rename_all = "camelCase")]
    Eval {
        /// Human-readable evaluation error description.
        message: String,
    },

    /// Circular dependency detected.
    #[error("Cycle detected involving {cell_count} cells")]
    #[serde(rename_all = "camelCase")]
    Cycle {
        /// Number of cells involved in the cycle.
        cell_count: usize,
    },

    /// Requested document was not found.
    #[error("Document not found: {doc_id}")]
    #[serde(rename_all = "camelCase")]
    DocNotFound {
        /// UUID string of the missing document.
        doc_id: String,
    },

    /// Requested sheet was not found.
    #[error("Sheet not found: {sheet_id}")]
    #[serde(rename_all = "camelCase")]
    SheetNotFound {
        /// UUID string of the missing sheet.
        sheet_id: String,
    },

    /// Requested cell was not found.
    #[error("Cell not found: {cell_id}")]
    #[serde(rename_all = "camelCase")]
    CellNotFound {
        /// UUID string of the missing cell.
        cell_id: String,
    },

    /// Requested chart does not exist on the receiver worksheet.
    ///
    /// An object of another kind at the same ID is intentionally reported as
    /// missing because chart APIs only admit chart targets.
    #[error("Chart not found on sheet {sheet_id}: {chart_id}")]
    #[serde(rename_all = "camelCase")]
    ChartNotFound {
        /// Receiver worksheet UUID.
        sheet_id: String,
        /// Requested stable chart ID.
        chart_id: String,
    },

    /// Requested slicer does not exist on the receiver worksheet.
    ///
    /// A slicer owned by another worksheet is intentionally reported through
    /// the same variant so callers cannot use sheet-scoped APIs to discover
    /// entities outside their receiver scope.
    #[error("Slicer not found on sheet {sheet_id}: {slicer_id}")]
    #[serde(rename_all = "camelCase")]
    SlicerNotFound {
        /// Receiver worksheet UUID.
        sheet_id: String,
        /// Requested stable slicer ID.
        slicer_id: String,
    },

    /// A create request supplied a slicer ID that is already in use.
    #[error("Slicer ID already exists: {slicer_id}")]
    #[serde(rename_all = "camelCase")]
    SlicerIdConflict {
        /// Conflicting workbook-unique slicer ID.
        slicer_id: String,
    },

    /// A create request attempted to assign a slicer to a worksheet other
    /// than the receiver worksheet.
    #[error("Slicer sheet mismatch: receiver {receiver_sheet_id}, requested {requested_sheet_id}")]
    #[serde(rename_all = "camelCase")]
    SlicerSheetMismatch {
        /// Canonical receiver worksheet UUID.
        receiver_sheet_id: String,
        /// Worksheet ID supplied in the create payload.
        requested_sheet_id: String,
    },

    /// UUID string could not be parsed.
    #[error("UUID parse error: {message}")]
    #[serde(rename_all = "camelCase")]
    UuidParse {
        /// Human-readable UUID parse error description.
        message: String,
    },

    /// Deserialization of input data failed.
    #[error("Deserialization error: {message}")]
    #[serde(rename_all = "camelCase")]
    Deserialize {
        /// Human-readable deserialization error description.
        message: String,
    },

    /// Internal panic caught during computation.
    #[error("Internal panic: {message}")]
    #[serde(rename_all = "camelCase")]
    InternalPanic {
        /// Panic message captured from the caught panic.
        message: String,
    },

    /// Maximum number of operations exceeded.
    #[error("Operation limit exceeded")]
    OperationLimit,

    /// Maximum recursion depth exceeded.
    #[error("Depth limit exceeded")]
    DepthLimit,

    /// Computation deadline exceeded.
    #[error("Deadline exceeded")]
    DeadlineExceeded,

    /// XLSX export failed.
    #[error("Export error: {message}")]
    #[serde(rename_all = "camelCase")]
    ExportError {
        /// Human-readable export error description.
        message: String,
    },

    /// Input validation failed (invalid arguments, out-of-range values, etc.).
    #[error("Invalid input: {message}")]
    #[serde(rename_all = "camelCase")]
    InvalidInput {
        /// Human-readable description of the validation failure.
        message: String,
    },

    /// Caller attempted to edit a single cell that belongs to a CSE
    /// (`Ctrl+Shift+Enter`) array formula. Excel parity: the user
    /// must select the entire array extent and reapply the array
    /// formula — partial overwrites of CSE arrays are rejected.
    /// Members of dynamic-array spills are *not* covered by this
    /// variant; typing into a spill member places a blocker literal
    /// and raises `#SPILL!` at the anchor (existing scheduler/spill
    /// behavior).
    #[error(
        "You cannot change part of an array formula at ({sheet_id}, row {row}, col {col}); anchor at row {anchor_row}, col {anchor_col}"
    )]
    #[serde(rename_all = "camelCase")]
    PartialArrayWrite {
        /// Sheet UUID where the rejected write was attempted.
        sheet_id: String,
        /// Row of the rejected write.
        row: u32,
        /// Column of the rejected write.
        col: u32,
        /// Row of the CSE anchor whose extent the write fell inside.
        anchor_row: u32,
        /// Column of the CSE anchor whose extent the write fell inside.
        anchor_col: u32,
    },

    /// Document schema version is newer than this binary supports.
    #[error(
        "Unsupported schema version {found} (max supported: {max_supported}). Update your application."
    )]
    #[serde(rename_all = "camelCase")]
    UnsupportedSchemaVersion {
        /// Schema version found in the document.
        found: u32,
        /// Maximum version this binary can handle.
        max_supported: u32,
    },

    /// Structural operation rejected on a Range-backed sheet.
    #[error(
        "Cannot {operation} on Range-backed sheet {sheet_id}: structural operations are not yet supported for Range-backed sheets"
    )]
    #[serde(rename_all = "camelCase")]
    RangeGuardViolation {
        /// Sheet UUID where the rejected operation was attempted.
        sheet_id: String,
        /// Name of the structural operation that was rejected.
        operation: String,
    },

    /// Access denied by the privacy policy engine (R3.3). The payload is a
    /// flat serializable form — `value-types` must not depend on
    /// `compute-security`, and the bridge/SDKs round-trip a string-based
    /// shape anyway. `compute-core` converts a `SecurityError::Denied`
    /// into this variant via a local `From` impl.
    #[error(
        "Security denied: principal [{principal_tags}] lacks {required} access to {target} (actual: {actual}, operation: {operation})"
    )]
    #[serde(rename_all = "camelCase")]
    SecurityDenied {
        /// Principal tag list joined with commas for display. The bridge
        /// layer re-hydrates this into a typed form when surfacing to SDKs.
        principal_tags: String,
        /// `"workbook"` / `"sheet:<id>"` / `"column:<sheet>:<col>"` —
        /// rendered in compute-core from the `AccessTarget` variant.
        target: String,
        /// Required access level as a lowercase string (`"read"`,
        /// `"write"`, `"admin"`, `"structure"`).
        required: String,
        /// Effective access level the caller actually had.
        actual: String,
        /// Operation label (engine method name) for diagnostics.
        operation: String,
    },
}

/// Track R3 — opt `ComputeError` into the bridge tagged-error contract.
///
/// `BridgeError` is the marker; `BridgeStructuredError::to_bridge_value`
/// returns the JSON shape that `bridge_types::WrapErr(...).bridge_format()`
/// wraps in the `[BRIDGE_ERROR]` sentinel for transports.
impl bridge_types::BridgeError for ComputeError {}

impl bridge_types::BridgeStructuredError for ComputeError {
    fn to_bridge_value(&self) -> serde_json::Value {
        // The `#[serde(tag = "kind")]` derived shape is the typed
        // payload; we additionally inject `"message"` set to the
        // `Display` form. The TS side uses `kind` for typed dispatch
        // and `message` for fallback / logging; consumers that
        // grep error messages (legacy harness scenarios that
        // pre-date this contract) keep working unchanged.
        let mut value = serde_json::to_value(self).unwrap_or_else(|e| {
            serde_json::json!({
                "kind": "Internal",
                "message": format!("ComputeError serialization failed: {e}"),
            })
        });
        if let serde_json::Value::Object(ref mut map) = value {
            // Don't clobber a pre-existing `message` field if the
            // variant happens to have one (e.g. Parse, Eval). Insert
            // only when absent — the Display form is a strict
            // superset for those variants but we keep the explicit
            // field for forward-compatibility.
            map.entry("message".to_string())
                .or_insert_with(|| serde_json::Value::String(self.to_string()));
        }
        value
    }
}

impl From<serde_json::Error> for ComputeError {
    fn from(e: serde_json::Error) -> Self {
        ComputeError::Deserialize {
            message: e.to_string(),
        }
    }
}

impl From<uuid::Error> for ComputeError {
    fn from(e: uuid::Error) -> Self {
        ComputeError::UuidParse {
            message: e.to_string(),
        }
    }
}

#[cfg(test)]
#[allow(clippy::float_cmp)]
mod tests {
    use super::*;

    const ALL_ERRORS: [CellError; 10] = [
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

    const ALL_ERROR_STRS: [&str; 10] = [
        "#DIV/0!",
        "#N/A",
        "#NAME?",
        "#NULL!",
        "#NUM!",
        "#REF!",
        "#VALUE!",
        "#SPILL!",
        "#CALC!",
        "#GETTING_DATA",
    ];

    #[test]
    fn as_str_all_variants() {
        for (err, expected) in ALL_ERRORS.iter().zip(ALL_ERROR_STRS.iter()) {
            assert_eq!(err.as_str(), *expected);
        }
    }

    #[test]
    fn parse_error_str_roundtrip_all() {
        for (err, s) in ALL_ERRORS.iter().zip(ALL_ERROR_STRS.iter()) {
            let parsed = CellError::parse_error_str(s).unwrap();
            assert_eq!(&parsed, err);
        }
    }

    #[test]
    fn parse_error_str_empty() {
        assert_eq!(CellError::parse_error_str(""), None);
    }

    #[test]
    fn parse_error_str_invalid_hello() {
        assert_eq!(CellError::parse_error_str("HELLO"), None);
    }

    #[test]
    fn parse_error_str_partial_div() {
        assert_eq!(CellError::parse_error_str("#DIV"), None);
    }

    #[test]
    fn parse_error_str_lowercase() {
        assert_eq!(CellError::parse_error_str("#div/0!"), Some(CellError::Div0));
        assert_eq!(
            CellError::parse_error_str("#value!"),
            Some(CellError::Value)
        );
        assert_eq!(CellError::parse_error_str("#n/a"), Some(CellError::Na));
        assert_eq!(CellError::parse_error_str("#name?"), Some(CellError::Name));
    }

    #[test]
    fn display_matches_as_str() {
        for err in &ALL_ERRORS {
            assert_eq!(format!("{err}"), err.as_str());
        }
    }

    #[test]
    fn compute_error_display_parse() {
        let e = ComputeError::Parse {
            message: "bad token".into(),
            position: 5,
        };
        assert_eq!(format!("{e}"), "Parse error: bad token");
    }

    #[test]
    fn compute_error_display_eval() {
        let e = ComputeError::Eval {
            message: "overflow".into(),
        };
        assert_eq!(format!("{e}"), "Evaluation error: overflow");
    }

    #[test]
    fn compute_error_display_cycle() {
        let e = ComputeError::Cycle { cell_count: 3 };
        assert_eq!(format!("{e}"), "Cycle detected involving 3 cells");
    }

    #[test]
    fn compute_error_display_doc_not_found() {
        let e = ComputeError::DocNotFound {
            doc_id: "abc".into(),
        };
        assert_eq!(format!("{e}"), "Document not found: abc");
    }

    #[test]
    fn compute_error_display_operation_limit() {
        assert_eq!(
            format!("{}", ComputeError::OperationLimit),
            "Operation limit exceeded"
        );
    }

    #[test]
    fn compute_error_display_depth_limit() {
        assert_eq!(
            format!("{}", ComputeError::DepthLimit),
            "Depth limit exceeded"
        );
    }

    #[test]
    fn compute_error_display_deadline() {
        assert_eq!(
            format!("{}", ComputeError::DeadlineExceeded),
            "Deadline exceeded"
        );
    }

    #[test]
    fn from_uuid_error_conversion() {
        let bad = uuid::Uuid::parse_str("not-a-uuid");
        assert!(bad.is_err());
        let compute_err: ComputeError = bad.unwrap_err().into();
        assert!(matches!(compute_err, ComputeError::UuidParse { .. }));
        let msg = format!("{compute_err}");
        assert!(msg.contains("UUID parse error"));
    }

    #[test]
    fn circ_displays_as_ref() {
        assert_eq!(CellError::Circ.as_str(), "#REF!");
        assert_eq!(format!("{}", CellError::Circ), "#REF!");
    }

    #[test]
    fn circ_is_circular() {
        assert!(CellError::Circ.is_circular());
        // All other variants should return false
        for err in &ALL_ERRORS {
            assert!(!err.is_circular());
        }
    }

    #[test]
    fn parse_ref_returns_ref_not_circ() {
        // #REF! should always parse as Ref, never Circ
        assert_eq!("#REF!".parse::<CellError>().unwrap(), CellError::Ref);
    }

    #[test]
    fn from_cell_error_to_string() {
        let s: String = CellError::Div0.into();
        assert_eq!(s, "#DIV/0!");
        assert_eq!(String::from(CellError::Na), "#N/A");
        assert_eq!(String::from(CellError::Value), "#VALUE!");
    }

    #[test]
    fn cell_error_clone_copy() {
        let e = CellError::Div0;
        let e2 = e;
        let e3 = e;
        assert_eq!(e, e2);
        assert_eq!(e, e3);
    }

    #[test]
    fn cell_error_hash() {
        use std::collections::HashSet;
        let mut set = HashSet::new();
        set.insert(CellError::Na);
        set.insert(CellError::Na);
        assert_eq!(set.len(), 1);
        set.insert(CellError::Div0);
        assert_eq!(set.len(), 2);
    }

    #[test]
    fn compute_error_serde_roundtrip() {
        let e = ComputeError::Parse {
            message: "unexpected".into(),
            position: 10,
        };
        let json = serde_json::to_string(&e).unwrap();
        let e2: ComputeError = serde_json::from_str(&json).unwrap();
        assert_eq!(format!("{e}"), format!("{e2}"));
    }

    // -----------------------------------------------------------------
    // Track R3 — tagged-JSON wire shape (BridgeStructuredError)
    // -----------------------------------------------------------------

    #[test]
    fn compute_error_tagged_json_parse() {
        use bridge_types::BridgeStructuredError;
        let e = ComputeError::Parse {
            message: "bad token".into(),
            position: 5,
        };
        let v = e.to_bridge_value();
        assert_eq!(v["kind"], "Parse");
        assert_eq!(v["message"], "bad token");
        assert_eq!(v["position"], 5);
    }

    #[test]
    fn compute_error_tagged_json_partial_array_write_uses_camel_case() {
        use bridge_types::BridgeStructuredError;
        let e = ComputeError::PartialArrayWrite {
            sheet_id: "s-uuid".into(),
            row: 2,
            col: 3,
            anchor_row: 1,
            anchor_col: 1,
        };
        let v = e.to_bridge_value();
        assert_eq!(v["kind"], "PartialArrayWrite");
        // camelCase field names per #[serde(rename_all = "camelCase")]
        assert_eq!(v["sheetId"], "s-uuid");
        assert_eq!(v["anchorRow"], 1);
        assert_eq!(v["anchorCol"], 1);
        assert_eq!(v["row"], 2);
        assert_eq!(v["col"], 3);
        // No snake_case fields leak through.
        assert!(v.get("sheet_id").is_none());
        assert!(v.get("anchor_row").is_none());
        // `message` is auto-injected as the Display form so legacy
        // log/grep consumers (and the app-eval CSE-partial scenario)
        // keep working unchanged.
        assert!(
            v["message"]
                .as_str()
                .unwrap_or_default()
                .contains("part of an array formula")
        );
    }

    #[test]
    fn compute_error_tagged_json_unit_variants() {
        use bridge_types::BridgeStructuredError;
        // Unit variants serialize with just `kind` plus the auto-injected
        // `message` (the Display form). TS discriminated-union check
        // dispatches on `kind`; consumers that want a human string
        // read `message`.
        let v = ComputeError::OperationLimit.to_bridge_value();
        assert_eq!(v["kind"], "OperationLimit");
        assert_eq!(v["message"], "Operation limit exceeded");
        let v = ComputeError::DepthLimit.to_bridge_value();
        assert_eq!(v["kind"], "DepthLimit");
        let v = ComputeError::DeadlineExceeded.to_bridge_value();
        assert_eq!(v["kind"], "DeadlineExceeded");
    }

    #[test]
    fn compute_error_wrap_err_emits_sentinel_envelope() {
        // Reproduces the bridge-macro path:
        // `bridge_types::WrapErr(&e).bridge_format()` returns the
        // sentinel-prefixed JSON.
        let e = ComputeError::PartialArrayWrite {
            sheet_id: "abc".into(),
            row: 0,
            col: 0,
            anchor_row: 0,
            anchor_col: 0,
        };
        let wire = bridge_types::WrapErr(&e).bridge_format();
        assert!(
            wire.starts_with(bridge_types::BRIDGE_ERROR_SENTINEL),
            "got: {wire}"
        );
        let parsed = bridge_types::parse_bridge_error(&wire).expect("parses");
        assert_eq!(parsed["kind"], "PartialArrayWrite");
        assert_eq!(parsed["sheetId"], "abc");
    }

    #[test]
    fn compute_error_every_variant_has_kind_field() {
        use bridge_types::BridgeStructuredError;
        // Every variant must produce a JSON object with a "kind"
        // discriminator. This is the contract the TS BridgeError union
        // depends on; if a variant is added without serde tag/rename
        // the test fails at the missing-kind assertion below.
        let cases = [
            ComputeError::Parse {
                message: "p".into(),
                position: 0,
            },
            ComputeError::Eval {
                message: "e".into(),
            },
            ComputeError::Cycle { cell_count: 1 },
            ComputeError::DocNotFound { doc_id: "d".into() },
            ComputeError::SheetNotFound {
                sheet_id: "s".into(),
            },
            ComputeError::CellNotFound {
                cell_id: "c".into(),
            },
            ComputeError::SlicerNotFound {
                sheet_id: "s".into(),
                slicer_id: "sl".into(),
            },
            ComputeError::SlicerIdConflict {
                slicer_id: "sl".into(),
            },
            ComputeError::SlicerSheetMismatch {
                receiver_sheet_id: "s1".into(),
                requested_sheet_id: "s2".into(),
            },
            ComputeError::UuidParse {
                message: "u".into(),
            },
            ComputeError::Deserialize {
                message: "d".into(),
            },
            ComputeError::InternalPanic {
                message: "p".into(),
            },
            ComputeError::OperationLimit,
            ComputeError::DepthLimit,
            ComputeError::DeadlineExceeded,
            ComputeError::ExportError {
                message: "x".into(),
            },
            ComputeError::InvalidInput {
                message: "i".into(),
            },
            ComputeError::PartialArrayWrite {
                sheet_id: "s".into(),
                row: 0,
                col: 0,
                anchor_row: 0,
                anchor_col: 0,
            },
            ComputeError::UnsupportedSchemaVersion {
                found: 99,
                max_supported: 13,
            },
            ComputeError::SecurityDenied {
                principal_tags: "p".into(),
                target: "t".into(),
                required: "r".into(),
                actual: "a".into(),
                operation: "o".into(),
            },
            ComputeError::RangeGuardViolation {
                sheet_id: "s".into(),
                operation: "insertRows".into(),
            },
        ];
        let expected_kinds = [
            "Parse",
            "Eval",
            "Cycle",
            "DocNotFound",
            "SheetNotFound",
            "CellNotFound",
            "SlicerNotFound",
            "SlicerIdConflict",
            "SlicerSheetMismatch",
            "UuidParse",
            "Deserialize",
            "InternalPanic",
            "OperationLimit",
            "DepthLimit",
            "DeadlineExceeded",
            "ExportError",
            "InvalidInput",
            "PartialArrayWrite",
            "UnsupportedSchemaVersion",
            "SecurityDenied",
            "RangeGuardViolation",
        ];
        for (e, kind) in cases.iter().zip(expected_kinds.iter()) {
            let v = e.to_bridge_value();
            assert_eq!(
                v.get("kind").and_then(|k| k.as_str()),
                Some(*kind),
                "ComputeError variant must serialize with kind={kind}; got {v:?}"
            );
        }
    }

    // --- FromStr tests ---

    #[test]
    fn from_str_roundtrip_all() {
        for (err, s) in ALL_ERRORS.iter().zip(ALL_ERROR_STRS.iter()) {
            let parsed: CellError = s.parse().unwrap();
            assert_eq!(&parsed, err);
        }
    }

    #[test]
    fn from_str_case_insensitive() {
        assert_eq!("#div/0!".parse::<CellError>().unwrap(), CellError::Div0);
        assert_eq!("#VALUE!".parse::<CellError>().unwrap(), CellError::Value);
        assert_eq!("#Calc!".parse::<CellError>().unwrap(), CellError::Calc);
        assert_eq!(
            "#getting_data".parse::<CellError>().unwrap(),
            CellError::GettingData
        );
    }

    #[test]
    fn from_str_error_on_invalid() {
        let err = "HELLO".parse::<CellError>().unwrap_err();
        assert_eq!(err.to_string(), r#"unknown cell error string: "HELLO""#);
    }

    #[test]
    fn from_str_error_on_empty() {
        assert!("".parse::<CellError>().is_err());
    }

    #[test]
    fn from_str_error_on_partial() {
        assert!("#DIV".parse::<CellError>().is_err());
    }

    #[test]
    fn parse_cell_error_error_is_std_error() {
        let err = "bad".parse::<CellError>().unwrap_err();
        let _: &dyn std::error::Error = &err;
    }

    #[test]
    fn parse_cell_error_error_eq() {
        let a = ParseCellErrorError { input: "x".into() };
        let b = ParseCellErrorError { input: "x".into() };
        let c = ParseCellErrorError { input: "y".into() };
        assert_eq!(a, b);
        assert_ne!(a, c);
    }
}
