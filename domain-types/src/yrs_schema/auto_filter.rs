//! Yrs schema for [`AutoFilter`] — lossless encoding of the domain
//! `AutoFilter` type (CT_AutoFilter) stored under
//! `sheets/{hex}/properties/autoFilter`.
//!
//! The XLSX round-trip path is:
//!
//! ```text
//! OOXML <autoFilter>
//!    ↕  xlsx-parser (AutoFilter already typed over CT_AutoFilter)
//! AutoFilter   (domain-types — canonical in-memory shape)
//!    ↕  this module                    ← single canonical Yrs shape
//! Yrs:  sheets/{hex}/properties/autoFilter
//! ```
//!
//! `AutoFilter`, `FilterColumn`, `OoxmlFilterType` (Values / Top10 /
//! Custom / Dynamic / Color / Icon), `SortState`, `SortCondition`, and
//! `DateGroupItem` form a deeply nested, polymorphic OOXML tree. Because
//! every level already has `Serialize` / `Deserialize` and the whole tree
//! is an edge-format representation (it exists solely to reconstruct
//! `<autoFilter>` XML), we persist the full tree as a single JSON blob
//! under [`KEY_JSON`] using the same Yrs-boundary JSON-bridge pattern that
//! `validation.rs` uses for `ranges`. This is explicitly permitted by
//! the typed-boundary authorship rule: Yrs on-disk serialization of an already-
//! typed value via `Serialize`/`Deserialize` is a legitimate external-
//! format boundary.
//!
//! Note: this is distinct from the runtime `FilterState` stored under
//! `sheets/{hex}/filters`. FilterState is the UI/runtime view; AutoFilter
//! is the XLSX-on-disk view. Both are retained so UI operations continue
//! to work on the compact runtime shape while round-trip fidelity goes
//! through the faithful OOXML shape.

use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::read_string;
use crate::domain::filter::AutoFilter;

/// Y.Map key carrying the JSON-encoded AutoFilter tree.
pub const KEY_JSON: &str = "json";

/// Build prelim entries for an [`AutoFilter`] — a single `json` key
/// whose value is the full tree serialized via serde.
pub fn to_yrs_prelim(af: &AutoFilter) -> Vec<(&'static str, Any)> {
    let json = serde_json::to_string(af).unwrap_or_default();
    vec![(KEY_JSON, Any::String(Arc::from(json.as_str())))]
}

/// Read an [`AutoFilter`] back from a Y.Map that was written via
/// [`to_yrs_prelim`]. Returns `None` if the `json` key is missing or
/// malformed so callers can fall back cleanly.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<AutoFilter> {
    let json = read_string(map, txn, KEY_JSON)?;
    serde_json::from_str(&json).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::filter::{
        CalendarType, DateGroupItem, DateTimeGrouping, FilterColumn, OoxmlFilterCondition,
        OoxmlFilterType, SortCondition, SortConditionBy, SortMethod, SortState,
    };
    use value_types::{CellValue, FiniteF64};
    use yrs::{Doc, Map, MapPrelim, Transact};

    fn roundtrip(af: &AutoFilter) -> AutoFilter {
        let doc = Doc::new();
        let root = doc.get_or_insert_map("root");
        {
            let mut txn = doc.transact_mut();
            let prelim: MapPrelim = to_yrs_prelim(af).into_iter().collect();
            root.insert(&mut txn, "af", prelim);
        }
        let txn = doc.transact();
        let af_map = match root.get(&txn, "af") {
            Some(yrs::Out::YMap(m)) => m,
            other => panic!("expected YMap under 'af', got {other:?}"),
        };
        from_yrs_map(&af_map, &txn).expect("AutoFilter should read back")
    }

    /// A kitchen-sink AutoFilter exercising every field on every sub-type
    /// including all `OoxmlFilterType` variants.
    fn rich_auto_filter() -> AutoFilter {
        AutoFilter {
            range_ref: "A1:H100".to_string(),
            columns: vec![
                FilterColumn {
                    col_index: 0,
                    hidden_button: true,
                    show_button: false,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: vec!["Alpha".to_string(), "Beta".to_string()],
                        blanks: true,
                        calendar_type: Some(CalendarType::Japan),
                        date_group_items: vec![
                            DateGroupItem {
                                year: 2025,
                                month: Some(4),
                                day: Some(15),
                                hour: Some(12),
                                minute: Some(30),
                                second: Some(45),
                                date_time_grouping: DateTimeGrouping::Second,
                            },
                            DateGroupItem {
                                year: 2024,
                                month: Some(12),
                                day: None,
                                hour: None,
                                minute: None,
                                second: None,
                                date_time_grouping: DateTimeGrouping::Month,
                            },
                        ],
                    }),
                    ext_lst_raw: None,
                },
                FilterColumn {
                    col_index: 1,
                    hidden_button: false,
                    show_button: true,
                    filter_type: Some(OoxmlFilterType::Top10 {
                        top: false,
                        percent: true,
                        value: 25.0,
                        filter_val: Some(73.5),
                    }),
                    ext_lst_raw: None,
                },
                FilterColumn {
                    col_index: 2,
                    hidden_button: false,
                    show_button: true,
                    filter_type: Some(OoxmlFilterType::Custom {
                        conditions: vec![
                            OoxmlFilterCondition {
                                operator: "greaterThan".to_string(),
                                value: CellValue::Number(FiniteF64::must(100.0)),
                                value2: None,
                            },
                            OoxmlFilterCondition {
                                operator: "lessThan".to_string(),
                                value: CellValue::Number(FiniteF64::must(500.0)),
                                value2: Some(CellValue::Text(Arc::from("tail"))),
                            },
                        ],
                        and_logic: true,
                    }),
                    ext_lst_raw: None,
                },
                FilterColumn {
                    col_index: 3,
                    hidden_button: false,
                    show_button: true,
                    filter_type: Some(OoxmlFilterType::Dynamic {
                        dynamic_type: "aboveAverage".to_string(),
                        value: Some(42.5),
                        max_value: Some(99.9),
                        value_iso: Some("2025-04-23T10:00:00Z".to_string()),
                        max_value_iso: Some("2025-12-31T23:59:59Z".to_string()),
                    }),
                    ext_lst_raw: None,
                },
                FilterColumn {
                    col_index: 4,
                    hidden_button: false,
                    show_button: true,
                    filter_type: Some(OoxmlFilterType::Color {
                        dxf_id: Some(7),
                        cell_color: false,
                    }),
                    ext_lst_raw: None,
                },
                FilterColumn {
                    col_index: 5,
                    hidden_button: false,
                    show_button: true,
                    filter_type: Some(OoxmlFilterType::Icon {
                        icon_set: Some("3TrafficLights1".to_string()),
                        icon_id: 2,
                    }),
                    ext_lst_raw: None,
                },
            ],
            sort: Some(SortState {
                range_ref: "A1:H100".to_string(),
                column_sort: true,
                case_sensitive: true,
                sort_method: SortMethod::PinYin,
                conditions: vec![
                    SortCondition {
                        range_ref: "A2:A100".to_string(),
                        descending: true,
                        sort_by: SortConditionBy::CellColor,
                        custom_list: Some("low,mid,high".to_string()),
                        dxf_id: Some(3),
                        icon_set: None,
                        icon_id: None,
                    },
                    SortCondition {
                        range_ref: "B2:B100".to_string(),
                        descending: false,
                        sort_by: SortConditionBy::Icon,
                        custom_list: None,
                        dxf_id: None,
                        icon_set: Some(ooxml_types::cond_format::IconSetType::ThreeStars),
                        icon_id: Some(1),
                    },
                ],
                ..Default::default()
            }),
            xr_uid: Some("{12345678-1234-5678-1234-567812345678}".to_string()),
            ext_lst_raw: None,
        }
    }

    #[test]
    fn full_auto_filter_yrs_roundtrip() {
        let af = rich_auto_filter();
        let rt = roundtrip(&af);
        assert_eq!(af, rt);
    }

    #[test]
    fn empty_auto_filter_yrs_roundtrip() {
        let af = AutoFilter {
            range_ref: "A1:D10".to_string(),
            columns: Vec::new(),
            sort: None,
            xr_uid: None,
            ext_lst_raw: None,
        };
        let rt = roundtrip(&af);
        assert_eq!(af, rt);
    }

    #[test]
    fn childless_filter_column_yrs_roundtrip_stays_childless() {
        let af = AutoFilter {
            range_ref: "A1:C10".to_string(),
            columns: vec![
                FilterColumn {
                    col_index: 0,
                    hidden_button: true,
                    show_button: false,
                    filter_type: None,
                    ext_lst_raw: None,
                },
                FilterColumn {
                    col_index: 1,
                    filter_type: Some(OoxmlFilterType::Values {
                        values: Vec::new(),
                        blanks: false,
                        calendar_type: None,
                        date_group_items: Vec::new(),
                    }),
                    ..Default::default()
                },
            ],
            sort: None,
            xr_uid: None,
            ext_lst_raw: None,
        };

        let rt = roundtrip(&af);
        assert_eq!(rt, af);
        assert!(rt.columns[0].filter_type.is_none());
        assert!(matches!(
            &rt.columns[1].filter_type,
            Some(OoxmlFilterType::Values {
                values,
                blanks: false,
                calendar_type: None,
                date_group_items,
            }) if values.is_empty() && date_group_items.is_empty()
        ));
    }

    #[test]
    fn missing_json_key_returns_none() {
        let doc = Doc::new();
        let map = doc.get_or_insert_map("empty");
        let txn = doc.transact();
        assert!(from_yrs_map(&map, &txn).is_none());
    }
}
