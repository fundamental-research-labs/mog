//! Full XLSX parse — bytes in, structured workbook data out.
//!
//! Two entry points:
//! - `parse()` — default options (Lenient, parse everything)
//! - `parse_with_options()` — configurable mode, profiling, etc.
//!
//! Returns `ParsedWorkbook` containing domain-typed `ParseOutput` and `ImportReport`.
//! The internal `FullParseResult` is no longer exposed.
//! Bridge/API output is a semantic workbook subset. Rust-internal package
//! fidelity sidecars may preserve additional OOXML during in-process export,
//! but those sidecars are not public editable API state.

use crate::error::{XlsxApiError, from_parse_string_error};
use crate::options::ParseOptions;
use domain_types::{ImportReport, ParseDiagnostics, ParseOutput};

/// Result of a successful parse. Contains domain-typed parse output.
#[derive(Debug)]
pub struct ParsedWorkbook {
    /// Semantic data: cells, merges, styles, domain objects.
    pub output: ParseOutput,
    /// Public import report with diagnostics, statistics, and recalc hints.
    pub import_report: ImportReport,
    pub diagnostics: ParseDiagnostics,
}

/// Parse an XLSX file with default options (Lenient mode, parse everything).
///
/// # Arguments
/// * `xlsx_data` — Raw bytes of the .xlsx file.
///
/// # Returns
/// * `Ok(ParsedWorkbook)` — Parsed workbook with domain-typed output.
/// * `Err(XlsxApiError)` — Fatal parse error.
///
/// # Example
/// ```ignore
/// let wb = xlsx_api::parse(&bytes)?;
/// println!("{} sheets", wb.output.sheets.len());
/// ```
pub fn parse(xlsx_data: &[u8]) -> Result<ParsedWorkbook, XlsxApiError> {
    parse_with_options(xlsx_data, &ParseOptions::new())
}

/// Parse an XLSX file with custom options.
///
/// Supports mode selection (Strict/Lenient/Permissive) and profiling.
/// Other options (skip_styles, max_cells, sheet_filter, values_only) are
/// validated but NOT yet enforced — setting them returns `UnsupportedOption`.
///
/// # Arguments
/// * `xlsx_data` — Raw bytes of the .xlsx file.
/// * `options` — Parse configuration (mode, profiling, etc.).
///
/// # Returns
/// * `Ok(ParsedWorkbook)` — Parsed workbook with domain-typed output.
/// * `Err(XlsxApiError)` — Fatal parse error or unsupported option.
pub fn parse_with_options(
    xlsx_data: &[u8],
    options: &ParseOptions,
) -> Result<ParsedWorkbook, XlsxApiError> {
    // Validate options — reject unsupported ones early
    if let Some(opt_name) = options.first_unsupported_option() {
        return Err(XlsxApiError::UnsupportedOption {
            option: opt_name.to_string(),
            reason: "parser pipeline does not yet enforce this option — see 02b-PARSE-OPTIONS-ENFORCEMENT.md".to_string(),
        });
    }

    // Route to max_sheets variant if set
    if let Some(max_sheets) = options.max_sheets {
        return parse_max_sheets(xlsx_data, max_sheets);
    }

    // Parse XLSX bytes directly into domain types via the unified pipeline.
    let (output, diagnostics) =
        xlsx_parser::parse_xlsx_to_output(xlsx_data).map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

/// Parse XLSX with a limit on full sheet parsing.
pub fn parse_max_sheets(
    xlsx_data: &[u8],
    max_sheets: usize,
) -> Result<ParsedWorkbook, XlsxApiError> {
    let (output, diagnostics) = xlsx_parser::parse_xlsx_to_output_max_sheets(xlsx_data, max_sheets)
        .map_err(from_parse_string_error)?;

    Ok(ParsedWorkbook {
        output,
        import_report: diagnostics.clone().into_import_report(),
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn import_report_exposes_force_recalc_cells() {
        let diagnostics = ParseDiagnostics {
            errors: Vec::new(),
            stats: domain_types::ParseStats {
                total_cells: 1,
                total_sheets: 1,
                parse_time_us: 10,
            },
            force_recalc_cells: HashSet::from([(0, 4, 2)]),
            import_report: None,
        };

        let report = diagnostics.into_import_report();

        assert_eq!(report.force_recalc_cells.len(), 1);
        assert_eq!(report.force_recalc_cells[0].sheet_index, 0);
        assert_eq!(report.force_recalc_cells[0].row, 4);
        assert_eq!(report.force_recalc_cells[0].col, 2);
    }
}
