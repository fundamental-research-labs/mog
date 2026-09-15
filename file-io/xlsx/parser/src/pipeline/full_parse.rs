//! Native full-parse pipeline facade for XLSX files.
//!
//! Public native entrypoints stay here while the implementation lives in
//! child modules under `pipeline/full_parse/`.

mod external_links_phase;
mod helpers;
mod implementation;
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
/// CLI tools. Worksheet inflation, cell parsing, and semantic conversion use
/// one incremental pipeline, with an optional consumer for native hydration.
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

/// The same parser with a consumer that takes ownership of streamed values.
pub(crate) fn parse_xlsx_with_sink(
    xlsx_data: &[u8],
    sink: &mut dyn crate::pipeline::streaming::XlsxCellSink,
) -> Result<FullParseResult, String> {
    implementation::parse_xlsx_full_native_impl(xlsx_data, None, Some(sink))
}
