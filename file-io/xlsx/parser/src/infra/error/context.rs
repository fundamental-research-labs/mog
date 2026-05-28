use super::collector::ErrorCollector;
use super::detail::{ErrorLocation, ParseErrorDetail};
use super::types::{ErrorCode, ParseMode};

/// Context for parsing operations, thread through parsing functions
#[derive(Debug, Clone)]
pub struct ParseContext {
    /// The current parse mode
    pub mode: ParseMode,
    /// Error collector
    pub collector: ErrorCollector,
    /// The current part being parsed
    pub current_part: String,
}

impl Default for ParseContext {
    fn default() -> Self {
        Self::lenient()
    }
}

impl ParseContext {
    /// Create a new parse context with the specified mode
    pub fn new(mode: ParseMode) -> Self {
        Self {
            mode,
            collector: ErrorCollector::new(mode),
            current_part: String::new(),
        }
    }

    /// Create a strict parse context (fail on first error)
    pub fn strict() -> Self {
        Self::new(ParseMode::Strict)
    }

    /// Create a lenient parse context (skip errors, collect warnings)
    pub fn lenient() -> Self {
        Self::new(ParseMode::Lenient)
    }

    /// Create a permissive parse context (maximum recovery)
    pub fn permissive() -> Self {
        Self::new(ParseMode::Permissive)
    }

    /// Set the current part being parsed
    pub fn set_current_part(&mut self, part: &str) {
        self.current_part = part.to_string();
    }

    /// Report an error and return whether parsing should continue
    ///
    /// Returns `true` if parsing should continue, `false` if it should stop.
    pub fn report_error(&mut self, code: ErrorCode, message: &str) -> bool {
        let error = ParseErrorDetail::error(code, message)
            .with_location(ErrorLocation::new(&self.current_part));
        self.collector.add_error(error)
    }

    /// Report a warning (always continues)
    pub fn report_warning(&mut self, code: ErrorCode, message: &str) {
        let location = if self.current_part.is_empty() {
            None
        } else {
            Some(ErrorLocation::new(&self.current_part))
        };
        self.collector.add_warning(code, message, location);
    }

    /// Report an error with full details
    pub fn report_error_detail(&mut self, error: ParseErrorDetail) -> bool {
        self.collector.add_error(error)
    }

    /// Check if parsing should stop
    pub fn should_stop(&self) -> bool {
        self.collector.has_fatal_error()
            || (self.mode == ParseMode::Strict && self.collector.error_count() > 0)
    }

    /// Get all collected errors
    pub fn errors(&self) -> &[ParseErrorDetail] {
        self.collector.errors()
    }

    /// Get the error count
    pub fn error_count(&self) -> usize {
        self.collector.error_count()
    }

    /// Get the warning count
    pub fn warning_count(&self) -> usize {
        self.collector.warning_count()
    }

    /// Consume the context and return all errors
    pub fn into_errors(self) -> Vec<ParseErrorDetail> {
        self.collector.into_errors()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::error::ErrorSeverity;

    #[test]
    fn test_context_creation() {
        let ctx = ParseContext::strict();
        assert_eq!(ctx.mode, ParseMode::Strict);
        assert_eq!(ctx.collector.mode(), ParseMode::Strict);

        let ctx = ParseContext::lenient();
        assert_eq!(ctx.mode, ParseMode::Lenient);
        assert_eq!(ctx.collector.mode(), ParseMode::Lenient);

        let ctx = ParseContext::permissive();
        assert_eq!(ctx.mode, ParseMode::Permissive);
        assert_eq!(ctx.collector.mode(), ParseMode::Permissive);
    }

    #[test]
    fn test_context_current_part() {
        let mut ctx = ParseContext::lenient();
        ctx.set_current_part("xl/worksheets/sheet1.xml");
        assert_eq!(ctx.current_part, "xl/worksheets/sheet1.xml");
    }

    #[test]
    fn test_context_report_error() {
        let mut ctx = ParseContext::lenient();
        ctx.set_current_part("sheet1.xml");

        let cont = ctx.report_error(ErrorCode::InvalidCellReference, "Bad ref");
        assert!(cont);

        assert_eq!(ctx.error_count(), 1);
        assert!(!ctx.should_stop());
        assert_eq!(
            ctx.errors()[0]
                .location
                .as_ref()
                .map(|loc| loc.part.as_str()),
            Some("sheet1.xml")
        );
    }

    #[test]
    fn test_context_report_warning() {
        let mut ctx = ParseContext::strict();
        ctx.set_current_part("sheet1.xml");

        ctx.report_warning(ErrorCode::InvalidCellValue, "Minor issue");

        assert_eq!(ctx.warning_count(), 1);
        assert_eq!(ctx.error_count(), 0);
        assert!(!ctx.should_stop());
        assert_eq!(
            ctx.errors()[0]
                .location
                .as_ref()
                .map(|loc| loc.part.as_str()),
            Some("sheet1.xml")
        );
    }

    #[test]
    fn test_context_strict_stops_on_error() {
        let mut ctx = ParseContext::strict();
        ctx.report_error(ErrorCode::InvalidCellReference, "Error");

        assert!(ctx.should_stop());
    }

    #[test]
    fn test_context_into_errors() {
        let mut ctx = ParseContext::lenient();
        ctx.report_error(ErrorCode::InvalidCellReference, "e1");
        ctx.report_warning(ErrorCode::InvalidCellValue, "w1");

        let errors = ctx.into_errors();
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn test_report_error_with_empty_current_part_attaches_empty_location() {
        let mut ctx = ParseContext::lenient();

        assert!(ctx.report_error(ErrorCode::InvalidCellReference, "Bad ref"));

        let location = ctx.errors()[0].location.as_ref().expect("location");
        assert_eq!(location.part, "");
        assert!(location.path.is_none());
        assert!(location.row.is_none());
        assert!(location.col.is_none());
    }

    #[test]
    fn test_report_warning_with_empty_current_part_has_no_location() {
        let mut ctx = ParseContext::lenient();

        ctx.report_warning(ErrorCode::InvalidCellValue, "Minor issue");

        assert!(ctx.errors()[0].location.is_none());
    }

    #[test]
    fn test_full_error_flow() {
        let mut ctx = ParseContext::lenient();
        ctx.set_current_part("xl/worksheets/sheet1.xml");

        ctx.report_warning(ErrorCode::UnsupportedFeature, "Pivot tables not supported");

        let error = ParseErrorDetail::error(ErrorCode::InvalidCellValue, "Cannot parse cell value")
            .with_location(ErrorLocation::cell("xl/worksheets/sheet1.xml", 5, 3))
            .with_raw_data("not-a-number")
            .with_fallback("0.0");

        ctx.report_error_detail(error);

        assert!(!ctx.should_stop());
        assert_eq!(ctx.warning_count(), 1);
        assert_eq!(ctx.error_count(), 1);

        let errors = ctx.into_errors();
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].severity, ErrorSeverity::Warning);
        assert_eq!(errors[1].severity, ErrorSeverity::Error);
    }

    #[test]
    fn test_parse_context_default() {
        let ctx = ParseContext::default();
        assert_eq!(ctx.mode, ParseMode::Lenient);
        assert_eq!(ctx.collector.mode(), ParseMode::Lenient);
        assert_eq!(ctx.current_part, "");
    }
}
