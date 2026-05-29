//! Conversion from parsed pivot table/cache models into production parse output.

use crate::domain::pivot::model::{CacheField, PivotCache, SharedItem};

pub(crate) fn parsed_pivot_to_config(
    pt: &crate::domain::pivot::model::PivotTable,
    cache: &PivotCache,
    sheet_name: &str,
    cache_records: &[Vec<value_types::CellValue>],
) -> Option<domain_types::domain::pivot::ParsedPivotTable> {
    crate::output::to_parse_output::pivot_convert::parsed_pivot_to_config(
        pt,
        cache,
        sheet_name,
        cache_records,
    )
}

/// Build a full PivotCache read model from ParsedPivotCache for the converter.
pub(crate) fn build_full_pivot_cache_for_converter(
    pc: &crate::domain::pivot::types::ParsedPivotCache,
    cache_id: u32,
) -> PivotCache {
    let ws_src = pc.definition.cache_source.worksheet_source.as_ref();
    PivotCache {
        id: cache_id,
        source_ref: ws_src.and_then(|s| s.r#ref.clone()),
        source_sheet: ws_src.and_then(|s| s.sheet.clone()),
        source_name: ws_src.and_then(|s| s.name.clone()),
        fields: pc
            .definition
            .cache_fields
            .items
            .iter()
            .map(|f| {
                let shared_items = f
                    .shared_items
                    .as_ref()
                    .map(|si| {
                        si.items
                            .iter()
                            .map(|item| {
                                use ooxml_types::pivot::SharedItem as OoxmlSharedItem;
                                match item {
                                    OoxmlSharedItem::Number(n) => SharedItem::Number(*n),
                                    OoxmlSharedItem::String(s) => SharedItem::String(s.clone()),
                                    OoxmlSharedItem::Boolean(b) => SharedItem::Boolean(*b),
                                    OoxmlSharedItem::Error(e) => SharedItem::Error(e.clone()),
                                    OoxmlSharedItem::DateTime(s) => SharedItem::DateTime(s.clone()),
                                    OoxmlSharedItem::Missing => SharedItem::Missing,
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                CacheField {
                    name: f.name.clone(),
                    shared_items,
                    ..CacheField::default()
                }
            })
            .collect(),
        ..PivotCache::default()
    }
}
