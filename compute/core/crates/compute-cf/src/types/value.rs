//! Typed conditional-format value — replacement for `CFRuleWire.values: Vec<String>`.
//!
//! Landed as the migration target in typed formula boundary [`CfValue`] replaces the
//! lossy `json_value_to_string` → `.parse::<f64>()` encoder/decoder pair that
//! previously round-tripped threshold operands through `String`.
//!
//! # Serde shape
//!
//! **Serialization** emits a tagged struct form: `{"kind":"number","value":42}`
//! etc. Round-trip with [`CfValue`] as both producer and consumer is asserted
//! via the proptest at the bottom of this file.
//!
//! **Deserialization** accepts both the tagged form *and* natural scalar JSON:
//! a bare string, number, bool, or null deserializes into the matching
//! variant. This keeps existing `CFRuleWire` test JSON (which uses
//! `"values": ["100"]` / `"values": [100]` shorthand) working without a
//! per-test rewrite, and is forgiving for callers that never learned the
//! tagged form. `CFRuleWire` is Rust-internal — no TS boundary coordinates
//! on this shape, so the flexibility is purely an implementation convenience.

use compute_parser::FormulaSource;
use serde::de::{self, MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

/// Value carried by a conditional-formatting rule threshold / operand.
///
/// Each CF rule can compare a cell against one or more operand values (e.g.
/// `A1 > 10` → `values = [CfValue::Number(10.0)]`; `between 1 and 5` → two
/// operands; `is formula =A$1-1` → single formula operand).
///
/// `Formula` owns the parsed AST plus original bytes via [`FormulaSource`] so
/// the writer path can emit the author's text verbatim — CF rules round-trip
/// through XLSX with cosmetic whitespace/case that the parser normalizes.
///
/// `Null` covers the gap in operand slots — some rule types (e.g. `equal` with
/// omitted second operand) serialize as `null`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CfValue {
    /// Numeric threshold.
    Number {
        /// The scalar value.
        value: f64,
    },
    /// Text threshold (e.g. `contains "foo"`).
    Text {
        /// The string value.
        value: String,
    },
    /// Boolean threshold.
    Bool {
        /// The boolean value.
        value: bool,
    },
    /// Formula threshold. Carries parsed AST + original source for writer
    /// fidelity — `original` is what gets emitted on round-trip.
    Formula {
        /// Original formula source (includes leading `=` if the input had one).
        source: String,
    },
    /// Missing / omitted operand slot.
    Null,
}

impl CfValue {
    /// Construct a formula `CfValue` from a [`FormulaSource`].
    ///
    /// Only the `original` bytes travel through serde — the AST is re-parsed
    /// on demand at the consuming site via [`FormulaSource::parse`].
    #[must_use]
    pub fn from_formula_source(fs: &FormulaSource) -> Self {
        Self::Formula {
            source: fs.original.clone(),
        }
    }

    /// Re-materialize the [`FormulaSource`] AST for a `Formula` variant.
    ///
    /// Returns `None` for any other variant.
    #[must_use]
    pub fn to_formula_source(&self) -> Option<FormulaSource> {
        match self {
            Self::Formula { source } => Some(FormulaSource::parse(source)),
            _ => None,
        }
    }

    /// Lower a `serde_json::Value` into a typed `CfValue`.
    ///
    /// Used at the domain → wire conversion boundary
    /// (`compute/core/src/storage/engine/cf_cache.rs`) where upstream CF-rule
    /// fields (`CFColorPoint.value`, `CFRule::CellValue.value1`/`value2`) are
    /// still typed as `serde_json::Value` in the domain schema.
    ///
    /// Mapping:
    /// * `Bool` → [`Self::Bool`]
    /// * `Number` → [`Self::Number`] (non-finite JSON numbers are impossible
    ///   per the JSON grammar; `serde_json::Number::as_f64` returns `Some`
    ///   for any value serde accepts)
    /// * `String` → [`Self::Text`] (no attempt to parse digits as numbers —
    ///   type discrimination lives at the producer)
    /// * `Null` → [`Self::Null`]
    /// * `Array` / `Object` → [`Self::Text`] carrying the JSON rendering.
    ///   Composite JSON values should not appear in CF rule operands; if they
    ///   do the text form is preserved verbatim rather than collapsing to
    ///   `Null`, so the downstream string-comparison branch still has
    ///   something meaningful to match.
    #[must_use]
    pub fn from_json_value(v: &serde_json::Value) -> Self {
        match v {
            serde_json::Value::Bool(b) => Self::Bool { value: *b },
            serde_json::Value::Number(n) => Self::Number {
                value: n.as_f64().unwrap_or(f64::NAN),
            },
            serde_json::Value::String(s) => Self::Text { value: s.clone() },
            serde_json::Value::Null => Self::Null,
            other => Self::Text {
                value: other.to_string(),
            },
        }
    }

    /// Best-effort numeric coercion for thresholds that flow into numeric CF
    /// comparison (Between, GreaterThan, etc.).
    ///
    /// Semantics:
    /// * `Number(n)` → `Some(n)`
    /// * `Bool(true)` → `Some(1.0)`, `Bool(false)` → `Some(0.0)`
    /// * `Text(s)` → `s.parse::<f64>().ok()` — mirrors the legacy
    ///   `.parse::<f64>()` fallback so numeric-looking user input in text
    ///   form still participates in numeric comparison
    /// * `Formula` / `Null` → `None`
    #[must_use]
    pub fn as_number(&self) -> Option<f64> {
        match self {
            Self::Number { value } => Some(*value),
            Self::Bool { value } => Some(if *value { 1.0 } else { 0.0 }),
            Self::Text { value } => value.parse::<f64>().ok(),
            Self::Formula { .. } | Self::Null => None,
        }
    }

    /// Textual rendering suitable for string-comparison thresholds and error
    /// messages. Parallels the string form `json_value_to_string` produced
    /// before W8 — preserved so `CellValueSingleOp::Equal`/`NotEqual` against
    /// a text cell keep their behavior (e.g. `CfValue::Bool(true)` matches a
    /// text cell `"TRUE"` case-insensitively, matching Excel semantics for
    /// the mixed-type path).
    #[must_use]
    pub fn display_text(&self) -> String {
        match self {
            Self::Number { value } => value.to_string(),
            Self::Text { value } => value.clone(),
            Self::Bool { value } => {
                if *value {
                    "TRUE".to_string()
                } else {
                    "FALSE".to_string()
                }
            }
            Self::Formula { source } => source.clone(),
            Self::Null => String::new(),
        }
    }
}

// ── Deserialize ─────────────────────────────────────────────────────────
//
// Accept both the tagged form (`{"kind":"number","value":42}`) emitted by
// the `Serialize` derive *and* natural JSON scalars (a bare number, string,
// bool, or null). Rationale: `CFRuleWire` unit tests use shorthand JSON
// literals like `"values": ["100"]`; wiring those through a hand-written
// deserializer is cheaper than rewriting every test fixture.

impl<'de> Deserialize<'de> for CfValue {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(CfValueVisitor)
    }
}

struct CfValueVisitor;

impl<'de> Visitor<'de> for CfValueVisitor {
    type Value = CfValue;

    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a CF threshold value: scalar (number/string/bool/null) or tagged object")
    }

    fn visit_bool<E: de::Error>(self, v: bool) -> Result<CfValue, E> {
        Ok(CfValue::Bool { value: v })
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<CfValue, E> {
        Ok(CfValue::Number { value: v as f64 })
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<CfValue, E> {
        Ok(CfValue::Number { value: v as f64 })
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<CfValue, E> {
        Ok(CfValue::Number { value: v })
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<CfValue, E> {
        Ok(CfValue::Text {
            value: v.to_string(),
        })
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<CfValue, E> {
        Ok(CfValue::Text { value: v })
    }

    fn visit_unit<E: de::Error>(self) -> Result<CfValue, E> {
        Ok(CfValue::Null)
    }

    fn visit_none<E: de::Error>(self) -> Result<CfValue, E> {
        Ok(CfValue::Null)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<CfValue, D::Error> {
        deserializer.deserialize_any(CfValueVisitor)
    }

    fn visit_map<M>(self, mut map: M) -> Result<CfValue, M::Error>
    where
        M: MapAccess<'de>,
    {
        // Tagged form: { "kind": "...", "value"|"source": ... }. We reconstruct
        // by collecting fields into a `serde_json::Value` and re-parsing into
        // the tagged-only shape. Going through `serde_json::Value` is fine
        // here: this path only fires for explicit tagged input, not for the
        // hot scalar path.
        let mut kind: Option<String> = None;
        let mut value: Option<serde_json::Value> = None;
        let mut source: Option<String> = None;

        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "kind" => {
                    if kind.is_some() {
                        return Err(de::Error::duplicate_field("kind"));
                    }
                    kind = Some(map.next_value()?);
                }
                "value" => {
                    if value.is_some() {
                        return Err(de::Error::duplicate_field("value"));
                    }
                    value = Some(map.next_value()?);
                }
                "source" => {
                    if source.is_some() {
                        return Err(de::Error::duplicate_field("source"));
                    }
                    source = Some(map.next_value()?);
                }
                other => {
                    return Err(de::Error::unknown_field(
                        other,
                        &["kind", "value", "source"],
                    ));
                }
            }
        }

        let kind = kind.ok_or_else(|| de::Error::missing_field("kind"))?;
        match kind.as_str() {
            "number" => {
                let v = value.ok_or_else(|| de::Error::missing_field("value"))?;
                let n = v
                    .as_f64()
                    .ok_or_else(|| de::Error::custom("expected numeric `value` for number kind"))?;
                Ok(CfValue::Number { value: n })
            }
            "text" => {
                let v = value.ok_or_else(|| de::Error::missing_field("value"))?;
                let s = v
                    .as_str()
                    .ok_or_else(|| de::Error::custom("expected string `value` for text kind"))?;
                Ok(CfValue::Text {
                    value: s.to_string(),
                })
            }
            "bool" => {
                let v = value.ok_or_else(|| de::Error::missing_field("value"))?;
                let b = v
                    .as_bool()
                    .ok_or_else(|| de::Error::custom("expected boolean `value` for bool kind"))?;
                Ok(CfValue::Bool { value: b })
            }
            "formula" => {
                let s = source.ok_or_else(|| de::Error::missing_field("source"))?;
                Ok(CfValue::Formula { source: s })
            }
            "null" => Ok(CfValue::Null),
            other => Err(de::Error::unknown_variant(
                other,
                &["number", "text", "bool", "formula", "null"],
            )),
        }
    }
}

impl PartialEq for CfValue {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Number { value: a }, Self::Number { value: b }) => {
                (a.is_nan() && b.is_nan()) || a == b
            }
            (Self::Text { value: a }, Self::Text { value: b }) => a == b,
            (Self::Bool { value: a }, Self::Bool { value: b }) => a == b,
            (Self::Formula { source: a }, Self::Formula { source: b }) => a == b,
            (Self::Null, Self::Null) => true,
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(v: &CfValue) -> CfValue {
        let s = serde_json::to_string(v).unwrap();
        serde_json::from_str(&s).unwrap()
    }

    #[test]
    fn roundtrip_number() {
        let v = CfValue::Number { value: 42.5 };
        assert_eq!(roundtrip(&v), v);
    }

    #[test]
    fn roundtrip_text() {
        let v = CfValue::Text {
            value: "hello".into(),
        };
        assert_eq!(roundtrip(&v), v);
    }

    #[test]
    fn roundtrip_bool() {
        assert_eq!(
            roundtrip(&CfValue::Bool { value: true }),
            CfValue::Bool { value: true }
        );
        assert_eq!(
            roundtrip(&CfValue::Bool { value: false }),
            CfValue::Bool { value: false }
        );
    }

    #[test]
    fn roundtrip_formula() {
        let v = CfValue::Formula {
            source: "=A1+1".into(),
        };
        assert_eq!(roundtrip(&v), v);
    }

    #[test]
    fn roundtrip_null() {
        assert_eq!(roundtrip(&CfValue::Null), CfValue::Null);
    }

    #[test]
    fn from_formula_source_preserves_bytes() {
        let fs = FormulaSource::parse("=SUM(A:A)");
        let v = CfValue::from_formula_source(&fs);
        match &v {
            CfValue::Formula { source } => assert_eq!(source, "=SUM(A:A)"),
            other => panic!("expected Formula, got {other:?}"),
        }
    }

    #[test]
    fn to_formula_source_reparses() {
        let v = CfValue::Formula {
            source: "=A1+1".into(),
        };
        let fs = v.to_formula_source().unwrap();
        assert_eq!(fs.original, "=A1+1");
    }

    #[test]
    fn to_formula_source_on_non_formula() {
        assert!(CfValue::Null.to_formula_source().is_none());
        assert!(CfValue::Number { value: 1.0 }.to_formula_source().is_none());
    }

    #[test]
    fn partial_eq_nan_equal() {
        let a = CfValue::Number { value: f64::NAN };
        let b = CfValue::Number { value: f64::NAN };
        assert_eq!(a, b);
    }

    // ── Scalar-shorthand deserialization (typed formula boundary) ────────────────

    #[test]
    fn deserialize_bare_number() {
        let v: CfValue = serde_json::from_str("42").unwrap();
        assert_eq!(v, CfValue::Number { value: 42.0 });
    }

    #[test]
    fn deserialize_bare_float() {
        let v: CfValue = serde_json::from_str("12.34").unwrap();
        assert_eq!(v, CfValue::Number { value: 12.34 });
    }

    #[test]
    fn deserialize_bare_string() {
        let v: CfValue = serde_json::from_str("\"hello\"").unwrap();
        assert_eq!(
            v,
            CfValue::Text {
                value: "hello".into()
            }
        );
    }

    #[test]
    fn deserialize_bare_bool() {
        assert_eq!(
            serde_json::from_str::<CfValue>("true").unwrap(),
            CfValue::Bool { value: true }
        );
        assert_eq!(
            serde_json::from_str::<CfValue>("false").unwrap(),
            CfValue::Bool { value: false }
        );
    }

    #[test]
    fn deserialize_bare_null() {
        let v: CfValue = serde_json::from_str("null").unwrap();
        assert_eq!(v, CfValue::Null);
    }

    #[test]
    fn deserialize_tagged_formula() {
        let v: CfValue = serde_json::from_str(r#"{"kind":"formula","source":"=A1+1"}"#).unwrap();
        assert_eq!(
            v,
            CfValue::Formula {
                source: "=A1+1".into()
            }
        );
    }

    #[test]
    fn deserialize_tagged_scalars_also_work() {
        // Serialize output shape still parses back — strict tagged round-trip.
        let num: CfValue = serde_json::from_str(r#"{"kind":"number","value":7}"#).unwrap();
        assert_eq!(num, CfValue::Number { value: 7.0 });
        let t: CfValue = serde_json::from_str(r#"{"kind":"text","value":"x"}"#).unwrap();
        assert_eq!(
            t,
            CfValue::Text {
                value: "x".to_string()
            }
        );
        let b: CfValue = serde_json::from_str(r#"{"kind":"bool","value":true}"#).unwrap();
        assert_eq!(b, CfValue::Bool { value: true });
        let n: CfValue = serde_json::from_str(r#"{"kind":"null"}"#).unwrap();
        assert_eq!(n, CfValue::Null);
    }

    // ── from_json_value (typed formula boundary) ──────────────────────────────────

    #[test]
    fn from_json_value_maps_each_kind() {
        use serde_json::json;
        assert_eq!(
            CfValue::from_json_value(&json!(42)),
            CfValue::Number { value: 42.0 }
        );
        assert_eq!(
            CfValue::from_json_value(&json!(3.5)),
            CfValue::Number { value: 3.5 }
        );
        assert_eq!(
            CfValue::from_json_value(&json!("hello")),
            CfValue::Text {
                value: "hello".into()
            }
        );
        assert_eq!(
            CfValue::from_json_value(&json!(true)),
            CfValue::Bool { value: true }
        );
        assert_eq!(
            CfValue::from_json_value(&serde_json::Value::Null),
            CfValue::Null
        );
    }

    #[test]
    fn from_json_value_arrays_objects_go_to_text() {
        use serde_json::json;
        // Composite JSON values have no meaningful CF threshold mapping;
        // we preserve the text form rather than collapse to Null so the
        // downstream text-comparison branch has something to match.
        match CfValue::from_json_value(&json!([1, 2, 3])) {
            CfValue::Text { value } => assert!(value.contains('1')),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    // ── as_number / display_text (typed formula boundary) ─────────────────────────

    #[test]
    fn as_number_covers_all_variants() {
        assert_eq!(CfValue::Number { value: 5.0 }.as_number(), Some(5.0));
        assert_eq!(CfValue::Bool { value: true }.as_number(), Some(1.0));
        assert_eq!(CfValue::Bool { value: false }.as_number(), Some(0.0));
        assert_eq!(
            CfValue::Text {
                value: "7.5".into()
            }
            .as_number(),
            Some(7.5)
        );
        assert_eq!(
            CfValue::Text {
                value: "abc".into()
            }
            .as_number(),
            None
        );
        assert_eq!(
            CfValue::Formula {
                source: "=A1".into()
            }
            .as_number(),
            None
        );
        assert_eq!(CfValue::Null.as_number(), None);
    }

    #[test]
    fn display_text_excel_bool_spelling() {
        // Matches Excel's Text-coercion spelling for booleans, which is what
        // CF string-compare ("Equal"/"NotEqual" against a text cell "TRUE")
        // expects.
        assert_eq!(CfValue::Bool { value: true }.display_text(), "TRUE");
        assert_eq!(CfValue::Bool { value: false }.display_text(), "FALSE");
    }

    // ── Proptest: serde round-trip ─────────────────────────────────────

    use proptest::prelude::*;

    /// Generator for arbitrary `CfValue`, covering every variant.
    ///
    /// Numbers are drawn as `i64`-representable integers cast to `f64` — this
    /// side-steps a long-standing serde_json limitation: without the (non-
    /// default) `float_roundtrip` feature, round-tripping an arbitrary f64
    /// through JSON can lose the least-significant mantissa bit because
    /// serde_json's number parser doesn't use correctly-rounded `strtod`.
    /// Workspace-wide enabling of `float_roundtrip` is out of scope for W2;
    /// CF rule thresholds are user-entered scalars that fit comfortably in
    /// integer-castable ranges in practice, so exercising those here gives
    /// real round-trip coverage. Fractional and large-magnitude f64 values
    /// are covered by the unit tests above. NaN is excluded because
    /// `PartialEq` equality for `Number { NaN }` is tested separately.
    fn arb_cf_value() -> impl Strategy<Value = CfValue> {
        prop_oneof![
            // i32 → f64 is lossless (fits in 2^31 < 2^53 exact-integer range);
            // these values serialize as integer-looking JSON tokens that
            // serde_json parses back bit-exactly.
            any::<i32>().prop_map(|n| CfValue::Number {
                value: f64::from(n)
            }),
            any::<String>().prop_map(|value| CfValue::Text { value }),
            any::<bool>().prop_map(|value| CfValue::Bool { value }),
            any::<String>().prop_map(|source| CfValue::Formula { source }),
            Just(CfValue::Null),
        ]
    }

    proptest! {
        /// `CfValue` round-trips through JSON serde without loss for every
        /// variant. Ship criterion for the UTF-8 boundary guard migration (which
        /// replaces `CFRuleWire.values: Vec<String>` with `Vec<CfValue>`).
        #[test]
        fn proptest_cf_value_roundtrip(v in arb_cf_value()) {
            let s = serde_json::to_string(&v).expect("serialize");
            let v2: CfValue = serde_json::from_str(&s).expect("deserialize");
            prop_assert_eq!(v, v2);
        }
    }
}
