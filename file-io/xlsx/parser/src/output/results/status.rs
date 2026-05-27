use super::*;

// =============================================================================
// ParseResult
// =============================================================================

/// Result returned from parsing an XLSX file
#[derive(Debug, Clone)]
pub struct ParseResult {
    /// Number of sheets parsed
    sheet_count: u32,
    /// Total number of cells parsed
    cell_count: u32,
    /// Parse duration in microseconds
    parse_time_us: u32,
    /// Error message if parsing failed (empty string if successful)
    error: String,
}

impl ParseResult {
    /// Returns the number of sheets parsed
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the total number of cells parsed
    pub fn cell_count(&self) -> u32 {
        self.cell_count
    }

    /// Returns the parse duration in microseconds
    pub fn parse_time_us(&self) -> u32 {
        self.parse_time_us
    }

    /// Returns the error message (empty if successful)
    pub fn error_message(&self) -> String {
        self.error.clone()
    }

    /// Returns true if parsing was successful
    pub fn is_ok(&self) -> bool {
        self.error.is_empty()
    }
}

impl ParseResult {
    /// Create a successful result
    pub fn success(sheet_count: u32, cell_count: u32, parse_time_us: u32) -> Self {
        Self {
            sheet_count,
            cell_count,
            parse_time_us,
            error: String::new(),
        }
    }

    /// Create an error result
    pub fn error(message: &str) -> Self {
        Self {
            sheet_count: 0,
            cell_count: 0,
            parse_time_us: 0,
            error: message.to_string(),
        }
    }
}

/// Result from lazy parsing
///
/// This struct provides metadata about sheets without parsing cell data.
/// Use this when you need to know sheet names and count before deciding
/// which sheets to load.
#[derive(Debug, Clone)]
pub struct LazyParseResult {
    /// Number of sheets in the workbook
    sheet_count: u32,
    /// Names of all sheets
    sheet_names: Vec<String>,
    /// Error message if parsing failed (empty string if successful)
    error: String,
}

impl LazyParseResult {
    /// Returns the number of sheets in the workbook
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the names of all sheets
    pub fn sheet_names(&self) -> Vec<String> {
        self.sheet_names.clone()
    }

    /// Returns the error message (empty if successful)
    pub fn error_message(&self) -> String {
        self.error.clone()
    }

    /// Returns true if parsing was successful
    pub fn is_ok(&self) -> bool {
        self.error.is_empty()
    }
}

impl LazyParseResult {
    /// Create a successful result
    pub fn success(sheet_count: u32, sheet_names: Vec<String>) -> Self {
        Self {
            sheet_count,
            sheet_names,
            error: String::new(),
        }
    }

    /// Create an error result
    pub fn error(message: &str) -> Self {
        Self {
            sheet_count: 0,
            sheet_names: Vec::new(),
            error: message.to_string(),
        }
    }
}

// =============================================================================
// LazyParseResultWithErrors
// =============================================================================

/// Result from lazy parsing with error recovery info
///
/// Extended version of LazyParseResult that includes error recovery information.
#[derive(Debug, Clone)]
pub struct LazyParseResultWithErrors {
    /// Number of sheets in the workbook
    sheet_count: u32,
    /// Names of all sheets
    sheet_names: Vec<String>,
    /// Number of warnings generated
    warning_count: u32,
    /// Number of errors generated
    error_count: u32,
    /// Parse mode used
    parse_mode: u32,
    /// Error message if parsing failed (empty string if successful)
    error: String,
    /// JSON array of error details for JS consumption
    errors_json: String,
}

impl LazyParseResultWithErrors {
    /// Returns the number of sheets in the workbook
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the names of all sheets
    pub fn sheet_names(&self) -> Vec<String> {
        self.sheet_names.clone()
    }

    /// Returns the number of warnings
    pub fn warning_count(&self) -> u32 {
        self.warning_count
    }

    /// Returns the number of errors
    pub fn error_count(&self) -> u32 {
        self.error_count
    }

    /// Returns the parse mode used (0=Strict, 1=Lenient, 2=Permissive)
    pub fn parse_mode(&self) -> u32 {
        self.parse_mode
    }

    /// Returns the error message (empty if successful)
    pub fn error_message(&self) -> String {
        self.error.clone()
    }

    /// Returns the errors as a JSON array for JS consumption
    pub fn errors_json(&self) -> String {
        self.errors_json.clone()
    }

    /// Returns true if parsing was successful
    pub fn is_ok(&self) -> bool {
        self.error.is_empty()
    }

    /// Returns true if parsing completed without any errors (warnings ok)
    pub fn is_clean(&self) -> bool {
        self.error.is_empty() && self.error_count == 0
    }
}

impl LazyParseResultWithErrors {
    /// Create a successful result
    pub fn success(
        sheet_count: u32,
        sheet_names: Vec<String>,
        warning_count: u32,
        error_count: u32,
        parse_mode: u32,
        errors_json: String,
    ) -> Self {
        Self {
            sheet_count,
            sheet_names,
            warning_count,
            error_count,
            parse_mode,
            error: String::new(),
            errors_json,
        }
    }

    /// Create an error result
    pub fn error(message: &str, parse_mode: u32) -> Self {
        Self {
            sheet_count: 0,
            sheet_names: Vec::new(),
            warning_count: 0,
            error_count: 0,
            parse_mode,
            error: message.to_string(),
            errors_json: String::from("[]"),
        }
    }
}

// =============================================================================
// ParseResultWithErrors
// =============================================================================

/// Result returned from parsing an XLSX file with error recovery
///
/// This struct provides detailed parsing statistics including error recovery
/// information.
#[derive(Debug, Clone)]
pub struct ParseResultWithErrors {
    /// Number of sheets parsed
    sheet_count: u32,
    /// Total number of cells parsed
    cell_count: u32,
    /// Number of cells that were skipped due to errors
    cells_skipped: u32,
    /// Number of warnings generated
    warning_count: u32,
    /// Number of errors generated
    error_count: u32,
    /// Parse duration in microseconds
    parse_time_us: u32,
    /// Fatal error message if parsing failed completely (empty string if successful)
    fatal_error: String,
    /// JSON array of error details for JS consumption
    errors_json: String,
}

impl ParseResultWithErrors {
    /// Returns the number of sheets parsed
    pub fn sheet_count(&self) -> u32 {
        self.sheet_count
    }

    /// Returns the total number of cells parsed
    pub fn cell_count(&self) -> u32 {
        self.cell_count
    }

    /// Returns the number of cells skipped due to errors
    pub fn cells_skipped(&self) -> u32 {
        self.cells_skipped
    }

    /// Returns the number of warnings generated
    pub fn warning_count(&self) -> u32 {
        self.warning_count
    }

    /// Returns the number of errors generated
    pub fn error_count(&self) -> u32 {
        self.error_count
    }

    /// Returns the parse duration in microseconds
    pub fn parse_time_us(&self) -> u32 {
        self.parse_time_us
    }

    /// Returns the fatal error message (empty if no fatal error)
    pub fn fatal_error(&self) -> String {
        self.fatal_error.clone()
    }

    /// Returns the errors as a JSON array for JS consumption
    pub fn errors_json(&self) -> String {
        self.errors_json.clone()
    }

    /// Returns true if parsing was successful (no fatal errors)
    pub fn is_ok(&self) -> bool {
        self.fatal_error.is_empty()
    }

    /// Returns true if parsing completed without any errors (warnings ok)
    pub fn is_clean(&self) -> bool {
        self.fatal_error.is_empty() && self.error_count == 0
    }
}

impl ParseResultWithErrors {
    /// Create a successful result
    pub fn success(
        sheet_count: u32,
        cell_count: u32,
        cells_skipped: u32,
        warning_count: u32,
        error_count: u32,
        parse_time_us: u32,
        errors_json: String,
    ) -> Self {
        Self {
            sheet_count,
            cell_count,
            cells_skipped,
            warning_count,
            error_count,
            parse_time_us,
            fatal_error: String::new(),
            errors_json,
        }
    }

    /// Create a fatal error result
    pub fn fatal(message: &str) -> Self {
        Self {
            sheet_count: 0,
            cell_count: 0,
            cells_skipped: 0,
            warning_count: 0,
            error_count: 0,
            parse_time_us: 0,
            fatal_error: message.to_string(),
            errors_json: String::from("[]"),
        }
    }
}

// =============================================================================
// ParseStats
// =============================================================================

/// Statistics about the parse operation
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParseStats {
    /// Total number of cells parsed across all sheets
    pub total_cells: u32,
    /// Total number of sheets in the workbook
    pub total_sheets: u32,
    /// Parse duration in microseconds (placeholder - timing done on JS side)
    pub parse_time_us: u32,
}
