//! Recalculation types for incremental cell updates.
//!
//! [`CellEdit`] carries a single cell change from TS to Rust.
//! [`RecalcResult`] carries the computed changes back from Rust to TS.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::mutation::{PolicyPreservedParseOutcome, PolicyPreservedParseSummary};
use crate::queries::CellPosition;
use domain_types::domain::validation::{SchemaType, ValidationErrorCode, ValidationSeverity};
use value_types::{CellValue, FiniteF64};

/// Aggregate counters for a full recalc pass. Always-on, near-zero overhead.
/// Returned as part of RecalcResult so formula-eval can display them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcMetrics {
    // Cell evaluation
    /// Number of formula cells actually evaluated.
    pub cells_evaluated: u64,
    /// Cells skipped because deps were unchanged (dirty tracking win).
    pub cells_skipped_clean: u64,
    /// Cells that evaluated but produced an error value (#N/A, #VALUE!, etc.).
    pub cells_with_errors: u64,

    // Dependency graph
    /// Number of topological levels.
    pub topo_levels: u64,
    /// Largest dependency fan-out for any cell.
    pub max_deps_per_cell: u64,
    /// Total edges in the dependency graph.
    pub total_dep_edges: u64,

    // Range operations (the key algorithmic metric)
    /// Number of range scan operations (SUMIF, VLOOKUP, etc.).
    pub range_scans: u64,
    /// Total cells visited across all range scans.
    pub range_scan_total_cells: u64,
    /// Largest single range scan (cells visited).
    pub range_scan_max_cells: u64,

    // Cache (connect existing CacheCounters)
    /// Total cache hits across all tiers.
    pub cache_hits: u64,
    /// Total cache misses across all tiers.
    pub cache_misses: u64,
    /// Total cache rebuilds across all tiers.
    pub cache_rebuilds: u64,
    /// Total cache evictions across all tiers.
    pub cache_evictions: u64,

    // Aggregation prepass
    /// COUNTIFS/SUMIFS/AVERAGEIFS groups processed during prepass.
    pub agg_prepass_groups: u64,
    /// Cells scanned during aggregation prepass.
    pub agg_prepass_cells: u64,

    // Parallelism
    /// Topological levels evaluated in parallel (rayon).
    pub levels_parallel: u64,
    /// Topological levels evaluated sequentially.
    pub levels_sequential: u64,
    /// Total cells evaluated in parallel batches.
    pub parallel_batch_cells: u64,

    // Memory (coarse)
    /// HashMap inserts tracked at domain level.
    pub hashmap_inserts: u64,
    /// HashMap capacity doublings observed.
    pub hashmap_capacity_grows: u64,

    // Projections (dynamic arrays)
    /// Number of projections registered during spill handling.
    pub projections_registered: u64,
    /// Number of projections materialized.
    pub projections_materialized: u64,
    /// Number of projection conflicts (spill collisions).
    pub projection_conflicts: u64,

    // Timeout
    /// True if the recalculation was cut short due to exceeding the timeout deadline.
    /// When true, some formula cells will have #CALC! error values instead of computed results.
    #[serde(default)]
    pub timed_out: bool,

    // Iterative calculation convergence
    /// Whether circular references were detected during recalculation.
    #[serde(default)]
    pub has_circular_refs: bool,
    /// Whether iterative calculation converged (only meaningful when has_circular_refs is true).
    #[serde(default)]
    pub iterative_converged: bool,
    /// Number of iterations performed (0 if no circular refs or iterative calc disabled).
    #[serde(default)]
    pub iterative_iterations: u32,
    /// Maximum per-cell delta at final iteration. `None` when no cycles ran or
    /// the cycle contained non-numeric cells (no defined numeric delta).
    /// Wire shape: present, possibly null. Do NOT add `skip_serializing_if`.
    #[serde(default)]
    pub iterative_max_delta: Option<FiniteF64>,
    /// Number of cells involved in circular references.
    #[serde(default)]
    pub circular_cell_count: u32,
}

/// Per-call iterative calculation overrides.
///
/// Passed from TypeScript to Rust via the bridge. When a field is `None`,
/// the workbook-level setting is used. When `Some`, it overrides for this
/// call only.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecalcOptions {
    /// Override iterative calculation for this call only.
    /// `None` → use workbook setting; `Some(true/false)` → override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iterative: Option<bool>,
    /// Override max iterations for this call only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_iterations: Option<u32>,
    /// Override convergence threshold for this call only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_change: Option<FiniteF64>,
}

/// Cell edit sent from TS to Rust (incremental update).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Zero-based row index.
    pub row: u32,
    /// Zero-based column index.
    pub col: u32,
    /// New cell value.
    pub value: CellValue,
    /// New formula text, or None to clear.
    pub formula: Option<String>,
    /// Identity-based formula. When present, `formula` field is ignored.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_formula: Option<formula_types::IdentityFormula>,
}

impl CellEdit {
    /// Get the identity formula if present, ignoring the legacy formula string.
    #[must_use]
    pub fn effective_identity_formula(&self) -> Option<&formula_types::IdentityFormula> {
        self.identity_formula.as_ref()
    }
}

/// Recalculation result returned from Rust to TS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcResult {
    /// Cells whose values changed.
    pub changed_cells: Vec<CellChange>,
    /// Projection changes (dynamic array spill regions).
    #[serde(default)]
    pub projection_changes: Vec<ProjectionChange>,
    /// Cells that produced errors.
    #[serde(default)]
    pub errors: Vec<CellErrorInfo>,
    /// Post-recalc schema validation annotations. Empty if no schema map is loaded.
    #[serde(default)]
    pub validation_annotations: Vec<RecalcValidationAnnotation>,
    /// Aggregate counters for the recalc pass (always-on, near-zero overhead).
    #[serde(default)]
    pub metrics: RecalcMetrics,
    /// Old cell values captured from CellMirror before writes (read-before-write pattern).
    /// Keyed by `"sheetId:cellId"` (UUID strings). Populated for both direct edits
    /// (snapshotted before `mirror.apply_edit()`) and cascade recalc changes
    /// (snapshotted before `mirror.set_value_mut()`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub old_values: HashMap<String, CellValue>,
    /// Local-only parse metadata promoted to top-level MutationResult.
    #[serde(skip)]
    pub policy_preserved_parse_outcomes: Vec<PolicyPreservedParseOutcome>,
    /// Local-only parse metadata summary promoted to top-level MutationResult.
    #[serde(skip)]
    pub policy_preserved_parse_summary: Option<PolicyPreservedParseSummary>,
}

impl RecalcResult {
    /// Create an empty recalculation result with no changes.
    #[must_use]
    pub fn empty() -> Self {
        Self {
            changed_cells: Vec::new(),
            projection_changes: Vec::new(),
            errors: Vec::new(),
            validation_annotations: Vec::new(),
            metrics: RecalcMetrics::default(),
            old_values: HashMap::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
        }
    }
}

/// A single cell value change (Rust to TS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellChange {
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Resolved cell position, or `None` if the position could not be resolved
    /// (e.g. the grid index no longer contains this cell).
    ///
    /// Consumers MUST check for `None` and skip the change rather than falling
    /// back to a default position — falling back previously emitted spurious
    /// A1-change events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<CellPosition>,
    /// New computed value.
    pub value: CellValue,
    /// Pre-formatted display text (same as viewport would show).
    /// When present, TS should use this instead of computing its own display text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_text: Option<String>,
    /// Pre-mutation formatted display text for the old value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_display_text: Option<String>,
    /// Formula text before the mutation, if the cell had a formula.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_formula: Option<String>,
    /// Formula text after the mutation, if the cell has a formula.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_formula: Option<String>,
    /// Effective number format after the mutation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    /// Format palette index (matches viewport binary format_idx).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_idx: Option<u16>,
    /// Additional render flags (HAS_COMMENT, HAS_FORMULA, HAS_SPARKLINE, HAS_HYPERLINK, etc.)
    /// to OR into the binary patch flags alongside the value-type bits.
    /// Populated by `enrich_metadata_flags()` before viewport patch serialization.
    #[serde(default)]
    pub extra_flags: u16,
    /// Old cell value before this change (read-before-write from CellMirror).
    /// Populated for cascade recalc changes. `None` for structural changes or
    /// when old value capture is not applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_value: Option<CellValue>,
}

/// Projection change (dynamic array region update).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionChange {
    /// Cell ID of the formula that produces the array.
    pub source_cell_id: String,
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// True when the projection is a legacy CSE array formula. Dynamic-array
    /// spill members are associated with the anchor formula but do not own
    /// formula text.
    #[serde(default, skip_serializing_if = "is_false")]
    pub is_cse: bool,
    /// Individual projected cell values (for viewport patching).
    pub projection_cells: Vec<ProjectionCellData>,
}

/// Individual projected cell data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionCellData {
    /// Cell ID as UUID string (source cell ID for projected positions).
    pub cell_id: String,
    /// Zero-based row index.
    pub row: u32,
    /// Zero-based column index.
    pub col: u32,
    /// Projected cell value.
    pub value: CellValue,
}

/// Error info for a specific cell.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellErrorInfo {
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Error description.
    pub error: String,
}

/// Post-recalc validation annotation (IPC serialization).
/// Produced for every validated cell (both pass and fail).
/// If errors is empty, the cell passed validation.
/// The cell value is kept; the annotation is metadata for UI display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcValidationAnnotation {
    /// Cell ID as UUID string.
    pub cell_id: String,
    /// Sheet ID as UUID string.
    pub sheet_id: String,
    /// Zero-based row index of the cell.
    pub row: u32,
    /// Column index of the cell.
    pub column: u32,
    /// Validation errors found. Empty if the cell passed validation.
    pub errors: Vec<RecalcValidationError>,
    /// Expected schema type (e.g. `SchemaType::Currency`, `SchemaType::Email`).
    pub expected_type: SchemaType,
    /// Actual inferred type.
    pub actual_type: SchemaType,
}

/// A single validation error in a recalc annotation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecalcValidationError {
    /// Error code (e.g. `ValidationErrorCode::TypeMismatch`).
    pub code: ValidationErrorCode,
    /// Human-readable error message.
    pub message: String,
    /// Severity level.
    pub severity: ValidationSeverity,
}

/// Parse result returned for formula validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseResult {
    /// Whether the formula is syntactically valid.
    pub valid: bool,
    /// Parse error message, if invalid.
    #[serde(default)]
    pub error: Option<String>,
    /// Cell references found in the formula.
    #[serde(default)]
    pub references: Vec<String>,
    /// Function names used in the formula.
    #[serde(default)]
    pub functions: Vec<String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper to create a sample IdentityFormula for testing.
    fn sample_identity_formula() -> formula_types::IdentityFormula {
        crate::test_helpers::sample_identity_formula()
    }

    #[test]
    fn recalc_result_empty() {
        let r = RecalcResult::empty();
        assert!(r.changed_cells.is_empty());
        assert!(r.projection_changes.is_empty());
        assert!(r.errors.is_empty());
        assert!(r.validation_annotations.is_empty());
    }

    #[test]
    fn recalc_result_serde_roundtrip() {
        let r = RecalcResult {
            changed_cells: vec![CellChange {
                cell_id: "c1".into(),
                sheet_id: "s1".into(),
                position: Some(CellPosition { row: 0, col: 0 }),
                value: CellValue::number(10.0),
                display_text: None,
                old_display_text: None,
                old_formula: None,
                new_formula: None,
                number_format: None,
                format_idx: None,
                extra_flags: 0,
                old_value: None,
            }],
            projection_changes: vec![],
            errors: vec![CellErrorInfo {
                cell_id: "c2".into(),
                sheet_id: "s1".into(),
                error: "bad formula".into(),
            }],
            validation_annotations: vec![RecalcValidationAnnotation {
                cell_id: "c3".into(),
                sheet_id: "s1".into(),
                row: 5,
                column: 2,
                errors: vec![RecalcValidationError {
                    code: ValidationErrorCode::TypeMismatch,
                    message: "Expected email, got number".into(),
                    severity: ValidationSeverity::Error,
                }],
                expected_type: SchemaType::Email,
                actual_type: SchemaType::Integer,
            }],
            metrics: RecalcMetrics::default(),
            old_values: HashMap::new(),
            policy_preserved_parse_outcomes: Vec::new(),
            policy_preserved_parse_summary: None,
        };
        let json = serde_json::to_string(&r).unwrap();
        let r2: RecalcResult = serde_json::from_str(&json).unwrap();
        assert_eq!(r2.changed_cells.len(), 1);
        assert_eq!(r2.errors.len(), 1);
        assert_eq!(r2.validation_annotations.len(), 1);
        assert_eq!(r2.validation_annotations[0].column, 2);
        assert_eq!(
            r2.validation_annotations[0].expected_type,
            SchemaType::Email
        );
        assert_eq!(r2.validation_annotations[0].errors.len(), 1);
    }

    #[test]
    fn recalc_result_serde_backward_compat() {
        // JSON without validation_annotations should deserialize with empty vec (serde default)
        let json = r#"{"changedCells":[],"projectionChanges":[],"errors":[]}"#;
        let r: RecalcResult = serde_json::from_str(json).unwrap();
        assert!(r.validation_annotations.is_empty());
    }

    #[test]
    fn cell_edit_serde_roundtrip() {
        let ce = CellEdit {
            sheet_id: "s1".into(),
            cell_id: "c1".into(),
            row: 5,
            col: 3,
            value: CellValue::Boolean(true),
            formula: Some("=TRUE".into()),
            identity_formula: None,
        };
        let json = serde_json::to_string(&ce).unwrap();
        let ce2: CellEdit = serde_json::from_str(&json).unwrap();
        assert_eq!(ce2.row, 5);
        assert_eq!(ce2.col, 3);
        assert_eq!(ce2.value, CellValue::Boolean(true));
    }

    #[test]
    fn parse_result_serde_roundtrip() {
        let pr = ParseResult {
            valid: true,
            error: None,
            references: vec!["A1".into(), "B2".into()],
            functions: vec!["SUM".into()],
        };
        let json = serde_json::to_string(&pr).unwrap();
        let pr2: ParseResult = serde_json::from_str(&json).unwrap();
        assert!(pr2.valid);
        assert_eq!(pr2.references.len(), 2);
        assert_eq!(pr2.functions, vec!["SUM"]);
    }

    #[test]
    fn cell_edit_with_identity_formula_serde_roundtrip() {
        let ce = CellEdit {
            sheet_id: "s1".into(),
            cell_id: "c1".into(),
            row: 0,
            col: 0,
            value: CellValue::number(50.0),
            formula: Some("=SUM(A1)".into()),
            identity_formula: Some(sample_identity_formula()),
        };
        let json = serde_json::to_string(&ce).unwrap();
        let ce2: CellEdit = serde_json::from_str(&json).unwrap();
        assert_eq!(ce2.identity_formula, Some(sample_identity_formula()));
    }

    #[test]
    fn cell_change_position_none_roundtrip() {
        // sub-scope sub-scope D: CellChange carries Option<CellPosition>.
        // A `None` position must serialize as an omitted/null field and
        // deserialize back to `None` — no `u32::MAX` sentinel in the wire form.
        let c = CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: None,
            value: CellValue::number(1.0),
            display_text: None,
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        };
        let json = serde_json::to_string(&c).unwrap();
        // skip_serializing_if = "Option::is_none" omits the field entirely.
        assert!(
            !json.contains("\"position\""),
            "position should be skipped when None: {json}"
        );
        // Must not contain the old sentinel value.
        assert!(
            !json.contains("4294967295"),
            "no u32::MAX sentinel should appear: {json}"
        );
        let c2: CellChange = serde_json::from_str(&json).unwrap();
        assert!(c2.position.is_none());
    }

    #[test]
    fn cell_change_position_some_roundtrip() {
        let c = CellChange {
            cell_id: "c1".into(),
            sheet_id: "s1".into(),
            position: Some(CellPosition { row: 3, col: 7 }),
            value: CellValue::number(42.0),
            display_text: None,
            old_display_text: None,
            old_formula: None,
            new_formula: None,
            number_format: None,
            format_idx: None,
            extra_flags: 0,
            old_value: None,
        };
        let json = serde_json::to_string(&c).unwrap();
        let c2: CellChange = serde_json::from_str(&json).unwrap();
        assert_eq!(c2.position, Some(CellPosition { row: 3, col: 7 }));
    }

    #[test]
    fn cell_edit_effective_identity_formula() {
        let ce = CellEdit {
            sheet_id: "s".into(),
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: Some(sample_identity_formula()),
        };
        assert!(ce.effective_identity_formula().is_some());

        let ce2 = CellEdit {
            sheet_id: "s".into(),
            cell_id: "c".into(),
            row: 0,
            col: 0,
            value: CellValue::Null,
            formula: None,
            identity_formula: None,
        };
        assert!(ce2.effective_identity_formula().is_none());
    }
}
