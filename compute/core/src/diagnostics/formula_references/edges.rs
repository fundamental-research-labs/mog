use cell_types::{CellId, SheetId};
use compute_parser::ReferenceToken;

use super::types::{
    ExternalLinkStatus, ExternalLinkStatusSnapshotRecord, FormulaReferenceEdgeKind,
    FormulaReferenceEdgeStatus, FormulaReferenceSeverity, FormulaReferenceTargetKind,
};

#[derive(Clone)]
pub(super) struct PendingEdge {
    pub(super) kind: FormulaReferenceEdgeKind,
    pub(super) severity: FormulaReferenceSeverity,
    pub(super) text: String,
    pub(super) span_start: u32,
    pub(super) span_end: u32,
    pub(super) ref_index: Option<u32>,
    pub(super) target_kind: FormulaReferenceTargetKind,
    pub(super) target_display: Option<String>,
    pub(super) target_sheet_id: Option<SheetId>,
    pub(super) target_cell_id: Option<CellId>,
    pub(super) target_name_id: Option<String>,
    pub(super) target_table_id: Option<String>,
    pub(super) target_column_name: Option<String>,
    pub(super) link_id: Option<String>,
    pub(super) status: FormulaReferenceEdgeStatus,
    pub(super) reason: String,
}

impl PendingEdge {
    pub(super) fn from_token(
        token: &ReferenceToken,
        kind: FormulaReferenceEdgeKind,
        target_kind: FormulaReferenceTargetKind,
        status: FormulaReferenceEdgeStatus,
        reason: String,
    ) -> Self {
        Self {
            kind,
            severity: FormulaReferenceSeverity::Error,
            text: token.text.clone(),
            span_start: token.span_start,
            span_end: token.span_end,
            ref_index: Some(token.ref_index),
            target_kind,
            target_display: None,
            target_sheet_id: None,
            target_cell_id: None,
            target_name_id: None,
            target_table_id: None,
            target_column_name: None,
            link_id: None,
            status,
            reason,
        }
    }
}

pub(super) fn edge_code(kind: FormulaReferenceEdgeKind) -> &'static str {
    match kind {
        FormulaReferenceEdgeKind::DeletedCell => "formula-reference.deleted-cell",
        FormulaReferenceEdgeKind::DeletedRange => "formula-reference.deleted-range",
        FormulaReferenceEdgeKind::DeletedSheet => "formula-reference.deleted-sheet",
        FormulaReferenceEdgeKind::MissingName => "formula-reference.missing-name",
        FormulaReferenceEdgeKind::InvalidStructuredReference => {
            "formula-reference.invalid-structured-reference"
        }
        FormulaReferenceEdgeKind::UnresolvedExternalReference => {
            "formula-reference.unresolved-external-reference"
        }
        FormulaReferenceEdgeKind::ExternalReferenceWarning => {
            "formula-reference.external-reference-warning"
        }
        FormulaReferenceEdgeKind::DanglingIdentityTarget => {
            "formula-reference.dangling-identity-target"
        }
    }
}

pub(super) fn external_mapping(
    link: &ExternalLinkStatusSnapshotRecord,
) -> (
    FormulaReferenceEdgeKind,
    FormulaReferenceSeverity,
    FormulaReferenceEdgeStatus,
) {
    match link.status {
        ExternalLinkStatus::Loading => (
            FormulaReferenceEdgeKind::ExternalReferenceWarning,
            FormulaReferenceSeverity::Warning,
            FormulaReferenceEdgeStatus::Loading,
        ),
        ExternalLinkStatus::Stale => (
            FormulaReferenceEdgeKind::ExternalReferenceWarning,
            FormulaReferenceSeverity::Warning,
            FormulaReferenceEdgeStatus::Stale,
        ),
        ExternalLinkStatus::Ambiguous => (
            FormulaReferenceEdgeKind::ExternalReferenceWarning,
            FormulaReferenceSeverity::Warning,
            FormulaReferenceEdgeStatus::Ambiguous,
        ),
        ExternalLinkStatus::Denied => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Denied,
        ),
        ExternalLinkStatus::Broken => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Broken,
        ),
        ExternalLinkStatus::Circular => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Circular,
        ),
        ExternalLinkStatus::Unresolved | ExternalLinkStatus::Ready => (
            FormulaReferenceEdgeKind::UnresolvedExternalReference,
            FormulaReferenceSeverity::Error,
            FormulaReferenceEdgeStatus::Unresolved,
        ),
    }
}
