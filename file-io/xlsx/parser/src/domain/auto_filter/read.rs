//! XML parser for the worksheet-level `<autoFilter>` element.
//!
//! Typed OOXML preservation: replaces `extract_auto_filter_xml` (raw-string
//! passthrough on raw XML sidecars
//! parser that targets [`domain_types::AutoFilter`] directly.
//!
//! The tables-level parser at `crate::domain::tables::filter::AutoFilter`
//! produces a parser-internal type and cannot be reused here without a
//! lossy conversion (it predates CT_AutoFilter coverage of the
//! `calendarType`, `<dateGroupItem>`, `<iconFilter>`, `hiddenButton`, and
//! `showButton` attributes that typed OOXML preservation restored).

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::extract_direct_child_element_xml;
use crate::infra::xml::{parse_bool_attr_opt, parse_f64_attr, parse_string_attr, parse_u32_attr};
use domain_types::{
    AutoFilter, CalendarType, DateGroupItem, DateTimeGrouping, FilterColumn, OoxmlFilterCondition,
    OoxmlFilterType,
};
use value_types::CellValue;

/// Parse the worksheet-level `<autoFilter>` element from post-sheetData XML.
///
/// Returns the typed [`AutoFilter`] losslessly. Scans `post_sd` (the region
/// of worksheet XML after `</sheetData>`).
pub fn parse_auto_filter(post_sd: &[u8]) -> Option<AutoFilter> {
    let af_start = find_tag_simd(post_sd, b"autoFilter", 0)?;
    let af_tag_end = find_gt_simd(post_sd, af_start)?;
    let slice = &post_sd[af_start..];
    let af_tag_end_local = af_tag_end - af_start;
    let af_tag = &slice[..=af_tag_end_local];

    let mut auto_filter = AutoFilter {
        range_ref: parse_string_attr(af_tag, b"ref=\"").unwrap_or_default(),
        columns: Vec::new(),
        sort: None,
        xr_uid: parse_string_attr(af_tag, b"xr:uid=\""),
        ext_lst_raw: None,
    };

    // Self-closing `<autoFilter .../>` — attributes only.
    if af_tag_end_local > 0 && slice[af_tag_end_local - 1] == b'/' {
        return Some(auto_filter);
    }

    // Find the end of the autoFilter element so we parse children only.
    let af_end = find_closing_tag(slice, b"autoFilter", 0).unwrap_or(slice.len());
    let content = &slice[af_tag_end_local + 1..af_end];
    auto_filter.ext_lst_raw = extract_direct_child_element_xml(
        &slice[..af_end
            + b"</autoFilter>"
                .len()
                .min(slice.len().saturating_sub(af_end))],
        b"autoFilter",
        b"extLst",
    );

    // Parse filterColumn elements
    let mut pos = 0;
    while let Some(fc_start) = find_tag_simd(content, b"filterColumn", pos) {
        let fc_tag_end = find_gt_simd(content, fc_start);
        let fc_end = if let Some(tag_end) = fc_tag_end {
            if tag_end > fc_start && content[tag_end - 1] == b'/' {
                tag_end + 1
            } else {
                find_closing_tag(content, b"filterColumn", fc_start)
                    .and_then(|p| find_gt_simd(content, p).map(|g| g + 1))
                    .unwrap_or(tag_end + 1)
            }
        } else {
            content.len()
        };
        if let Some(fc) = parse_filter_column(&content[fc_start..fc_end]) {
            auto_filter.columns.push(fc);
        }
        pos = fc_end;
    }

    // Parse nested sortState (if present). Unlike the worksheet-level
    // parser in `worksheet::read`, this one intentionally scans inside the
    // autoFilter element — the two parsers are complementary.
    if let Some(sort_xml) = extract_direct_child_element_xml(
        &slice[..af_end
            + b"</autoFilter>"
                .len()
                .min(slice.len().saturating_sub(af_end))],
        b"autoFilter",
        b"sortState",
    ) {
        let sort_bytes = sort_xml.as_bytes();
        if let Some(ss_tag_end) = find_gt_simd(sort_bytes, 0) {
            // Reuse the typed sort-state parser from the worksheet module
            // so behavior stays consistent. We pass the slice starting at
            // `<sortState`.
            auto_filter.sort =
                super::super::worksheet::read::parse_sort_state_slice(sort_bytes, ss_tag_end);
        }
    }

    Some(auto_filter)
}

/// Parse a `<filterColumn>` element.
fn parse_filter_column(xml: &[u8]) -> Option<FilterColumn> {
    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..=tag_end];

    let col_index = parse_u32_attr(tag, b"colId=\"").unwrap_or(0);
    let hidden_button = parse_bool_attr_opt(tag, b"hiddenButton=\"").unwrap_or(false);
    let show_button = parse_bool_attr_opt(tag, b"showButton=\"").unwrap_or(true);

    // Choose the filter type by which child element appears. CT_FilterColumn
    // is a choice group, so exactly one child is expected. No child is a
    // distinct OOXML shape from an explicit empty `<filters>` child.
    let filter_type = parse_filter_column_type(xml, tag_end);

    Some(FilterColumn {
        col_index,
        filter_type,
        hidden_button,
        show_button,
        ext_lst_raw: extract_direct_child_element_xml(xml, b"filterColumn", b"extLst"),
    })
}

/// Pick the single child of a `<filterColumn>` and parse it.
fn parse_filter_column_type(xml: &[u8], tag_end: usize) -> Option<OoxmlFilterType> {
    let _ = tag_end;

    if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"filters") {
        return Some(parse_filters(child.as_bytes(), 0));
    }
    if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"customFilters") {
        return Some(parse_custom_filters(child.as_bytes(), 0));
    }
    if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"top10") {
        return Some(parse_top10(child.as_bytes(), 0));
    }
    if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"dynamicFilter") {
        return Some(parse_dynamic_filter(child.as_bytes(), 0));
    }
    if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"colorFilter") {
        return Some(parse_color_filter(child.as_bytes(), 0));
    }
    if let Some(child) = extract_direct_child_element_xml(xml, b"filterColumn", b"iconFilter") {
        return Some(parse_icon_filter(child.as_bytes(), 0));
    }

    None
}

/// Parse `<filters ...>` with `<filter val=…/>` and `<dateGroupItem .../>` children.
fn parse_filters(content: &[u8], start: usize) -> OoxmlFilterType {
    let tag_end = find_gt_simd(content, start).unwrap_or(content.len().saturating_sub(1));
    let tag = &content[start..=tag_end];

    let blanks = parse_bool_attr_opt(tag, b"blank=\"").unwrap_or(false);
    let calendar_type =
        parse_string_attr(tag, b"calendarType=\"").and_then(|s| CalendarType::from_ooxml_token(&s));

    let filters_end = find_closing_tag(content, b"filters", start).unwrap_or(content.len());
    let inner = &content[tag_end + 1..filters_end];

    let mut values = Vec::new();
    let mut date_group_items = Vec::new();

    let mut pos = 0;
    while pos < inner.len() {
        if let Some(next) = find_next_child_tag(inner, pos) {
            let tag_start = next.tag_start;
            let tag_name = next.tag_name;
            let local_end = find_gt_simd(inner, tag_start)
                .map(|p| p + 1)
                .unwrap_or(inner.len());

            if tag_name == b"filter" {
                // <filter val="…"/>
                let inner_tag = &inner[tag_start..local_end];
                if let Some(val) = parse_string_attr(inner_tag, b"val=\"") {
                    values.push(val);
                }
                pos = local_end;
            } else if tag_name == b"dateGroupItem" {
                let inner_tag = &inner[tag_start..local_end];
                date_group_items.push(parse_date_group_item(inner_tag));
                pos = local_end;
            } else {
                pos = local_end;
            }
        } else {
            break;
        }
    }

    OoxmlFilterType::Values {
        values,
        blanks,
        calendar_type,
        date_group_items,
    }
}

struct ChildTag<'a> {
    tag_start: usize,
    tag_name: &'a [u8],
}

/// Find the next `<tagname` occurrence starting at `pos`, returning the
/// tag-start offset and a reference to the matched tag name bytes.
/// Ignores comments / closing tags. Minimal helper for the one-of-many
/// child-element parsing above.
fn find_next_child_tag(inner: &[u8], mut pos: usize) -> Option<ChildTag<'_>> {
    while pos < inner.len() {
        // Find next '<'.
        let lt = memchr::memchr(b'<', &inner[pos..])? + pos;
        let after = lt + 1;
        if after >= inner.len() {
            return None;
        }
        let first = inner[after];
        if first == b'/' || first == b'!' || first == b'?' {
            pos = after;
            continue;
        }
        // Scan tag name: [A-Za-z][-_:A-Za-z0-9]* until whitespace/'/'/'>'.
        let mut end = after;
        while end < inner.len() {
            let c = inner[end];
            if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' || c == b'/' || c == b'>' {
                break;
            }
            end += 1;
        }
        let name = &inner[after..end];
        return Some(ChildTag {
            tag_start: lt,
            tag_name: name,
        });
    }
    None
}

fn parse_date_group_item(tag: &[u8]) -> DateGroupItem {
    let year = parse_u32_attr(tag, b"year=\"").unwrap_or(0) as u16;
    let month = parse_u32_attr(tag, b"month=\"").map(|v| v as u16);
    let day = parse_u32_attr(tag, b"day=\"").map(|v| v as u16);
    let hour = parse_u32_attr(tag, b"hour=\"").map(|v| v as u16);
    let minute = parse_u32_attr(tag, b"minute=\"").map(|v| v as u16);
    let second = parse_u32_attr(tag, b"second=\"").map(|v| v as u16);
    let date_time_grouping = parse_string_attr(tag, b"dateTimeGrouping=\"")
        .and_then(|s| DateTimeGrouping::from_ooxml_token(&s))
        .unwrap_or_default();
    DateGroupItem {
        year,
        month,
        day,
        hour,
        minute,
        second,
        date_time_grouping,
    }
}

fn parse_custom_filters(content: &[u8], start: usize) -> OoxmlFilterType {
    let tag_end = find_gt_simd(content, start).unwrap_or(content.len().saturating_sub(1));
    let tag = &content[start..=tag_end];
    let and_logic = parse_bool_attr_opt(tag, b"and=\"").unwrap_or(false);

    let cf_end = find_closing_tag(content, b"customFilters", start).unwrap_or(content.len());
    let inner = &content[tag_end + 1..cf_end];

    let mut conditions = Vec::new();
    let mut pos = 0;
    while let Some(s) = find_tag_simd(inner, b"customFilter", pos) {
        let e = find_gt_simd(inner, s).map(|p| p + 1).unwrap_or(inner.len());
        let filter_tag = &inner[s..e];
        let operator = parse_string_attr(filter_tag, b"operator=\"").unwrap_or_default();
        let val = parse_string_attr(filter_tag, b"val=\"").unwrap_or_default();
        // `val` is a plain string in OOXML; we keep it as Text — higher layers
        // that know the column type coerce if needed (the runtime type system
        // chose CellValue here in typed OOXML preservation).
        conditions.push(OoxmlFilterCondition {
            operator,
            value: CellValue::from(val),
            value2: None,
        });
        pos = e;
    }

    OoxmlFilterType::Custom {
        conditions,
        and_logic,
    }
}

fn parse_top10(content: &[u8], start: usize) -> OoxmlFilterType {
    let tag_end = find_gt_simd(content, start).unwrap_or(content.len().saturating_sub(1));
    let tag = &content[start..=tag_end];
    OoxmlFilterType::Top10 {
        top: parse_bool_attr_opt(tag, b"top=\"").unwrap_or(true),
        percent: parse_bool_attr_opt(tag, b"percent=\"").unwrap_or(false),
        value: parse_f64_attr(tag, b"val=\"").unwrap_or(10.0),
        filter_val: parse_f64_attr(tag, b"filterVal=\""),
    }
}

fn parse_dynamic_filter(content: &[u8], start: usize) -> OoxmlFilterType {
    let tag_end = find_gt_simd(content, start).unwrap_or(content.len().saturating_sub(1));
    let tag = &content[start..=tag_end];
    OoxmlFilterType::Dynamic {
        dynamic_type: parse_string_attr(tag, b"type=\"").unwrap_or_default(),
        value: parse_f64_attr(tag, b"val=\""),
        max_value: parse_f64_attr(tag, b"maxVal=\""),
        value_iso: parse_string_attr(tag, b"valIso=\""),
        max_value_iso: parse_string_attr(tag, b"maxValIso=\""),
    }
}

fn parse_color_filter(content: &[u8], start: usize) -> OoxmlFilterType {
    let tag_end = find_gt_simd(content, start).unwrap_or(content.len().saturating_sub(1));
    let tag = &content[start..=tag_end];
    OoxmlFilterType::Color {
        dxf_id: parse_u32_attr(tag, b"dxfId=\""),
        cell_color: parse_bool_attr_opt(tag, b"cellColor=\"").unwrap_or(true),
    }
}

fn parse_icon_filter(content: &[u8], start: usize) -> OoxmlFilterType {
    let tag_end = find_gt_simd(content, start).unwrap_or(content.len().saturating_sub(1));
    let tag = &content[start..=tag_end];
    OoxmlFilterType::Icon {
        icon_set: parse_string_attr(tag, b"iconSet=\""),
        icon_id: parse_u32_attr(tag, b"iconId=\"").unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_self_closing_autofilter() {
        let xml = br#"<autoFilter ref="A1:D20"/>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(af.range_ref, "A1:D20");
        assert!(af.columns.is_empty());
        assert!(af.sort.is_none());
    }

    #[test]
    fn parses_filters_with_values_and_blank() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"><filters blank="1"><filter val="X"/><filter val="Y"/></filters></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(af.columns.len(), 1);
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Values { values, blanks, .. }) => {
                assert!(*blanks);
                assert_eq!(values, &["X".to_string(), "Y".to_string()]);
            }
            other => panic!("expected Values, got {:?}", other),
        }
    }

    #[test]
    fn parses_self_closing_filter_column_as_childless() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="1" hiddenButton="1" showButton="0"/></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(af.columns.len(), 1);
        assert_eq!(af.columns[0].col_index, 1);
        assert!(af.columns[0].hidden_button);
        assert!(!af.columns[0].show_button);
        assert!(af.columns[0].filter_type.is_none());
    }

    #[test]
    fn parses_open_close_filter_column_as_childless() {
        let xml =
            br#"<autoFilter ref="A1:D20"><filterColumn colId="2"></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(af.columns.len(), 1);
        assert_eq!(af.columns[0].col_index, 2);
        assert!(af.columns[0].filter_type.is_none());
    }

    #[test]
    fn parses_self_closing_filters_as_explicit_empty_values() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"><filters/></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Values { values, blanks, .. }) => {
                assert!(values.is_empty());
                assert!(!blanks);
            }
            other => panic!("expected Values, got {:?}", other),
        }
    }

    #[test]
    fn parses_open_close_filters_as_explicit_empty_values() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"><filters></filters></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Values { values, blanks, .. }) => {
                assert!(values.is_empty());
                assert!(!blanks);
            }
            other => panic!("expected Values, got {:?}", other),
        }
    }

    #[test]
    fn parses_childless_column_before_explicit_filters_as_separate_columns() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"/><filterColumn colId="1"><filters/></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(af.columns.len(), 2);
        assert!(af.columns[0].filter_type.is_none());
        match &af.columns[1].filter_type {
            Some(OoxmlFilterType::Values { values, blanks, .. }) => {
                assert!(values.is_empty());
                assert!(!blanks);
            }
            other => panic!("expected Values, got {:?}", other),
        }
    }

    #[test]
    fn parses_top10_with_filter_val() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="2"><top10 top="0" percent="1" val="25" filterVal="42.5"/></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Top10 {
                top,
                percent,
                value,
                filter_val,
            }) => {
                assert!(!top);
                assert!(percent);
                assert_eq!(*value, 25.0);
                assert_eq!(*filter_val, Some(42.5));
            }
            other => panic!("expected Top10, got {:?}", other),
        }
    }

    #[test]
    fn parses_color_filter_with_dxfid() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="1"><colorFilter dxfId="3" cellColor="0"/></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Color { dxf_id, cell_color }) => {
                assert_eq!(*dxf_id, Some(3));
                assert!(!cell_color);
            }
            other => panic!("expected Color, got {:?}", other),
        }
    }

    #[test]
    fn parses_icon_filter() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="1"><iconFilter iconSet="3TrafficLights1" iconId="1"/></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Icon { icon_set, icon_id }) => {
                assert_eq!(icon_set.as_deref(), Some("3TrafficLights1"));
                assert_eq!(*icon_id, 1);
            }
            other => panic!("expected Icon, got {:?}", other),
        }
    }

    #[test]
    fn parses_dynamic_filter_with_iso() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"><dynamicFilter type="aboveAverage" val="10" valIso="2020-01-01T00:00:00"/></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Dynamic {
                dynamic_type,
                value,
                value_iso,
                ..
            }) => {
                assert_eq!(dynamic_type, "aboveAverage");
                assert_eq!(*value, Some(10.0));
                assert_eq!(value_iso.as_deref(), Some("2020-01-01T00:00:00"));
            }
            other => panic!("expected Dynamic, got {:?}", other),
        }
    }

    #[test]
    fn parses_filter_column_button_attrs() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="1" hiddenButton="1" showButton="0"/></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(af.columns[0].col_index, 1);
        assert!(af.columns[0].hidden_button);
        assert!(!af.columns[0].show_button);
        assert!(af.columns[0].filter_type.is_none());
    }

    #[test]
    fn parses_date_group_item() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"><filters calendarType="gregorian"><dateGroupItem year="2024" month="3" dateTimeGrouping="month"/></filters></filterColumn></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        match &af.columns[0].filter_type {
            Some(OoxmlFilterType::Values {
                calendar_type,
                date_group_items,
                ..
            }) => {
                assert_eq!(*calendar_type, Some(CalendarType::Gregorian));
                assert_eq!(date_group_items.len(), 1);
                assert_eq!(date_group_items[0].year, 2024);
                assert_eq!(date_group_items[0].month, Some(3));
                assert_eq!(
                    date_group_items[0].date_time_grouping,
                    DateTimeGrouping::Month
                );
            }
            other => panic!("expected Values with date group, got {:?}", other),
        }
    }

    #[test]
    fn parses_xr_uid_on_self_closing_autofilter() {
        let xml = br#"<autoFilter ref="A1:D20" xr:uid="{00000000-0001-0000-0000-000000000000}"/>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(
            af.xr_uid.as_deref(),
            Some("{00000000-0001-0000-0000-000000000000}")
        );
    }

    #[test]
    fn parses_xr_uid_on_open_autofilter_with_children() {
        let xml = br#"<autoFilter ref="A1:D20" xr:uid="{ABCDEF01-2345-6789-ABCD-EF0123456789}"><filterColumn colId="0"/></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert_eq!(
            af.xr_uid.as_deref(),
            Some("{ABCDEF01-2345-6789-ABCD-EF0123456789}")
        );
        assert_eq!(af.columns.len(), 1);
    }

    #[test]
    fn absent_xr_uid_yields_none() {
        let xml = br#"<autoFilter ref="A1:D20"/>"#;
        let af = parse_auto_filter(xml).expect("parse");
        assert!(af.xr_uid.is_none());
    }

    #[test]
    fn parses_nested_sort_state() {
        let xml = br#"<autoFilter ref="A1:D20"><filterColumn colId="0"/><sortState ref="A2:D20"><sortCondition ref="A2:A20" descending="1"/></sortState></autoFilter>"#;
        let af = parse_auto_filter(xml).expect("parse");
        let ss = af.sort.expect("sort state");
        assert_eq!(ss.range_ref, "A2:D20");
        assert_eq!(ss.conditions.len(), 1);
        assert!(ss.conditions[0].descending);
    }
}
