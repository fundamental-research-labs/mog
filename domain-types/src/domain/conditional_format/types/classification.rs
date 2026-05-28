use serde::de::IntoDeserializer;
use serde::{Deserialize, Serialize};

/// Conditional formatting rule types (Excel-compatible).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFRuleType {
    CellValue,
    #[serde(alias = "expression")]
    Formula,
    ColorScale,
    DataBar,
    IconSet,
    Top10,
    AboveAverage,
    DuplicateValues,
    ContainsText,
    #[serde(alias = "notContainsText")]
    NotContainsText,
    #[serde(alias = "beginsWith")]
    BeginsWith,
    #[serde(alias = "endsWith")]
    EndsWith,
    ContainsBlanks,
    NotContainsBlanks,
    ContainsErrors,
    NotContainsErrors,
    TimePeriod,
}

/// Comparison operators for cellValue rules.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFOperator {
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Equal,
    NotEqual,
    Between,
    NotBetween,
}

impl CFOperator {
    /// Deserialize an OOXML operator token (e.g. `"greaterThan"`) into the typed enum.
    ///
    /// Returns `None` if `s` is not a recognized OOXML operator token. Does not
    /// panic on arbitrary input; malformed tokens yield `None` via serde's
    /// standard deserialization error path.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        let de: serde::de::value::StrDeserializer<serde::de::value::Error> = s.into_deserializer();
        Self::deserialize(de).ok()
    }
}

/// Text operators for containsText rules.
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum CFTextOperator {
    Contains,
    NotContains,
    BeginsWith,
    EndsWith,
}

impl CFTextOperator {
    /// Deserialize an OOXML text operator token (e.g. `"beginsWith"`) into the typed enum.
    ///
    /// Returns `None` if `s` is not a recognized token. Does not panic on
    /// arbitrary input.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        let de: serde::de::value::StrDeserializer<serde::de::value::Error> = s.into_deserializer();
        Self::deserialize(de).ok()
    }
}

/// Date periods for timePeriod rules (Excel-compatible).
#[derive(Deserialize, Serialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DatePeriod {
    Yesterday,
    Today,
    Tomorrow,
    Last7Days,
    LastWeek,
    ThisWeek,
    NextWeek,
    LastMonth,
    ThisMonth,
    NextMonth,
    LastQuarter,
    ThisQuarter,
    NextQuarter,
    LastYear,
    ThisYear,
    NextYear,
}

impl DatePeriod {
    /// Deserialize an OOXML time-period token (e.g. `"last7Days"`) into the typed enum.
    ///
    /// Returns `None` if `s` is not a recognized token. Does not panic on
    /// arbitrary input.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        let de: serde::de::value::StrDeserializer<serde::de::value::Error> = s.into_deserializer();
        Self::deserialize(de).ok()
    }
}
