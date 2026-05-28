use ooxml_types::cond_format::CfvoType;
use serde::{Deserialize, Serialize};

/// Typed boundary value for a color-scale / data-bar / icon-set point.
///
/// Replaces the former `value_type: CfvoType` + `value:
/// Option<serde_json::Value>` pair with a single tagged enum. The pair was a
/// typed union ("kind" + "payload") pushed through `serde_json::Value`
/// because `domain-types` did not have a typed spelling for the payload. Each
/// variant carries exactly the data that boundary kind needs (or `()` for
/// min/max / auto-min/auto-max).
///
/// Wire shape: `{ "kind": "num"|"percent"|... , "value": <payload> }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CFValueRef {
    /// Numeric threshold (`cfvo.type="num"`).
    #[serde(rename = "num")]
    Number { value: f64 },
    /// Percent along the [min, max] range (`cfvo.type="percent"`).
    Percent { value: f64 },
    /// Percentile over the evaluated range (`cfvo.type="percentile"`).
    Percentile { value: f64 },
    /// Formula whose result is coerced to a numeric threshold
    /// (`cfvo.type="formula"`). The formula text is preserved verbatim
    /// for round-trip; parsing happens at the compute-cf boundary.
    Formula { source: String },
    /// Automatic minimum of the evaluated range (`cfvo.type="min"`).
    Min,
    /// Automatic maximum of the evaluated range (`cfvo.type="max"`).
    Max,
    /// Excel 2010+ extension: auto-computed minimum
    /// (`cfvo.type="autoMin"`). Preserved for round-trip with files
    /// written by Excel 2010+.
    AutoMin,
    /// Excel 2010+ extension: auto-computed maximum
    /// (`cfvo.type="autoMax"`).
    AutoMax,
}

impl Default for CFValueRef {
    fn default() -> Self {
        // Match the pre-typed-OOXML-preservation default: `value_type: CfvoType::Num`
        // (the CfvoType::default()) + `value: None` flattened to a
        // number point whose value is zero. Existing consumers that
        // default-constructed a `CFColorPoint` then assigned fields
        // continue to behave identically — the `value_type=Num, value=None`
        // combination never appeared on a valid rule.
        Self::Number { value: 0.0 }
    }
}

impl CFValueRef {
    /// Returns the corresponding OOXML `ST_CfvoType` token.
    pub fn cfvo_type(&self) -> CfvoType {
        match self {
            Self::Number { .. } => CfvoType::Num,
            Self::Percent { .. } => CfvoType::Percent,
            Self::Percentile { .. } => CfvoType::Percentile,
            Self::Formula { .. } => CfvoType::Formula,
            Self::Min => CfvoType::Min,
            Self::Max => CfvoType::Max,
            Self::AutoMin => CfvoType::AutoMin,
            Self::AutoMax => CfvoType::AutoMax,
        }
    }

    /// Returns the numeric payload if this variant carries one.
    pub fn number_value(&self) -> Option<f64> {
        match self {
            Self::Number { value } | Self::Percent { value } | Self::Percentile { value } => {
                Some(*value)
            }
            _ => None,
        }
    }

    /// Build a typed value from an OOXML `<cfvo>` `(type, val)` pair.
    /// `val` is the raw `val=` attribute string; numeric variants parse
    /// it as `f64` falling back to `0.0` (matching the historical
    /// forgiving parse via `serde_json::Value`). The formula variant
    /// preserves the attribute verbatim.
    pub fn from_ooxml(cfvo_type: CfvoType, val: Option<&str>) -> Self {
        match cfvo_type {
            CfvoType::Num => Self::Number {
                value: val.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
            },
            CfvoType::Percent => Self::Percent {
                value: val.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
            },
            CfvoType::Percentile => Self::Percentile {
                value: val.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0),
            },
            CfvoType::Formula => Self::Formula {
                source: val.unwrap_or("").to_string(),
            },
            CfvoType::Min => Self::Min,
            CfvoType::Max => Self::Max,
            CfvoType::AutoMin => Self::AutoMin,
            CfvoType::AutoMax => Self::AutoMax,
        }
    }

    /// Returns the OOXML `val=` attribute contents for writer code that
    /// needs to emit the `val=` attribute verbatim.
    pub fn to_ooxml_val(&self) -> Option<String> {
        match self {
            Self::Number { value } | Self::Percent { value } | Self::Percentile { value } => {
                Some(format_f64_compact(*value))
            }
            Self::Formula { source } => Some(source.clone()),
            Self::Min | Self::Max | Self::AutoMin | Self::AutoMax => None,
        }
    }
}

/// Render an `f64` compactly for OOXML attribute emission — integer-
/// valued numbers produce their integer form ("50" not "50.0").
#[inline]
fn format_f64_compact(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e16 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}
