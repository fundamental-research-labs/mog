//! Read-side data validation model types.

use compute_parser::parsed_expr::{ParsedExpr, SqrefList};

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

#[derive(Debug, Clone, Default)]
pub struct DataValidationsContainerAttrs {
    pub disable_prompts: bool,
    pub x_window: Option<u32>,
    pub y_window: Option<u32>,
    pub declared_count: Option<u32>,
}
