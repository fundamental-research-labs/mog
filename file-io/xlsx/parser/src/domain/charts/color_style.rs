use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_tag_simd};
use crate::write::xml_writer::XmlWriter;
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

const CHART_STYLE_NS: &[u8] = b"http://schemas.microsoft.com/office/drawing/2012/chartStyle";
const DRAWINGML_NS: &[u8] = b"http://schemas.openxmlformats.org/drawingml/2006/main";

#[derive(Default)]
struct ColorStyleStructure {
    valid_root: bool,
    has_method: bool,
    has_direct_base_color: bool,
    direct_child_phase: u8,
    direct_child_order_valid: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ChartColorStyleProjection {
    pub colors: Option<Vec<String>>,
    pub color_scheme: Option<u8>,
}

pub(crate) fn build_chart_color_style_xml(
    colors: Option<&[String]>,
    color_scheme: Option<u8>,
) -> Option<Vec<u8>> {
    let normalized_colors: Vec<_> = colors
        .unwrap_or(&[])
        .iter()
        .filter_map(|color| normalize_hex_color(color))
        .collect();
    // CT_ColorStyle requires one or more direct EG_ColorChoice children. An
    // identifier by itself cannot form a conformant chart color style part.
    if normalized_colors.is_empty() {
        return None;
    }

    let mut w = XmlWriter::new();
    w.write_declaration()
        .start_element("cs:colorStyle")
        .attr(
            "xmlns:cs",
            "http://schemas.microsoft.com/office/drawing/2012/chartStyle",
        )
        .attr(
            "xmlns:a",
            "http://schemas.openxmlformats.org/drawingml/2006/main",
        )
        .attr("meth", "cycle");
    if let Some(color_scheme) = color_scheme {
        w.attr_num("id", color_scheme);
    }
    w.end_attrs();

    for color in normalized_colors {
        w.start_element("a:srgbClr")
            .attr("val", &color)
            .self_close();
    }
    // An empty variation applies the base colors without transforms and is the
    // interoperable Office representation of a direct palette.
    w.start_element("cs:variation").self_close();

    w.end_element("cs:colorStyle");
    Some(w.finish())
}

pub(crate) fn parse_chart_color_style_xml(xml: &[u8]) -> ChartColorStyleProjection {
    let color_scheme = parse_u8_attr(xml, b"id=\"").filter(|id| *id != 0);
    let mut colors = Vec::new();
    let mut cursor = 0;
    while let Some(pos) = find_tag_simd(xml, b"srgbClr", cursor) {
        if let Some(color) = parse_string_attr(&xml[pos..], b"val=\"")
            .as_deref()
            .and_then(normalize_hex_color)
        {
            colors.push(color);
        }
        cursor = pos.saturating_add(1);
    }

    ChartColorStyleProjection {
        colors: (!colors.is_empty()).then_some(colors),
        color_scheme,
    }
}

/// Return whether an imported chart color style satisfies the package-level
/// shape required for safe opaque replay. Historical Mog builds emitted palette
/// colors inside `cs:variation`; those parts are well-formed XML but violate
/// CT_ColorStyle and cause Excel for Mac to remove the owning drawing.
pub(crate) fn chart_color_style_xml_is_replay_safe(xml: &[u8]) -> bool {
    let mut reader = NsReader::from_reader(xml);
    reader.config_mut().trim_text(true);
    reader.config_mut().expand_empty_elements = false;
    let mut buf = Vec::new();
    let mut depth = 0usize;
    let mut structure = ColorStyleStructure {
        direct_child_order_valid: true,
        ..Default::default()
    };

    loop {
        let (namespace, event) = match reader.read_resolved_event_into(&mut buf) {
            Ok(value) => value,
            Err(_) => return false,
        };
        match event {
            Event::Start(start) => {
                inspect_color_style_element(&namespace, &start, depth, &mut structure);
                depth = depth.saturating_add(1);
            }
            Event::Empty(start) => {
                inspect_color_style_element(&namespace, &start, depth, &mut structure)
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            Event::Eof => break,
            Event::Text(_)
            | Event::CData(_)
            | Event::Comment(_)
            | Event::Decl(_)
            | Event::PI(_)
            | Event::DocType(_) => {}
        }
        buf.clear();
    }

    structure.valid_root
        && structure.has_method
        && structure.has_direct_base_color
        && structure.direct_child_order_valid
}

fn inspect_color_style_element(
    namespace: &ResolveResult<'_>,
    start: &BytesStart<'_>,
    depth: usize,
    structure: &mut ColorStyleStructure,
) {
    if depth == 0 {
        structure.valid_root =
            start.local_name().as_ref() == b"colorStyle" && namespace_is(namespace, CHART_STYLE_NS);
        structure.has_method = attr_value(start, b"meth").is_some_and(|method| {
            matches!(
                method.as_str(),
                "cycle"
                    | "withinLinear"
                    | "withinLinearReversed"
                    | "acrossLinear"
                    | "acrossLinearReversed"
            )
        });
    } else if depth == 1 {
        let local_name = start.local_name();
        let local_name = local_name.as_ref();
        if namespace_is(namespace, DRAWINGML_NS)
            && matches!(
                local_name,
                b"scrgbClr" | b"srgbClr" | b"hslClr" | b"sysClr" | b"schemeClr" | b"prstClr"
            )
        {
            structure.has_direct_base_color = true;
            structure.direct_child_order_valid &= structure.direct_child_phase == 0;
        } else if namespace_is(namespace, CHART_STYLE_NS) && local_name == b"variation" {
            structure.direct_child_order_valid &=
                structure.has_direct_base_color && structure.direct_child_phase <= 1;
            structure.direct_child_phase = 1;
        } else if namespace_is(namespace, CHART_STYLE_NS) && local_name == b"extLst" {
            structure.direct_child_order_valid &=
                structure.has_direct_base_color && structure.direct_child_phase <= 1;
            structure.direct_child_phase = 2;
        } else {
            structure.direct_child_order_valid = false;
        }
    }
}

fn namespace_is(namespace: &ResolveResult<'_>, expected: &[u8]) -> bool {
    matches!(namespace, ResolveResult::Bound(Namespace(uri)) if *uri == expected)
}

fn attr_value(start: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    start.attributes().flatten().find_map(|attr| {
        (attr.key.local_name().as_ref() == name)
            .then(|| attr.unescape_value().ok().map(|value| value.into_owned()))
            .flatten()
    })
}

fn normalize_hex_color(value: &str) -> Option<String> {
    let hex = value.trim().strip_prefix('#').unwrap_or(value.trim());
    (hex.len() == 6 && hex.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| hex.to_ascii_uppercase())
}

fn parse_u8_attr(xml: &[u8], attr: &[u8]) -> Option<u8> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    std::str::from_utf8(&xml[start..end]).ok()?.parse().ok()
}

fn parse_string_attr(xml: &[u8], attr: &[u8]) -> Option<String> {
    let attr_pos = find_attr_simd(xml, attr, 0)?;
    let value_start = attr_pos + attr.len();
    let (start, end) = extract_quoted_value(xml, value_start)?;
    Some(String::from_utf8_lossy(&xml[start..end]).to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        build_chart_color_style_xml, chart_color_style_xml_is_replay_safe,
        parse_chart_color_style_xml,
    };

    #[test]
    fn chart_color_style_xml_round_trips_direct_palette() {
        let xml =
            build_chart_color_style_xml(Some(&["#4472c4".to_string(), "ed7d31".to_string()]), None)
                .expect("color style xml");
        let projection = parse_chart_color_style_xml(&xml);

        assert_eq!(
            projection.colors,
            Some(vec!["4472C4".to_string(), "ED7D31".to_string()])
        );
        assert_eq!(projection.color_scheme, None);
        assert!(chart_color_style_xml_is_replay_safe(&xml));
        let xml = String::from_utf8(xml).unwrap();
        assert!(
            xml.contains(r#"<a:srgbClr val="4472C4"/><a:srgbClr val="ED7D31"/><cs:variation/>"#)
        );
        assert!(!xml.contains(r#"id="0""#));
    }

    #[test]
    fn chart_color_style_xml_preserves_color_scheme_id_with_a_palette() {
        let xml = build_chart_color_style_xml(Some(&["4472C4".to_string()]), Some(1))
            .expect("color style xml");
        let projection = parse_chart_color_style_xml(&xml);

        assert_eq!(projection.colors, Some(vec!["4472C4".to_string()]));
        assert_eq!(projection.color_scheme, Some(1));
        assert!(chart_color_style_xml_is_replay_safe(&xml));
    }

    #[test]
    fn chart_color_style_xml_rejects_identifier_without_base_colors() {
        assert_eq!(build_chart_color_style_xml(None, Some(1)), None);
    }

    #[test]
    fn historical_nested_palette_is_salvaged_but_not_replay_safe() {
        let xml = br#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="cycle" id="0"><cs:variation><a:srgbClr val="AAD7E2"/></cs:variation></cs:colorStyle>"#;
        let projection = parse_chart_color_style_xml(xml);

        assert_eq!(projection.colors, Some(vec!["AAD7E2".to_string()]));
        assert_eq!(projection.color_scheme, None);
        assert!(!chart_color_style_xml_is_replay_safe(xml));
    }

    #[test]
    fn color_style_with_base_color_after_variation_is_not_replay_safe() {
        let xml = br#"<cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="cycle"><cs:variation/><a:srgbClr val="AAD7E2"/></cs:colorStyle>"#;

        assert!(!chart_color_style_xml_is_replay_safe(xml));
    }
}
