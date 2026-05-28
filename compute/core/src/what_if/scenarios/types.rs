use std::collections::HashMap;

use crate::snapshot::{ScenarioActiveState, ScenarioApplyResult, ScenarioRestoreResult};
use cell_types::{CellId, SheetId};
use formula_types::IdentityFormula;
use value_types::CellValue;

// =============================================================================
// Constants (matching TypeScript contracts)
// =============================================================================

/// Maximum number of scenarios allowed per workbook (Excel limit).
pub const MAX_SCENARIOS: usize = 251;

/// Maximum number of changing cells per scenario (Excel limit).
pub const MAX_CHANGING_CELLS_PER_SCENARIO: usize = 32;

/// Maximum length of scenario name.
pub const MAX_SCENARIO_NAME_LENGTH: usize = 255;

/// Maximum length of scenario comment.
pub const MAX_SCENARIO_COMMENT_LENGTH: usize = 255;

pub(super) const SESSION_DOCUMENT_ID: &str = "local-compute-session";

// =============================================================================
// Session-scoped apply/restore state
// =============================================================================

/// Scenario apply/restore state owned by one live compute engine session.
///
/// This deliberately does not serialize to Yrs. A scenario apply captures a
/// baseline in memory, writes scenario values through a single engine mutation,
/// and restore consumes that baseline through another engine mutation.
#[derive(Debug, Clone, Default)]
pub(crate) struct ScenarioSessionState {
    pub active: Option<ScenarioActiveState>,
    pub baselines: HashMap<String, ScenarioBaseline>,
}

#[derive(Debug, Clone)]
pub(crate) struct ScenarioBaseline {
    pub baseline_id: String,
    pub scenario_id: String,
    pub document_id: String,
    pub originals: Vec<ScenarioBaselineCell>,
}

#[derive(Debug, Clone)]
pub(crate) struct ScenarioBaselineCell {
    pub sheet_id: SheetId,
    pub cell_id: CellId,
    pub value: CellValue,
    pub formula: Option<IdentityFormula>,
}

pub(crate) struct ScenarioApplyPlan {
    pub baseline: ScenarioBaseline,
    pub edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    pub result: ScenarioApplyResult,
}

pub(crate) struct ScenarioRestorePlan {
    pub baseline_id: String,
    pub edits: Vec<(SheetId, CellId, u32, u32, CellValue, Option<String>)>,
    pub result: ScenarioRestoreResult,
}
