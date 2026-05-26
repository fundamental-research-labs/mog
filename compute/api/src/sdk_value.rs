//! SDK value type for normalizing inputs from Python, JS, and other SDK targets.
//!
//! `SdkValue` bridges dynamically-typed SDK inputs (e.g. Python `None`, `int`,
//! `str`) into the typed `CellInput` enum. The `to_cell_input()` method
//! produces a `CellInput` that carries semantic intent (Clear, Literal, Parse)
//! across the SDK↔engine boundary — no in-band sentinels.

use compute_core::bridge_types::CellInput;

/// Value type for SDK inputs (Python, JavaScript, etc.).
///
/// Normalizes dynamically-typed values into a typed `CellInput` for the
/// engine's parsed-input path.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SdkValue {
    /// No value (Python `None`, JS `null`/`undefined`).
    Null,
    /// Boolean value.
    Bool(bool),
    /// Numeric value (f64 covers Python int/float, JS number).
    Number(f64),
    /// Text string.
    Text(String),
}

impl SdkValue {
    /// Convert to the typed `CellInput` expected by the engine.
    ///
    /// - `Null` → `CellInput::Clear`
    /// - `Bool` → `Parse("TRUE")` / `Parse("FALSE")`
    /// - `Number` → `Parse(int_or_float_string)`
    /// - `Text("")` → `Literal("")` (preserves empty-string vs. clear distinction)
    /// - `Text(s)` → `Parse(s)` (Excel-like parsing of formulas/numbers/text)
    pub fn to_cell_input(&self) -> CellInput {
        match self {
            SdkValue::Null => CellInput::Clear,
            SdkValue::Bool(b) => CellInput::Parse {
                text: if *b { "TRUE".into() } else { "FALSE".into() },
            },
            SdkValue::Number(n) => {
                let text = if *n == (*n as i64) as f64 && n.is_finite() {
                    format!("{}", *n as i64)
                } else {
                    format!("{}", n)
                };
                CellInput::Parse { text }
            }
            SdkValue::Text(s) if s.is_empty() => CellInput::Literal {
                text: String::new(),
            },
            SdkValue::Text(s) => CellInput::Parse { text: s.clone() },
        }
    }
}

// ===========================================================================
// From impls for ergonomic construction
// ===========================================================================

impl From<bool> for SdkValue {
    fn from(b: bool) -> Self {
        SdkValue::Bool(b)
    }
}

impl From<f64> for SdkValue {
    fn from(n: f64) -> Self {
        SdkValue::Number(n)
    }
}

impl From<i64> for SdkValue {
    fn from(n: i64) -> Self {
        SdkValue::Number(n as f64)
    }
}

impl From<i32> for SdkValue {
    fn from(n: i32) -> Self {
        SdkValue::Number(n as f64)
    }
}

impl From<String> for SdkValue {
    fn from(s: String) -> Self {
        SdkValue::Text(s)
    }
}

impl From<&str> for SdkValue {
    fn from(s: &str) -> Self {
        SdkValue::Text(s.to_string())
    }
}

impl<T: Into<SdkValue>> From<Option<T>> for SdkValue {
    fn from(opt: Option<T>) -> Self {
        match opt {
            Some(v) => v.into(),
            None => SdkValue::Null,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn null_to_clear() {
        assert_eq!(SdkValue::Null.to_cell_input(), CellInput::Clear);
    }

    #[test]
    fn bool_to_parse_uppercase() {
        assert_eq!(
            SdkValue::Bool(true).to_cell_input(),
            CellInput::Parse {
                text: "TRUE".into()
            }
        );
        assert_eq!(
            SdkValue::Bool(false).to_cell_input(),
            CellInput::Parse {
                text: "FALSE".into()
            }
        );
    }

    #[test]
    fn integer_number_no_decimal() {
        assert_eq!(
            SdkValue::Number(42.0).to_cell_input(),
            CellInput::Parse { text: "42".into() }
        );
        assert_eq!(
            SdkValue::Number(-7.0).to_cell_input(),
            CellInput::Parse { text: "-7".into() }
        );
        assert_eq!(
            SdkValue::Number(0.0).to_cell_input(),
            CellInput::Parse { text: "0".into() }
        );
    }

    #[test]
    fn float_number_keeps_decimal() {
        assert_eq!(
            SdkValue::Number(3.14).to_cell_input(),
            CellInput::Parse {
                text: "3.14".into()
            }
        );
        assert_eq!(
            SdkValue::Number(-0.5).to_cell_input(),
            CellInput::Parse {
                text: "-0.5".into()
            }
        );
    }

    #[test]
    fn non_finite_number() {
        let inf = SdkValue::Number(f64::INFINITY);
        assert_eq!(inf.to_cell_input(), CellInput::Parse { text: "inf".into() });
        let nan = SdkValue::Number(f64::NAN);
        assert_eq!(nan.to_cell_input(), CellInput::Parse { text: "NaN".into() });
    }

    #[test]
    fn text_passthrough_parses() {
        assert_eq!(
            SdkValue::Text("hello".into()).to_cell_input(),
            CellInput::Parse {
                text: "hello".into()
            }
        );
        assert_eq!(
            SdkValue::Text("=SUM(A1:A10)".into()).to_cell_input(),
            CellInput::Parse {
                text: "=SUM(A1:A10)".into()
            }
        );
    }

    #[test]
    fn empty_text_becomes_literal_not_sentinel() {
        // Regression: Text("") must map to Literal(""), not a magic-byte
        // encoded Parse. This is the whole point of sub-scope sub-scope A.
        assert_eq!(
            SdkValue::Text(String::new()).to_cell_input(),
            CellInput::Literal {
                text: String::new()
            }
        );
    }

    #[test]
    fn from_impls() {
        let _: SdkValue = true.into();
        let _: SdkValue = 42.0_f64.into();
        let _: SdkValue = 42_i64.into();
        let _: SdkValue = 42_i32.into();
        let _: SdkValue = "hello".into();
        let _: SdkValue = String::from("hello").into();
        let _: SdkValue = None::<f64>.into();
        let _: SdkValue = Some(42.0_f64).into();
    }
}
