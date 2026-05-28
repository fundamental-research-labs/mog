// ============================================================================
// DataValidation
// ============================================================================

use crate::write::xml_writer::XmlWriter;

use super::{ErrorStyle, ValidationOperator, ValidationType};

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
