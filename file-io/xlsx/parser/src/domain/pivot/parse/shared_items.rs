//! Shared item parsing for pivot cache fields.

use crate::domain::pivot::model::SharedItem;
use crate::infra::scanner::find_gt_simd;
use crate::infra::xml::{parse_bool_attr, parse_f64_attr, parse_string_attr};

pub(crate) fn parse_shared_items(xml: &[u8]) -> Vec<SharedItem> {
    let mut items = Vec::new();
    let mut pos = 0;

    while pos < xml.len() {
        let lt_pos = match memchr::memchr(b'<', &xml[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        if lt_pos + 1 < xml.len() && xml[lt_pos + 1] == b'/' {
            pos = lt_pos + 1;
            continue;
        }

        if lt_pos + 2 >= xml.len() {
            break;
        }

        let tag_end = find_gt_simd(xml, lt_pos).unwrap_or(xml.len());
        let element = &xml[lt_pos..tag_end + 1];

        match xml[lt_pos + 1] {
            b's' => {
                if let Some(v) = parse_string_attr(element, b"v=\"") {
                    items.push(SharedItem::String(v));
                }
            }
            b'n' => {
                if let Some(v) = parse_f64_attr(element, b"v=\"") {
                    items.push(SharedItem::Number(v));
                }
            }
            b'b' => items.push(SharedItem::Boolean(parse_bool_attr(element, b"v=\""))),
            b'e' => {
                if let Some(v) = parse_string_attr(element, b"v=\"") {
                    items.push(SharedItem::Error(v));
                }
            }
            b'd' => {
                if let Some(v) = parse_string_attr(element, b"v=\"") {
                    items.push(SharedItem::DateTime(v));
                }
            }
            b'm' => items.push(SharedItem::Missing),
            _ => {}
        }

        pos = tag_end + 1;
    }

    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_shared_item_value_variants() {
        let xml = br##"<sharedItems count="6">
            <s v="text"/>
            <n v="42.5"/>
            <b v="1"/>
            <e v="#N/A"/>
            <d v="2024-01-15T10:30:00"/>
            <m/>
        </sharedItems>"##;

        let items = parse_shared_items(xml);

        assert_eq!(items.len(), 6);
        assert_eq!(items[0], SharedItem::String("text".to_string()));
        assert_eq!(items[1], SharedItem::Number(42.5));
        assert_eq!(items[2], SharedItem::Boolean(true));
        assert_eq!(items[3], SharedItem::Error("#N/A".to_string()));
        assert_eq!(
            items[4],
            SharedItem::DateTime("2024-01-15T10:30:00".to_string())
        );
        assert_eq!(items[5], SharedItem::Missing);
    }

    #[test]
    fn ignores_unknown_shared_item_tags() {
        let xml = br#"<sharedItems><s v="first"/><q v="ignored"/><s v="second"/></sharedItems>"#;

        let items = parse_shared_items(xml);

        assert_eq!(
            items,
            vec![
                SharedItem::String("first".to_string()),
                SharedItem::String("second".to_string())
            ]
        );
    }
}
