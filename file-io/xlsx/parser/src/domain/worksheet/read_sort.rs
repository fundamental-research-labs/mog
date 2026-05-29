use crate::infra::scanner::{extract_quoted_value, find_gt_simd, find_tag_simd};
use crate::infra::xml::extract_direct_child_element_xml;
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr, parse_u32_attr};

use super::read_support::find_auto_filter_end;

/// Parse the standalone worksheet-level `<sortState>` element into a typed sort state.
pub fn parse_standalone_sort_state(post_sd: &[u8]) -> Option<domain_types::SortState> {
    let search_start = find_auto_filter_end(post_sd).unwrap_or(0);
    let tag_start = find_tag_simd(post_sd, b"sortState", search_start)?;
    let tag_end = find_gt_simd(post_sd, tag_start)?;
    parse_sort_state_element(&post_sd[tag_start..], tag_end - tag_start)
}

pub(crate) fn parse_sort_state_slice(
    slice: &[u8],
    tag_end_offset: usize,
) -> Option<domain_types::SortState> {
    parse_sort_state_element(slice, tag_end_offset)
}

fn parse_sort_state_element(
    slice: &[u8],
    tag_end_offset: usize,
) -> Option<domain_types::SortState> {
    let attr_bytes = &slice[..=tag_end_offset];
    let range_ref = parse_string_attr(attr_bytes, b"ref=\"").unwrap_or_default();
    let column_sort = parse_bool_attr_opt(attr_bytes, b"columnSort=\"").unwrap_or(false);
    let case_sensitive = parse_bool_attr_opt(attr_bytes, b"caseSensitive=\"").unwrap_or(false);
    let sort_method = parse_string_attr(attr_bytes, b"sortMethod=\"")
        .and_then(|s| domain_types::SortMethod::from_ooxml_token(&s))
        .unwrap_or(domain_types::SortMethod::None);

    let mut state = domain_types::SortState {
        range_ref,
        namespace_attrs: parse_namespace_attrs(attr_bytes),
        column_sort,
        case_sensitive,
        sort_method,
        conditions: Vec::new(),
        ext_lst_raw: None,
    };

    if tag_end_offset > 0 && slice[tag_end_offset - 1] == b'/' {
        return Some(state);
    }

    let closing = crate::infra::scanner::find_closing_tag(slice, b"sortState", 0)?;
    let full_end = find_gt_simd(slice, closing)
        .map(|p| p + 1)
        .unwrap_or(slice.len());
    state.ext_lst_raw =
        extract_direct_child_element_xml(&slice[..full_end], b"sortState", b"extLst");
    let inner = &slice[tag_end_offset + 1..closing];
    let mut pos = 0;
    while let Some(sc_start) = find_tag_simd(inner, b"sortCondition", pos) {
        let sc_end = find_gt_simd(inner, sc_start)
            .map(|p| p + 1)
            .unwrap_or(inner.len());
        state
            .conditions
            .push(parse_sort_condition(&inner[sc_start..sc_end]));
        pos = sc_end;
    }

    Some(state)
}

fn parse_sort_condition(slice: &[u8]) -> domain_types::SortCondition {
    let range_ref = parse_string_attr(slice, b"ref=\"").unwrap_or_default();
    let descending = parse_bool_attr_opt(slice, b"descending=\"").unwrap_or(false);
    let sort_by = parse_string_attr(slice, b"sortBy=\"")
        .and_then(|s| domain_types::SortConditionBy::from_ooxml_token(&s))
        .unwrap_or(domain_types::SortConditionBy::Value);
    let custom_list = parse_string_attr(slice, b"customList=\"");
    let dxf_id = parse_u32_attr(slice, b"dxfId=\"");
    let icon_set = parse_string_attr(slice, b"iconSet=\"").and_then(|s| {
        ooxml_types::cond_format::IconSetType::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(
                token = %s,
                "unknown IconSetType OOXML token on worksheet sortCondition; dropping attribute"
            );
            None
        })
    });
    let icon_id = parse_u32_attr(slice, b"iconId=\"");

    domain_types::SortCondition {
        range_ref,
        descending,
        sort_by,
        custom_list,
        dxf_id,
        icon_set,
        icon_id,
    }
}

fn parse_namespace_attrs(tag: &[u8]) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    let mut pos = 0;
    while let Some(rel_start) = memchr::memmem::find(&tag[pos..], b"xmlns") {
        let start = pos + rel_start;
        let after_name = if tag.get(start + 5) == Some(&b':') {
            let prefix_start = start + 6;
            let Some(eq_rel) = memchr::memchr(b'=', &tag[prefix_start..]) else {
                break;
            };
            let eq = prefix_start + eq_rel;
            let prefix = String::from_utf8_lossy(&tag[prefix_start..eq]).into_owned();
            if let Some((value_start, value_end)) = extract_quoted_value(tag, eq + 2) {
                attrs.push((
                    prefix,
                    String::from_utf8_lossy(&tag[value_start..value_end]).into_owned(),
                ));
            }
            eq + 1
        } else if tag.get(start + 5) == Some(&b'=') {
            if let Some((value_start, value_end)) = extract_quoted_value(tag, start + 7) {
                attrs.push((
                    String::new(),
                    String::from_utf8_lossy(&tag[value_start..value_end]).into_owned(),
                ));
            }
            start + 6
        } else {
            start + 5
        };
        pos = after_name;
    }
    attrs
}
