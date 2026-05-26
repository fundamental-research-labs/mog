//! Data validation parser for XLSX worksheets.
//!
//! This module parses `<dataValidations>` and `<dataValidation>` elements from
//! worksheet XML files according to ECMA-376 CT_DataValidation specification.
//!
//! # Supported Features
//! - All validation types: none, whole, decimal, list, date, time, textLength, custom
//! - All operators: between, notBetween, equal, notEqual, lessThan, lessThanOrEqual, greaterThan, greaterThanOrEqual
//! - Error and input message handling
//! - IME mode support for Asian locales
//! - Formula1 and Formula2 criteria
//!
//! # Performance
//! - Uses SIMD-optimized scanning functions from the scanner module
//! - Zero allocations in the hot path where possible
//! - Graceful handling of malformed input

use compute_parser::parsed_expr::{ParsedExpr, SqrefList};

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr_opt, parse_bytes_attr, parse_element_content, parse_string_attr, parse_u32_attr,
};

/// Find a non-namespaced XML tag, skipping namespace-prefixed variants.
///
/// `find_tag_simd` matches both `<tag>` and `<ns:tag>`. This wrapper filters
/// out the namespaced hits by checking that `bytes[pos+1]` starts the tag name
/// directly (e.g., `<dataValidations` not `<x14:dataValidations`).
fn find_non_namespaced_tag(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut search_from = start;
    loop {
        let pos = find_tag_simd(bytes, tag, search_from)?;
        // pos points to '<'. The byte at pos+1 should be the first byte of `tag`
        // for the non-namespaced variant.
        if pos + 1 < bytes.len() && bytes[pos + 1] == tag[0] {
            return Some(pos);
        }
        search_from = pos + 1;
    }
}

// ============================================================================
// Type Definitions
// ============================================================================

/// Data validation type (ST_DataValidationType)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum DataValidationType {
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

impl DataValidationType {
    /// Parse from XML attribute value
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"none" => Self::None,
            b"whole" => Self::Whole,
            b"decimal" => Self::Decimal,
            b"list" => Self::List,
            b"date" => Self::Date,
            b"time" => Self::Time,
            b"textLength" => Self::TextLength,
            b"custom" => Self::Custom,
            _ => Self::None,
        }
    }

    /// Convert to string representation
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

/// Data validation error style (ST_DataValidationErrorStyle)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum DataValidationErrorStyle {
    /// Stop input (default)
    #[default]
    Stop,
    /// Show warning but allow input
    Warning,
    /// Show information message
    Information,
}

impl DataValidationErrorStyle {
    /// Parse from XML attribute value
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"stop" => Self::Stop,
            b"warning" => Self::Warning,
            b"information" => Self::Information,
            _ => Self::Stop,
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Stop => "stop",
            Self::Warning => "warning",
            Self::Information => "information",
        }
    }
}

/// Data validation operator (ST_DataValidationOperator)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum DataValidationOperator {
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

impl DataValidationOperator {
    /// Parse from XML attribute value
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"between" => Self::Between,
            b"notBetween" => Self::NotBetween,
            b"equal" => Self::Equal,
            b"notEqual" => Self::NotEqual,
            b"lessThan" => Self::LessThan,
            b"lessThanOrEqual" => Self::LessThanOrEqual,
            b"greaterThan" => Self::GreaterThan,
            b"greaterThanOrEqual" => Self::GreaterThanOrEqual,
            _ => Self::Between,
        }
    }

    /// Convert to string representation
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
}

/// IME mode for data validation (ST_DataValidationImeMode)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub enum ImeMode {
    /// No control over IME (default)
    #[default]
    NoControl,
    /// IME off
    Off,
    /// IME on
    On,
    /// IME disabled
    Disabled,
    /// Hiragana mode
    Hiragana,
    /// Full-width Katakana mode
    FullKatakana,
    /// Half-width Katakana mode
    HalfKatakana,
    /// Full-width alphanumeric mode
    FullAlpha,
    /// Half-width alphanumeric mode
    HalfAlpha,
    /// Full-width Hangul mode
    FullHangul,
    /// Half-width Hangul mode
    HalfHangul,
}

impl ImeMode {
    /// Parse from XML attribute value
    pub fn from_bytes(bytes: &[u8]) -> Self {
        match bytes {
            b"noControl" => Self::NoControl,
            b"off" => Self::Off,
            b"on" => Self::On,
            b"disabled" => Self::Disabled,
            b"hiragana" => Self::Hiragana,
            b"fullKatakana" => Self::FullKatakana,
            b"halfKatakana" => Self::HalfKatakana,
            b"fullAlpha" => Self::FullAlpha,
            b"halfAlpha" => Self::HalfAlpha,
            b"fullHangul" => Self::FullHangul,
            b"halfHangul" => Self::HalfHangul,
            _ => Self::NoControl,
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoControl => "noControl",
            Self::Off => "off",
            Self::On => "on",
            Self::Disabled => "disabled",
            Self::Hiragana => "hiragana",
            Self::FullKatakana => "fullKatakana",
            Self::HalfKatakana => "halfKatakana",
            Self::FullAlpha => "fullAlpha",
            Self::HalfAlpha => "halfAlpha",
            Self::FullHangul => "fullHangul",
            Self::HalfHangul => "halfHangul",
        }
    }
}

// ============================================================================
// Data Validation Struct
// ============================================================================

/// Complete data validation rule (CT_DataValidation)
///
/// This struct represents a single data validation rule as defined in ECMA-376.
/// It can be applied to one or more cell ranges via the `sqref` field.
///
/// # Typed formula boundary:a — typed boundary
///
/// `formula1`, `formula2`, and `sqref` are typed at parse time:
///
/// - `formula1` / `formula2`: [`ParsedExpr`]. The `formula1` element of an
///   XLSX `<dataValidation>` carries either a **literal threshold** (a number,
///   a quoted text constant, an error token) or a **formula** (`=MAX($A:$A)`,
///   `TODAY()`, `AND(LEN(A1)>=5,LEN(A1)<=20)`). [`ParsedExpr::classify`]
///   discriminates: literals land in [`ParsedExpr::Constant`], formulas in
///   [`ParsedExpr::Formula`] (with the original bytes preserved on the
///   `FormulaSource` for round-trip writer fidelity), refs in
///   [`ParsedExpr::Cell`] / [`ParsedExpr::Range`] / [`ParsedExpr::SqrefList`],
///   `#REF!`-only inputs in [`ParsedExpr::BrokenRef`], and empty / whitespace
///   inputs in [`ParsedExpr::Empty`]. The `type="list"` shape (a comma-
///   separated quoted literal like `"Yes,No,Maybe"`) classifies as
///   [`ParsedExpr::Constant`] with the comma-list inside the text payload —
///   no separate `ValueList` variant is needed; consumers split on commas
///   knowing the validation type.
/// - `sqref`: [`SqrefList`]. The XLSX `sqref` attribute is a whitespace-
///   separated list of A1 ranges. Empty or malformed input maps to an empty
///   `SqrefList` via `Default::default()`.
#[derive(Debug, Clone, Default)]
pub struct DataValidation {
    /// Cell ranges this validation applies to (XLSX `sqref`).
    pub sqref: SqrefList,

    /// Validation type
    pub validation_type: DataValidationType,

    /// Comparison operator (used with whole, decimal, date, time, textLength)
    pub operator: DataValidationOperator,

    /// First formula/value for validation criteria — see struct-level docs for
    /// the literal-vs-formula discrimination contract.
    pub formula1: Option<ParsedExpr>,

    /// Authored formula1 text after XML entity decoding. This preserves
    /// authoring-significant range spelling such as `$F$292:$F$292`, while the
    /// typed `formula1` remains available for consumers that need semantics.
    pub formula1_raw: Option<String>,

    /// Second formula (for between/notBetween operators) — same shape as
    /// `formula1`.
    pub formula2: Option<ParsedExpr>,

    /// Authored formula2 text after XML entity decoding.
    pub formula2_raw: Option<String>,

    /// Allow blank cells
    pub allow_blank: bool,

    /// Show dropdown for list type (confusingly, false means SHOW the dropdown)
    pub show_drop_down: bool,

    /// Show input message when cell is selected
    pub show_input_message: bool,

    /// Show error message on invalid input
    pub show_error_message: bool,

    /// Error style (stop, warning, information)
    pub error_style: DataValidationErrorStyle,

    /// Error message title
    pub error_title: Option<String>,

    /// Error message text
    pub error: Option<String>,

    /// Input prompt title
    pub prompt_title: Option<String>,

    /// Input prompt text
    pub prompt: Option<String>,

    /// IME mode for Asian locales
    pub ime_mode: ImeMode,

    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    pub uid: Option<String>,
}

/// Container for all data validations in a worksheet (CT_DataValidations)
#[derive(Debug, Clone, Default)]
pub struct DataValidations {
    /// Whether to disable validation prompts
    pub disable_prompts: bool,

    /// X window position for prompt
    pub x_window: Option<u32>,

    /// Y window position for prompt
    pub y_window: Option<u32>,

    /// Number of validations (as declared in XML, may differ from actual count)
    pub count: Option<u32>,

    /// List of data validation rules
    pub validations: Vec<DataValidation>,
}

// ============================================================================
// Parsing Implementation
// ============================================================================

impl DataValidations {
    /// Parse data validations from worksheet XML.
    ///
    /// # Arguments
    /// * `xml` - Raw bytes of the worksheet XML
    ///
    /// # Returns
    /// Parsed DataValidations struct, or None if no validations found
    pub fn parse(xml: &[u8]) -> Option<Self> {
        // Find <dataValidations> section (non-namespaced only;
        // x14:dataValidations inside extLst has a different schema).
        let dv_start = find_non_namespaced_tag(xml, b"dataValidations", 0)?;
        let dv_end = find_closing_tag(xml, b"dataValidations", dv_start).unwrap_or(xml.len());

        let section = &xml[dv_start..dv_end];
        let mut validations = DataValidations::default();

        // Parse container attributes
        validations.parse_container_attrs(section);

        // Parse individual <dataValidation> elements
        let mut pos = 0;
        while let Some(dv_pos) = find_tag_simd(section, b"dataValidation", pos) {
            // Avoid matching dataValidations again
            if dv_pos + 14 < section.len() && section[dv_pos + 15] == b's' {
                pos = dv_pos + 1;
                continue;
            }

            // Find the end of this dataValidation element
            let element_end = Self::find_element_end(section, dv_pos);

            if let Some(dv) = DataValidation::parse(&section[dv_pos..element_end]) {
                validations.validations.push(dv);
            }

            pos = element_end;
        }

        if validations.validations.is_empty() {
            None
        } else {
            Some(validations)
        }
    }

    /// Parse container attributes from <dataValidations> element
    fn parse_container_attrs(&mut self, xml: &[u8]) {
        // Find the opening tag end
        let tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
        let tag = &xml[..tag_end];

        // Parse disablePrompts
        if let Some(value) = parse_bool_attr_opt(tag, b"disablePrompts=\"") {
            self.disable_prompts = value;
        }

        // Parse xWindow
        if let Some(value) = parse_u32_attr(tag, b"xWindow=\"") {
            self.x_window = Some(value);
        }

        // Parse yWindow
        if let Some(value) = parse_u32_attr(tag, b"yWindow=\"") {
            self.y_window = Some(value);
        }

        // Parse count
        if let Some(value) = parse_u32_attr(tag, b"count=\"") {
            self.count = Some(value);
        }
    }

    /// Find the end of a dataValidation element (handles both self-closing and regular)
    fn find_element_end(xml: &[u8], start: usize) -> usize {
        // First, check if this is a self-closing tag
        let mut pos = start;
        let mut in_quotes = false;

        while pos < xml.len() {
            let b = xml[pos];

            if b == b'"' {
                in_quotes = !in_quotes;
            } else if !in_quotes {
                if b == b'/' && pos + 1 < xml.len() && xml[pos + 1] == b'>' {
                    // Self-closing tag />
                    return pos + 2;
                } else if b == b'>' {
                    // Opening tag, need to find closing tag
                    break;
                }
            }
            pos += 1;
        }

        // Find closing </dataValidation>
        find_closing_tag(xml, b"dataValidation", pos)
            .and_then(|close_start| find_gt_simd(xml, close_start).map(|gt| gt + 1))
            .unwrap_or(xml.len())
    }
}

impl DataValidation {
    /// Parse a single dataValidation element
    fn parse(xml: &[u8]) -> Option<Self> {
        let mut dv = DataValidation::default();

        // Find the opening tag end
        let tag_end = find_gt_simd(xml, 0)?;
        let tag = &xml[..tag_end];

        // Parse sqref (required) — typed at parse time via SqrefList::parse.
        // Malformed sqref (non-empty attribute that fails to parse) yields an
        // empty SqrefList; the rule is still emitted because downstream
        // consumers may still want the formula payload for diagnostics.
        if let Some(sqref) = parse_string_attr(tag, b"sqref=\"") {
            dv.sqref = SqrefList::parse(&sqref).unwrap_or_default();
        } else {
            // sqref is required
            return None;
        }

        // Parse type
        if let Some(value) = parse_bytes_attr(tag, b"type=\"") {
            dv.validation_type = DataValidationType::from_bytes(value);
        }

        // Parse operator
        if let Some(value) = parse_bytes_attr(tag, b"operator=\"") {
            dv.operator = DataValidationOperator::from_bytes(value);
        }

        // Parse allowBlank
        if let Some(value) = parse_bool_attr_opt(tag, b"allowBlank=\"") {
            dv.allow_blank = value;
        }

        // Parse showDropDown (note: confusingly named - false shows dropdown)
        if let Some(value) = parse_bool_attr_opt(tag, b"showDropDown=\"") {
            dv.show_drop_down = value;
        }

        // Parse showInputMessage
        if let Some(value) = parse_bool_attr_opt(tag, b"showInputMessage=\"") {
            dv.show_input_message = value;
        }

        // Parse showErrorMessage
        if let Some(value) = parse_bool_attr_opt(tag, b"showErrorMessage=\"") {
            dv.show_error_message = value;
        }

        // Parse errorStyle
        if let Some(value) = parse_bytes_attr(tag, b"errorStyle=\"") {
            dv.error_style = DataValidationErrorStyle::from_bytes(value);
        }

        // Parse errorTitle
        if let Some(value) = parse_string_attr(tag, b"errorTitle=\"") {
            dv.error_title = Some(value);
        }

        // Parse error
        if let Some(value) = parse_string_attr(tag, b"error=\"") {
            dv.error = Some(value);
        }

        // Parse promptTitle
        if let Some(value) = parse_string_attr(tag, b"promptTitle=\"") {
            dv.prompt_title = Some(value);
        }

        // Parse prompt
        if let Some(value) = parse_string_attr(tag, b"prompt=\"") {
            dv.prompt = Some(value);
        }

        // Parse imeMode
        if let Some(value) = parse_bytes_attr(tag, b"imeMode=\"") {
            dv.ime_mode = ImeMode::from_bytes(value);
        }

        // Parse xr:uid (revision tracking extension)
        dv.uid = parse_string_attr(tag, b"xr:uid=\"");

        // Parse formula1 (as child element) — typed at parse time via
        // ParsedExpr::classify. The classifier is total over UTF-8 and
        // dispatches: literals (`5`, `"abc"`) → Constant, formulas
        // (`=MAX($A:$A)`) → Formula, refs → Cell/Range/SqrefList,
        // `#REF!` → BrokenRef, empty → Empty.
        if let Some(formula) = parse_element_content(xml, b"formula1") {
            dv.formula1 = Some(ParsedExpr::classify(&formula));
            dv.formula1_raw = Some(formula);
        }

        // Parse formula2 (as child element)
        if let Some(formula) = parse_element_content(xml, b"formula2") {
            dv.formula2 = Some(ParsedExpr::classify(&formula));
            dv.formula2_raw = Some(formula);
        }

        Some(dv)
    }
}

// ============================================================================
// Domain Coordinator
// ============================================================================

/// Parse data validations from worksheet XML and return as DvSummary structs.
///
/// Finds all `<dataValidation>` elements and returns them as a vector of
/// DvSummary structs containing the sqref, type, operator, and allow_blank flag.
///
/// # Arguments
/// * `xml` - The worksheet XML bytes
///
/// # Returns
/// A vector of DvSummary, one for each data validation rule
/// Container-level attributes from `<dataValidations>`.
#[derive(Debug, Clone, Default)]
pub struct DataValidationsContainerAttrs {
    pub disable_prompts: bool,
    pub x_window: Option<u32>,
    pub y_window: Option<u32>,
    pub declared_count: Option<u32>,
}

/// Returns (validations, container_attrs).
pub fn parse_data_validations(
    xml: &[u8],
) -> (
    Vec<crate::output::results::DvSummary>,
    DataValidationsContainerAttrs,
) {
    DataValidations::parse(xml)
        .map(|dvs| {
            let attrs = DataValidationsContainerAttrs {
                disable_prompts: dvs.disable_prompts,
                x_window: dvs.x_window,
                y_window: dvs.y_window,
                declared_count: dvs.count,
            };
            let summaries = dvs
                .validations
                .iter()
                .map(|dv| {
                    // OOXML showDropDown="1" means HIDE the dropdown (inverted).
                    // Parser stores raw OOXML value (true = hidden).
                    // Domain wants intuitive semantics (true = visible).
                    let show_dropdown = !dv.show_drop_down;
                    // Wire boundary: the typed DataValidation feeds DvSummary
                    // (the JSON wire shape) which uses String for backward
                    // compatibility. Round-trip fidelity is preserved by:
                    // - SqrefList::to_a1_string for the sqref (canonical A1).
                    // - ParsedExpr::to_a1_string for formula1/formula2:
                    //   FormulaSource.original is emitted verbatim for
                    //   formulas; ref/sqref/constant variants emit the
                    //   canonical typed serialization.
                    // imeMode serializes as empty string when the OOXML
                    // attribute was absent, so consumers that materialize
                    // the summary back into a typed `ImeMode` get the
                    // schema default (`NoControl`).
                    let ime_mode_str = if dv.ime_mode == ImeMode::NoControl {
                        String::new()
                    } else {
                        dv.ime_mode.as_str().to_string()
                    };
                    crate::output::results::DvSummary {
                        sqref: dv.sqref.to_a1_string(),
                        validation_type: dv.validation_type.as_str().to_string(),
                        operator: dv.operator.as_str().to_string(),
                        allow_blank: dv.allow_blank,
                        formula1: dv.formula1_raw.clone().or_else(|| {
                            dv.formula1.as_ref().map(|p| p.to_a1_string().into_owned())
                        }),
                        formula2: dv.formula2_raw.clone().or_else(|| {
                            dv.formula2.as_ref().map(|p| p.to_a1_string().into_owned())
                        }),
                        show_dropdown,
                        error_style: dv.error_style.as_str().to_string(),
                        show_error: dv.show_error_message,
                        error_title: dv.error_title.clone(),
                        error_message: dv.error.clone(),
                        show_input: dv.show_input_message,
                        prompt_title: dv.prompt_title.clone(),
                        prompt_message: dv.prompt.clone(),
                        ime_mode: ime_mode_str,
                        uid: dv.uid.clone(),
                    }
                })
                .collect();
            (summaries, attrs)
        })
        .unwrap_or_default()
}

// ============================================================================
// Helper Functions
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::xml::{decode_xml_entities, parse_bool_attr_opt as parse_bool_attr};

    // -------------------------------------------------------------------------
    // DataValidationType tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_validation_type_from_bytes() {
        assert_eq!(
            DataValidationType::from_bytes(b"none"),
            DataValidationType::None
        );
        assert_eq!(
            DataValidationType::from_bytes(b"whole"),
            DataValidationType::Whole
        );
        assert_eq!(
            DataValidationType::from_bytes(b"decimal"),
            DataValidationType::Decimal
        );
        assert_eq!(
            DataValidationType::from_bytes(b"list"),
            DataValidationType::List
        );
        assert_eq!(
            DataValidationType::from_bytes(b"date"),
            DataValidationType::Date
        );
        assert_eq!(
            DataValidationType::from_bytes(b"time"),
            DataValidationType::Time
        );
        assert_eq!(
            DataValidationType::from_bytes(b"textLength"),
            DataValidationType::TextLength
        );
        assert_eq!(
            DataValidationType::from_bytes(b"custom"),
            DataValidationType::Custom
        );
        assert_eq!(
            DataValidationType::from_bytes(b"unknown"),
            DataValidationType::None
        );
    }

    #[test]
    fn test_validation_type_as_str() {
        assert_eq!(DataValidationType::None.as_str(), "none");
        assert_eq!(DataValidationType::Whole.as_str(), "whole");
        assert_eq!(DataValidationType::Decimal.as_str(), "decimal");
        assert_eq!(DataValidationType::List.as_str(), "list");
        assert_eq!(DataValidationType::Date.as_str(), "date");
        assert_eq!(DataValidationType::Time.as_str(), "time");
        assert_eq!(DataValidationType::TextLength.as_str(), "textLength");
        assert_eq!(DataValidationType::Custom.as_str(), "custom");
    }

    // -------------------------------------------------------------------------
    // DataValidationErrorStyle tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_error_style_from_bytes() {
        assert_eq!(
            DataValidationErrorStyle::from_bytes(b"stop"),
            DataValidationErrorStyle::Stop
        );
        assert_eq!(
            DataValidationErrorStyle::from_bytes(b"warning"),
            DataValidationErrorStyle::Warning
        );
        assert_eq!(
            DataValidationErrorStyle::from_bytes(b"information"),
            DataValidationErrorStyle::Information
        );
        assert_eq!(
            DataValidationErrorStyle::from_bytes(b"unknown"),
            DataValidationErrorStyle::Stop
        );
    }

    #[test]
    fn test_error_style_as_str() {
        assert_eq!(DataValidationErrorStyle::Stop.as_str(), "stop");
        assert_eq!(DataValidationErrorStyle::Warning.as_str(), "warning");
        assert_eq!(
            DataValidationErrorStyle::Information.as_str(),
            "information"
        );
    }

    // -------------------------------------------------------------------------
    // DataValidationOperator tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_operator_from_bytes() {
        assert_eq!(
            DataValidationOperator::from_bytes(b"between"),
            DataValidationOperator::Between
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"notBetween"),
            DataValidationOperator::NotBetween
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"equal"),
            DataValidationOperator::Equal
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"notEqual"),
            DataValidationOperator::NotEqual
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"lessThan"),
            DataValidationOperator::LessThan
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"lessThanOrEqual"),
            DataValidationOperator::LessThanOrEqual
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"greaterThan"),
            DataValidationOperator::GreaterThan
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"greaterThanOrEqual"),
            DataValidationOperator::GreaterThanOrEqual
        );
        assert_eq!(
            DataValidationOperator::from_bytes(b"unknown"),
            DataValidationOperator::Between
        );
    }

    #[test]
    fn test_operator_as_str() {
        assert_eq!(DataValidationOperator::Between.as_str(), "between");
        assert_eq!(DataValidationOperator::NotBetween.as_str(), "notBetween");
        assert_eq!(DataValidationOperator::Equal.as_str(), "equal");
        assert_eq!(DataValidationOperator::NotEqual.as_str(), "notEqual");
        assert_eq!(DataValidationOperator::LessThan.as_str(), "lessThan");
        assert_eq!(
            DataValidationOperator::LessThanOrEqual.as_str(),
            "lessThanOrEqual"
        );
        assert_eq!(DataValidationOperator::GreaterThan.as_str(), "greaterThan");
        assert_eq!(
            DataValidationOperator::GreaterThanOrEqual.as_str(),
            "greaterThanOrEqual"
        );
    }

    // -------------------------------------------------------------------------
    // ImeMode tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_ime_mode_from_bytes() {
        assert_eq!(ImeMode::from_bytes(b"noControl"), ImeMode::NoControl);
        assert_eq!(ImeMode::from_bytes(b"off"), ImeMode::Off);
        assert_eq!(ImeMode::from_bytes(b"on"), ImeMode::On);
        assert_eq!(ImeMode::from_bytes(b"disabled"), ImeMode::Disabled);
        assert_eq!(ImeMode::from_bytes(b"hiragana"), ImeMode::Hiragana);
        assert_eq!(ImeMode::from_bytes(b"fullKatakana"), ImeMode::FullKatakana);
        assert_eq!(ImeMode::from_bytes(b"halfKatakana"), ImeMode::HalfKatakana);
        assert_eq!(ImeMode::from_bytes(b"fullAlpha"), ImeMode::FullAlpha);
        assert_eq!(ImeMode::from_bytes(b"halfAlpha"), ImeMode::HalfAlpha);
        assert_eq!(ImeMode::from_bytes(b"fullHangul"), ImeMode::FullHangul);
        assert_eq!(ImeMode::from_bytes(b"halfHangul"), ImeMode::HalfHangul);
        assert_eq!(ImeMode::from_bytes(b"unknown"), ImeMode::NoControl);
    }

    #[test]
    fn test_ime_mode_as_str() {
        assert_eq!(ImeMode::NoControl.as_str(), "noControl");
        assert_eq!(ImeMode::Off.as_str(), "off");
        assert_eq!(ImeMode::On.as_str(), "on");
        assert_eq!(ImeMode::Disabled.as_str(), "disabled");
        assert_eq!(ImeMode::Hiragana.as_str(), "hiragana");
        assert_eq!(ImeMode::FullKatakana.as_str(), "fullKatakana");
        assert_eq!(ImeMode::HalfKatakana.as_str(), "halfKatakana");
        assert_eq!(ImeMode::FullAlpha.as_str(), "fullAlpha");
        assert_eq!(ImeMode::HalfAlpha.as_str(), "halfAlpha");
        assert_eq!(ImeMode::FullHangul.as_str(), "fullHangul");
        assert_eq!(ImeMode::HalfHangul.as_str(), "halfHangul");
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_decode_xml_entities_basic() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
    }

    #[test]
    fn test_decode_xml_entities_combined() {
        assert_eq!(
            decode_xml_entities(b"a &lt; b &amp;&amp; c &gt; d"),
            "a < b && c > d"
        );
        assert_eq!(decode_xml_entities(b"&lt;&gt;&amp;&quot;&apos;"), "<>&\"'");
    }

    #[test]
    fn test_decode_xml_entities_numeric() {
        assert_eq!(decode_xml_entities(b"&#65;"), "A");
        assert_eq!(decode_xml_entities(b"&#x41;"), "A");
        assert_eq!(decode_xml_entities(b"&#X41;"), "A");
        assert_eq!(decode_xml_entities(b"&#8364;"), "\u{20AC}"); // Euro sign
    }

    #[test]
    fn test_decode_xml_entities_unknown() {
        // Unknown entities should preserve the &
        assert_eq!(decode_xml_entities(b"&unknown;"), "&unknown;");
    }

    #[test]
    fn test_parse_bool_attr() {
        let xml = b"<element attr1=\"1\" attr2=\"true\" attr3=\"0\" attr4=\"false\">";
        assert_eq!(parse_bool_attr(xml, b"attr1=\""), Some(true));
        assert_eq!(parse_bool_attr(xml, b"attr2=\""), Some(true));
        assert_eq!(parse_bool_attr(xml, b"attr3=\""), Some(false));
        assert_eq!(parse_bool_attr(xml, b"attr4=\""), Some(false));
        assert_eq!(parse_bool_attr(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_parse_u32_attr() {
        let xml = b"<element count=\"42\" zero=\"0\" large=\"1000000\">";
        assert_eq!(parse_u32_attr(xml, b"count=\""), Some(42));
        assert_eq!(parse_u32_attr(xml, b"zero=\""), Some(0));
        assert_eq!(parse_u32_attr(xml, b"large=\""), Some(1000000));
        assert_eq!(parse_u32_attr(xml, b"notfound=\""), None);
    }

    #[test]
    fn test_parse_string_attr() {
        let xml = b"<element name=\"hello\" msg=\"&lt;test&gt;\" empty=\"\">";
        assert_eq!(
            parse_string_attr(xml, b"name=\""),
            Some("hello".to_string())
        );
        assert_eq!(
            parse_string_attr(xml, b"msg=\""),
            Some("<test>".to_string())
        );
        assert_eq!(parse_string_attr(xml, b"empty=\""), Some("".to_string()));
        assert_eq!(parse_string_attr(xml, b"notfound=\""), None);
    }

    // -------------------------------------------------------------------------
    // DataValidation parsing tests
    // -------------------------------------------------------------------------

    /// Helper: render a `DataValidation`'s typed sqref back to canonical A1.
    fn sqref_str(dv: &DataValidation) -> String {
        dv.sqref.to_a1_string()
    }

    /// Helper: render a typed formula (Option<ParsedExpr>) back to canonical
    /// A1, mirroring what the wire boundary emits into `DvSummary`.
    fn formula_str(p: &Option<ParsedExpr>) -> Option<String> {
        p.as_ref().map(|e| e.to_a1_string().into_owned())
    }

    #[test]
    fn test_parse_simple_list_validation() {
        let xml = br#"<dataValidation type="list" sqref="A1:A10" allowBlank="1" showInputMessage="1" showErrorMessage="1">
            <formula1>"Option1,Option2,Option3"</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(sqref_str(&dv), "A1:A10");
        assert_eq!(dv.validation_type, DataValidationType::List);
        assert!(dv.allow_blank);
        assert!(dv.show_input_message);
        assert!(dv.show_error_message);
        assert_eq!(
            formula_str(&dv.formula1),
            Some("\"Option1,Option2,Option3\"".to_string())
        );
        // Verify the typed variant: a list literal classifies as Constant(Text).
        match dv.formula1 {
            Some(ParsedExpr::Constant(ref v)) => {
                assert_eq!(v.as_text(), Some("Option1,Option2,Option3"));
            }
            other => panic!("expected Constant(Text) for list literal, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_whole_number_validation() {
        let xml =
            br#"<dataValidation type="whole" operator="between" sqref="B1:B100" allowBlank="0">
            <formula1>1</formula1>
            <formula2>100</formula2>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(sqref_str(&dv), "B1:B100");
        assert_eq!(dv.validation_type, DataValidationType::Whole);
        assert_eq!(dv.operator, DataValidationOperator::Between);
        assert!(!dv.allow_blank);
        assert_eq!(formula_str(&dv.formula1), Some("1".to_string()));
        assert_eq!(formula_str(&dv.formula2), Some("100".to_string()));
        // Verify the typed variant: numeric thresholds classify as Constant(Number).
        assert!(matches!(
            dv.formula1,
            Some(ParsedExpr::Constant(value_types::CellValue::Number(_)))
        ));
    }

    #[test]
    fn test_parse_decimal_validation() {
        let xml = br#"<dataValidation type="decimal" operator="greaterThan" sqref="C1" errorStyle="warning" errorTitle="Invalid" error="Enter a number greater than 0">
            <formula1>0</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.validation_type, DataValidationType::Decimal);
        assert_eq!(dv.operator, DataValidationOperator::GreaterThan);
        assert_eq!(dv.error_style, DataValidationErrorStyle::Warning);
        assert_eq!(dv.error_title, Some("Invalid".to_string()));
        assert_eq!(dv.error, Some("Enter a number greater than 0".to_string()));
    }

    #[test]
    fn test_parse_date_validation() {
        let xml = br#"<dataValidation type="date" operator="greaterThanOrEqual" sqref="D1:D50">
            <formula1>TODAY()</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.validation_type, DataValidationType::Date);
        assert_eq!(dv.operator, DataValidationOperator::GreaterThanOrEqual);
        assert_eq!(formula_str(&dv.formula1), Some("TODAY()".to_string()));
        // TODAY() is a function call, so it classifies as Formula via the
        // FormulaSource fallback (preserves bytes verbatim).
        assert!(matches!(dv.formula1, Some(ParsedExpr::Formula(_))));
    }

    #[test]
    fn test_parse_time_validation() {
        let xml = br#"<dataValidation type="time" operator="between" sqref="E1">
            <formula1>0.333333</formula1>
            <formula2>0.708333</formula2>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.validation_type, DataValidationType::Time);
        // Note: 0.333333 (non-integer) is emitted by the canonical Number
        // serializer using Rust's default float formatting.
        assert_eq!(formula_str(&dv.formula1), Some("0.333333".to_string()));
        assert_eq!(formula_str(&dv.formula2), Some("0.708333".to_string()));
    }

    #[test]
    fn test_parse_text_length_validation() {
        let xml = br#"<dataValidation type="textLength" operator="lessThanOrEqual" sqref="F1:F100">
            <formula1>255</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.validation_type, DataValidationType::TextLength);
        assert_eq!(dv.operator, DataValidationOperator::LessThanOrEqual);
        assert_eq!(formula_str(&dv.formula1), Some("255".to_string()));
    }

    #[test]
    fn test_parse_custom_validation() {
        let xml = br#"<dataValidation type="custom" sqref="G1:G10" showErrorMessage="1" error="Invalid format">
            <formula1>ISNUMBER(G1)</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.validation_type, DataValidationType::Custom);
        assert_eq!(formula_str(&dv.formula1), Some("ISNUMBER(G1)".to_string()));
        assert!(matches!(dv.formula1, Some(ParsedExpr::Formula(_))));
    }

    #[test]
    fn test_parse_validation_with_prompts() {
        let xml = br#"<dataValidation type="list" sqref="H1" showInputMessage="1" promptTitle="Select Option" prompt="Choose from the dropdown">
            <formula1>$J$1:$J$5</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert!(dv.show_input_message);
        assert_eq!(dv.prompt_title, Some("Select Option".to_string()));
        assert_eq!(dv.prompt, Some("Choose from the dropdown".to_string()));
        // A range-shaped list source classifies as Range, not Constant.
        assert!(matches!(dv.formula1, Some(ParsedExpr::Range(_))));
        assert_eq!(formula_str(&dv.formula1), Some("$J$1:$J$5".to_string()));
    }

    #[test]
    fn test_parse_validation_with_ime_mode() {
        let xml = br#"<dataValidation type="textLength" sqref="I1" imeMode="hiragana">
            <formula1>100</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.ime_mode, ImeMode::Hiragana);
    }

    #[test]
    fn test_parse_self_closing_validation() {
        let xml = br#"<dataValidation type="list" sqref="J1" allowBlank="1"/>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(sqref_str(&dv), "J1");
        assert_eq!(dv.validation_type, DataValidationType::List);
        assert!(dv.allow_blank);
        assert!(dv.formula1.is_none());
    }

    #[test]
    fn test_parse_validation_missing_sqref() {
        let xml = br#"<dataValidation type="list" allowBlank="1"/>"#;
        assert!(DataValidation::parse(xml).is_none());
    }

    #[test]
    fn test_parse_validation_multiple_ranges() {
        let xml =
            br#"<dataValidation type="whole" sqref="A1:A10 C1:C10 E1:E10" operator="greaterThan">
            <formula1>0</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        // The typed SqrefList holds three ranges; canonical re-emission keeps
        // the multi-range structure with single-space separators.
        assert_eq!(dv.sqref.len(), 3);
        assert_eq!(sqref_str(&dv), "A1:A10 C1:C10 E1:E10");
    }

    #[test]
    fn test_parse_validation_with_xml_entities() {
        let xml = br#"<dataValidation type="list" sqref="K1" error="Value must be &lt;= 100 &amp; &gt;= 0">
            <formula1>"A&amp;B,C&lt;D"</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.error, Some("Value must be <= 100 & >= 0".to_string()));
        assert_eq!(formula_str(&dv.formula1), Some("\"A&B,C<D\"".to_string()));
    }

    // -------------------------------------------------------------------------
    // DataValidations container tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_validations_container() {
        let xml = br#"<worksheet>
            <dataValidations count="2" disablePrompts="0" xWindow="100" yWindow="200">
                <dataValidation allowBlank="1" prompt="Invalid Status - Please select a status from the dropdown list." showErrorMessage="1" showInputMessage="1" sqref="C6" type="list">
                    <formula1>&quot;Not Started / Holding,Planning,In Progress,Complete,Delayed&quot;</formula1>
                </dataValidation>
            </dataValidations>
        </worksheet>"#;

        let dvs = DataValidations::parse(xml).unwrap();
        assert_eq!(dvs.count, Some(2));
        assert!(!dvs.disable_prompts);
        assert_eq!(dvs.x_window, Some(100));
        assert_eq!(dvs.y_window, Some(200));
        assert_eq!(dvs.validations.len(), 1);

        assert_eq!(sqref_str(&dvs.validations[0]), "C6");
        assert_eq!(dvs.validations[0].validation_type, DataValidationType::List);
        assert_eq!(
            formula_str(&dvs.validations[0].formula1),
            Some("\"Not Started / Holding,Planning,In Progress,Complete,Delayed\"".to_string())
        );
    }

    #[test]
    fn test_parse_validations_empty() {
        let xml = b"<worksheet><sheetData/></worksheet>";
        assert!(DataValidations::parse(xml).is_none());
    }

    #[test]
    fn test_parse_validations_no_count() {
        let xml = br#"<worksheet>
            <dataValidations>
                <dataValidation type="list" sqref="A1"/>
            </dataValidations>
        </worksheet>"#;

        let dvs = DataValidations::parse(xml).unwrap();
        assert_eq!(dvs.count, None);
        assert_eq!(dvs.validations.len(), 1);
    }

    // -------------------------------------------------------------------------
    // Edge cases and error handling
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_validation_empty_formula() {
        let xml = br#"<dataValidation type="list" sqref="A1">
            <formula1></formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        // Empty `<formula1/>` content classifies as ParsedExpr::Empty, which
        // re-emits as the empty string — matching the previous String-typed
        // contract for downstream consumers.
        assert_eq!(formula_str(&dv.formula1), Some(String::new()));
        assert!(matches!(dv.formula1, Some(ParsedExpr::Empty)));
    }

    #[test]
    fn test_parse_validation_default_values() {
        let xml = br#"<dataValidation sqref="A1"/>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.validation_type, DataValidationType::None);
        assert_eq!(dv.operator, DataValidationOperator::Between);
        assert_eq!(dv.error_style, DataValidationErrorStyle::Stop);
        assert_eq!(dv.ime_mode, ImeMode::NoControl);
        assert!(!dv.allow_blank);
        assert!(!dv.show_drop_down);
        assert!(!dv.show_input_message);
        assert!(!dv.show_error_message);
    }

    #[test]
    fn test_parse_validation_all_operators() {
        let operators = [
            ("between", DataValidationOperator::Between),
            ("notBetween", DataValidationOperator::NotBetween),
            ("equal", DataValidationOperator::Equal),
            ("notEqual", DataValidationOperator::NotEqual),
            ("lessThan", DataValidationOperator::LessThan),
            ("lessThanOrEqual", DataValidationOperator::LessThanOrEqual),
            ("greaterThan", DataValidationOperator::GreaterThan),
            (
                "greaterThanOrEqual",
                DataValidationOperator::GreaterThanOrEqual,
            ),
        ];

        for (op_str, expected) in operators {
            let xml = format!(r#"<dataValidation sqref="A1" operator="{}"/>"#, op_str);
            let dv = DataValidation::parse(xml.as_bytes()).unwrap();
            assert_eq!(dv.operator, expected, "Failed for operator: {}", op_str);
        }
    }

    #[test]
    fn test_parse_validation_all_types() {
        let types = [
            ("none", DataValidationType::None),
            ("whole", DataValidationType::Whole),
            ("decimal", DataValidationType::Decimal),
            ("list", DataValidationType::List),
            ("date", DataValidationType::Date),
            ("time", DataValidationType::Time),
            ("textLength", DataValidationType::TextLength),
            ("custom", DataValidationType::Custom),
        ];

        for (type_str, expected) in types {
            let xml = format!(r#"<dataValidation sqref="A1" type="{}"/>"#, type_str);
            let dv = DataValidation::parse(xml.as_bytes()).unwrap();
            assert_eq!(
                dv.validation_type, expected,
                "Failed for type: {}",
                type_str
            );
        }
    }

    #[test]
    fn test_parse_validation_all_error_styles() {
        let styles = [
            ("stop", DataValidationErrorStyle::Stop),
            ("warning", DataValidationErrorStyle::Warning),
            ("information", DataValidationErrorStyle::Information),
        ];

        for (style_str, expected) in styles {
            let xml = format!(r#"<dataValidation sqref="A1" errorStyle="{}"/>"#, style_str);
            let dv = DataValidation::parse(xml.as_bytes()).unwrap();
            assert_eq!(dv.error_style, expected, "Failed for style: {}", style_str);
        }
    }

    #[test]
    fn test_parse_validation_all_ime_modes() {
        let modes = [
            ("noControl", ImeMode::NoControl),
            ("off", ImeMode::Off),
            ("on", ImeMode::On),
            ("disabled", ImeMode::Disabled),
            ("hiragana", ImeMode::Hiragana),
            ("fullKatakana", ImeMode::FullKatakana),
            ("halfKatakana", ImeMode::HalfKatakana),
            ("fullAlpha", ImeMode::FullAlpha),
            ("halfAlpha", ImeMode::HalfAlpha),
            ("fullHangul", ImeMode::FullHangul),
            ("halfHangul", ImeMode::HalfHangul),
        ];

        for (mode_str, expected) in modes {
            let xml = format!(r#"<dataValidation sqref="A1" imeMode="{}"/>"#, mode_str);
            let dv = DataValidation::parse(xml.as_bytes()).unwrap();
            assert_eq!(dv.ime_mode, expected, "Failed for mode: {}", mode_str);
        }
    }

    #[test]
    fn test_parse_realistic_worksheet() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <sheetData>
        <row r="1">
            <c r="A1"><v>Test</v></c>
        </row>
    </sheetData>
    <dataValidations count="3">
        <dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="A2:A100" promptTitle="Select Status" prompt="Choose a status from the list">
            <formula1>"Active,Inactive,Pending"</formula1>
        </dataValidation>
        <dataValidation type="whole" operator="between" allowBlank="1" showErrorMessage="1" sqref="B2:B100" errorTitle="Invalid Age" error="Please enter a whole number between 0 and 120">
            <formula1>0</formula1>
            <formula2>120</formula2>
        </dataValidation>
        <dataValidation type="date" operator="greaterThanOrEqual" sqref="C2:C100" errorStyle="warning" errorTitle="Date Warning" error="Date should be today or later">
            <formula1>TODAY()</formula1>
        </dataValidation>
    </dataValidations>
</worksheet>"#;

        let dvs = DataValidations::parse(xml).unwrap();
        assert_eq!(dvs.validations.len(), 3);

        // Check list validation
        let list_dv = &dvs.validations[0];
        assert_eq!(list_dv.validation_type, DataValidationType::List);
        assert_eq!(sqref_str(list_dv), "A2:A100");
        assert!(list_dv.allow_blank);
        assert!(list_dv.show_input_message);
        assert!(list_dv.show_error_message);
        assert_eq!(list_dv.prompt_title, Some("Select Status".to_string()));

        // Check whole number validation
        let whole_dv = &dvs.validations[1];
        assert_eq!(whole_dv.validation_type, DataValidationType::Whole);
        assert_eq!(whole_dv.operator, DataValidationOperator::Between);
        assert_eq!(formula_str(&whole_dv.formula1), Some("0".to_string()));
        assert_eq!(formula_str(&whole_dv.formula2), Some("120".to_string()));
        assert_eq!(whole_dv.error_title, Some("Invalid Age".to_string()));

        // Check date validation
        let date_dv = &dvs.validations[2];
        assert_eq!(date_dv.validation_type, DataValidationType::Date);
        assert_eq!(date_dv.error_style, DataValidationErrorStyle::Warning);
    }

    #[test]
    fn test_parse_malformed_xml_missing_closing_tag() {
        let xml = b"<dataValidations><dataValidation sqref=\"A1\">";
        // Should not panic, may return partial results or None
        let result = DataValidations::parse(xml);
        // Result depends on implementation, but should not panic
        let _ = result;
    }

    #[test]
    fn test_parse_malformed_xml_invalid_attributes() {
        let xml = br#"<dataValidation sqref="A1" type="invalid_type" operator="invalid_op"/>"#;
        let dv = DataValidation::parse(xml).unwrap();
        // Invalid values should fall back to defaults
        assert_eq!(dv.validation_type, DataValidationType::None);
        assert_eq!(dv.operator, DataValidationOperator::Between);
    }

    #[test]
    fn test_parse_data_validations() {
        let xml = br#"<worksheet><dataValidations><dataValidation type="whole" sqref="A1" allowBlank="1"/></dataValidations></worksheet>"#;
        let (validations, _attrs) = parse_data_validations(xml);
        assert_eq!(validations.len(), 1);
        assert_eq!(validations[0].sqref, "A1");
        assert_eq!(validations[0].validation_type, "whole");
    }

    #[test]
    fn parse_data_validations_exposes_declared_count_and_ignores_x14_extlst() {
        let xml = br#"<worksheet><sheetData/>
            <dataValidations count="2">
                <dataValidation allowBlank="1" sqref="C6" type="list">
                    <formula1>&quot;Not Started / Holding,Planning,In Progress,Complete,Delayed&quot;</formula1>
                </dataValidation>
            </dataValidations>
            <extLst>
                <ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}">
                    <x14:dataValidations xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1">
                        <x14:dataValidation allowBlank="1" sqref="C25:C29" type="list">
                            <x14:formula1><xm:f>Data!$E$2:$E$6</xm:f></x14:formula1>
                            <xm:sqref>C25:C29</xm:sqref>
                        </x14:dataValidation>
                    </x14:dataValidations>
                </ext>
            </extLst>
        </worksheet>"#;

        let (summaries, attrs) = parse_data_validations(xml);
        assert_eq!(attrs.declared_count, Some(2));
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sqref, "C6");
        assert_eq!(
            summaries[0].formula1.as_deref(),
            Some("\"Not Started / Holding,Planning,In Progress,Complete,Delayed\"")
        );
    }

    // -------------------------------------------------------------------------
    // Typed formula boundary:a regression tests for typed boundary
    // -------------------------------------------------------------------------

    /// `type="list"` with a comma-separated literal classifies as
    /// `Constant(Text)` and re-emits the original byte form through the wire
    /// boundary. The comma-list semantics is preserved inside the text
    /// payload — domain layers split on commas knowing the validation type.
    #[test]
    fn w4a_regression_list_comma_list_round_trip() {
        let xml = br#"<dataValidation type="list" sqref="A1:A10">
            <formula1>"Yes,No,Maybe"</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        match dv.formula1 {
            Some(ParsedExpr::Constant(ref v)) => {
                assert_eq!(v.as_text(), Some("Yes,No,Maybe"));
            }
            other => panic!("expected Constant(Text), got {other:?}"),
        }
        // Wire boundary round-trip: the canonical form matches the original.
        assert_eq!(
            formula_str(&dv.formula1),
            Some("\"Yes,No,Maybe\"".to_string())
        );

        // End-to-end through `parse_data_validations` (the wire boundary).
        let xml_full = br#"<worksheet><dataValidations><dataValidation type="list" sqref="A1:A10"><formula1>"Yes,No,Maybe"</formula1></dataValidation></dataValidations></worksheet>"#;
        let (summaries, _) = parse_data_validations(xml_full);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].formula1.as_deref(), Some("\"Yes,No,Maybe\""));
    }

    /// `type="whole"` with a formula-shaped threshold (e.g. `=MAX($A:$A)`)
    /// classifies as `ParsedExpr::Formula(FormulaSource)` and round-trips
    /// the original bytes verbatim through the wire boundary — the
    /// FormulaSource preserves source bytes regardless of AST cleanliness.
    #[test]
    fn w4a_regression_whole_formula_threshold_round_trip() {
        let xml = br#"<dataValidation type="whole" operator="lessThan" sqref="B1:B100">
            <formula1>=MAX($A:$A)</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        match dv.formula1 {
            Some(ParsedExpr::Formula(ref fs)) => {
                assert_eq!(fs.original, "=MAX($A:$A)");
            }
            other => panic!("expected Formula, got {other:?}"),
        }
        // Wire round-trip: bytes preserved.
        assert_eq!(formula_str(&dv.formula1), Some("=MAX($A:$A)".to_string()));
    }

    /// `type="whole"` with a numeric literal threshold classifies as
    /// `ParsedExpr::Constant(CellValue::Number)` carrying the parsed number.
    /// The wire round-trip emits the canonical numeric form (integer when
    /// the value is integral).
    #[test]
    fn w4a_regression_whole_numeric_threshold_round_trip() {
        let xml = br#"<dataValidation type="whole" operator="equal" sqref="C1">
            <formula1>5</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        match dv.formula1 {
            Some(ParsedExpr::Constant(value_types::CellValue::Number(ref n))) => {
                assert!((**n - 5.0).abs() < f64::EPSILON);
            }
            other => panic!("expected Constant(Number(5)), got {other:?}"),
        }
        assert_eq!(formula_str(&dv.formula1), Some("5".to_string()));
    }

    /// Non-ASCII sqref (e.g. a Greek-named-range sqref) must not panic.
    /// `SqrefList::parse` rejects non-A1 inputs by returning `None`; the
    /// retyped struct then stores `SqrefList::default()` (an empty list).
    /// This regression test mirrors the UTF-8 boundary Greek-OFFSET incident
    /// shape: ensures the totality contract holds at the typed boundary.
    #[test]
    fn w4a_regression_non_ascii_sqref_no_panic() {
        // Greek named-range as sqref content. Real XLSX files cannot
        // legitimately put a name reference in `sqref` (it must be a
        // whitespace-separated list of A1 ranges), but malformed authoring
        // tools occasionally do, and the parser must not panic.
        let xml = "<dataValidation type=\"whole\" sqref=\"Πλήρης_Εκτύπωση\"><formula1>0</formula1></dataValidation>".as_bytes();
        let dv = DataValidation::parse(xml).unwrap();
        // Non-A1 sqref → empty SqrefList (default), but the rule itself
        // still parses cleanly.
        assert!(dv.sqref.is_empty());

        // CJK and emoji should also not panic.
        let xml = "<dataValidation type=\"list\" sqref=\"漢字\"/>".as_bytes();
        let _ = DataValidation::parse(xml);
        let xml = "<dataValidation type=\"list\" sqref=\"💥\"/>".as_bytes();
        let _ = DataValidation::parse(xml);

        // UTF-8 byte-boundary edge case — straddles a multi-byte char in
        // the same shape as the UTF-8 boundary production incident.
        let xml = "<dataValidation type=\"list\" sqref=\"μμμμμμ\"/>".as_bytes();
        let _ = DataValidation::parse(xml);
    }

    /// `sqref="A1:B2 C3:D4"` — two ranges, each parsed into the
    /// `SqrefList`. Wire round-trip emits the canonical
    /// space-separated form.
    #[test]
    fn w4a_regression_multi_range_sqref() {
        let xml = br#"<dataValidation type="whole" sqref="A1:B2 C3:D4">
            <formula1>0</formula1>
        </dataValidation>"#;

        let dv = DataValidation::parse(xml).unwrap();
        assert_eq!(dv.sqref.len(), 2);
        // Each range survives the parse → re-emit cycle structurally.
        assert_eq!(sqref_str(&dv), "A1:B2 C3:D4");

        // End-to-end through the wire boundary.
        let xml_full = br#"<worksheet><dataValidations><dataValidation type="whole" sqref="A1:B2 C3:D4"><formula1>0</formula1></dataValidation></dataValidations></worksheet>"#;
        let (summaries, _) = parse_data_validations(xml_full);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].sqref, "A1:B2 C3:D4");
    }

    #[test]
    fn formula1_preserves_authored_single_cell_range() {
        let xml_full = br#"<worksheet><dataValidations><dataValidation type="list" sqref="K132"><formula1>$F$292:$F$292</formula1></dataValidation></dataValidations></worksheet>"#;
        let (summaries, _) = parse_data_validations(xml_full);

        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].formula1.as_deref(), Some("$F$292:$F$292"));
    }

    /// Greek-named-range *content* in formula1 — exercises the
    /// `ParsedExpr::Formula` byte-preservation path on non-ASCII input,
    /// the UTF-8 boundary production-incident class.
    #[test]
    fn w4a_regression_non_ascii_formula1_round_trip() {
        let xml = "<dataValidation type=\"custom\" sqref=\"A1\"><formula1>=OFFSET(Πλήρης_Εκτύπωση,0,0,'Input -1'!Τελευταία_γραμμή)</formula1></dataValidation>".as_bytes();
        let dv = DataValidation::parse(xml).unwrap();
        match dv.formula1 {
            Some(ParsedExpr::Formula(ref fs)) => {
                assert_eq!(
                    fs.original,
                    "=OFFSET(Πλήρης_Εκτύπωση,0,0,'Input -1'!Τελευταία_γραμμή)"
                );
            }
            other => panic!("expected Formula with non-ASCII original, got {other:?}"),
        }
    }
}
