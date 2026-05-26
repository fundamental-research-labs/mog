//! External workbook value provider contracts for formula evaluation.

use value_types::{CellArray, CellValue};
use workbook_types::{ExternalCellRef, ExternalNameRef, ExternalRangeRef};

/// Requesting document identity supplied by root/kernel orchestration.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DocumentId(pub String);

/// Runtime workbook session identity supplied by trusted shell/runtime.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkbookSessionId(pub String);

/// Actor identity for an evaluation request.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ActorId(pub String);

/// Access principal for authorization-scoped external reads.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AccessPrincipal(pub String);

/// Evaluation context required for every external provider read.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ExternalEvaluationContext {
    /// Destination document id.
    pub requesting_document_id: DocumentId,
    /// Destination runtime session id.
    pub requesting_session_id: WorkbookSessionId,
    /// Requesting actor.
    pub actor: ActorId,
    /// Requesting access principal.
    pub principal: AccessPrincipal,
    /// Calculation epoch for cache isolation.
    pub calc_epoch: u64,
}

/// Provider value freshness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ExternalValueFreshness {
    /// Live value from a ready source.
    Live,
    /// Allowed cached value from an unavailable source.
    Stale,
}

/// External link read status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ExternalValueStatus {
    /// Link is unresolved.
    Unresolved,
    /// Link is loading.
    Loading,
    /// Link is ready.
    Ready,
    /// Link is stale.
    Stale,
    /// Access denied.
    Denied,
    /// Link target is broken.
    Broken,
    /// Link target is ambiguous.
    Ambiguous,
    /// Cross-workbook circular reference.
    Circular,
}

/// Diagnostic attached to failed external reads.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ExternalLinkDiagnostic {
    /// Stable machine-readable reason.
    pub reason: String,
    /// Human-readable detail safe for the current principal.
    pub detail: Option<String>,
}

/// Result of an external scalar read.
#[derive(Debug, Clone, PartialEq)]
pub enum ExternalValueResult {
    /// A materialized value. Only live or authorized stale paths may use this variant.
    Value {
        /// Cell value.
        value: CellValue,
        /// Freshness.
        freshness: ExternalValueFreshness,
        /// Optional source version.
        source_version: Option<String>,
    },
    /// Failed read. This variant intentionally cannot carry a `CellValue`.
    Error {
        /// Failure status.
        status: ExternalValueStatus,
        /// Freshness of any diagnostic/cache metadata.
        freshness: ExternalValueFreshness,
        /// Optional source version.
        source_version: Option<String>,
        /// Diagnostic.
        diagnostic: ExternalLinkDiagnostic,
    },
}

/// Result of an external range read.
#[derive(Debug, Clone, PartialEq)]
pub enum ExternalRangeResult {
    /// A materialized range. Only live or authorized stale paths may use this variant.
    Value {
        /// Cell array.
        values: CellArray,
        /// Freshness.
        freshness: ExternalValueFreshness,
        /// Optional source version.
        source_version: Option<String>,
    },
    /// Failed read. This variant intentionally cannot carry range values.
    Error {
        /// Failure status.
        status: ExternalValueStatus,
        /// Freshness of any diagnostic/cache metadata.
        freshness: ExternalValueFreshness,
        /// Optional source version.
        source_version: Option<String>,
        /// Diagnostic.
        diagnostic: ExternalLinkDiagnostic,
    },
}

/// Prepared external value provider. Implementations are owned by root/kernel
/// orchestration and must fail closed when context is missing, unauthorized, or
/// stale for the current calculation epoch.
pub trait ExternalValueProvider {
    /// Read external cells.
    fn get_cells(
        &self,
        ctx: &ExternalEvaluationContext,
        batch: &[ExternalCellRef],
    ) -> Vec<ExternalValueResult>;

    /// Read external ranges.
    fn get_ranges(
        &self,
        ctx: &ExternalEvaluationContext,
        batch: &[ExternalRangeRef],
    ) -> Vec<ExternalRangeResult>;

    /// Read external names.
    fn get_names(
        &self,
        ctx: &ExternalEvaluationContext,
        batch: &[ExternalNameRef],
    ) -> Vec<ExternalValueResult>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use value_types::CellError;

    #[test]
    fn external_error_results_cannot_carry_cell_values() {
        let denied = ExternalValueResult::Error {
            status: ExternalValueStatus::Denied,
            freshness: ExternalValueFreshness::Live,
            source_version: None,
            diagnostic: ExternalLinkDiagnostic {
                reason: "permissionDenied".to_string(),
                detail: None,
            },
        };
        assert!(matches!(
            denied,
            ExternalValueResult::Error {
                status: ExternalValueStatus::Denied,
                ..
            }
        ));
    }

    #[test]
    fn stale_cache_uses_value_variant_explicitly() {
        let cached = ExternalValueResult::Value {
            value: CellValue::Error(CellError::Na, None),
            freshness: ExternalValueFreshness::Stale,
            source_version: Some("v1".to_string()),
        };
        assert!(matches!(
            cached,
            ExternalValueResult::Value {
                freshness: ExternalValueFreshness::Stale,
                ..
            }
        ));
    }
}
