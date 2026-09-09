//! OOXML conversion boundary for pivot parser models.

use crate::domain::pivot::model::{CacheField, CacheRecordValue, CacheSourceType, SharedItem};
use crate::domain::pivot::parse::{
    parse_pivot_cache_definition, parse_pivot_cache_records_with_metadata,
};

pub(crate) fn pivot_cache_to_ooxml(xml: &[u8]) -> ooxml_types::pivot::PivotCacheDefinition {
    let parsed = parse_pivot_cache_definition(xml);

    let cache_source = ooxml_types::pivot::PivotCacheSource {
        r#type: match parsed.source_type {
            CacheSourceType::Worksheet => ooxml_types::pivot::PivotSourceType::Worksheet,
            CacheSourceType::External => ooxml_types::pivot::PivotSourceType::External,
            CacheSourceType::Consolidation => ooxml_types::pivot::PivotSourceType::Consolidation,
            CacheSourceType::Scenario => ooxml_types::pivot::PivotSourceType::Scenario,
        },
        worksheet_source: if parsed.source_ref.is_some()
            || parsed.source_sheet.is_some()
            || parsed.source_name.is_some()
            || parsed.source_r_id.is_some()
        {
            Some(ooxml_types::pivot::WorksheetSource {
                r#ref: parsed.source_ref,
                sheet: parsed.source_sheet,
                name: parsed.source_name,
                r_id: parsed.source_r_id,
            })
        } else {
            None
        },
        ..Default::default()
    };

    let cache_fields = ooxml_types::pivot::PivotCacheFields {
        count: Some(parsed.fields.len() as u32),
        items: parsed
            .fields
            .iter()
            .map(|f| {
                let shared_items = if f.shared_items.is_empty() && f.shared_items_metadata.is_none()
                {
                    None
                } else {
                    Some(convert_shared_items_to_ooxml(&f.shared_items, f))
                };
                ooxml_types::pivot::PivotCacheField {
                    name: f.name.clone(),
                    caption: f.caption.clone(),
                    num_fmt_id: f.num_fmt_id,
                    sql_type: f.sql_type,
                    shared_items,
                    ..f.field_metadata.clone().unwrap_or_default()
                }
            })
            .collect(),
    };

    ooxml_types::pivot::PivotCacheDefinition {
        refresh_on_load: parsed.refresh_on_load,
        record_count: parsed.record_count,
        cache_source,
        cache_fields,
        ..Default::default()
    }
}

pub(crate) fn convert_shared_items_to_ooxml(
    items: &[SharedItem],
    field: &CacheField,
) -> ooxml_types::pivot::SharedItems {
    let mut ooxml_items = Vec::with_capacity(items.len());
    let mut s_vec = Vec::new();
    let mut n_vec = Vec::new();
    let mut b_vec = Vec::new();
    let mut e_vec = Vec::new();
    let mut d_vec = Vec::new();
    let mut m_vec = Vec::new();

    for item in items {
        match item {
            SharedItem::String(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::String(v.clone()));
                s_vec.push(ooxml_types::pivot::PivotCacheString {
                    v: v.clone(),
                    ..Default::default()
                });
            }
            SharedItem::Number(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Number(*v));
                n_vec.push(ooxml_types::pivot::PivotNumber {
                    v: *v,
                    ..Default::default()
                });
            }
            SharedItem::Boolean(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Boolean(*v));
                b_vec.push(ooxml_types::pivot::PivotBoolean {
                    v: *v,
                    ..Default::default()
                });
            }
            SharedItem::Error(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Error(v.clone()));
                e_vec.push(ooxml_types::pivot::PivotError {
                    v: v.clone(),
                    ..Default::default()
                });
            }
            SharedItem::DateTime(v) => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::DateTime(v.clone()));
                d_vec.push(ooxml_types::pivot::PivotDateTime {
                    v: v.clone(),
                    ..Default::default()
                });
            }
            SharedItem::Missing => {
                ooxml_items.push(ooxml_types::pivot::SharedItem::Missing);
                m_vec.push(ooxml_types::pivot::PivotMissing::default());
            }
        }
    }

    let metadata =
        field
            .shared_items_metadata
            .clone()
            .unwrap_or_else(|| ooxml_types::pivot::SharedItems {
                count: Some(items.len() as u32),
                contains_date: field.contains_date,
                contains_number: field.contains_number,
                contains_integer: field.contains_integer,
                contains_blank: field.contains_blank,
                contains_mixed_types: field.contains_mixed_types,
                ..Default::default()
            });
    ooxml_types::pivot::SharedItems {
        items: ooxml_items,
        s: s_vec,
        n: n_vec,
        b: b_vec,
        e: e_vec,
        d: d_vec,
        m: m_vec,
        ..metadata
    }
}

pub(crate) fn pivot_cache_records_to_ooxml(xml: &[u8]) -> ooxml_types::pivot::PivotCacheRecords {
    let parsed = parse_pivot_cache_records_with_metadata(xml);
    let count = parsed.count.unwrap_or(parsed.records.len() as u32);
    let records = parsed
        .records
        .into_iter()
        .map(|rec| ooxml_types::pivot::cache::PivotRecord {
            values: rec
                .values
                .into_iter()
                .map(|v| match v {
                    CacheRecordValue::Index(i) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Index(i)
                    }
                    CacheRecordValue::Number(n) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Number(n)
                    }
                    CacheRecordValue::String(s) => {
                        ooxml_types::pivot::cache::PivotRecordValue::String(s)
                    }
                    CacheRecordValue::Boolean(b) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Boolean(b)
                    }
                    CacheRecordValue::Error(e) => {
                        ooxml_types::pivot::cache::PivotRecordValue::Error(e)
                    }
                    CacheRecordValue::DateTime(d) => {
                        ooxml_types::pivot::cache::PivotRecordValue::DateTime(d)
                    }
                    CacheRecordValue::Missing => {
                        ooxml_types::pivot::cache::PivotRecordValue::Missing
                    }
                })
                .collect(),
        })
        .collect();
    ooxml_types::pivot::PivotCacheRecords {
        count: Some(count),
        records,
        ext_lst: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_empty_shared_items_with_all_metadata() {
        let definition = pivot_cache_to_ooxml(
            br#"<pivotCacheDefinition><cacheFields>
            <cacheField name="Amount" caption="Total" numFmtId="16" sqlType="8"
                formula="A+B" hierarchy="-1" level="2" databaseField="0" uniqueList="0"
                memberPropertyField="1" serverField="1" propertyName="Units" mappingCount="3">
                <sharedItems count="0" containsSemiMixedTypes="0" containsNonDate="0"
                    containsString="0" containsDate="1" containsNumber="1" containsInteger="1"
                    containsBlank="1" containsMixedTypes="1" longText="1"
                    minValue="-1.5" maxValue="42" minDate="2024-01-01T00:00:00"
                    maxDate="2024-12-31T00:00:00"/>
            </cacheField>
            <cacheField name="Unspecified"><sharedItems/></cacheField>
            <cacheField name="Absent"/>
        </cacheFields></pivotCacheDefinition>"#,
        );
        let field = &definition.cache_fields.items[0];
        assert_eq!(field.caption.as_deref(), Some("Total"));
        assert_eq!(field.num_fmt_id, Some(16));
        assert_eq!(field.sql_type, Some(8));
        assert_eq!(field.formula.as_deref(), Some("A+B"));
        assert_eq!(field.hierarchy, Some(-1));
        assert_eq!(field.level, Some(2));
        assert!(!field.database_field);
        assert_eq!(field.unique_list, Some(false));
        assert!(field.member_property_field);
        assert!(field.server_field);
        assert_eq!(field.property_name.as_deref(), Some("Units"));
        assert_eq!(field.mapping_count, Some(3));
        let metadata = field.shared_items.as_ref().unwrap();
        assert_eq!(metadata.count, Some(0));
        assert!(metadata.items.is_empty());
        assert!(!metadata.contains_semi_mixed_types);
        assert!(!metadata.contains_non_date);
        assert!(!metadata.contains_string);
        assert!(metadata.contains_date);
        assert!(metadata.contains_number);
        assert!(metadata.contains_integer);
        assert!(metadata.contains_blank);
        assert!(metadata.contains_mixed_types);
        assert!(metadata.long_text);
        assert_eq!(metadata.min_value, Some(-1.5));
        assert_eq!(metadata.max_value, Some(42.0));
        assert_eq!(metadata.min_date.as_deref(), Some("2024-01-01T00:00:00"));
        assert_eq!(metadata.max_date.as_deref(), Some("2024-12-31T00:00:00"));
        let default_metadata = definition.cache_fields.items[1]
            .shared_items
            .as_ref()
            .unwrap();
        assert_eq!(
            default_metadata,
            &ooxml_types::pivot::SharedItems::default()
        );
        assert!(definition.cache_fields.items[2].shared_items.is_none());
    }
}
