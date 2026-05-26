//! `CsvImportOptions` — caller-supplied import knobs.
//!
//! Lives in its own module so the bridge type generator can read just
//! this file as a source for emitting the TS interface. Keeping it free
//! of cross-crate type references (no `ParseOutput`, no domain_types)
//! avoids dragging the type generator into the wider workspace's
//! type graph.

use serde::{Deserialize, Serialize};

/// Excel's hard row limit (per worksheet).
pub const DEFAULT_MAX_ROWS: u32 = 1_048_576;
/// Excel's hard column limit (per worksheet).
pub const DEFAULT_MAX_COLS: u32 = 16_384;

fn default_max_rows() -> u32 {
    DEFAULT_MAX_ROWS
}
fn default_max_cols() -> u32 {
    DEFAULT_MAX_COLS
}

/// Caller-supplied knobs for a single CSV import.
///
/// Every field is optional with a defensible default so callers can start
/// with `CsvImportOptions::default()` and override only what they need.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportOptions {
    /// Single-character delimiter override. `None` → auto-detect from the
    /// first 8 KB. Wire-encoded as a string for legibility (`","`, `"\t"`,
    /// `";"`); validated to one char in Rust.
    #[serde(default)]
    pub delimiter: Option<String>,

    /// Encoding name (`"utf-8"`, `"utf-16le"`, etc.). `None` → auto-detect via
    /// BOM sniff and `chardetng` fallback.
    #[serde(default)]
    pub encoding: Option<String>,

    /// `None` → don't promote any row to header. Reserved; the parser does
    /// not currently treat the first row specially (Excel loads it into
    /// row 0 and lets the user format it later).
    #[serde(default)]
    pub has_header_row: Option<bool>,

    /// CSV-injection guardrail. Default `false` — leading `=`/`+`/`-`/`@`/`\t`
    /// is stored as text. Set to `true` only when the caller deliberately
    /// re-imports a previously-exported workbook.
    #[serde(default)]
    pub evaluate_formulas: bool,

    /// Sheet name for the single sheet produced by import. `None` → defaults
    /// to `"Sheet1"`.
    #[serde(default)]
    pub sheet_name: Option<String>,

    /// Excel row limit by default. Rows beyond this are dropped with a
    /// `TruncatedRows` warning rather than rejected.
    #[serde(default = "default_max_rows")]
    pub max_rows: u32,

    /// Excel column limit by default.
    #[serde(default = "default_max_cols")]
    pub max_cols: u32,

    /// BCP-47 locale tag. Wired but unused this round (en-US semantics
    /// always). Future locale-aware round consumes it.
    #[serde(default)]
    pub locale: Option<String>,
}

impl Default for CsvImportOptions {
    fn default() -> Self {
        Self {
            delimiter: None,
            encoding: None,
            has_header_row: None,
            evaluate_formulas: false,
            sheet_name: None,
            max_rows: DEFAULT_MAX_ROWS,
            max_cols: DEFAULT_MAX_COLS,
            locale: None,
        }
    }
}
