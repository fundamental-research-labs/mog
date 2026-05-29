use domain_types::PivotCacheSourceDef;
use domain_types::domain::pivot::PivotCacheWorkbookRefScope;
use value_types::{CellValue, FiniteF64};

use crate::domain::pivot::types::ParsedPivotCache;

pub(super) fn build_pivot_cache_sources<'a>(
    pivot_caches: impl Iterator<Item = (&'a u32, &'a ParsedPivotCache)>,
    packages: &[domain_types::PivotCachePackageFidelity],
) -> Vec<PivotCacheSourceDef> {
    let scopes_by_cache_id: std::collections::HashMap<u32, PivotCacheWorkbookRefScope> = packages
        .iter()
        .map(|package| (package.cache_id, package.workbook_ref_scope))
        .collect();
    let mut sources: Vec<_> = pivot_caches
        .map(|(cache_id, parsed_cache)| {
            let worksheet_source = parsed_cache
                .definition
                .cache_source
                .worksheet_source
                .as_ref();
            PivotCacheSourceDef {
                cache_id: *cache_id,
                workbook_ref_scope: scopes_by_cache_id
                    .get(cache_id)
                    .copied()
                    .unwrap_or_default(),
                source_name: worksheet_source.and_then(|source| source.name.clone()),
                source_sheet: worksheet_source.and_then(|source| source.sheet.clone()),
                source_range: worksheet_source.and_then(|source| source.r#ref.clone()),
                field_names: parsed_cache
                    .definition
                    .cache_fields
                    .items
                    .iter()
                    .map(|field| field.name.clone())
                    .collect(),
                shared_items: parsed_cache
                    .definition
                    .cache_fields
                    .items
                    .iter()
                    .map(|field| {
                        field
                            .shared_items
                            .as_ref()
                            .map(|shared_items| {
                                shared_items
                                    .items
                                    .iter()
                                    .map(shared_item_to_cell_value)
                                    .collect()
                            })
                            .unwrap_or_default()
                    })
                    .collect(),
            }
        })
        .collect();
    sources.sort_by_key(|source| source.cache_id);
    sources
}

fn shared_item_to_cell_value(item: &ooxml_types::pivot::SharedItem) -> CellValue {
    match item {
        ooxml_types::pivot::SharedItem::Number(value) => FiniteF64::new(*value)
            .map(CellValue::Number)
            .unwrap_or(CellValue::Null),
        ooxml_types::pivot::SharedItem::String(value) => CellValue::Text(value.clone().into()),
        ooxml_types::pivot::SharedItem::Boolean(value) => CellValue::Boolean(*value),
        ooxml_types::pivot::SharedItem::Error(value) => {
            value_types::CellError::parse_error_str(value)
                .map(|error| CellValue::Error(error, None))
                .unwrap_or_else(|| CellValue::Text(value.clone().into()))
        }
        ooxml_types::pivot::SharedItem::DateTime(value) => CellValue::Text(value.clone().into()),
        ooxml_types::pivot::SharedItem::Missing => CellValue::Null,
    }
}
