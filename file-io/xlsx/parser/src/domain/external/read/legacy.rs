use crate::infra::scanner::{find_closing_tag, find_tag_simd};
use crate::infra::xml::{parse_string_attr_quoted, parse_u32_attr};

use domain_types::domain::external_link::{
    DdeItem, DdeValue, DdeValueType, ExternalLink, ExternalLinkType, OleItem,
};

use super::support::start_tag_element;

/// Parse a DDE link.
pub(super) fn parse_dde_link(xml: &[u8], start: usize, link_id: &str) -> ExternalLink {
    let (element, element_end) = start_tag_element(xml, start, xml.len());

    let service = parse_string_attr_quoted(element, b"ddeService").unwrap_or_default();
    let topic = parse_string_attr_quoted(element, b"ddeTopic").unwrap_or_default();
    let link_end = find_closing_tag(xml, b"ddeLink", start).unwrap_or(xml.len());
    let items = parse_dde_items(xml, element_end, link_end);

    let mut link = ExternalLink::new(link_id.to_string());
    link.link_type = ExternalLinkType::Dde {
        service,
        topic,
        items,
    };
    link
}

/// Parse an OLE link.
pub(super) fn parse_ole_link(xml: &[u8], start: usize, link_id: &str) -> ExternalLink {
    let (element, element_end) = start_tag_element(xml, start, xml.len());

    let prog_id = parse_string_attr_quoted(element, b"progId").unwrap_or_default();
    let r_id = parse_string_attr_quoted(element, b"r:id");
    let link_end = find_closing_tag(xml, b"oleLink", start).unwrap_or(xml.len());
    let items = parse_ole_items(xml, element_end, link_end);

    let mut link = ExternalLink::new(link_id.to_string());
    link.link_type = ExternalLinkType::Ole {
        prog_id,
        r_id,
        items,
    };
    link
}

fn parse_dde_items(xml: &[u8], start: usize, end: usize) -> Vec<DdeItem> {
    let Some(items_start) = find_tag_simd(xml, b"ddeItems", start).filter(|&p| p < end) else {
        return Vec::new();
    };
    let items_end = find_closing_tag(xml, b"ddeItems", items_start).unwrap_or(end);
    let mut items = Vec::new();
    let mut pos = items_start;
    while let Some(item_start) = find_tag_simd(xml, b"ddeItem", pos).filter(|&p| p < items_end) {
        let (element, element_end) = start_tag_element(xml, item_start, items_end);
        let item_end = if element.ends_with(b"/>") {
            element_end
        } else {
            find_closing_tag(xml, b"ddeItem", item_start).unwrap_or(items_end)
        };
        let mut item = DdeItem {
            name: parse_string_attr_quoted(element, b"name"),
            ole: parse_bool_attr_quoted(element, b"ole").unwrap_or(false),
            advise: parse_bool_attr_quoted(element, b"advise").unwrap_or(false),
            prefer_pic: parse_bool_attr_quoted(element, b"preferPic").unwrap_or(false),
            ..Default::default()
        };
        parse_dde_values(xml, element_end, item_end, &mut item);
        items.push(item);
        pos = item_end.saturating_add(1);
    }
    items
}

fn parse_dde_values(xml: &[u8], start: usize, end: usize, item: &mut DdeItem) {
    let values_start = find_tag_simd(xml, b"values", start)
        .or_else(|| find_tag_simd(xml, b"ddeValues", start))
        .filter(|&p| p < end);
    let Some(values_start) = values_start else {
        return;
    };
    let (values_el, values_el_end) = start_tag_element(xml, values_start, end);
    item.rows = parse_u32_attr(values_el, b"rows=\"");
    item.cols = parse_u32_attr(values_el, b"cols=\"");
    let values_end = find_closing_tag(xml, b"values", values_start)
        .or_else(|| find_closing_tag(xml, b"ddeValues", values_start))
        .unwrap_or(end);
    let mut pos = values_el_end;
    while let Some(value_start) = find_tag_simd(xml, b"value", pos).filter(|&p| p < values_end) {
        let (value_el, value_el_end) = start_tag_element(xml, value_start, values_end);
        let value_type = parse_dde_value_type(parse_string_attr_quoted(value_el, b"t").as_deref());
        let value = parse_string_attr_quoted(value_el, b"val").unwrap_or_else(|| {
            if value_el.ends_with(b"/>") {
                String::new()
            } else {
                let value_end = find_closing_tag(xml, b"value", value_start).unwrap_or(values_end);
                crate::infra::xml::decode_xml_entities(&xml[value_el_end..value_end])
            }
        });
        item.values.push(DdeValue { value_type, value });
        pos = value_el_end;
    }
}

fn parse_ole_items(xml: &[u8], start: usize, end: usize) -> Vec<OleItem> {
    let Some(items_start) = find_tag_simd(xml, b"oleItems", start).filter(|&p| p < end) else {
        return Vec::new();
    };
    let items_end = find_closing_tag(xml, b"oleItems", items_start).unwrap_or(end);
    let mut items = Vec::new();
    let mut pos = items_start;
    while let Some(item_start) = find_tag_simd(xml, b"oleItem", pos).filter(|&p| p < items_end) {
        let (element, element_end) = start_tag_element(xml, item_start, items_end);
        if let Some(name) = parse_string_attr_quoted(element, b"name") {
            items.push(OleItem {
                name,
                icon: parse_bool_attr_quoted(element, b"icon").unwrap_or(false),
                advise: parse_bool_attr_quoted(element, b"advise").unwrap_or(false),
                prefer_pic: parse_bool_attr_quoted(element, b"preferPic").unwrap_or(false),
            });
        }
        pos = element_end;
    }
    items
}

fn parse_bool_attr_quoted(element: &[u8], name: &[u8]) -> Option<bool> {
    parse_string_attr_quoted(element, name).map(|value| {
        value == "1" || value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("on")
    })
}

fn parse_dde_value_type(value: Option<&str>) -> DdeValueType {
    match value {
        Some("nil") => DdeValueType::Nil,
        Some("b") => DdeValueType::Boolean,
        Some("e") => DdeValueType::Error,
        Some("str") => DdeValueType::String,
        _ => DdeValueType::Number,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::scanner::find_tag_simd;

    #[test]
    fn parse_dde_link_defaults_missing_attributes() {
        let xml = br#"<externalLink><ddeLink></ddeLink></externalLink>"#;
        let start = find_tag_simd(xml, b"ddeLink", 0).unwrap();
        let link = parse_dde_link(xml, start, "1");
        match link.link_type {
            ExternalLinkType::Dde { service, topic, .. } => {
                assert!(service.is_empty());
                assert!(topic.is_empty());
            }
            _ => panic!("expected DDE link"),
        }
    }

    #[test]
    fn parse_dde_items_and_values() {
        let xml = br#"<externalLink>
            <ddeLink ddeService="Excel" ddeTopic="[Book1.xlsx]Sheet1">
                <ddeItems>
                    <ddeItem name="R1C1" ole="on" advise="true" preferPic="1">
                        <ddeValues rows="1" cols="2">
                            <value t="str" val="hello"/>
                            <value t="n">42 &amp; more</value>
                        </ddeValues>
                    </ddeItem>
                </ddeItems>
            </ddeLink>
        </externalLink>"#;

        let start = find_tag_simd(xml, b"ddeLink", 0).unwrap();
        let link = parse_dde_link(xml, start, "1");
        match link.link_type {
            ExternalLinkType::Dde { items, .. } => {
                assert_eq!(items.len(), 1);
                assert!(items[0].ole);
                assert!(items[0].advise);
                assert!(items[0].prefer_pic);
                assert_eq!(items[0].rows, Some(1));
                assert_eq!(items[0].cols, Some(2));
                assert_eq!(items[0].values[0].value_type, DdeValueType::String);
                assert_eq!(items[0].values[0].value, "hello");
                assert_eq!(items[0].values[1].value_type, DdeValueType::Number);
                assert_eq!(items[0].values[1].value, "42 & more");
            }
            _ => panic!("expected DDE link"),
        }
    }

    #[test]
    fn parse_ole_link_items() {
        let xml = br#"<externalLink>
            <oleLink progId="Excel.Sheet.12" r:id="rId1">
                <oleItems>
                    <oleItem name="Sheet1" icon="1" advise="1" preferPic="1"/>
                </oleItems>
            </oleLink>
        </externalLink>"#;

        let start = find_tag_simd(xml, b"oleLink", 0).unwrap();
        let link = parse_ole_link(xml, start, "1");
        match link.link_type {
            ExternalLinkType::Ole {
                prog_id,
                r_id,
                items,
            } => {
                assert_eq!(prog_id, "Excel.Sheet.12");
                assert_eq!(r_id.as_deref(), Some("rId1"));
                assert_eq!(items.len(), 1);
                assert_eq!(items[0].name, "Sheet1");
                assert!(items[0].icon);
                assert!(items[0].advise);
                assert!(items[0].prefer_pic);
            }
            _ => panic!("expected OLE link"),
        }
    }
}
