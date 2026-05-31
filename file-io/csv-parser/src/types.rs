//! Public types: parse result, error / warning enums.
//!
//! `CsvImportOptions` lives in its own module ([`crate::options`]) so the
//! bridge type generator can read just that file without dragging in the
//! domain-types graph.

use thiserror::Error;

use domain_types::ParseOutput;

/// Result of a successful CSV import.
///
/// `output` carries the per-cell `style_id` references and the 4-entry
/// style palette (`General`, `m/d/yyyy`, `h:mm:ss`, `@`). The `warnings`
/// channel surfaces recoverable parser observations — the caller should
/// NOT treat a non-empty warnings vec as failure.
#[derive(Debug, Clone)]
pub struct CsvParseResult {
    /// Single-sheet `ParseOutput` ready for the existing XLSX hydration
    /// path (`hydrate_from_parse_output` →
    /// `parse_output_to_workbook_snapshot`).
    pub output: ParseOutput,
    /// Recoverable observations made during parse.
    pub warnings: Vec<CsvWarning>,
    /// Encoding label that decoded the bytes (`"UTF-8"`, `"UTF-16LE"`, …).
    pub detected_encoding: String,
    /// Field separator the dialect sniffer chose (typically `,`).
    pub detected_delimiter: char,
    /// Logical row count after empty-tail trimming and limit truncation.
    pub row_count: u32,
    /// Maximum column count seen across rows after limit truncation.
    pub col_count: u32,
}

/// Recoverable parser observation. Surfaced through `tracing::warn!` so it
/// never crosses the bridge as a TS error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CsvWarning {
    /// Input was 0 bytes or only a BOM. The parser still produced an
    /// empty single-sheet output.
    EmptyInput,
    /// A non-UTF-8 decoder was used for lenient import.
    EncodingFallback { from: String, to: String },
    /// BOM-less default UTF-8 decode found malformed byte sequences. The
    /// parser replaced each invalid sequence with U+FFFD and continued.
    MalformedUtf8,
    /// A row produced fewer or more columns than the header row. The parser
    /// keeps the row at its actual width; the UI may want to flag this.
    MismatchedRowWidth {
        row: u32,
        expected: u32,
        actual: u32,
    },
    /// A quoted field was not closed before the end of input. The `csv`
    /// crate's relaxed mode auto-closes; this records the row that triggered
    /// the recovery so the user can inspect.
    UnbalancedQuote { row: u32 },
    /// Parse exceeded `max_rows`; trailing rows were dropped.
    TruncatedRows { kept: u32, dropped: u32 },
    /// Parse exceeded `max_cols`; trailing columns of every row were dropped.
    TruncatedCols { kept: u32, dropped: u32 },
}

/// Hard parse failure. Currently rare — the parser favours warnings + best
/// effort over erroring. Reserved for genuinely undecodable input.
#[derive(Debug, Error)]
pub enum CsvParseError {
    /// The user-supplied `encoding` label was unknown to `encoding_rs`.
    #[error("Could not decode CSV bytes: {0}")]
    UnreadableEncoding(String),

    /// User supplied `delimiter` longer than one byte.
    #[error("Invalid delimiter override: {0:?} — must be a single ASCII byte")]
    InvalidDelimiter(String),

    /// Underlying `csv` crate raised a non-recoverable error.
    #[error("CSV reader error at byte offset {position}: {source}")]
    Reader {
        position: u64,
        #[source]
        source: csv::Error,
    },
}
