use crate::write::pivot_writer::a1::col_to_letters;
use domain_types::PivotCacheSourceDef;
use domain_types::domain::pivot::ParsedPivotTable;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum CacheIdentity {
    Explicit(u32),
    Source {
        source_name: Option<String>,
        source_sheet_name: String,
        source_range: String,
        field_names: Vec<String>,
    },
}

pub(super) struct AssignedCacheSources {
    pub sources: Vec<PivotCacheSourceDef>,
    pub pivot_cache_ids: Vec<u32>,
}

pub(super) fn assign_cache_sources(
    resolved_pivots: &[(usize, &ParsedPivotTable)],
    live_cache_sources: &[PivotCacheSourceDef],
) -> AssignedCacheSources {
    let mut sources = Vec::new();
    let live_sources_by_id: HashMap<u32, &PivotCacheSourceDef> = live_cache_sources
        .iter()
        .map(|source| (source.cache_id, source))
        .collect();
    let mut seen_cache_identities: HashMap<CacheIdentity, u32> = HashMap::new();
    let mut pivot_cache_ids = Vec::with_capacity(resolved_pivots.len());
    let mut next_generated_cache_id = resolved_pivots
        .iter()
        .filter_map(|(_, pt)| pt.config.cache_id)
        .max()
        .unwrap_or(0)
        .saturating_add(1);

    for (_, pt) in resolved_pivots {
        let config = &pt.config;
        let source_range = format!(
            "{}{}:{}{}",
            col_to_letters(config.source_range.start_col()),
            config.source_range.start_row() + 1,
            col_to_letters(config.source_range.end_col()),
            config.source_range.end_row() + 1,
        );
        let field_names: Vec<String> = config.fields.iter().map(|f| f.name.clone()).collect();
        let identity = match config.cache_id {
            Some(cache_id) => CacheIdentity::Explicit(cache_id),
            None => CacheIdentity::Source {
                source_name: pt.ooxml_preservation.cache_source_name.clone(),
                source_sheet_name: config.source_sheet_name.clone(),
                source_range: source_range.clone(),
                field_names: field_names.clone(),
            },
        };

        let cache_id = if let Some(cache_id) = seen_cache_identities.get(&identity) {
            *cache_id
        } else {
            let cache_id = match config.cache_id {
                Some(cache_id) => cache_id,
                None => {
                    let id = next_generated_cache_id;
                    next_generated_cache_id = next_generated_cache_id.saturating_add(1);
                    id
                }
            };
            seen_cache_identities.insert(identity, cache_id);
            sources.push(
                live_sources_by_id
                    .get(&cache_id)
                    .map(|source| (*source).clone())
                    .unwrap_or(PivotCacheSourceDef {
                        cache_id,
                        workbook_ref_scope: Default::default(),
                        source_kind: if pt.ooxml_preservation.cache_source_name.is_some() {
                            domain_types::domain::pivot::PivotCacheSourceKind::LocalTableOrName
                        } else {
                            domain_types::domain::pivot::PivotCacheSourceKind::LocalWorksheet
                        },
                        source_name: pt.ooxml_preservation.cache_source_name.clone(),
                        source_sheet: Some(config.source_sheet_name.clone()),
                        source_range: Some(source_range),
                        external_worksheet: None,
                        field_names,
                        shared_items: pt.ooxml_preservation.cache_shared_items.clone(),
                    }),
            );
            cache_id
        };
        pivot_cache_ids.push(cache_id);
    }

    AssignedCacheSources {
        sources,
        pivot_cache_ids,
    }
}
