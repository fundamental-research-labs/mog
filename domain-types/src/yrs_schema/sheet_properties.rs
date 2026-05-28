//! Yrs storage for worksheet-level sheet properties.

use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, Map, MapPrelim, ReadTxn, TransactionMut};

pub const PROPERTY_KEY: &str = "sheetProperties";
pub const DATA_KEY: &str = "data";

pub fn to_yrs_prelim(
    properties: &ooxml_types::worksheet::SheetProperties,
) -> Vec<(&'static str, Any)> {
    let Ok(json) = serde_json::to_string(properties) else {
        return Vec::new();
    };
    vec![(DATA_KEY, Any::String(Arc::from(json.as_str())))]
}

pub fn insert(
    txn: &mut TransactionMut,
    meta_map: &MapRef,
    properties: &ooxml_types::worksheet::SheetProperties,
) {
    let entries: MapPrelim = to_yrs_prelim(properties).into_iter().collect();
    meta_map.insert(txn, PROPERTY_KEY, entries);
}

pub fn from_yrs_map<T: ReadTxn>(
    map: &MapRef,
    txn: &T,
) -> Option<ooxml_types::worksheet::SheetProperties> {
    let json = super::helpers::read_string(map, txn, DATA_KEY)?;
    serde_json::from_str(&json).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::styles::ColorDef;
    use ooxml_types::worksheet::{OutlineProperties, PageSetupProperties, SheetProperties};
    use yrs::{Doc, Map, Transact};

    #[test]
    fn sheet_properties_roundtrip_through_yrs_map() {
        let properties = SheetProperties {
            tab_color: Some(ColorDef::Rgb {
                val: "FFFF0000".to_string(),
                tint: None,
            }),
            code_name: Some("SheetCode".to_string()),
            filter_mode: true,
            published: false,
            outline_pr: Some(OutlineProperties {
                apply_styles: true,
                summary_below: false,
                summary_right: false,
                show_outline_symbols: false,
            }),
            page_set_up_pr: Some(PageSetupProperties {
                fit_to_page: true,
                auto_page_breaks: false,
            }),
            ..Default::default()
        };

        let doc = Doc::new();
        let root = doc.get_or_insert_map("root");
        {
            let mut txn = doc.transact_mut();
            insert(&mut txn, &root, &properties);
        }

        let txn = doc.transact();
        let map = match root.get(&txn, PROPERTY_KEY) {
            Some(yrs::Out::YMap(map)) => map,
            other => panic!("expected sheet properties map, got {other:?}"),
        };
        assert_eq!(from_yrs_map(&map, &txn), Some(properties));
    }
}
