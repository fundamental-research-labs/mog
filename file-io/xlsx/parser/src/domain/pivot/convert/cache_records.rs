//! Pivot cache record dereferencing.

/// Resolve cache records from a ParsedPivotCache, dereferencing shared item indices.
pub(crate) fn resolve_cache_records(
    parsed_cache: Option<&crate::domain::pivot::types::ParsedPivotCache>,
) -> Vec<Vec<value_types::CellValue>> {
    let pc = match parsed_cache {
        Some(pc) => pc,
        None => return Vec::new(),
    };

    let fields = &pc.definition.cache_fields.items;
    let records = &pc.records.records;

    fn shared_item_to_cell_value(item: &ooxml_types::pivot::SharedItem) -> value_types::CellValue {
        use ooxml_types::pivot::SharedItem;
        match item {
            SharedItem::Number(n) => value_types::CellValue::number(*n),
            SharedItem::String(s) => value_types::CellValue::Text(s.as_str().into()),
            SharedItem::Boolean(b) => value_types::CellValue::Boolean(*b),
            SharedItem::Error(e) => e
                .parse::<value_types::CellError>()
                .map(|e| value_types::CellValue::Error(e, None))
                .unwrap_or(value_types::CellValue::Null),
            SharedItem::DateTime(s) => value_types::CellValue::Text(s.as_str().into()),
            SharedItem::Missing => value_types::CellValue::Null,
        }
    }

    records
        .iter()
        .map(|record| {
            record
                .values
                .iter()
                .enumerate()
                .map(|(field_idx, val)| {
                    use ooxml_types::pivot::cache::PivotRecordValue;
                    match val {
                        PivotRecordValue::Number(n) => value_types::CellValue::number(*n),
                        PivotRecordValue::String(s) => {
                            value_types::CellValue::Text(s.as_str().into())
                        }
                        PivotRecordValue::Boolean(b) => value_types::CellValue::Boolean(*b),
                        PivotRecordValue::Error(e) => e
                            .parse::<value_types::CellError>()
                            .map(|e| value_types::CellValue::Error(e, None))
                            .unwrap_or(value_types::CellValue::Null),
                        PivotRecordValue::DateTime(s) => {
                            value_types::CellValue::Text(s.as_str().into())
                        }
                        PivotRecordValue::Missing => value_types::CellValue::Null,
                        PivotRecordValue::Index(idx) => fields
                            .get(field_idx)
                            .and_then(|f| f.shared_items.as_ref())
                            .and_then(|shared| shared.items.get(*idx as usize))
                            .map(shared_item_to_cell_value)
                            .unwrap_or(value_types::CellValue::Null),
                    }
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dereferences_shared_item_indices_by_field_position() {
        let parsed_cache = crate::domain::pivot::types::ParsedPivotCache {
            definition: ooxml_types::pivot::PivotCacheDefinition {
                cache_fields: ooxml_types::pivot::PivotCacheFields {
                    count: Some(2),
                    items: vec![
                        ooxml_types::pivot::PivotCacheField {
                            name: "Region".to_string(),
                            shared_items: Some(ooxml_types::pivot::SharedItems {
                                items: vec![
                                    ooxml_types::pivot::SharedItem::String("West".to_string()),
                                    ooxml_types::pivot::SharedItem::String("East".to_string()),
                                ],
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                        ooxml_types::pivot::PivotCacheField {
                            name: "Amount".to_string(),
                            shared_items: Some(ooxml_types::pivot::SharedItems {
                                items: vec![
                                    ooxml_types::pivot::SharedItem::Number(10.0),
                                    ooxml_types::pivot::SharedItem::Number(20.0),
                                ],
                                ..Default::default()
                            }),
                            ..Default::default()
                        },
                    ],
                },
                ..Default::default()
            },
            records: ooxml_types::pivot::PivotCacheRecords {
                records: vec![ooxml_types::pivot::cache::PivotRecord {
                    values: vec![
                        ooxml_types::pivot::cache::PivotRecordValue::Index(1),
                        ooxml_types::pivot::cache::PivotRecordValue::Index(0),
                    ],
                }],
                ..Default::default()
            },
        };

        let records = resolve_cache_records(Some(&parsed_cache));
        assert_eq!(records.len(), 1);
        assert_eq!(records[0][0], value_types::CellValue::Text("East".into()));
        assert_eq!(records[0][1], value_types::CellValue::number(10.0));
    }

    #[test]
    fn invalid_error_values_resolve_to_null() {
        let parsed_cache = crate::domain::pivot::types::ParsedPivotCache {
            definition: ooxml_types::pivot::PivotCacheDefinition {
                cache_fields: ooxml_types::pivot::PivotCacheFields {
                    count: Some(1),
                    items: vec![ooxml_types::pivot::PivotCacheField {
                        name: "Error".to_string(),
                        shared_items: Some(ooxml_types::pivot::SharedItems {
                            items: vec![ooxml_types::pivot::SharedItem::Error(
                                "not-an-error".to_string(),
                            )],
                            ..Default::default()
                        }),
                        ..Default::default()
                    }],
                },
                ..Default::default()
            },
            records: ooxml_types::pivot::PivotCacheRecords {
                records: vec![
                    ooxml_types::pivot::cache::PivotRecord {
                        values: vec![ooxml_types::pivot::cache::PivotRecordValue::Index(0)],
                    },
                    ooxml_types::pivot::cache::PivotRecord {
                        values: vec![ooxml_types::pivot::cache::PivotRecordValue::Error(
                            "not-an-error".to_string(),
                        )],
                    },
                ],
                ..Default::default()
            },
        };

        let records = resolve_cache_records(Some(&parsed_cache));

        assert_eq!(records[0][0], value_types::CellValue::Null);
        assert_eq!(records[1][0], value_types::CellValue::Null);
    }
}
