//! Shape-scoped VML lexical metadata. Current note state remains authoritative.

use domain_types::{VmlStyleDimensionInfo, VmlStyleDimensionStatus};
use quick_xml::{Reader, events::Event};

use crate::write::xml_writer::XmlWriter;

pub(crate) struct Element<'a> {
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub xml: &'a str,
}

impl Element<'_> {
    pub fn local_name(&self) -> &str {
        self.name.rsplit(':').next().unwrap_or(&self.name)
    }

    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// Parse a root and its direct children, retaining individually validated XML
/// fragments rather than replaying an imported drawing part.
pub(crate) fn elements(xml: &str) -> Option<(Element<'_>, Vec<Element<'_>>)> {
    let mut reader = Reader::from_str(xml);
    let mut root = None;
    let mut children = Vec::new();
    let mut pending = None;
    let mut depth = 0usize;
    loop {
        let start = reader.buffer_position() as usize;
        match reader.read_event().ok()? {
            Event::Start(tag) | Event::Empty(tag) => {
                let end = reader.buffer_position() as usize;
                let empty = xml.get(start..end)?.trim_end().ends_with("/>");
                let name = String::from_utf8(tag.name().as_ref().to_vec()).ok()?;
                let attrs = tag
                    .attributes()
                    .map(|attribute| {
                        let attribute = attribute.ok()?;
                        Some((
                            String::from_utf8(attribute.key.as_ref().to_vec()).ok()?,
                            attribute
                                .decode_and_unescape_value(reader.decoder())
                                .ok()?
                                .into_owned(),
                        ))
                    })
                    .collect::<Option<Vec<_>>>()?;
                if depth == 0 {
                    if root.is_some() {
                        return None;
                    }
                    root = Some(Element { name, attrs, xml });
                } else if depth == 1 {
                    if empty {
                        children.push(Element {
                            name,
                            attrs,
                            xml: xml.get(start..end)?,
                        });
                    } else {
                        pending = Some((name, attrs, start));
                    }
                }
                if !empty {
                    depth += 1;
                }
            }
            Event::End(_) => {
                depth = depth.checked_sub(1)?;
                if depth == 1 {
                    let (name, attrs, start) = pending.take()?;
                    children.push(Element {
                        name,
                        attrs,
                        xml: xml.get(start..reader.buffer_position() as usize)?,
                    });
                }
            }
            Event::Eof => return (depth == 0).then_some((root?, children)),
            _ => {}
        }
    }
}

/// Give a fragment its original namespace scope, including bindings inherited
/// from the source drawing root. Local declarations override inherited ones.
pub(crate) fn scoped_fragment(xml: &str, namespaces: &[(String, String)]) -> Option<String> {
    let (element, _) = elements(xml)?;
    let open_end = xml.find('>')?;
    let empty = xml.get(..open_end)?.trim_end().ends_with('/');
    let mut writer = XmlWriter::new();
    writer.start_element(&element.name);
    for (name, value) in namespaces {
        if !element.attrs.iter().any(|(key, _)| key == name) {
            writer.attr(name, value);
        }
    }
    for (name, value) in &element.attrs {
        writer.attr(name, value);
    }
    if empty {
        writer.self_close();
    } else {
        writer.end_attrs();
        let close_start = xml.rfind(&format!("</{}", element.name))?;
        writer.raw_str(xml.get(open_end + 1..close_start)?);
        writer.end_element(&element.name);
    }
    String::from_utf8(writer.finish()).ok()
}

pub(crate) fn namespace_attrs(attrs: &[(String, String)]) -> Vec<(String, String)> {
    attrs
        .iter()
        .filter(|(name, _)| name == "xmlns" || name.starts_with("xmlns:"))
        .cloned()
        .collect()
}

pub(crate) fn parse_style_dimension(style: &str, property: &str) -> Option<VmlStyleDimensionInfo> {
    let value = style
        .split(';')
        .filter_map(|declaration| declaration.split_once(':'))
        .find_map(|(name, value)| {
            name.trim()
                .eq_ignore_ascii_case(property)
                .then_some(value.trim())
        })?;
    Some(parse_vml_style_dimension(value))
}

fn parse_vml_style_dimension(value: &str) -> VmlStyleDimensionInfo {
    let raw = value.trim().to_string();
    if raw.is_empty() {
        return VmlStyleDimensionInfo {
            raw,
            normalized_pt: None,
            status: VmlStyleDimensionStatus::Malformed,
            unit: None,
        };
    }

    let split_at = raw
        .char_indices()
        .find_map(|(idx, ch)| {
            (!(ch.is_ascii_digit() || matches!(ch, '+' | '-' | '.'))).then_some(idx)
        })
        .unwrap_or(raw.len());
    let (number, unit) = raw.split_at(split_at);
    let unit = unit.trim();
    let Ok(amount) = number.trim().parse::<f64>() else {
        let unit = (!unit.is_empty()).then(|| unit.to_ascii_lowercase());
        return VmlStyleDimensionInfo {
            raw,
            normalized_pt: None,
            status: VmlStyleDimensionStatus::Malformed,
            unit,
        };
    };

    if unit.is_empty() {
        return VmlStyleDimensionInfo {
            raw,
            normalized_pt: (amount == 0.0).then_some(0.0),
            status: if amount == 0.0 {
                VmlStyleDimensionStatus::UnitlessZero
            } else {
                VmlStyleDimensionStatus::UnsupportedUnit
            },
            unit: None,
        };
    }

    let unit_lower = unit.to_ascii_lowercase();
    let normalized_pt = match unit_lower.as_str() {
        "pt" => Some(amount),
        "in" => Some(amount * 72.0),
        "cm" => Some(amount * 72.0 / 2.54),
        "mm" => Some(amount * 72.0 / 25.4),
        "pc" => Some(amount * 12.0),
        // CSS pixel semantics at 96 DPI: 1px = 0.75pt.
        "px" => Some(amount * 0.75),
        _ => None,
    };

    VmlStyleDimensionInfo {
        raw,
        normalized_pt,
        status: if normalized_pt.is_some() {
            VmlStyleDimensionStatus::Supported
        } else {
            VmlStyleDimensionStatus::UnsupportedUnit
        },
        unit: Some(unit_lower),
    }
}

pub(crate) fn capture_shape(
    xml: &[u8],
    root: &Element<'_>,
    document_children: &[Element<'_>],
    anchor: domain_types::VmlCellAnchor,
    visible: bool,
) -> Option<domain_types::VmlShapePresentation> {
    let (element, children) = elements(std::str::from_utf8(xml).ok()?)?;
    let mut namespaces = namespace_attrs(&root.attrs);
    for (name, value) in namespace_attrs(&element.attrs) {
        namespaces.retain(|(key, _)| key != &name);
        namespaces.push((name, value));
    }
    let mut presentation = domain_types::VmlShapePresentation {
        namespace_attrs: namespaces.clone(),
        shape_attrs: element.attrs.clone(),
        anchor,
        visible,
        width: element
            .attr("style")
            .and_then(|style| parse_style_dimension(style, "width")),
        height: element
            .attr("style")
            .and_then(|style| parse_style_dimension(style, "height")),
        ..Default::default()
    };
    for child in children {
        if child.local_name() == "ClientData" {
            presentation.client_data_attrs = child.attrs.clone();
            let (_, data) = elements(child.xml)?;
            for property in data {
                match property.local_name() {
                    "Anchor" | "Row" | "Column" => {}
                    "Visible" => presentation.visible_element_xml = Some(property.xml.to_string()),
                    _ => presentation
                        .client_data_children_xml
                        .push(property.xml.to_string()),
                }
            }
        } else {
            presentation.children_xml.push(child.xml.to_string());
        }
    }
    for child in document_children {
        match child.local_name() {
            "shapetype"
                if child.attr("id")
                    == element
                        .attr("type")
                        .and_then(|value| value.strip_prefix('#')) =>
            {
                presentation.shape_type_xml =
                    scoped_fragment(child.xml, &namespace_attrs(&root.attrs));
            }
            "shapelayout" => {
                presentation.shape_layout_xml =
                    scoped_fragment(child.xml, &namespace_attrs(&root.attrs))
            }
            _ => {}
        }
    }
    Some(presentation)
}
