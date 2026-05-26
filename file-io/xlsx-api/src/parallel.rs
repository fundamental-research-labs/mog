//! Parallel XLSX parsing using rayon.
//!
//! Available only with the `parallel` feature (implies `native`).
//! Shared strings are parsed sequentially, then worksheets in parallel.

use crate::error::XlsxApiError;
use xlsx_parser::pipeline::parallel::{ParallelParseError, ParallelParseResult};

/// Result of a parallel XLSX parse.
///
/// Unlike [`crate::parse::ParsedWorkbook`] (which wraps `ParseOutput` with domain-typed
/// cells, styles, and metadata), the parallel pipeline returns a lightweight
/// cell-oriented representation: per-sheet `Vec<CellData>` with raw byte strings.
///
/// This is intentional — parallel parsing is optimized for throughput on large files,
/// not for full-fidelity workbook reconstruction. Use [`crate::parse::parse`] when you
/// need the complete workbook model.
#[derive(Debug)]
pub struct ParallelParsedWorkbook {
    /// The raw parallel parse result (sheets with cell data and strings).
    pub result: ParallelParseResult,
}

impl ParallelParsedWorkbook {
    /// Number of sheets parsed.
    pub fn sheet_count(&self) -> usize {
        self.result.sheet_count
    }

    /// Total cell count across all sheets.
    pub fn total_cells(&self) -> usize {
        self.result.total_cells
    }
}

/// Parse an XLSX file using rayon for multi-sheet parallelism.
///
/// The shared string table is parsed sequentially (it's a single entry),
/// then each worksheet is decompressed and parsed in parallel.
///
/// Returns a [`ParallelParsedWorkbook`] with a lightweight cell-oriented result.
/// For a full-fidelity workbook (styles, metadata, etc.), use [`crate::parse::parse`].
///
/// Requires the `parallel` feature flag.
///
/// # Arguments
/// * `xlsx_data` — Raw bytes of the .xlsx file.
///
/// # Example
/// ```ignore
/// use xlsx_api::parallel::parallel_parse;
///
/// let bytes = std::fs::read("large_workbook.xlsx")?;
/// let wb = parallel_parse(&bytes)?;
/// println!("{} sheets, {} cells", wb.sheet_count(), wb.total_cells());
/// ```
pub fn parallel_parse(xlsx_data: &[u8]) -> Result<ParallelParsedWorkbook, XlsxApiError> {
    let result = xlsx_parser::pipeline::parallel::parse_xlsx_parallel(xlsx_data)
        .map_err(map_parallel_error)?;

    Ok(ParallelParsedWorkbook { result })
}

/// Parse an XLSX file with parallel decompression *and* parsing.
///
/// This variant also parallelizes the ZIP decompression step, which can provide
/// additional speedup for files with many sheets.
///
/// # Arguments
/// * `xlsx_data` — Raw bytes of the .xlsx file.
pub fn parallel_parse_full(xlsx_data: &[u8]) -> Result<ParallelParsedWorkbook, XlsxApiError> {
    let result = xlsx_parser::pipeline::parallel::parse_xlsx_parallel_full(xlsx_data)
        .map_err(map_parallel_error)?;

    Ok(ParallelParsedWorkbook { result })
}

/// Map `ParallelParseError` to `XlsxApiError`.
fn map_parallel_error(e: ParallelParseError) -> XlsxApiError {
    match e {
        ParallelParseError::ArchiveError(msg) => {
            if msg.contains("not a valid ZIP") || msg.contains("Invalid XLSX") {
                XlsxApiError::InvalidArchive(msg)
            } else {
                XlsxApiError::CorruptedArchive(msg)
            }
        }
        ParallelParseError::WorksheetError { sheet_idx, message } => XlsxApiError::MalformedXml {
            part: format!("sheet{}", sheet_idx + 1),
            message,
        },
    }
}
