//! Core type definitions for conditional formatting.
//!
//! This module re-exports structural types from ooxml-types and provides
//! byte-parsing helpers for the XML reader path.

use crate::infra::scanner::{
    extract_quoted_value, find_attr_simd, find_closing_tag, find_gt_simd, find_tag_simd,
};
use crate::infra::xml::{
    decode_xml_entities_string, parse_bool_attr, parse_f64_attr, parse_string_attr, parse_u32_attr,
};

// =============================================================================
// Re-exports from ooxml-types
// =============================================================================

pub use ooxml_types::cond_format::{
    CfColor, CfIcon, CfOperator, CfRule, CfRuleType, CfRuleX14, CfTimePeriod, Cfvo, CfvoType,
    ColorScale, ConditionalFormatting, ConditionalFormattingX14, DataBar, DataBarAxisPosition,
    DataBarDirection, IconSet, IconSetType,
};

// =============================================================================
// Byte-slice parsing helpers
//
// These free functions accept `&[u8]` (as produced by the SIMD XML scanner)
// and are used at the XLSX XML-read entry path — the *external-format*
// boundary. They're lenient-with-log: unknown tokens emit a tracing warn
// (so the hazard is observable) and fall back to the default variant, on
// the theory that Excel forward-compat occasionally emits tokens newer
// than our vocabulary and rejecting the whole document would be worse
// than reading it with a default. For *internal* read paths (Yrs,
// palette, domain conversions), use the strict `from_ooxml_token` on the
// enum itself — unknowns there mean bugs, not forward-compat.
// =============================================================================

macro_rules! lenient_from_bytes {
    ($fn_name:ident, $ty:ty) => {
        pub fn $fn_name(bytes: &[u8]) -> $ty {
            match std::str::from_utf8(bytes).ok().and_then(<$ty>::from_ooxml_token) {
                Some(v) => v,
                None => {
                    tracing::warn!(
                        token = %String::from_utf8_lossy(bytes),
                        ty = stringify!($ty),
                        "unknown OOXML token on XLSX read; using default variant"
                    );
                    <$ty>::default()
                }
            }
        }
    };
}

lenient_from_bytes!(cf_operator_from_bytes, CfOperator);
lenient_from_bytes!(cf_time_period_from_bytes, CfTimePeriod);
lenient_from_bytes!(cfvo_type_from_bytes, CfvoType);
lenient_from_bytes!(data_bar_direction_from_bytes, DataBarDirection);
lenient_from_bytes!(icon_set_type_from_bytes, IconSetType);
lenient_from_bytes!(axis_position_from_bytes, DataBarAxisPosition);

/// Parse [`CfRuleType`] from XML attribute bytes.
pub fn cf_rule_type_from_bytes(bytes: &[u8]) -> CfRuleType {
    let s = std::str::from_utf8(bytes).unwrap_or("");
    CfRuleType::from_ooxml(s)
}

// =============================================================================
// Parse helpers for structural types
// =============================================================================

/// Parse a [`CfColor`] from XML element bytes.
pub fn parse_cf_color(xml: &[u8]) -> CfColor {
    let mut color = CfColor::default();

    // Check for rgb attribute
    if let Some(rgb) = parse_string_attr(xml, b"rgb=\"") {
        color.rgb = Some(rgb);
    }

    // Check for theme attribute
    if let Some(theme) = parse_u32_attr(xml, b"theme=\"") {
        color.theme = Some(theme);
    }

    // Check for indexed attribute
    if let Some(indexed) = parse_u32_attr(xml, b"indexed=\"") {
        color.indexed = Some(indexed);
    }

    // Check for auto attribute
    if parse_bool_attr(xml, b"auto=\"") {
        color.auto = true;
    }

    // Check for tint attribute
    if let Some(tint) = parse_f64_attr(xml, b"tint=\"") {
        color.tint = Some(tint);
    }

    color
}

/// Parse a [`Cfvo`] from XML element bytes.
pub fn parse_cfvo(xml: &[u8]) -> Cfvo {
    use crate::infra::xml::parse_bytes_attr;

    let mut cfvo = Cfvo {
        gte: true, // Default is true per ECMA-376
        ..Default::default()
    };

    // Parse type attribute.
    if let Some(type_val) = parse_bytes_attr(xml, b"type=\"") {
        cfvo.cfvo_type = cfvo_type_from_bytes(type_val);
    }

    // Parse val attribute
    if let Some(val) = parse_string_attr(xml, b"val=\"") {
        cfvo.val = Some(val);
    } else if let Some(val) = parse_cfvo_child_formula(xml) {
        cfvo.val = Some(val);
    }

    // Parse gte attribute (default true)
    if let Some(gte_pos) = find_attr_simd(xml, b"gte=\"", 0) {
        let value_start = gte_pos + 5;
        if let Some((start, end)) = extract_quoted_value(xml, value_start) {
            let val = &xml[start..end];
            cfvo.gte = val == b"1" || val == b"true";
        }
    }

    cfvo.ext_lst_xml = crate::infra::xml::extract_direct_child_element_xml(xml, b"cfvo", b"extLst");

    cfvo
}

fn parse_cfvo_child_formula(xml: &[u8]) -> Option<String> {
    let open_end = find_gt_simd(xml, 0)?;
    if open_end > 0 && xml.get(open_end.saturating_sub(1)) == Some(&b'/') {
        return None;
    }
    let close_start = find_closing_tag(xml, b"cfvo", open_end)?;
    let body = &xml[open_end + 1..close_start];
    let f_start = find_tag_simd(body, b"f", 0)?;
    let f_open_end = find_gt_simd(body, f_start)?;
    let f_close_start = find_closing_tag(body, b"f", f_open_end)?;
    let raw = std::str::from_utf8(&body[f_open_end + 1..f_close_start]).ok()?;
    Some(decode_xml_entities_string(raw))
}

// =============================================================================
// Tests for byte-parsing helpers
// =============================================================================

#[cfg(test)]
mod byte_helper_tests {
    use super::*;

    #[test]
    fn test_cf_operator_roundtrip() {
        let ops = [
            CfOperator::LessThan,
            CfOperator::LessThanOrEqual,
            CfOperator::Equal,
            CfOperator::NotEqual,
            CfOperator::GreaterThanOrEqual,
            CfOperator::GreaterThan,
            CfOperator::Between,
            CfOperator::NotBetween,
            CfOperator::ContainsText,
            CfOperator::NotContains,
            CfOperator::BeginsWith,
            CfOperator::EndsWith,
        ];
        for op in ops {
            let s = op.to_ooxml();
            let parsed = cf_operator_from_bytes(s.as_bytes());
            assert_eq!(op, parsed, "Roundtrip failed for {:?}", op);
        }
    }

    #[test]
    fn test_cf_time_period_roundtrip() {
        let periods = [
            CfTimePeriod::Today,
            CfTimePeriod::Yesterday,
            CfTimePeriod::Tomorrow,
            CfTimePeriod::Last7Days,
            CfTimePeriod::ThisMonth,
            CfTimePeriod::LastMonth,
            CfTimePeriod::NextMonth,
            CfTimePeriod::ThisWeek,
            CfTimePeriod::LastWeek,
            CfTimePeriod::NextWeek,
        ];
        for period in periods {
            let s = period.to_ooxml();
            let parsed = cf_time_period_from_bytes(s.as_bytes());
            assert_eq!(period, parsed, "Roundtrip failed for {:?}", period);
        }
    }

    #[test]
    fn test_cfvo_type_roundtrip() {
        let types = [
            CfvoType::Num,
            CfvoType::Percent,
            CfvoType::Max,
            CfvoType::Min,
            CfvoType::Formula,
            CfvoType::Percentile,
            CfvoType::AutoMin,
            CfvoType::AutoMax,
        ];
        for t in types {
            let s = t.to_ooxml();
            let parsed = cfvo_type_from_bytes(s.as_bytes());
            assert_eq!(t, parsed, "Roundtrip failed for {:?}", t);
        }
    }

    #[test]
    fn test_icon_set_type_roundtrip() {
        let sets = [
            IconSetType::ThreeTrafficLights1,
            IconSetType::ThreeArrows,
            IconSetType::ThreeArrowsGray,
            IconSetType::ThreeFlags,
            IconSetType::FourArrows,
            IconSetType::FiveArrows,
            IconSetType::NoIcons,
        ];
        for set in sets {
            let s = set.to_ooxml();
            let parsed = icon_set_type_from_bytes(s.as_bytes());
            assert_eq!(set, parsed, "Roundtrip failed for {:?}", set);
        }
    }

    #[test]
    fn test_icon_set_num_icons() {
        assert_eq!(IconSetType::ThreeArrows.num_icons(), 3);
        assert_eq!(IconSetType::FourArrows.num_icons(), 4);
        assert_eq!(IconSetType::FiveArrows.num_icons(), 5);
        assert_eq!(IconSetType::NoIcons.num_icons(), 0);
    }

    #[test]
    fn test_data_bar_direction_roundtrip() {
        let dirs = [
            DataBarDirection::Context,
            DataBarDirection::LeftToRight,
            DataBarDirection::RightToLeft,
        ];
        for dir in dirs {
            let s = dir.to_ooxml();
            let parsed = data_bar_direction_from_bytes(s.as_bytes());
            assert_eq!(dir, parsed, "Roundtrip failed for {:?}", dir);
        }
    }

    #[test]
    fn test_data_bar_axis_position_roundtrip() {
        let positions = [
            DataBarAxisPosition::Automatic,
            DataBarAxisPosition::Middle,
            DataBarAxisPosition::None,
        ];
        for pos in positions {
            let s = pos.to_ooxml();
            let parsed = axis_position_from_bytes(s.as_bytes());
            assert_eq!(pos, parsed, "Roundtrip failed for {:?}", pos);
        }
    }

    #[test]
    fn test_data_bar_axis_default() {
        assert_eq!(
            DataBarAxisPosition::default(),
            DataBarAxisPosition::Automatic
        );
    }

    #[test]
    fn test_cf_rule_type_roundtrip() {
        let types = [
            CfRuleType::Expression,
            CfRuleType::CellIs,
            CfRuleType::ColorScale,
            CfRuleType::DataBar,
            CfRuleType::IconSet,
            CfRuleType::Top10,
            CfRuleType::UniqueValues,
            CfRuleType::DuplicateValues,
            CfRuleType::ContainsText,
            CfRuleType::NotContainsText,
            CfRuleType::BeginsWith,
            CfRuleType::EndsWith,
            CfRuleType::ContainsBlanks,
            CfRuleType::NotContainsBlanks,
            CfRuleType::ContainsErrors,
            CfRuleType::NotContainsErrors,
            CfRuleType::TimePeriod,
            CfRuleType::AboveAverage,
        ];
        for t in types {
            let s = t.to_ooxml();
            let parsed = cf_rule_type_from_bytes(s.as_bytes());
            assert_eq!(t, parsed, "Roundtrip failed for {:?}", t);
        }
    }
}
