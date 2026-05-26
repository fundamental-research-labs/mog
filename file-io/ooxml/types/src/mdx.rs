//! MDX (Multidimensional Expressions) types (ECMA-376 Part 1, §18.10.1 — MDX Metadata).

// =============================================================================
// MdxFunctionType
// =============================================================================

/// MDX function type (ECMA-376 ST_MdxFunctionType, §18.18.44).
///
/// Identifies the kind of MDX function used in a metadata entry.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum MdxFunctionType {
    /// A member reference.
    #[default]
    Member,
    /// A set expression.
    Set,
    /// A property reference.
    Property,
    /// A visual totals function.
    Visual,
    /// A KPI (Key Performance Indicator) reference.
    Kpi,
    /// A calculated member.
    Calculated,
    /// A range.
    Range,
}

impl MdxFunctionType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "m" => Self::Member,
            "s" => Self::Set,
            "p" => Self::Property,
            "v" => Self::Visual,
            "k" => Self::Kpi,
            "c" => Self::Calculated,
            "r" => Self::Range,
            _ => Self::Member,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Member => "m",
            Self::Set => "s",
            Self::Property => "p",
            Self::Visual => "v",
            Self::Kpi => "k",
            Self::Calculated => "c",
            Self::Range => "r",
        }
    }
}

// =============================================================================
// MdxKpiProperty
// =============================================================================

/// MDX KPI property type (ECMA-376 ST_MdxKPIProperty, §18.18.45).
///
/// Identifies which aspect of a KPI is being referenced.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum MdxKpiProperty {
    /// The KPI value.
    #[default]
    Value,
    /// The KPI goal.
    Goal,
    /// The KPI status.
    Status,
    /// The KPI trend.
    Trend,
    /// The KPI weight.
    Weight,
    /// The current time member for the KPI.
    CurrentTimeMember,
}

impl MdxKpiProperty {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "v" => Self::Value,
            "g" => Self::Goal,
            "s" => Self::Status,
            "t" => Self::Trend,
            "w" => Self::Weight,
            "m" => Self::CurrentTimeMember,
            _ => Self::Value,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Value => "v",
            Self::Goal => "g",
            Self::Status => "s",
            Self::Trend => "t",
            Self::Weight => "w",
            Self::CurrentTimeMember => "m",
        }
    }
}

// =============================================================================
// MdxSetOrder
// =============================================================================

/// MDX set ordering (ECMA-376 ST_MdxSetOrder, §18.18.46).
///
/// Specifies how members in an MDX set are sorted.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum MdxSetOrder {
    /// No specific sort order.
    #[default]
    Unsorted,
    /// Ascending numeric order.
    Ascending,
    /// Descending numeric order.
    Descending,
    /// Ascending alphabetical order.
    AlphaAscending,
    /// Descending alphabetical order.
    AlphaDescending,
    /// Ascending natural order.
    NaturalAscending,
    /// Descending natural order.
    NaturalDescending,
}

impl MdxSetOrder {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "u" => Self::Unsorted,
            "a" => Self::Ascending,
            "d" => Self::Descending,
            "aa" => Self::AlphaAscending,
            "ad" => Self::AlphaDescending,
            "na" => Self::NaturalAscending,
            "nd" => Self::NaturalDescending,
            _ => Self::Unsorted,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Unsorted => "u",
            Self::Ascending => "a",
            Self::Descending => "d",
            Self::AlphaAscending => "aa",
            Self::AlphaDescending => "ad",
            Self::NaturalAscending => "na",
            Self::NaturalDescending => "nd",
        }
    }
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mdx_function_type_from_ooxml() {
        assert_eq!(MdxFunctionType::from_ooxml("m"), MdxFunctionType::Member);
        assert_eq!(MdxFunctionType::from_ooxml("s"), MdxFunctionType::Set);
        assert_eq!(MdxFunctionType::from_ooxml("p"), MdxFunctionType::Property);
        assert_eq!(MdxFunctionType::from_ooxml("v"), MdxFunctionType::Visual);
        assert_eq!(MdxFunctionType::from_ooxml("k"), MdxFunctionType::Kpi);
        assert_eq!(
            MdxFunctionType::from_ooxml("c"),
            MdxFunctionType::Calculated
        );
        assert_eq!(MdxFunctionType::from_ooxml("r"), MdxFunctionType::Range);
        // Unknown values fall back to default
        assert_eq!(
            MdxFunctionType::from_ooxml("unknown"),
            MdxFunctionType::Member
        );
    }

    #[test]
    fn test_mdx_function_type_to_ooxml() {
        assert_eq!(MdxFunctionType::Member.to_ooxml(), "m");
        assert_eq!(MdxFunctionType::Set.to_ooxml(), "s");
        assert_eq!(MdxFunctionType::Property.to_ooxml(), "p");
        assert_eq!(MdxFunctionType::Visual.to_ooxml(), "v");
        assert_eq!(MdxFunctionType::Kpi.to_ooxml(), "k");
        assert_eq!(MdxFunctionType::Calculated.to_ooxml(), "c");
        assert_eq!(MdxFunctionType::Range.to_ooxml(), "r");
    }

    #[test]
    fn test_mdx_function_type_roundtrip() {
        for variant in [
            MdxFunctionType::Member,
            MdxFunctionType::Set,
            MdxFunctionType::Property,
            MdxFunctionType::Visual,
            MdxFunctionType::Kpi,
            MdxFunctionType::Calculated,
            MdxFunctionType::Range,
        ] {
            assert_eq!(MdxFunctionType::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_mdx_function_type_default() {
        assert_eq!(MdxFunctionType::default(), MdxFunctionType::Member);
    }

    #[test]
    fn test_mdx_kpi_property_from_ooxml() {
        assert_eq!(MdxKpiProperty::from_ooxml("v"), MdxKpiProperty::Value);
        assert_eq!(MdxKpiProperty::from_ooxml("g"), MdxKpiProperty::Goal);
        assert_eq!(MdxKpiProperty::from_ooxml("s"), MdxKpiProperty::Status);
        assert_eq!(MdxKpiProperty::from_ooxml("t"), MdxKpiProperty::Trend);
        assert_eq!(MdxKpiProperty::from_ooxml("w"), MdxKpiProperty::Weight);
        assert_eq!(
            MdxKpiProperty::from_ooxml("m"),
            MdxKpiProperty::CurrentTimeMember
        );
        // Unknown values fall back to default
        assert_eq!(MdxKpiProperty::from_ooxml("unknown"), MdxKpiProperty::Value);
    }

    #[test]
    fn test_mdx_kpi_property_to_ooxml() {
        assert_eq!(MdxKpiProperty::Value.to_ooxml(), "v");
        assert_eq!(MdxKpiProperty::Goal.to_ooxml(), "g");
        assert_eq!(MdxKpiProperty::Status.to_ooxml(), "s");
        assert_eq!(MdxKpiProperty::Trend.to_ooxml(), "t");
        assert_eq!(MdxKpiProperty::Weight.to_ooxml(), "w");
        assert_eq!(MdxKpiProperty::CurrentTimeMember.to_ooxml(), "m");
    }

    #[test]
    fn test_mdx_kpi_property_roundtrip() {
        for variant in [
            MdxKpiProperty::Value,
            MdxKpiProperty::Goal,
            MdxKpiProperty::Status,
            MdxKpiProperty::Trend,
            MdxKpiProperty::Weight,
            MdxKpiProperty::CurrentTimeMember,
        ] {
            assert_eq!(MdxKpiProperty::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_mdx_kpi_property_default() {
        assert_eq!(MdxKpiProperty::default(), MdxKpiProperty::Value);
    }

    #[test]
    fn test_mdx_set_order_from_ooxml() {
        assert_eq!(MdxSetOrder::from_ooxml("u"), MdxSetOrder::Unsorted);
        assert_eq!(MdxSetOrder::from_ooxml("a"), MdxSetOrder::Ascending);
        assert_eq!(MdxSetOrder::from_ooxml("d"), MdxSetOrder::Descending);
        assert_eq!(MdxSetOrder::from_ooxml("aa"), MdxSetOrder::AlphaAscending);
        assert_eq!(MdxSetOrder::from_ooxml("ad"), MdxSetOrder::AlphaDescending);
        assert_eq!(MdxSetOrder::from_ooxml("na"), MdxSetOrder::NaturalAscending);
        assert_eq!(
            MdxSetOrder::from_ooxml("nd"),
            MdxSetOrder::NaturalDescending
        );
        // Unknown values fall back to default
        assert_eq!(MdxSetOrder::from_ooxml("unknown"), MdxSetOrder::Unsorted);
    }

    #[test]
    fn test_mdx_set_order_to_ooxml() {
        assert_eq!(MdxSetOrder::Unsorted.to_ooxml(), "u");
        assert_eq!(MdxSetOrder::Ascending.to_ooxml(), "a");
        assert_eq!(MdxSetOrder::Descending.to_ooxml(), "d");
        assert_eq!(MdxSetOrder::AlphaAscending.to_ooxml(), "aa");
        assert_eq!(MdxSetOrder::AlphaDescending.to_ooxml(), "ad");
        assert_eq!(MdxSetOrder::NaturalAscending.to_ooxml(), "na");
        assert_eq!(MdxSetOrder::NaturalDescending.to_ooxml(), "nd");
    }

    #[test]
    fn test_mdx_set_order_roundtrip() {
        for variant in [
            MdxSetOrder::Unsorted,
            MdxSetOrder::Ascending,
            MdxSetOrder::Descending,
            MdxSetOrder::AlphaAscending,
            MdxSetOrder::AlphaDescending,
            MdxSetOrder::NaturalAscending,
            MdxSetOrder::NaturalDescending,
        ] {
            assert_eq!(MdxSetOrder::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_mdx_set_order_default() {
        assert_eq!(MdxSetOrder::default(), MdxSetOrder::Unsorted);
    }

    #[test]
    fn test_mdx_function_type_serde_roundtrip() {
        let original = MdxFunctionType::Kpi;
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: MdxFunctionType = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_mdx_kpi_property_serde_roundtrip() {
        let original = MdxKpiProperty::Trend;
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: MdxKpiProperty = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_mdx_set_order_serde_roundtrip() {
        let original = MdxSetOrder::AlphaDescending;
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: MdxSetOrder = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
