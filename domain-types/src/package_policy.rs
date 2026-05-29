use serde::{Deserialize, Serialize};

pub const CURRENT_PACKAGE_PROVENANCE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageProvenanceVersion {
    pub schema_version: u32,
}

impl Default for PackageProvenanceVersion {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_PACKAGE_PROVENANCE_SCHEMA_VERSION,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxPackageOwnerId {
    WorkbookMetadata,
    WorksheetCore,
    CellsSharedStrings,
    Formulas,
    StylesTheme,
    CommentsVml,
    DrawingsMediaCharts,
    Pivots,
    PrinterSettings,
    ConditionalFormattingValidation,
    Hyperlinks,
    ExternalLinks,
    Tables,
    PersonsThreadedComments,
    ActiveContent,
    UnknownInertPackageData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxExportAction {
    TypedRegenerate,
    TypedWithValidatedProvenance,
    PreserveInertArtifact,
    DiagnosticDrop,
    QuarantinedPreserve,
    BlockedExport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxDiagnosticSeverity {
    Info,
    Warning,
    Error,
    Blocked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxDiagnosticAction {
    Regenerated,
    Rewritten,
    PreservedByTypedContract,
    PreservedInert,
    Dropped,
    Quarantined,
    Blocked,
    FailedIntegrityValidation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxDiagnosticReason {
    UnsupportedFeature,
    UnsafeActiveContent,
    StaleProvenance,
    ClosureMismatch,
    LiveStateMutation,
    MissingContentType,
    DanglingRelationship,
    DuplicateRelationshipId,
    MissingEmittedPart,
    CanonicalFreshExportPolicy,
    AmbiguousOwnerPolicy,
    UnmatchedOwnerPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxDiagnosticContinuation {
    ExportContinued,
    ExportContinuedWithSemanticChangeWarning,
    ExportFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxDiagnosticLifecycle {
    ImportOnlyEvidence,
    PersistedWorkbookWarning,
    ExportDecisionDiagnostic,
    EvalOnlyMeasurement,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxPackageDiagnostic {
    pub code: String,
    pub severity: XlsxDiagnosticSeverity,
    pub owner_id: XlsxPackageOwnerId,
    pub action: XlsxDiagnosticAction,
    pub reason: XlsxDiagnosticReason,
    pub continuation: XlsxDiagnosticContinuation,
    pub lifecycle: XlsxDiagnosticLifecycle,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_owner_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub affected_graph: Vec<String>,
    pub semantics_changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationshipProvenance {
    pub owner_rels_path: String,
    pub imported_relationship_id: String,
    pub relationship_type: String,
    pub original_target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_target_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
    pub imported_order: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stable_owner_key: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxPreflightDecisionKind {
    TypedRegenerate,
    TypedWithValidatedProvenance,
    PreserveInertArtifact,
    DiagnosticDrop,
    QuarantinedPreserve,
    BlockedExport,
    PackageIntegrityFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum XlsxOwnerPolicyRequiredTest {
    ImportedUnchanged,
    ImportedEditedStaleProvenance,
    FreshGeneratedNoProvenance,
    PackageGraphClosure,
    Diagnostics,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxPreflightDecision {
    pub owner_id: XlsxPackageOwnerId,
    pub decision: XlsxPreflightDecisionKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<XlsxPackageDiagnostic>,
}

pub const XLSX_PACKAGE_DIAGNOSTIC_CODES: &[&str] = &[
    "xlsx.sharedStrings.staleProvenance",
    "xlsx.formulas.staleProvenance",
    "xlsx.workbook.rewrittenFromLiveState",
    "xlsx.styles.rewrittenFromLiveState",
    "xlsx.worksheet.rewrittenFromLiveState",
    "xlsx.comments.rewrittenFromLiveState",
    "xlsx.drawings.rewrittenFromLiveState",
    "xlsx.pivots.staleProvenance",
    "xlsx.printerSettings.staleProvenance",
    "xlsx.extensions.unsupportedDropped",
    "xlsx.externalLinks.unsupportedDropped",
    "xlsx.activeContent.blocked",
    "xlsx.activeContent.quarantined",
    "xlsx.unknownInert.preserved",
    "xlsx.ownerPolicy.ambiguous",
    "xlsx.ownerPolicy.unmatched",
    "xlsx.packageGraph.danglingRelationship",
    "xlsx.packageGraph.duplicateRelationshipId",
    "xlsx.packageGraph.missingContentType",
    "xlsx.packageGraph.missingEmittedPart",
];
