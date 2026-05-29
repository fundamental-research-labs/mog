//! Query-specific return types — re-exported from `snapshot-types`.

pub use snapshot_types::queries::*;

use formula_types::IdentityFormula;
use serde::{Deserialize, Serialize};

/// Result returned by pre-commit circular-reference validation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulaCircularReferenceValidation {
    pub cell_address: String,
    pub formula: String,
}

/// Wire type for returning defined names through the bridge.
///
/// Unlike `domain_types::DefinedName` which stores `refers_to` as a plain
/// string, this type carries the `IdentityFormula` directly — strongly typed,
/// no ambiguity about the format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinedNameWire {
    pub id: String,
    pub name: String,
    /// The reference as an IdentityFormula (CellId-based, not A1).
    pub refers_to: IdentityFormula,
    pub scope: formula_types::Scope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    #[serde(default = "default_true")]
    pub visible: bool,
}

fn default_true() -> bool {
    true
}
