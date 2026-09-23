//! XLSX export — domain types in, .xlsx bytes out.

use crate::error::XlsxApiError;
use crate::file_output::{self, Publication, context};
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
/// Serialization failure leaves an existing destination intact. Filesystems
/// without rename support use a non-atomic copy of the completed export.
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
    export_owned_parse_output_to_path_with_publication(output, path).map(|_| ())
}

/// Export an owned projection and report whether publication required copying.
pub fn export_owned_parse_output_to_path_with_publication(
    output: ParseOutput,
    path: impl AsRef<std::path::Path>,
) -> Result<Publication, XlsxApiError> {
    use std::io::Write;
    let path = path.as_ref();
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(std::path::Path::new("."));
    let mut temporary = file_output::temporary_in(parent).map_err(io_error)?;
    let mut sink = std::io::BufWriter::new(temporary.as_file_mut());
    xlsx_parser::write::from_parse_output::write_xlsx_from_owned_parse_output_to(
        output, &mut sink,
    )?;
    sink.flush()
        .map_err(|error| io_error(context("flush temporary export for", path, error)))?;
    drop(sink);
    match std::fs::metadata(path) {
        Ok(metadata) => {
            if let Err(error) = temporary.as_file().set_permissions(metadata.permissions())
                && error.kind() != std::io::ErrorKind::Unsupported
            {
                return Err(io_error(context(
                    "set temporary export permissions for",
                    path,
                    error,
                )));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_error(context("read destination metadata", path, error))),
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| io_error(context("sync temporary export for", path, error)))?;
    file_output::publish(temporary.into_temp_path(), path, true)
        .map_err(|error| io_error(error.error))
}

fn io_error(error: std::io::Error) -> XlsxApiError {
    XlsxApiError::Export(error.to_string())
}

/// Export an owned projection, avoiding a workbook clone during writer preflight.
pub fn export_owned_parse_output(output: ParseOutput) -> Result<Vec<u8>, XlsxApiError> {
    xlsx_parser::write::from_parse_output::write_xlsx_from_owned_parse_output(output)
        .map_err(XlsxApiError::from)
}
