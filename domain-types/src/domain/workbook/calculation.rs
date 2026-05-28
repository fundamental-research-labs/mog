//! Workbook calculation settings.

use serde::{Deserialize, Serialize};

// ============================================================================
// Calculation Mode
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalcMode {
    #[default]
    Auto,
    AutoNoTable,
    Manual,
}

// ============================================================================
// Reference Mode
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefMode {
    #[default]
    A1,
    R1C1,
}

// ============================================================================
// Calculation Properties (full OOXML CalcPr)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculationProperties {
    // Core iterative calc
    pub iterate: bool,
    pub iterate_count: u32,
    pub iterate_delta: f64,

    // Calc behavior
    pub calc_mode: CalcMode,
    pub full_calc_on_load: bool,
    pub ref_mode: RefMode,
    pub full_precision: bool,
    pub calc_completed: bool,
    pub calc_on_save: bool,

    // Concurrency
    pub concurrent_calc: bool,
    pub concurrent_manual_count: Option<u32>,

    // Engine state
    pub calc_id: Option<u32>,
    pub force_full_calc: bool,

    // Round-trip fidelity flags
    pub has_explicit_iterate_count: bool,
    pub has_explicit_iterate_delta: bool,
}

impl Default for CalculationProperties {
    fn default() -> Self {
        Self {
            iterate: false,
            iterate_count: 100,
            iterate_delta: 0.001,
            calc_mode: CalcMode::Auto,
            full_calc_on_load: false,
            ref_mode: RefMode::A1,
            full_precision: true,
            calc_completed: true,
            calc_on_save: true,
            concurrent_calc: true,
            concurrent_manual_count: None,
            calc_id: None,
            force_full_calc: false,
            has_explicit_iterate_count: false,
            has_explicit_iterate_delta: false,
        }
    }
}
