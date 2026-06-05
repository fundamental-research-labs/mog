//! Pivot cache export reconciliation for imported native pivots.
//!
//! Workbook export owns the orchestration, while this module owns the cache
//! source/source-signature decisions needed to preserve imported caches only
//! while the live native pivot still represents the same source.

use std::collections::{HashMap, HashSet};

use compute_document::schema::{KEY_PIVOT_CACHE_RECORDS, KEY_PIVOT_CACHE_SOURCES};
use domain_types::{
    domain::pivot::{
        ParsedPivotTable, PivotCacheSourceDef, PivotCacheSourceKind, PivotTableConfig,
        PivotTableOoxmlPreservation,
    },
    yrs_schema,
};
use yrs::{Map, Out, Transact};

use crate::storage::engine::stores::EngineStores;
use crate::storage::workbook::imported_pivots::{
    self, ImportedPivotAssociation, ImportedPivotAssociationStatus,
};

const FORKED_PIVOT_CACHE_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x7069766f745f63616368655f666f726b);

pub(super) fn export_pivot_cache_records(
    stores: &EngineStores,
    exported_pivots: &[ParsedPivotTable],
) -> domain_types::yrs_schema::pivot_cache_records::PivotCacheRecords {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let records_map = match workbook.get(&txn, KEY_PIVOT_CACHE_RECORDS) {
        Some(Out::YMap(m)) => m,
        _ => return Default::default(),
    };

    let mut records = yrs_schema::pivot_cache_records::from_yrs_map(&records_map, &txn);
    if let Some(surviving) = surviving_pivot_cache_ids(stores, exported_pivots) {
        records.retain(|cache_id, _| surviving.contains(cache_id));
    }
    records
}

pub(super) fn export_pivot_cache_sources(
    stores: &EngineStores,
    exported_pivots: &[ParsedPivotTable],
) -> Vec<PivotCacheSourceDef> {
    let mut sources = read_pivot_cache_sources(stores);
    if let Some(surviving) = surviving_pivot_cache_ids(stores, exported_pivots) {
        sources.retain(|source| surviving.contains(&source.cache_id));
    }
    let promoted_native_pivot_ids = promoted_native_pivot_ids(stores);
    reconcile_surviving_cache_sources_with_live_pivots(
        &mut sources,
        exported_pivots,
        &promoted_native_pivot_ids,
    );
    append_missing_live_cache_sources(&mut sources, exported_pivots);
    sources
}

pub(super) fn read_pivot_cache_sources(stores: &EngineStores) -> Vec<PivotCacheSourceDef> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let Some(Out::YMap(sources_map)) = workbook.get(&txn, KEY_PIVOT_CACHE_SOURCES) else {
        return Default::default();
    };

    yrs_schema::pivot_cache_records::sources_from_yrs_map(&sources_map, &txn)
}

pub(super) fn reconcile_promoted_import_cache_for_export(
    association: &ImportedPivotAssociation,
    original: &ParsedPivotTable,
    mut live_config: PivotTableConfig,
    cache_sources_by_id: &HashMap<u32, PivotCacheSourceDef>,
) -> (PivotTableConfig, PivotTableOoxmlPreservation) {
    let mut preservation = original.ooxml_preservation.clone();
    let Some(original_cache_id) = original.config.cache_id else {
        return (live_config, preservation);
    };
    let live_signature = live_cache_source_signature(&live_config, &preservation);

    let Some(imported_source) = cache_sources_by_id.get(&original_cache_id) else {
        live_config.cache_id = Some(forked_import_cache_id(
            original_cache_id,
            association.import_identity.as_str(),
            &live_signature,
            cache_sources_by_id,
        ));
        preservation.cache_shared_items.clear();
        return (live_config, preservation);
    };

    if live_config.cache_id == Some(original_cache_id)
        && promoted_import_source_signature_matches(
            association,
            original,
            &live_config,
            imported_source,
        )
    {
        return (live_config, preservation);
    }

    // The live native pivot now represents a different source signature than
    // the imported cache. Assign an explicit deterministic fork id so ParseOutput
    // and XLSX export agree without preserving stale imported rows.
    live_config.cache_id = Some(forked_import_cache_id(
        original_cache_id,
        association.import_identity.as_str(),
        &live_signature,
        cache_sources_by_id,
    ));
    preservation.cache_shared_items.clear();
    (live_config, preservation)
}

fn append_missing_live_cache_sources(
    sources: &mut Vec<PivotCacheSourceDef>,
    exported_pivots: &[ParsedPivotTable],
) {
    let mut seen: HashSet<u32> = sources.iter().map(|source| source.cache_id).collect();
    for pivot in exported_pivots {
        let Some(cache_id) = pivot.config.cache_id else {
            continue;
        };
        if !seen.insert(cache_id) {
            continue;
        }
        let signature = live_cache_source_signature(&pivot.config, &pivot.ooxml_preservation);
        sources.push(PivotCacheSourceDef {
            cache_id,
            workbook_ref_scope: Default::default(),
            source_kind: signature.source_kind,
            source_name: signature.source_name,
            source_sheet: signature.source_sheet,
            source_range: Some(signature.source_range),
            external_worksheet: None,
            field_names: signature.field_names,
            shared_items: pivot.ooxml_preservation.cache_shared_items.clone(),
        });
    }
}

fn reconcile_surviving_cache_sources_with_live_pivots(
    sources: &mut [PivotCacheSourceDef],
    exported_pivots: &[ParsedPivotTable],
    promoted_native_pivot_ids: &HashSet<String>,
) {
    if sources.is_empty() {
        return;
    }

    for source in sources {
        if !matches!(
            source.source_kind,
            PivotCacheSourceKind::LocalWorksheet | PivotCacheSourceKind::LocalTableOrName
        ) {
            continue;
        }
        let signatures: Vec<_> = exported_pivots
            .iter()
            .filter(|pivot| pivot.config.cache_id == Some(source.cache_id))
            .filter(|pivot| promoted_native_pivot_ids.contains(&pivot.config.id))
            .map(|pivot| live_cache_source_signature(&pivot.config, &pivot.ooxml_preservation))
            .collect();

        let survivor_count = exported_pivots
            .iter()
            .filter(|pivot| pivot.config.cache_id == Some(source.cache_id))
            .count();
        if signatures.len() != survivor_count {
            continue;
        }

        let Some(first) = signatures.first() else {
            continue;
        };
        if signatures.iter().all(|signature| signature == first) {
            source.source_kind = first.source_kind;
            source.source_name = first.source_name.clone();
            source.source_sheet = first.source_sheet.clone();
            source.source_range = Some(first.source_range.clone());
            source.field_names = first.field_names.clone();
        }
    }
}

fn promoted_native_pivot_ids(stores: &EngineStores) -> HashSet<String> {
    imported_pivots::read_all(stores.storage.doc(), stores.storage.workbook_map())
        .into_iter()
        .filter(|association| association.status == ImportedPivotAssociationStatus::Promoted)
        .filter_map(|association| association.native_pivot_id)
        .collect()
}

fn surviving_pivot_cache_ids(
    stores: &EngineStores,
    pivots: &[ParsedPivotTable],
) -> Option<HashSet<u32>> {
    if pivots.is_empty() {
        let associations =
            imported_pivots::read_all(stores.storage.doc(), stores.storage.workbook_map());
        if associations.is_empty() {
            return None;
        }
    }
    Some(
        pivots
            .iter()
            .filter_map(|pivot| pivot.config.cache_id)
            .collect(),
    )
}

fn promoted_import_source_signature_matches(
    association: &ImportedPivotAssociation,
    original: &ParsedPivotTable,
    live_config: &PivotTableConfig,
    imported_source: &PivotCacheSourceDef,
) -> bool {
    if !matches!(
        imported_source.source_kind,
        PivotCacheSourceKind::LocalWorksheet | PivotCacheSourceKind::LocalTableOrName
    ) {
        return false;
    }

    if imported_source.source_name.as_deref()
        != original.ooxml_preservation.cache_source_name.as_deref()
    {
        return false;
    }

    if normalize_a1_range(imported_source.source_range.as_deref())
        != Some(source_range_a1(&live_config.source_range))
    {
        return false;
    }

    let live_field_names: Vec<&str> = live_config
        .fields
        .iter()
        .map(|field| field.name.as_str())
        .collect();
    if imported_source
        .field_names
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        != live_field_names
    {
        return false;
    }

    if !field_schema_matches(original, live_config) {
        return false;
    }

    if !original.ooxml_preservation.cache_shared_items.is_empty()
        && imported_source.shared_items != original.ooxml_preservation.cache_shared_items
    {
        return false;
    }

    association
        .source_sheet_id
        .as_deref()
        .zip(live_config.source_sheet_id.as_deref())
        .is_some_and(|(associated, live)| associated == live)
        || imported_source.source_sheet.as_deref() == Some(live_config.source_sheet_name.as_str())
        || original.config.source_sheet_name == live_config.source_sheet_name
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PivotCacheSourceSignature {
    source_kind: PivotCacheSourceKind,
    source_name: Option<String>,
    source_sheet: Option<String>,
    source_range: String,
    field_names: Vec<String>,
}

fn live_cache_source_signature(
    config: &PivotTableConfig,
    preservation: &PivotTableOoxmlPreservation,
) -> PivotCacheSourceSignature {
    PivotCacheSourceSignature {
        source_kind: if preservation.cache_source_name.is_some() {
            PivotCacheSourceKind::LocalTableOrName
        } else {
            PivotCacheSourceKind::LocalWorksheet
        },
        source_name: preservation.cache_source_name.clone(),
        source_sheet: Some(config.source_sheet_name.clone()),
        source_range: source_range_a1(&config.source_range),
        field_names: config
            .fields
            .iter()
            .map(|field| field.name.clone())
            .collect(),
    }
}

fn field_schema_matches(original: &ParsedPivotTable, live_config: &PivotTableConfig) -> bool {
    original.config.fields.len() == live_config.fields.len()
        && original
            .config
            .fields
            .iter()
            .zip(live_config.fields.iter())
            .all(|(original, live)| {
                original.id == live.id
                    && original.name == live.name
                    && original.source_column == live.source_column
                    && original.data_type == live.data_type
            })
}

fn forked_import_cache_id(
    original_cache_id: u32,
    import_identity: &str,
    live_signature: &PivotCacheSourceSignature,
    cache_sources_by_id: &HashMap<u32, PivotCacheSourceDef>,
) -> u32 {
    let key = format!(
        "originalCacheId={original_cache_id};importIdentity={import_identity};{}",
        live_signature.stable_key()
    );
    let uuid = uuid::Uuid::new_v5(&FORKED_PIVOT_CACHE_NAMESPACE, key.as_bytes());
    let mut cache_id = u32::from_le_bytes(uuid.as_bytes()[0..4].try_into().unwrap());
    cache_id = 0x8000_0000 | (cache_id & 0x7fff_ffff);
    while cache_id == 0 || cache_sources_by_id.contains_key(&cache_id) {
        cache_id = cache_id.wrapping_add(1);
        if cache_id == 0 {
            cache_id = 0x8000_0000;
        }
    }
    cache_id
}

impl PivotCacheSourceSignature {
    fn stable_key(&self) -> String {
        format!(
            "sourceKind={:?};sourceName={};sourceSheet={};sourceRange={};fieldNames={}",
            self.source_kind,
            self.source_name.as_deref().unwrap_or_default(),
            self.source_sheet.as_deref().unwrap_or_default(),
            self.source_range,
            self.field_names.join("\u{1f}"),
        )
    }
}

fn normalize_a1_range(range: Option<&str>) -> Option<String> {
    range.map(|range| range.replace('$', ""))
}

fn source_range_a1(range: &domain_types::domain::pivot::CellRange) -> String {
    format!(
        "{}:{}",
        crate::range_manager::pos_to_a1(range.start_row(), range.start_col()),
        crate::range_manager::pos_to_a1(range.end_row(), range.end_col()),
    )
}
