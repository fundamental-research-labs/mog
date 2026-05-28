// ============================================================================
// CfOperator - Conditional formatting operator
// ============================================================================

/// Conditional formatting operator (ST_ConditionalFormattingOperator).
///
/// Used for cell value comparison rules.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"lessThan"`, `"containsText"`),
/// matching what `from_ooxml` / `to_ooxml` produce. This keeps JSON wire and
/// Yrs storage byte-compatible with the pre-Round-D `String` field shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfOperator {
    /// Less than comparison
    #[default]
    #[serde(rename = "lessThan")]
    LessThan,
    /// Less than or equal comparison
    #[serde(rename = "lessThanOrEqual")]
    LessThanOrEqual,
    /// Equal comparison
    #[serde(rename = "equal")]
    Equal,
    /// Not equal comparison
    #[serde(rename = "notEqual")]
    NotEqual,
    /// Greater than or equal comparison
    #[serde(rename = "greaterThanOrEqual")]
    GreaterThanOrEqual,
    /// Greater than comparison
    #[serde(rename = "greaterThan")]
    GreaterThan,
    /// Between two values (inclusive)
    #[serde(rename = "between")]
    Between,
    /// Not between two values
    #[serde(rename = "notBetween")]
    NotBetween,
    /// Contains text (for text rules)
    #[serde(rename = "containsText")]
    ContainsText,
    /// Does not contain text (for text rules)
    #[serde(rename = "notContains")]
    NotContains,
    /// Begins with text (for text rules)
    #[serde(rename = "beginsWith")]
    BeginsWith,
    /// Ends with text (for text rules)
    #[serde(rename = "endsWith")]
    EndsWith,
}

impl CfOperator {
    /// Strict parse from an OOXML attribute value. Returns `None` on any
    /// token not in the OOXML spec. Callers must handle `None` explicitly
    /// — silently defaulting an unknown operator would corrupt data (a
    /// `>=` rule silently becoming `<` is worse than loud rejection).
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "lessThan" => Self::LessThan,
            "lessThanOrEqual" => Self::LessThanOrEqual,
            "equal" => Self::Equal,
            "notEqual" => Self::NotEqual,
            "greaterThanOrEqual" => Self::GreaterThanOrEqual,
            "greaterThan" => Self::GreaterThan,
            "between" => Self::Between,
            "notBetween" => Self::NotBetween,
            "containsText" => Self::ContainsText,
            "notContains" => Self::NotContains,
            "beginsWith" => Self::BeginsWith,
            "endsWith" => Self::EndsWith,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::LessThan => "lessThan",
            Self::LessThanOrEqual => "lessThanOrEqual",
            Self::Equal => "equal",
            Self::NotEqual => "notEqual",
            Self::GreaterThanOrEqual => "greaterThanOrEqual",
            Self::GreaterThan => "greaterThan",
            Self::Between => "between",
            Self::NotBetween => "notBetween",
            Self::ContainsText => "containsText",
            Self::NotContains => "notContains",
            Self::BeginsWith => "beginsWith",
            Self::EndsWith => "endsWith",
        }
    }
}

// ============================================================================
// CfTimePeriod - Time period for date-based conditional formatting
// ============================================================================

/// Time period for date-based conditional formatting (ST_TimePeriod).
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"today"`, `"last7Days"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfTimePeriod {
    /// Today
    #[default]
    #[serde(rename = "today")]
    Today,
    /// Yesterday
    #[serde(rename = "yesterday")]
    Yesterday,
    /// Tomorrow
    #[serde(rename = "tomorrow")]
    Tomorrow,
    /// Last 7 days
    #[serde(rename = "last7Days")]
    Last7Days,
    /// This month
    #[serde(rename = "thisMonth")]
    ThisMonth,
    /// Last month
    #[serde(rename = "lastMonth")]
    LastMonth,
    /// Next month
    #[serde(rename = "nextMonth")]
    NextMonth,
    /// This week
    #[serde(rename = "thisWeek")]
    ThisWeek,
    /// Last week
    #[serde(rename = "lastWeek")]
    LastWeek,
    /// Next week
    #[serde(rename = "nextWeek")]
    NextWeek,
}

impl CfTimePeriod {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "today" => Self::Today,
            "yesterday" => Self::Yesterday,
            "tomorrow" => Self::Tomorrow,
            "last7Days" => Self::Last7Days,
            "thisMonth" => Self::ThisMonth,
            "lastMonth" => Self::LastMonth,
            "nextMonth" => Self::NextMonth,
            "thisWeek" => Self::ThisWeek,
            "lastWeek" => Self::LastWeek,
            "nextWeek" => Self::NextWeek,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Today => "today",
            Self::Yesterday => "yesterday",
            Self::Tomorrow => "tomorrow",
            Self::Last7Days => "last7Days",
            Self::ThisMonth => "thisMonth",
            Self::LastMonth => "lastMonth",
            Self::NextMonth => "nextMonth",
            Self::ThisWeek => "thisWeek",
            Self::LastWeek => "lastWeek",
            Self::NextWeek => "nextWeek",
        }
    }
}

// ============================================================================
// CfvoType - CFVO (Conditional Format Value Object) type
// ============================================================================

/// CFVO type (ST_CfvoType) -- for color scales, data bars, icon sets.
///
/// Includes AutoMin/AutoMax from the Excel 2010+ extension namespace.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"num"`, `"autoMin"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfvoType {
    /// Numeric value
    #[default]
    #[serde(rename = "num")]
    Num,
    /// Percentage value
    #[serde(rename = "percent")]
    Percent,
    /// Maximum value
    #[serde(rename = "max")]
    Max,
    /// Minimum value
    #[serde(rename = "min")]
    Min,
    /// Formula value
    #[serde(rename = "formula")]
    Formula,
    /// Percentile value
    #[serde(rename = "percentile")]
    Percentile,
    /// Automatic minimum (Excel 2010+)
    #[serde(rename = "autoMin")]
    AutoMin,
    /// Automatic maximum (Excel 2010+)
    #[serde(rename = "autoMax")]
    AutoMax,
}

impl CfvoType {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "num" => Self::Num,
            "percent" => Self::Percent,
            "max" => Self::Max,
            "min" => Self::Min,
            "formula" => Self::Formula,
            "percentile" => Self::Percentile,
            "autoMin" => Self::AutoMin,
            "autoMax" => Self::AutoMax,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Num => "num",
            Self::Percent => "percent",
            Self::Max => "max",
            Self::Min => "min",
            Self::Formula => "formula",
            Self::Percentile => "percentile",
            Self::AutoMin => "autoMin",
            Self::AutoMax => "autoMax",
        }
    }
}
// ============================================================================
// CfRuleType - Conditional formatting rule type
// ============================================================================

/// Conditional formatting rule type (ECMA-376 ST_CfType).
///
/// Classifies what kind of conditional formatting rule this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CfRuleType {
    /// Custom formula expression.
    #[default]
    Expression,
    /// Cell value comparison (uses operator + 1-2 values).
    CellIs,
    /// 2-color or 3-color gradient scale.
    ColorScale,
    /// In-cell data bar.
    DataBar,
    /// Conditional icon set.
    IconSet,
    /// Top/bottom N or N%.
    Top10,
    /// Unique values in range.
    UniqueValues,
    /// Duplicate values in range.
    DuplicateValues,
    /// Cell text contains substring.
    ContainsText,
    /// Cell text does not contain substring.
    NotContainsText,
    /// Cell text begins with prefix.
    BeginsWith,
    /// Cell text ends with suffix.
    EndsWith,
    /// Cell is blank.
    ContainsBlanks,
    /// Cell is not blank.
    NotContainsBlanks,
    /// Cell contains an error.
    ContainsErrors,
    /// Cell does not contain an error.
    NotContainsErrors,
    /// Date falls in time period.
    TimePeriod,
    /// Above or below average.
    AboveAverage,
}

impl CfRuleType {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "expression" => Self::Expression,
            "cellIs" => Self::CellIs,
            "colorScale" => Self::ColorScale,
            "dataBar" => Self::DataBar,
            "iconSet" => Self::IconSet,
            "top10" => Self::Top10,
            "uniqueValues" => Self::UniqueValues,
            "duplicateValues" => Self::DuplicateValues,
            "containsText" => Self::ContainsText,
            "notContainsText" => Self::NotContainsText,
            "beginsWith" => Self::BeginsWith,
            "endsWith" => Self::EndsWith,
            "containsBlanks" => Self::ContainsBlanks,
            "notContainsBlanks" => Self::NotContainsBlanks,
            "containsErrors" => Self::ContainsErrors,
            "notContainsErrors" => Self::NotContainsErrors,
            "timePeriod" => Self::TimePeriod,
            "aboveAverage" => Self::AboveAverage,
            _ => Self::Expression,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Expression => "expression",
            Self::CellIs => "cellIs",
            Self::ColorScale => "colorScale",
            Self::DataBar => "dataBar",
            Self::IconSet => "iconSet",
            Self::Top10 => "top10",
            Self::UniqueValues => "uniqueValues",
            Self::DuplicateValues => "duplicateValues",
            Self::ContainsText => "containsText",
            Self::NotContainsText => "notContainsText",
            Self::BeginsWith => "beginsWith",
            Self::EndsWith => "endsWith",
            Self::ContainsBlanks => "containsBlanks",
            Self::NotContainsBlanks => "notContainsBlanks",
            Self::ContainsErrors => "containsErrors",
            Self::NotContainsErrors => "notContainsErrors",
            Self::TimePeriod => "timePeriod",
            Self::AboveAverage => "aboveAverage",
        }
    }
}

// ============================================================================
// Structural types - CF building blocks
// ============================================================================
