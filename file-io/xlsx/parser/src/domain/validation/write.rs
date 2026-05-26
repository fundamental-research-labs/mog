//! Data Validation Writer for XLSX worksheets.
//!
//! This module generates `<dataValidations>` XML elements for worksheet files
//! according to ECMA-376 CT_DataValidation specification.
//!
//! # Features
//!
//! - List validation (dropdowns) - from explicit values or cell ranges
//! - Number validation (whole, decimal) - with comparison operators
//! - Date/time validation
//! - Text length validation
//! - Custom formula validation
//! - Error messages and input prompts
//! - Multiple error styles (stop, warning, information)
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::validation_writer::{DataValidationWriter, ValidationOperator};
//!
//! let mut writer = DataValidationWriter::new();
//!
//! // Add dropdown list
//! writer.add_list("A1:A10", &["Red", "Green", "Blue"]);
//!
//! // Add whole number validation (1-100)
//! writer.add_whole_between("B1:B10", 1, 100);
//!
//! // Generate XML
//! let xml = writer.to_xml();
//! ```

use crate::write::xml_writer::XmlWriter;

// ============================================================================
// Type Definitions
// ============================================================================

/// Data validation rule type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationType {
    /// No validation (default)
    #[default]
    None,
    /// Whole number validation
    Whole,
    /// Decimal number validation
    Decimal,
    /// List (dropdown) validation
    List,
    /// Date validation
    Date,
    /// Time validation
    Time,
    /// Text length validation
    TextLength,
    /// Custom formula validation
    Custom,
}

impl ValidationType {
    /// Convert to XML attribute value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Whole => "whole",
            Self::Decimal => "decimal",
            Self::List => "list",
            Self::Date => "date",
            Self::Time => "time",
            Self::TextLength => "textLength",
            Self::Custom => "custom",
        }
    }
}

/// Validation operator for comparisons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ValidationOperator {
    /// Value must be between formula1 and formula2 (default)
    #[default]
    Between,
    /// Value must NOT be between formula1 and formula2
    NotBetween,
    /// Value must equal formula1
    Equal,
    /// Value must NOT equal formula1
    NotEqual,
    /// Value must be less than formula1
    LessThan,
    /// Value must be less than or equal to formula1
    LessThanOrEqual,
    /// Value must be greater than formula1
    GreaterThan,
    /// Value must be greater than or equal to formula1
    GreaterThanOrEqual,
}

impl ValidationOperator {
    /// Convert to XML attribute value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Between => "between",
            Self::NotBetween => "notBetween",
            Self::Equal => "equal",
            Self::NotEqual => "notEqual",
            Self::LessThan => "lessThan",
            Self::LessThanOrEqual => "lessThanOrEqual",
            Self::GreaterThan => "greaterThan",
            Self::GreaterThanOrEqual => "greaterThanOrEqual",
        }
    }

    /// Check if this operator requires two formulas.
    pub fn requires_formula2(&self) -> bool {
        matches!(self, Self::Between | Self::NotBetween)
    }
}

/// Error style (what happens when invalid data is entered).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ErrorStyle {
    /// Prevents entry (default)
    #[default]
    Stop,
    /// Shows warning, allows entry
    Warning,
    /// Shows info, allows entry
    Information,
}

impl ErrorStyle {
    /// Convert to XML attribute value.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::Warning => "warning",
            Self::Information => "information",
        }
    }
}

// ============================================================================
// DataValidation
// ============================================================================

/// A single data validation rule.
///
/// Use the builder pattern to construct validation rules:
///
/// ```ignore
/// let rule = DataValidation::new("A1:A10", ValidationType::Whole)
///     .operator(ValidationOperator::GreaterThan)
///     .formula1("0")
///     .error_message("Invalid", "Please enter a positive number")
///     .allow_blank(true);
/// ```
#[derive(Debug, Clone)]
pub struct DataValidation {
    /// Cell range(s) this validation applies to (space-separated A1 references)
    pub sqref: String,
    /// Validation type
    pub validation_type: ValidationType,
    /// Comparison operator (used with whole, decimal, date, time, textLength)
    pub operator: Option<ValidationOperator>,
    /// First formula/value for validation criteria
    pub formula1: Option<String>,
    /// Second formula (for between/notBetween operators)
    pub formula2: Option<String>,
    /// Allow blank cells
    pub allow_blank: bool,
    /// Show input message when cell is selected
    pub show_input_message: bool,
    /// Show error message on invalid input
    pub show_error_message: bool,
    /// Error style (stop, warning, information)
    pub error_style: ErrorStyle,
    /// Error message title
    pub error_title: Option<String>,
    /// Error message text
    pub error_message: Option<String>,
    /// Input prompt title
    pub prompt_title: Option<String>,
    /// Input prompt text
    pub prompt_message: Option<String>,
    /// Show dropdown for list type (confusingly, false/absent means SHOW the dropdown)
    pub show_dropdown: bool,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    pub uid: Option<String>,
    /// IME mode for Asian locales (OOXML `imeMode` attribute). Empty string
    /// means the attribute was absent (equivalent to schema default
    /// `noControl`).
    pub ime_mode: String,
}

impl Default for DataValidation {
    fn default() -> Self {
        Self {
            sqref: String::new(),
            validation_type: ValidationType::None,
            operator: None,
            formula1: None,
            formula2: None,
            allow_blank: true,
            show_input_message: true,
            show_error_message: true,
            error_style: ErrorStyle::Stop,
            error_title: None,
            error_message: None,
            prompt_title: None,
            prompt_message: None,
            show_dropdown: true,
            uid: None,
            ime_mode: String::new(),
        }
    }
}

impl DataValidation {
    /// Create a new data validation rule.
    ///
    /// # Arguments
    /// * `sqref` - Cell range(s) this validation applies to
    /// * `validation_type` - Type of validation
    pub fn new(sqref: &str, validation_type: ValidationType) -> Self {
        Self {
            sqref: sqref.to_string(),
            validation_type,
            ..Default::default()
        }
    }

    /// Set the operator for comparison-based validations.
    pub fn operator(mut self, op: ValidationOperator) -> Self {
        self.operator = Some(op);
        self
    }

    /// Set formula1 (first constraint value).
    pub fn formula1(mut self, formula: &str) -> Self {
        self.formula1 = Some(formula.to_string());
        self
    }

    /// Set formula2 (second constraint value for between/notBetween).
    pub fn formula2(mut self, formula: &str) -> Self {
        self.formula2 = Some(formula.to_string());
        self
    }

    /// Set the error style.
    pub fn error_style(mut self, style: ErrorStyle) -> Self {
        self.error_style = style;
        self
    }

    /// Set the error message title and text.
    pub fn error_message(mut self, title: &str, message: &str) -> Self {
        self.error_title = Some(title.to_string());
        self.error_message = Some(message.to_string());
        self
    }

    /// Set the input prompt title and text.
    pub fn prompt(mut self, title: &str, message: &str) -> Self {
        self.prompt_title = Some(title.to_string());
        self.prompt_message = Some(message.to_string());
        self
    }

    /// Set whether blank cells are allowed.
    pub fn allow_blank(mut self, allow: bool) -> Self {
        self.allow_blank = allow;
        self
    }

    /// Set whether to show the dropdown (for list validation).
    ///
    /// Note: In XLSX, the attribute `showDropDown="1"` actually HIDES the dropdown.
    /// This method uses intuitive semantics: true = show, false = hide.
    pub fn show_dropdown(mut self, show: bool) -> Self {
        self.show_dropdown = show;
        self
    }

    /// Set whether to show input message.
    pub fn show_input_message(mut self, show: bool) -> Self {
        self.show_input_message = show;
        self
    }

    /// Set whether to show error message.
    pub fn show_error_message(mut self, show: bool) -> Self {
        self.show_error_message = show;
        self
    }

    /// Write this validation rule to an XmlWriter.
    pub fn write_to(&self, writer: &mut XmlWriter) {
        writer.start_element("dataValidation");

        // Required attribute
        writer.attr("sqref", &self.sqref);

        // Type attribute (omit if "none")
        if self.validation_type != ValidationType::None {
            writer.attr("type", self.validation_type.as_str());
        }

        // Operator attribute (omit for list/custom or if default "between")
        if let Some(op) = &self.operator {
            // Only write operator if it's not the default "between" for types that use it
            if *op != ValidationOperator::Between {
                writer.attr("operator", op.as_str());
            }
        }

        // Boolean attributes (XLSX uses "1" for true, omits or "0" for false)
        if self.allow_blank {
            writer.attr("allowBlank", "1");
        }
        if self.show_input_message {
            writer.attr("showInputMessage", "1");
        }
        if self.show_error_message {
            writer.attr("showErrorMessage", "1");
        }

        // showDropDown: in XLSX, "1" means HIDE the dropdown (confusing but true)
        // We use intuitive semantics internally, so show_dropdown=false writes "1"
        if !self.show_dropdown && self.validation_type == ValidationType::List {
            writer.attr("showDropDown", "1");
        }

        // Error style (omit if default "stop")
        if self.error_style != ErrorStyle::Stop {
            writer.attr("errorStyle", self.error_style.as_str());
        }

        // IME mode (omit if default "noControl" / empty)
        if !self.ime_mode.is_empty() && self.ime_mode != "noControl" {
            writer.attr("imeMode", &self.ime_mode);
        }

        // Optional string attributes
        if let Some(ref title) = self.error_title {
            writer.attr_xstring("errorTitle", title);
        }
        if let Some(ref msg) = self.error_message {
            writer.attr_xstring("error", msg);
        }
        if let Some(ref title) = self.prompt_title {
            writer.attr_xstring("promptTitle", title);
        }
        if let Some(ref msg) = self.prompt_message {
            writer.attr_xstring("prompt", msg);
        }

        // xr:uid for revision tracking
        if let Some(ref uid) = self.uid {
            writer.attr("xr:uid", uid);
        }

        // Check if we have formula elements
        let has_formulas = self.formula1.is_some() || self.formula2.is_some();

        if has_formulas {
            writer.end_attrs();

            // Write formula1
            if let Some(ref formula) = self.formula1 {
                writer.element_with_text("formula1", formula);
            }

            // Write formula2
            if let Some(ref formula) = self.formula2 {
                writer.element_with_text("formula2", formula);
            }

            writer.end_element("dataValidation");
        } else {
            // Self-closing tag
            writer.self_close();
        }
    }
}

// ============================================================================
// DataValidationWriter
// ============================================================================

/// Writer for data validations in a worksheet.
///
/// Collects validation rules and generates the `<dataValidations>` XML element.
///
/// # Example
///
/// ```ignore
/// let mut writer = DataValidationWriter::new();
///
/// // Add various validations
/// writer
///     .add_list("A1:A10", &["Yes", "No", "Maybe"])
///     .add_whole_between("B1:B10", 1, 100)
///     .add_decimal("C1:C10", ValidationOperator::GreaterThan, 0.0)
///     .add_custom("D1:D10", "AND(LEN(D1)>=5,LEN(D1)<=20)");
///
/// // Write to an XmlWriter
/// let mut xml_writer = XmlWriter::new();
/// writer.write_to(&mut xml_writer);
/// ```
#[derive(Debug, Clone, Default)]
pub struct DataValidationWriter {
    validations: Vec<DataValidation>,
    /// Whether to emit `disablePrompts="1"` on the container element.
    pub disable_prompts: bool,
    /// X window position for prompt dialog.
    pub x_window: Option<u32>,
    /// Y window position for prompt dialog.
    pub y_window: Option<u32>,
    /// Source-declared container count to preserve for imported sheets.
    pub declared_count: Option<u32>,
}

impl DataValidationWriter {
    /// Create a new empty validation writer.
    pub fn new() -> Self {
        Self {
            validations: Vec::new(),
            disable_prompts: false,
            x_window: None,
            y_window: None,
            declared_count: None,
        }
    }

    /// Add a validation rule.
    pub fn add(&mut self, validation: DataValidation) -> &mut Self {
        self.validations.push(validation);
        self
    }

    /// Add a dropdown list validation from explicit values.
    ///
    /// Values are comma-separated and quoted in the formula.
    ///
    /// # Arguments
    /// * `range` - Cell range (e.g., "A1:A10")
    /// * `items` - List of dropdown options
    pub fn add_list(&mut self, range: &str, items: &[&str]) -> &mut Self {
        // Build comma-separated list with quotes
        // Note: Values containing commas need special handling (use list_range instead)
        let formula = format!("\"{}\"", items.join(","));

        let validation = DataValidation::new(range, ValidationType::List)
            .formula1(&formula)
            .allow_blank(true);

        self.add(validation)
    }

    /// Add a dropdown list validation from a cell range.
    ///
    /// # Arguments
    /// * `range` - Cell range to apply validation to (e.g., "A1:A10")
    /// * `source_range` - Cell range containing list values (e.g., "Sheet2!$A$1:$A$5")
    pub fn add_list_range(&mut self, range: &str, source_range: &str) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::List)
            .formula1(source_range)
            .allow_blank(true);

        self.add(validation)
    }

    /// Add whole number validation (between min and max).
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `min` - Minimum value (inclusive)
    /// * `max` - Maximum value (inclusive)
    pub fn add_whole_between(&mut self, range: &str, min: i64, max: i64) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Whole)
            .operator(ValidationOperator::Between)
            .formula1(&min.to_string())
            .formula2(&max.to_string())
            .allow_blank(true);

        self.add(validation)
    }

    /// Add whole number validation with a comparison operator.
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `operator` - Comparison operator
    /// * `value` - Value to compare against
    pub fn add_whole(
        &mut self,
        range: &str,
        operator: ValidationOperator,
        value: i64,
    ) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Whole)
            .operator(operator)
            .formula1(&value.to_string())
            .allow_blank(true);

        self.add(validation)
    }

    /// Add decimal validation (between min and max).
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `min` - Minimum value (inclusive)
    /// * `max` - Maximum value (inclusive)
    pub fn add_decimal_between(&mut self, range: &str, min: f64, max: f64) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Decimal)
            .operator(ValidationOperator::Between)
            .formula1(&format_f64(min))
            .formula2(&format_f64(max))
            .allow_blank(true);

        self.add(validation)
    }

    /// Add decimal validation with a comparison operator.
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `operator` - Comparison operator
    /// * `value` - Value to compare against
    pub fn add_decimal(
        &mut self,
        range: &str,
        operator: ValidationOperator,
        value: f64,
    ) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Decimal)
            .operator(operator)
            .formula1(&format_f64(value))
            .allow_blank(true);

        self.add(validation)
    }

    /// Add date validation (between two dates).
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `min_date` - Minimum date (formula or date serial number)
    /// * `max_date` - Maximum date (formula or date serial number)
    pub fn add_date_between(&mut self, range: &str, min_date: &str, max_date: &str) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Date)
            .operator(ValidationOperator::Between)
            .formula1(min_date)
            .formula2(max_date)
            .allow_blank(true);

        self.add(validation)
    }

    /// Add date validation with a comparison operator.
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `operator` - Comparison operator
    /// * `date` - Date value (formula like "TODAY()" or date serial number)
    pub fn add_date(&mut self, range: &str, operator: ValidationOperator, date: &str) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Date)
            .operator(operator)
            .formula1(date)
            .allow_blank(true);

        self.add(validation)
    }

    /// Add time validation (between two times).
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `min_time` - Minimum time (as decimal fraction of day)
    /// * `max_time` - Maximum time (as decimal fraction of day)
    pub fn add_time_between(&mut self, range: &str, min_time: &str, max_time: &str) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Time)
            .operator(ValidationOperator::Between)
            .formula1(min_time)
            .formula2(max_time)
            .allow_blank(true);

        self.add(validation)
    }

    /// Add text length validation with a comparison operator.
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `operator` - Comparison operator
    /// * `length` - Length value to compare against
    pub fn add_text_length(
        &mut self,
        range: &str,
        operator: ValidationOperator,
        length: u32,
    ) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::TextLength)
            .operator(operator)
            .formula1(&length.to_string())
            .allow_blank(true);

        self.add(validation)
    }

    /// Add text length validation (between min and max).
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `min_length` - Minimum length (inclusive)
    /// * `max_length` - Maximum length (inclusive)
    pub fn add_text_length_between(
        &mut self,
        range: &str,
        min_length: u32,
        max_length: u32,
    ) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::TextLength)
            .operator(ValidationOperator::Between)
            .formula1(&min_length.to_string())
            .formula2(&max_length.to_string())
            .allow_blank(true);

        self.add(validation)
    }

    /// Add custom formula validation.
    ///
    /// # Arguments
    /// * `range` - Cell range
    /// * `formula` - Custom formula that returns TRUE for valid values
    pub fn add_custom(&mut self, range: &str, formula: &str) -> &mut Self {
        let validation = DataValidation::new(range, ValidationType::Custom)
            .formula1(formula)
            .allow_blank(true);

        self.add(validation)
    }

    /// Write dataValidations element to an XmlWriter.
    ///
    /// Does nothing if there are no validations.
    pub fn write_to(&self, writer: &mut XmlWriter) {
        if self.validations.is_empty() {
            return;
        }

        let el = writer.start_element("dataValidations").attr_num(
            "count",
            self.declared_count.unwrap_or(self.validations.len() as u32),
        );
        if self.disable_prompts {
            el.attr("disablePrompts", "1");
        }
        if let Some(x) = self.x_window {
            el.attr_num("xWindow", x);
        }
        if let Some(y) = self.y_window {
            el.attr_num("yWindow", y);
        }
        el.end_attrs();

        for validation in &self.validations {
            validation.write_to(writer);
        }

        writer.end_element("dataValidations");
    }

    /// Generate standalone XML (for testing).
    pub fn to_xml(&self) -> Vec<u8> {
        let mut writer = XmlWriter::new();
        self.write_to(&mut writer);
        writer.finish()
    }

    /// Check if there are any validations.
    pub fn is_empty(&self) -> bool {
        self.validations.is_empty()
    }

    /// Get the number of validations.
    pub fn len(&self) -> usize {
        self.validations.len()
    }

    /// Get a reference to the validations.
    pub fn validations(&self) -> &[DataValidation] {
        &self.validations
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Format f64 for XML output, avoiding unnecessary decimal places.
fn format_f64(value: f64) -> String {
    // Check if value is effectively an integer
    if value.fract().abs() < f64::EPSILON && value.abs() < i64::MAX as f64 {
        format!("{}", value as i64)
    } else {
        // Use enough precision, but trim trailing zeros
        let s = format!("{:.15}", value);
        let trimmed = s.trim_end_matches('0').trim_end_matches('.');
        trimmed.to_string()
    }
}

// ============================================================================
// Domain bridge: domain_types::ValidationSpec → DataValidationWriter
// ============================================================================

/// Convert `domain_types::ValidationSpec` list into XML (no container-level attrs).
pub fn validations_xml_from_domain(specs: &[domain_types::ValidationSpec]) -> String {
    validations_xml_from_domain_with_opts(specs, false, None, None, None)
}

/// Convert `domain_types::ValidationSpec` list into a `DataValidationWriter`.
///
/// Returns the writer's XML as a `String` (the `<dataValidations>` element).
/// The caller injects this into the sheet writer via `set_data_validations_xml()`.
pub fn validations_xml_from_domain_with_opts(
    specs: &[domain_types::ValidationSpec],
    disable_prompts: bool,
    x_window: Option<u32>,
    y_window: Option<u32>,
    declared_count: Option<u32>,
) -> String {
    let mut dvw = DataValidationWriter::new();
    dvw.disable_prompts = disable_prompts;
    dvw.x_window = x_window;
    dvw.y_window = y_window;
    dvw.declared_count = declared_count;

    for v in specs {
        let sqref = v.ranges.join(" ");

        let (vtype, operator, formula1, formula2) = match &v.rule {
            domain_types::ValidationRule::WholeNumber {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Whole,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::Decimal {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Decimal,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::List {
                formula1,
                show_dropdown,
            } => {
                // show_dropdown handling is done below via the DataValidation field
                let _ = show_dropdown;
                (ValidationType::List, None, formula1.as_str(), None)
            }
            domain_types::ValidationRule::Date {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Date,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::Time {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::Time,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::TextLength {
                operator,
                formula1,
                formula2,
            } => (
                ValidationType::TextLength,
                Some(operator.as_str()),
                formula1.as_str(),
                formula2.as_deref(),
            ),
            domain_types::ValidationRule::Custom { formula1 } => {
                (ValidationType::Custom, None, formula1.as_str(), None)
            }
            domain_types::ValidationRule::None { formula1 } => {
                (ValidationType::None, None, formula1.as_str(), None)
            }
        };

        let mut dv = DataValidation::new(&sqref, vtype);
        if !formula1.is_empty() {
            dv.formula1 = Some(formula1.to_string());
        }
        if let Some(f2) = formula2 {
            dv.formula2 = Some(f2.to_string());
        }
        if let Some(op_str) = operator {
            dv.operator = Some(match op_str {
                "between" => ValidationOperator::Between,
                "notBetween" => ValidationOperator::NotBetween,
                "equal" => ValidationOperator::Equal,
                "notEqual" => ValidationOperator::NotEqual,
                "lessThan" => ValidationOperator::LessThan,
                "lessThanOrEqual" => ValidationOperator::LessThanOrEqual,
                "greaterThan" => ValidationOperator::GreaterThan,
                "greaterThanOrEqual" => ValidationOperator::GreaterThanOrEqual,
                _ => ValidationOperator::Between,
            });
        }
        dv.allow_blank = v.allow_blank;
        dv.show_input_message = v.show_prompt;
        dv.show_error_message = v.show_error;
        {
            let es = match v.error_style.as_str() {
                "warning" => ErrorStyle::Warning,
                "information" => ErrorStyle::Information,
                _ => ErrorStyle::Stop,
            };
            if es != ErrorStyle::Stop {
                dv.error_style = es;
            }
        }
        dv.error_title = v.error_title.clone();
        dv.error_message = v.error_message.clone();
        dv.prompt_title = v.prompt_title.clone();
        dv.prompt_message = v.prompt_message.clone();

        // For list type, showDropDown="1" means HIDE in OOXML (inverted)
        if let domain_types::ValidationRule::List { show_dropdown, .. } = &v.rule {
            dv.show_dropdown = *show_dropdown;
        }

        // xr:uid for revision tracking
        dv.uid = v.uid.clone();

        // imeMode (omit when default noControl)
        dv.ime_mode = if v.ime_mode == domain_types::ImeMode::NoControl {
            String::new()
        } else {
            v.ime_mode.as_str().to_string()
        };

        dvw.add(dv);
    }

    String::from_utf8(dvw.to_xml()).unwrap_or_default()
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // ValidationType tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_validation_type_as_str() {
        assert_eq!(ValidationType::None.as_str(), "none");
        assert_eq!(ValidationType::Whole.as_str(), "whole");
        assert_eq!(ValidationType::Decimal.as_str(), "decimal");
        assert_eq!(ValidationType::List.as_str(), "list");
        assert_eq!(ValidationType::Date.as_str(), "date");
        assert_eq!(ValidationType::Time.as_str(), "time");
        assert_eq!(ValidationType::TextLength.as_str(), "textLength");
        assert_eq!(ValidationType::Custom.as_str(), "custom");
    }

    #[test]
    fn test_validation_type_default() {
        let vt: ValidationType = Default::default();
        assert_eq!(vt, ValidationType::None);
    }

    // -------------------------------------------------------------------------
    // ValidationOperator tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_validation_operator_as_str() {
        assert_eq!(ValidationOperator::Between.as_str(), "between");
        assert_eq!(ValidationOperator::NotBetween.as_str(), "notBetween");
        assert_eq!(ValidationOperator::Equal.as_str(), "equal");
        assert_eq!(ValidationOperator::NotEqual.as_str(), "notEqual");
        assert_eq!(ValidationOperator::LessThan.as_str(), "lessThan");
        assert_eq!(
            ValidationOperator::LessThanOrEqual.as_str(),
            "lessThanOrEqual"
        );
        assert_eq!(ValidationOperator::GreaterThan.as_str(), "greaterThan");
        assert_eq!(
            ValidationOperator::GreaterThanOrEqual.as_str(),
            "greaterThanOrEqual"
        );
    }

    #[test]
    fn test_validation_operator_requires_formula2() {
        assert!(ValidationOperator::Between.requires_formula2());
        assert!(ValidationOperator::NotBetween.requires_formula2());
        assert!(!ValidationOperator::Equal.requires_formula2());
        assert!(!ValidationOperator::NotEqual.requires_formula2());
        assert!(!ValidationOperator::LessThan.requires_formula2());
        assert!(!ValidationOperator::LessThanOrEqual.requires_formula2());
        assert!(!ValidationOperator::GreaterThan.requires_formula2());
        assert!(!ValidationOperator::GreaterThanOrEqual.requires_formula2());
    }

    // -------------------------------------------------------------------------
    // ErrorStyle tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_style_as_str() {
        assert_eq!(ErrorStyle::Stop.as_str(), "stop");
        assert_eq!(ErrorStyle::Warning.as_str(), "warning");
        assert_eq!(ErrorStyle::Information.as_str(), "information");
    }

    #[test]
    fn test_error_style_default() {
        let es: ErrorStyle = Default::default();
        assert_eq!(es, ErrorStyle::Stop);
    }

    // -------------------------------------------------------------------------
    // DataValidation builder tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_data_validation_builder() {
        let dv = DataValidation::new("A1:A10", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .error_style(ErrorStyle::Warning)
            .error_message("Error Title", "Error Message")
            .prompt("Prompt Title", "Prompt Message")
            .allow_blank(false)
            .show_input_message(true)
            .show_error_message(true);

        assert_eq!(dv.sqref, "A1:A10");
        assert_eq!(dv.validation_type, ValidationType::Whole);
        assert_eq!(dv.operator, Some(ValidationOperator::GreaterThan));
        assert_eq!(dv.formula1, Some("0".to_string()));
        assert_eq!(dv.error_style, ErrorStyle::Warning);
        assert_eq!(dv.error_title, Some("Error Title".to_string()));
        assert_eq!(dv.error_message, Some("Error Message".to_string()));
        assert_eq!(dv.prompt_title, Some("Prompt Title".to_string()));
        assert_eq!(dv.prompt_message, Some("Prompt Message".to_string()));
        assert!(!dv.allow_blank);
        assert!(dv.show_input_message);
        assert!(dv.show_error_message);
    }

    #[test]
    fn test_data_validation_show_dropdown() {
        let dv = DataValidation::new("A1", ValidationType::List).show_dropdown(false);
        assert!(!dv.show_dropdown);
    }

    // -------------------------------------------------------------------------
    // List validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_list_validation_from_values() {
        let mut writer = DataValidationWriter::new();
        writer.add_list("A1:A10", &["Red", "Green", "Blue"]);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("<dataValidations count=\"1\">"));
        assert!(xml.contains("type=\"list\""));
        assert!(xml.contains("sqref=\"A1:A10\""));
        assert!(xml.contains("<formula1>\"Red,Green,Blue\"</formula1>"));
        assert!(xml.contains("</dataValidations>"));
    }

    #[test]
    fn test_list_validation_from_range() {
        let mut writer = DataValidationWriter::new();
        writer.add_list_range("B1:B10", "Sheet2!$A$1:$A$5");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"list\""));
        assert!(xml.contains("<formula1>Sheet2!$A$1:$A$5</formula1>"));
    }

    #[test]
    fn test_list_validation_hide_dropdown() {
        let validation = DataValidation::new("A1", ValidationType::List)
            .formula1("\"Yes,No\"")
            .show_dropdown(false);

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // showDropDown="1" means HIDE the dropdown in XLSX
        assert!(xml.contains("showDropDown=\"1\""));
    }

    // -------------------------------------------------------------------------
    // Whole number validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_whole_number_between() {
        let mut writer = DataValidationWriter::new();
        writer.add_whole_between("C1:C10", 1, 100);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"whole\""));
        assert!(xml.contains("<formula1>1</formula1>"));
        assert!(xml.contains("<formula2>100</formula2>"));
        // "between" is default, should not appear
        assert!(!xml.contains("operator=\"between\""));
    }

    #[test]
    fn test_whole_number_greater_than() {
        let mut writer = DataValidationWriter::new();
        writer.add_whole("D1:D10", ValidationOperator::GreaterThan, 0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"whole\""));
        assert!(xml.contains("operator=\"greaterThan\""));
        assert!(xml.contains("<formula1>0</formula1>"));
        assert!(!xml.contains("<formula2>"));
    }

    #[test]
    fn test_whole_number_less_than_or_equal() {
        let mut writer = DataValidationWriter::new();
        writer.add_whole("E1:E10", ValidationOperator::LessThanOrEqual, 50);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("operator=\"lessThanOrEqual\""));
        assert!(xml.contains("<formula1>50</formula1>"));
    }

    #[test]
    fn test_whole_number_equal() {
        let mut writer = DataValidationWriter::new();
        writer.add_whole("F1", ValidationOperator::Equal, 42);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("operator=\"equal\""));
        assert!(xml.contains("<formula1>42</formula1>"));
    }

    #[test]
    fn test_whole_number_not_equal() {
        let mut writer = DataValidationWriter::new();
        writer.add_whole("G1", ValidationOperator::NotEqual, 0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("operator=\"notEqual\""));
    }

    #[test]
    fn test_whole_number_not_between() {
        let validation = DataValidation::new("H1:H10", ValidationType::Whole)
            .operator(ValidationOperator::NotBetween)
            .formula1("10")
            .formula2("20");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("operator=\"notBetween\""));
        assert!(xml.contains("<formula1>10</formula1>"));
        assert!(xml.contains("<formula2>20</formula2>"));
    }

    // -------------------------------------------------------------------------
    // Decimal validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_decimal_between() {
        let mut writer = DataValidationWriter::new();
        writer.add_decimal_between("I1:I10", 0.0, 100.5);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"decimal\""));
        assert!(xml.contains("<formula1>0</formula1>"));
        assert!(xml.contains("<formula2>100.5</formula2>"));
    }

    #[test]
    fn test_decimal_greater_than() {
        let mut writer = DataValidationWriter::new();
        writer.add_decimal("J1:J10", ValidationOperator::GreaterThan, 0.0);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"decimal\""));
        assert!(xml.contains("operator=\"greaterThan\""));
        assert!(xml.contains("<formula1>0</formula1>"));
    }

    #[test]
    fn test_decimal_formatting() {
        let mut writer = DataValidationWriter::new();
        writer.add_decimal("K1", ValidationOperator::LessThan, 3.14159265358979);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Should have reasonable precision
        assert!(xml.contains("3.14159265358979"));
    }

    // -------------------------------------------------------------------------
    // Date validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_date_between() {
        let mut writer = DataValidationWriter::new();
        writer.add_date_between("L1:L10", "44927", "45292"); // 2023-01-01 to 2023-12-31

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"date\""));
        assert!(xml.contains("<formula1>44927</formula1>"));
        assert!(xml.contains("<formula2>45292</formula2>"));
    }

    #[test]
    fn test_date_greater_than_or_equal_today() {
        let mut writer = DataValidationWriter::new();
        writer.add_date("M1:M10", ValidationOperator::GreaterThanOrEqual, "TODAY()");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"date\""));
        assert!(xml.contains("operator=\"greaterThanOrEqual\""));
        assert!(xml.contains("<formula1>TODAY()</formula1>"));
    }

    // -------------------------------------------------------------------------
    // Time validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_time_between() {
        let mut writer = DataValidationWriter::new();
        // 8:00 AM to 5:00 PM (as fractions of day)
        writer.add_time_between("N1:N10", "0.333333", "0.708333");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"time\""));
        assert!(xml.contains("<formula1>0.333333</formula1>"));
        assert!(xml.contains("<formula2>0.708333</formula2>"));
    }

    // -------------------------------------------------------------------------
    // Text length validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_text_length_less_than_or_equal() {
        let mut writer = DataValidationWriter::new();
        writer.add_text_length("O1:O10", ValidationOperator::LessThanOrEqual, 50);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"textLength\""));
        assert!(xml.contains("operator=\"lessThanOrEqual\""));
        assert!(xml.contains("<formula1>50</formula1>"));
    }

    #[test]
    fn test_text_length_between() {
        let mut writer = DataValidationWriter::new();
        writer.add_text_length_between("P1:P10", 5, 20);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"textLength\""));
        assert!(xml.contains("<formula1>5</formula1>"));
        assert!(xml.contains("<formula2>20</formula2>"));
    }

    // -------------------------------------------------------------------------
    // Custom formula validation tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_custom_formula() {
        let mut writer = DataValidationWriter::new();
        writer.add_custom("Q1:Q10", "AND(LEN(Q1)>=5,LEN(Q1)<=20)");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("type=\"custom\""));
        assert!(xml.contains("<formula1>AND(LEN(Q1)&gt;=5,LEN(Q1)&lt;=20)</formula1>"));
    }

    #[test]
    fn test_custom_formula_isnumber() {
        let mut writer = DataValidationWriter::new();
        writer.add_custom("R1:R10", "ISNUMBER(R1)");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("<formula1>ISNUMBER(R1)</formula1>"));
    }

    // -------------------------------------------------------------------------
    // Error message tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_message() {
        let validation = DataValidation::new("S1:S10", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .error_message("Invalid Input", "Please enter a positive number");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("errorTitle=\"Invalid Input\""));
        assert!(xml.contains("error=\"Please enter a positive number\""));
    }

    #[test]
    fn test_error_style_warning() {
        let validation = DataValidation::new("T1:T10", ValidationType::Decimal)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .error_style(ErrorStyle::Warning)
            .error_message("Warning", "Value should be greater than 0");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("errorStyle=\"warning\""));
    }

    #[test]
    fn test_error_style_information() {
        let validation = DataValidation::new("U1:U10", ValidationType::TextLength)
            .operator(ValidationOperator::LessThanOrEqual)
            .formula1("100")
            .error_style(ErrorStyle::Information)
            .error_message("Note", "Text longer than 100 characters may be truncated");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("errorStyle=\"information\""));
    }

    #[test]
    fn test_error_style_stop_not_written() {
        let validation = DataValidation::new("V1", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .error_style(ErrorStyle::Stop);

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // "stop" is default, should not appear
        assert!(!xml.contains("errorStyle="));
    }

    // -------------------------------------------------------------------------
    // Input prompt tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_input_prompt() {
        let validation = DataValidation::new("W1:W10", ValidationType::List)
            .formula1("\"Option1,Option2,Option3\"")
            .prompt("Select Option", "Choose from the dropdown list");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("promptTitle=\"Select Option\""));
        assert!(xml.contains("prompt=\"Choose from the dropdown list\""));
    }

    // -------------------------------------------------------------------------
    // DataValidationWriter utility tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_writer_is_empty() {
        let writer = DataValidationWriter::new();
        assert!(writer.is_empty());

        let mut writer = DataValidationWriter::new();
        writer.add_list("A1", &["Yes", "No"]);
        assert!(!writer.is_empty());
    }

    #[test]
    fn test_writer_len() {
        let mut writer = DataValidationWriter::new();
        assert_eq!(writer.len(), 0);

        writer.add_list("A1", &["Yes", "No"]);
        assert_eq!(writer.len(), 1);

        writer.add_whole_between("B1", 1, 100);
        assert_eq!(writer.len(), 2);
    }

    #[test]
    fn test_empty_writer_produces_no_output() {
        let writer = DataValidationWriter::new();
        let xml = writer.to_xml();
        assert!(xml.is_empty());
    }

    #[test]
    fn test_multiple_validations() {
        let mut writer = DataValidationWriter::new();
        writer
            .add_list("A1:A10", &["Red", "Green", "Blue"])
            .add_whole_between("B1:B10", 1, 100)
            .add_decimal("C1:C10", ValidationOperator::GreaterThan, 0.0)
            .add_custom("D1:D10", "ISNUMBER(D1)");

        assert_eq!(writer.len(), 4);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("count=\"4\""));
        assert!(xml.contains("type=\"list\""));
        assert!(xml.contains("type=\"whole\""));
        assert!(xml.contains("type=\"decimal\""));
        assert!(xml.contains("type=\"custom\""));
    }

    #[test]
    fn test_declared_count_overrides_child_count() {
        let mut writer = DataValidationWriter::new();
        writer.declared_count = Some(2);
        writer.add_list("C6", &["Not Started / Holding", "Planning", "In Progress"]);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("count=\"2\""));
        assert_eq!(xml.matches("<dataValidation ").count(), 1);
    }

    // -------------------------------------------------------------------------
    // XML structure tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_self_closing_validation() {
        let validation = DataValidation::new("X1", ValidationType::None);

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Should be self-closing since there are no formulas
        // Note: includes default attributes like allowBlank, showInputMessage, showErrorMessage
        assert!(xml.contains("sqref=\"X1\""));
        assert!(xml.contains("/>"));
        assert!(!xml.contains("</dataValidation>"));
    }

    #[test]
    fn test_allow_blank_false() {
        let validation = DataValidation::new("Y1", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .allow_blank(false);

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // allowBlank should NOT be present when false
        assert!(!xml.contains("allowBlank="));
    }

    #[test]
    fn test_allow_blank_true() {
        let validation = DataValidation::new("Z1", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .allow_blank(true);

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("allowBlank=\"1\""));
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    #[test]
    fn test_special_characters_in_error_message() {
        let validation = DataValidation::new("AA1", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .error_message("Error: <invalid>", "Value must be > 0 & < 100 \"quoted\"");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Should be properly escaped
        assert!(xml.contains("errorTitle=\"Error: &lt;invalid&gt;\""));
        assert!(xml.contains("error=\"Value must be &gt; 0 &amp; &lt; 100 &quot;quoted&quot;\""));
    }

    #[test]
    fn test_prompt_and_error_messages_use_xstring_escaping() {
        let validation = DataValidation::new("AB1", ValidationType::List)
            .formula1("\"A,B\"")
            .error_message("Stop\rNow", "Line 1\r\nLine 2\t_x000d_")
            .prompt("Pick\tOne", "Prompt\rText");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("errorTitle=\"Stop_x000d_Now\""));
        assert!(xml.contains("error=\"Line 1_x000d__x000a_Line 2_x0009__x005f_x000d_\""));
        assert!(xml.contains("promptTitle=\"Pick_x0009_One\""));
        assert!(xml.contains("prompt=\"Prompt_x000d_Text\""));
    }

    #[test]
    fn test_multiple_ranges_in_sqref() {
        let validation = DataValidation::new("A1:A10 C1:C10 E1:E10", ValidationType::Whole)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0");

        let mut writer = DataValidationWriter::new();
        writer.add(validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("sqref=\"A1:A10 C1:C10 E1:E10\""));
    }

    #[test]
    fn test_negative_numbers() {
        let mut writer = DataValidationWriter::new();
        writer.add_whole_between("AB1:AB10", -100, 100);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("<formula1>-100</formula1>"));
        assert!(xml.contains("<formula2>100</formula2>"));
    }

    #[test]
    fn test_format_f64_integer() {
        assert_eq!(format_f64(5.0), "5");
        assert_eq!(format_f64(-10.0), "-10");
        assert_eq!(format_f64(0.0), "0");
    }

    #[test]
    fn test_format_f64_decimal() {
        assert_eq!(format_f64(3.14), "3.14");
        assert_eq!(format_f64(0.5), "0.5");
        assert_eq!(format_f64(-2.718), "-2.718");
    }

    // -------------------------------------------------------------------------
    // Integration test
    // -------------------------------------------------------------------------

    #[test]
    fn test_complete_worksheet_validations() {
        let mut writer = DataValidationWriter::new();

        // Dropdown list from values
        let list_validation = DataValidation::new("A1:A10", ValidationType::List)
            .formula1("\"Red,Green,Blue,Yellow\"")
            .allow_blank(true)
            .prompt("Select Color", "Choose a color from the list");
        writer.add(list_validation);

        // Dropdown list from range
        writer.add_list_range("B1:B10", "Sheet2!$A$1:$A$5");

        // Whole number between
        let whole_validation = DataValidation::new("C1:C10", ValidationType::Whole)
            .operator(ValidationOperator::Between)
            .formula1("1")
            .formula2("100")
            .error_message("Invalid Number", "Enter a number between 1 and 100");
        writer.add(whole_validation);

        // Decimal greater than with warning
        let decimal_validation = DataValidation::new("D1:D10", ValidationType::Decimal)
            .operator(ValidationOperator::GreaterThan)
            .formula1("0")
            .error_style(ErrorStyle::Warning)
            .error_message("Warning", "Value should be greater than 0");
        writer.add(decimal_validation);

        // Custom formula
        writer.add_custom("E1:E10", "AND(LEN(E1)>=5,LEN(E1)<=20)");

        // Text length
        let text_validation = DataValidation::new("F1:F10", ValidationType::TextLength)
            .operator(ValidationOperator::LessThanOrEqual)
            .formula1("50")
            .prompt("Input", "Enter up to 50 characters");
        writer.add(text_validation);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Verify structure
        assert!(xml.contains("<dataValidations count=\"6\">"));
        assert!(xml.contains("</dataValidations>"));

        // Verify all validations are present
        // Note: <dataValidations also matches <dataValidation, so count is 7 (1 container + 6 rules)
        assert_eq!(xml.matches("<dataValidation ").count(), 6);
        assert!(xml.matches("</dataValidation>").count() >= 5); // At least 5 have formulas
    }
}
