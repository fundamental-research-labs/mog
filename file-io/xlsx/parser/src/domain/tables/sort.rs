//! Sort types for Excel Tables.
//!
//! This module contains types for SortState and SortCondition
//! according to ECMA-376 Part 1.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    extract_direct_child_element_xml, parse_bool_attr_opt, parse_bytes_attr, parse_string_attr,
    parse_u32_attr,
};

use ooxml_types::cond_format::IconSetType;
use ooxml_types::tables::SortBy;

// ============================================================================
// Sort Structures
// ============================================================================

/// Sort condition (CT_SortCondition)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SortCondition {
    /// Reference range for the sort
    pub ref_range: String,
    /// Whether to sort descending
    pub descending: bool,
    /// Sort target: value, cell color, font color, or icon.
    pub sort_by: SortBy,
    /// Custom sort list
    pub custom_list: Option<String>,
    /// Sort by differential format ID
    pub dxf_id: Option<u32>,
    /// Icon set name for icon sorts
    pub icon_set: Option<IconSetType>,
    /// Icon ID within the set for icon sorts
    pub icon_id: Option<u32>,
}

impl SortCondition {
    /// Parse sortCondition element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        Some(SortCondition {
            ref_range: parse_string_attr(tag, b"ref=\"").unwrap_or_default(),
            descending: parse_bool_attr_opt(tag, b"descending=\"").unwrap_or(false),
            sort_by: parse_bytes_attr(tag, b"sortBy=\"")
                .map(SortBy::from_bytes)
                .unwrap_or_default(),
            custom_list: parse_string_attr(tag, b"customList=\""),
            dxf_id: parse_u32_attr(tag, b"dxfId=\""),
            icon_set: parse_string_attr(tag, b"iconSet=\"").and_then(|s| {
                IconSetType::from_ooxml_token(&s).or_else(|| {
                    tracing::warn!(token = %s, "unknown IconSetType OOXML token on sortCondition; treating attribute as absent");
                    None
                })
            }),
            icon_id: parse_u32_attr(tag, b"iconId=\""),
        })
    }
}

/// Sort state (CT_SortState)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct SortState {
    /// Reference range for the sort
    pub ref_range: String,
    /// Whether data has headers
    pub column_sort: bool,
    /// Case sensitive sort
    pub case_sensitive: bool,
    /// CJK sort method token.
    pub sort_method: domain_types::SortMethod,
    /// Sort conditions
    pub sort_conditions: Vec<SortCondition>,
    /// Raw direct-child `<extLst>` owned by this sortState.
    pub ext_lst_raw: Option<String>,
}

impl SortState {
    /// Parse sortState element
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        let mut sort_state = SortState {
            ref_range: parse_string_attr(tag, b"ref=\"").unwrap_or_default(),
            column_sort: parse_bool_attr_opt(tag, b"columnSort=\"").unwrap_or(false),
            case_sensitive: parse_bool_attr_opt(tag, b"caseSensitive=\"").unwrap_or(false),
            sort_method: parse_string_attr(tag, b"sortMethod=\"")
                .and_then(|s| domain_types::SortMethod::from_ooxml_token(&s))
                .unwrap_or_default(),
            sort_conditions: Vec::new(),
            ext_lst_raw: None,
        };

        // Parse child sortCondition elements
        let sort_end = find_closing_tag(xml, b"sortState", tag_end).unwrap_or(xml.len());
        let full_end = find_gt_simd(xml, sort_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        sort_state.ext_lst_raw =
            extract_direct_child_element_xml(&xml[..full_end], b"sortState", b"extLst");
        let content = &xml[tag_end + 1..sort_end];

        let mut pos = 0;
        while let Some(sc_start) = find_tag_simd(content, b"sortCondition", pos) {
            let sc_end = find_gt_simd(content, sc_start)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            if let Some(sc) = SortCondition::parse(&content[sc_start..sc_end]) {
                sort_state.sort_conditions.push(sc);
            }
            pos = sc_end;
        }

        Some(sort_state)
    }
}
