//! `pivotCacheRecords` parsing.

use crate::domain::pivot::model::{CacheRecord, CacheRecordValue};
use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr, parse_f64_attr, parse_string_attr, parse_u32_attr};

/// Parse pivot cache records from pivotCacheRecords*.xml.
pub fn parse_pivot_cache_records(xml: &[u8]) -> Vec<CacheRecord> {
    parse_pivot_cache_records_with_metadata(xml).records
}

#[derive(Debug, Clone, Default)]
pub struct ParsedPivotCacheRecords {
    pub count: Option<u32>,
    pub records: Vec<CacheRecord>,
}

pub fn parse_pivot_cache_records_with_metadata(xml: &[u8]) -> ParsedPivotCacheRecords {
    let mut records = Vec::new();
    let records_start = match find_tag_simd(xml, b"pivotCacheRecords", 0) {
        Some(pos) => pos,
        None => return ParsedPivotCacheRecords::default(),
    };
    let root_end = find_gt_simd(xml, records_start).unwrap_or(records_start);
    let count = parse_u32_attr(&xml[records_start..=root_end], b"count=\"");
    let records_end =
        find_closing_tag(xml, b"pivotCacheRecords", records_start).unwrap_or(xml.len());

    let mut pos = records_start;
    while pos < records_end {
        let r_start = match find_tag_simd(&xml[..records_end], b"r", pos) {
            Some(p) if p < records_end => p,
            _ => break,
        };

        if r_start + 2 < xml.len() {
            let after = xml.get(r_start + 2);
            if after == Some(&b' ') || after == Some(&b'>') || after == Some(&b'/') {
                let r_end = find_closing_tag(xml, b"r", r_start).unwrap_or(records_end);
                let tag_end = find_gt_simd(xml, r_start).unwrap_or(r_end);
                let is_self_closing = tag_end > 0 && xml.get(tag_end - 1) == Some(&b'/');

                if is_self_closing {
                    records.push(CacheRecord::default());
                } else if r_end > r_start {
                    records.push(parse_cache_record(&xml[r_start..r_end]));
                }

                pos = if is_self_closing {
                    tag_end + 1
                } else {
                    r_end + 1
                };
                continue;
            }
        }

        pos = r_start + 1;
    }

    ParsedPivotCacheRecords { count, records }
}

pub(crate) fn parse_cache_record(xml: &[u8]) -> CacheRecord {
    let mut record = CacheRecord::default();
    let mut pos = 0;

    while pos < xml.len() {
        let lt_pos = match memchr::memchr(b'<', &xml[pos..]) {
            Some(p) => pos + p,
            None => break,
        };

        if lt_pos + 1 < xml.len() && xml[lt_pos + 1] == b'/' {
            pos = lt_pos + 1;
            continue;
        }

        if lt_pos + 2 >= xml.len() {
            break;
        }

        let tag_end = find_gt_simd(xml, lt_pos).unwrap_or(xml.len());
        let element = &xml[lt_pos..tag_end + 1];

        match xml[lt_pos + 1] {
            b'x' => {
                if let Some(v) = parse_u32_attr(element, b"v=\"") {
                    record.values.push(CacheRecordValue::Index(v));
                }
            }
            b's' => {
                if let Some(v) = parse_string_attr(element, b"v=\"") {
                    record.values.push(CacheRecordValue::String(v));
                }
            }
            b'n' => {
                if let Some(v) = parse_f64_attr(element, b"v=\"") {
                    record.values.push(CacheRecordValue::Number(v));
                }
            }
            b'b' => record
                .values
                .push(CacheRecordValue::Boolean(parse_bool_attr(element, b"v=\""))),
            b'e' => {
                if let Some(v) = parse_string_attr(element, b"v=\"") {
                    record.values.push(CacheRecordValue::Error(v));
                }
            }
            b'd' => {
                if let Some(v) = parse_string_attr(element, b"v=\"") {
                    record.values.push(CacheRecordValue::DateTime(v));
                }
            }
            b'm' => record.values.push(CacheRecordValue::Missing),
            _ => {}
        }

        pos = tag_end + 1;
    }

    record
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cache_records_preserving_record_and_field_order() {
        let xml = br##"<?xml version="1.0"?>
<pivotCacheRecords count="2">
    <r>
        <x v="0"/>
        <s v="inline"/>
        <n v="100.50"/>
        <b v="1"/>
        <e v="#N/A"/>
        <d v="2024-01-15T10:30:00"/>
        <m/>
        <unknown v="ignored"/>
    </r>
    <r>
        <x v="1"/>
        <n v="200.75"/>
        <m/>
    </r>
</pivotCacheRecords>"##;

        let records = parse_pivot_cache_records(xml);

        assert_eq!(records.len(), 2);
        assert_eq!(
            records[0].values,
            vec![
                CacheRecordValue::Index(0),
                CacheRecordValue::String("inline".to_string()),
                CacheRecordValue::Number(100.50),
                CacheRecordValue::Boolean(true),
                CacheRecordValue::Error("#N/A".to_string()),
                CacheRecordValue::DateTime("2024-01-15T10:30:00".to_string()),
                CacheRecordValue::Missing,
            ]
        );
        assert_eq!(
            records[1].values,
            vec![
                CacheRecordValue::Index(1),
                CacheRecordValue::Number(200.75),
                CacheRecordValue::Missing,
            ]
        );
    }

    #[test]
    fn self_closing_record_is_parsed_as_empty_record() {
        let xml = br#"<pivotCacheRecords count="2"><r/><r><s v="kept"/></r></pivotCacheRecords>"#;

        let records = parse_pivot_cache_records(xml);

        assert_eq!(records.len(), 2);
        assert!(records[0].values.is_empty());
        assert_eq!(
            records[1].values,
            vec![CacheRecordValue::String("kept".to_string())]
        );
    }

    #[test]
    fn parses_source_record_count() {
        let xml = br#"<pivotCacheRecords count="7"><r/></pivotCacheRecords>"#;

        let parsed = parse_pivot_cache_records_with_metadata(xml);

        assert_eq!(parsed.count, Some(7));
        assert_eq!(parsed.records.len(), 1);
    }
}
