use super::*;

use ooxml_types::drawings::{CellAnchor, DrawingAnchorMetadata};
use ooxml_types::slicers::{
    SlicerAnchor as OoxmlSlicerAnchor, SlicerCacheDef as OoxmlSlicerCacheDef,
    SlicerDef as OoxmlSlicerDef, SlicerTabularItem, TableSlicerCache,
};
use serde::Serialize;
use value_types::CellValue;

use super::super::floating_object::{AnchorMode, FloatingObjectAnchor};

fn empty_import_context(sheet_id: &str) -> XlsxSlicerImportContext<'_> {
    XlsxSlicerImportContext {
        sheet_id,
        source_table_id: None,
        source_table_column_id: None,
        table_filter_selected_values: None,
    }
}
#[test]
fn stored_slicer_table_source_round_trip() {
    let slicer = StoredSlicer {
        id: "slicer-1".into(),
        sheet_id: "00000000000000000000000000000001".into(),
        source: SlicerSource::Table {
            table_id: "table-1".into(),
            column_cell_id: "cell-1".into(),
        },
        cache_name: None,
        cache_uid: None,
        caption: "Region".into(),
        name: None,
        style: SlicerStyle {
            preset: Some(SlicerStylePreset::Light1),
            custom: None,
            column_count: 1,
            button_height: 25,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::None,
            custom_list_sort: false,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Ascending,
        },
        table_column_index: None,
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: None,
        level: 0,
        uid: None,
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: None,
        anchor_object_id: None,
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 0,
        locked: false,
        show_header: true,
        start_item: None,
        multi_select: true,
        selected_values: vec![
            CellValue::Text("East".into()),
            CellValue::Text("West".into()),
        ],
        created_at: None,
        updated_at: None,
    };

    let json = serde_json::to_string(&slicer).unwrap();
    let deserialized: StoredSlicer = serde_json::from_str(&json).unwrap();
    assert_eq!(slicer, deserialized);
}

#[test]
fn stored_slicer_pivot_source_round_trip() {
    let slicer = StoredSlicer {
        id: "slicer-2".into(),
        sheet_id: "00000000000000000000000000000002".into(),
        source: SlicerSource::Pivot {
            pivot_id: "pivot-1".into(),
            field_name: "Category".into(),
            field_area: PivotFieldArea::Row,
        },
        cache_name: None,
        cache_uid: None,
        caption: "Category".into(),
        name: None,
        style: SlicerStyle {
            preset: None,
            custom: Some(SlicerCustomStyle {
                header_background_color: Some("#333".into()),
                header_text_color: Some("#fff".into()),
                header_font_size: None,
                selected_background_color: None,
                selected_text_color: None,
                available_background_color: None,
                available_text_color: None,
                unavailable_background_color: None,
                unavailable_text_color: None,
                border_color: None,
                border_width: None,
                item_border_radius: None,
            }),
            column_count: 2,
            button_height: 30,
            show_selection_indicator: false,
            cross_filter: CrossFilterMode::ShowItemsWithNoData,
            custom_list_sort: true,
            show_items_with_no_data: true,
            sort_order: SlicerSortOrder::DataSourceOrder,
        },
        table_column_index: None,
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: None,
        level: 0,
        uid: None,
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: Some(FloatingObjectAnchor {
            anchor_mode: AnchorMode::Absolute,
            anchor_row_offset: 200 * 9525,
            anchor_col_offset: 100 * 9525,
            ..Default::default()
        }),
        anchor_object_id: None,
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 5,
        locked: true,
        show_header: false,
        start_item: Some(3),
        multi_select: true,
        selected_values: vec![],
        created_at: Some(1710000000.0),
        updated_at: Some(1710003600.0),
    };

    let json = serde_json::to_string(&slicer).unwrap();
    let deserialized: StoredSlicer = serde_json::from_str(&json).unwrap();
    assert_eq!(slicer, deserialized);
}

#[test]
fn slicer_source_tagged_union_serialization() {
    let table = SlicerSource::Table {
        table_id: "t1".into(),
        column_cell_id: "c1".into(),
    };
    let json = serde_json::to_value(&table).unwrap();
    assert_eq!(json["type"], "table");
    assert_eq!(json["tableId"], "t1");
    assert_eq!(json["columnCellId"], "c1");

    let pivot = SlicerSource::Pivot {
        pivot_id: "p1".into(),
        field_name: "Sales".into(),
        field_area: PivotFieldArea::Filter,
    };
    let json = serde_json::to_value(&pivot).unwrap();
    assert_eq!(json["type"], "pivot");
    assert_eq!(json["pivotId"], "p1");
    assert_eq!(json["fieldName"], "Sales");
    assert_eq!(json["fieldArea"], "filter");
}

#[test]
fn slicer_style_wire_names() {
    let style = SlicerStyle {
        preset: Some(SlicerStylePreset::Dark3),
        custom: None,
        column_count: 1,
        button_height: 25,
        show_selection_indicator: true,
        cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
        custom_list_sort: false,
        show_items_with_no_data: false,
        sort_order: SlicerSortOrder::DataSourceOrder,
    };
    let json = serde_json::to_value(&style).unwrap();
    assert_eq!(json["crossFilter"], "showItemsWithDataAtTop");
    assert_eq!(json["sortOrder"], "dataSourceOrder");
    assert_eq!(json["preset"], "dark3");

    let back: SlicerStyle = serde_json::from_value(json).unwrap();
    assert_eq!(style, back);
}

#[test]
fn apply_update_partial_merge() {
    let mut slicer = StoredSlicer {
        id: "s1".into(),
        sheet_id: "sheet1".into(),
        source: SlicerSource::Table {
            table_id: "t1".into(),
            column_cell_id: "c1".into(),
        },
        cache_name: None,
        cache_uid: None,
        caption: "Old".into(),
        name: None,
        style: SlicerStyle {
            preset: None,
            custom: None,
            column_count: 1,
            button_height: 25,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::None,
            custom_list_sort: false,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Ascending,
        },
        table_column_index: None,
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: None,
        level: 0,
        uid: None,
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: None,
        anchor_object_id: None,
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 0,
        locked: false,
        show_header: true,
        start_item: None,
        multi_select: true,
        selected_values: vec![CellValue::Text("a".into())],
        created_at: None,
        updated_at: None,
    };

    let update = StoredSlicerUpdate {
        caption: Some("New".into()),
        name: None,
        style: None,
        position: None,
        z_index: Some(10),
        locked: None,
        show_header: None,
        start_item: None,
        multi_select: None,
        selected_values: None,
    };

    slicer.apply_update(&update);
    assert_eq!(slicer.caption, "New");
    assert_eq!(slicer.z_index, 10);
    assert!(!slicer.locked);
    assert!(slicer.show_header);
    assert_eq!(slicer.selected_values, vec![CellValue::Text("a".into())]);
}

#[test]
fn deserialize_from_existing_stored_json() {
    let json = serde_json::json!({
        "id": "slicer-abc",
        "sheetId": "00000000000000000000000000000001",
        "source": {
            "type": "table",
            "tableId": "table-xyz",
            "columnCellId": "cell-123"
        },
        "caption": "Region",
        "style": {
            "columnCount": 1,
            "buttonHeight": 25,
            "showSelectionIndicator": true,
            "crossFilter": "none",
            "customListSort": false,
            "showItemsWithNoData": false,
            "sortOrder": "ascending"
        },
        "position": {
            "anchorRow": 0,
            "anchorCol": 0,
            "anchorRowOffset": 952500,
            "anchorColOffset": 952500,
            "anchorMode": "absolute",
            "extentCx": 1905000,
            "extentCy": 2857500
        },
        "zIndex": 0,
        "locked": false,
        "showHeader": true
    });

    let slicer: StoredSlicer = serde_json::from_value(json).unwrap();
    assert_eq!(slicer.id, "slicer-abc");
    assert!(matches!(slicer.source, SlicerSource::Table { .. }));
    assert_eq!(slicer.style.column_count, 1);
    let pos = slicer.position.as_ref().expect("position present");
    assert_eq!(pos.anchor_mode, AnchorMode::Absolute);
    assert_eq!(pos.extent_cx, Some(1_905_000));
    assert!(slicer.selected_values.is_empty());
    assert!(slicer.show_header);
    assert!(slicer.multi_select);
}

#[test]
fn multi_select_defaults_to_true() {
    let json = serde_json::json!({
        "id": "slicer-ms",
        "sheetId": "sheet1",
        "source": {
            "type": "table",
            "tableId": "t1",
            "columnCellId": "c1"
        },
        "caption": "Test",
        "style": {
            "columnCount": 1,
            "buttonHeight": 25,
            "showSelectionIndicator": true,
            "crossFilter": "none",
            "customListSort": false,
            "showItemsWithNoData": false,
            "sortOrder": "ascending"
        }
    });

    let slicer: StoredSlicer = serde_json::from_value(json).unwrap();
    assert!(
        slicer.multi_select,
        "multi_select should default to true when absent from JSON"
    );

    let json_false = serde_json::json!({
        "id": "slicer-ms2",
        "sheetId": "sheet1",
        "source": {
            "type": "table",
            "tableId": "t1",
            "columnCellId": "c1"
        },
        "caption": "Test",
        "style": {
            "columnCount": 1,
            "buttonHeight": 25,
            "showSelectionIndicator": true,
            "crossFilter": "none",
            "customListSort": false,
            "showItemsWithNoData": false,
            "sortOrder": "ascending"
        },
        "multiSelect": false
    });

    let slicer2: StoredSlicer = serde_json::from_value(json_false).unwrap();
    assert!(
        !slicer2.multi_select,
        "multi_select should be false when explicitly set"
    );
}

#[test]
fn xlsx_import_table_slicer_conversion() {
    let slicer = OoxmlSlicerDef {
        name: "Region".into(),
        cache: "Slicer_Region".into(),
        caption: Some("Region Filter".into()),
        column_count: 2,
        style: Some("SlicerStyleLight3".into()),
        locked_position: true,
        show_caption: true,
        level: 0,
        start_item: None,
        row_height: None,
        uid: None,
        ext_lst: None,
    };
    let cache = OoxmlSlicerCacheDef {
        name: "Slicer_Region".into(),
        uid: None,
        source_name: "Region".into(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 1,
            column: 0,
            sort_order: ooxml_types::slicers::SlicerSortOrder::Descending,
            custom_list_sort: false,
            cross_filter: ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop,
            ext_lst: None,
        }),
        ext_lst: None,
    };
    let anchor = OoxmlSlicerAnchor {
        slicer_name: "Region".into(),
        object_id: Some(42),
        from: CellAnchor {
            col: 5,
            col_off: 200,
            row: 0,
            row_off: 100,
        },
        to: CellAnchor {
            col: 8,
            col_off: 0,
            row: 10,
            row_off: 0,
        },
        anchor_mode: None,
        extent: None,
        macro_name: None,
        nv_ext_lst: None,
        drawing: DrawingAnchorMetadata {
            anchor_index: Some(7),
        },
    };

    let table_filter_selected_values = vec![CellValue::from("West"), CellValue::from("EMEA")];
    let stored = xlsx_import_to_stored_slicer(
        &slicer,
        Some(&cache),
        Some(&anchor),
        XlsxSlicerImportContext {
            source_table_id: Some("tbl-sales"),
            source_table_column_id: Some("col-region"),
            table_filter_selected_values: Some(&table_filter_selected_values),
            ..empty_import_context("sheet-hex-1")
        },
    );
    assert_eq!(stored.id, "slicer-Region");
    assert_eq!(stored.sheet_id, "sheet-hex-1");
    assert_eq!(stored.caption, "Region Filter");
    assert!(stored.locked);
    assert_eq!(stored.style.column_count, 2);
    assert_eq!(stored.style.preset, Some(SlicerStylePreset::Light3));
    assert_eq!(stored.style.sort_order, SlicerSortOrder::Descending);
    assert!(
        matches!(stored.source, SlicerSource::Table { ref table_id, ref column_cell_id }
        if table_id == "tbl-sales" && column_cell_id == "col-region")
    );
    assert_eq!(
        stored.selected_values,
        vec![CellValue::from("West"), CellValue::from("EMEA")]
    );
    let pos = stored.position.as_ref().expect("position is populated");
    assert_eq!(pos.anchor_col, 5);
    assert_eq!(pos.end_row, Some(10));
    assert_eq!(pos.anchor_mode, AnchorMode::TwoCell);
    assert_eq!(stored.z_index, 7);
}

#[test]
fn xlsx_import_pivot_slicer_conversion() {
    let slicer = OoxmlSlicerDef {
        name: "Category".into(),
        cache: "Slicer_Category".into(),
        caption: None,
        column_count: 1,
        style: None,
        locked_position: false,
        show_caption: true,
        level: 0,
        start_item: None,
        row_height: None,
        uid: None,
        ext_lst: None,
    };
    let cache = OoxmlSlicerCacheDef {
        name: "Slicer_Category".into(),
        uid: None,
        source_name: "Category".into(),
        pivot_tables: vec![ooxml_types::slicers::SlicerPivotTableRef {
            tab_id: 0,
            name: "PivotTable1".into(),
        }],
        tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
            pivot_cache_id: 0,
            sort_order: ooxml_types::slicers::SlicerSortOrder::Ascending,
            custom_list_sort: false,
            show_missing: false,
            cross_filter: ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop,
            items: vec![
                SlicerTabularItem {
                    x: 0,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 1,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 2,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
            ],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    let stored = xlsx_import_to_stored_slicer(
        &slicer,
        Some(&cache),
        None,
        empty_import_context("sheet-hex-2"),
    );
    assert_eq!(stored.caption, "Category");
    assert!(stored.position.is_none());
    assert_eq!(stored.style.column_count, 1);
    assert!(stored.style.preset.is_none());
    assert!(
        matches!(stored.source, SlicerSource::Pivot { ref pivot_id, .. }
        if pivot_id == "PivotTable1")
    );
    assert_eq!(stored.selected_values.len(), 2);
    assert_eq!(stored.selected_values[0], CellValue::from("0".to_string()));
    assert_eq!(stored.selected_values[1], CellValue::from("2".to_string()));
    assert_eq!(stored.pivot_tabular_items.len(), 3);
}

#[test]
fn xlsx_import_tabular_slicer_without_pivot_table_refs_stays_pivot_backed() {
    let slicer = OoxmlSlicerDef {
        name: "FiscalYear".into(),
        cache: "Slicer_FiscalYear".into(),
        caption: None,
        column_count: 1,
        style: None,
        locked_position: false,
        show_caption: true,
        level: 0,
        start_item: None,
        row_height: None,
        uid: None,
        ext_lst: None,
    };
    let cache = OoxmlSlicerCacheDef {
        name: "Slicer_FiscalYear".into(),
        uid: None,
        source_name: "Fiscal Year".into(),
        pivot_tables: vec![],
        tabular_data: Some(ooxml_types::slicers::SlicerTabularData {
            pivot_cache_id: 452406247,
            sort_order: ooxml_types::slicers::SlicerSortOrder::Ascending,
            custom_list_sort: true,
            show_missing: false,
            cross_filter: ooxml_types::slicers::SlicerCrossFilter::ShowItemsWithDataAtTop,
            items: vec![
                SlicerTabularItem {
                    x: 0,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 1,
                    s: false,
                    nd: true,
                    unknown_attrs: Vec::new(),
                },
            ],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    let stored = xlsx_import_to_stored_slicer(
        &slicer,
        Some(&cache),
        None,
        empty_import_context("sheet-hex-3"),
    );
    assert!(
        matches!(stored.source, SlicerSource::Pivot { ref pivot_id, ref field_name, .. }
        if pivot_id.is_empty() && field_name == "Fiscal Year")
    );
    assert_eq!(stored.pivot_cache_id, Some(452406247));
    assert_eq!(
        stored.pivot_tabular_items,
        cache.tabular_data.unwrap().items
    );

    let exported = stored_slicer_to_cache_def(&stored);
    assert!(exported.table_slicer_cache.is_none());
    assert!(exported.pivot_tables.is_empty());
    assert_eq!(exported.tabular_data.unwrap().items[1].nd, true);
}

#[test]
fn stored_slicer_round_trip_to_ooxml_types() {
    let stored = StoredSlicer {
        id: "slicer-Region".into(),
        sheet_id: "sheet-1".into(),
        source: SlicerSource::Table {
            table_id: "1".into(),
            column_cell_id: "Region".into(),
        },
        cache_name: Some("Slicer_Region".into()),
        cache_uid: Some("{CACHE-UID}".into()),
        caption: "Region".into(),
        name: Some("Region".into()),
        style: SlicerStyle {
            preset: Some(SlicerStylePreset::Dark2),
            custom: None,
            column_count: 3,
            button_height: 0,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::ShowItemsWithDataAtTop,
            custom_list_sort: false,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Descending,
        },
        table_column_index: Some(2),
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: Some(241300),
        level: 0,
        uid: Some("{SLICER-UID}".into()),
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: Some(FloatingObjectAnchor {
            anchor_row: 0,
            anchor_col: 5,
            anchor_row_offset: 100,
            anchor_col_offset: 200,
            anchor_mode: AnchorMode::TwoCell,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(10),
            end_col: Some(8),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: None,
            extent_cy: None,
        }),
        anchor_object_id: Some(7),
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 0,
        locked: true,
        show_header: true,
        start_item: None,
        multi_select: true,
        selected_values: vec![],
        created_at: None,
        updated_at: None,
    };

    let slicer_def = stored_slicer_to_slicer_def(&stored);
    assert_eq!(slicer_def.name, "Region");
    assert_eq!(slicer_def.style, Some("SlicerStyleDark2".into()));
    assert_eq!(slicer_def.column_count, 3);
    assert!(slicer_def.locked_position);
    let cache_def = stored_slicer_to_cache_def(&stored);
    assert_eq!(cache_def.source_name, "Region");
    assert!(cache_def.table_slicer_cache.is_some());
    assert_eq!(cache_def.table_slicer_cache.as_ref().unwrap().table_id, 0);
    let anchor = stored_slicer_to_anchor(&stored).unwrap();
    assert_eq!(anchor.slicer_name, "Region");
    assert_eq!(anchor.from.col, 5);
    assert_eq!(anchor.to.row, 10);
}

fn make_test_slicer(id: &str, name: Option<&str>) -> StoredSlicer {
    StoredSlicer {
        id: id.into(),
        sheet_id: "sheet1".into(),
        source: SlicerSource::Table {
            table_id: "t1".into(),
            column_cell_id: "c1".into(),
        },
        cache_name: None,
        cache_uid: None,
        caption: "Cap".into(),
        name: name.map(|s| s.into()),
        style: SlicerStyle {
            preset: None,
            custom: None,
            column_count: 1,
            button_height: 25,
            show_selection_indicator: true,
            cross_filter: CrossFilterMode::None,
            custom_list_sort: false,
            show_items_with_no_data: false,
            sort_order: SlicerSortOrder::Ascending,
        },
        table_column_index: None,
        pivot_cache_id: None,
        pivot_table_tab_id: None,
        pivot_tabular_items: vec![],
        row_height: None,
        level: 0,
        uid: None,
        ext_lst_xml: None,
        cache_ext_lst_xml: None,
        position: None,
        anchor_object_id: None,
        anchor_macro_name: None,
        anchor_nv_ext_lst_xml: None,
        z_index: 0,
        locked: false,
        show_header: true,
        start_item: None,
        multi_select: true,
        selected_values: vec![],
        created_at: None,
        updated_at: None,
    }
}

#[test]
fn name_none_export_fallback_strips_slicer_prefix() {
    let slicer = make_test_slicer("slicer-TestName", None);
    let def = stored_slicer_to_slicer_def(&slicer);
    assert_eq!(
        def.name, "TestName",
        "should strip 'slicer-' prefix from id"
    );
}

#[test]
fn name_none_export_fallback_raw_uuid() {
    let raw_id = "550e8400-e29b-41d4-a716-446655440000";
    let slicer = make_test_slicer(raw_id, None);
    let def = stored_slicer_to_slicer_def(&slicer);
    assert_eq!(
        def.name, raw_id,
        "should return full id when no 'slicer-' prefix"
    );
}

#[test]
fn apply_update_sets_name() {
    let mut slicer = make_test_slicer("s1", None);
    assert_eq!(slicer.name, None);

    let update = StoredSlicerUpdate {
        name: Some("NewName".into()),
        caption: None,
        style: None,
        position: None,
        z_index: None,
        locked: None,
        show_header: None,
        start_item: None,
        multi_select: None,
        selected_values: None,
    };

    slicer.apply_update(&update);
    assert_eq!(slicer.name, Some("NewName".into()));
}

fn json_token<T: Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn public_facade_exports_representative_slicer_contracts() {
    use crate::domain::slicer::*;

    let _item = SlicerItem {
        value: CellValue::Text("East".into()),
        display_text: "East".into(),
        state: SlicerItemState::Available,
        count: Some(1),
    };
    let _source = SlicerSource::Table {
        table_id: "table-1".into(),
        column_cell_id: "cell-1".into(),
    };
    let _style = SlicerStyle {
        preset: Some(SlicerStylePreset::Light1),
        custom: None,
        column_count: 1,
        button_height: 25,
        show_selection_indicator: true,
        cross_filter: CrossFilterMode::None,
        custom_list_sort: false,
        show_items_with_no_data: false,
        sort_order: SlicerSortOrder::Ascending,
    };
    let _level = TimelineLevel::Months;
    let _: fn(
        &OoxmlSlicerDef,
        Option<&OoxmlSlicerCacheDef>,
        Option<&OoxmlSlicerAnchor>,
        XlsxSlicerImportContext<'_>,
    ) -> StoredSlicer = xlsx_import_to_stored_slicer;
    let _: fn(&StoredSlicer) -> OoxmlSlicerCacheDef = stored_slicer_to_cache_def;
    let _: fn(&StoredSlicer) -> OoxmlSlicerDef = stored_slicer_to_slicer_def;
    let _: fn(&StoredSlicer) -> Option<OoxmlSlicerAnchor> = stored_slicer_to_anchor;
}

#[test]
fn event_reason_tokens_are_stable() {
    assert_eq!(
        [
            json_token(SlicerInvalidationReason::DataChanged),
            json_token(SlicerInvalidationReason::FilterChanged),
            json_token(SlicerInvalidationReason::StructureChanged),
        ],
        ["data-changed", "filter-changed", "structure-changed"]
    );
    assert_eq!(
        [
            json_token(CacheInvalidationEventReason::CellsChanged),
            json_token(CacheInvalidationEventReason::FilterApplied),
            json_token(CacheInvalidationEventReason::TableStructureChanged),
            json_token(CacheInvalidationEventReason::PivotUpdated),
        ],
        [
            "cellsChanged",
            "filterApplied",
            "tableStructureChanged",
            "pivotUpdated"
        ]
    );
    assert_eq!(
        [
            json_token(SlicerDisconnectionReason::ColumnDeleted),
            json_token(SlicerDisconnectionReason::TableDeleted),
            json_token(SlicerDisconnectionReason::PivotDeleted),
        ],
        ["column-deleted", "table-deleted", "pivot-deleted"]
    );
    assert_eq!(
        [
            json_token(DisconnectionEventReason::ColumnDeleted),
            json_token(DisconnectionEventReason::TableDeleted),
            json_token(DisconnectionEventReason::PivotDeleted),
        ],
        ["columnDeleted", "tableDeleted", "pivotDeleted"]
    );
}

#[test]
fn item_and_source_tokens_are_stable() {
    assert_eq!(
        [
            json_token(SlicerItemState::Selected),
            json_token(SlicerItemState::Available),
            json_token(SlicerItemState::Unavailable),
            json_token(SlicerItemState::NoData),
        ],
        ["selected", "available", "unavailable", "noData"]
    );
    assert_eq!(
        [
            json_token(SlicerSelectionChangeType::Select),
            json_token(SlicerSelectionChangeType::Toggle),
            json_token(SlicerSelectionChangeType::Clear),
            json_token(SlicerSelectionChangeType::Sync),
        ],
        ["select", "toggle", "clear", "sync"]
    );
    assert_eq!(
        [
            json_token(PivotFieldArea::Row),
            json_token(PivotFieldArea::Column),
            json_token(PivotFieldArea::Filter),
        ],
        ["row", "column", "filter"]
    );

    let item = SlicerItem {
        value: CellValue::Text("East".into()),
        display_text: "East".into(),
        state: SlicerItemState::NoData,
        count: None,
    };
    let json = serde_json::to_value(item).unwrap();
    assert_eq!(json["displayText"], "East");
    assert!(!json.as_object().unwrap().contains_key("count"));
}

#[test]
fn style_tokens_and_named_style_wire_shape_are_stable() {
    assert_eq!(
        [
            json_token(CrossFilterMode::None),
            json_token(CrossFilterMode::ShowItemsWithDataAtTop),
            json_token(CrossFilterMode::ShowItemsWithNoData),
        ],
        ["none", "showItemsWithDataAtTop", "showItemsWithNoData"]
    );
    assert_eq!(
        [
            json_token(SlicerSortOrder::Ascending),
            json_token(SlicerSortOrder::Descending),
            json_token(SlicerSortOrder::DataSourceOrder),
        ],
        ["ascending", "descending", "dataSourceOrder"]
    );
    assert_eq!(
        [
            json_token(SlicerStylePreset::Light1),
            json_token(SlicerStylePreset::Light2),
            json_token(SlicerStylePreset::Light3),
            json_token(SlicerStylePreset::Light4),
            json_token(SlicerStylePreset::Light5),
            json_token(SlicerStylePreset::Light6),
            json_token(SlicerStylePreset::Dark1),
            json_token(SlicerStylePreset::Dark2),
            json_token(SlicerStylePreset::Dark3),
            json_token(SlicerStylePreset::Dark4),
            json_token(SlicerStylePreset::Dark5),
            json_token(SlicerStylePreset::Dark6),
            json_token(SlicerStylePreset::Other1),
            json_token(SlicerStylePreset::Other2),
        ],
        [
            "light1", "light2", "light3", "light4", "light5", "light6", "dark1", "dark2", "dark3",
            "dark4", "dark5", "dark6", "other1", "other2"
        ]
    );

    let named = NamedSlicerStyle {
        name: "Custom".into(),
        read_only: true,
        style: empty_custom_style(),
    };
    let json = serde_json::to_value(named).unwrap();
    assert_eq!(json["readOnly"], true);
}

#[test]
fn timeline_tokens_defaults_and_omissions_are_stable() {
    assert_eq!(
        [
            json_token(TimelineLevel::Years),
            json_token(TimelineLevel::Quarters),
            json_token(TimelineLevel::Months),
            json_token(TimelineLevel::Days),
        ],
        ["years", "quarters", "months", "days"]
    );
    assert_eq!(TimelineLevel::default(), TimelineLevel::Months);

    let json = serde_json::json!({
        "id": "timeline-1",
        "sheetId": "sheet1",
        "name": "Timeline 1",
        "cacheName": "Timeline_Date"
    });
    let timeline: StoredTimeline = serde_json::from_value(json).unwrap();
    assert_eq!(timeline.level, TimelineLevel::Months);
    assert!(timeline.caption.is_none());
    assert!(timeline.cache.is_none());
    assert_eq!(timeline.z_index, 0);

    let cache = StoredTimelineCache {
        name: "Timeline_Date".into(),
        uid: None,
        source_name: "Date".into(),
        pivot_cache_id: None,
        minimal_refresh_version: None,
        last_refresh_version: None,
        filter_type: None,
        start_date: None,
        end_date: None,
        pivot_table_tab_id: None,
        pivot_table_name: None,
        ext_lst_xml: None,
    };
    let json = serde_json::to_value(cache).unwrap();
    assert!(!json.as_object().unwrap().contains_key("uid"));
    assert!(!json.as_object().unwrap().contains_key("pivotCacheId"));
    assert!(!json.as_object().unwrap().contains_key("extLstXml"));
}

fn empty_custom_style() -> SlicerCustomStyle {
    SlicerCustomStyle {
        header_background_color: None,
        header_text_color: None,
        header_font_size: None,
        selected_background_color: None,
        selected_text_color: None,
        available_background_color: None,
        available_text_color: None,
        unavailable_background_color: None,
        unavailable_text_color: None,
        border_color: None,
        border_width: None,
        item_border_radius: None,
    }
}
