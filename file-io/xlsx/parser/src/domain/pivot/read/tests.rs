use super::*;

#[test]
fn test_pivot_table_default() {
    let pivot = PivotTable::default();
    assert!(pivot.name.is_empty());
    assert_eq!(pivot.cache_id, 0);
    assert!(!pivot.data_on_rows);
}

#[test]
fn test_pivot_location_default() {
    let loc = PivotLocation::default();
    // Typed range refs: ref_ is now `Option<RangeRef>`; default is `None`.
    assert!(loc.ref_.is_none());
    assert_eq!(loc.first_header_row, 0);
}

#[test]
fn test_pivot_axis_values() {
    assert_eq!(PivotAxis::Row, PivotAxis::Row);
    assert_ne!(PivotAxis::Row, PivotAxis::Col);
}

#[test]
fn test_subtotal_default() {
    let subtotal = Subtotal::default();
    assert_eq!(subtotal, Subtotal::Sum);
}

#[test]
fn test_shared_item_variants() {
    let s = SharedItem::String("test".to_string());
    assert!(matches!(s, SharedItem::String(_)));
    let n = SharedItem::Number(42.0);
    assert!(matches!(n, SharedItem::Number(_)));
    let m = SharedItem::Missing;
    assert!(matches!(m, SharedItem::Missing));
}

#[test]
fn test_parse_empty_pivot_table() {
    let xml = b"<?xml version=\"1.0\"?><worksheet></worksheet>";
    let pivot = parse_pivot_table(xml);
    assert!(pivot.name.is_empty());
}

#[test]
fn test_parse_pivot_table_basic() {
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="SalesPivot" cacheId="1" dataOnRows="1">
    <location ref="A3:D10" firstHeaderRow="1" firstDataRow="2" firstDataCol="1"/>
</pivotTableDefinition>"#;

    let pivot = parse_pivot_table(xml);
    assert_eq!(pivot.name, "SalesPivot");
    assert_eq!(pivot.cache_id, 1);
    assert!(pivot.data_on_rows);
    // Typed range refs: ref_ is now a typed `Option<RangeRef>`. Canonical
    // re-emission must round-trip cleanly back to "A3:D10".
    assert_eq!(
        pivot.location.ref_.as_ref().map(|r| r.to_a1_string()),
        Some("A3:D10".to_string())
    );
}

#[test]
fn test_parse_pivot_table_with_row_fields() {
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Test" cacheId="1">
    <location ref="A1:C5"/>
    <rowFields count="2">
        <field x="0"/>
        <field x="1"/>
    </rowFields>
</pivotTableDefinition>"#;

    let pivot = parse_pivot_table(xml);
    assert_eq!(pivot.row_fields.len(), 2);
    assert_eq!(pivot.row_fields[0].x, 0);
    assert_eq!(pivot.row_fields[1].x, 1);
}

#[test]
fn test_parse_pivot_table_with_data_fields() {
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Test" cacheId="1">
    <location ref="A1:C5"/>
    <dataFields count="2">
        <dataField name="Sum of Sales" fld="3" subtotal="sum"/>
        <dataField name="Count of Items" fld="4" subtotal="count"/>
    </dataFields>
</pivotTableDefinition>"#;

    let pivot = parse_pivot_table(xml);
    assert_eq!(pivot.data_fields.len(), 2);
    assert_eq!(pivot.data_fields[0].name, Some("Sum of Sales".to_string()));
    assert_eq!(pivot.data_fields[0].subtotal, Subtotal::Sum);
    assert_eq!(pivot.data_fields[1].subtotal, Subtotal::Count);
}

#[test]
fn test_parse_pivot_table_with_style() {
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Test" cacheId="1">
    <location ref="A1:C5"/>
    <pivotTableStyleInfo name="PivotStyleMedium9" showRowHeaders="1" showColHeaders="1"/>
</pivotTableDefinition>"#;

    let pivot = parse_pivot_table(xml);
    let style = pivot.style_info.unwrap();
    assert_eq!(style.name, Some("PivotStyleMedium9".to_string()));
    assert!(style.show_row_headers);
}

#[test]
fn test_parse_pivot_fields() {
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Test" cacheId="1">
    <location ref="A1:C5"/>
    <pivotFields count="2">
        <pivotField axis="axisRow" showAll="1" sortType="ascending">
            <items count="2">
                <item x="0"/>
                <item x="1"/>
            </items>
        </pivotField>
        <pivotField axis="axisCol" dataField="1"/>
    </pivotFields>
</pivotTableDefinition>"#;

    let pivot = parse_pivot_table(xml);
    assert_eq!(pivot.pivot_fields.len(), 2);
    assert_eq!(pivot.pivot_fields[0].axis, Some(PivotAxis::Row));
    assert_eq!(pivot.pivot_fields[0].items.len(), 2);
}

#[test]
fn test_parse_pivot_items() {
    let xml = br#"<items count="4">
            <item x="0"/>
            <item x="1" h="1"/>
            <item t="default"/>
            <item t="grand"/>
        </items>"#;

    let items = parse_pivot_items(xml);
    assert_eq!(items.len(), 4);
    assert_eq!(items[0].x, Some(0));
    assert!(items[1].hidden);
    assert_eq!(items[2].item_type, PivotItemType::Default);
    assert_eq!(items[3].item_type, PivotItemType::Grand);
}

#[test]
fn test_parse_cache_definition_basic() {
    let xml = br#"<?xml version="1.0"?>
<pivotCacheDefinition refreshOnLoad="1" recordCount="100">
    <cacheSource type="worksheet">
        <worksheetSource ref="A1:D100" sheet="Data"/>
    </cacheSource>
</pivotCacheDefinition>"#;

    let cache = parse_pivot_cache_definition(xml);
    assert!(cache.refresh_on_load);
    assert_eq!(cache.record_count, Some(100));
    assert_eq!(cache.source_type, CacheSourceType::Worksheet);
    assert_eq!(cache.source_ref, Some("A1:D100".to_string()));
}

#[test]
fn test_parse_cache_source_types() {
    let types = [
        ("worksheet", CacheSourceType::Worksheet),
        ("external", CacheSourceType::External),
        ("consolidation", CacheSourceType::Consolidation),
        ("scenario", CacheSourceType::Scenario),
    ];

    for (type_str, expected) in types {
        let xml = format!(
            r#"<pivotCacheDefinition><cacheSource type="{}"/></pivotCacheDefinition>"#,
            type_str
        );
        let cache = parse_pivot_cache_definition(xml.as_bytes());
        assert_eq!(cache.source_type, expected);
    }
}

#[test]
fn test_parse_cache_fields() {
    let xml = br#"<?xml version="1.0"?>
<pivotCacheDefinition>
    <cacheFields count="2">
        <cacheField name="Category" numFmtId="0">
            <sharedItems count="3">
                <s v="Electronics"/>
                <s v="Clothing"/>
                <s v="Food"/>
            </sharedItems>
        </cacheField>
        <cacheField name="Amount" numFmtId="4">
            <sharedItems containsNumber="1" containsInteger="1" count="0"/>
        </cacheField>
    </cacheFields>
</pivotCacheDefinition>"#;

    let cache = parse_pivot_cache_definition(xml);
    assert_eq!(cache.fields.len(), 2);
    assert_eq!(cache.fields[0].name, "Category");
    assert_eq!(cache.fields[0].shared_items.len(), 3);
    assert!(cache.fields[1].contains_number);
}

#[test]
fn test_parse_shared_items_all_types() {
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
    assert_eq!(items[5], SharedItem::Missing);
}

#[test]
fn test_parse_cache_records() {
    let xml = br#"<?xml version="1.0"?>
<pivotCacheRecords count="2">
    <r>
        <x v="0"/>
        <n v="100.50"/>
        <x v="0"/>
    </r>
    <r>
        <x v="1"/>
        <n v="200.75"/>
        <m/>
    </r>
</pivotCacheRecords>"#;

    let records = parse_pivot_cache_records(xml);
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].values.len(), 3);
    assert_eq!(records[0].values[0], CacheRecordValue::Index(0));
    assert_eq!(records[0].values[1], CacheRecordValue::Number(100.50));
}

#[test]
fn test_parse_all_subtotal_types() {
    let subtotals = [
        ("sum", Subtotal::Sum),
        ("count", Subtotal::Count),
        ("average", Subtotal::Average),
        ("max", Subtotal::Max),
        ("min", Subtotal::Min),
        ("product", Subtotal::Product),
    ];

    for (subtotal_str, expected) in subtotals {
        let xml = format!(r#"<dataField fld="0" subtotal="{}"/>"#, subtotal_str);
        let fields = parse_data_fields(xml.as_bytes());
        assert_eq!(fields[0].subtotal, expected);
    }
}

#[test]
fn test_parse_all_item_types() {
    let item_types = [
        ("data", PivotItemType::Data),
        ("default", PivotItemType::Default),
        ("sum", PivotItemType::Sum),
        ("grand", PivotItemType::Grand),
        ("blank", PivotItemType::Blank),
    ];

    for (type_str, expected) in item_types {
        let xml = format!(r#"<item t="{}"/>"#, type_str);
        let item_type = parse_item_type_attr(xml.as_bytes());
        assert_eq!(item_type, expected);
    }
}

// decode_xml_entities tests moved to xml_utils module

#[test]
fn test_parse_pivot_with_entities() {
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="Sales &amp; Marketing" cacheId="1">
    <location ref="A1:C5"/>
</pivotTableDefinition>"#;

    let pivot = parse_pivot_table(xml);
    assert_eq!(pivot.name, "Sales & Marketing");
}

// ─────────────────────────────────────────────────────────────────────
// Typed range refs: — regression tests (Boundary 1.17)
// ─────────────────────────────────────────────────────────────────────

#[test]
fn w4c_pivot_location_ref_absolute_range_round_trips() {
    // Pivot locations often arrive with absolute markers. The typed
    // RangeRef carries `$` flags via `abs_start`/`abs_end`; round-trip
    // via `to_a1_string` must preserve them.
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="X" cacheId="1">
    <location ref="$A$1:$D$10"/>
</pivotTableDefinition>"#;
    let pivot = parse_pivot_table(xml);
    assert_eq!(
        pivot.location.ref_.as_ref().map(|r| r.to_a1_string()),
        Some("$A$1:$D$10".to_string())
    );
}

#[test]
fn w4c_pivot_location_ref_missing_yields_none() {
    // Absent `ref` attribute → typed `None`, not an empty-string sentinel.
    let xml = br#"<?xml version="1.0"?>
<pivotTableDefinition name="X" cacheId="1">
    <location firstDataRow="1"/>
</pivotTableDefinition>"#;
    let pivot = parse_pivot_table(xml);
    assert!(pivot.location.ref_.is_none());
}

#[test]
fn w4c_pivot_location_ref_malformed_no_panic() {
    // UTF-8 boundary UTF-8-boundary class: malformed input must not panic.
    // The typed `parse_a1_range` returns `None`, and `PivotLocation`
    // treats that the same as an absent attribute.
    //
    // `\xCE\xBC` = U+03BC GREEK SMALL LETTER MU. Embedded as byte escape
    // because byte string literals cannot carry non-ASCII directly.
    let xml: &[u8] = b"<?xml version=\"1.0\"?>\n\
<pivotTableDefinition name=\"X\" cacheId=\"1\">\n\
    <location ref=\"\xCE\xBC\xCE\xBC\xCE\xBC\xCE\xBC\xCE\xBC\xCE\xBC\"/>\n\
</pivotTableDefinition>";
    let pivot = parse_pivot_table(xml);
    // The load-bearing property is that no panic crashed the parser.
    // Parse may either yield None (rejected) or a Some(valid range)
    // depending on how the grammar handles the bytes; either is fine.
    let _ = pivot.location.ref_;
}
