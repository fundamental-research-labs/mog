//! `pivotCacheDefinition` parsing.

use crate::domain::pivot::model::{CacheField, CacheSourceType, PivotCache};
use crate::domain::pivot::parse::shared_items::parse_shared_items;
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr, parse_i32_attr, parse_string_attr, parse_u32_attr};

/// Parse a pivot cache definition from pivotCacheDefinition*.xml.
pub fn parse_pivot_cache_definition(xml: &[u8]) -> PivotCache {
    let mut cache = PivotCache::default();
    let cache_start = match find_tag_simd(xml, b"pivotCacheDefinition", 0) {
        Some(pos) => pos,
        None => return cache,
    };

    if let Some(end) = find_gt_simd(xml, cache_start) {
        let element = &xml[cache_start..end + 1];
        cache.id = parse_u32_attr(element, b"r:id=\"").unwrap_or(0);
        cache.refresh_on_load = parse_bool_attr(element, b"refreshOnLoad=\"");
        cache.record_count = parse_u32_attr(element, b"recordCount=\"");
    }

    if let Some(source_start) = find_tag_simd(xml, b"cacheSource", cache_start) {
        if let Some(source_end) = find_gt_simd(xml, source_start) {
            let source_element = &xml[source_start..source_end + 1];
            if let Some(type_str) = parse_string_attr(source_element, b"type=\"") {
                cache.source_type = match type_str.as_str() {
                    "worksheet" => CacheSourceType::Worksheet,
                    "external" => CacheSourceType::External,
                    "consolidation" => CacheSourceType::Consolidation,
                    "scenario" => CacheSourceType::Scenario,
                    _ => CacheSourceType::Worksheet,
                };
            }
        }

        if let Some(ws_start) = find_tag_simd(xml, b"worksheetSource", source_start) {
            if let Some(ws_end) = find_gt_simd(xml, ws_start) {
                let ws_element = &xml[ws_start..ws_end + 1];
                cache.source_ref = parse_string_attr(ws_element, b"ref=\"");
                cache.source_sheet = parse_string_attr(ws_element, b"sheet=\"");
                cache.source_name = parse_string_attr(ws_element, b"name=\"");
                cache.source_r_id = parse_string_attr(ws_element, b"r:id=\"");
            }
        }
    }

    if let Some(fields_start) = find_tag_simd(xml, b"cacheFields", cache_start) {
        let fields_end = find_closing_tag(xml, b"cacheFields", fields_start).unwrap_or(xml.len());
        cache.fields = parse_cache_fields(&xml[fields_start..fields_end]);
    }

    cache
}

pub(crate) fn parse_cache_fields(xml: &[u8]) -> Vec<CacheField> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while let Some(field_start) = find_tag_simd(xml, b"cacheField", pos) {
        let tag_end = find_gt_simd(xml, field_start).unwrap_or(xml.len());
        let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');
        let element = &xml[field_start..tag_end + 1];

        let mut field = CacheField {
            name: parse_string_attr(element, b"name=\"").unwrap_or_default(),
            num_fmt_id: parse_u32_attr(element, b"numFmtId=\""),
            sql_type: parse_i32_attr(element, b"sqlType=\""),
            caption: parse_string_attr(element, b"caption=\""),
            ..Default::default()
        };

        if !is_self_closing {
            let field_end = find_closing_tag(xml, b"cacheField", field_start).unwrap_or(xml.len());

            if let Some(items_start) =
                find_tag_simd(&xml[field_start..field_end], b"sharedItems", 0)
            {
                let items_abs_start = field_start + items_start;
                let items_tag_end = find_gt_simd(xml, items_abs_start).unwrap_or(field_end);
                let items_element = &xml[items_abs_start..items_tag_end + 1];

                field.contains_date = parse_bool_attr(items_element, b"containsDate=\"");
                field.contains_number = parse_bool_attr(items_element, b"containsNumber=\"");
                field.contains_integer = parse_bool_attr(items_element, b"containsInteger=\"");
                field.contains_blank = parse_bool_attr(items_element, b"containsBlank=\"");
                field.contains_mixed_types =
                    parse_bool_attr(items_element, b"containsMixedTypes=\"");

                let items_end =
                    find_closing_tag(xml, b"sharedItems", items_abs_start).unwrap_or(field_end);
                field.shared_items = parse_shared_items(&xml[items_abs_start..items_end]);
            }

            pos = field_end + 1;
        } else {
            pos = tag_end + 1;
        }

        fields.push(field);
    }

    fields
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::pivot::model::SharedItem;

    #[test]
    fn parses_cache_definition_root_source_and_fields() {
        let xml = br#"<?xml version="1.0"?>
<pivotCacheDefinition refreshOnLoad="1" recordCount="100">
    <cacheSource type="worksheet">
        <worksheetSource ref="A1:D100" sheet="Data"/>
    </cacheSource>
    <cacheFields count="1">
        <cacheField name="Category" numFmtId="0">
            <sharedItems count="1"><s v="Electronics"/></sharedItems>
        </cacheField>
    </cacheFields>
</pivotCacheDefinition>"#;

        let cache = parse_pivot_cache_definition(xml);

        assert!(cache.refresh_on_load);
        assert_eq!(cache.record_count, Some(100));
        assert_eq!(cache.source_type, CacheSourceType::Worksheet);
        assert_eq!(cache.source_ref, Some("A1:D100".to_string()));
        assert_eq!(cache.source_sheet, Some("Data".to_string()));
        assert_eq!(cache.source_r_id, None);
        assert_eq!(cache.fields.len(), 1);
        assert_eq!(cache.fields[0].name, "Category");
        assert_eq!(
            cache.fields[0].shared_items,
            vec![SharedItem::String("Electronics".to_string())]
        );
    }

    #[test]
    fn maps_cache_source_types_and_falls_back_to_worksheet() {
        let cases = [
            ("worksheet", CacheSourceType::Worksheet),
            ("external", CacheSourceType::External),
            ("consolidation", CacheSourceType::Consolidation),
            ("scenario", CacheSourceType::Scenario),
            ("unknown", CacheSourceType::Worksheet),
        ];

        for (raw, expected) in cases {
            let xml = format!(
                r#"<pivotCacheDefinition><cacheSource type="{raw}"/></pivotCacheDefinition>"#
            );
            assert_eq!(
                parse_pivot_cache_definition(xml.as_bytes()).source_type,
                expected
            );
        }

        assert_eq!(
            parse_pivot_cache_definition(br#"<pivotCacheDefinition/>"#).source_type,
            CacheSourceType::Worksheet
        );
    }

    #[test]
    fn parses_named_worksheet_source() {
        let xml = br#"<pivotCacheDefinition recordCount="2">
            <cacheSource type="worksheet">
                <worksheetSource name="tbl_units"/>
            </cacheSource>
        </pivotCacheDefinition>"#;

        let cache = parse_pivot_cache_definition(xml);

        assert_eq!(cache.source_name.as_deref(), Some("tbl_units"));
        assert_eq!(cache.source_ref, None);
        assert_eq!(cache.source_sheet, None);
    }

    #[test]
    fn parses_external_worksheet_source_relationship_id() {
        let xml = br#"<pivotCacheDefinition recordCount="2">
            <cacheSource type="worksheet">
                <worksheetSource ref="A1:B3" sheet="External Sheet" r:id="rIdExternalSource"/>
            </cacheSource>
        </pivotCacheDefinition>"#;

        let cache = parse_pivot_cache_definition(xml);

        assert_eq!(cache.source_sheet.as_deref(), Some("External Sheet"));
        assert_eq!(cache.source_ref.as_deref(), Some("A1:B3"));
        assert_eq!(cache.source_r_id.as_deref(), Some("rIdExternalSource"));
    }

    #[test]
    fn parses_shared_item_metadata_flags() {
        let xml = br#"<pivotCacheDefinition>
    <cacheFields count="1">
        <cacheField name="Amount" numFmtId="4">
            <sharedItems containsDate="1" containsNumber="1" containsInteger="1" containsBlank="1" containsMixedTypes="1" count="0"/>
        </cacheField>
    </cacheFields>
</pivotCacheDefinition>"#;

        let cache = parse_pivot_cache_definition(xml);
        let field = &cache.fields[0];

        assert!(field.contains_date);
        assert!(field.contains_number);
        assert!(field.contains_integer);
        assert!(field.contains_blank);
        assert!(field.contains_mixed_types);
    }
}
