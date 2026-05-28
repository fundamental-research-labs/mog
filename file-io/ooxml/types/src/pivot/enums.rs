// ============================================================================
// PivotSourceType — ST_SourceType
// ============================================================================

/// Pivot cache data source type (ST_SourceType).
///
/// Identifies the kind of data source backing a pivot cache.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum PivotSourceType {
    /// Data sourced from a worksheet range (default).
    #[default]
    #[xml("worksheet")]
    Worksheet,
    /// Data sourced from an external connection.
    #[xml("external")]
    External,
    /// Data sourced from multiple consolidation ranges.
    #[xml("consolidation")]
    Consolidation,
    /// Data sourced from a scenario manager.
    #[xml("scenario")]
    Scenario,
}

// ============================================================================
// DataConsolidateFunction — ST_DataConsolidateFunction
// ============================================================================

/// Data consolidation function for pivot data fields (ST_DataConsolidateFunction).
///
/// Specifies the aggregation function applied to a data field.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DataConsolidateFunction {
    /// Average of values.
    #[xml("average")]
    Average,
    /// Count of values.
    #[xml("count")]
    Count,
    /// Count of numeric values.
    #[xml("countNums")]
    CountNums,
    /// Maximum value.
    #[xml("max")]
    Max,
    /// Minimum value.
    #[xml("min")]
    Min,
    /// Product of values.
    #[xml("product")]
    Product,
    /// Sample standard deviation.
    #[xml("stdDev")]
    StdDev,
    /// Population standard deviation.
    #[xml("stdDevp")]
    StdDevP,
    /// Sum of values (default).
    #[default]
    #[xml("sum")]
    Sum,
    /// Sample variance.
    #[xml("var")]
    Var,
    /// Population variance.
    #[xml("varp")]
    VarP,
}

// ============================================================================
// ShowDataAs — ST_ShowDataAs
// ============================================================================

/// Show data as calculation type (ST_ShowDataAs).
///
/// Controls how values in a data field are displayed relative to other values.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum ShowDataAs {
    /// Show actual values (default).
    #[default]
    #[xml("normal")]
    Normal,
    /// Show difference from a base item.
    #[xml("difference")]
    Difference,
    /// Show as percentage of a base item.
    #[xml("percent")]
    Percent,
    /// Show as percentage difference from a base item.
    #[xml("percentDiff")]
    PercentDiff,
    /// Show as running total.
    #[xml("runTotal")]
    RunTotal,
    /// Show as percentage of the row total.
    #[xml("percentOfRow")]
    PercentOfRow,
    /// Show as percentage of the column total.
    #[xml("percentOfCol")]
    PercentOfCol,
    /// Show as percentage of the grand total.
    #[xml("percentOfTotal")]
    PercentOfTotal,
    /// Show as index.
    #[xml("index")]
    Index,
}

// ============================================================================
// GroupBy — ST_GroupBy
// ============================================================================

/// Grouping interval for pivot field grouping (ST_GroupBy, §18.18.36).
///
/// Specifies the time/range interval used when grouping pivot field items.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum GroupBy {
    /// Group by numeric range (default).
    #[default]
    #[xml("range")]
    Range,
    /// Group by seconds.
    #[xml("seconds")]
    Seconds,
    /// Group by minutes.
    #[xml("minutes")]
    Minutes,
    /// Group by hours.
    #[xml("hours")]
    Hours,
    /// Group by days.
    #[xml("days")]
    Days,
    /// Group by months.
    #[xml("months")]
    Months,
    /// Group by quarters.
    #[xml("quarters")]
    Quarters,
    /// Group by years.
    #[xml("years")]
    Years,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pivot_source_type_roundtrip() {
        let variants = [
            (PivotSourceType::Worksheet, "worksheet"),
            (PivotSourceType::External, "external"),
            (PivotSourceType::Consolidation, "consolidation"),
            (PivotSourceType::Scenario, "scenario"),
        ];
        for (variant, s) in &variants {
            assert_eq!(PivotSourceType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                PivotSourceType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn data_consolidate_function_roundtrip() {
        let variants = [
            (DataConsolidateFunction::Average, "average"),
            (DataConsolidateFunction::Count, "count"),
            (DataConsolidateFunction::CountNums, "countNums"),
            (DataConsolidateFunction::Max, "max"),
            (DataConsolidateFunction::Min, "min"),
            (DataConsolidateFunction::Product, "product"),
            (DataConsolidateFunction::StdDev, "stdDev"),
            (DataConsolidateFunction::StdDevP, "stdDevp"),
            (DataConsolidateFunction::Sum, "sum"),
            (DataConsolidateFunction::Var, "var"),
            (DataConsolidateFunction::VarP, "varp"),
        ];
        for (variant, s) in &variants {
            assert_eq!(
                DataConsolidateFunction::from_ooxml(s),
                *variant,
                "from_ooxml({s})"
            );
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                DataConsolidateFunction::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn show_data_as_roundtrip() {
        let variants = [
            (ShowDataAs::Normal, "normal"),
            (ShowDataAs::Difference, "difference"),
            (ShowDataAs::Percent, "percent"),
            (ShowDataAs::PercentDiff, "percentDiff"),
            (ShowDataAs::RunTotal, "runTotal"),
            (ShowDataAs::PercentOfRow, "percentOfRow"),
            (ShowDataAs::PercentOfCol, "percentOfCol"),
            (ShowDataAs::PercentOfTotal, "percentOfTotal"),
            (ShowDataAs::Index, "index"),
        ];
        for (variant, s) in &variants {
            assert_eq!(ShowDataAs::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                ShowDataAs::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn group_by_roundtrip() {
        let variants = [
            (GroupBy::Range, "range"),
            (GroupBy::Seconds, "seconds"),
            (GroupBy::Minutes, "minutes"),
            (GroupBy::Hours, "hours"),
            (GroupBy::Days, "days"),
            (GroupBy::Months, "months"),
            (GroupBy::Quarters, "quarters"),
            (GroupBy::Years, "years"),
        ];
        for (variant, s) in &variants {
            assert_eq!(GroupBy::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                GroupBy::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
        assert_eq!(GroupBy::from_ooxml("bogus"), GroupBy::Range);
        assert_eq!(GroupBy::default(), GroupBy::Range);
    }

    #[test]
    fn unknown_enum_defaults() {
        assert_eq!(
            PivotSourceType::from_ooxml("bogus"),
            PivotSourceType::Worksheet
        );
        assert_eq!(
            PivotSourceType::from_bytes(b"bogus"),
            PivotSourceType::Worksheet
        );
        assert_eq!(
            DataConsolidateFunction::from_ooxml("bogus"),
            DataConsolidateFunction::Sum
        );
        assert_eq!(
            DataConsolidateFunction::from_bytes(b"bogus"),
            DataConsolidateFunction::Sum
        );
        assert_eq!(ShowDataAs::from_ooxml("bogus"), ShowDataAs::Normal);
        assert_eq!(ShowDataAs::from_bytes(b"bogus"), ShowDataAs::Normal);
    }
}
