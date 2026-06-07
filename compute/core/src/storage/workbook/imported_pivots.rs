//! Workbook-level imported PivotTable association storage.
//!
//! Imported XLSX pivots have two pieces of state: the OOXML preservation record
//! in `pivotSpecs`, and the editable native pivot config in a sheet's
//! `pivotTables` map. This module owns the durable association between those
//! records so export/delete/reload are identity-driven rather than name-driven.

use std::sync::Arc;

use compute_document::schema::{
    KEY_IMPORTED_PIVOT_ASSOCIATIONS, KEY_NAME, KEY_PIVOT_CACHE_SOURCES, KEY_PIVOT_SPECS,
    KEY_PROPERTIES,
};
use compute_pivot::types::PivotTableResult;
use domain_types::domain::pivot::{
    ParsedPivotTable, PivotCacheSourceDef, PivotCacheSourceKind, PivotFieldArea, PivotTableConfig,
};
use domain_types::yrs_schema;
use serde::{Deserialize, Serialize};
use yrs::{Any, Map, MapRef, Out, Transact};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedPivotAssociationStatus {
    Promoted,
    Unsupported,
    Deleted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedPivotUnsupportedReason {
    MissingImportIdentity,
    UnresolvedOutputSheet,
    UnresolvedSourceSheet,
    FallbackSourceSheet,
    ExternalSource,
    CacheOnlySource,
    InvalidOutputRange,
    FieldCacheMismatch,
    LossyOoxml,
    NativePivotIdCollision,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPivotAssociation {
    pub schema_version: u32,
    pub import_identity: String,
    pub status: ImportedPivotAssociationStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_pivot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_sheet_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet_id: Option<String>,
    pub pivot_spec_key: String,
    pub pivot_spec_order: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_worksheet_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worksheet_relationship_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_id: Option<u32>,
    pub original_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_output_sheet_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_source_sheet_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_ref_range: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<ImportedPivotUnsupportedReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<u64>,
}

pub const IMPORTED_PIVOT_ASSOCIATION_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPivotCapabilities {
    pub can_edit_fields: bool,
    pub can_reorder_fields: bool,
    pub can_remove_fields: bool,
    pub can_change_aggregate: bool,
    pub can_refresh: bool,
    pub can_delete: bool,
    pub can_export: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPivotRenderedRange {
    pub start_row: u32,
    pub start_col: u32,
    pub end_row: u32,
    pub end_col: u32,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub ref_a1: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPivotViewRecord {
    pub source_kind: String,
    pub status: ImportedPivotAssociationStatus,
    pub import_identity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_pivot_id: Option<String>,
    pub output_sheet_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_sheet_id: Option<String>,
    pub config: PivotTableConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<PivotTableResult>,
    pub capabilities: ImportedPivotCapabilities,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_range: Option<ImportedPivotRenderedRange>,
}

pub fn import_identity_for_parsed_pivot(pivot_spec_key: &str, parsed: &ParsedPivotTable) -> String {
    domain_types::domain::pivot::import_identity_for_parsed_pivot(pivot_spec_key, parsed)
}

pub fn native_imported_pivot_id(import_identity: &str) -> String {
    domain_types::domain::pivot::native_imported_pivot_id(import_identity)
}

pub(crate) fn existing_promoted_import_pivot_matches(
    existing: &PivotTableConfig,
    parsed: &ParsedPivotTable,
    source_sheet_id: &cell_types::SheetId,
    output_sheet_id: &cell_types::SheetId,
) -> bool {
    let source_sheet_uuid = source_sheet_id.to_uuid_string();
    let output_sheet_uuid = output_sheet_id.to_uuid_string();
    existing.source_sheet_id.as_deref() == Some(source_sheet_uuid.as_str())
        && existing.output_sheet_id.as_deref() == Some(output_sheet_uuid.as_str())
        && existing.source_range == parsed.config.source_range
        && existing.output_location == parsed.config.output_location
        && existing.ref_range == parsed.config.ref_range
        && existing.cache_id == parsed.config.cache_id
}

pub fn association_from_parsed_pivot(
    pivot_spec_key: String,
    pivot_spec_order: u32,
    parsed: &ParsedPivotTable,
    import_identity: String,
    status: ImportedPivotAssociationStatus,
    native_pivot_id: Option<String>,
    output_sheet_id: Option<String>,
    source_sheet_id: Option<String>,
    unsupported_reason: Option<ImportedPivotUnsupportedReason>,
) -> ImportedPivotAssociation {
    let preservation = &parsed.ooxml_preservation;
    let relationship = preservation.relationship.as_ref();
    ImportedPivotAssociation {
        schema_version: IMPORTED_PIVOT_ASSOCIATION_SCHEMA_VERSION,
        import_identity,
        status,
        native_pivot_id,
        output_sheet_id,
        source_sheet_id,
        pivot_spec_key,
        pivot_spec_order,
        definition_part_path: preservation
            .definition_part_path
            .clone()
            .or_else(|| relationship.and_then(|rel| rel.part_path.clone())),
        output_worksheet_part_path: preservation.output_worksheet_part_path.clone(),
        worksheet_relationship_id: preservation.output_worksheet_relationship_id.clone(),
        cache_id: parsed.config.cache_id,
        original_name: parsed.config.name.clone(),
        original_output_sheet_name: (!parsed.config.output_sheet_name.is_empty())
            .then(|| parsed.config.output_sheet_name.clone()),
        original_source_sheet_name: (!parsed.config.source_sheet_name.is_empty())
            .then(|| parsed.config.source_sheet_name.clone()),
        original_ref_range: parsed.config.ref_range.clone(),
        unsupported_reason,
        deleted_at: None,
    }
}

pub fn read_all(doc: &yrs::Doc, workbook: &MapRef) -> Vec<ImportedPivotAssociation> {
    let txn = doc.transact();
    let Some(Out::YMap(map)) = workbook.get(&txn, KEY_IMPORTED_PIVOT_ASSOCIATIONS) else {
        return Vec::new();
    };
    let mut associations = Vec::new();
    for (_, value) in map.iter(&txn) {
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        match serde_json::from_str::<ImportedPivotAssociation>(&json) {
            Ok(association) => associations.push(association),
            Err(error) => {
                tracing::warn!(
                    error = %error,
                    "Failed to deserialize imported pivot association; skipping"
                );
            }
        }
    }
    associations.sort_by_key(|association| association.pivot_spec_order);
    associations
}

pub fn read_view_records_for_output_sheet(
    doc: &yrs::Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    output_sheet_id: &cell_types::SheetId,
) -> Vec<ImportedPivotViewRecord> {
    let output_sheet_uuid = output_sheet_id.to_uuid_string();
    let pivot_specs: std::collections::HashMap<String, ParsedPivotTable> =
        read_pivot_specs(doc, workbook)
            .into_iter()
            .map(|(key, _, parsed)| (key, parsed))
            .collect();
    let mut records = Vec::new();

    for association in read_all(doc, workbook) {
        if association.status == ImportedPivotAssociationStatus::Deleted
            || association.output_sheet_id.as_deref() != Some(output_sheet_uuid.as_str())
        {
            continue;
        }

        match association.status {
            ImportedPivotAssociationStatus::Promoted => {
                let Some(native_pivot_id) = association.native_pivot_id.as_deref() else {
                    continue;
                };
                let Some(config) = crate::storage::sheet::pivots::get_pivot(
                    doc,
                    sheets,
                    output_sheet_id,
                    native_pivot_id,
                ) else {
                    continue;
                };
                let config = normalize_view_config(config, &association, &output_sheet_uuid);
                records.push(ImportedPivotViewRecord {
                    source_kind: "promotedImport".to_string(),
                    status: association.status,
                    import_identity: association.import_identity,
                    native_pivot_id: Some(native_pivot_id.to_string()),
                    output_sheet_id: output_sheet_uuid.clone(),
                    source_sheet_id: config.source_sheet_id.clone(),
                    rendered_range: rendered_range_for_config(&config),
                    config,
                    result: None,
                    capabilities: editable_capabilities(),
                    unsupported_reason: None,
                });
            }
            ImportedPivotAssociationStatus::Unsupported => {
                let Some(parsed) = pivot_specs.get(&association.pivot_spec_key) else {
                    continue;
                };
                let reason = association
                    .unsupported_reason
                    .map(unsupported_reason_wire_value);
                let mut config = parsed.config.clone();
                config.id = native_imported_pivot_id(&association.import_identity);
                config.output_sheet_id = Some(output_sheet_uuid.clone());
                if let Some(source_sheet_id) = association.source_sheet_id.clone() {
                    config.source_sheet_id = Some(source_sheet_id);
                }
                let config = normalize_view_config(config, &association, &output_sheet_uuid);
                records.push(ImportedPivotViewRecord {
                    source_kind: "unsupportedImport".to_string(),
                    status: association.status,
                    import_identity: association.import_identity,
                    native_pivot_id: None,
                    output_sheet_id: output_sheet_uuid.clone(),
                    source_sheet_id: config.source_sheet_id.clone(),
                    rendered_range: rendered_range_for_config(&config),
                    config,
                    result: None,
                    capabilities: unsupported_capabilities(reason.clone()),
                    unsupported_reason: reason,
                });
            }
            ImportedPivotAssociationStatus::Deleted => {}
        }
    }

    records
}

pub fn write(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    association: &ImportedPivotAssociation,
) {
    let map =
        crate::storage::ensure_workbook_child_map(workbook, txn, KEY_IMPORTED_PIVOT_ASSOCIATIONS);
    let json = serde_json::to_string(association)
        .expect("ImportedPivotAssociation serialization should not fail");
    map.insert(
        txn,
        association.import_identity.as_str(),
        Any::String(Arc::from(json.as_str())),
    );
}

pub fn find_by_native_pivot_id(
    doc: &yrs::Doc,
    workbook: &MapRef,
    native_pivot_id: &str,
) -> Option<ImportedPivotAssociation> {
    let txn = doc.transact();
    find_by_native_pivot_id_in_txn(&txn, workbook, native_pivot_id)
}

pub fn find_by_native_pivot_id_in_txn<T: yrs::ReadTxn>(
    txn: &T,
    workbook: &MapRef,
    native_pivot_id: &str,
) -> Option<ImportedPivotAssociation> {
    let Some(Out::YMap(map)) = workbook.get(txn, KEY_IMPORTED_PIVOT_ASSOCIATIONS) else {
        return None;
    };
    for (_, value) in map.iter(txn) {
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        let Ok(association) = serde_json::from_str::<ImportedPivotAssociation>(&json) else {
            continue;
        };
        if association.native_pivot_id.as_deref() == Some(native_pivot_id)
            && association.status != ImportedPivotAssociationStatus::Deleted
        {
            return Some(association);
        }
    }
    None
}

pub fn mark_native_pivot_deleted(doc: &yrs::Doc, workbook: &MapRef, native_pivot_id: &str) -> bool {
    let mut txn =
        doc.transact_mut_with(yrs::Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
    mark_native_pivot_deleted_in_txn(&mut txn, workbook, native_pivot_id)
}

pub fn mark_native_pivot_deleted_in_txn(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    native_pivot_id: &str,
) -> bool {
    let Some(mut association) = find_by_native_pivot_id_in_txn(txn, workbook, native_pivot_id)
    else {
        return false;
    };
    association.status = ImportedPivotAssociationStatus::Deleted;
    association.deleted_at = Some(crate::storage::infra::yrs_helpers::now_millis());
    write(txn, workbook, &association);
    true
}

pub fn update_output_sheet_name_for_sheet(
    doc: &yrs::Doc,
    sheets: &MapRef,
    sheet_id: &cell_types::SheetId,
    new_name: &str,
) {
    let sheet_uuid = sheet_id.to_uuid_string();
    let mut configs = crate::storage::sheet::pivots::get_all_pivots(doc, sheets, sheet_id);
    for config in &mut configs {
        if config.output_sheet_id.as_deref() == Some(sheet_uuid.as_str())
            || config.output_sheet_id.is_none()
        {
            config.output_sheet_id = Some(sheet_uuid.clone());
            config.output_sheet_name = new_name.to_string();
            let _ = crate::storage::sheet::pivots::update_pivot(
                doc,
                sheets,
                sheet_id,
                &config.id,
                config.clone(),
            );
        }
    }
}

pub fn update_source_sheet_name_for_sheet(
    doc: &yrs::Doc,
    sheets: &MapRef,
    sheet_id: &cell_types::SheetId,
    new_name: &str,
) {
    let sheet_uuid = sheet_id.to_uuid_string();
    let target_sheet_ids: Vec<cell_types::SheetId> = {
        let txn = doc.transact();
        sheets
            .iter(&txn)
            .filter_map(|(key, _)| {
                compute_document::hex::hex_to_id(key).map(cell_types::SheetId::from_raw)
            })
            .collect()
    };

    for output_sheet_id in target_sheet_ids {
        let mut configs =
            crate::storage::sheet::pivots::get_all_pivots(doc, sheets, &output_sheet_id);
        for config in &mut configs {
            if config.source_sheet_id.as_deref() == Some(sheet_uuid.as_str()) {
                config.source_sheet_name = new_name.to_string();
                let _ = crate::storage::sheet::pivots::update_pivot(
                    doc,
                    sheets,
                    &output_sheet_id,
                    &config.id,
                    config.clone(),
                );
            }
        }
    }
}

pub fn mark_output_sheet_deleted(
    doc: &yrs::Doc,
    workbook: &MapRef,
    output_sheet_id: &cell_types::SheetId,
) {
    let output_sheet_uuid = output_sheet_id.to_uuid_string();
    let mut associations = read_all(doc, workbook);
    let mut txn =
        doc.transact_mut_with(yrs::Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
    for association in &mut associations {
        if association.output_sheet_id.as_deref() == Some(output_sheet_uuid.as_str())
            && association.status != ImportedPivotAssociationStatus::Deleted
        {
            association.status = ImportedPivotAssociationStatus::Deleted;
            association.deleted_at = Some(crate::storage::infra::yrs_helpers::now_millis());
            write(&mut txn, workbook, association);
        }
    }
}

pub fn mark_source_sheet_deleted(
    doc: &yrs::Doc,
    workbook: &MapRef,
    sheets: &MapRef,
    source_sheet_id: &cell_types::SheetId,
) {
    let source_sheet_uuid = source_sheet_id.to_uuid_string();
    let mut associations = read_all(doc, workbook);
    let native_deletes: Vec<(cell_types::SheetId, String)> = associations
        .iter()
        .filter(|association| {
            association.source_sheet_id.as_deref() == Some(source_sheet_uuid.as_str())
                && association.status != ImportedPivotAssociationStatus::Deleted
        })
        .filter_map(|association| {
            let output_sheet_id =
                cell_types::SheetId::from_uuid_str(association.output_sheet_id.as_deref()?).ok()?;
            let native_pivot_id = association.native_pivot_id.clone()?;
            Some((output_sheet_id, native_pivot_id))
        })
        .collect();
    for (output_sheet_id, native_pivot_id) in native_deletes {
        let _ = crate::storage::sheet::pivots::delete_pivot(
            doc,
            sheets,
            &output_sheet_id,
            native_pivot_id.as_str(),
        );
    }

    let mut txn =
        doc.transact_mut_with(yrs::Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
    for association in &mut associations {
        if association.source_sheet_id.as_deref() == Some(source_sheet_uuid.as_str())
            && association.status != ImportedPivotAssociationStatus::Deleted
        {
            association.status = ImportedPivotAssociationStatus::Unsupported;
            association.native_pivot_id = None;
            association.unsupported_reason =
                Some(ImportedPivotUnsupportedReason::UnresolvedSourceSheet);
            write(&mut txn, workbook, association);
        }
    }
}

pub fn normalize_config_output_identity(
    mut config: PivotTableConfig,
    output_sheet_id: &cell_types::SheetId,
    output_sheet_name: &str,
) -> PivotTableConfig {
    config.output_sheet_id = Some(output_sheet_id.to_uuid_string());
    config.output_sheet_name = output_sheet_name.to_string();
    config
}

pub fn normalize_imported_pivot_associations(
    doc: &yrs::Doc,
    workbook: &MapRef,
    sheets: &MapRef,
) -> Result<(), value_types::ComputeError> {
    let specs = read_pivot_specs(doc, workbook);
    if specs.is_empty() {
        return Ok(());
    }

    let existing: std::collections::HashMap<String, ImportedPivotAssociation> =
        read_all(doc, workbook)
            .into_iter()
            .map(|association| (association.import_identity.clone(), association))
            .collect();
    let sheet_ids_by_name = sheet_ids_by_name(doc, sheets);
    let pivot_cache_sources = read_pivot_cache_sources_by_id(doc, workbook);

    let mut txn = doc.transact_mut_with(yrs::Origin::from("system:imported-pivot-normalization"));
    for (pivot_spec_key, pivot_spec_order, parsed) in specs {
        let import_identity = import_identity_for_parsed_pivot(&pivot_spec_key, &parsed);
        if let Some(association) = existing.get(&import_identity) {
            if association.status == ImportedPivotAssociationStatus::Promoted {
                if let (Some(native_pivot_id), Some(output_sheet_id)) = (
                    association.native_pivot_id.as_deref(),
                    association.output_sheet_id.as_deref(),
                ) {
                    if let Ok(output_sheet_id) = cell_types::SheetId::from_uuid_str(output_sheet_id)
                    {
                        if crate::storage::sheet::pivots::get_pivot_in_txn(
                            &txn,
                            sheets,
                            &output_sheet_id,
                            native_pivot_id,
                        )
                        .is_none()
                        {
                            tracing::warn!(
                                import_identity = association.import_identity.as_str(),
                                native_pivot_id,
                                "Promoted imported pivot association references a missing native pivot; \
                                 saved-state normalization will not recreate it from pivotSpecs",
                            );
                        }
                    }
                }
            }
            continue;
        }

        let classification = classify_imported_pivot_for_normalization(
            &parsed,
            import_identity.as_str(),
            parsed
                .config
                .cache_id
                .and_then(|cache_id| pivot_cache_sources.get(&cache_id)),
            &sheet_ids_by_name,
        );

        if let ImportedPivotNormalizationClassification::Promotable {
            source_sheet_id,
            output_sheet_id,
        } = classification
        {
            let native_pivot_id = native_imported_pivot_id(&import_identity);
            let mut config = parsed.config.clone();
            config.id = native_pivot_id.clone();
            config.source_sheet_id = Some(source_sheet_id.to_uuid_string());
            config.output_sheet_id = Some(output_sheet_id.to_uuid_string());
            let inserted = crate::storage::sheet::pivots::insert_existing_pivot_if_absent_in_txn(
                &mut txn,
                sheets,
                &output_sheet_id,
                config,
            )?;
            let existing_matches_import = inserted
                || crate::storage::sheet::pivots::get_pivot_in_txn(
                    &txn,
                    sheets,
                    &output_sheet_id,
                    native_pivot_id.as_str(),
                )
                .as_ref()
                .is_some_and(|existing| {
                    existing_promoted_import_pivot_matches(
                        existing,
                        &parsed,
                        &source_sheet_id,
                        &output_sheet_id,
                    )
                });

            let association = if existing_matches_import {
                association_from_parsed_pivot(
                    pivot_spec_key,
                    pivot_spec_order,
                    &parsed,
                    import_identity,
                    ImportedPivotAssociationStatus::Promoted,
                    Some(native_pivot_id),
                    Some(output_sheet_id.to_uuid_string()),
                    Some(source_sheet_id.to_uuid_string()),
                    None,
                )
            } else {
                tracing::warn!(
                    import_identity = import_identity.as_str(),
                    native_pivot_id = native_pivot_id.as_str(),
                    "Imported pivot normalization skipped promotion because deterministic native pivot ID is already occupied",
                );
                association_from_parsed_pivot(
                    pivot_spec_key,
                    pivot_spec_order,
                    &parsed,
                    import_identity,
                    ImportedPivotAssociationStatus::Unsupported,
                    None,
                    Some(output_sheet_id.to_uuid_string()),
                    Some(source_sheet_id.to_uuid_string()),
                    Some(ImportedPivotUnsupportedReason::NativePivotIdCollision),
                )
            };
            write(&mut txn, workbook, &association);
        } else if let ImportedPivotNormalizationClassification::Unsupported(unsupported_reason) =
            classification
        {
            let source_sheet_id = sheet_ids_by_name
                .get(parsed.config.source_sheet_name.as_str())
                .copied();
            let output_sheet_id = sheet_ids_by_name
                .get(parsed.config.output_sheet_name.as_str())
                .copied();
            let association = association_from_parsed_pivot(
                pivot_spec_key,
                pivot_spec_order,
                &parsed,
                import_identity,
                ImportedPivotAssociationStatus::Unsupported,
                None,
                output_sheet_id.map(|sheet_id| sheet_id.to_uuid_string()),
                source_sheet_id.map(|sheet_id| sheet_id.to_uuid_string()),
                Some(unsupported_reason),
            );
            write(&mut txn, workbook, &association);
        }
    }

    Ok(())
}

fn read_pivot_specs(doc: &yrs::Doc, workbook: &MapRef) -> Vec<(String, u32, ParsedPivotTable)> {
    let txn = doc.transact();
    let Some(Out::YMap(map)) = workbook.get(&txn, KEY_PIVOT_SPECS) else {
        return Vec::new();
    };
    let mut entries: Vec<_> = map.iter(&txn).collect();
    entries.sort_by(|(left, _), (right, _)| {
        pivot_spec_order_key(left).cmp(&pivot_spec_order_key(right))
    });

    entries
        .into_iter()
        .filter_map(|(key, value)| {
            let Out::Any(Any::String(json)) = value else {
                return None;
            };
            let parsed = serde_json::from_str::<ParsedPivotTable>(&json).ok()?;
            let order = pivot_spec_order_key(key).0;
            Some((key.to_string(), order, parsed))
        })
        .collect()
}

fn read_pivot_cache_sources_by_id(
    doc: &yrs::Doc,
    workbook: &MapRef,
) -> std::collections::HashMap<u32, PivotCacheSourceDef> {
    let txn = doc.transact();
    let Some(Out::YMap(map)) = workbook.get(&txn, KEY_PIVOT_CACHE_SOURCES) else {
        return Default::default();
    };
    yrs_schema::pivot_cache_records::sources_from_yrs_map(&map, &txn)
        .into_iter()
        .map(|source| (source.cache_id, source))
        .collect()
}

fn pivot_spec_order_key(key: &str) -> (u32, &str) {
    key.rsplit_once('_')
        .and_then(|(prefix, suffix)| suffix.parse::<u32>().ok().map(|idx| (idx, prefix)))
        .unwrap_or((u32::MAX, key))
}

fn normalize_view_config(
    mut config: PivotTableConfig,
    association: &ImportedPivotAssociation,
    output_sheet_uuid: &str,
) -> PivotTableConfig {
    config.output_sheet_id = Some(output_sheet_uuid.to_string());
    if let Some(source_sheet_id) = association.source_sheet_id.as_deref() {
        config.source_sheet_id = Some(source_sheet_id.to_string());
    }
    config
}

fn editable_capabilities() -> ImportedPivotCapabilities {
    ImportedPivotCapabilities {
        can_edit_fields: true,
        can_reorder_fields: true,
        can_remove_fields: true,
        can_change_aggregate: true,
        can_refresh: true,
        can_delete: true,
        can_export: true,
        unsupported_reason: None,
    }
}

fn unsupported_capabilities(reason: Option<String>) -> ImportedPivotCapabilities {
    ImportedPivotCapabilities {
        can_edit_fields: false,
        can_reorder_fields: false,
        can_remove_fields: false,
        can_change_aggregate: false,
        can_refresh: false,
        can_delete: false,
        can_export: true,
        unsupported_reason: reason,
    }
}

fn unsupported_reason_wire_value(reason: ImportedPivotUnsupportedReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("{reason:?}"))
}

fn rendered_range_for_config(config: &PivotTableConfig) -> Option<ImportedPivotRenderedRange> {
    if let Some(ref_range) = config.ref_range.as_deref() {
        if let Some((start_row, start_col, end_row, end_col)) =
            crate::import::phantom::parse_range_ref(ref_range)
        {
            return Some(ImportedPivotRenderedRange {
                start_row,
                start_col,
                end_row,
                end_col,
                ref_a1: Some(ref_range.to_string()),
            });
        }
    }

    Some(ImportedPivotRenderedRange {
        start_row: config.output_location.row,
        start_col: config.output_location.col,
        end_row: config.output_location.row,
        end_col: config.output_location.col,
        ref_a1: None,
    })
}

fn sheet_ids_by_name(
    doc: &yrs::Doc,
    sheets: &MapRef,
) -> std::collections::HashMap<String, cell_types::SheetId> {
    let txn = doc.transact();
    let mut result = std::collections::HashMap::new();
    for (sheet_hex, value) in sheets.iter(&txn) {
        let Out::YMap(sheet_map) = value else {
            continue;
        };
        let Some(sheet_id) =
            compute_document::hex::hex_to_id(sheet_hex).map(cell_types::SheetId::from_raw)
        else {
            continue;
        };
        let Some(Out::YMap(properties)) = sheet_map.get(&txn, KEY_PROPERTIES) else {
            continue;
        };
        let Some(Out::Any(Any::String(name))) = properties.get(&txn, KEY_NAME) else {
            continue;
        };
        result.insert(name.to_string(), sheet_id);
    }
    result
}

enum ImportedPivotNormalizationClassification {
    Promotable {
        source_sheet_id: cell_types::SheetId,
        output_sheet_id: cell_types::SheetId,
    },
    Unsupported(ImportedPivotUnsupportedReason),
}

fn classify_imported_pivot_for_normalization(
    parsed: &ParsedPivotTable,
    import_identity: &str,
    cache_source: Option<&PivotCacheSourceDef>,
    sheet_ids_by_name: &std::collections::HashMap<String, cell_types::SheetId>,
) -> ImportedPivotNormalizationClassification {
    if !is_canonical_import_identity(import_identity) {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::MissingImportIdentity,
        );
    }

    if let Some(reason) = unsupported_cache_source_reason(cache_source) {
        return ImportedPivotNormalizationClassification::Unsupported(reason);
    }

    let source_sheet_name = parsed.config.source_sheet_name.as_str();
    if source_sheet_name.is_empty() || source_sheet_name == "xlsx-source-sheet" {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::FallbackSourceSheet,
        );
    }

    if !source_range_metadata_is_valid(parsed, cache_source)
        || !output_range_metadata_is_valid(parsed)
    {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::InvalidOutputRange,
        );
    }

    if fields_or_placements_have_unstable_identity(parsed, cache_source) {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::FieldCacheMismatch,
        );
    }

    if has_lossy_ooxml_preservation(parsed) {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::LossyOoxml,
        );
    }

    let Some(source_sheet_id) = sheet_ids_by_name.get(source_sheet_name).copied() else {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::UnresolvedSourceSheet,
        );
    };
    let Some(output_sheet_id) = sheet_ids_by_name
        .get(parsed.config.output_sheet_name.as_str())
        .copied()
    else {
        return ImportedPivotNormalizationClassification::Unsupported(
            ImportedPivotUnsupportedReason::UnresolvedOutputSheet,
        );
    };

    ImportedPivotNormalizationClassification::Promotable {
        source_sheet_id,
        output_sheet_id,
    }
}

fn is_canonical_import_identity(import_identity: &str) -> bool {
    import_identity.starts_with("ooxml:")
}

fn unsupported_cache_source_reason(
    cache_source: Option<&PivotCacheSourceDef>,
) -> Option<ImportedPivotUnsupportedReason> {
    let Some(cache_source) = cache_source else {
        return Some(ImportedPivotUnsupportedReason::CacheOnlySource);
    };

    match cache_source.source_kind {
        PivotCacheSourceKind::LocalWorksheet | PivotCacheSourceKind::LocalTableOrName => {
            if cache_source
                .source_sheet
                .as_deref()
                .is_none_or(str::is_empty)
                || cache_source
                    .source_range
                    .as_deref()
                    .is_none_or(str::is_empty)
            {
                Some(ImportedPivotUnsupportedReason::CacheOnlySource)
            } else {
                None
            }
        }
        PivotCacheSourceKind::ExternalWorksheet | PivotCacheSourceKind::WorkbookConnection => {
            Some(ImportedPivotUnsupportedReason::ExternalSource)
        }
        PivotCacheSourceKind::Consolidation
        | PivotCacheSourceKind::Scenario
        | PivotCacheSourceKind::UnknownImported => {
            Some(ImportedPivotUnsupportedReason::CacheOnlySource)
        }
    }
}

fn source_range_metadata_is_valid(
    parsed: &ParsedPivotTable,
    cache_source: Option<&PivotCacheSourceDef>,
) -> bool {
    let Some(source_ref) = cache_source.and_then(|source| source.source_range.as_deref()) else {
        return false;
    };
    if crate::import::phantom::parse_range_ref(source_ref).is_none() {
        return false;
    }

    parsed.config.source_range.row_count() > 0 && parsed.config.source_range.col_count() > 0
}

fn output_range_metadata_is_valid(parsed: &ParsedPivotTable) -> bool {
    let Some(ref_range) = parsed.config.ref_range.as_deref() else {
        return false;
    };
    let Some((start_row, start_col, _end_row, _end_col)) =
        crate::import::phantom::parse_range_ref(ref_range)
    else {
        return false;
    };

    parsed.config.output_location.row == start_row && parsed.config.output_location.col == start_col
}

fn fields_or_placements_have_unstable_identity(
    parsed: &ParsedPivotTable,
    cache_source: Option<&PivotCacheSourceDef>,
) -> bool {
    let config = &parsed.config;
    let Some(cache_source) = cache_source else {
        return true;
    };
    if config.fields.is_empty() || config.fields.len() != cache_source.field_names.len() {
        return true;
    }

    let mut field_ids = std::collections::HashSet::new();
    let mut source_columns = std::collections::HashSet::new();
    for field in &config.fields {
        if field.id.as_str().is_empty()
            || !field_ids.insert(field.id.as_str())
            || !source_columns.insert(field.source_column)
            || field.source_column as usize >= cache_source.field_names.len()
        {
            return true;
        }
        if cache_source.field_names[field.source_column as usize] != field.name {
            return true;
        }
    }

    if config.placements.is_empty() {
        return true;
    }

    let mut placement_ids = std::collections::HashSet::new();
    let mut positions_by_area: [Vec<usize>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    for placement in &config.placements {
        if placement.placement_id.as_str().is_empty()
            || !placement_ids.insert(placement.placement_id.as_str())
            || !field_ids.contains(placement.field_id.as_str())
        {
            return true;
        }
        let Some(area_index) = placement_area_index(placement.area) else {
            return true;
        };
        positions_by_area[area_index].push(placement.position);
    }

    positions_by_area.iter_mut().any(|positions| {
        positions.sort_unstable();
        positions
            .iter()
            .copied()
            .enumerate()
            .any(|(expected, actual)| expected != actual)
    })
}

fn placement_area_index(area: PivotFieldArea) -> Option<usize> {
    match area {
        PivotFieldArea::Row => Some(0),
        PivotFieldArea::Column => Some(1),
        PivotFieldArea::Value => Some(2),
        PivotFieldArea::Filter => Some(3),
        _ => None,
    }
}

fn has_lossy_ooxml_preservation(parsed: &ParsedPivotTable) -> bool {
    let preservation = &parsed.ooxml_preservation;
    if preservation
        .root_attributes
        .iter()
        .any(|attr| imported_pivot_root_attribute_is_lossy(parsed, attr))
        || !preservation.children.is_empty()
        || preservation.fields.iter().any(|field| {
            !field.attributes.is_empty()
                || !field.children.is_empty()
                || field.item_attributes.iter().any(|attrs| !attrs.is_empty())
        })
        || preservation
            .row_item_attributes
            .iter()
            .any(|attrs| !attrs.is_empty())
        || preservation
            .col_item_attributes
            .iter()
            .any(|attrs| !attrs.is_empty())
    {
        return true;
    }

    preservation
        .relationship
        .as_ref()
        .and_then(|relationship| relationship.consistency.as_deref())
        .is_some_and(|consistency| consistency != "relationshipDiscovered")
}

fn imported_pivot_root_attribute_is_lossy(
    parsed: &ParsedPivotTable,
    attr: &domain_types::domain::pivot::PivotRawXmlAttribute,
) -> bool {
    let local_name = attr
        .name
        .rsplit_once(':')
        .map(|(_, local_name)| local_name)
        .unwrap_or(attr.name.as_str());
    match local_name {
        "dataCaption" => attr.value != modeled_data_caption(parsed),
        _ => true,
    }
}

fn modeled_data_caption(parsed: &ParsedPivotTable) -> &str {
    parsed
        .config
        .layout
        .as_ref()
        .and_then(|layout| layout.data_caption.as_deref())
        .unwrap_or("Values")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::storage::YrsStorage;
    use domain_types::domain::analytics::{AggregateFunction, DetectedDataType};
    use domain_types::domain::pivot::{
        CellRange, FieldId, OutputLocation, ParsedPivotTable, PivotField, PivotFieldPlacementFlat,
        PivotTableOoxmlPreservation, PivotTableRelationshipPreservation, PlacementId,
    };
    use std::sync::Arc;
    use yrs::Map;

    fn parsed_pivot() -> ParsedPivotTable {
        ParsedPivotTable {
            config: PivotTableConfig {
                schema_version: 1,
                id: "temporary-parser-id".to_string(),
                name: "Pivot".to_string(),
                source_sheet_id: None,
                source_sheet_name: "Data".to_string(),
                source_range: CellRange::new(0, 0, 2, 1),
                output_sheet_id: None,
                output_sheet_name: "PivotSheet".to_string(),
                output_location: OutputLocation { row: 0, col: 0 },
                fields: Vec::new(),
                placements: Vec::new(),
                filters: Vec::new(),
                layout: None,
                style: None,
                data_options: None,
                created_at: None,
                updated_at: None,
                calculated_fields: None,
                allow_multiple_filters_per_field: None,
                auto_format: None,
                preserve_formatting: None,
                cache_id: Some(4),
                data_on_rows: None,
                ref_range: Some("A1:C5".to_string()),
                first_data_row: None,
                first_header_row: None,
                first_data_col: None,
                rows_per_page: None,
                cols_per_page: None,
                row_items: Vec::new(),
                col_items: Vec::new(),
            },
            initial_expansion_state: None,
            ooxml_preservation: PivotTableOoxmlPreservation {
                output_worksheet_part_path: Some("xl/worksheets/sheet2.xml".to_string()),
                output_worksheet_relationship_id: Some("rId3".to_string()),
                definition_part_path: Some("xl/pivotTables/pivotTable1.xml".to_string()),
                relationship: Some(PivotTableRelationshipPreservation {
                    relationship_id: Some("rId1".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        }
    }

    fn promotable_parsed_pivot() -> ParsedPivotTable {
        let mut parsed = parsed_pivot();
        parsed.config.fields = vec![
            PivotField {
                id: FieldId::from("Category"),
                name: "Category".to_string(),
                source_column: 0,
                data_type: DetectedDataType::String,
                ..Default::default()
            },
            PivotField {
                id: FieldId::from("Amount"),
                name: "Amount".to_string(),
                source_column: 1,
                data_type: DetectedDataType::Number,
                ..Default::default()
            },
        ];
        parsed.config.placements = vec![
            PivotFieldPlacementFlat {
                placement_id: PlacementId::from("row:Category:0"),
                field_id: FieldId::from("Category"),
                calculated_field_id: None,
                area: PivotFieldArea::Row,
                position: 0,
                aggregate_function: None,
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
                display_name: None,
                number_format: None,
                show_values_as: None,
            },
            PivotFieldPlacementFlat {
                placement_id: PlacementId::from("value:Amount:0"),
                field_id: FieldId::from("Amount"),
                calculated_field_id: None,
                area: PivotFieldArea::Value,
                position: 0,
                aggregate_function: Some(AggregateFunction::Sum),
                sort_order: None,
                custom_sort_list: None,
                sort_by_value: None,
                date_grouping: None,
                number_grouping: None,
                show_subtotals: None,
                display_name: None,
                number_format: None,
                show_values_as: None,
            },
        ];
        parsed
    }

    fn storage_with_pivot_sheets() -> (YrsStorage, cell_types::SheetId, cell_types::SheetId) {
        let mut storage = YrsStorage::new();
        let mut mirror = CellMirror::new();
        let source_sheet_id = cell_types::SheetId::from_raw(1);
        let output_sheet_id = cell_types::SheetId::from_raw(2);
        storage
            .add_sheet(&mut mirror, source_sheet_id, "Data", 100, 26)
            .expect("add source sheet");
        storage
            .add_sheet(&mut mirror, output_sheet_id, "PivotSheet", 100, 26)
            .expect("add output sheet");
        (storage, source_sheet_id, output_sheet_id)
    }

    fn write_pivot_spec(storage: &YrsStorage, key: &str, parsed: &ParsedPivotTable) {
        let json = serde_json::to_string(parsed).expect("serialize parsed pivot");
        let mut txn = storage.doc().transact_mut();
        let map = crate::storage::ensure_workbook_child_map(
            storage.workbook_map(),
            &mut txn,
            KEY_PIVOT_SPECS,
        );
        map.insert(&mut txn, key, Any::String(Arc::from(json.as_str())));
    }

    fn write_pivot_cache_sources(storage: &YrsStorage, sources: &[PivotCacheSourceDef]) {
        let mut txn = storage.doc().transact_mut();
        let map = crate::storage::ensure_workbook_child_map(
            storage.workbook_map(),
            &mut txn,
            KEY_PIVOT_CACHE_SOURCES,
        );
        for (key, value) in yrs_schema::pivot_cache_records::sources_to_yrs_prelim(sources) {
            map.insert(&mut txn, key.as_str(), value);
        }
    }

    fn local_cache_source() -> PivotCacheSourceDef {
        PivotCacheSourceDef {
            cache_id: 4,
            source_kind: PivotCacheSourceKind::LocalWorksheet,
            source_sheet: Some("Data".to_string()),
            source_range: Some("A1:B3".to_string()),
            field_names: vec!["Category".to_string(), "Amount".to_string()],
            ..Default::default()
        }
    }

    #[test]
    fn identity_and_native_id_are_stable_and_name_independent() {
        let parsed = parsed_pivot();
        let identity = import_identity_for_parsed_pivot("Pivot_0", &parsed);
        let id = native_imported_pivot_id(&identity);

        let mut renamed = parsed.clone();
        renamed.config.name = "Renamed".to_string();
        assert_eq!(
            identity,
            import_identity_for_parsed_pivot("Pivot_0", &renamed)
        );
        assert_eq!(id, native_imported_pivot_id(&identity));
        assert!(id.starts_with("pivot-imported-"));
    }

    #[test]
    fn promoted_view_record_uses_live_native_config_and_editable_capabilities() {
        let (storage, source_sheet_id, output_sheet_id) = storage_with_pivot_sheets();
        let parsed = parsed_pivot();
        write_pivot_spec(&storage, "Pivot_0", &parsed);

        let import_identity = import_identity_for_parsed_pivot("Pivot_0", &parsed);
        let native_pivot_id = native_imported_pivot_id(&import_identity);
        let mut native_config = parsed.config.clone();
        native_config.id = native_pivot_id.clone();
        native_config.name = "Renamed in Mog".to_string();
        native_config.source_sheet_id = Some(source_sheet_id.to_uuid_string());
        native_config.output_sheet_id = Some(output_sheet_id.to_uuid_string());

        let association = association_from_parsed_pivot(
            "Pivot_0".to_string(),
            0,
            &parsed,
            import_identity.clone(),
            ImportedPivotAssociationStatus::Promoted,
            Some(native_pivot_id.clone()),
            Some(output_sheet_id.to_uuid_string()),
            Some(source_sheet_id.to_uuid_string()),
            None,
        );

        {
            let mut txn = storage.doc().transact_mut();
            crate::storage::sheet::pivots::insert_existing_pivot_if_absent_in_txn(
                &mut txn,
                storage.sheets(),
                &output_sheet_id,
                native_config,
            )
            .expect("insert native pivot");
            write(&mut txn, storage.workbook_map(), &association);
        }

        let records = read_view_records_for_output_sheet(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &output_sheet_id,
        );

        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.source_kind, "promotedImport");
        assert_eq!(record.status, ImportedPivotAssociationStatus::Promoted);
        assert_eq!(record.import_identity, import_identity);
        assert_eq!(
            record.native_pivot_id.as_deref(),
            Some(native_pivot_id.as_str())
        );
        assert_eq!(record.config.name, "Renamed in Mog");
        assert!(record.capabilities.can_edit_fields);
        assert!(record.capabilities.can_refresh);
        assert!(record.unsupported_reason.is_none());
        let range = record.rendered_range.as_ref().expect("rendered range");
        assert_eq!(
            (
                range.start_row,
                range.start_col,
                range.end_row,
                range.end_col
            ),
            (0, 0, 4, 2)
        );
    }

    #[test]
    fn unsupported_view_record_uses_preserved_spec_and_read_only_capabilities() {
        let (storage, _source_sheet_id, output_sheet_id) = storage_with_pivot_sheets();
        let mut parsed = parsed_pivot();
        parsed.config.source_sheet_name = "xlsx-source-sheet".to_string();
        write_pivot_spec(&storage, "Pivot_0", &parsed);

        let import_identity = import_identity_for_parsed_pivot("Pivot_0", &parsed);
        let association = association_from_parsed_pivot(
            "Pivot_0".to_string(),
            0,
            &parsed,
            import_identity.clone(),
            ImportedPivotAssociationStatus::Unsupported,
            None,
            Some(output_sheet_id.to_uuid_string()),
            None,
            Some(ImportedPivotUnsupportedReason::FallbackSourceSheet),
        );

        {
            let mut txn = storage.doc().transact_mut();
            write(&mut txn, storage.workbook_map(), &association);
        }

        let records = read_view_records_for_output_sheet(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
            &output_sheet_id,
        );

        assert_eq!(records.len(), 1);
        let record = &records[0];
        assert_eq!(record.source_kind, "unsupportedImport");
        assert_eq!(record.status, ImportedPivotAssociationStatus::Unsupported);
        assert_eq!(record.import_identity, import_identity);
        assert_eq!(record.native_pivot_id, None);
        assert_eq!(
            record.config.id,
            native_imported_pivot_id(&record.import_identity)
        );
        assert_eq!(
            record.unsupported_reason.as_deref(),
            Some("fallbackSourceSheet")
        );
        assert!(!record.capabilities.can_edit_fields);
        assert!(!record.capabilities.can_refresh);
        assert!(record.capabilities.can_export);
    }

    #[test]
    fn normalization_does_not_promote_over_non_matching_native_id_collision() {
        let (storage, source_sheet_id, output_sheet_id) = storage_with_pivot_sheets();
        let parsed = promotable_parsed_pivot();
        write_pivot_spec(&storage, "Pivot_0", &parsed);
        write_pivot_cache_sources(&storage, &[local_cache_source()]);

        let import_identity = import_identity_for_parsed_pivot("Pivot_0", &parsed);
        let native_pivot_id = native_imported_pivot_id(&import_identity);
        let mut colliding_config = parsed.config.clone();
        colliding_config.id = native_pivot_id.clone();
        colliding_config.source_sheet_id = Some(source_sheet_id.to_uuid_string());
        colliding_config.output_sheet_id = Some(output_sheet_id.to_uuid_string());
        colliding_config.source_range = CellRange::new(10, 0, 12, 1);

        {
            let mut txn = storage.doc().transact_mut();
            crate::storage::sheet::pivots::insert_existing_pivot_if_absent_in_txn(
                &mut txn,
                storage.sheets(),
                &output_sheet_id,
                colliding_config.clone(),
            )
            .expect("insert colliding native pivot");
        }

        normalize_imported_pivot_associations(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
        )
        .expect("normalize imported pivots");

        let associations = read_all(storage.doc(), storage.workbook_map());
        assert_eq!(associations.len(), 1);
        let association = &associations[0];
        assert_eq!(
            association.status,
            ImportedPivotAssociationStatus::Unsupported
        );
        assert_eq!(
            association.unsupported_reason,
            Some(ImportedPivotUnsupportedReason::NativePivotIdCollision)
        );
        assert_eq!(association.native_pivot_id, None);

        let stored = crate::storage::sheet::pivots::get_pivot(
            storage.doc(),
            storage.sheets(),
            &output_sheet_id,
            native_pivot_id.as_str(),
        )
        .expect("colliding pivot remains");
        assert_eq!(stored.source_range, colliding_config.source_range);
    }

    #[test]
    fn normalization_keeps_external_cache_import_unsupported() {
        let (storage, _source_sheet_id, output_sheet_id) = storage_with_pivot_sheets();
        let parsed = parsed_pivot();
        write_pivot_spec(&storage, "Pivot_0", &parsed);
        write_pivot_cache_sources(
            &storage,
            &[PivotCacheSourceDef {
                cache_id: 4,
                source_kind: PivotCacheSourceKind::ExternalWorksheet,
                source_sheet: Some("ExternalData".to_string()),
                source_range: Some("A1:C5".to_string()),
                field_names: vec![
                    "Category".to_string(),
                    "Region".to_string(),
                    "Amount".to_string(),
                ],
                ..Default::default()
            }],
        );

        normalize_imported_pivot_associations(
            storage.doc(),
            storage.workbook_map(),
            storage.sheets(),
        )
        .expect("normalize imported pivots");

        let associations = read_all(storage.doc(), storage.workbook_map());
        assert_eq!(associations.len(), 1);
        let association = &associations[0];
        assert_eq!(
            association.status,
            ImportedPivotAssociationStatus::Unsupported
        );
        assert_eq!(
            association.unsupported_reason,
            Some(ImportedPivotUnsupportedReason::ExternalSource)
        );
        assert_eq!(association.native_pivot_id, None);
        assert!(
            crate::storage::sheet::pivots::get_all_pivots(
                storage.doc(),
                storage.sheets(),
                &output_sheet_id,
            )
            .is_empty(),
            "external/cache-only imported pivots must not be promoted during saved-state normalization",
        );
    }
}
