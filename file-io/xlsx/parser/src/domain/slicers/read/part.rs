use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_with_default, parse_string_attr, parse_u32_attr};

use super::super::types::SlicerDef;

/// Parse a slicer part XML file (`xl/slicers/slicer{N}.xml`).
pub fn parse_slicer_part(xml: &[u8]) -> Vec<SlicerDef> {
    let mut slicers = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        let slicer_start = match find_slicer_element(xml, pos) {
            Some(s) => s,
            None => break,
        };

        let elem_end = find_gt_simd(xml, slicer_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let elem = &xml[slicer_start..elem_end];

        let slicer_end = if elem_end > slicer_start && xml[elem_end - 2] == b'/' {
            elem_end
        } else {
            find_closing_tag(xml, b"slicer", elem_end)
                .and_then(|close_start| find_gt_simd(xml, close_start).map(|end| end + 1))
                .unwrap_or(elem_end)
        };
        let slicer_xml = &xml[slicer_start..slicer_end];

        if let Some(slicer) = parse_single_slicer(elem, slicer_xml) {
            slicers.push(slicer);
        }

        pos = slicer_end;
    }

    slicers
}

fn find_slicer_element(xml: &[u8], start: usize) -> Option<usize> {
    let prefixed = find_tag_simd(xml, b"x14:slicer", start);
    let unprefixed = find_tag_simd(xml, b"slicer", start);

    match (prefixed, unprefixed) {
        (Some(p), Some(u)) => {
            let first = p.min(u);
            if is_slicer_element(xml, first) {
                Some(first)
            } else {
                let skip_end = find_gt_simd(xml, first).map(|p| p + 1).unwrap_or(first + 1);
                find_slicer_element(xml, skip_end)
            }
        }
        (Some(p), None) => {
            if is_slicer_element(xml, p) {
                Some(p)
            } else {
                let skip_end = find_gt_simd(xml, p).map(|p| p + 1).unwrap_or(p + 1);
                find_slicer_element(xml, skip_end)
            }
        }
        (None, Some(u)) => {
            if is_slicer_element(xml, u) {
                Some(u)
            } else {
                let skip_end = find_gt_simd(xml, u).map(|p| p + 1).unwrap_or(u + 1);
                find_slicer_element(xml, skip_end)
            }
        }
        (None, None) => None,
    }
}

fn is_slicer_element(xml: &[u8], pos: usize) -> bool {
    let name_start = if pos < xml.len() && xml[pos] == b'<' {
        pos + 1
    } else {
        pos
    };
    let tag_end = find_gt_simd(xml, name_start).unwrap_or(xml.len());
    let tag_slice = &xml[name_start..tag_end];

    let name_len = tag_slice
        .iter()
        .position(|&b| matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/'))
        .unwrap_or(tag_slice.len());
    let elem_name = &tag_slice[..name_len];

    if let Some(colon_pos) = memchr::memchr(b':', elem_name) {
        let local_name = &elem_name[colon_pos + 1..];
        local_name == b"slicer"
    } else {
        elem_name == b"slicer"
    }
}

fn parse_single_slicer(elem: &[u8], slicer_xml: &[u8]) -> Option<SlicerDef> {
    let name = parse_string_attr(elem, b"name=\"")?;
    let cache = parse_string_attr(elem, b"cache=\"")?;

    Some(SlicerDef {
        name,
        cache,
        caption: parse_string_attr(elem, b"caption=\""),
        start_item: parse_u32_attr(elem, b"startItem=\""),
        column_count: parse_u32_attr(elem, b"columnCount=\"").unwrap_or(1),
        show_caption: parse_bool_attr_with_default(elem, b"showCaption=\"", true),
        level: parse_u32_attr(elem, b"level=\"").unwrap_or(0),
        style: parse_string_attr(elem, b"style=\""),
        locked_position: parse_bool_attr_with_default(elem, b"lockedPosition=\"", false),
        row_height: parse_u32_attr(elem, b"rowHeight=\""),
        uid: parse_string_attr(elem, b"xr10:uid=\"").or_else(|| parse_string_attr(elem, b"uid=\"")),
        ext_lst: extract_ext_lst(slicer_xml),
    })
}

fn extract_ext_lst(xml: &[u8]) -> Option<String> {
    let ext_start = find_tag_simd(xml, b"extLst", 0)?;
    let ext_close = find_closing_tag(xml, b"extLst", ext_start)?;
    let close_end = find_gt_simd(xml, ext_close)
        .map(|p| p + 1)
        .unwrap_or(ext_close);

    std::str::from_utf8(&xml[ext_start..close_end])
        .ok()
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_table_slicer() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer name="Slicer_Region" cache="Slicer_Region" caption="Region" columnCount="2" showCaption="1" style="SlicerStyleLight1" rowHeight="241300"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);

        let s = &slicers[0];
        assert_eq!(s.name, "Slicer_Region");
        assert_eq!(s.cache, "Slicer_Region");
        assert_eq!(s.caption.as_deref(), Some("Region"));
        assert_eq!(s.column_count, 2);
        assert!(s.show_caption);
        assert_eq!(s.style.as_deref(), Some("SlicerStyleLight1"));
        assert_eq!(s.row_height, Some(241300));
        assert_eq!(s.level, 0);
        assert!(!s.locked_position);
    }

    #[test]
    fn parses_multiple_slicers_in_one_part() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer name="Slicer_Region" cache="Slicer_Region" caption="Region"/>
  <x14:slicer name="Slicer_Category" cache="Slicer_Category" caption="Category" columnCount="3" showCaption="0" lockedPosition="1"/>
  <x14:slicer name="Slicer_Year" cache="Slicer_Year" level="2"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 3);
        assert_eq!(slicers[0].name, "Slicer_Region");
        assert_eq!(slicers[0].column_count, 1);
        assert!(slicers[0].show_caption);
        assert_eq!(slicers[1].name, "Slicer_Category");
        assert_eq!(slicers[1].column_count, 3);
        assert!(!slicers[1].show_caption);
        assert!(slicers[1].locked_position);
        assert_eq!(slicers[2].name, "Slicer_Year");
        assert_eq!(slicers[2].level, 2);
    }

    #[test]
    fn parses_slicer_default_values() {
        let xml = br#"<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer name="S1" cache="SC1"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);

        let s = &slicers[0];
        assert_eq!(s.column_count, 1);
        assert!(s.show_caption);
        assert_eq!(s.level, 0);
        assert!(!s.locked_position);
        assert!(s.caption.is_none());
        assert!(s.start_item.is_none());
        assert!(s.style.is_none());
        assert!(s.row_height.is_none());
    }

    #[test]
    fn parses_empty_slicer_part() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert!(slicers.is_empty());
    }

    #[test]
    fn skips_malformed_slicer() {
        let xml = br#"<x14:slicers xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">
  <x14:slicer cache="SC1"/>
  <x14:slicer name="Good" cache="SC2"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);
        assert_eq!(slicers[0].name, "Good");
    }

    #[test]
    fn parses_unprefixed_slicer_and_skips_related_tag_names() {
        let xml = br#"<slicers>
  <slicerCache name="Wrong" cache="Wrong"/>
  <slicer name="Plain" cache="SC1"/>
</slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers.len(), 1);
        assert_eq!(slicers[0].name, "Plain");
    }

    #[test]
    fn prefers_xr10_uid_for_slicer_part() {
        let xml = br#"<x14:slicers>
  <x14:slicer name="S1" cache="SC1" uid="plain" xr10:uid="rich"/>
</x14:slicers>"#;

        let slicers = parse_slicer_part(xml);
        assert_eq!(slicers[0].uid.as_deref(), Some("rich"));
    }
}
