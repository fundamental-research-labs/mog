// Re-export derive macros so users only need `bridge-types` in their deps.
pub use bridge_derive::BridgeError;
pub use bridge_describe::DescribeSchema;

/// Trait for types that can describe their required wire-format fields.
/// Auto-derived by `#[derive(DescribeSchema)]`.
pub trait DescribeSchema {
    /// Returns the camelCase (wire-format) names of all required fields.
    fn required_field_names() -> &'static [&'static str];
}

/// Check a serde_json::Value against a type's required fields.
/// Returns a formatted error string listing all missing fields.
/// Called from generated bridge code on the error path only.
pub fn check_missing_fields<T: DescribeSchema>(
    value: &serde_json::Value,
    original_error: &dyn std::fmt::Display,
) -> String {
    if let serde_json::Value::Object(map) = value {
        let provided: std::collections::HashSet<&str> = map.keys().map(|k| k.as_str()).collect();
        let required = T::required_field_names();
        let missing: Vec<&str> = required
            .iter()
            .filter(|f| !provided.contains(**f))
            .copied()
            .collect();
        if !missing.is_empty() {
            return format!(
                "missing required fields: [{}]. All required fields: [{}]",
                missing.join(", "),
                required.join(", "),
            );
        }
    }
    // Fall through to original error if not a missing-field issue
    format!("{}", original_error)
}

/// Enhance a serde "missing field" error with the list of provided fields.
/// This is non-generic and works for ANY serde type — no DescribeSchema needed.
/// Called from generated bridge code on the error path only.
pub fn enhance_missing_field_error(
    value: &serde_json::Value,
    original_error: &dyn std::fmt::Display,
) -> String {
    if let serde_json::Value::Object(map) = value {
        let provided: Vec<&str> = map.keys().map(|k| k.as_str()).collect();
        if provided.is_empty() {
            format!("{}. No fields were provided", original_error)
        } else {
            format!(
                "{}. Provided fields: [{}]",
                original_error,
                provided.join(", "),
            )
        }
    } else {
        format!("{}", original_error)
    }
}

/// Validate a JSON value against a type's DescribeSchema, returning a batch
/// error listing ALL missing required fields. Use this from typed contexts
/// (e.g., kernel API layer) where the concrete type is known and in scope.
pub fn validate_missing_fields<T: DescribeSchema>(value: &serde_json::Value) -> Result<(), String> {
    if let serde_json::Value::Object(map) = value {
        let provided: std::collections::HashSet<&str> = map.keys().map(|k| k.as_str()).collect();
        let required = T::required_field_names();
        let missing: Vec<&str> = required
            .iter()
            .filter(|f| !provided.contains(**f))
            .copied()
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "missing required fields: [{}]. All required fields: [{}]",
                missing.join(", "),
                required.join(", "),
            ));
        }
    }
    Ok(())
}

/// Implement for types that cross the boundary as strings, parsed into Rust types.
/// Example: UUID-based IDs that JS sends as strings.
pub trait BridgeParse: Sized {
    fn bridge_parse(s: &str) -> Result<Self, String>;
}

/// Blanket impl: any FromStr type is automatically BridgeParse.
impl<T> BridgeParse for T
where
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    fn bridge_parse(s: &str) -> Result<Self, String> {
        s.parse().map_err(|e| format!("{}", e))
    }
}

/// Marker trait for error types that cross the boundary.
/// Use `#[derive(BridgeError)]` to implement.
pub trait BridgeError: std::fmt::Display + Send + 'static {}

/// Optional: implement for error types that should send structured data to JS.
pub trait BridgeStructuredError: BridgeError {
    fn to_bridge_value(&self) -> serde_json::Value;
}

// ---------------------------------------------------------------------------
// Wire-level error formatting (Track R3)
// ---------------------------------------------------------------------------
//
// All transports (WASM JsError, NAPI napi::Error, Tauri Result<_, String>)
// surface engine errors only as a single string (the `Display` impl). To
// give the TS side a typed discriminated union without changing every
// transport's binding contract, we embed a tagged-JSON envelope INTO the
// error string when the error type opts in by implementing
// [`BridgeStructuredError`].
//
// Wire format:
//
// ```text
// [BRIDGE_ERROR]{"kind":"PartialArrayWrite","message":"...", ...payload}
// ```
//
// The opening sentinel `[BRIDGE_ERROR]` is deliberately ASCII, contains no
// JSON-special characters, and is unambiguous on the TS side: a single
// `String.startsWith('[BRIDGE_ERROR]')` check identifies the structured
// path. Anything else is a legacy/free-form Display error.
//
// Both NAPI and WASM call the same `format_bridge_error` helper so the
// envelope is byte-for-byte identical across transports.

/// Sentinel prefix marking a tagged-JSON bridge error. Kept in sync with
/// `parseBridgeError` on the TS side (`infra/transport/src/bridge-error.ts`).
pub const BRIDGE_ERROR_SENTINEL: &str = "[BRIDGE_ERROR]";

/// Newtype wrapper used by [`format_bridge_error`] to anchor inherent-vs-
/// trait specialization (a stable-Rust pattern). Field is `pub` so the
/// macro expansion can construct it inline (`bridge_types::WrapErr(&e)`).
pub struct WrapErr<'a, E: ?Sized>(pub &'a E);

// Specialized inherent impl: when `E: BridgeStructuredError`, the
// inherent method `bridge_format` is reachable directly on `WrapErr<&E>`.
// Inherent methods take priority over trait methods during method
// resolution, so this wins when applicable.
impl<E: BridgeStructuredError + ?Sized> WrapErr<'_, E> {
    /// Format the wrapped error as a tagged-JSON bridge envelope.
    pub fn bridge_format(&self) -> String {
        format!("{}{}", BRIDGE_ERROR_SENTINEL, self.0.to_bridge_value())
    }
}

/// Trait providing the fallback `bridge_format` for any `Display` error.
/// When the specialized inherent impl above does NOT apply (because the
/// error type doesn't implement [`BridgeStructuredError`]), method
/// resolution falls through to this trait impl and produces the plain
/// `Display` string.
pub trait BridgeFormatFallback {
    fn bridge_format(&self) -> String;
}

impl<E: std::fmt::Display + ?Sized> BridgeFormatFallback for WrapErr<'_, E> {
    fn bridge_format(&self) -> String {
        format!("{}", self.0)
    }
}

// NOTE: there is no `format_bridge_error<E>` free function because the
// inherent-vs-trait specialization only resolves at concrete-type call
// sites. Inside a generic function the compiler sees only the bound
// (`E: Display`) and would always pick the trait fallback, defeating
// the purpose. Macros must emit `bridge_format_err!(e)` directly so the
// expression captures `e` at its concrete type.

/// Format a concrete error value as a bridge wire string. Returns the
/// tagged-JSON envelope for errors that implement
/// [`BridgeStructuredError`] and the plain `Display` form otherwise.
///
/// **Must be invoked at a concrete-type call site** (i.e. inside a
/// `map_err(|e| ...)` closure where `e` has its concrete type) so
/// inherent-vs-trait method resolution can pick the specialized impl.
/// The macro form keeps the macro-generated bridge bindings hygienic
/// without importing the picker trait at every emission site.
#[macro_export]
macro_rules! bridge_format_err {
    ($e:expr) => {{
        // Bring the fallback trait into scope so method resolution
        // sees both the inherent (specialized) and the trait
        // (fallback) `bridge_format` candidates.
        #[allow(unused_imports)]
        use $crate::BridgeFormatFallback as _;
        $crate::WrapErr(&$e).bridge_format()
    }};
}

/// Strip the sentinel and parse the tagged-JSON payload from a bridge
/// error message. Returns `None` if the message is plain `Display`.
///
/// Used by harnesses (Rust-side test code, headless CLI) that need to
/// reconstruct the structured payload from a `String`-only error.
#[must_use]
pub fn parse_bridge_error(msg: &str) -> Option<serde_json::Value> {
    msg.strip_prefix(BRIDGE_ERROR_SENTINEL)
        .and_then(|rest| serde_json::from_str(rest).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // BridgeParse — blanket impl on FromStr for standard types
    // -----------------------------------------------------------------------

    #[test]
    fn bridge_parse_u32() {
        assert_eq!(u32::bridge_parse("42"), Ok(42u32));
    }

    #[test]
    fn bridge_parse_i64() {
        assert_eq!(i64::bridge_parse("-9999"), Ok(-9999i64));
    }

    #[test]
    fn bridge_parse_u64_max() {
        assert_eq!(u64::bridge_parse("18446744073709551615"), Ok(u64::MAX));
    }

    #[test]
    fn bridge_parse_f64() {
        assert_eq!(f64::bridge_parse("2.5"), Ok(2.5f64));
    }

    #[test]
    fn bridge_parse_f64_negative() {
        assert_eq!(f64::bridge_parse("-0.001"), Ok(-0.001f64));
    }

    #[test]
    fn bridge_parse_bool_true() {
        assert_eq!(bool::bridge_parse("true"), Ok(true));
    }

    #[test]
    fn bridge_parse_bool_false() {
        assert_eq!(bool::bridge_parse("false"), Ok(false));
    }

    #[test]
    fn bridge_parse_string() {
        // String::from_str is infallible, so this always succeeds.
        assert_eq!(
            String::bridge_parse("hello world"),
            Ok("hello world".to_string())
        );
    }

    #[test]
    fn bridge_parse_char() {
        assert_eq!(char::bridge_parse("X"), Ok('X'));
    }

    #[test]
    fn bridge_parse_usize() {
        assert_eq!(usize::bridge_parse("1024"), Ok(1024usize));
    }

    #[test]
    fn bridge_parse_i8() {
        assert_eq!(i8::bridge_parse("-128"), Ok(-128i8));
    }

    // -----------------------------------------------------------------------
    // BridgeParse — error cases
    // -----------------------------------------------------------------------

    #[test]
    fn bridge_parse_u32_invalid_returns_err() {
        let result = u32::bridge_parse("not_a_number");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("invalid"), "error message was: {msg}");
    }

    #[test]
    fn bridge_parse_u32_negative_returns_err() {
        let result = u32::bridge_parse("-1");
        assert!(result.is_err());
    }

    #[test]
    fn bridge_parse_i64_overflow_returns_err() {
        let result = i64::bridge_parse("9223372036854775808");
        assert!(result.is_err());
    }

    #[test]
    fn bridge_parse_bool_invalid_returns_err() {
        let result = bool::bridge_parse("yes");
        assert!(result.is_err());
    }

    #[test]
    fn bridge_parse_char_multichar_returns_err() {
        let result = char::bridge_parse("ab");
        assert!(result.is_err());
    }

    #[test]
    fn bridge_parse_f64_empty_string_returns_err() {
        let result = f64::bridge_parse("");
        assert!(result.is_err());
    }

    #[test]
    fn bridge_parse_u32_empty_string_returns_err() {
        let result = u32::bridge_parse("");
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // BridgeParse — custom type with FromStr
    // -----------------------------------------------------------------------

    #[derive(Debug, PartialEq)]
    struct MyId(u64);

    impl std::str::FromStr for MyId {
        type Err = std::num::ParseIntError;

        fn from_str(s: &str) -> Result<Self, Self::Err> {
            let raw = s.strip_prefix("id-").unwrap_or(s);
            raw.parse::<u64>().map(MyId)
        }
    }

    #[test]
    fn bridge_parse_custom_type_plain() {
        assert_eq!(MyId::bridge_parse("12345"), Ok(MyId(12345)));
    }

    #[test]
    fn bridge_parse_custom_type_with_prefix() {
        assert_eq!(MyId::bridge_parse("id-42"), Ok(MyId(42)));
    }

    #[test]
    fn bridge_parse_custom_type_invalid() {
        let result = MyId::bridge_parse("id-abc");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("invalid"), "error message was: {msg}");
    }

    #[derive(Debug, PartialEq)]
    enum Direction {
        North,
        South,
        East,
        West,
    }

    impl std::str::FromStr for Direction {
        type Err = String;

        fn from_str(s: &str) -> Result<Self, Self::Err> {
            match s.to_lowercase().as_str() {
                "north" | "n" => Ok(Direction::North),
                "south" | "s" => Ok(Direction::South),
                "east" | "e" => Ok(Direction::East),
                "west" | "w" => Ok(Direction::West),
                other => Err(format!("unknown direction: {other}")),
            }
        }
    }

    #[test]
    fn bridge_parse_custom_enum_full_name() {
        assert_eq!(Direction::bridge_parse("north"), Ok(Direction::North));
    }

    #[test]
    fn bridge_parse_custom_enum_abbreviation() {
        assert_eq!(Direction::bridge_parse("W"), Ok(Direction::West));
    }

    #[test]
    fn bridge_parse_custom_enum_invalid() {
        let result = Direction::bridge_parse("northwest");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "unknown direction: northwest");
    }

    // -----------------------------------------------------------------------
    // BridgeError — manual implementation
    // -----------------------------------------------------------------------

    #[derive(Debug)]
    enum SimpleError {
        NotFound(String),
        PermissionDenied,
    }

    impl std::fmt::Display for SimpleError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                SimpleError::NotFound(id) => write!(f, "not found: {id}"),
                SimpleError::PermissionDenied => write!(f, "permission denied"),
            }
        }
    }

    impl crate::BridgeError for SimpleError {}

    #[test]
    fn bridge_error_display_not_found() {
        let err = SimpleError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "not found: abc-123");
    }

    #[test]
    fn bridge_error_display_permission_denied() {
        let err = SimpleError::PermissionDenied;
        assert_eq!(err.to_string(), "permission denied");
    }

    #[test]
    fn bridge_error_is_send() {
        fn assert_send<T: Send + 'static>() {}
        assert_send::<SimpleError>();
    }

    #[test]
    fn bridge_error_as_trait_object() {
        let err: Box<dyn crate::BridgeError> = Box::new(SimpleError::NotFound("x".into()));
        assert_eq!(err.to_string(), "not found: x");
    }

    // -----------------------------------------------------------------------
    // BridgeStructuredError — manual implementation (struct)
    // -----------------------------------------------------------------------

    #[derive(Debug)]
    struct RichError {
        code: u32,
        message: String,
        details: Option<String>,
    }

    impl std::fmt::Display for RichError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "[{}] {}", self.code, self.message)
        }
    }

    impl crate::BridgeError for RichError {}

    impl BridgeStructuredError for RichError {
        fn to_bridge_value(&self) -> serde_json::Value {
            let mut map = serde_json::Map::new();
            map.insert("code".into(), serde_json::Value::Number(self.code.into()));
            map.insert(
                "message".into(),
                serde_json::Value::String(self.message.clone()),
            );
            if let Some(ref d) = self.details {
                map.insert("details".into(), serde_json::Value::String(d.clone()));
            }
            serde_json::Value::Object(map)
        }
    }

    #[test]
    fn structured_error_display() {
        let err = RichError {
            code: 404,
            message: "not found".into(),
            details: None,
        };
        assert_eq!(err.to_string(), "[404] not found");
    }

    #[test]
    fn structured_error_to_bridge_value_without_details() {
        let err = RichError {
            code: 404,
            message: "not found".into(),
            details: None,
        };
        let val = err.to_bridge_value();
        assert_eq!(val["code"], 404);
        assert_eq!(val["message"], "not found");
        assert!(val.get("details").is_none());
    }

    #[test]
    fn structured_error_to_bridge_value_with_details() {
        let err = RichError {
            code: 500,
            message: "internal error".into(),
            details: Some("stack overflow in module X".into()),
        };
        let val = err.to_bridge_value();
        assert_eq!(val["code"], 500);
        assert_eq!(val["message"], "internal error");
        assert_eq!(val["details"], "stack overflow in module X");
    }

    #[test]
    fn structured_error_value_is_object() {
        let err = RichError {
            code: 422,
            message: "validation failed".into(),
            details: None,
        };
        let val = err.to_bridge_value();
        assert!(val.is_object(), "expected JSON object, got: {val}");
    }

    #[test]
    fn structured_error_as_trait_object() {
        let err: Box<dyn BridgeStructuredError> = Box::new(RichError {
            code: 403,
            message: "forbidden".into(),
            details: Some("insufficient scope".into()),
        });
        assert_eq!(err.to_string(), "[403] forbidden");
        let val = err.to_bridge_value();
        assert_eq!(val["code"], 403);
        assert_eq!(val["details"], "insufficient scope");
    }

    #[test]
    fn structured_error_is_send() {
        fn assert_send<T: Send + 'static>() {}
        assert_send::<RichError>();
    }

    // -----------------------------------------------------------------------
    // BridgeStructuredError — enum with serde_json::json! macro
    // -----------------------------------------------------------------------

    #[derive(Debug)]
    enum ApiError {
        Unauthorized,
        RateLimited { retry_after_secs: u64 },
    }

    impl std::fmt::Display for ApiError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                ApiError::Unauthorized => write!(f, "unauthorized"),
                ApiError::RateLimited { retry_after_secs } => {
                    write!(f, "rate limited, retry after {retry_after_secs}s")
                }
            }
        }
    }

    impl crate::BridgeError for ApiError {}

    impl BridgeStructuredError for ApiError {
        fn to_bridge_value(&self) -> serde_json::Value {
            match self {
                ApiError::Unauthorized => serde_json::json!({
                    "kind": "unauthorized"
                }),
                ApiError::RateLimited { retry_after_secs } => serde_json::json!({
                    "kind": "rate_limited",
                    "retryAfterSecs": retry_after_secs
                }),
            }
        }
    }

    #[test]
    fn api_error_unauthorized_display() {
        assert_eq!(ApiError::Unauthorized.to_string(), "unauthorized");
    }

    #[test]
    fn api_error_unauthorized_structured() {
        let val = ApiError::Unauthorized.to_bridge_value();
        assert_eq!(val["kind"], "unauthorized");
    }

    #[test]
    fn api_error_rate_limited_display() {
        let err = ApiError::RateLimited {
            retry_after_secs: 30,
        };
        assert_eq!(err.to_string(), "rate limited, retry after 30s");
    }

    #[test]
    fn api_error_rate_limited_structured() {
        let err = ApiError::RateLimited {
            retry_after_secs: 60,
        };
        let val = err.to_bridge_value();
        assert_eq!(val["kind"], "rate_limited");
        assert_eq!(val["retryAfterSecs"], 60);
    }

    // -----------------------------------------------------------------------
    // Wire-level error formatting (Track R3) — `WrapErr` autoref dispatch
    // -----------------------------------------------------------------------

    #[test]
    fn wrap_err_structured_emits_sentinel_envelope() {
        // ApiError implements BridgeStructuredError → tagged JSON.
        let err = ApiError::Unauthorized;
        let s = WrapErr(&err).bridge_format();
        assert!(s.starts_with(BRIDGE_ERROR_SENTINEL), "got: {s}");
        let payload = s.strip_prefix(BRIDGE_ERROR_SENTINEL).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(parsed["kind"], "unauthorized");
    }

    #[test]
    fn wrap_err_structured_payload_round_trips() {
        let err = ApiError::RateLimited {
            retry_after_secs: 30,
        };
        let wire = WrapErr(&err).bridge_format();
        let parsed = parse_bridge_error(&wire).expect("structured envelope");
        assert_eq!(parsed["kind"], "rate_limited");
        assert_eq!(parsed["retryAfterSecs"], 30);
    }

    // Plain `Display` error (does NOT implement BridgeStructuredError)
    // must fall through to the trait fallback — no sentinel prefix.
    #[derive(Debug)]
    struct PlainDisplay(&'static str);

    impl std::fmt::Display for PlainDisplay {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(self.0)
        }
    }

    #[test]
    fn wrap_err_plain_display_falls_through() {
        // Bring the fallback trait into scope so method resolution sees
        // it. (Real call sites do `use bridge_types::BridgeFormatFallback as _`.)
        use BridgeFormatFallback as _;
        let err = PlainDisplay("plain error message");
        let s = WrapErr(&err).bridge_format();
        assert_eq!(s, "plain error message");
        assert!(parse_bridge_error(&s).is_none());
    }

    #[test]
    fn wrap_err_plain_display_string_falls_through() {
        use BridgeFormatFallback as _;
        let err = "raw string error".to_string();
        let s = WrapErr(&err).bridge_format();
        assert_eq!(s, "raw string error");
    }

    #[test]
    fn parse_bridge_error_returns_none_for_plain() {
        assert!(parse_bridge_error("just a normal error").is_none());
        assert!(parse_bridge_error("").is_none());
    }

    #[test]
    fn parse_bridge_error_returns_none_for_malformed_payload() {
        // Sentinel present but payload isn't valid JSON → None.
        let s = format!("{BRIDGE_ERROR_SENTINEL}not json");
        assert!(parse_bridge_error(&s).is_none());
    }

    #[test]
    fn sentinel_is_byte_for_byte_stable() {
        // The sentinel string is part of the wire contract — locking it
        // down here so renames force the TS parser to be updated too.
        assert_eq!(BRIDGE_ERROR_SENTINEL, "[BRIDGE_ERROR]");
    }

    #[test]
    fn bridge_format_err_macro_structured() {
        let err = ApiError::RateLimited {
            retry_after_secs: 7,
        };
        let s = crate::bridge_format_err!(err);
        assert!(s.starts_with(BRIDGE_ERROR_SENTINEL), "got: {s}");
        let parsed = parse_bridge_error(&s).unwrap();
        assert_eq!(parsed["kind"], "rate_limited");
        assert_eq!(parsed["retryAfterSecs"], 7);
    }

    #[test]
    fn bridge_format_err_macro_plain_display() {
        let err = PlainDisplay("oops");
        let s = crate::bridge_format_err!(err);
        assert_eq!(s, "oops");
        assert!(parse_bridge_error(&s).is_none());
    }

    // Transport-boundary uniformity: WASM and NAPI generators both emit
    // `bridge_types::bridge_format_err!(e)` at every error site (see
    // `infra/rust-bridge/bridge-{wasm,napi,tauri}/macros/src/expand*.rs`).
    // So the byte-for-byte envelope is identical by construction. This
    // test pins that the macro output is the exact wire payload — if a
    // transport ever wraps it, this test is the canary.
    #[test]
    fn macro_output_is_uniform_across_transport_call_shape() {
        let err = ApiError::RateLimited {
            retry_after_secs: 99,
        };
        // Three call shapes simulating the three transport patterns:
        //   WASM:  &bridge_format_err!(e)              (passed to JsError::new)
        //   NAPI:  bridge_format_err!(e)               (passed to napi::Error::from_reason)
        //   Tauri: bridge_format_err!(e)               (returned as String)
        let wasm_form = crate::bridge_format_err!(err).to_string();
        let napi_form = crate::bridge_format_err!(err);
        let tauri_form: String = crate::bridge_format_err!(err);
        assert_eq!(wasm_form, napi_form);
        assert_eq!(napi_form, tauri_form);
        // And each parses to the same structured payload.
        let parsed = parse_bridge_error(&wasm_form).unwrap();
        assert_eq!(parsed["kind"], "rate_limited");
        assert_eq!(parsed["retryAfterSecs"], 99);
    }
}
