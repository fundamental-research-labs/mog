//! XLSX export — domain types in, .xlsx bytes out.

use crate::error::XlsxApiError;
use domain_types::ParseOutput;
pub use xlsx_parser::write::ExportReport;

/// Export from a `ParseOutput` — the unified export path.
///
/// This is the primary path: Yrs → `ParseOutput` → `write_xlsx_from_parse_output` → bytes.
/// Uses the same `ParseOutput` type that the XLSX parser emits, enabling both
/// round-trip and clean export through a single writer.
pub fn export_from_parse_output(output: &ParseOutput) -> Result<Vec<u8>, XlsxApiError> {
    xlsx_parser::write::from_parse_output::write_xlsx_from_parse_output(output)
        .map_err(XlsxApiError::from)
}

pub fn export_from_parse_output_with_report(
    output: &ParseOutput,
) -> Result<(Vec<u8>, ExportReport), XlsxApiError> {
    xlsx_parser::write::from_parse_output::write_xlsx_from_parse_output_with_report(output)
        .map_err(XlsxApiError::from)
}
