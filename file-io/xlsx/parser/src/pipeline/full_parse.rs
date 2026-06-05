//! Native full-parse pipeline facade for XLSX files.
//!
//! Public native entrypoints stay here while the implementation lives in
//! child modules under `pipeline/full_parse/`.

mod deferred_metadata;
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

pub use deferred_metadata::DeferredWorkbookMetadata;

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
    implementation::parse_xlsx_full_native_impl(
        xlsx_data,
        timings,
        implementation::SheetParseSelection::All,
    )
}

/// Parse XLSX with a limit on full sheet parsing. Sheets beyond `max_sheets`
/// get only metadata with empty cell vectors.
pub fn parse_xlsx_full_native_max_sheets(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
    max_sheets: usize,
) -> Result<FullParseResult, String> {
    implementation::parse_xlsx_full_native_impl(
        xlsx_data,
        timings,
        implementation::SheetParseSelection::Prefix(max_sheets),
    )
}

/// Parse XLSX with full worksheet parsing limited to explicit editable sheet
/// indices. Unselected worksheets get metadata-only sheet payloads.
pub fn parse_xlsx_full_native_selected_sheets(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
    selected_sheet_indices: &[usize],
) -> Result<FullParseResult, String> {
    implementation::parse_xlsx_full_native_impl(
        xlsx_data,
        timings,
        implementation::SheetParseSelection::EditableIndices(
            selected_sheet_indices.iter().copied().collect(),
        ),
    )
}

/// Read workbook-level deferred import metadata without parsing worksheet cell
/// payloads.
pub fn parse_deferred_workbook_metadata(
    xlsx_data: &[u8],
) -> Result<DeferredWorkbookMetadata, String> {
    deferred_metadata::parse_deferred_workbook_metadata_impl(xlsx_data)
}

/// Select the initial visible editable workbook-order sheet index from
/// deferred workbook metadata.
pub fn select_initial_active_visible_workbook_index(
    metadata: &DeferredWorkbookMetadata,
) -> Result<u32, String> {
    deferred_metadata::select_initial_active_visible_workbook_index_impl(metadata)
}

/// Parse XLSX with full worksheet parsing limited to explicit workbook-order
/// sheet indices. `FullParseResult.sheets` contains selected editable
/// worksheets only; unselected workbook tabs remain inventory-only.
pub fn parse_xlsx_full_native_selected_workbook_sheets(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
    selected_workbook_indices: &[u32],
    metadata: &DeferredWorkbookMetadata,
) -> Result<FullParseResult, String> {
    let metadata_indices: std::collections::BTreeSet<u32> = metadata
        .workbook_sheet_inventory
        .iter()
        .map(|entry| entry.workbook_order)
        .collect();
    if let Some(index) = selected_workbook_indices
        .iter()
        .find(|index| !metadata_indices.contains(index))
    {
        return Err(format!(
            "selected workbook sheet index {index} was not present in deferred workbook metadata"
        ));
    }

    implementation::parse_xlsx_full_native_impl(
        xlsx_data,
        timings,
        implementation::SheetParseSelection::WorkbookIndices(
            selected_workbook_indices.iter().copied().collect(),
        ),
    )
}

/// Parse XLSX with only the initial active visible worksheet fully parsed.
/// Other editable worksheets get metadata-only sheet payloads.
pub fn parse_xlsx_full_native_initial_active_visible_sheet(
    xlsx_data: &[u8],
    timings: Option<&mut ParseTimings>,
) -> Result<FullParseResult, String> {
    implementation::parse_xlsx_full_native_impl(
        xlsx_data,
        timings,
        implementation::SheetParseSelection::InitialActiveVisible,
    )
}
