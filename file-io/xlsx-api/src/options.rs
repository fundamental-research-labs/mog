//! Parse options with builder pattern.
//!
//! Options are validated by xlsx-api but NOT yet enforced by the parser pipeline.
//! Setting options that the parser doesn't support will return
//! `Err(XlsxApiError::UnsupportedOption { .. })` at parse time.

pub use xlsx_parser::infra::error::ParseMode;

/// Options controlling XLSX parse behavior.
///
/// Use the builder methods to configure, then pass to `parse_with_options()`.
///
/// # Example
/// ```ignore
/// use xlsx_api::ParseOptions;
///
/// let opts = ParseOptions::new()
///     .strict()
///     .profiled();
/// ```
#[derive(Debug, Clone)]
pub struct ParseOptions {
    /// Parse mode: Strict, Lenient (default), or Permissive.
    pub mode: ParseMode,
    /// Maximum number of cells to parse. None = unlimited.
    pub max_cells: Option<usize>,
    /// Skip stylesheet parsing.
    pub skip_styles: bool,
    /// Skip chart parsing.
    pub skip_charts: bool,
    /// Skip drawing/image parsing.
    pub skip_drawings: bool,
    /// Skip comment parsing.
    pub skip_comments: bool,
    /// Skip data validation rules.
    pub skip_data_validation: bool,
    /// Skip conditional formatting rules.
    pub skip_conditional_formatting: bool,
    /// Only parse sheets with these names. None = parse all.
    pub sheet_filter: Option<Vec<String>>,
    /// Maximum number of sheets to parse (cell data + auxiliary).
    /// Remaining sheets get metadata only (name, dimensions, visibility).
    /// None = parse all sheets.
    pub max_sheets: Option<usize>,
    /// Skip formulas, return only cached/computed values.
    pub values_only: bool,
    /// Include microsecond-precision phase timings in the result.
    pub profiled: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self::new()
    }
}

impl ParseOptions {
    /// Create default options: Lenient mode, no limits, parse everything, no profiling.
    pub fn new() -> Self {
        Self {
            mode: ParseMode::Lenient,
            max_cells: None,
            skip_styles: false,
            skip_charts: false,
            skip_drawings: false,
            skip_comments: false,
            skip_data_validation: false,
            skip_conditional_formatting: false,
            sheet_filter: None,
            max_sheets: None,
            values_only: false,
            profiled: false,
        }
    }

    /// Set strict mode (fail on first error).
    pub fn strict(mut self) -> Self {
        self.mode = ParseMode::Strict;
        self
    }

    /// Set lenient mode (skip errors, collect warnings).
    pub fn lenient(mut self) -> Self {
        self.mode = ParseMode::Lenient;
        self
    }

    /// Set permissive mode (maximum recovery).
    pub fn permissive(mut self) -> Self {
        self.mode = ParseMode::Permissive;
        self
    }

    /// Limit the maximum number of cells to parse.
    pub fn max_cells(mut self, n: usize) -> Self {
        self.max_cells = Some(n);
        self
    }

    /// Skip stylesheet parsing.
    pub fn skip_styles(mut self) -> Self {
        self.skip_styles = true;
        self
    }

    /// Skip chart parsing.
    pub fn skip_charts(mut self) -> Self {
        self.skip_charts = true;
        self
    }

    /// Skip drawing/image parsing.
    pub fn skip_drawings(mut self) -> Self {
        self.skip_drawings = true;
        self
    }

    /// Skip comment parsing.
    pub fn skip_comments(mut self) -> Self {
        self.skip_comments = true;
        self
    }

    /// Skip data validation rules.
    pub fn skip_data_validation(mut self) -> Self {
        self.skip_data_validation = true;
        self
    }

    /// Skip conditional formatting rules.
    pub fn skip_conditional_formatting(mut self) -> Self {
        self.skip_conditional_formatting = true;
        self
    }

    /// Only parse sheets with the given names.
    pub fn sheets(mut self, names: &[&str]) -> Self {
        self.sheet_filter = Some(names.iter().map(|s| s.to_string()).collect());
        self
    }

    /// Only parse cell data for the first N sheets. Remaining sheets get
    /// metadata only (name, dimensions, visibility, no cells).
    pub fn max_sheets(mut self, n: usize) -> Self {
        self.max_sheets = Some(n);
        self
    }

    /// Skip formulas, return only cached/computed values.
    pub fn values_only(mut self) -> Self {
        self.values_only = true;
        self
    }

    /// Include microsecond-precision phase timings in the result.
    pub fn profiled(mut self) -> Self {
        self.profiled = true;
        self
    }

    /// Check if any options are set that the parser doesn't yet enforce.
    /// Returns the name of the first unsupported option, or None if all are supported.
    pub(crate) fn first_unsupported_option(&self) -> Option<&'static str> {
        if self.max_cells.is_some() {
            return Some("max_cells");
        }
        if self.skip_styles {
            return Some("skip_styles");
        }
        if self.skip_charts {
            return Some("skip_charts");
        }
        if self.skip_drawings {
            return Some("skip_drawings");
        }
        if self.skip_comments {
            return Some("skip_comments");
        }
        if self.skip_data_validation {
            return Some("skip_data_validation");
        }
        if self.skip_conditional_formatting {
            return Some("skip_conditional_formatting");
        }
        if self.sheet_filter.is_some() {
            return Some("sheet_filter");
        }
        if self.values_only {
            return Some("values_only");
        }
        None
    }
}
