use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};

/// OOXML error style (maps to Excel's errorStyle attribute).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ErrorStyle {
    #[default]
    Stop,
    Warning,
    Information,
}

impl ErrorStyle {
    /// Convert to OOXML string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorStyle::Stop => "stop",
            ErrorStyle::Warning => "warning",
            ErrorStyle::Information => "information",
        }
    }

    /// Parse from OOXML string representation.
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "stop" => ErrorStyle::Stop,
            "warning" => ErrorStyle::Warning,
            "information" => ErrorStyle::Information,
            _ => ErrorStyle::Stop,
        }
    }
}

/// OOXML data validation IME mode (ST_DataValidationImeMode).
///
/// Controls the Input Method Editor state when a cell carrying this
/// validation is selected. Primarily used for Asian locales. Default is
/// `NoControl` per ECMA-376 — IME state is not overridden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ImeMode {
    /// No control over IME (default; OOXML token `noControl`).
    #[default]
    NoControl,
    /// IME off (`off`).
    Off,
    /// IME on (`on`).
    On,
    /// IME disabled (`disabled`).
    Disabled,
    /// Hiragana mode (`hiragana`).
    Hiragana,
    /// Full-width Katakana mode (`fullKatakana`).
    FullKatakana,
    /// Half-width Katakana mode (`halfKatakana`).
    HalfKatakana,
    /// Full-width alphanumeric mode (`fullAlpha`).
    FullAlpha,
    /// Half-width alphanumeric mode (`halfAlpha`).
    HalfAlpha,
    /// Full-width Hangul mode (`fullHangul`).
    FullHangul,
    /// Half-width Hangul mode (`halfHangul`).
    HalfHangul,
}

impl ImeMode {
    /// Convert to OOXML string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            ImeMode::NoControl => "noControl",
            ImeMode::Off => "off",
            ImeMode::On => "on",
            ImeMode::Disabled => "disabled",
            ImeMode::Hiragana => "hiragana",
            ImeMode::FullKatakana => "fullKatakana",
            ImeMode::HalfKatakana => "halfKatakana",
            ImeMode::FullAlpha => "fullAlpha",
            ImeMode::HalfAlpha => "halfAlpha",
            ImeMode::FullHangul => "fullHangul",
            ImeMode::HalfHangul => "halfHangul",
        }
    }

    /// Parse from OOXML string representation. Unknown values map to
    /// `NoControl` (the schema default).
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "noControl" => ImeMode::NoControl,
            "off" => ImeMode::Off,
            "on" => ImeMode::On,
            "disabled" => ImeMode::Disabled,
            "hiragana" => ImeMode::Hiragana,
            "fullKatakana" => ImeMode::FullKatakana,
            "halfKatakana" => ImeMode::HalfKatakana,
            "fullAlpha" => ImeMode::FullAlpha,
            "halfAlpha" => ImeMode::HalfAlpha,
            "fullHangul" => ImeMode::FullHangul,
            "halfHangul" => ImeMode::HalfHangul,
            _ => ImeMode::NoControl,
        }
    }
}

/// OOXML data validation operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub enum ValidationOperator {
    #[default]
    Between,
    NotBetween,
    Equal,
    NotEqual,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
}

impl ValidationOperator {
    /// Convert to OOXML string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            ValidationOperator::Between => "between",
            ValidationOperator::NotBetween => "notBetween",
            ValidationOperator::Equal => "equal",
            ValidationOperator::NotEqual => "notEqual",
            ValidationOperator::GreaterThan => "greaterThan",
            ValidationOperator::LessThan => "lessThan",
            ValidationOperator::GreaterThanOrEqual => "greaterThanOrEqual",
            ValidationOperator::LessThanOrEqual => "lessThanOrEqual",
        }
    }

    /// Parse from OOXML string representation.
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "between" => ValidationOperator::Between,
            "notBetween" => ValidationOperator::NotBetween,
            "equal" => ValidationOperator::Equal,
            "notEqual" => ValidationOperator::NotEqual,
            "greaterThan" => ValidationOperator::GreaterThan,
            "lessThan" => ValidationOperator::LessThan,
            "greaterThanOrEqual" => ValidationOperator::GreaterThanOrEqual,
            "lessThanOrEqual" => ValidationOperator::LessThanOrEqual,
            _ => ValidationOperator::Between,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSpec {
    pub ranges: Vec<String>,
    pub rule: ValidationRule,
    pub error_style: ErrorStyle,
    pub show_error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub show_prompt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_message: Option<String>,
    pub allow_blank: bool,
    /// IME mode for Asian locales (OOXML `imeMode` attribute).
    /// Default `NoControl` means the attribute is omitted on write.
    #[serde(default, skip_serializing_if = "crate::is_default_ime_mode")]
    pub ime_mode: ImeMode,
    /// Extension UID for revision tracking (xr:uid), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
}

impl Default for ValidationSpec {
    fn default() -> Self {
        Self {
            ranges: Vec::new(),
            rule: ValidationRule::Custom {
                formula1: String::new(),
            },
            error_style: ErrorStyle::Stop,
            show_error: true,
            error_title: None,
            error_message: None,
            show_prompt: false,
            prompt_title: None,
            prompt_message: None,
            allow_blank: true,
            ime_mode: ImeMode::NoControl,
            uid: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum ValidationRule {
    /// No validation type (type omitted or "none" in OOXML).
    /// Contains formula1 for round-trip fidelity.
    None {
        formula1: String,
    },
    WholeNumber {
        operator: ValidationOperator,
        formula1: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        formula2: Option<String>,
    },
    Decimal {
        operator: ValidationOperator,
        formula1: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        formula2: Option<String>,
    },
    List {
        formula1: String,
        show_dropdown: bool,
    },
    Date {
        operator: ValidationOperator,
        formula1: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        formula2: Option<String>,
    },
    Time {
        operator: ValidationOperator,
        formula1: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        formula2: Option<String>,
    },
    TextLength {
        operator: ValidationOperator,
        formula1: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        formula2: Option<String>,
    },
    Custom {
        formula1: String,
    },
}
