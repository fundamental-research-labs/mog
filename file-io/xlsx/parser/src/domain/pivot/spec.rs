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
                let shared_items = if f.shared_items.is_empty() {
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
                    ..Default::default()
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

    ooxml_types::pivot::SharedItems {
        count: Some(items.len() as u32),
        contains_date: field.contains_date,
        contains_number: field.contains_number,
        contains_integer: field.contains_integer,
        contains_blank: field.contains_blank,
        contains_mixed_types: field.contains_mixed_types,
        items: ooxml_items,
        s: s_vec,
        n: n_vec,
        b: b_vec,
        e: e_vec,
        d: d_vec,
        m: m_vec,
        ..Default::default()
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
