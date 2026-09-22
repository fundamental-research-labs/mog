//! XLSX export — domain types in, .xlsx bytes out.

use crate::error::XlsxApiError;
use domain_types::ParseOutput;
pub use xlsx_parser::write::ExportReport;

/// Export from a `ParseOutput` — the unified export path.
///
/// This is the primary path: Native workbook state → `ParseOutput` → `write_xlsx_from_parse_output` → bytes.
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

/// Stream serialized parts and their deflated data directly to the output sink.
///
/// Checks the package graph before writing.
pub fn export_from_parse_output_to<W: std::io::Write>(
    output: &ParseOutput,
    sink: W,
) -> Result<W, XlsxApiError> {
    xlsx_parser::write::from_parse_output::write_xlsx_from_parse_output_to(output, sink)
        .map_err(XlsxApiError::from)
}

/// Stream to a temporary file, then replace the destination.
/// A failed export leaves an existing destination intact.
pub fn export_from_parse_output_to_path(
    output: &ParseOutput,
    path: impl AsRef<std::path::Path>,
) -> Result<(), XlsxApiError> {
    export_owned_parse_output_to_path(output.clone(), path)
}

/// Stream an owned projection to a file without cloning it.
pub fn export_owned_parse_output_to_path(
    output: ParseOutput,
    path: impl AsRef<std::path::Path>,
) -> Result<(), XlsxApiError> {
    use std::io::Write;
    let path = path.as_ref();
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
    let mut sink = std::io::BufWriter::new(temporary.as_file_mut());
    xlsx_parser::write::from_parse_output::write_xlsx_from_owned_parse_output_to(
        output, &mut sink,
    )?;
    sink.flush().map_err(io_error)?;
    drop(sink);
    if let Ok(metadata) = std::fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .map_err(io_error)?;
    }
    temporary
        .persist(path)
        .map_err(|error| io_error(error.error))?;
    Ok(())
}

fn io_error(error: std::io::Error) -> XlsxApiError {
    XlsxApiError::Export(error.to_string())
}

/// Export an owned projection, avoiding a workbook clone during writer preflight.
pub fn export_owned_parse_output(output: ParseOutput) -> Result<Vec<u8>, XlsxApiError> {
    xlsx_parser::write::from_parse_output::write_xlsx_from_owned_parse_output(output)
        .map_err(XlsxApiError::from)
}
