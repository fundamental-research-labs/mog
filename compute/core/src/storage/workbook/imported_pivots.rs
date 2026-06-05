//! Workbook-level imported PivotTable association storage.
//!
//! Imported XLSX pivots have two pieces of state: the OOXML preservation record
//! in `pivotSpecs`, and the editable native pivot config in a sheet's
//! `pivotTables` map. This module owns the durable association between those
//! records so export/delete/reload are identity-driven rather than name-driven.

use std::sync::Arc;

use compute_document::schema::{
    KEY_IMPORTED_PIVOT_ASSOCIATIONS, KEY_NAME, KEY_PIVOT_SPECS, KEY_PROPERTIES,
};
use domain_types::domain::pivot::{ParsedPivotTable, PivotTableConfig};
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

const IMPORTED_PIVOT_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x7069766f745f696d706f72745f6d6f67);

pub fn import_identity_for_parsed_pivot(pivot_spec_key: &str, parsed: &ParsedPivotTable) -> String {
    let preservation = &parsed.ooxml_preservation;
    let relationship = preservation.relationship.as_ref();
    let definition_part_path = preservation
        .definition_part_path
        .as_deref()
        .or_else(|| relationship.and_then(|rel| rel.part_path.as_deref()));
    let cache_relationship_id = relationship.and_then(|rel| rel.relationship_id.as_deref());

    if preservation.output_worksheet_part_path.is_some()
        && preservation.output_worksheet_relationship_id.is_some()
        && definition_part_path.is_some()
    {
        return format!(
            "ooxml:outputWorksheetPartPath={};worksheetRelationshipId={};definitionPartPath={};pivotCacheRelationshipId={};cacheId={}",
            preservation
                .output_worksheet_part_path
                .as_deref()
                .unwrap_or_default(),
            preservation
                .output_worksheet_relationship_id
                .as_deref()
                .unwrap_or_default(),
            definition_part_path.unwrap_or_default(),
            cache_relationship_id.unwrap_or_default(),
            parsed.config.cache_id.unwrap_or_default(),
        );
    }

    format!(
        "legacy:pivotSpecKey={};name={};outputSheet={};cacheId={};refRange={}",
        pivot_spec_key,
        parsed.config.name,
        parsed.config.output_sheet_name,
        parsed.config.cache_id.unwrap_or_default(),
        parsed.config.ref_range.as_deref().unwrap_or_default(),
    )
}

pub fn native_imported_pivot_id(import_identity: &str) -> String {
    let uuid = uuid::Uuid::new_v5(&IMPORTED_PIVOT_NAMESPACE, import_identity.as_bytes());
    format!("pivot-imported-{}", uuid.simple())
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
    read_all(doc, workbook).into_iter().find(|association| {
        association.native_pivot_id.as_deref() == Some(native_pivot_id)
            && association.status != ImportedPivotAssociationStatus::Deleted
    })
}

pub fn mark_native_pivot_deleted(doc: &yrs::Doc, workbook: &MapRef, native_pivot_id: &str) -> bool {
    let Some(mut association) = find_by_native_pivot_id(doc, workbook, native_pivot_id) else {
        return false;
    };
    association.status = ImportedPivotAssociationStatus::Deleted;
    association.deleted_at = Some(crate::storage::infra::yrs_helpers::now_millis());

    let mut txn =
        doc.transact_mut_with(yrs::Origin::from(compute_document::undo::ORIGIN_USER_EDIT));
    write(&mut txn, workbook, &association);
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
                compute_document::hex::hex_to_id(key.as_ref()).map(cell_types::SheetId::from_raw)
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

    let mut txn = doc.transact_mut_with(yrs::Origin::from("system:imported-pivot-normalization"));
    for (pivot_spec_key, pivot_spec_order, parsed) in specs {
        let import_identity = import_identity_for_parsed_pivot(&pivot_spec_key, &parsed);
        if let Some(association) = existing.get(&import_identity) {
            if association.status == ImportedPivotAssociationStatus::Promoted
                && let (Some(native_pivot_id), Some(output_sheet_id)) = (
                    association.native_pivot_id.as_deref(),
                    association.output_sheet_id.as_deref(),
                )
                && let Ok(output_sheet_id) = cell_types::SheetId::from_uuid_str(output_sheet_id)
            {
                let mut config = parsed.config.clone();
                config.id = native_pivot_id.to_string();
                config.output_sheet_id = Some(output_sheet_id.to_uuid_string());
                if let Some(source_sheet_id) = association.source_sheet_id.clone() {
                    config.source_sheet_id = Some(source_sheet_id);
                }
                let _ = crate::storage::sheet::pivots::insert_existing_pivot_if_absent_in_txn(
                    &mut txn,
                    sheets,
                    &output_sheet_id,
                    config,
                )?;
            }
            continue;
        }

        let source_sheet_name = parsed.config.source_sheet_name.as_str();
        let output_sheet_name = parsed.config.output_sheet_name.as_str();
        let source_sheet_id = sheet_ids_by_name.get(source_sheet_name).copied();
        let output_sheet_id = sheet_ids_by_name.get(output_sheet_name).copied();

        let unsupported_reason =
            if source_sheet_name.is_empty() || source_sheet_name == "xlsx-source-sheet" {
                Some(ImportedPivotUnsupportedReason::FallbackSourceSheet)
            } else if source_sheet_id.is_none() {
                Some(ImportedPivotUnsupportedReason::UnresolvedSourceSheet)
            } else if output_sheet_id.is_none() {
                Some(ImportedPivotUnsupportedReason::UnresolvedOutputSheet)
            } else {
                None
            };

        if let (Some(source_sheet_id), Some(output_sheet_id), None) =
            (source_sheet_id, output_sheet_id, unsupported_reason)
        {
            let native_pivot_id = native_imported_pivot_id(&import_identity);
            let mut config = parsed.config.clone();
            config.id = native_pivot_id.clone();
            config.source_sheet_id = Some(source_sheet_id.to_uuid_string());
            config.output_sheet_id = Some(output_sheet_id.to_uuid_string());
            crate::storage::sheet::pivots::insert_existing_pivot_if_absent_in_txn(
                &mut txn,
                sheets,
                &output_sheet_id,
                config,
            )?;

            let association = association_from_parsed_pivot(
                pivot_spec_key,
                pivot_spec_order,
                &parsed,
                import_identity,
                ImportedPivotAssociationStatus::Promoted,
                Some(native_pivot_id),
                Some(output_sheet_id.to_uuid_string()),
                Some(source_sheet_id.to_uuid_string()),
                None,
            );
            write(&mut txn, workbook, &association);
        } else {
            let association = association_from_parsed_pivot(
                pivot_spec_key,
                pivot_spec_order,
                &parsed,
                import_identity,
                ImportedPivotAssociationStatus::Unsupported,
                None,
                output_sheet_id.map(|sheet_id| sheet_id.to_uuid_string()),
                source_sheet_id.map(|sheet_id| sheet_id.to_uuid_string()),
                unsupported_reason.or(Some(ImportedPivotUnsupportedReason::LossyOoxml)),
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
        pivot_spec_order_key(left.as_ref()).cmp(&pivot_spec_order_key(right.as_ref()))
    });

    entries
        .into_iter()
        .filter_map(|(key, value)| {
            let Out::Any(Any::String(json)) = value else {
                return None;
            };
            let parsed = serde_json::from_str::<ParsedPivotTable>(&json).ok()?;
            let order = pivot_spec_order_key(key.as_ref()).0;
            Some((key.to_string(), order, parsed))
        })
        .collect()
}

fn pivot_spec_order_key(key: &str) -> (u32, &str) {
    key.rsplit_once('_')
        .and_then(|(prefix, suffix)| suffix.parse::<u32>().ok().map(|idx| (idx, prefix)))
        .unwrap_or((u32::MAX, key))
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
            compute_document::hex::hex_to_id(sheet_hex.as_ref()).map(cell_types::SheetId::from_raw)
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

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::domain::pivot::{
        CellRange, OutputLocation, ParsedPivotTable, PivotTableOoxmlPreservation,
        PivotTableRelationshipPreservation,
    };

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
}
