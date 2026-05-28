use cell_types::{CellId, SheetId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceDiagnosticsOptions {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<SheetId>,
    #[serde(default)]
    pub include_warnings: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    pub external_links: ExternalLinkStatusSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkStatusSnapshot {
    pub version: String,
    #[serde(default)]
    pub records: Vec<ExternalLinkStatusSnapshotRecord>,
}

impl Default for ExternalLinkStatusSnapshot {
    fn default() -> Self {
        Self {
            version: "empty".to_string(),
            records: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLinkStatusSnapshotRecord {
    pub link_id: String,
    pub status: ExternalLinkStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status_reason: Option<ExternalLinkStatusReason>,
    pub safe_display_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLinkStatus {
    Unresolved,
    Loading,
    Ready,
    Stale,
    Denied,
    Broken,
    Ambiguous,
    Circular,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExternalLinkStatusReason {
    WrongWorkbookId,
    MissingTarget,
    UnsupportedLinkKind,
    PermissionDenied,
    SourceUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceDiagnosticsPage {
    pub diagnostics: Vec<FormulaReferenceDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub snapshot_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum FormulaReferenceDiagnostic {
    ReferenceEdge(FormulaReferenceEdgeDiagnosticRow),
    Parse(FormulaReferenceParseDiagnosticRow),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceBaseDiagnostic {
    pub id: String,
    pub source_kind: FormulaReferenceSourceKind,
    pub severity: FormulaReferenceSeverity,
    pub code: String,
    pub location: FormulaReferenceLocation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceSourceKind {
    CellFormula,
    NamedRangeFormula,
    UnsupportedFormulaSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaReferenceSeverity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceEdgeDiagnosticRow {
    #[serde(flatten)]
    pub base: FormulaReferenceBaseDiagnostic,
    pub kind: FormulaReferenceEdgeKind,
    pub edge: FormulaReferenceEdgeDiagnostic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceEdgeKind {
    DeletedCell,
    DeletedRange,
    DeletedSheet,
    MissingName,
    InvalidStructuredReference,
    UnresolvedExternalReference,
    ExternalReferenceWarning,
    DanglingIdentityTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceParseDiagnosticRow {
    #[serde(flatten)]
    pub base: FormulaReferenceBaseDiagnostic,
    pub kind: FormulaReferenceParseKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_start: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span_end: Option<u32>,
    pub source_reason: FormulaReferenceParseSourceReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceParseKind {
    ParseError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceParseSourceReason {
    ParserError,
    IdentityTemplateOnly,
    UnsupportedSourceRepresentation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceLocation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<SheetId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_id: Option<CellId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub address_status: FormulaReferenceAddressStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FormulaReferenceAddressStatus {
    Resolved,
    MissingPosition,
    NotCellBacked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaReferenceEdgeDiagnostic {
    pub edge_id: String,
    pub text: String,
    pub span_start: u32,
    pub span_end: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ref_index: Option<u32>,
    pub target_kind: FormulaReferenceTargetKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_display: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_sheet_id: Option<SheetId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_cell_id: Option<CellId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_name_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_table_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_column_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_id: Option<String>,
    pub status: FormulaReferenceEdgeStatus,
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaReferenceTargetKind {
    Cell,
    Range,
    Sheet,
    Name,
    Table,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormulaReferenceEdgeStatus {
    Missing,
    Deleted,
    Invalid,
    Unresolved,
    Loading,
    Stale,
    Denied,
    Broken,
    Ambiguous,
    Circular,
}
