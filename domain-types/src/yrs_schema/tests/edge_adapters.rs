use std::collections::HashMap;
use std::sync::Arc;

use value_types::CellValue;
use yrs::{Any, Doc, Map, MapPrelim, Transact};

use crate::domain::filter::{
    AutoFilter, FilterColumn, FilterSortState, OoxmlFilterType, SortBy, SortOrder,
};
use crate::domain::slicer::{
    CrossFilterMode, SlicerSortOrder, SlicerSource, SlicerStyle, StoredSlicer,
};
use crate::yrs_schema::{auto_filter, filter_sort_state, pivot_cache_records, slicer};

use super::support::{roundtrip_map, roundtrip_string_map_value};

#[test]
fn runtime_filter_sort_state_round_trips_and_defaults_unknown_tokens() {
    let original = FilterSortState {
        column_cell_id: "cell-1".to_string(),
        order: SortOrder::Desc,
        sort_by: SortBy::Color,
    };
    assert_eq!(
        original,
        roundtrip_map(filter_sort_state::to_yrs_prelim(&original), |map, txn| {
            filter_sort_state::from_yrs_map(map, txn)
        },)
    );

    let doc = Doc::new();
    let root = doc.get_or_insert_map("test");
    {
        let mut txn = doc.transact_mut();
        let entries: Vec<(&str, Any)> = vec![
            ("cc", Any::String(Arc::from("cell-2"))),
            ("so", Any::String(Arc::from("unknown"))),
            ("sb", Any::String(Arc::from("unknown"))),
        ];
        let prelim: MapPrelim = entries.into_iter().collect();
        root.insert(&mut txn, "item", prelim);
    }
    let txn = doc.transact();
    let map_ref = root
        .get(&txn, "item")
        .unwrap()
        .cast::<yrs::MapRef>()
        .unwrap();
    let restored = filter_sort_state::from_yrs_map(&map_ref, &txn).unwrap();
    assert_eq!(restored.column_cell_id, "cell-2");
    assert_eq!(restored.order, SortOrder::Asc);
    assert_eq!(restored.sort_by, SortBy::Value);
}

#[test]
fn auto_filter_smoke_round_trips_active_adapter() {
    let original = AutoFilter {
        range_ref: "A1:D20".to_string(),
        columns: vec![
            FilterColumn {
                col_index: 0,
                filter_type: Some(OoxmlFilterType::Values {
                    values: vec!["Alpha".to_string(), "Beta".to_string()],
                    blanks: true,
                    calendar_type: None,
                    date_group_items: Vec::new(),
                }),
                ..Default::default()
            },
            FilterColumn {
                col_index: 1,
                filter_type: Some(OoxmlFilterType::Color {
                    dxf_id: Some(7),
                    cell_color: true,
                }),
                ..Default::default()
            },
        ],
        sort: None,
        xr_uid: Some("{auto-filter-uid}".to_string()),
        ext_lst_raw: None,
    };

    assert_eq!(
        original,
        roundtrip_map(auto_filter::to_yrs_prelim(&original), |map, txn| {
            auto_filter::from_yrs_map(map, txn)
        })
    );
}

#[test]
fn pivot_cache_records_round_trip_json_rows() {
    let mut original = HashMap::new();
    original.insert(
        12,
        vec![vec![
            CellValue::Text(Arc::from("North")),
            CellValue::Number(value_types::FiniteF64::must(42.0)),
        ]],
    );

    assert_eq!(
        original,
        roundtrip_string_map_value(pivot_cache_records::to_yrs_prelim(&original), |map, txn| {
            pivot_cache_records::from_yrs_map(map, txn)
        },)
    );
}

#[test]
fn pivot_cache_records_ignores_malformed_entries() {
    let valid_rows = vec![vec![CellValue::Text(Arc::from("West"))]];
    let restored = roundtrip_string_map_value(
        vec![
            ("not-a-cache-id".to_string(), Any::Bool(true)),
            ("13".to_string(), Any::String(Arc::from("not json"))),
            (
                "14".to_string(),
                Any::String(Arc::from(serde_json::to_string(&valid_rows).unwrap())),
            ),
        ],
        |map, txn| pivot_cache_records::from_yrs_map(map, txn),
    );

    assert_eq!(restored.len(), 1);
    assert_eq!(restored.get(&14), Some(&valid_rows));
}

#[test]
fn pivot_cache_sources_round_trip_external_worksheet_binding() {
    let original = vec![crate::PivotCacheSourceDef {
        cache_id: 7,
        workbook_ref_scope: Default::default(),
        source_kind: crate::domain::pivot::PivotCacheSourceKind::ExternalWorksheet,
        source_name: None,
        source_sheet: Some("External Data".to_string()),
        source_range: Some("A1:B3".to_string()),
        external_worksheet: Some(crate::domain::pivot::PivotExternalWorksheetSourceDef {
            relationship_id_hint: Some("rIdExternalSource".to_string()),
            relationship_type:
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath"
                    .to_string(),
            target: "file:///tmp/source.xlsx".to_string(),
            target_mode: Some("External".to_string()),
        }),
        field_names: vec!["Category".to_string(), "Amount".to_string()],
        shared_items: Vec::new(),
    }];

    assert_eq!(
        original,
        roundtrip_string_map_value(
            pivot_cache_records::sources_to_yrs_prelim(&original),
            |map, txn| { pivot_cache_records::sources_from_yrs_map(map, txn) },
        )
    );
}

#[test]
fn slicer_round_trips_table_binding_style_position_and_selection() {
    let original = StoredSlicer {
        id: "slicer-1".to_string(),
        sheet_id: "sheet-1".to_string(),
        source: SlicerSource::Table {
            table_id: "table-1".to_string(),
            column_cell_id: "column-cell-1".to_string(),
        },
        cache_name: Some("SlicerCache_Table1_Amount".to_string()),
        cache_uid: Some("{cache-uid}".to_string()),
        caption: "Amount".to_string(),
        name: Some("Amount Slicer".to_string()),
        style: SlicerStyle {
            preset: None,
            custom: None,
            column_count: 2,
            button_height: 24,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
            custom_list_sort: true,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Ascending,
        },
        table_column_index: Some(1),
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: Some(24),
        level: 0,
        uid: Some("{slicer-uid}".to_string()),
        ext_lst_xml: Some("<extLst/>".to_string()),
        cache_ext_lst_xml: Some("<cacheExtLst/>".to_string()),
        position: None,
        anchor_object_id: Some(7),
        anchor_macro_name: Some("".to_string()),
        anchor_nv_ext_lst_xml: Some("<a:extLst/>".to_string()),
        z_index: 3,
        locked: true,
        show_header: true,
        start_item: Some(0),
        multi_select: true,
        selected_values: vec![CellValue::Text(Arc::from("North"))],
        created_at: Some(1700000000.0),
        updated_at: Some(1700000001.0),
    };

    assert_eq!(
        original,
        roundtrip_map(slicer::to_yrs_prelim(&original), |map, txn| {
            slicer::from_yrs_map(map, txn)
        })
    );
}
