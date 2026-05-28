// ============================================================================
// DataValidationWriter
// ============================================================================

use crate::write::xml_writer::XmlWriter;

use super::format::format_f64;
use super::{DataValidation, ValidationOperator, ValidationType};

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
    pub fn write_to(&self, writer: &mut XmlWriter) {
        if self.validations.is_empty()
            && !self.disable_prompts
            && self.x_window.is_none()
            && self.y_window.is_none()
            && self.declared_count.is_none()
        {
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
