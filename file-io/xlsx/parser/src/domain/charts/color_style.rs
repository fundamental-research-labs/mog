use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_tag_simd};
use crate::write::xml_writer::XmlWriter;

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
    if normalized_colors.is_empty() && color_scheme.is_none() {
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
        .attr("meth", "cycle")
        .attr_num("id", color_scheme.unwrap_or(0))
        .end_attrs();

    for color in normalized_colors {
        w.start_element("cs:variation").end_attrs();
        w.start_element("a:srgbClr")
            .attr("val", &color)
            .self_close();
        w.end_element("cs:variation");
    }

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
    use super::{build_chart_color_style_xml, parse_chart_color_style_xml};

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
    }

    #[test]
    fn chart_color_style_xml_preserves_color_scheme_id() {
        let xml = build_chart_color_style_xml(None, Some(1)).expect("color style xml");
        let projection = parse_chart_color_style_xml(&xml);

        assert_eq!(projection.colors, None);
        assert_eq!(projection.color_scheme, Some(1));
    }
}
