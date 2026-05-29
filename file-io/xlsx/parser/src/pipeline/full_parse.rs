//! Native full-parse pipeline facade for XLSX files.
//!
//! Public native entrypoints stay here while the implementation lives in
//! child modules under `pipeline/full_parse/`.

mod external_links_phase;
mod helpers;
mod implementation;
mod metadata_only;
mod non_editable_sheets;
mod theme_discovery;
mod timing;
mod workbook_disposition;
mod workbook_xml_fidelity;

pub(crate) use helpers::extract_attr_value;

use crate::output::results::{FullParseResult, ParseTimings};

/// Parse an XLSX file from raw bytes and return a full structured result.
///
/// This is the core parse pipeline shared between WASM entry points and native
/// CLI tools. It performs all the same steps as the WASM `parse_xlsx_full` but
/// returns a native `Result<FullParseResult, String>` instead of `Result<JsValue, JsValue>`.
///
/// # Profiling
///
/// Pass `Some(&mut ParseTimings::zero())` to enable detailed phase timing.
/// Pass `None` for production.
pub fn parse_xlsx_full_native(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
) -> Result<FullParseResult, String> {
    implementation::parse_xlsx_full_native_impl(xlsx_data, timings, None)
}

/// Parse XLSX with a limit on full sheet parsing. Sheets beyond `max_sheets`
/// get only metadata with empty cell vectors.
pub fn parse_xlsx_full_native_max_sheets(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
    max_sheets: usize,
) -> Result<FullParseResult, String> {
    implementation::parse_xlsx_full_native_impl(xlsx_data, timings, Some(max_sheets))
}
