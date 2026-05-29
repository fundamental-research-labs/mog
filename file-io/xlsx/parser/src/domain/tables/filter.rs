//! Filter types for Excel Tables.
//!
//! This module contains types for AutoFilter, FilterColumn, CustomFilter,
//! and other filter-related structures according to ECMA-376 Part 1.
//!
//! Enum types (`FilterOperator`, `DynamicFilterType`) are re-exported from
//! the canonical `ooxml_types::tables` module.

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    extract_direct_child_element_xml, parse_bool_attr_opt, parse_bytes_attr, parse_f64_attr,
    parse_string_attr, parse_u32_attr,
};

use super::sort::SortState;

// Re-export canonical enum types from ooxml_types.
use ooxml_types::cond_format::IconSetType;
pub use ooxml_types::tables::{DynamicFilterType, FilterOperator};

// ============================================================================
// Filter Structures
// ============================================================================

/// A single custom filter criterion (CT_CustomFilter)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct CustomFilter {
    /// The filter operator
    pub operator: FilterOperator,
    /// The filter value
    pub val: String,
}

impl CustomFilter {
    /// Parse a customFilter element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        Some(CustomFilter {
            operator: parse_bytes_attr(tag, b"operator=\"")
                .map(FilterOperator::from_bytes)
                .unwrap_or_default(),
            val: parse_string_attr(tag, b"val=\"").unwrap_or_default(),
        })
    }
}

/// Custom filters container (CT_CustomFilters)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct CustomFilters {
    /// Whether filters are combined with AND (true) or OR (false)
    pub and: bool,
    /// List of custom filter criteria (1 or 2)
    pub filters: Vec<CustomFilter>,
}

impl CustomFilters {
    /// Parse customFilters element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        let mut custom_filters = CustomFilters {
            and: parse_bool_attr_opt(tag, b"and=\"").unwrap_or(false),
            filters: Vec::with_capacity(2),
        };

        // Parse child customFilter elements
        let mut pos = tag_end + 1;
        while let Some(filter_start) = find_tag_simd(xml, b"customFilter", pos) {
            let filter_end = find_gt_simd(xml, filter_start)
                .map(|p| p + 1)
                .unwrap_or(xml.len());
            if let Some(filter) = CustomFilter::parse(&xml[filter_start..filter_end]) {
                custom_filters.filters.push(filter);
            }
            pos = filter_end;
        }

        Some(custom_filters)
    }
}

/// Simple value filter list (CT_Filters)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Filters {
    /// Whether to include blank values
    pub blank: bool,
    /// Calendar type for date-grouped filters.
    pub calendar_type: Option<domain_types::CalendarType>,
    /// List of filter values
    pub values: Vec<String>,
    /// Date-grouped filter items.
    pub date_group_items: Vec<domain_types::DateGroupItem>,
}

impl Filters {
    /// Parse filters element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        let mut filters = Filters {
            blank: parse_bool_attr_opt(tag, b"blank=\"").unwrap_or(false),
            calendar_type: parse_string_attr(tag, b"calendarType=\"")
                .and_then(|s| domain_types::CalendarType::from_ooxml_token(&s)),
            values: Vec::new(),
            date_group_items: Vec::new(),
        };

        // Parse child filter elements
        let mut pos = tag_end + 1;
        while let Some(filter_start) = find_tag_simd(xml, b"filter", pos) {
            // Avoid matching "filters" again
            if filter_start + 7 < xml.len() && xml[filter_start + 7] == b's' {
                pos = filter_start + 1;
                continue;
            }

            let filter_end = find_gt_simd(xml, filter_start)
                .map(|p| p + 1)
                .unwrap_or(xml.len());
            let filter_tag = &xml[filter_start..filter_end];
            if let Some(val) = parse_string_attr(filter_tag, b"val=\"") {
                filters.values.push(val);
            }
            pos = filter_end;
        }

        let mut pos = tag_end + 1;
        while let Some(item_start) = find_tag_simd(xml, b"dateGroupItem", pos) {
            let item_end = find_gt_simd(xml, item_start)
                .map(|p| p + 1)
                .unwrap_or(xml.len());
            filters
                .date_group_items
                .push(parse_date_group_item(&xml[item_start..item_end]));
            pos = item_end;
        }

        Some(filters)
    }
}

fn parse_date_group_item(tag: &[u8]) -> domain_types::DateGroupItem {
    domain_types::DateGroupItem {
        year: parse_u32_attr(tag, b"year=\"").unwrap_or(0) as u16,
        month: parse_u32_attr(tag, b"month=\"").map(|v| v as u16),
        day: parse_u32_attr(tag, b"day=\"").map(|v| v as u16),
        hour: parse_u32_attr(tag, b"hour=\"").map(|v| v as u16),
        minute: parse_u32_attr(tag, b"minute=\"").map(|v| v as u16),
        second: parse_u32_attr(tag, b"second=\"").map(|v| v as u16),
        date_time_grouping: parse_string_attr(tag, b"dateTimeGrouping=\"")
            .and_then(|s| domain_types::DateTimeGrouping::from_ooxml_token(&s))
            .unwrap_or_default(),
    }
}

/// Dynamic filter (CT_DynamicFilter)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct DynamicFilter {
    /// The type of dynamic filter
    pub filter_type: DynamicFilterType,
    /// Optional value for the filter
    pub val: Option<f64>,
    /// Optional max value for range filters
    pub max_val: Option<f64>,
    /// ISO datetime value for date-based dynamic filters (valIso attribute).
    pub val_iso: Option<String>,
    /// Maximum ISO datetime value for range-based dynamic filters (maxValIso attribute).
    pub max_val_iso: Option<String>,
}

impl DynamicFilter {
    /// Parse dynamicFilter element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        Some(DynamicFilter {
            filter_type: parse_bytes_attr(tag, b"type=\"")
                .map(DynamicFilterType::from_bytes)
                .unwrap_or_default(),
            val: parse_f64_attr(tag, b"val=\""),
            max_val: parse_f64_attr(tag, b"maxVal=\""),
            val_iso: parse_string_attr(tag, b"valIso=\""),
            max_val_iso: parse_string_attr(tag, b"maxValIso=\""),
        })
    }
}

/// Top 10 filter (CT_Top10)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Top10Filter {
    /// Whether to filter top (true) or bottom (false)
    pub top: bool,
    /// Whether val is a percent (true) or count (false)
    pub percent: bool,
    /// The filter value (count or percentage)
    pub val: f64,
    /// Optional filter value for comparison
    pub filter_val: Option<f64>,
}

impl Top10Filter {
    /// Parse top10 element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        Some(Top10Filter {
            top: parse_bool_attr_opt(tag, b"top=\"").unwrap_or(true),
            percent: parse_bool_attr_opt(tag, b"percent=\"").unwrap_or(false),
            val: parse_f64_attr(tag, b"val=\"").unwrap_or(10.0),
            filter_val: parse_f64_attr(tag, b"filterVal=\""),
        })
    }
}

/// Color filter (CT_ColorFilter)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ColorFilter {
    /// Differential format ID
    pub dxf_id: Option<u32>,
    /// Whether to filter by cell color (true) or font color (false)
    pub cell_color: bool,
}

impl ColorFilter {
    /// Parse colorFilter element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        Some(ColorFilter {
            dxf_id: parse_u32_attr(tag, b"dxfId=\""),
            cell_color: parse_bool_attr_opt(tag, b"cellColor=\"").unwrap_or(true),
        })
    }
}

/// Icon filter (CT_IconFilter)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct IconFilter {
    /// Icon set identifier
    pub icon_set: IconSetType,
    /// Icon ID within the set (0 = no icon)
    pub icon_id: Option<u32>,
}

impl IconFilter {
    /// Parse iconFilter element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        Some(IconFilter {
            icon_set: parse_string_attr(tag, b"iconSet=\"")
                .map(|s| {
                    IconSetType::from_ooxml_token(&s).unwrap_or_else(|| {
                        tracing::warn!(token = %s, "unknown IconSetType OOXML token on iconFilter; using default");
                        IconSetType::default()
                    })
                })
                .unwrap_or_default(),
            icon_id: parse_u32_attr(tag, b"iconId=\""),
        })
    }
}

/// Filter column (CT_FilterColumn)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct FilterColumn {
    /// Column index (0-based from table start)
    pub col_id: u32,
    /// Whether column is hidden by AutoFilter
    pub hidden_button: bool,
    /// Whether to show the filter button
    pub show_button: bool,
    /// Simple value filters
    pub filters: Option<Filters>,
    /// Custom filters
    pub custom_filters: Option<CustomFilters>,
    /// Dynamic filter
    pub dynamic_filter: Option<DynamicFilter>,
    /// Top 10 filter
    pub top10: Option<Top10Filter>,
    /// Color filter
    pub color_filter: Option<ColorFilter>,
    /// Icon filter
    pub icon_filter: Option<IconFilter>,
    /// Raw direct-child `<extLst>` owned by this filterColumn.
    pub ext_lst_raw: Option<String>,
}

impl FilterColumn {
    /// Parse a filterColumn element
    pub(crate) fn parse(xml: &[u8]) -> Option<Self> {
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        let mut col = FilterColumn {
            col_id: parse_u32_attr(tag, b"colId=\"").unwrap_or(0),
            hidden_button: parse_bool_attr_opt(tag, b"hiddenButton=\"").unwrap_or(false),
            show_button: parse_bool_attr_opt(tag, b"showButton=\"").unwrap_or(true),
            ..Default::default()
        };

        // Check for self-closing tag
        let self_closing = tag.len() > 1 && tag[tag.len() - 1] == b'/';
        if self_closing {
            return Some(col);
        }

        // Find the end of the filterColumn element
        let _col_end = find_closing_tag(xml, b"filterColumn", tag_end).unwrap_or(xml.len());

        col.ext_lst_raw = extract_direct_child_element_xml(xml, b"filterColumn", b"extLst");

        // Parse direct child elements only; nested extLst payload is owner metadata.
        if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"filters") {
            col.filters = Filters::parse(child.as_bytes());
        }

        if let Some(child) =
            extract_direct_child_element_xml(xml, b"filterColumn", b"customFilters")
        {
            col.custom_filters = CustomFilters::parse(child.as_bytes());
        }

        if let Some(child) =
            extract_direct_child_element_xml(xml, b"filterColumn", b"dynamicFilter")
        {
            col.dynamic_filter = DynamicFilter::parse(child.as_bytes());
        }

        if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"top10") {
            col.top10 = Top10Filter::parse(child.as_bytes());
        }

        if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"colorFilter")
        {
            col.color_filter = ColorFilter::parse(child.as_bytes());
        }

        if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"iconFilter") {
            col.icon_filter = IconFilter::parse(child.as_bytes());
        }

        Some(col)
    }
}

// ============================================================================
// AutoFilter
// ============================================================================

/// AutoFilter definition (CT_AutoFilter)
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct AutoFilter {
    /// Reference range for the filter (e.g., "A1:E10")
    pub ref_range: String,
    /// Filter columns
    pub filter_columns: Vec<FilterColumn>,
    /// Sort state
    pub sort_state: Option<SortState>,
    /// Extension UID for revision tracking (xr:uid)
    pub xr_uid: Option<String>,
    /// Raw direct-child `<extLst>` owned by this autoFilter.
    pub ext_lst_raw: Option<String>,
}

impl AutoFilter {
    /// Parse autoFilter element from XML bytes
    pub fn parse(xml: &[u8]) -> Option<Self> {
        let af_start = find_tag_simd(xml, b"autoFilter", 0)?;
        let af_tag_end = find_gt_simd(xml, af_start)?;
        let af_tag = &xml[af_start..af_tag_end];

        let mut auto_filter = AutoFilter {
            ref_range: parse_string_attr(af_tag, b"ref=\"").unwrap_or_default(),
            filter_columns: Vec::new(),
            sort_state: None,
            xr_uid: parse_string_attr(af_tag, b"xr:uid=\""),
            ext_lst_raw: None,
        };

        // Check for self-closing tag
        if af_tag.len() > 1 && af_tag[af_tag.len() - 1] == b'/' {
            return Some(auto_filter);
        }

        // Find the end of autoFilter element
        let af_end = find_closing_tag(xml, b"autoFilter", af_tag_end).unwrap_or(xml.len());
        let content = &xml[af_tag_end + 1..af_end];
        let full_end = find_gt_simd(xml, af_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        auto_filter.ext_lst_raw =
            extract_direct_child_element_xml(&xml[af_start..full_end], b"autoFilter", b"extLst");

        // Parse filterColumn elements
        let mut pos = 0;
        while let Some(fc_start) = find_tag_simd(content, b"filterColumn", pos) {
            let fc_end = find_closing_tag(content, b"filterColumn", fc_start)
                .and_then(|p| find_gt_simd(content, p).map(|g| g + 1))
                .or_else(|| find_gt_simd(content, fc_start).map(|p| p + 1))
                .unwrap_or(content.len());

            if let Some(fc) = FilterColumn::parse(&content[fc_start..fc_end]) {
                auto_filter.filter_columns.push(fc);
            }
            pos = fc_end;
        }

        // Parse direct child sortState.
        if let Some(sort_xml) =
            extract_direct_child_element_xml(&xml[af_start..full_end], b"autoFilter", b"sortState")
        {
            auto_filter.sort_state = SortState::parse(sort_xml.as_bytes());
        }

        Some(auto_filter)
    }
}
