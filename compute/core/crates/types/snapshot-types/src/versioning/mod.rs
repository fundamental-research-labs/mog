use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::MutationResult;

mod public_contracts;
mod semantic_merge;
mod sha256;

pub use public_contracts::*;
pub use semantic_merge::*;

pub const SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION: &str = "semantic-workbook-state.v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDigest {
    pub algorithm: VersionObjectDigestAlgorithm,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
}

impl ObjectDigest {
    pub fn sha256(bytes: &[u8]) -> Self {
        Self {
            algorithm: VersionObjectDigestAlgorithm::Sha256,
            value: sha256::hex_digest(bytes),
            byte_length: Some(bytes.len()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionObjectDigestAlgorithm {
    #[serde(rename = "sha256")]
    Sha256,
    #[serde(rename = "sha512")]
    Sha512,
    #[serde(rename = "blake3")]
    Blake3,
    #[serde(rename = "opaque")]
    Opaque,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionDomainClass {
    #[serde(rename = "authored")]
    Authored,
    #[serde(rename = "derived")]
    Derived,
    #[serde(rename = "transient")]
    Transient,
    #[serde(rename = "packageFidelity")]
    PackageFidelity,
    #[serde(rename = "secret")]
    Secret,
    #[serde(rename = "external")]
    External,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionDomainCapabilityState {
    #[serde(rename = "not-started")]
    NotStarted,
    #[serde(rename = "contracted")]
    Contracted,
    #[serde(rename = "supported")]
    Supported,
    #[serde(rename = "derived")]
    Derived,
    #[serde(rename = "excluded")]
    Excluded,
    #[serde(rename = "opaque-preserved")]
    OpaquePreserved,
    #[serde(rename = "opaque-blocking")]
    OpaqueBlocking,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VersionOperationKindWire {
    Mutation,
    SemanticOperation,
    DerivedOutputPromotion,
    SyncImport,
    SyncExport,
    Merge,
    Revert,
    Review,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CapturePolicyWire {
    CommitEligible,
    Excluded,
    DerivedOnly,
    RootCreation,
    HistoryGap,
    ShadowOnly,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionWriteAdmissionModeWire {
    Capture,
    ShadowOnly,
    CaptureDisabledNoHistory,
    CaptureSuspendedWithGap,
    Block,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VersionRedactionPolicyWire {
    None,
    MetadataOnly,
    ContentRedacted,
    OpaqueDigestOnly,
    Drop,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionRedactionKeySubjectWire {
    Author,
    Session,
    Provider,
    Debug,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRedactionKeyWire {
    pub key_id: String,
    pub subject: VersionRedactionKeySubjectWire,
    pub source_field: String,
    pub digest: ObjectDigest,
    pub policy: VersionRedactionPolicyWire,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VersionCaptureFailureStageWire {
    Admission,
    Capture,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VersionCaptureFailureCodeWire {
    MissingRedactionKey,
    WriteAdmissionBlocked,
    CaptureSerializationFailed,
    DiagnosticsSinkUnavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum VersionDiagnosticSeverityWire {
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "error")]
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VersionCaptureDiagnosticsSinkRecordKindWire {
    VersionCaptureFailure,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionCaptureFailureSinkRecordWire {
    pub schema_version: u32,
    pub record_kind: VersionCaptureDiagnosticsSinkRecordKindWire,
    pub diagnostic_id: String,
    pub observed_at: String,
    pub stage: VersionCaptureFailureStageWire,
    pub code: VersionCaptureFailureCodeWire,
    pub severity: VersionDiagnosticSeverityWire,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub domain_ids: Vec<String>,
    pub capture_policy: CapturePolicyWire,
    pub write_admission_mode: VersionWriteAdmissionModeWire,
    pub redaction_policy: VersionRedactionPolicyWire,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub redaction_keys: Vec<VersionRedactionKeyWire>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_redaction_fields: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub debug: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionActorKindWire {
    User,
    Service,
    System,
    Migration,
    Automation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionAuthorWire {
    pub author_id: String,
    pub actor_kind: VersionActorKindWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionSyncSourceKindWire {
    ProviderReplay,
    ProviderLiveInbound,
    ProviderMixedInbound,
    CollaborationHydration,
    CollaborationLiveRemote,
    CollaborationMixedRemote,
    ImportHydration,
    SystemRepair,
    LegacyRawUnknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionSyncOriginKindWire {
    Provider,
    Room,
    Import,
    System,
    LegacyRaw,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionSyncTrustStatusWire {
    Verified,
    TrustedLocalSystem,
    Unverified,
    LegacyRaw,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionSyncAuthorStateWire {
    SingleRemote,
    MixedRemote,
    Unknown,
    Agent,
    System,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionSyncCommitGroupingWire {
    None,
    PendingRemote,
    ExcludedLifecycle,
    BlockedMissingRedactionKey,
    BlockedBatchFailure,
    BlockedMixedRemote,
    BlockedUnknownRemote,
    BlockedUnverified,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSyncOperationContextWire {
    pub source_kind: VersionSyncSourceKindWire,
    pub origin_kind: VersionSyncOriginKindWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stable_origin_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authority_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence: Option<String>,
    pub payload_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provenance_payload_hash: Option<String>,
    pub trust_status: VersionSyncTrustStatusWire,
    pub author_state: VersionSyncAuthorStateWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub causation_ids: Vec<String>,
    pub replay: bool,
    pub system: bool,
    pub commit_grouping: VersionSyncCommitGroupingWire,
    pub validation_diagnostic_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusion_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclusion_subreason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionOperationContextWire {
    pub operation_id: String,
    pub kind: VersionOperationKindWire,
    pub author: VersionAuthorWire,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sheet_ids: Vec<String>,
    pub domain_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    pub capture_policy: CapturePolicyWire,
    pub write_admission_mode: VersionWriteAdmissionModeWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_request_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collaboration: Option<VersionSyncOperationContextWire>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplyOperationContextWire {
    pub operation_context: VersionOperationContextWire,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SyncProvenanceApplyEvaluationStatus {
    NotEvaluated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProvenanceApplyReport {
    pub applied_context: SyncApplyOperationContextWire,
    pub pending_segment_status: SyncProvenanceApplyEvaluationStatus,
    pub pending_segment_ids: Vec<String>,
    pub batch_durability_status: SyncProvenanceApplyEvaluationStatus,
}

impl SyncProvenanceApplyReport {
    pub fn not_evaluated(applied_context: SyncApplyOperationContextWire) -> Self {
        Self {
            applied_context,
            pending_segment_status: SyncProvenanceApplyEvaluationStatus::NotEvaluated,
            pending_segment_ids: Vec::new(),
            batch_durability_status: SyncProvenanceApplyEvaluationStatus::NotEvaluated,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplyMutationMetadataWire {
    pub mutation_result: MutationResult,
    pub provenance_report: SyncProvenanceApplyReport,
}

impl SyncApplyMutationMetadataWire {
    pub fn not_evaluated(
        mutation_result: MutationResult,
        applied_context: SyncApplyOperationContextWire,
    ) -> Self {
        Self {
            mutation_result,
            provenance_report: SyncProvenanceApplyReport::not_evaluated(applied_context),
        }
    }
}

impl SyncApplyOperationContextWire {
    pub fn legacy_raw(payload_hash: String) -> Self {
        let operation_id = format!("sync:legacyRawUnknown:{payload_hash}");
        Self {
            operation_context: VersionOperationContextWire {
                operation_id,
                kind: VersionOperationKindWire::SyncImport,
                author: VersionAuthorWire {
                    author_id: "sync:unknown:legacyRaw".to_string(),
                    actor_kind: VersionActorKindWire::System,
                    display_name: None,
                    client_id: None,
                    session_id: None,
                },
                created_at: "1970-01-01T00:00:00.000Z".to_string(),
                workbook_id: None,
                sheet_ids: Vec::new(),
                domain_ids: vec!["runtime-diagnostics".to_string()],
                group_id: None,
                capture_policy: CapturePolicyWire::Excluded,
                write_admission_mode: VersionWriteAdmissionModeWire::CaptureDisabledNoHistory,
                client_request_id: None,
                collaboration: Some(VersionSyncOperationContextWire {
                    source_kind: VersionSyncSourceKindWire::LegacyRawUnknown,
                    origin_kind: VersionSyncOriginKindWire::LegacyRaw,
                    stable_origin_id: None,
                    provider_id: None,
                    provider_kind: None,
                    authority_ref: None,
                    room_id: None,
                    epoch: None,
                    update_id: None,
                    sequence: None,
                    payload_hash,
                    provenance_payload_hash: None,
                    trust_status: VersionSyncTrustStatusWire::LegacyRaw,
                    author_state: VersionSyncAuthorStateWire::Unknown,
                    remote_session_id: None,
                    correlation_id: None,
                    causation_ids: Vec::new(),
                    replay: false,
                    system: true,
                    commit_grouping: VersionSyncCommitGroupingWire::ExcludedLifecycle,
                    validation_diagnostic_count: 0,
                    exclusion_reason: Some("legacyRawUnknown".to_string()),
                    exclusion_subreason: None,
                }),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticDomainCoverageStatus {
    Complete,
    Derived,
    Excluded,
    Transient,
    Unsupported,
    OpaquePreserved,
    OpaqueBlocking,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDomainCoverage {
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    pub status: SemanticDomainCoverageStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<SemanticCompletenessDiagnostic>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SemanticDiagnosticSeverity {
    #[serde(rename = "info")]
    Info,
    #[serde(rename = "warning")]
    Warning,
    #[serde(rename = "error")]
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticCompletenessDiagnostic {
    pub severity: SemanticDiagnosticSeverity,
    pub code: String,
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    pub status: SemanticDomainCoverageStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub object_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticObjectKind {
    Workbook,
    Sheet,
    Row,
    Column,
    Cell,
    CellValue,
    CellFormula,
    DirectFormat,
    DomainAttachment,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticObjectDigest {
    pub object_id: String,
    pub object_kind: SemanticObjectKind,
    pub domain_id: String,
    pub digest: ObjectDigest,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalCellValue {
    pub value_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "kind")]
pub enum CanonicalFormulaRef {
    #[serde(rename_all = "camelCase")]
    Cell {
        object_id: String,
        sheet_id: String,
        row: u32,
        column: u32,
        row_absolute: bool,
        column_absolute: bool,
    },
    #[serde(rename_all = "camelCase")]
    Range {
        sheet_id: String,
        start_object_id: String,
        end_object_id: String,
        start_row: u32,
        start_column: u32,
        end_row: u32,
        end_column: u32,
        start_row_absolute: bool,
        start_column_absolute: bool,
        end_row_absolute: bool,
        end_column_absolute: bool,
    },
    #[serde(rename_all = "camelCase")]
    RectRange {
        sheet_id: String,
        start_row_object_id: String,
        start_column_object_id: String,
        end_row_object_id: String,
        end_column_object_id: String,
        start_row: u32,
        start_column: u32,
        end_row: u32,
        end_column: u32,
        start_row_absolute: bool,
        start_column_absolute: bool,
        end_row_absolute: bool,
        end_column_absolute: bool,
    },
    #[serde(rename_all = "camelCase")]
    FullRow {
        object_id: String,
        sheet_id: String,
        row: u32,
        absolute: bool,
    },
    #[serde(rename_all = "camelCase")]
    RowRange {
        sheet_id: String,
        start_object_id: String,
        end_object_id: String,
        start_row: u32,
        end_row: u32,
        start_absolute: bool,
        end_absolute: bool,
    },
    #[serde(rename_all = "camelCase")]
    FullColumn {
        object_id: String,
        sheet_id: String,
        column: u32,
        absolute: bool,
    },
    #[serde(rename_all = "camelCase")]
    ColumnRange {
        sheet_id: String,
        start_object_id: String,
        end_object_id: String,
        start_column: u32,
        end_column: u32,
        start_absolute: bool,
        end_absolute: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalFormula {
    pub normalized_formula: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependency_object_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<CanonicalFormulaRef>,
    #[serde(default)]
    pub dynamic_array: bool,
    #[serde(default)]
    pub volatile: bool,
    #[serde(default)]
    pub aggregate: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalDirectFormat {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub properties: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticCellState {
    pub object_id: String,
    pub sheet_id: String,
    pub row: u32,
    pub column: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<CanonicalCellValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<CanonicalFormula>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direct_format: Option<CanonicalDirectFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticRowState {
    pub object_id: String,
    pub sheet_id: String,
    pub index: u32,
    pub ordinal: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit_height_points: Option<f64>,
    pub effective_hidden: bool,
    pub manual_hidden: bool,
    pub structural_hidden: bool,
    pub filter_hidden: bool,
    pub cache_hidden_without_owner: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticColumnState {
    pub object_id: String,
    pub sheet_id: String,
    pub index: u32,
    pub ordinal: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit_width_chars: Option<f64>,
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSheetState {
    pub sheet_id: String,
    pub name: String,
    pub row_count: u32,
    pub column_count: u32,
    #[serde(default)]
    pub rows: BTreeMap<String, SemanticRowState>,
    #[serde(default)]
    pub columns: BTreeMap<String, SemanticColumnState>,
    #[serde(default)]
    pub cells: BTreeMap<String, SemanticCellState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDomainState {
    pub domain_id: String,
    pub domain_class: VersionDomainClass,
    pub capability_state: VersionDomainCapabilityState,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub objects: BTreeMap<String, SemanticObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkbookState {
    pub schema_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_id: Option<String>,
    #[serde(default)]
    pub domains: BTreeMap<String, SemanticDomainState>,
    #[serde(default)]
    pub sheets: BTreeMap<String, SemanticSheetState>,
}

impl Default for SemanticWorkbookState {
    fn default() -> Self {
        Self {
            schema_version: SEMANTIC_WORKBOOK_STATE_SCHEMA_VERSION.to_string(),
            workbook_id: None,
            domains: BTreeMap::new(),
            sheets: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkbookStateEnvelope {
    pub state: SemanticWorkbookState,
    pub state_digest: ObjectDigest,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub coverage: Vec<SemanticDomainCoverage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticChangeKind {
    Added,
    Removed,
    Updated,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChange {
    pub change_id: String,
    pub kind: SemanticChangeKind,
    pub domain_id: String,
    pub object_id: String,
    pub object_kind: SemanticObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_digest: Option<ObjectDigest>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after_digest: Option<ObjectDigest>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticWorkbookDiff {
    pub before_digest: ObjectDigest,
    pub after_digest: ObjectDigest,
    pub changes: Vec<SemanticChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub coverage: Vec<SemanticDomainCoverage>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<SemanticCompletenessDiagnostic>,
}

pub fn canonical_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    let value = serde_json::to_value(value)?;
    let mut out = Vec::new();
    write_canonical_json(&value, &mut out)?;
    Ok(out)
}

pub fn canonical_digest<T: Serialize>(value: &T) -> Result<ObjectDigest, serde_json::Error> {
    canonical_json_bytes(value).map(|bytes| ObjectDigest::sha256(&bytes))
}

pub fn semantic_workbook_state_digest(
    state: &SemanticWorkbookState,
) -> Result<ObjectDigest, serde_json::Error> {
    canonical_digest(state)
}

pub fn semantic_state_envelope(
    state: SemanticWorkbookState,
    coverage: Vec<SemanticDomainCoverage>,
) -> Result<SemanticWorkbookStateEnvelope, serde_json::Error> {
    let state_digest = semantic_workbook_state_digest(&state)?;
    Ok(SemanticWorkbookStateEnvelope {
        state,
        state_digest,
        coverage,
    })
}

fn write_canonical_json(value: &Value, out: &mut Vec<u8>) -> Result<(), serde_json::Error> {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(number) => out.extend_from_slice(number.to_string().as_bytes()),
        Value::String(string) => {
            let escaped = serde_json::to_string(string)?;
            out.extend_from_slice(escaped.as_bytes());
        }
        Value::Array(items) => {
            out.push(b'[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                write_canonical_json(item, out)?;
            }
            out.push(b']');
        }
        Value::Object(map) => {
            out.push(b'{');
            let mut entries: Vec<_> = map.iter().collect();
            entries.sort_by_key(|(key, _)| *key);
            for (index, (key, item)) in entries.into_iter().enumerate() {
                if index > 0 {
                    out.push(b',');
                }
                let escaped = serde_json::to_string(key)?;
                out.extend_from_slice(escaped.as_bytes());
                out.push(b':');
                write_canonical_json(item, out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn authored_domain() -> SemanticDomainState {
        SemanticDomainState {
            domain_id: "authored-grid".to_string(),
            domain_class: VersionDomainClass::Authored,
            capability_state: VersionDomainCapabilityState::Supported,
            objects: BTreeMap::new(),
        }
    }

    fn workbook_with_value(value: &str) -> SemanticWorkbookState {
        let mut state = SemanticWorkbookState::default();
        state.workbook_id = Some("wb-1".to_string());
        state
            .domains
            .insert("authored-grid".to_string(), authored_domain());

        let cell = SemanticCellState {
            object_id: "cell:sheet-1:1:1".to_string(),
            sheet_id: "sheet-1".to_string(),
            row: 1,
            column: 1,
            value: Some(CanonicalCellValue {
                value_kind: "string".to_string(),
                canonical_value: Some(Value::String(value.to_string())),
                digest: None,
            }),
            formula: None,
            direct_format: None,
            digest: None,
        };
        let mut sheet = SemanticSheetState {
            sheet_id: "sheet-1".to_string(),
            name: "Sheet1".to_string(),
            row_count: 2,
            column_count: 2,
            rows: BTreeMap::new(),
            columns: BTreeMap::new(),
            cells: BTreeMap::new(),
            digest: None,
        };
        sheet.cells.insert(cell.object_id.clone(), cell);
        state.sheets.insert(sheet.sheet_id.clone(), sheet);
        state
    }

    #[test]
    fn versioning_canonical_json_orders_object_keys_stably() {
        let mut left = BTreeMap::new();
        left.insert("z".to_string(), Value::from(1));
        left.insert("a".to_string(), Value::from(2));

        let mut right = BTreeMap::new();
        right.insert("a".to_string(), Value::from(2));
        right.insert("z".to_string(), Value::from(1));

        let left_json = canonical_json_bytes(&left).expect("canonical json");
        let right_json = canonical_json_bytes(&right).expect("canonical json");

        assert_eq!(left_json, br#"{"a":2,"z":1}"#);
        assert_eq!(left_json, right_json);
    }

    #[test]
    fn versioning_digest_is_stable_and_sha256_shaped() {
        let state = workbook_with_value("alpha");

        let first = canonical_digest(&state).expect("digest");
        let second = canonical_digest(&state).expect("digest");
        let canonical_bytes = canonical_json_bytes(&state).expect("canonical json");

        assert_eq!(first, second);
        assert_eq!(first.algorithm, VersionObjectDigestAlgorithm::Sha256);
        assert_eq!(first.value.len(), 64);
        assert_eq!(first.byte_length, Some(canonical_bytes.len()));
    }

    #[test]
    fn versioning_digest_changes_for_authored_value_change() {
        let before = workbook_with_value("alpha");
        let after = workbook_with_value("beta");

        let before_digest = semantic_workbook_state_digest(&before).expect("before digest");
        let after_digest = semantic_workbook_state_digest(&after).expect("after digest");

        assert_ne!(before_digest.value, after_digest.value);
    }

    #[test]
    fn versioning_capability_state_does_not_serialize_expected_failing() {
        let states = [
            VersionDomainCapabilityState::NotStarted,
            VersionDomainCapabilityState::Contracted,
            VersionDomainCapabilityState::Supported,
            VersionDomainCapabilityState::Derived,
            VersionDomainCapabilityState::Excluded,
            VersionDomainCapabilityState::OpaquePreserved,
            VersionDomainCapabilityState::OpaqueBlocking,
        ];

        let json = serde_json::to_string(&states).expect("states serialize");

        assert!(!json.contains("expected-failing"));
        assert!(json.contains("opaque-preserved"));
        assert!(json.contains("opaque-blocking"));
    }

    #[test]
    fn versioning_canonical_formula_deserializes_pre_ref_shape() {
        let formula: CanonicalFormula =
            serde_json::from_value(serde_json::json!({ "normalizedFormula": "1+1" }))
                .expect("legacy formula shape");

        assert_eq!(formula.normalized_formula, "1+1");
        assert!(formula.dependency_object_ids.is_empty());
        assert!(formula.refs.is_empty());
        assert!(!formula.dynamic_array);
        assert!(!formula.volatile);
        assert!(!formula.aggregate);
        assert!(formula.digest.is_none());
    }
}
