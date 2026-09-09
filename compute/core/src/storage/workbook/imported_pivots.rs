//! Workbook-level imported PivotTable association storage.
//!
//! Imported XLSX pivots have two pieces of state: the OOXML preservation record
//! in `pivotSpecs`, and the editable native pivot config in a sheet's
//! `pivotTables` map. This module owns the durable association between those
//! records so export/delete/reload are identity-driven rather than name-driven.

use crate::storage::WorkbookStorage;
use compute_pivot::types::PivotTableResult;
use domain_types::domain::pivot::{ParsedPivotTable, PivotTableConfig};
use serde::{Deserialize, Serialize};

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

pub fn read_all(storage: &WorkbookStorage) -> Vec<ImportedPivotAssociation> {
    let mut associations: Vec<_> = storage
        .metadata
        .imported_pivot_associations
        .values()
        .cloned()
        .collect();
    associations.sort_by_key(|association| association.pivot_spec_order);
    associations
}

pub fn read_view_records_for_output_sheet(
    storage: &WorkbookStorage,
    output_sheet_id: &cell_types::SheetId,
) -> Vec<ImportedPivotViewRecord> {
    let output_sheet_uuid = output_sheet_id.to_uuid_string();
    let pivot_specs: std::collections::HashMap<String, ParsedPivotTable> =
        read_pivot_specs(storage)
            .into_iter()
            .map(|(key, _, parsed)| (key, parsed))
            .collect();
    let mut records = Vec::new();

    for association in read_all(storage) {
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
                    storage,
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

pub fn write(storage: &mut WorkbookStorage, association: &ImportedPivotAssociation) {
    crate::storage::engine::history::metadata::capture_workbook_entry!(
        storage,
        imported_pivot_associations,
        association.import_identity
    );

    storage
        .metadata
        .imported_pivot_associations
        .insert(association.import_identity.clone(), association.clone());
}

pub fn find_by_native_pivot_id(
    storage: &WorkbookStorage,
    native_pivot_id: &str,
) -> Option<ImportedPivotAssociation> {
    storage
        .metadata
        .imported_pivot_associations
        .values()
        .find(|association| {
            association.native_pivot_id.as_deref() == Some(native_pivot_id)
                && association.status != ImportedPivotAssociationStatus::Deleted
        })
        .cloned()
}

pub fn mark_native_pivot_deleted(storage: &mut WorkbookStorage, native_pivot_id: &str) -> bool {
    if let Some((id, _)) = storage
        .metadata
        .imported_pivot_associations
        .iter()
        .find(|(_, a)| {
            a.native_pivot_id.as_deref() == Some(native_pivot_id)
                && a.status != ImportedPivotAssociationStatus::Deleted
        })
    {
        crate::storage::engine::history::metadata::capture_workbook_entry!(
            storage,
            imported_pivot_associations,
            id
        );
    }

    let Some(association) = storage
        .metadata
        .imported_pivot_associations
        .values_mut()
        .find(|association| {
            association.native_pivot_id.as_deref() == Some(native_pivot_id)
                && association.status != ImportedPivotAssociationStatus::Deleted
        })
    else {
        return false;
    };
    association.status = ImportedPivotAssociationStatus::Deleted;
    association.deleted_at = Some(crate::storage::infra::time::now_millis());
    true
}

pub fn update_output_sheet_name_for_sheet(
    storage: &mut WorkbookStorage,
    sheet_id: &cell_types::SheetId,
    new_name: &str,
) {
    if storage.history.is_active() {
        if let Some(sheet) = storage.sheet_metadata.get(sheet_id) {
            for (id, pivot) in &sheet.pivots {
                if pivot
                    .output_sheet_id
                    .as_deref()
                    .is_none_or(|id| id == sheet_id.to_uuid_string())
                {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage, *sheet_id, pivots, id
                    );
                }
            }
        }
    }

    let sheet_uuid = sheet_id.to_uuid_string();
    if let Some(sheet) = storage.sheet_metadata.get_mut(sheet_id) {
        for config in sheet.pivots.values_mut() {
            if config
                .output_sheet_id
                .as_deref()
                .is_none_or(|id| id == sheet_uuid)
            {
                config.output_sheet_id = Some(sheet_uuid.clone());
                config.output_sheet_name = new_name.to_owned();
                config.updated_at = Some(crate::storage::infra::time::now_millis() as f64);
            }
        }
    }
}

pub fn update_source_sheet_name_for_sheet(
    storage: &mut WorkbookStorage,
    sheet_id: &cell_types::SheetId,
    new_name: &str,
) {
    if storage.history.is_active() {
        for (sid, sheet) in &storage.sheet_metadata {
            for (id, pivot) in &sheet.pivots {
                if pivot.source_sheet_id.as_deref() == Some(sheet_id.to_uuid_string().as_str()) {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage, *sid, pivots, id
                    );
                }
            }
        }
    }

    let sheet_uuid = sheet_id.to_uuid_string();
    for sheet in storage.sheet_metadata.values_mut() {
        for config in sheet.pivots.values_mut() {
            if config.source_sheet_id.as_deref() == Some(sheet_uuid.as_str()) {
                config.source_sheet_name = new_name.to_owned();
                config.updated_at = Some(crate::storage::infra::time::now_millis() as f64);
            }
        }
    }
}

pub fn mark_output_sheet_deleted(
    storage: &mut WorkbookStorage,
    output_sheet_id: &cell_types::SheetId,
) {
    if storage.history.is_active() {
        for (id, association) in &storage.metadata.imported_pivot_associations {
            if association.output_sheet_id.as_deref()
                == Some(output_sheet_id.to_uuid_string().as_str())
                && association.status != ImportedPivotAssociationStatus::Deleted
            {
                crate::storage::engine::history::metadata::capture_workbook_entry!(
                    storage,
                    imported_pivot_associations,
                    id
                );
            }
        }
    }

    let sheet_uuid = output_sheet_id.to_uuid_string();
    for association in storage.metadata.imported_pivot_associations.values_mut() {
        if association.output_sheet_id.as_deref() == Some(sheet_uuid.as_str())
            && association.status != ImportedPivotAssociationStatus::Deleted
        {
            association.status = ImportedPivotAssociationStatus::Deleted;
            association.deleted_at = Some(crate::storage::infra::time::now_millis());
        }
    }
}

pub fn mark_source_sheet_deleted(
    storage: &mut WorkbookStorage,
    source_sheet_id: &cell_types::SheetId,
) {
    if storage.history.is_active() {
        for (id, association) in &storage.metadata.imported_pivot_associations {
            if association.source_sheet_id.as_deref()
                == Some(source_sheet_id.to_uuid_string().as_str())
                && association.status != ImportedPivotAssociationStatus::Deleted
            {
                crate::storage::engine::history::metadata::capture_workbook_entry!(
                    storage,
                    imported_pivot_associations,
                    id
                );
                if let (Some(sid), Some(pivot)) = (
                    association
                        .output_sheet_id
                        .as_deref()
                        .and_then(|s| cell_types::SheetId::from_uuid_str(s).ok()),
                    association.native_pivot_id.as_ref(),
                ) {
                    crate::storage::engine::history::metadata::capture_sheet_entry!(
                        storage, sid, pivots, pivot
                    );
                }
            }
        }
    }

    let sheet_uuid = source_sheet_id.to_uuid_string();
    for association in storage.metadata.imported_pivot_associations.values_mut() {
        if association.source_sheet_id.as_deref() != Some(sheet_uuid.as_str())
            || association.status == ImportedPivotAssociationStatus::Deleted
        {
            continue;
        }
        if let (Some(sheet), Some(pivot_id)) = (
            association
                .output_sheet_id
                .as_deref()
                .and_then(|id| cell_types::SheetId::from_uuid_str(id).ok())
                .and_then(|id| storage.sheet_metadata.get_mut(&id)),
            association.native_pivot_id.as_ref(),
        ) {
            sheet.pivots.remove(pivot_id);
        }
        association.status = ImportedPivotAssociationStatus::Deleted;
        association.deleted_at = Some(crate::storage::infra::time::now_millis());
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

pub(crate) fn read_pivot_specs(storage: &WorkbookStorage) -> Vec<(String, u32, ParsedPivotTable)> {
    let mut specs: Vec<_> = storage
        .metadata
        .pivot_specs
        .iter()
        .map(|(key, parsed)| (key.clone(), pivot_spec_order_key(key).0, parsed.clone()))
        .collect();
    specs.sort_by(|a, b| pivot_spec_order_key(&a.0).cmp(&pivot_spec_order_key(&b.0)));
    specs
}

fn pivot_spec_order_key(key: &str) -> (u32, &str) {
    key.rsplit_once('_')
        .and_then(|(prefix, suffix)| suffix.parse::<u32>().ok().map(|idx| (idx, prefix)))
        .unwrap_or((u32::MAX, key))
}

fn unsupported_reason_wire_value(reason: ImportedPivotUnsupportedReason) -> String {
    serde_json::to_value(reason)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("{reason:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mirror::CellMirror;
    use crate::storage::WorkbookStorage;
    use domain_types::domain::analytics::{AggregateFunction, DetectedDataType};
    use domain_types::domain::pivot::{
        CellRange, FieldId, OutputLocation, ParsedPivotTable, PivotField, PivotFieldPlacementFlat,
        PivotTableOoxmlPreservation, PivotTableRelationshipPreservation, PlacementId,
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

    fn storage_with_pivot_sheets() -> (WorkbookStorage, cell_types::SheetId, cell_types::SheetId) {
        let mut storage = WorkbookStorage::new();
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

    fn write_pivot_spec(storage: &mut WorkbookStorage, key: &str, parsed: &ParsedPivotTable) {
        storage
            .metadata
            .pivot_specs
            .insert(key.to_owned(), parsed.clone());
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
        let (mut storage, source_sheet_id, output_sheet_id) = storage_with_pivot_sheets();
        let parsed = parsed_pivot();
        write_pivot_spec(&mut storage, "Pivot_0", &parsed);

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
            crate::storage::sheet::pivots::insert_existing_pivot_if_absent(
                &mut storage,
                &output_sheet_id,
                native_config,
            )
            .expect("insert native pivot");
            write(&mut storage, &association);
        }

        let records = read_view_records_for_output_sheet(&storage, &output_sheet_id);

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
        let (mut storage, _source_sheet_id, output_sheet_id) = storage_with_pivot_sheets();
        let mut parsed = parsed_pivot();
        parsed.config.source_sheet_name = "xlsx-source-sheet".to_string();
        write_pivot_spec(&mut storage, "Pivot_0", &parsed);

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
            write(&mut storage, &association);
        }

        let records = read_view_records_for_output_sheet(&storage, &output_sheet_id);

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
}
