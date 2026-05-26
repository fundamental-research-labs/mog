//! Bridge-specific serializable result types for the Tauri IPC boundary.
//!
//! This module provides serializable mirror types of the result types in
//! `output::results`, for use by the Tauri bridge (native desktop path).
//!
//! These types are intentionally kept in sync with their counterparts.
//! When adding fields to the result types, add them here too.

use crate::output::results::ParseTimings;

// =============================================================================
// BridgeParseTimings
// =============================================================================

/// Serializable mirror of [`ParseTimings`] for the Tauri IPC bridge.
///
/// All 34 fields match `ParseTimings` exactly.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeParseTimings {
    // --- Top-level phase timings ---
    pub zip_index_us: f64,
    pub shared_strings_us: f64,
    pub styles_us: f64,
    pub metadata_us: f64,
    pub worksheet_parse_us: f64,
    pub serde_serialize_us: f64,
    pub total_us: f64,

    // --- Shared strings sub-phase breakdown ---
    pub ss_zip_us: f64,
    pub ss_parse_refs_us: f64,
    pub ss_materialize_us: f64,
    pub ss_xml_bytes: f64,
    pub ss_count_total: f64,
    pub ss_count_plain: f64,
    pub ss_count_entities: f64,
    pub ss_count_rich_text: f64,

    // --- Worksheet sub-phase breakdown (cumulative across all sheets) ---
    pub ws_zip_decompress_us: f64,
    pub ws_cell_parse_us: f64,
    pub ws_cell_convert_us: f64,
    pub ws_postprocess_us: f64,
    pub ws_auxiliary_us: f64,
    pub ws_aux_zip_io_us: f64,

    // --- Auxiliary parser individual breakdown ---
    pub ws_aux_merge_us: f64,
    pub ws_aux_cond_fmt_us: f64,
    pub ws_aux_data_val_us: f64,
    pub ws_aux_hyperlinks_us: f64,
    pub ws_aux_protection_us: f64,
    pub ws_aux_print_us: f64,
    pub ws_aux_frozen_pane_us: f64,
    pub ws_aux_dimensions_us: f64,
    pub ws_aux_sparklines_us: f64,
}

impl From<&ParseTimings> for BridgeParseTimings {
    fn from(t: &ParseTimings) -> Self {
        Self {
            zip_index_us: t.zip_index_us(),
            shared_strings_us: t.shared_strings_us(),
            styles_us: t.styles_us(),
            metadata_us: t.metadata_us(),
            worksheet_parse_us: t.worksheet_parse_us(),
            serde_serialize_us: t.serde_serialize_us(),
            total_us: t.total_us(),
            ss_zip_us: t.ss_zip_us(),
            ss_parse_refs_us: t.ss_parse_refs_us(),
            ss_materialize_us: t.ss_materialize_us(),
            ss_xml_bytes: t.ss_xml_bytes(),
            ss_count_total: t.ss_count_total(),
            ss_count_plain: t.ss_count_plain(),
            ss_count_entities: t.ss_count_entities(),
            ss_count_rich_text: t.ss_count_rich_text(),
            ws_zip_decompress_us: t.ws_zip_decompress_us(),
            ws_cell_parse_us: t.ws_cell_parse_us(),
            ws_cell_convert_us: t.ws_cell_convert_us(),
            ws_postprocess_us: t.ws_postprocess_us(),
            ws_auxiliary_us: t.ws_auxiliary_us(),
            ws_aux_zip_io_us: t.ws_aux_zip_io_us(),
            ws_aux_merge_us: t.ws_aux_merge_us(),
            ws_aux_cond_fmt_us: t.ws_aux_cond_fmt_us(),
            ws_aux_data_val_us: t.ws_aux_data_val_us(),
            ws_aux_hyperlinks_us: t.ws_aux_hyperlinks_us(),
            ws_aux_protection_us: t.ws_aux_protection_us(),
            ws_aux_print_us: t.ws_aux_print_us(),
            ws_aux_frozen_pane_us: t.ws_aux_frozen_pane_us(),
            ws_aux_dimensions_us: t.ws_aux_dimensions_us(),
            ws_aux_sparklines_us: t.ws_aux_sparklines_us(),
        }
    }
}

// BridgeProfiledParseResult was removed — FullParseResult is now crate-private.
// External consumers should use parse_xlsx_to_output() instead.

// =============================================================================
// BridgeLazyParseResult
// =============================================================================

/// Serializable lazy parse result for the Tauri IPC bridge.
///
/// Mirror of `LazyParseResult` with serialization support.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeLazyParseResult {
    /// Whether parsing was successful
    pub ok: bool,
    /// Number of sheets in the workbook
    pub sheet_count: u32,
    /// Names of all sheets
    pub sheet_names: Vec<String>,
    /// Error message if parsing failed (empty string if successful)
    pub error_message: String,
}

// =============================================================================
// BridgeLazyParseResultWithErrors
// =============================================================================

/// Serializable lazy parse result with error recovery info for the Tauri IPC bridge.
///
/// Mirror of `LazyParseResultWithErrors` with serialization support.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeLazyParseResultWithErrors {
    /// Whether parsing was successful
    pub ok: bool,
    /// Number of sheets in the workbook
    pub sheet_count: u32,
    /// Names of all sheets
    pub sheet_names: Vec<String>,
    /// Number of warnings generated
    pub warning_count: u32,
    /// Number of errors generated
    pub error_count: u32,
    /// Parse mode used (0=Strict, 1=Lenient, 2=Permissive)
    pub mode: u32,
    /// Error message if parsing failed (empty string if successful)
    pub error_message: String,
    /// JSON array of error details
    pub errors_json: String,
}
