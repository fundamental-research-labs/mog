use super::detail::{ErrorLocation, ParseErrorDetail};
use super::types::{ErrorCode, ErrorSeverity, ParseMode};

/// Collects errors during parsing
#[derive(Debug, Clone)]
pub struct ErrorCollector {
    mode: ParseMode,
    errors: Vec<ParseErrorDetail>,
    max_errors: usize,
    has_fatal: bool,
}

impl Default for ErrorCollector {
    fn default() -> Self {
        Self::new(ParseMode::default())
    }
}

impl ErrorCollector {
    /// Default maximum errors to collect
    pub const DEFAULT_MAX_ERRORS: usize = 1000;

    /// Create a new error collector with the specified mode
    pub fn new(mode: ParseMode) -> Self {
        Self {
            mode,
            errors: Vec::new(),
            max_errors: Self::DEFAULT_MAX_ERRORS,
            has_fatal: false,
        }
    }

    /// Create a new error collector with custom max errors limit
    pub fn with_max_errors(mode: ParseMode, max: usize) -> Self {
        Self {
            mode,
            errors: Vec::new(),
            max_errors: max,
            has_fatal: false,
        }
    }

    /// Add an error to the collection
    ///
    /// Returns `true` if parsing should continue, `false` if it should stop.
    pub fn add_error(&mut self, error: ParseErrorDetail) -> bool {
        if error.severity == ErrorSeverity::Fatal {
            self.has_fatal = true;
        }

        // In strict mode, any error should stop parsing
        if self.mode == ParseMode::Strict && error.severity >= ErrorSeverity::Error {
            self.errors.push(error);
            return false;
        }

        // Store error if we haven't hit the limit
        if self.errors.len() < self.max_errors {
            self.errors.push(error.clone());
        }

        // Determine if we should continue
        self.should_continue(error.severity)
    }

    /// Add a warning with minimal information
    pub fn add_warning(&mut self, code: ErrorCode, message: &str, location: Option<ErrorLocation>) {
        let mut error = ParseErrorDetail::warning(code, message);
        if let Some(loc) = location {
            error.location = Some(loc);
        }
        self.add_error(error);
    }

    /// Check if parsing should continue given an error severity
    pub fn should_continue(&self, severity: ErrorSeverity) -> bool {
        match self.mode {
            ParseMode::Strict => severity < ErrorSeverity::Error,
            ParseMode::Lenient => severity < ErrorSeverity::Fatal,
            ParseMode::Permissive => severity < ErrorSeverity::Fatal,
        }
    }

    /// Get all collected errors
    pub fn errors(&self) -> &[ParseErrorDetail] {
        &self.errors
    }

    /// Check if a fatal error has occurred
    pub fn has_fatal_error(&self) -> bool {
        self.has_fatal
    }

    /// Get the total number of errors (excluding warnings)
    pub fn error_count(&self) -> usize {
        self.errors
            .iter()
            .filter(|e| e.severity >= ErrorSeverity::Error)
            .count()
    }

    /// Get the number of warnings
    pub fn warning_count(&self) -> usize {
        self.errors
            .iter()
            .filter(|e| e.severity == ErrorSeverity::Warning)
            .count()
    }

    /// Get the current parse mode
    pub fn mode(&self) -> ParseMode {
        self.mode
    }

    /// Consume the collector and return all errors
    pub fn into_errors(self) -> Vec<ParseErrorDetail> {
        self.errors
    }

    /// Check if any errors were collected
    pub fn has_errors(&self) -> bool {
        !self.errors.is_empty()
    }

    /// Clear all collected errors
    pub fn clear(&mut self) {
        self.errors.clear();
        self.has_fatal = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_collector_strict_mode() {
        let mut collector = ErrorCollector::new(ParseMode::Strict);

        let cont = collector.add_error(ParseErrorDetail::warning(
            ErrorCode::InvalidCellValue,
            "warning",
        ));
        assert!(cont);

        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error",
        ));
        assert!(!cont);
    }

    #[test]
    fn test_collector_lenient_mode() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);

        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error",
        ));
        assert!(cont);

        let cont = collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));
        assert!(!cont);
    }

    #[test]
    fn test_collector_permissive_mode() {
        let mut collector = ErrorCollector::new(ParseMode::Permissive);

        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error",
        ));
        assert!(cont);

        let cont = collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));
        assert!(!cont);
    }

    #[test]
    fn test_collector_max_errors() {
        let mut collector = ErrorCollector::with_max_errors(ParseMode::Lenient, 5);

        for i in 0..10 {
            collector.add_error(ParseErrorDetail::error(
                ErrorCode::InvalidCellValue,
                format!("error {}", i),
            ));
        }

        assert_eq!(collector.errors().len(), 5);
    }

    #[test]
    fn test_collector_counts() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);

        collector.add_error(ParseErrorDetail::warning(ErrorCode::InvalidCellValue, "w1"));
        collector.add_error(ParseErrorDetail::warning(ErrorCode::InvalidCellValue, "w2"));
        collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "e1",
        ));

        assert_eq!(collector.warning_count(), 2);
        assert_eq!(collector.error_count(), 1);
        assert_eq!(collector.errors().len(), 3);
    }

    #[test]
    fn test_collector_has_fatal() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);
        assert!(!collector.has_fatal_error());

        collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "e",
        ));
        assert!(!collector.has_fatal_error());

        collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "f"));
        assert!(collector.has_fatal_error());
    }

    #[test]
    fn test_collector_clear() {
        let mut collector = ErrorCollector::new(ParseMode::Lenient);
        collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));

        assert!(collector.has_fatal_error());
        assert!(collector.has_errors());

        collector.clear();

        assert!(!collector.has_fatal_error());
        assert!(!collector.has_errors());
        assert_eq!(collector.mode(), ParseMode::Lenient);
    }

    #[test]
    fn test_lenient_max_zero_tracks_fatal_without_storing() {
        let mut collector = ErrorCollector::with_max_errors(ParseMode::Lenient, 0);

        let cont = collector.add_error(ParseErrorDetail::fatal(ErrorCode::DataCorruption, "fatal"));

        assert!(!cont);
        assert!(collector.has_fatal_error());
        assert!(collector.errors().is_empty());
        assert_eq!(collector.error_count(), 0);
        assert_eq!(collector.warning_count(), 0);
    }

    #[test]
    fn test_strict_max_zero_stores_stopping_error() {
        let mut collector = ErrorCollector::with_max_errors(ParseMode::Strict, 0);

        let cont = collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "strict stop",
        ));

        assert!(!cont);
        assert_eq!(collector.errors().len(), 1);
        assert_eq!(collector.error_count(), 1);
    }

    #[test]
    fn test_strict_warning_then_error_storage_and_stop() {
        let mut collector = ErrorCollector::new(ParseMode::Strict);

        assert!(collector.add_error(ParseErrorDetail::warning(
            ErrorCode::InvalidCellValue,
            "warn"
        )));
        assert_eq!(collector.warning_count(), 1);
        assert_eq!(collector.error_count(), 0);

        assert!(!collector.add_error(ParseErrorDetail::error(
            ErrorCode::InvalidCellReference,
            "error"
        )));
        assert_eq!(collector.warning_count(), 1);
        assert_eq!(collector.error_count(), 1);
        assert_eq!(collector.errors().len(), 2);
    }

    #[test]
    fn test_error_collector_default() {
        let collector = ErrorCollector::default();
        assert_eq!(collector.mode(), ParseMode::Lenient);
        assert!(!collector.has_errors());
    }
}
