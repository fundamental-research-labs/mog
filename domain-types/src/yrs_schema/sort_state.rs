//! Yrs schema for worksheet-level [`SortState`] — lossless encoding of the
//! standalone OOXML `<sortState>` element stored under
//! `sheets/{hex}/properties/sortState`.
//!
//! This is intentionally separate from runtime filter sort state and from the
//! nested `<autoFilter><sortState>...` contract. The value here is the typed
//! worksheet-level OOXML edge object carried by `SheetData.sort_state`.

use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::read_string;
use crate::domain::filter::SortState;

/// Sheet properties key for the worksheet-level sort state map.
pub const PROPERTY_KEY: &str = "sortState";

/// Y.Map key carrying the JSON-encoded SortState tree.
pub const KEY_JSON: &str = "json";

/// Build prelim entries for a [`SortState`] as a single `json` key whose value
/// is the full typed tree serialized via serde.
pub fn to_yrs_prelim(sort_state: &SortState) -> Vec<(&'static str, Any)> {
    let json = serde_json::to_string(sort_state).unwrap_or_default();
    vec![(KEY_JSON, Any::String(Arc::from(json.as_str())))]
}

/// Read a [`SortState`] back from a Y.Map written via [`to_yrs_prelim`].
/// Returns `None` if the JSON key is missing or malformed.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<SortState> {
    let json = read_string(map, txn, KEY_JSON)?;
    serde_json::from_str(&json).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::filter::{SortCondition, SortConditionBy, SortMethod};
    use yrs::{Doc, Map, MapPrelim, Transact};

    fn roundtrip(sort_state: &SortState) -> SortState {
        let doc = Doc::new();
        let root = doc.get_or_insert_map("root");
        {
            let mut txn = doc.transact_mut();
            let prelim: MapPrelim = to_yrs_prelim(sort_state).into_iter().collect();
            root.insert(&mut txn, PROPERTY_KEY, prelim);
        }

        let txn = doc.transact();
        let sort_map = match root.get(&txn, PROPERTY_KEY) {
            Some(yrs::Out::YMap(map)) => map,
            other => panic!("expected YMap under '{PROPERTY_KEY}', got {other:?}"),
        };
        from_yrs_map(&sort_map, &txn).expect("SortState should read back")
    }

    fn rich_sort_state() -> SortState {
        SortState {
            range_ref: "A1:H100".to_string(),
            namespace_attrs: vec![(
                "xlrd2".to_string(),
                "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2".to_string(),
            )],
            column_sort: true,
            case_sensitive: true,
            sort_method: SortMethod::PinYin,
            conditions: vec![
                SortCondition {
                    range_ref: "A2:A100".to_string(),
                    descending: true,
                    sort_by: SortConditionBy::Value,
                    custom_list: Some("low,mid,high".to_string()),
                    dxf_id: None,
                    icon_set: None,
                    icon_id: None,
                },
                SortCondition {
                    range_ref: "B2:B100".to_string(),
                    descending: false,
                    sort_by: SortConditionBy::CellColor,
                    custom_list: None,
                    dxf_id: Some(3),
                    icon_set: None,
                    icon_id: None,
                },
                SortCondition {
                    range_ref: "C2:C100".to_string(),
                    descending: true,
                    sort_by: SortConditionBy::FontColor,
                    custom_list: None,
                    dxf_id: Some(5),
                    icon_set: None,
                    icon_id: None,
                },
                SortCondition {
                    range_ref: "D2:D100".to_string(),
                    descending: false,
                    sort_by: SortConditionBy::Icon,
                    custom_list: None,
                    dxf_id: None,
                    icon_set: Some(ooxml_types::cond_format::IconSetType::ThreeStars),
                    icon_id: Some(1),
                },
            ],
            ext_lst_raw: None,
        }
    }

    #[test]
    fn full_sort_state_yrs_roundtrip() {
        let sort_state = rich_sort_state();
        let rt = roundtrip(&sort_state);
        assert_eq!(sort_state, rt);
    }

    #[test]
    fn empty_sort_state_yrs_roundtrip() {
        let sort_state = SortState {
            range_ref: "A1:D20".to_string(),
            ..Default::default()
        };
        let rt = roundtrip(&sort_state);
        assert_eq!(sort_state, rt);
        assert!(rt.conditions.is_empty());
    }

    #[test]
    fn missing_json_key_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("empty");
        let txn = doc.transact();
        assert!(from_yrs_map(&map, &txn).is_none());
    }

    #[test]
    fn malformed_json_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("bad");
        {
            let mut txn = doc.transact_mut();
            map.insert(
                &mut txn,
                KEY_JSON,
                Any::String(Arc::from("{not valid json")),
            );
        }
        let txn = doc.transact();
        assert!(from_yrs_map(&map, &txn).is_none());
    }
}
