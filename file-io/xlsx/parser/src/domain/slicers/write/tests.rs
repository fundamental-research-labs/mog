use super::*;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::slicers::{
    SlicerCacheDef, SlicerCrossFilter, SlicerDef, SlicerPivotTableRef, SlicerSortOrder,
    SlicerTabularData, SlicerTabularItem, TableSlicerCache,
};

// -------------------------------------------------------------------------
// 5a: write_slicer_part tests
// -------------------------------------------------------------------------

#[test]
fn test_write_slicer_part_single() {
    let slicers = vec![SlicerDef {
        name: "Slicer_Region".to_string(),
        cache: "Slicer_Region".to_string(),
        caption: Some("Region".to_string()),
        start_item: None,
        column_count: 2,
        show_caption: true,
        level: 0,
        style: Some("SlicerStyleLight1".to_string()),
        locked_position: false,
        row_height: Some(241300),
        uid: None,
        ext_lst: None,
    }];

    let xml = write_slicer_part(&slicers);
    let xml_str = String::from_utf8(xml).unwrap();

    // Check XML declaration
    assert!(xml_str.starts_with("<?xml"));

    // Check namespace declarations (default namespace for x14, plus mc and x)
    assert!(
        xml_str.contains("xmlns=\"http://schemas.microsoft.com/office/spreadsheetml/2009/9/main\"")
    );
    assert!(
        xml_str
            .contains("xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\"")
    );
    assert!(xml_str.contains("mc:Ignorable=\"x\""));
    assert!(
        xml_str.contains("xmlns:x=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"")
    );

    // Check slicer attributes
    assert!(xml_str.contains("name=\"Slicer_Region\""));
    assert!(xml_str.contains("cache=\"Slicer_Region\""));
    assert!(xml_str.contains("caption=\"Region\""));
    assert!(xml_str.contains("columnCount=\"2\""));
    assert!(xml_str.contains("style=\"SlicerStyleLight1\""));
    assert!(xml_str.contains("rowHeight=\"241300\""));

    // showCaption is true (default) — should be omitted
    assert!(!xml_str.contains("showCaption="));
    // level is 0 (default) — should be omitted
    assert!(!xml_str.contains("level="));
    // lockedPosition is false (default) — should be omitted
    assert!(!xml_str.contains("lockedPosition="));
}

#[test]
fn test_write_slicer_part_omits_defaults() {
    let slicers = vec![SlicerDef {
        name: "S1".to_string(),
        cache: "SC1".to_string(),
        caption: None,
        start_item: None,
        column_count: 1,
        show_caption: true,
        level: 0,
        style: None,
        locked_position: false,
        row_height: None,
        uid: None,
        ext_lst: None,
    }];

    let xml = write_slicer_part(&slicers);
    let xml_str = String::from_utf8(xml).unwrap();

    // Only name and cache should appear (plus namespace attrs on root)
    assert!(xml_str.contains("name=\"S1\""));
    assert!(xml_str.contains("cache=\"SC1\""));
    assert!(!xml_str.contains("columnCount="));
    assert!(!xml_str.contains("showCaption="));
    assert!(!xml_str.contains("level="));
    assert!(!xml_str.contains("style="));
    assert!(!xml_str.contains("rowHeight="));
    assert!(!xml_str.contains("lockedPosition="));
    assert!(!xml_str.contains("startItem="));
    assert!(!xml_str.contains("caption="));
}

#[test]
fn test_write_slicer_part_non_default_bools() {
    let slicers = vec![SlicerDef {
        name: "S1".to_string(),
        cache: "SC1".to_string(),
        caption: None,
        start_item: Some(5),
        column_count: 1,
        show_caption: false,
        level: 3,
        style: None,
        locked_position: true,
        row_height: None,
        uid: None,
        ext_lst: None,
    }];

    let xml = write_slicer_part(&slicers);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("showCaption=\"0\""));
    assert!(xml_str.contains("lockedPosition=\"1\""));
    assert!(xml_str.contains("level=\"3\""));
    assert!(xml_str.contains("startItem=\"5\""));
}

#[test]
fn test_write_slicer_part_multiple() {
    let slicers = vec![
        SlicerDef {
            name: "S1".to_string(),
            cache: "SC1".to_string(),
            caption: None,
            start_item: None,
            column_count: 1,
            show_caption: true,
            level: 0,
            style: None,
            locked_position: false,
            row_height: None,
            uid: None,
            ext_lst: None,
        },
        SlicerDef {
            name: "S2".to_string(),
            cache: "SC2".to_string(),
            caption: Some("Category".to_string()),
            start_item: None,
            column_count: 3,
            show_caption: true,
            level: 0,
            style: None,
            locked_position: false,
            row_height: None,
            uid: None,
            ext_lst: None,
        },
    ];

    let xml = write_slicer_part(&slicers);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("name=\"S1\""));
    assert!(xml_str.contains("name=\"S2\""));
    assert!(xml_str.contains("caption=\"Category\""));
    assert!(xml_str.contains("columnCount=\"3\""));
}

#[test]
fn test_write_slicer_part_uid_namespace_behavior() {
    let without_uid = vec![SlicerDef {
        name: "S1".to_string(),
        cache: "SC1".to_string(),
        caption: None,
        start_item: None,
        column_count: 1,
        show_caption: true,
        level: 0,
        style: None,
        locked_position: false,
        row_height: None,
        uid: None,
        ext_lst: None,
    }];

    let xml_without_uid = String::from_utf8(write_slicer_part(&without_uid)).unwrap();
    assert!(xml_without_uid.contains("mc:Ignorable=\"x\""));
    assert!(!xml_without_uid.contains("xmlns:xr10="));
    assert!(!xml_without_uid.contains("xr10:uid="));

    let with_uid = vec![SlicerDef {
        uid: Some("{11111111-2222-3333-4444-555555555555}".to_string()),
        ..without_uid[0].clone()
    }];

    let xml_with_uid = String::from_utf8(write_slicer_part(&with_uid)).unwrap();
    assert!(xml_with_uid.contains("mc:Ignorable=\"x xr10\""));
    assert!(xml_with_uid.contains("xmlns:xr10="));

    let name_pos = xml_with_uid.find("name=\"S1\"").unwrap();
    let uid_pos = xml_with_uid
        .find("xr10:uid=\"{11111111-2222-3333-4444-555555555555}\"")
        .unwrap();
    let cache_pos = xml_with_uid.find("cache=\"SC1\"").unwrap();
    assert!(name_pos < uid_pos);
    assert!(uid_pos < cache_pos);
}

// -------------------------------------------------------------------------
// 5b: write_slicer_cache tests
// -------------------------------------------------------------------------

#[test]
fn test_write_slicer_cache_table_based() {
    let cache = SlicerCacheDef {
        name: "Slicer_Region".to_string(),
        uid: None,
        source_name: "Region".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 1,
            column: 3,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            ext_lst: None,
        }),
        ext_lst: None,
    };

    let xml = write_slicer_cache(&cache);
    let xml_str = String::from_utf8(xml).unwrap();

    // Check root element and namespaces (default namespace, not x14: prefix)
    assert!(xml_str.contains("slicerCacheDefinition"));
    assert!(xml_str.contains("xmlns="));
    assert!(xml_str.contains("xmlns:x15="));
    assert!(xml_str.contains("name=\"Slicer_Region\""));
    assert!(xml_str.contains("sourceName=\"Region\""));

    // Check extLst with x15:tableSlicerCache
    assert!(xml_str.contains("<extLst>"));
    assert!(xml_str.contains(EXT_URI_TABLE_SLICER_CACHE));
    assert!(xml_str.contains("x15:tableSlicerCache"));
    assert!(xml_str.contains("tableId=\"1\""));
    assert!(xml_str.contains("column=\"3\""));

    // Default values should be omitted
    assert!(!xml_str.contains("sortOrder="));
    assert!(!xml_str.contains("customListSort="));
    assert!(!xml_str.contains("crossFilter="));

    // xr10 namespace is always declared in default-namespace mode
    assert!(xml_str.contains("xmlns:xr10="));
}

#[test]
fn test_write_slicer_cache_root_namespace_gating() {
    let pivot_cache = SlicerCacheDef {
        name: "SC_Pivot".to_string(),
        uid: None,
        source_name: "Col".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: None,
        ext_lst: None,
    };

    let pivot_xml = String::from_utf8(write_slicer_cache(&pivot_cache)).unwrap();
    assert!(pivot_xml.contains("xmlns:xr10="));
    assert!(!pivot_xml.contains("xmlns:x15="));

    let table_cache = SlicerCacheDef {
        name: "SC_Table".to_string(),
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 1,
            column: 1,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            ext_lst: None,
        }),
        ..pivot_cache
    };

    let table_xml = String::from_utf8(write_slicer_cache(&table_cache)).unwrap();
    assert!(table_xml.contains("xmlns:xr10="));
    assert!(table_xml.contains("xmlns:x15="));

    let name_pos = table_xml.find("name=\"SC_Table\"").unwrap();
    let source_name_pos = table_xml.find("sourceName=\"Col\"").unwrap();
    assert!(name_pos < source_name_pos);
}

#[test]
fn test_write_slicer_cache_pivot_backed() {
    let cache = SlicerCacheDef {
        name: "Slicer_City".to_string(),
        uid: Some("{12345678-1234-1234-1234-123456789ABC}".to_string()),
        source_name: "City".to_string(),
        pivot_tables: vec![SlicerPivotTableRef {
            tab_id: 0,
            name: "PivotTable1".to_string(),
        }],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 5,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: false,
            show_missing: true,
            cross_filter: SlicerCrossFilter::None,
            items: vec![
                SlicerTabularItem {
                    x: 0,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 1,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 2,
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

    let xml = write_slicer_cache(&cache);
    let xml_str = String::from_utf8(xml).unwrap();

    // Check uid namespace and attribute
    assert!(xml_str.contains("xmlns:xr10="));
    assert!(xml_str.contains("xr10:uid=\"{12345678-1234-1234-1234-123456789ABC}\""));

    // Check pivotTables (unprefixed — in default namespace)
    assert!(xml_str.contains("<pivotTables>"));
    assert!(xml_str.contains("tabId=\"0\""));
    assert!(xml_str.contains("name=\"PivotTable1\""));

    // Check tabular data (unprefixed)
    assert!(xml_str.contains("<tabular"));
    assert!(xml_str.contains("pivotCacheId=\"5\""));
    assert!(xml_str.contains("sortOrder=\"descending\""));
    assert!(xml_str.contains("showMissing=\"1\""));
    assert!(xml_str.contains("crossFilter=\"none\""));

    // Check items
    assert!(xml_str.contains("count=\"3\""));
    // Item 0: s=false (omitted), nd=false (omitted)
    assert!(xml_str.contains("x=\"0\""));
    // Item 1: s=true (written)
    assert!(xml_str.contains("s=\"1\""));
    // Item 2: nd=true (written)
    assert!(xml_str.contains("nd=\"1\""));

    // Should not have x15 namespace (no table slicer cache)
    assert!(!xml_str.contains("xmlns:x15="));
}

#[test]
fn test_write_slicer_cache_s_only_written_when_true() {
    let cache = SlicerCacheDef {
        name: "SC1".to_string(),
        uid: None,
        source_name: "Col".to_string(),
        pivot_tables: vec![],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 1,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            show_missing: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            items: vec![
                SlicerTabularItem {
                    x: 0,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 1,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
            ],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    let xml = write_slicer_cache(&cache);
    let xml_str = String::from_utf8(xml).unwrap();

    // Neither s nor nd should appear since both are false (default)
    // Use " s=\"" (with leading space) to avoid matching "xmlns=" substring
    assert!(!xml_str.contains(" s=\""));
    assert!(!xml_str.contains(" nd=\""));
}

#[test]
fn test_write_slicer_cache_table_non_default_attrs() {
    let cache = SlicerCacheDef {
        name: "SC1".to_string(),
        uid: None,
        source_name: "Col".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 2,
            column: 5,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: true,
            cross_filter: SlicerCrossFilter::ShowItemsWithNoData,
            ext_lst: None,
        }),
        ext_lst: None,
    };

    let xml = write_slicer_cache(&cache);
    let xml_str = String::from_utf8(xml).unwrap();

    assert!(xml_str.contains("sortOrder=\"descending\""));
    assert!(xml_str.contains("customListSort=\"1\""));
    assert!(xml_str.contains("crossFilter=\"showItemsWithNoData\""));
}

#[test]
fn test_write_slicer_cache_raw_ext_lst_passthrough_filtering() {
    let base_cache = SlicerCacheDef {
        name: "SC1".to_string(),
        uid: None,
        source_name: "Col".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: None,
        ext_lst: Some("<extLst><ext uri=\"safe\"><safe/></ext></extLst>".to_string()),
    };

    let safe_xml = String::from_utf8(write_slicer_cache(&base_cache)).unwrap();
    assert!(safe_xml.contains("<extLst><ext uri=\"safe\"><safe/></ext></extLst>"));

    let unsafe_cache = SlicerCacheDef {
        ext_lst: Some(
            "<extLst><ext uri=\"unsafe\"><node r:id=\"rId1\"/></ext></extLst>".to_string(),
        ),
        ..base_cache.clone()
    };

    let unsafe_xml = String::from_utf8(write_slicer_cache(&unsafe_cache)).unwrap();
    assert!(!unsafe_xml.contains("uri=\"unsafe\""));
    assert!(!unsafe_xml.contains("r:id=\"rId1\""));

    let table_cache = SlicerCacheDef {
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 1,
            column: 1,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            ext_lst: None,
        }),
        ..base_cache
    };

    let table_xml = String::from_utf8(write_slicer_cache(&table_cache)).unwrap();
    assert!(!table_xml.contains("uri=\"safe\""));
    assert!(table_xml.contains(EXT_URI_TABLE_SLICER_CACHE));
}

// -------------------------------------------------------------------------
// 5e: extLst reference tests
// -------------------------------------------------------------------------

#[test]
fn test_write_worksheet_slicer_ext() {
    let mut w = XmlWriter::new();
    write_worksheet_slicer_ext(&mut w, "rId3");
    let xml_str = String::from_utf8(w.finish()).unwrap();

    assert!(xml_str.contains(EXT_URI_SLICER_LIST));
    assert!(xml_str.contains("xmlns:x14="));
    assert!(xml_str.contains("x14:slicerList"));
    assert!(xml_str.contains("x14:slicer"));
    assert!(xml_str.contains("r:id=\"rId3\""));
}

#[test]
fn test_write_workbook_slicer_caches_ext() {
    let mut w = XmlWriter::new();
    write_workbook_slicer_caches_ext(&mut w, &["rId5", "rId6"]);
    let xml_str = String::from_utf8(w.finish()).unwrap();

    assert!(xml_str.contains(EXT_URI_SLICER_CACHES));
    assert!(xml_str.contains("xmlns:x14="));
    assert!(xml_str.contains("x14:slicerCaches"));
    assert!(xml_str.contains("r:id=\"rId5\""));
    assert!(xml_str.contains("r:id=\"rId6\""));
}

// -------------------------------------------------------------------------
// Roundtrip-style test: parse what we write
// -------------------------------------------------------------------------

#[test]
fn test_slicer_part_roundtrip() {
    let original = vec![SlicerDef {
        name: "Slicer_Region".to_string(),
        cache: "Slicer_Region".to_string(),
        caption: Some("Region".to_string()),
        start_item: None,
        column_count: 2,
        show_caption: true,
        level: 0,
        style: Some("SlicerStyleLight1".to_string()),
        locked_position: false,
        row_height: Some(241300),
        uid: None,
        ext_lst: None,
    }];

    let xml = write_slicer_part(&original);
    let parsed = crate::domain::slicers::read::parse_slicer_part(&xml);

    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].name, "Slicer_Region");
    assert_eq!(parsed[0].cache, "Slicer_Region");
    assert_eq!(parsed[0].caption.as_deref(), Some("Region"));
    assert_eq!(parsed[0].column_count, 2);
    assert!(parsed[0].show_caption);
    assert_eq!(parsed[0].style.as_deref(), Some("SlicerStyleLight1"));
    assert_eq!(parsed[0].row_height, Some(241300));
}

#[test]
fn test_slicer_cache_roundtrip_table() {
    let original = SlicerCacheDef {
        name: "Slicer_Region".to_string(),
        uid: None,
        source_name: "Region".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 1,
            column: 3,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            ext_lst: None,
        }),
        ext_lst: None,
    };

    let xml = write_slicer_cache(&original);
    let parsed = crate::domain::slicers::read::parse_slicer_cache(&xml).unwrap();

    assert_eq!(parsed.name, "Slicer_Region");
    assert_eq!(parsed.source_name, "Region");
    let tsc = parsed.table_slicer_cache.unwrap();
    assert_eq!(tsc.table_id, 1);
    assert_eq!(tsc.column, 3);
}

#[test]
fn test_slicer_cache_roundtrip_pivot() {
    let original = SlicerCacheDef {
        name: "SC_City".to_string(),
        uid: Some("{AABBCCDD-1234-5678-9012-AABBCCDDEEFF}".to_string()),
        source_name: "City".to_string(),
        pivot_tables: vec![SlicerPivotTableRef {
            tab_id: 0,
            name: "PivotTable1".to_string(),
        }],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 5,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: false,
            show_missing: true,
            cross_filter: SlicerCrossFilter::None,
            items: vec![
                SlicerTabularItem {
                    x: 0,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 1,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 2,
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

    let xml = write_slicer_cache(&original);
    let parsed = crate::domain::slicers::read::parse_slicer_cache(&xml).unwrap();

    assert_eq!(parsed.name, "SC_City");
    assert_eq!(parsed.source_name, "City");
    assert_eq!(parsed.pivot_tables.len(), 1);
    assert_eq!(parsed.pivot_tables[0].name, "PivotTable1");

    let tab = parsed.tabular_data.unwrap();
    assert_eq!(tab.pivot_cache_id, 5);
    assert_eq!(tab.sort_order, SlicerSortOrder::Descending);
    assert!(tab.show_missing);
    assert_eq!(tab.cross_filter, SlicerCrossFilter::None);
    assert_eq!(tab.items.len(), 3);
    assert!(!tab.items[0].s);
    assert!(tab.items[1].s);
    assert!(tab.items[2].nd);
}

// =========================================================================
// Comprehensive roundtrip validation tests
// =========================================================================

// 6a: Single table slicer roundtrip (x15 path)
#[test]
fn test_roundtrip_6a_single_table_slicer() {
    // Build a SlicerDef + SlicerCacheDef with x15 TableSlicerCache
    let slicer_defs = vec![SlicerDef {
        name: "Slicer_Sales".to_string(),
        cache: "Slicer_Sales_Cache".to_string(),
        caption: Some("Sales Region".to_string()),
        start_item: Some(2),
        column_count: 3,
        show_caption: true,
        level: 0,
        style: Some("SlicerStyleLight4".to_string()),
        locked_position: true,
        row_height: Some(300000),
        uid: None,
        ext_lst: None,
    }];

    let cache = SlicerCacheDef {
        name: "Slicer_Sales_Cache".to_string(),
        uid: Some("{11111111-2222-3333-4444-555555555555}".to_string()),
        source_name: "SalesRegion".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 7,
            column: 4,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: true,
            cross_filter: SlicerCrossFilter::None,
            ext_lst: None,
        }),
        ext_lst: None,
    };

    // Write → re-parse slicer part
    let slicer_xml = write_slicer_part(&slicer_defs);
    let parsed_slicers = crate::domain::slicers::read::parse_slicer_part(&slicer_xml);
    assert_eq!(parsed_slicers.len(), 1, "Expected 1 slicer after roundtrip");
    let s = &parsed_slicers[0];
    assert_eq!(s.name, "Slicer_Sales", "Slicer name mismatch");
    assert_eq!(s.cache, "Slicer_Sales_Cache", "Cache name mismatch");
    assert_eq!(
        s.caption.as_deref(),
        Some("Sales Region"),
        "Caption mismatch"
    );
    assert_eq!(s.start_item, Some(2), "startItem mismatch");
    assert_eq!(s.column_count, 3, "columnCount mismatch");
    assert!(s.show_caption, "showCaption should be true");
    assert_eq!(s.level, 0, "level mismatch");
    assert_eq!(
        s.style.as_deref(),
        Some("SlicerStyleLight4"),
        "Style mismatch"
    );
    assert!(s.locked_position, "lockedPosition should be true");
    assert_eq!(s.row_height, Some(300000), "rowHeight mismatch");

    // Write → re-parse cache
    let cache_xml = write_slicer_cache(&cache);
    let parsed_cache = crate::domain::slicers::read::parse_slicer_cache(&cache_xml)
        .expect("Cache should parse successfully");
    assert_eq!(
        parsed_cache.name, "Slicer_Sales_Cache",
        "Cache name mismatch"
    );
    assert_eq!(
        parsed_cache.uid.as_deref(),
        Some("{11111111-2222-3333-4444-555555555555}"),
        "UID mismatch"
    );
    assert_eq!(
        parsed_cache.source_name, "SalesRegion",
        "sourceName mismatch"
    );
    assert!(
        parsed_cache.tabular_data.is_none(),
        "Should have no tabular data for x15 path"
    );
    let tsc = parsed_cache
        .table_slicer_cache
        .expect("Should have table slicer cache");
    assert_eq!(tsc.table_id, 7, "tableId mismatch");
    assert_eq!(tsc.column, 4, "column mismatch");
    assert_eq!(
        tsc.sort_order,
        SlicerSortOrder::Descending,
        "sortOrder mismatch"
    );
    assert!(tsc.custom_list_sort, "customListSort mismatch");
    assert_eq!(
        tsc.cross_filter,
        SlicerCrossFilter::None,
        "crossFilter mismatch"
    );
}

// 6b: Multiple slicers roundtrip
#[test]
fn test_roundtrip_6b_multiple_slicers() {
    let slicer_defs = vec![
        SlicerDef {
            name: "Slicer_Alpha".to_string(),
            cache: "Cache_Alpha".to_string(),
            caption: Some("Alpha".to_string()),
            start_item: None,
            column_count: 1,
            show_caption: true,
            level: 0,
            style: Some("SlicerStyleLight1".to_string()),
            locked_position: false,
            row_height: None,
            uid: None,
            ext_lst: None,
        },
        SlicerDef {
            name: "Slicer_Beta".to_string(),
            cache: "Cache_Beta".to_string(),
            caption: Some("Beta".to_string()),
            start_item: Some(10),
            column_count: 4,
            show_caption: true,
            level: 0,
            style: None,
            locked_position: false,
            row_height: Some(200000),
            uid: None,
            ext_lst: None,
        },
        SlicerDef {
            name: "Slicer_Gamma".to_string(),
            cache: "Cache_Gamma".to_string(),
            caption: None,
            start_item: None,
            column_count: 2,
            show_caption: false,
            level: 1,
            style: Some("SlicerStyleDark6".to_string()),
            locked_position: true,
            row_height: Some(150000),
            uid: None,
            ext_lst: None,
        },
    ];

    let xml = write_slicer_part(&slicer_defs);
    let parsed = crate::domain::slicers::read::parse_slicer_part(&xml);

    assert_eq!(parsed.len(), 3, "Expected 3 slicers after roundtrip");

    // Verify all names survive
    assert_eq!(parsed[0].name, "Slicer_Alpha", "First slicer name mismatch");
    assert_eq!(parsed[1].name, "Slicer_Beta", "Second slicer name mismatch");
    assert_eq!(parsed[2].name, "Slicer_Gamma", "Third slicer name mismatch");

    // Verify each references different caches
    assert_eq!(parsed[0].cache, "Cache_Alpha");
    assert_eq!(parsed[1].cache, "Cache_Beta");
    assert_eq!(parsed[2].cache, "Cache_Gamma");

    // Verify varied attributes
    assert_eq!(parsed[1].start_item, Some(10), "Beta startItem mismatch");
    assert_eq!(parsed[1].column_count, 4, "Beta columnCount mismatch");
    assert_eq!(
        parsed[1].row_height,
        Some(200000),
        "Beta rowHeight mismatch"
    );

    assert!(!parsed[2].show_caption, "Gamma showCaption should be false");
    assert_eq!(parsed[2].level, 1, "Gamma level mismatch");
    assert!(
        parsed[2].locked_position,
        "Gamma lockedPosition should be true"
    );
    assert_eq!(
        parsed[2].style.as_deref(),
        Some("SlicerStyleDark6"),
        "Gamma style mismatch"
    );
}

// 6c: Slicer with active filter roundtrip (x14 tabularData path)
#[test]
fn test_roundtrip_6c_active_filter_tabular_data() {
    let cache = SlicerCacheDef {
        name: "SC_Filter".to_string(),
        uid: None,
        source_name: "Category".to_string(),
        pivot_tables: vec![SlicerPivotTableRef {
            tab_id: 1,
            name: "PivotTable2".to_string(),
        }],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 10,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            show_missing: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            items: vec![
                SlicerTabularItem {
                    x: 0,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 1,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                }, // selected
                SlicerTabularItem {
                    x: 2,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
                SlicerTabularItem {
                    x: 3,
                    s: true,
                    nd: false,
                    unknown_attrs: Vec::new(),
                }, // selected
                SlicerTabularItem {
                    x: 4,
                    s: false,
                    nd: false,
                    unknown_attrs: Vec::new(),
                },
            ],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    let xml = write_slicer_cache(&cache);
    let parsed =
        crate::domain::slicers::read::parse_slicer_cache(&xml).expect("Cache should parse");

    let tab = parsed.tabular_data.expect("Should have tabular data");
    assert_eq!(tab.items.len(), 5, "Expected 5 items");

    // Verify only items at index 1 and 3 have s=true (default is false)
    assert!(
        !tab.items[0].s,
        "Item 0 should not be selected (s default=false)"
    );
    assert!(tab.items[1].s, "Item 1 should be selected (s=true)");
    assert!(
        !tab.items[2].s,
        "Item 2 should not be selected (s default=false)"
    );
    assert!(tab.items[3].s, "Item 3 should be selected (s=true)");
    assert!(
        !tab.items[4].s,
        "Item 4 should not be selected (s default=false)"
    );

    // Verify nd defaults preserved
    for (i, item) in tab.items.iter().enumerate() {
        assert!(!item.nd, "Item {} nd should be false (default)", i);
    }
}

// 6d: Slicer style roundtrip
#[test]
fn test_roundtrip_6d_slicer_style() {
    let slicer_defs = vec![SlicerDef {
        name: "Styled_Slicer".to_string(),
        cache: "Styled_Cache".to_string(),
        caption: Some("Dark Styled".to_string()),
        start_item: None,
        column_count: 2,
        show_caption: true,
        level: 0,
        style: Some("SlicerStyleDark3".to_string()),
        locked_position: false,
        row_height: Some(195580),
        uid: None,
        ext_lst: None,
    }];

    let xml = write_slicer_part(&slicer_defs);
    let parsed = crate::domain::slicers::read::parse_slicer_part(&xml);

    assert_eq!(parsed.len(), 1);
    let s = &parsed[0];
    assert_eq!(
        s.style.as_deref(),
        Some("SlicerStyleDark3"),
        "Style should survive roundtrip"
    );
    assert_eq!(s.column_count, 2, "columnCount should survive roundtrip");
    assert_eq!(
        s.row_height,
        Some(195580),
        "Custom rowHeight should survive roundtrip"
    );
    assert_eq!(
        s.caption.as_deref(),
        Some("Dark Styled"),
        "Caption should survive roundtrip"
    );
}

// 6e: Slicer position roundtrip (drawing XML)
#[test]
fn test_roundtrip_6e_slicer_position_drawing() {
    use crate::domain::drawings::write::{
        CellAnchor as WriteCellAnchor, ClientData, DrawingAnchor, DrawingObject, DrawingWriter,
        EditAs, TwoCellAnchor,
    };

    let mut writer = DrawingWriter::new();
    let from = WriteCellAnchor {
        col: 2,
        col_off: 38100,
        row: 5,
        row_off: 76200,
    };
    let to = WriteCellAnchor {
        col: 6,
        col_off: 152400,
        row: 20,
        row_off: 304800,
    };

    let anchor = TwoCellAnchor {
        from: from.clone(),
        to: to.clone(),
        edit_as: Some(EditAs::TwoCell),
        client_data: ClientData::default(),
        ..Default::default()
    };
    writer.add_anchor(DrawingAnchor::TwoCell(
        anchor,
        DrawingObject::Slicer {
            original_id: None,
            name: "Slicer_Position_Test".to_string(),
            r_id: "rId1".to_string(),
            macro_name: None,
            nv_ext_lst: None,
        },
    ));

    let drawing_xml = writer.to_xml();
    let slicer_anchors =
        crate::domain::slicers::read::parse_slicer_anchors_from_drawing(&drawing_xml);

    assert_eq!(
        slicer_anchors.len(),
        1,
        "Expected 1 slicer anchor from drawing"
    );
    let sa = &slicer_anchors[0];
    assert_eq!(
        sa.slicer_name, "Slicer_Position_Test",
        "Slicer name mismatch in anchor"
    );
    assert_eq!(sa.from.col, 2, "from.col mismatch");
    assert_eq!(sa.from.col_off, 38100, "from.col_off mismatch");
    assert_eq!(sa.from.row, 5, "from.row mismatch");
    assert_eq!(sa.from.row_off, 76200, "from.row_off mismatch");
    assert_eq!(sa.to.col, 6, "to.col mismatch");
    assert_eq!(sa.to.col_off, 152400, "to.col_off mismatch");
    assert_eq!(sa.to.row, 20, "to.row mismatch");
    assert_eq!(sa.to.row_off, 304800, "to.row_off mismatch");
}

// 6f: Multiple sheets with slicers (independent slicer parts)
#[test]
fn test_roundtrip_6f_multiple_sheets() {
    // Sheet 1 slicers
    let sheet1_slicers = vec![
        SlicerDef {
            name: "Sheet1_Slicer_A".to_string(),
            cache: "Cache_A".to_string(),
            caption: Some("A".to_string()),
            start_item: None,
            column_count: 1,
            show_caption: true,
            level: 0,
            style: None,
            locked_position: false,
            row_height: None,
            uid: None,
            ext_lst: None,
        },
        SlicerDef {
            name: "Sheet1_Slicer_B".to_string(),
            cache: "Cache_B".to_string(),
            caption: Some("B".to_string()),
            start_item: None,
            column_count: 1,
            show_caption: true,
            level: 0,
            style: None,
            locked_position: false,
            row_height: None,
            uid: None,
            ext_lst: None,
        },
    ];

    // Sheet 2 slicers
    let sheet2_slicers = vec![SlicerDef {
        name: "Sheet2_Slicer_X".to_string(),
        cache: "Cache_X".to_string(),
        caption: Some("X".to_string()),
        start_item: None,
        column_count: 3,
        show_caption: false,
        level: 0,
        style: Some("SlicerStyleLight2".to_string()),
        locked_position: false,
        row_height: Some(250000),
        uid: None,
        ext_lst: None,
    }];

    // Write and parse each independently
    let xml1 = write_slicer_part(&sheet1_slicers);
    let xml2 = write_slicer_part(&sheet2_slicers);
    let parsed1 = crate::domain::slicers::read::parse_slicer_part(&xml1);
    let parsed2 = crate::domain::slicers::read::parse_slicer_part(&xml2);

    // Verify isolation: sheet1 has 2 slicers, sheet2 has 1
    assert_eq!(parsed1.len(), 2, "Sheet 1 should have 2 slicers");
    assert_eq!(parsed2.len(), 1, "Sheet 2 should have 1 slicer");

    // Verify sheet 1 slicers
    assert_eq!(parsed1[0].name, "Sheet1_Slicer_A");
    assert_eq!(parsed1[1].name, "Sheet1_Slicer_B");

    // Verify sheet 2 slicer is isolated from sheet 1
    assert_eq!(parsed2[0].name, "Sheet2_Slicer_X");
    assert!(!parsed2[0].show_caption);
    assert_eq!(parsed2[0].column_count, 3);
    assert_eq!(parsed2[0].style.as_deref(), Some("SlicerStyleLight2"));
}

// 6g: Slicer with no caption / showCaption=false
#[test]
fn test_roundtrip_6g_no_caption_show_caption_false() {
    let slicer_defs = vec![SlicerDef {
        name: "NoCaption_Slicer".to_string(),
        cache: "NoCaption_Cache".to_string(),
        caption: None,
        start_item: None,
        column_count: 1,
        show_caption: false,
        level: 0,
        style: None,
        locked_position: false,
        row_height: None,
        uid: None,
        ext_lst: None,
    }];

    let xml = write_slicer_part(&slicer_defs);
    let parsed = crate::domain::slicers::read::parse_slicer_part(&xml);

    assert_eq!(parsed.len(), 1);
    let s = &parsed[0];
    assert_eq!(s.name, "NoCaption_Slicer");
    assert!(
        s.caption.is_none(),
        "Caption should be None after roundtrip"
    );
    assert!(
        !s.show_caption,
        "showCaption=false should survive roundtrip"
    );
}

// 6h: Cross-filter and sort order roundtrip (all enum variants)
#[test]
fn test_roundtrip_6h_cross_filter_and_sort_order() {
    // Test crossFilter=none, sortOrder=descending, customListSort=false
    // via x14 tabular path
    let cache_x14 = SlicerCacheDef {
        name: "SC_Enum_x14".to_string(),
        uid: None,
        source_name: "EnumCol".to_string(),
        pivot_tables: vec![],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 42,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: false,
            show_missing: false,
            cross_filter: SlicerCrossFilter::None,
            items: vec![SlicerTabularItem {
                x: 0,
                s: false,
                nd: false,
                unknown_attrs: Vec::new(),
            }],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    let xml_x14 = write_slicer_cache(&cache_x14);
    let parsed_x14 =
        crate::domain::slicers::read::parse_slicer_cache(&xml_x14).expect("x14 cache should parse");
    let tab = parsed_x14.tabular_data.expect("Should have tabular data");
    assert_eq!(
        tab.sort_order,
        SlicerSortOrder::Descending,
        "sortOrder=descending should survive (x14)"
    );
    assert!(
        !tab.custom_list_sort,
        "customListSort=false should survive (x14)"
    );
    assert_eq!(
        tab.cross_filter,
        SlicerCrossFilter::None,
        "crossFilter=none should survive (x14)"
    );

    // Test crossFilter=showItemsWithNoData via x15 table path
    let cache_x15 = SlicerCacheDef {
        name: "SC_Enum_x15".to_string(),
        uid: None,
        source_name: "EnumCol2".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 99,
            column: 1,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: true,
            cross_filter: SlicerCrossFilter::ShowItemsWithNoData,
            ext_lst: None,
        }),
        ext_lst: None,
    };

    let xml_x15 = write_slicer_cache(&cache_x15);
    let parsed_x15 =
        crate::domain::slicers::read::parse_slicer_cache(&xml_x15).expect("x15 cache should parse");
    let tsc = parsed_x15
        .table_slicer_cache
        .expect("Should have table slicer cache");
    assert_eq!(
        tsc.sort_order,
        SlicerSortOrder::Descending,
        "sortOrder=descending should survive (x15)"
    );
    assert!(
        tsc.custom_list_sort,
        "customListSort=true should survive (x15)"
    );
    assert_eq!(
        tsc.cross_filter,
        SlicerCrossFilter::ShowItemsWithNoData,
        "crossFilter=showItemsWithNoData should survive (x15)"
    );

    // Test all defaults: ascending, showItemsWithDataAtTop, customListSort=false
    let cache_defaults = SlicerCacheDef {
        name: "SC_Defaults".to_string(),
        uid: None,
        source_name: "DefaultCol".to_string(),
        pivot_tables: vec![],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 1,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            show_missing: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            items: vec![],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    let xml_defaults = write_slicer_cache(&cache_defaults);
    let parsed_defaults = crate::domain::slicers::read::parse_slicer_cache(&xml_defaults)
        .expect("Defaults cache should parse");
    let tab_defaults = parsed_defaults
        .tabular_data
        .expect("Should have tabular data");
    assert_eq!(
        tab_defaults.sort_order,
        SlicerSortOrder::Ascending,
        "Default sortOrder should be ascending"
    );
    assert!(
        !tab_defaults.custom_list_sort,
        "Default customListSort should be false"
    );
    assert_eq!(
        tab_defaults.cross_filter,
        SlicerCrossFilter::ShowItemsWithDataAtTop,
        "Default crossFilter should be showItemsWithDataAtTop"
    );
}

// 6i: x15 vs x14 cache type roundtrip
#[test]
fn test_roundtrip_6i_x15_vs_x14_cache_type() {
    // Cache with x15 TableSlicerCache (table-based)
    let cache_x15 = SlicerCacheDef {
        name: "SC_Table".to_string(),
        uid: Some("{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}".to_string()),
        source_name: "TableCol".to_string(),
        pivot_tables: vec![],
        tabular_data: None,
        table_slicer_cache: Some(TableSlicerCache {
            table_id: 3,
            column: 7,
            sort_order: SlicerSortOrder::Ascending,
            custom_list_sort: false,
            cross_filter: SlicerCrossFilter::ShowItemsWithDataAtTop,
            ext_lst: None,
        }),
        ext_lst: None,
    };

    // Cache with x14 SlicerTabularData (pivot-backed)
    let cache_x14 = SlicerCacheDef {
        name: "SC_Pivot".to_string(),
        uid: Some("{FFFFFFFF-1111-2222-3333-444444444444}".to_string()),
        source_name: "PivotCol".to_string(),
        pivot_tables: vec![
            SlicerPivotTableRef {
                tab_id: 0,
                name: "PT1".to_string(),
            },
            SlicerPivotTableRef {
                tab_id: 2,
                name: "PT2".to_string(),
            },
        ],
        tabular_data: Some(SlicerTabularData {
            pivot_cache_id: 8,
            sort_order: SlicerSortOrder::Descending,
            custom_list_sort: true,
            show_missing: true,
            cross_filter: SlicerCrossFilter::ShowItemsWithNoData,
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
                SlicerTabularItem {
                    x: 2,
                    s: true,
                    nd: true,
                    unknown_attrs: Vec::new(),
                },
            ],
            ext_lst: None,
        }),
        table_slicer_cache: None,
        ext_lst: None,
    };

    // Write both
    let xml_x15 = write_slicer_cache(&cache_x15);
    let xml_x14 = write_slicer_cache(&cache_x14);

    // Re-parse both
    let parsed_x15 =
        crate::domain::slicers::read::parse_slicer_cache(&xml_x15).expect("x15 cache should parse");
    let parsed_x14 =
        crate::domain::slicers::read::parse_slicer_cache(&xml_x14).expect("x14 cache should parse");

    // Verify x15 cache has table_slicer_cache and no tabular_data
    assert_eq!(parsed_x15.name, "SC_Table");
    assert!(
        parsed_x15.table_slicer_cache.is_some(),
        "x15 cache should have table_slicer_cache"
    );
    assert!(
        parsed_x15.tabular_data.is_none(),
        "x15 cache should NOT have tabular_data"
    );
    let tsc = parsed_x15.table_slicer_cache.unwrap();
    assert_eq!(tsc.table_id, 3, "x15 tableId mismatch");
    assert_eq!(tsc.column, 7, "x15 column mismatch");

    // Verify x14 cache has tabular_data and no table_slicer_cache
    assert_eq!(parsed_x14.name, "SC_Pivot");
    assert!(
        parsed_x14.tabular_data.is_some(),
        "x14 cache should have tabular_data"
    );
    assert!(
        parsed_x14.table_slicer_cache.is_none(),
        "x14 cache should NOT have table_slicer_cache"
    );

    // Verify x14 pivot tables
    assert_eq!(
        parsed_x14.pivot_tables.len(),
        2,
        "x14 should have 2 pivot table refs"
    );
    assert_eq!(parsed_x14.pivot_tables[0].tab_id, 0);
    assert_eq!(parsed_x14.pivot_tables[0].name, "PT1");
    assert_eq!(parsed_x14.pivot_tables[1].tab_id, 2);
    assert_eq!(parsed_x14.pivot_tables[1].name, "PT2");

    // Verify x14 tabular data in detail
    let tab = parsed_x14.tabular_data.unwrap();
    assert_eq!(tab.pivot_cache_id, 8);
    assert_eq!(tab.sort_order, SlicerSortOrder::Descending);
    assert!(tab.custom_list_sort);
    assert!(tab.show_missing);
    assert_eq!(tab.cross_filter, SlicerCrossFilter::ShowItemsWithNoData);
    assert_eq!(tab.items.len(), 3);
    assert!(tab.items[0].s, "Item 0 should be selected");
    assert!(!tab.items[0].nd, "Item 0 nd should be false");
    assert!(!tab.items[1].s, "Item 1 should not be selected");
    assert!(tab.items[1].nd, "Item 1 nd should be true");
    assert!(tab.items[2].s, "Item 2 should be selected");
    assert!(tab.items[2].nd, "Item 2 nd should be true");
}
