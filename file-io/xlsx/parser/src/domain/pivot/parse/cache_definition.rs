//! `pivotCacheDefinition` parsing.

use crate::domain::pivot::model::{CacheField, CacheSourceType, PivotCache};
use crate::domain::pivot::parse::shared_items::parse_shared_items;
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_opt, parse_bool_attr_with_default, parse_f64_attr,
    parse_i32_attr, parse_string_attr, parse_u32_attr,
};

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
        let Some(tag_end) = find_gt_simd(xml, field_start) else {
            break;
        };
        let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');
        let element = &xml[field_start..tag_end + 1];

        let mut field = CacheField {
            name: parse_string_attr(element, b"name=\"").unwrap_or_default(),
            num_fmt_id: parse_u32_attr(element, b"numFmtId=\""),
            sql_type: parse_i32_attr(element, b"sqlType=\""),
            caption: parse_string_attr(element, b"caption=\""),
            ..Default::default()
        };
        field.field_metadata = Some(ooxml_types::pivot::PivotCacheField {
            name: field.name.clone(),
            caption: field.caption.clone(),
            num_fmt_id: field.num_fmt_id,
            sql_type: field.sql_type,
            formula: parse_string_attr(element, b"formula=\""),
            hierarchy: parse_i32_attr(element, b"hierarchy=\""),
            level: parse_u32_attr(element, b"level=\""),
            database_field: parse_bool_attr_with_default(element, b"databaseField=\"", true),
            unique_list: parse_bool_attr_opt(element, b"uniqueList=\""),
            member_property_field: parse_bool_attr(element, b"memberPropertyField=\""),
            server_field: parse_bool_attr(element, b"serverField=\""),
            property_name: parse_string_attr(element, b"propertyName=\""),
            mapping_count: parse_u32_attr(element, b"mappingCount=\""),
            ..Default::default()
        });

        if !is_self_closing {
            let field_end = find_closing_tag(xml, b"cacheField", field_start).unwrap_or(xml.len());

            let field_body = &xml[tag_end + 1..field_end];
            if let Some(metadata) = &mut field.field_metadata {
                metadata.field_group = super::field_group::parse_field_group(field_body);
            }
            if let Some(items_start) = find_tag_simd(field_body, b"sharedItems", 0) {
                if let Some(items_tag_end) = find_gt_simd(field_body, items_start) {
                    let items_element = &field_body[items_start..items_tag_end + 1];
                    let metadata = parse_shared_items_metadata(items_element);
                    field.contains_date = metadata.contains_date;
                    field.contains_number = metadata.contains_number;
                    field.contains_integer = metadata.contains_integer;
                    field.contains_blank = metadata.contains_blank;
                    field.contains_mixed_types = metadata.contains_mixed_types;
                    field.shared_items_metadata = Some(metadata);

                    if field_body.get(items_tag_end - 1) != Some(&b'/') {
                        let items_end = find_closing_tag(field_body, b"sharedItems", items_start)
                            .unwrap_or(field_body.len());
                        field.shared_items =
                            parse_shared_items(&field_body[items_tag_end + 1..items_end]);
                    }
                }
            }

            pos = field_end + 1;
        } else {
            pos = tag_end + 1;
        }

        fields.push(field);
    }

    fields
}

fn parse_shared_items_metadata(element: &[u8]) -> ooxml_types::pivot::SharedItems {
    ooxml_types::pivot::SharedItems {
        contains_semi_mixed_types: parse_bool_attr_with_default(
            element,
            b"containsSemiMixedTypes=\"",
            true,
        ),
        contains_non_date: parse_bool_attr_with_default(element, b"containsNonDate=\"", true),
        contains_string: parse_bool_attr_with_default(element, b"containsString=\"", true),
        contains_date: parse_bool_attr(element, b"containsDate=\""),
        contains_number: parse_bool_attr(element, b"containsNumber=\""),
        contains_integer: parse_bool_attr(element, b"containsInteger=\""),
        contains_blank: parse_bool_attr(element, b"containsBlank=\""),
        contains_mixed_types: parse_bool_attr(element, b"containsMixedTypes=\""),
        long_text: parse_bool_attr(element, b"longText=\""),
        min_value: parse_f64_attr(element, b"minValue=\""),
        max_value: parse_f64_attr(element, b"maxValue=\""),
        min_date: parse_string_attr(element, b"minDate=\""),
        max_date: parse_string_attr(element, b"maxDate=\""),
        count: parse_u32_attr(element, b"count=\""),
        ..Default::default()
    }
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

    #[test]
    fn empty_shared_items_never_consume_following_fields() {
        for empty_items in ["<sharedItems count=\"0\"/>", "<sharedItems></sharedItems>"] {
            let xml = format!(
                r#"<pivotCacheDefinition><cacheFields count="4">
                    <cacheField name="Absent"/>
                    <cacheField name="Empty">{empty_items}</cacheField>
                    <cacheField name="Dates" numFmtId="16"><sharedItems containsDate="1"><d v="2024-01-15T00:00:00"/></sharedItems></cacheField>
                    <cacheField name="Numbers"><sharedItems><n v="3"/></sharedItems></cacheField>
                </cacheFields></pivotCacheDefinition>"#
            );
            let cache = parse_pivot_cache_definition(xml.as_bytes());
            assert_eq!(cache.fields.len(), 4);
            assert!(cache.fields[0].shared_items_metadata.is_none());
            assert!(cache.fields[1].shared_items_metadata.is_some());
            assert!(cache.fields[1].shared_items.is_empty());
            assert_eq!(cache.fields[2].num_fmt_id, Some(16));
            assert_eq!(
                cache.fields[2].shared_items,
                vec![SharedItem::DateTime("2024-01-15T00:00:00".to_string())]
            );
            assert_eq!(cache.fields[3].shared_items, vec![SharedItem::Number(3.0)]);
        }
    }

    #[test]
    fn unterminated_shared_items_are_bounded_to_their_cache_field() {
        let cache = parse_pivot_cache_definition(
            br#"<pivotCacheDefinition><cacheFields>
                <cacheField name="First"><sharedItems><n v="1"/></cacheField>
                <cacheField name="Second"><sharedItems><s v="next"/></sharedItems></cacheField>
            </cacheFields></pivotCacheDefinition>"#,
        );
        assert_eq!(cache.fields[0].shared_items, vec![SharedItem::Number(1.0)]);
        assert_eq!(
            cache.fields[1].shared_items,
            vec![SharedItem::String("next".to_string())]
        );
    }
}
