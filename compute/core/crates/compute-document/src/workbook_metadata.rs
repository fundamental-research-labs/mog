//! Persisted workbook identity and external link registry storage types.
//!
//! Runtime link status, authorization context, watches, file handles, and
//! provider sessions are deliberately excluded from this module. The values
//! here are stable workbook content that can be serialized into Yrs state.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use workbook_types::{LinkId, WorkbookId};
use yrs::{Any, Map, MapPrelim, MapRef, Out, ReadTxn};

use crate::schema::{
    KEY_IMPORTED_EXTERNAL_CACHE, KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS,
    KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE, KEY_WORKBOOK_IDENTITY, KEY_WORKBOOK_LINKS,
};

const KEY_WORKBOOK_ID: &str = "workbookId";
const KEY_CREATED: &str = "created";
const KEY_LINEAGE: &str = "lineage";

/// Stable workbook identity metadata persisted in workbook state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkbookMetadata {
    /// Semantic identity embedded in this workbook.
    pub workbook_id: WorkbookId,
    /// Creation/import metadata.
    #[serde(default)]
    pub created: WorkbookCreationMetadata,
    /// Optional lineage for intentional duplicates and identity-preserving copies.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lineage: Option<WorkbookLineage>,
}

/// Creation/import metadata for a workbook identity.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookCreationMetadata {
    /// Creation timestamp, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    /// Actor or system label that created the workbook, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    /// Import source label, when this workbook identity was minted during import.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_from: Option<String>,
}

/// Lineage metadata for intentional Mog duplicate/copy operations.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookLineage {
    /// Original semantic workbook identity, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_workbook_id: Option<WorkbookId>,
    /// Source workbook identity for an intentional independent duplicate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicated_from: Option<WorkbookId>,
    /// Duplicate timestamp, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicated_at: Option<String>,
}

/// Persisted registry entry for one external workbook/source link.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWorkbookLinkRecord {
    /// Destination-workbook-scoped link ID.
    pub link_id: LinkId,
    /// Expected source workbook identity, when the source is a Mog workbook.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_workbook_id: Option<WorkbookId>,
    /// Stable storage target descriptor.
    pub target: PersistedLinkTarget,
    /// User-facing display name for this link.
    pub display_name: String,
    /// Source family.
    pub source_kind: PersistedWorkbookLinkSourceKind,
    /// Imported Excel relationship/part identity, when applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_excel_identity: Option<ImportedExternalLinkIdentity>,
    /// Explicitly materialized cache metadata after permission checks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub materialized_cache_metadata: Option<AuthorizedMaterializedCacheMetadata>,
}

/// Serializable descriptor for how a host can resolve a link target.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PersistedLinkTarget {
    /// Provider document/resource identity.
    ProviderResource {
        /// Provider name or stable provider kind.
        provider: String,
        /// Provider resource/document ID.
        resource_id: String,
    },
    /// Normalized local path text.
    LocalPath {
        /// Persisted path text.
        path: String,
    },
    /// URL target.
    Url {
        /// Persisted URL text.
        url: String,
    },
    /// OOXML external-link target text.
    OoxmlExternalPath {
        /// Persisted OOXML target text.
        target: String,
    },
    /// Opaque host token that is safe to persist.
    OpaqueHostToken {
        /// Token namespace.
        namespace: String,
        /// Token payload.
        token: String,
    },
}

/// Source family for a persisted workbook link.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PersistedWorkbookLinkSourceKind {
    /// Mog workbook source.
    MogWorkbook,
    /// Excel workbook external-link source.
    ExcelWorkbook,
    /// Excel DDE link, preserved but not workbook-evaluable.
    DdeLink,
    /// Excel OLE link, preserved but not workbook-evaluable.
    OleLink,
}

/// OOXML external-link identity preserved from import.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedExternalLinkIdentity {
    /// One-based Excel externalReferences ordinal.
    pub excel_ordinal: u32,
    /// Workbook relationship ID.
    pub workbook_rel_id: String,
    /// External-link part name.
    pub part_name: String,
    /// externalBook relationship ID, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_book_rid: Option<String>,
    /// Relationship target, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// Relationship target mode, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
}

/// Metadata for values intentionally materialized into destination workbook content.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizedMaterializedCacheMetadata {
    /// Cache version.
    pub cached_values_version: String,
    /// Source version used for materialization, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_version: Option<String>,
    /// Timestamp of materialization, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub materialized_at: Option<String>,
}

/// Imported Excel external cache/fidelity payload owned by the workbook.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedExternalCacheRecord {
    /// Link registry entry associated with this cache payload.
    pub link_id: LinkId,
    /// Payload family. Old records that omit this field are domain external-link payloads.
    #[serde(default = "default_external_cache_payload_kind")]
    pub payload_kind: String,
    /// Payload schema version. Old records that omit this field are version 1.
    #[serde(default = "default_external_cache_payload_version")]
    pub payload_version: u32,
    /// Opaque JSON payload for imported cache/fidelity structures.
    pub payload_json: String,
}

fn default_external_cache_payload_kind() -> String {
    "domain-types.external-link".to_string()
}

const fn default_external_cache_payload_version() -> u32 {
    1
}

/// Imported formula usage provenance captured before external-reference rewrites.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedExternalUsageProvenance {
    /// Deterministic usage identity.
    pub usage_id: String,
    /// Resolved persisted link ID, when the external ordinal is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_id: Option<LinkId>,
    /// Stable unresolved key for diagnostics when no link ID can be assigned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unresolved_external_key: Option<String>,
    /// Formula-bearing surface kind.
    pub source: ImportedUsageSource,
    /// Stable owner identity for the formula slot.
    pub owner: FormulaSlotKey,
    /// Exact imported expression before local rewrite.
    pub original_expression: String,
    /// Expression after import rewrite, when it differs or is known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_current_expression: Option<String>,
    /// Current provenance state.
    #[serde(default)]
    pub state: ImportedUsageState,
}

/// Formula-bearing surface family for imported external usage provenance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedUsageSource {
    /// Cell formula.
    CellFormula,
    /// Workbook or sheet defined name.
    DefinedName,
    /// Conditional formatting formula.
    ConditionalFormat,
    /// Data validation formula.
    DataValidation,
    /// Table formula.
    TableFormula,
    /// ChartEx formula.
    ChartExFormula,
    /// Native Mog formula.
    NativeMogFormula,
    /// Diagnostic-only preserved formula text.
    DiagnosticOnly,
}

/// Public usage-kind vocabulary shared by audit/view DTOs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UsageKind {
    /// Cell formula.
    CellFormula,
    /// Workbook or sheet defined name.
    DefinedName,
    /// Conditional formatting formula.
    ConditionalFormat,
    /// Data validation formula.
    DataValidation,
    /// Table formula.
    TableFormula,
    /// ChartEx formula.
    ChartExFormula,
    /// Native Mog formula.
    NativeMogFormula,
    /// Diagnostic-only preserved formula text.
    DiagnosticOnly,
}

/// Export precedence for a formula override.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaOverridePrecedence {
    /// Active imported formula text has precedence over parser/current output.
    ActiveImportedExternal,
}

/// Durable state of an imported formula usage.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportedUsageState {
    /// Owner still exists and has not been edited away.
    #[default]
    Active,
    /// Formula slot was edited after import.
    Edited,
    /// Owner identity became ambiguous or display-only identity changed.
    Stale,
    /// Owner was deleted.
    Deleted,
}

/// Versioned exact formula-slot identity.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FormulaSlotKey {
    /// Cell formula slot.
    Cell {
        /// Sheet ID.
        sheet_id: String,
        /// Cell ID when stable identity is available.
        cell_id: String,
        /// Import-time A1 address for diagnostics.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        import_address: Option<String>,
    },
    /// Defined name slot.
    DefinedName {
        /// Stable name ID, when available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name_id: Option<String>,
        /// Workbook/sheet scope label for fallback diagnostics.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
        /// Name text at import time.
        name: String,
    },
    /// Conditional format formula slot.
    ConditionalFormat {
        /// Sheet ID.
        sheet_id: String,
        /// Rule ID when available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rule_id: Option<String>,
        /// Range binding ID when available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        range_binding_id: Option<String>,
        /// Rule index fallback.
        rule_index: u32,
        /// Formula index within the rule.
        formula_index: u32,
    },
    /// Data validation formula slot.
    DataValidation {
        /// Sheet ID.
        sheet_id: String,
        /// Validation rule ID when available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rule_id: Option<String>,
        /// Range binding ID when available.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        range_binding_id: Option<String>,
        /// Formula slot label.
        slot: String,
    },
    /// Table formula slot.
    TableFormula {
        /// Sheet ID.
        sheet_id: String,
        /// Table ID or name.
        table_id: String,
        /// Column ID or name.
        column_id: String,
        /// Formula slot label.
        slot: String,
    },
    /// ChartEx formula slot.
    ChartExFormula {
        /// Sheet ID.
        sheet_id: String,
        /// Chart object ID or package path.
        chart_id: String,
        /// Series/dimension slot.
        slot: String,
    },
    /// Diagnostic-only formula text without active stable owner support.
    DiagnosticOnly {
        /// Stable diagnostic key.
        key: String,
        /// Human-readable label.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
}

/// Preserved imported package artifact that is not an active workbook dependency.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedExternalPackageArtifact {
    /// Deterministic artifact ID.
    pub artifact_id: String,
    /// Artifact family. Round 1 uses `orphan-external-link`.
    pub artifact_kind: String,
    /// Package part name.
    pub part_name: String,
    /// Relationship part name, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels_part_name: Option<String>,
    /// Content type override, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// Payload family.
    pub payload_kind: String,
    /// Payload schema version.
    pub payload_version: u32,
    /// JSON payload.
    pub payload_json: String,
    /// Raw relationship payload, when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rels_payload: Option<String>,
    /// Redaction-safe diagnostic.
    pub diagnostic: String,
    /// Tombstone flag.
    #[serde(default)]
    pub tombstoned: bool,
}

/// Read persisted workbook metadata. Missing maps/keys are old-document defaults.
///
/// # Errors
///
/// Returns a serde or UUID error string if a present value is malformed.
pub fn read_workbook_metadata<T: ReadTxn>(
    txn: &T,
    workbook: &MapRef,
) -> Result<Option<PersistedWorkbookMetadata>, String> {
    let Some(Out::YMap(identity)) = workbook.get(txn, KEY_WORKBOOK_IDENTITY) else {
        return Ok(None);
    };
    let Some(Out::Any(Any::String(workbook_id))) = identity.get(txn, KEY_WORKBOOK_ID) else {
        return Ok(None);
    };

    let created = match identity.get(txn, KEY_CREATED) {
        Some(Out::Any(Any::String(json))) => serde_json::from_str(&json)
            .map_err(|err| format!("invalid workbook creation metadata: {err}"))?,
        _ => WorkbookCreationMetadata::default(),
    };
    let lineage = match identity.get(txn, KEY_LINEAGE) {
        Some(Out::Any(Any::String(json))) => Some(
            serde_json::from_str(&json)
                .map_err(|err| format!("invalid workbook lineage metadata: {err}"))?,
        ),
        _ => None,
    };

    Ok(Some(PersistedWorkbookMetadata {
        workbook_id: WorkbookId::from_uuid_str(&workbook_id)
            .map_err(|err| format!("invalid workbookId: {err}"))?,
        created,
        lineage,
    }))
}

/// Write persisted workbook metadata into the workbook identity map.
///
/// # Errors
///
/// Returns a serde error if nested metadata cannot be serialized.
pub fn write_workbook_metadata(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    metadata: &PersistedWorkbookMetadata,
) -> Result<(), serde_json::Error> {
    let identity = ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_IDENTITY);
    identity.insert(
        txn,
        KEY_WORKBOOK_ID,
        Any::String(Arc::from(metadata.workbook_id.to_uuid_string())),
    );
    identity.insert(
        txn,
        KEY_CREATED,
        Any::String(Arc::from(serde_json::to_string(&metadata.created)?)),
    );
    if let Some(lineage) = &metadata.lineage {
        identity.insert(
            txn,
            KEY_LINEAGE,
            Any::String(Arc::from(serde_json::to_string(lineage)?)),
        );
    } else {
        identity.remove(txn, KEY_LINEAGE);
    }
    Ok(())
}

/// Read all persisted link registry records. Missing registry maps default to empty.
///
/// # Errors
///
/// Returns a serde error string if a present record is malformed.
pub fn read_workbook_link_records<T: ReadTxn>(
    txn: &T,
    workbook: &MapRef,
) -> Result<Vec<PersistedWorkbookLinkRecord>, String> {
    let Some(Out::YMap(links)) = workbook.get(txn, KEY_WORKBOOK_LINKS) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (_, value) in links.iter(txn) {
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        records.push(
            serde_json::from_str(&json)
                .map_err(|err| format!("invalid workbook link record: {err}"))?,
        );
    }
    Ok(records)
}

/// Write one persisted link registry record under its `linkId`.
///
/// # Errors
///
/// Returns a serde error if the record cannot be serialized.
pub fn write_workbook_link_record(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    record: &PersistedWorkbookLinkRecord,
) -> Result<(), serde_json::Error> {
    let links = ensure_workbook_child_map(workbook, txn, KEY_WORKBOOK_LINKS);
    let key = record.link_id.to_uuid_string();
    links.insert(
        txn,
        key.as_str(),
        Any::String(Arc::from(serde_json::to_string(record)?)),
    );
    Ok(())
}

/// Read imported Excel external cache records. Missing cache maps default to empty.
///
/// # Errors
///
/// Returns a serde error string if a present record is malformed.
pub fn read_imported_external_cache_records<T: ReadTxn>(
    txn: &T,
    workbook: &MapRef,
) -> Result<Vec<ImportedExternalCacheRecord>, String> {
    let Some(Out::YMap(cache)) = workbook.get(txn, KEY_IMPORTED_EXTERNAL_CACHE) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (_, value) in cache.iter(txn) {
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        records.push(
            serde_json::from_str(&json)
                .map_err(|err| format!("invalid imported external cache record: {err}"))?,
        );
    }
    Ok(records)
}

/// Write one imported Excel external cache record under its `linkId`.
///
/// # Errors
///
/// Returns a serde error if the record cannot be serialized.
pub fn write_imported_external_cache_record(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    record: &ImportedExternalCacheRecord,
) -> Result<(), serde_json::Error> {
    let cache = ensure_workbook_child_map(workbook, txn, KEY_IMPORTED_EXTERNAL_CACHE);
    let key = record.link_id.to_uuid_string();
    cache.insert(
        txn,
        key.as_str(),
        Any::String(Arc::from(serde_json::to_string(record)?)),
    );
    Ok(())
}

/// Read imported external formula usage provenance records.
pub fn read_imported_external_usage_provenance<T: ReadTxn>(
    txn: &T,
    workbook: &MapRef,
) -> Result<Vec<ImportedExternalUsageProvenance>, String> {
    let Some(Out::YMap(usages)) = workbook.get(txn, KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE) else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (_, value) in usages.iter(txn) {
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        records.push(
            serde_json::from_str(&json)
                .map_err(|err| format!("invalid imported external usage provenance: {err}"))?,
        );
    }
    Ok(records)
}

/// Write one imported external formula usage provenance record.
pub fn write_imported_external_usage_provenance(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    record: &ImportedExternalUsageProvenance,
) -> Result<(), serde_json::Error> {
    let usages = ensure_workbook_child_map(workbook, txn, KEY_IMPORTED_EXTERNAL_USAGE_PROVENANCE);
    usages.insert(
        txn,
        record.usage_id.as_str(),
        Any::String(Arc::from(serde_json::to_string(record)?)),
    );
    Ok(())
}

/// Read preserved imported package artifacts.
pub fn read_imported_external_package_artifacts<T: ReadTxn>(
    txn: &T,
    workbook: &MapRef,
) -> Result<Vec<ImportedExternalPackageArtifact>, String> {
    let Some(Out::YMap(artifacts)) = workbook.get(txn, KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS)
    else {
        return Ok(Vec::new());
    };
    let mut records = Vec::new();
    for (_, value) in artifacts.iter(txn) {
        let Out::Any(Any::String(json)) = value else {
            continue;
        };
        records.push(
            serde_json::from_str(&json)
                .map_err(|err| format!("invalid imported external package artifact: {err}"))?,
        );
    }
    Ok(records)
}

/// Write one preserved imported package artifact.
pub fn write_imported_external_package_artifact(
    txn: &mut yrs::TransactionMut<'_>,
    workbook: &MapRef,
    record: &ImportedExternalPackageArtifact,
) -> Result<(), serde_json::Error> {
    let artifacts =
        ensure_workbook_child_map(workbook, txn, KEY_IMPORTED_EXTERNAL_PACKAGE_ARTIFACTS);
    artifacts.insert(
        txn,
        record.artifact_id.as_str(),
        Any::String(Arc::from(serde_json::to_string(record)?)),
    );
    Ok(())
}

fn ensure_workbook_child_map(
    workbook: &MapRef,
    txn: &mut yrs::TransactionMut<'_>,
    key: &str,
) -> MapRef {
    match workbook.get(txn, key) {
        Some(Out::YMap(map)) => map,
        _ => workbook.insert(txn, key, MapPrelim::from([] as [(&str, Any); 0])),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{KEY_WORKBOOK, init_canonical_schema};
    use yrs::{Doc, Transact};

    #[test]
    fn missing_foundation_maps_read_as_old_doc_defaults() {
        let doc = Doc::new();
        let workbook = doc.get_or_insert_map(KEY_WORKBOOK);
        let txn = doc.transact();

        assert_eq!(read_workbook_metadata(&txn, &workbook).unwrap(), None);
        assert!(
            read_workbook_link_records(&txn, &workbook)
                .unwrap()
                .is_empty()
        );
        assert!(
            read_imported_external_cache_records(&txn, &workbook)
                .unwrap()
                .is_empty()
        );
        assert!(
            read_imported_external_usage_provenance(&txn, &workbook)
                .unwrap()
                .is_empty()
        );
        assert!(
            read_imported_external_package_artifacts(&txn, &workbook)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn workbook_metadata_roundtrips_through_yrs() {
        let doc = Doc::new();
        let (workbook, _, _) = init_canonical_schema(&doc);
        let metadata = PersistedWorkbookMetadata {
            workbook_id: WorkbookId::from_raw(0x1234567890abcdef1234567890abcdef),
            created: WorkbookCreationMetadata {
                created_at: Some("2026-05-20T00:00:00Z".to_string()),
                created_by: Some("import".to_string()),
                imported_from: None,
            },
            lineage: Some(WorkbookLineage {
                origin_workbook_id: Some(WorkbookId::from_raw(1)),
                duplicated_from: None,
                duplicated_at: None,
            }),
        };

        let mut txn = doc.transact_mut();
        write_workbook_metadata(&mut txn, &workbook, &metadata).unwrap();
        drop(txn);

        let txn = doc.transact();
        assert_eq!(
            read_workbook_metadata(&txn, &workbook).unwrap(),
            Some(metadata)
        );
    }

    #[test]
    fn workbook_link_registry_roundtrips_through_yrs() {
        let doc = Doc::new();
        let (workbook, _, _) = init_canonical_schema(&doc);
        let record = PersistedWorkbookLinkRecord {
            link_id: LinkId::from_raw(7),
            expected_workbook_id: Some(WorkbookId::from_raw(9)),
            target: PersistedLinkTarget::Url {
                url: "https://example.test/book.xlsx".to_string(),
            },
            display_name: "Budget".to_string(),
            source_kind: PersistedWorkbookLinkSourceKind::ExcelWorkbook,
            imported_excel_identity: Some(ImportedExternalLinkIdentity {
                excel_ordinal: 1,
                workbook_rel_id: "rId4".to_string(),
                part_name: "/xl/externalLinks/externalLink1.xml".to_string(),
                external_book_rid: Some("rId1".to_string()),
                target: Some("../Budget.xlsx".to_string()),
                target_mode: Some("External".to_string()),
            }),
            materialized_cache_metadata: None,
        };

        let mut txn = doc.transact_mut();
        write_workbook_link_record(&mut txn, &workbook, &record).unwrap();
        drop(txn);

        let txn = doc.transact();
        assert_eq!(
            read_workbook_link_records(&txn, &workbook).unwrap(),
            vec![record]
        );
    }

    #[test]
    fn imported_external_cache_defaults_payload_metadata_for_old_records() {
        let old = r#"{"linkId":"00000000-0000-0000-0000-000000000007","payloadJson":"{}"}"#;
        let record: ImportedExternalCacheRecord = serde_json::from_str(old).unwrap();
        assert_eq!(record.payload_kind, "domain-types.external-link");
        assert_eq!(record.payload_version, 1);
    }

    #[test]
    fn imported_usage_and_package_artifacts_roundtrip_through_yrs() {
        let doc = Doc::new();
        let (workbook, _, _) = init_canonical_schema(&doc);
        let usage = ImportedExternalUsageProvenance {
            usage_id: "usage-1".to_string(),
            link_id: Some(LinkId::from_raw(7)),
            unresolved_external_key: None,
            source: ImportedUsageSource::CellFormula,
            owner: FormulaSlotKey::Cell {
                sheet_id: "sheet-1".to_string(),
                cell_id: "cell-1".to_string(),
                import_address: Some("A1".to_string()),
            },
            original_expression: "[1]Sheet1!A1".to_string(),
            imported_current_expression: Some("Sheet1!A1".to_string()),
            state: ImportedUsageState::Active,
        };
        let artifact = ImportedExternalPackageArtifact {
            artifact_id: "artifact-1".to_string(),
            artifact_kind: "orphan-external-link".to_string(),
            part_name: "xl/externalLinks/externalLink9.xml".to_string(),
            rels_part_name: Some("xl/externalLinks/_rels/externalLink9.xml.rels".to_string()),
            content_type: Some(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"
                    .to_string(),
            ),
            payload_kind: "domain-types.external-link".to_string(),
            payload_version: 1,
            payload_json: "{}".to_string(),
            rels_payload: None,
            diagnostic: "orphan externalLink part".to_string(),
            tombstoned: false,
        };

        let mut txn = doc.transact_mut();
        write_imported_external_usage_provenance(&mut txn, &workbook, &usage).unwrap();
        write_imported_external_package_artifact(&mut txn, &workbook, &artifact).unwrap();
        drop(txn);

        let txn = doc.transact();
        assert_eq!(
            read_imported_external_usage_provenance(&txn, &workbook).unwrap(),
            vec![usage]
        );
        assert_eq!(
            read_imported_external_package_artifacts(&txn, &workbook).unwrap(),
            vec![artifact]
        );
    }
}
