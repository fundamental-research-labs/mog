use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    decode_xml_entities_string, parse_bool_attr_with_default, parse_string_attr, parse_u32_attr,
};

use super::super::types::{
    SlicerCacheDef, SlicerPivotTableRef, SlicerTabularData, SlicerTabularItem,
    SlicerUnknownAttribute, TableSlicerCache,
};
use super::support::{parse_cross_filter_attr, parse_sort_order_attr};

/// Parse a slicer cache definition XML file (`xl/slicerCaches/slicerCache{N}.xml`).
pub fn parse_slicer_cache(xml: &[u8]) -> Option<SlicerCacheDef> {
    let root_start = find_tag_simd(xml, b"slicerCacheDefinition", 0)?;
    let root_elem_end = find_gt_simd(xml, root_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let root_elem = &xml[root_start..root_elem_end];

    let name = parse_string_attr(root_elem, b"name=\"")?;
    let source_name = parse_string_attr(root_elem, b"sourceName=\"")?;
    let uid = parse_string_attr(root_elem, b"uid=\"")
        .or_else(|| parse_string_attr(root_elem, b"xr10:uid=\""));

    let root_close =
        find_closing_tag(xml, b"slicerCacheDefinition", root_start).unwrap_or(xml.len());
    let body = &xml[root_elem_end..root_close];

    Some(SlicerCacheDef {
        name,
        uid,
        source_name,
        pivot_tables: parse_slicer_pivot_tables(body),
        tabular_data: parse_tabular_data(body),
        table_slicer_cache: parse_table_slicer_cache_from_ext(body),
        ext_lst: extract_direct_child_ext_lst(body),
    })
}

fn parse_slicer_pivot_tables(body: &[u8]) -> Vec<SlicerPivotTableRef> {
    let mut refs = Vec::new();

    if find_tag_simd(body, b"pivotTable", 0).is_none() {
        return refs;
    }

    let mut pos = 0;
    while pos < body.len() {
        let pt_start = match find_pivot_table_element(body, pos) {
            Some(s) => s,
            None => break,
        };

        let elem_end = find_gt_simd(body, pt_start)
            .map(|p| p + 1)
            .unwrap_or(body.len());
        let elem = &body[pt_start..elem_end];

        if let (Some(tab_id), Some(name)) = (
            parse_u32_attr(elem, b"tabId=\""),
            parse_string_attr(elem, b"name=\""),
        ) {
            refs.push(SlicerPivotTableRef { tab_id, name });
        }

        pos = elem_end;
    }

    refs
}

fn find_pivot_table_element(xml: &[u8], start: usize) -> Option<usize> {
    find_tag_simd(xml, b"pivotTable", start)
}

fn parse_tabular_data(body: &[u8]) -> Option<SlicerTabularData> {
    let tabular_start = find_tag_simd(body, b"tabular", 0)?;
    let tabular_elem_end = find_gt_simd(body, tabular_start)
        .map(|p| p + 1)
        .unwrap_or(body.len());
    let tabular_elem = &body[tabular_start..tabular_elem_end];

    let pivot_cache_id = parse_u32_attr(tabular_elem, b"pivotCacheId=\"")?;
    let tabular_close = find_closing_tag(body, b"tabular", tabular_start).unwrap_or(body.len());
    let tabular_body = &body[tabular_elem_end..tabular_close];

    Some(SlicerTabularData {
        pivot_cache_id,
        sort_order: parse_sort_order_attr(tabular_elem, b"sortOrder=\""),
        custom_list_sort: parse_bool_attr_with_default(tabular_elem, b"customListSort=\"", false),
        show_missing: parse_bool_attr_with_default(tabular_elem, b"showMissing=\"", false),
        cross_filter: parse_cross_filter_attr(tabular_elem, b"crossFilter=\""),
        items: parse_tabular_items(tabular_body),
        ext_lst: extract_last_ext_lst(tabular_body),
    })
}

fn parse_tabular_items(body: &[u8]) -> Vec<SlicerTabularItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while pos < body.len() {
        let lt_pos = match memchr::memchr(b'<', &body[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        if lt_pos + 1 < body.len() && body[lt_pos + 1] == b'/' {
            pos = lt_pos + 2;
            continue;
        }

        let after_lt = lt_pos + 1;
        if after_lt >= body.len() {
            break;
        }

        if is_item_element(body, after_lt) {
            let elem_end = find_gt_simd(body, after_lt)
                .map(|p| p + 1)
                .unwrap_or(body.len());
            let elem = &body[after_lt..elem_end];

            if let Some(x) = parse_u32_attr(elem, b"x=\"") {
                let s = parse_bool_attr_with_default(elem, b"s=\"", false);
                let nd = parse_bool_attr_with_default(elem, b"nd=\"", false);
                items.push(SlicerTabularItem {
                    x,
                    s,
                    nd,
                    unknown_attrs: parse_item_unknown_attrs(elem),
                });
            }

            pos = elem_end;
        } else {
            pos = lt_pos + 1;
        }
    }

    items
}

fn parse_item_unknown_attrs(elem: &[u8]) -> Vec<SlicerUnknownAttribute> {
    let mut attrs = Vec::new();
    let mut pos = tag_name_end(elem, 0);

    while pos < elem.len() {
        while pos < elem.len() && elem[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= elem.len() || matches!(elem[pos], b'/' | b'>') {
            break;
        }

        let name_start = pos;
        while pos < elem.len()
            && !matches!(elem[pos], b'=' | b'/' | b'>' | b' ' | b'\t' | b'\n' | b'\r')
        {
            pos += 1;
        }
        let name = &elem[name_start..pos];

        while pos < elem.len() && elem[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= elem.len() || elem[pos] != b'=' {
            continue;
        }
        pos += 1;
        while pos < elem.len() && elem[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= elem.len() || !matches!(elem[pos], b'"' | b'\'') {
            continue;
        }
        let quote = elem[pos];
        pos += 1;
        let value_start = pos;
        while pos < elem.len() && elem[pos] != quote {
            pos += 1;
        }
        let value = &elem[value_start..pos];
        if pos < elem.len() {
            pos += 1;
        }

        if should_preserve_item_attr(name) {
            if let (Ok(name), Ok(value)) = (std::str::from_utf8(name), std::str::from_utf8(value)) {
                attrs.push(SlicerUnknownAttribute {
                    name: name.to_string(),
                    value: decode_xml_entities_string(value),
                });
            }
        }
    }

    attrs
}

fn should_preserve_item_attr(name: &[u8]) -> bool {
    name != b"x"
        && name != b"s"
        && name != b"nd"
        && name != b"r:id"
        && !name.starts_with(b"xmlns")
        && !name.ends_with(b":id")
}

fn is_item_element(xml: &[u8], start: usize) -> bool {
    let mut local_start = start;

    let mut p = start;
    while p < xml.len() && xml[p].is_ascii_alphanumeric() {
        p += 1;
    }
    if p < xml.len() && xml[p] == b':' {
        local_start = p + 1;
    }

    if local_start >= xml.len() || xml[local_start] != b'i' {
        return false;
    }
    let after = local_start + 1;
    if after >= xml.len() {
        return false;
    }
    xml[after] == b' ' || xml[after] == b'/' || xml[after] == b'>'
}

fn parse_table_slicer_cache_from_ext(body: &[u8]) -> Option<TableSlicerCache> {
    let tsc_start = find_tag_simd(body, b"tableSlicerCache", 0)?;
    let tsc_elem_end = find_gt_simd(body, tsc_start)
        .map(|p| p + 1)
        .unwrap_or(body.len());
    let tsc_elem = &body[tsc_start..tsc_elem_end];

    let tsc_close = find_closing_tag(body, b"tableSlicerCache", tsc_start);
    let tsc_xml_end = tsc_close
        .and_then(|close_start| find_gt_simd(body, close_start).map(|end| end + 1))
        .unwrap_or(tsc_elem_end);
    let tsc_xml = &body[tsc_start..tsc_xml_end];

    Some(TableSlicerCache {
        table_id: parse_u32_attr(tsc_elem, b"tableId=\"")?,
        column: parse_u32_attr(tsc_elem, b"column=\"")?,
        sort_order: parse_sort_order_attr(tsc_elem, b"sortOrder=\""),
        custom_list_sort: parse_bool_attr_with_default(tsc_elem, b"customListSort=\"", false),
        cross_filter: parse_cross_filter_attr(tsc_elem, b"crossFilter=\""),
        ext_lst: extract_last_ext_lst(tsc_xml),
    })
}

fn extract_direct_child_ext_lst(body: &[u8]) -> Option<String> {
    let mut pos = 0;

    while let Some(lt) = memchr::memchr(b'<', &body[pos..]).map(|p| p + pos) {
        let name_start = lt + 1;
        if name_start >= body.len() {
            return None;
        }
        if matches!(body[name_start], b'/' | b'!' | b'?') {
            pos = find_gt_simd(body, lt).map_or(body.len(), |end| end + 1);
            continue;
        }

        let tag_end = find_gt_simd(body, lt)?;
        let name_end = tag_name_end(body, name_start);
        if local_name(&body[name_start..name_end]) == b"extLst" {
            let close = find_closing_tag(body, b"extLst", tag_end)?;
            let close_end = find_gt_simd(body, close).map(|p| p + 1).unwrap_or(close);
            return std::str::from_utf8(&body[lt..close_end])
                .ok()
                .map(|s| s.to_string());
        }

        pos = if tag_end > lt && body[tag_end - 1] == b'/' {
            tag_end + 1
        } else {
            let close = find_closing_tag(body, local_name(&body[name_start..name_end]), tag_end)?;
            find_gt_simd(body, close).map_or(body.len(), |end| end + 1)
        };
    }

    None
}

fn extract_last_ext_lst(body: &[u8]) -> Option<String> {
    let mut pos = 0;
    let mut ext = None;

    while let Some(ext_start) = find_tag_simd(body, b"extLst", pos) {
        let ext_close = match find_closing_tag(body, b"extLst", ext_start) {
            Some(close) => close,
            None => break,
        };
        let close_end = find_gt_simd(body, ext_close)
            .map(|p| p + 1)
            .unwrap_or(ext_close);
        ext = std::str::from_utf8(&body[ext_start..close_end])
            .ok()
            .map(|s| s.to_string());
        pos = close_end;
    }

    ext
}

fn tag_name_end(xml: &[u8], mut pos: usize) -> usize {
    while pos < xml.len() {
        if matches!(xml[pos], b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r') {
            break;
        }
        pos += 1;
    }
    pos
}

fn local_name(name: &[u8]) -> &[u8] {
    name.iter()
        .rposition(|b| *b == b':')
        .map_or(name, |idx| &name[idx + 1..])
}

#[cfg(test)]
mod tests {
    use super::super::super::types::{SlicerCrossFilter, SlicerSortOrder};
    use super::*;

    #[test]
    fn parses_cache_with_table_slicer_cache() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicerCacheDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
    name="Slicer_Region" sourceName="Region">
  <extLst>
    <ext uri="{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}">
      <x15:tableSlicerCache tableId="1" column="3" sortOrder="ascending" customListSort="0" crossFilter="showItemsWithDataAtTop"/>
    </ext>
  </extLst>
</x14:slicerCacheDefinition>"#;

        let cache = parse_slicer_cache(xml).unwrap();
        assert_eq!(cache.name, "Slicer_Region");
        assert_eq!(cache.source_name, "Region");
        assert!(cache.pivot_tables.is_empty());
        assert!(cache.tabular_data.is_none());

        let tsc = cache.table_slicer_cache.unwrap();
        assert_eq!(tsc.table_id, 1);
        assert_eq!(tsc.column, 3);
        assert_eq!(tsc.sort_order, SlicerSortOrder::Ascending);
        assert!(!tsc.custom_list_sort);
        assert_eq!(tsc.cross_filter, SlicerCrossFilter::ShowItemsWithDataAtTop);
    }

    #[test]
    fn parses_cache_with_tabular_data_and_items() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicerCacheDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
    name="Slicer_City" sourceName="City">
  <x14:pivotTables>
    <x14:pivotTable tabId="0" name="PivotTable1"/>
  </x14:pivotTables>
  <x14:data>
    <x14:tabular pivotCacheId="5" sortOrder="descending" showMissing="1" crossFilter="none">
      <x14:items count="4">
        <x14:i x="0"/>
        <x14:i x="1" s="1"/>
        <x14:i x="2" s="0" nd="1"/>
        <x14:i x="3"/>
      </x14:items>
    </x14:tabular>
  </x14:data>
</x14:slicerCacheDefinition>"#;

        let cache = parse_slicer_cache(xml).unwrap();
        assert_eq!(cache.pivot_tables.len(), 1);
        assert_eq!(cache.pivot_tables[0].tab_id, 0);
        assert_eq!(cache.pivot_tables[0].name, "PivotTable1");

        let tabular = cache.tabular_data.unwrap();
        assert_eq!(tabular.pivot_cache_id, 5);
        assert_eq!(tabular.sort_order, SlicerSortOrder::Descending);
        assert!(tabular.show_missing);
        assert_eq!(tabular.cross_filter, SlicerCrossFilter::None);
        assert_eq!(tabular.items.len(), 4);
        assert_eq!(tabular.items[0].x, 0);
        assert!(!tabular.items[0].s);
        assert!(!tabular.items[0].nd);
        assert_eq!(tabular.items[1].x, 1);
        assert!(tabular.items[1].s);
        assert!(!tabular.items[1].nd);
        assert_eq!(tabular.items[2].x, 2);
        assert!(!tabular.items[2].s);
        assert!(tabular.items[2].nd);
        assert_eq!(tabular.items[3].x, 3);
        assert!(!tabular.items[3].s);
        assert!(!tabular.items[3].nd);
    }

    #[test]
    fn parses_cache_with_uid() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicerCacheDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
    xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2024/richdata2"
    name="Slicer_Region" xr10:uid="{12345678-1234-1234-1234-123456789ABC}" sourceName="Region">
</x14:slicerCacheDefinition>"#;

        let cache = parse_slicer_cache(xml).unwrap();
        assert_eq!(cache.name, "Slicer_Region");
        assert_eq!(
            cache.uid.as_deref(),
            Some("{12345678-1234-1234-1234-123456789ABC}")
        );
        assert_eq!(cache.source_name, "Region");
    }

    #[test]
    fn returns_none_for_empty_cache() {
        assert!(parse_slicer_cache(b"<root></root>").is_none());
    }

    #[test]
    fn tabular_items_accept_prefixed_and_unprefixed_i_only() {
        let body = br#"<items><i x="1"/><x14:i x="2" s="1"/><items x="99"/></items>"#;
        let items = parse_tabular_items(body);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].x, 1);
        assert_eq!(items[1].x, 2);
        assert!(items[1].s);
    }

    #[test]
    fn table_slicer_cache_requires_table_id_and_column() {
        assert!(
            parse_table_slicer_cache_from_ext(br#"<x15:tableSlicerCache tableId="1"/>"#).is_none()
        );
        assert!(
            parse_table_slicer_cache_from_ext(br#"<x15:tableSlicerCache column="2"/>"#).is_none()
        );

        let cache =
            parse_table_slicer_cache_from_ext(br#"<x15:tableSlicerCache tableId="1" column="2"/>"#)
                .unwrap();
        assert_eq!(cache.sort_order, SlicerSortOrder::Ascending);
        assert!(!cache.custom_list_sort);
        assert_eq!(
            cache.cross_filter,
            SlicerCrossFilter::ShowItemsWithDataAtTop
        );
    }

    #[test]
    fn ext_lst_extraction_preserves_nested_xml_and_closing_tag() {
        let ext = extract_last_ext_lst(
            br#"<before/><extLst><ext><nested value="1"/></ext></extLst><after/>"#,
        )
        .unwrap();
        assert_eq!(ext, r#"<extLst><ext><nested value="1"/></ext></extLst>"#);
    }
}
