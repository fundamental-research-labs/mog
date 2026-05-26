//! Unified validation domain types.
//!
//! This module is the single source of truth for all validation-related types
//! across the system. Types are organized in sections:
//!
//! - Section 1: XLSX validation spec types (ValidationSpec, ValidationRule)
//! - Section 2: Schema type system (SchemaType, EnforcementLevel)
//! - Section 3: Validation result types (ValidationErrorCode, ValidationResult, etc.)
//! - Section 4: Constraint, schema, and range types

use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// Section 1: XLSX validation spec types (kept as-is from original domain-types)
// ============================================================================

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

// ============================================================================
// Section 2: Schema type system (from compute-schema)
// ============================================================================

/// Semantic types for cell values.
/// 18 variants covering primitives, semantic subtypes, entities, and special types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SchemaType {
    // Primitives
    String,
    Number,
    Boolean,
    Date,
    Null,
    // Semantic (subtypes of string/number)
    Currency,
    Percentage,
    Integer,
    Email,
    Url,
    Phone,
    Time,
    // Entity (subtypes of string)
    Company,
    Person,
    Stock,
    Location,
    // Special
    Distribution,
    Any,
}

impl SchemaType {
    /// Returns the default Excel format code for this schema type.
    /// This connects the schema system to the format engine.
    pub fn default_format_code(&self) -> Option<&'static str> {
        match self {
            SchemaType::Currency => Some("$#,##0.00"),
            SchemaType::Percentage => Some("0%"),
            SchemaType::Date => Some("m/d/yyyy"),
            SchemaType::Time => Some("h:mm AM/PM"),
            SchemaType::Integer => Some("#,##0"),
            SchemaType::Number => Some("General"),
            _ => None,
        }
    }

    /// Maps semantic types to their primitive base type.
    pub fn base_type(&self) -> SchemaType {
        match self {
            SchemaType::Integer
            | SchemaType::Currency
            | SchemaType::Percentage
            | SchemaType::Distribution
            | SchemaType::Time => SchemaType::Number,
            SchemaType::Email
            | SchemaType::Url
            | SchemaType::Phone
            | SchemaType::Company
            | SchemaType::Person
            | SchemaType::Stock
            | SchemaType::Location => SchemaType::String,
            other => *other,
        }
    }
}

/// Enforcement level for validation (maps to Excel errorStyle).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EnforcementLevel {
    None,
    Info,
    Warning,
    Strict,
}

impl From<ErrorStyle> for EnforcementLevel {
    fn from(style: ErrorStyle) -> Self {
        match style {
            ErrorStyle::Stop => EnforcementLevel::Strict,
            ErrorStyle::Warning => EnforcementLevel::Warning,
            ErrorStyle::Information => EnforcementLevel::Info,
        }
    }
}

impl From<EnforcementLevel> for ErrorStyle {
    fn from(level: EnforcementLevel) -> Self {
        match level {
            EnforcementLevel::Strict => ErrorStyle::Stop,
            EnforcementLevel::Warning => ErrorStyle::Warning,
            EnforcementLevel::Info => ErrorStyle::Information,
            EnforcementLevel::None => ErrorStyle::Information,
        }
    }
}

// ============================================================================
// Section 3: Validation result types (from compute-schema)
// ============================================================================

/// Error codes for validation failures.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ValidationErrorCode {
    TypeMismatch,
    InvalidFormat,
    Required,
    MinValue,
    MaxValue,
    MinLength,
    MaxLength,
    Pattern,
    Enum,
    Unique,
    Formula,
    InvalidEmail,
    InvalidUrl,
    InvalidPhone,
    InvalidCurrency,
    InvalidPercentage,
    InvalidInteger,
    InvalidDate,
}

/// Validation severity level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ValidationSeverity {
    Error,
    Warning,
    Info,
}

/// A single validation error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
    pub code: ValidationErrorCode,
    pub message: String,
    pub severity: ValidationSeverity,
}

/// Result of validating a value against a schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coerced_value: Option<CellValueResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred_type: Option<SchemaType>,
}

impl ValidationResult {
    pub fn valid() -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            coerced_value: None,
            inferred_type: None,
        }
    }

    pub fn valid_with_type(inferred_type: SchemaType) -> Self {
        Self {
            valid: true,
            errors: Vec::new(),
            coerced_value: None,
            inferred_type: Some(inferred_type),
        }
    }

    pub fn invalid(errors: Vec<ValidationError>) -> Self {
        Self {
            valid: false,
            errors,
            coerced_value: None,
            inferred_type: None,
        }
    }
}

/// Represents a coerced cell value result.
/// Uses simple types rather than CellValue to avoid coupling to the evaluator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum CellValueResult {
    Number(f64),
    Text(String),
    Boolean(bool),
    Null,
}

/// Result of attempting to coerce a value to a target type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoercionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<CellValueResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CoercionResult {
    pub fn ok(value: CellValueResult) -> Self {
        Self {
            success: true,
            value: Some(value),
            error: None,
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            success: false,
            value: None,
            error: Some(message.into()),
        }
    }
}

// ============================================================================
// Section 4: Constraint, schema, and range types (unified superset)
// ============================================================================

/// Distribution type for Monte Carlo simulations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DistributionType {
    Normal,
    Uniform,
    Triangular,
    Lognormal,
    Beta,
    Exponential,
}

/// Configuration for a distribution.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributionConfig {
    #[serde(rename = "type")]
    pub distribution_type: DistributionType,
    pub params: HashMap<String, f64>,
}

/// Unified schema constraints for data validation.
///
/// This is the superset of constraints from both compute-schema (typed) and
/// domain-types storage (stringly-typed). Uses the strongly-typed versions
/// (f64 for equal/not_equal, usize for lengths, Vec<String> for enum_values)
/// plus the enum_source/enum_source_formula fields from domain-types storage.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaConstraints {
    // Presence
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_blank: Option<bool>,

    // Numeric (inclusive)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,

    // Numeric (exclusive)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclusive_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclusive_max: Option<f64>,

    // Exact value matching
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equal: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_equal: Option<f64>,

    // Not between range
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_between_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_between_max: Option<f64>,

    // String length
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,

    // Pattern
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,

    // Enum (static values)
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<String>>,

    // Enum (dynamic sources, from domain-types storage)
    /// Range reference for dynamic list values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_source: Option<IdentityRangeSchemaRef>,
    /// Formula that produces list values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enum_source_formula: Option<String>,

    // Uniqueness
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unique: Option<bool>,

    // Custom formula
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
}

/// CellId-based range reference for data validation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRangeSchemaRef {
    /// Start cell identifier (e.g., "row:col" or CellId hex).
    pub start_id: String,
    /// End cell identifier.
    pub end_id: String,
    /// Sheet the range belongs to (if cross-sheet).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<String>,
}

/// A column schema definition (properly typed).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSchema {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub schema_type: SchemaType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<SchemaConstraints>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distribution: Option<DistributionConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Result of inferring a column's schema from sample data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferredSchema {
    pub schema: ColumnSchema,
    pub confidence: f64,
    pub sample_size: usize,
    pub types_found: HashMap<SchemaType, usize>,
}

/// Range schema (data validation rule applied to a range).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeSchema {
    /// Unique identifier for this range schema.
    pub id: String,
    /// Creation timestamp (milliseconds since epoch).
    pub created_at: i64,
    /// Cell ranges this validation applies to.
    pub ranges: Vec<IdentityRangeSchemaRef>,
    /// The type + constraints definition.
    pub schema: RangeSchemaDefinition,
    /// Enforcement level (typed, not stringly-typed).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enforcement: Option<EnforcementLevel>,
    /// UI messages for error / input display.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui: Option<RangeSchemaUi>,
}

/// The type + constraints definition within a range schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeSchemaDefinition {
    /// Schema type (typed, not stringly-typed).
    #[serde(rename = "type")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_type: Option<SchemaType>,
    /// Validation constraints.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub constraints: Option<SchemaConstraints>,
}

/// UI configuration for range schema error/input messages.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeSchemaUi {
    /// Whether to show a dropdown for list validation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_dropdown: Option<bool>,
    /// Error message shown when validation fails.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<ErrorMessage>,
    /// Input message shown when a validated cell is selected.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_message: Option<InputMessage>,
}

/// Error message shown when validation fails.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorMessage {
    /// Error dialog title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Error dialog body text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Input message shown when a cell with validation is selected.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputMessage {
    /// Input message title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Input message body text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Result of validating a cell value against a schema.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellValidationResult {
    /// Whether the value passed validation.
    pub valid: bool,
    /// Error message if validation failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    /// Error title if validation failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_title: Option<String>,
    /// Enforcement level applied (typed, not stringly-typed).
    pub enforcement: EnforcementLevel,
}

// ============================================================================
// Section 5: ValidationSpec → RangeSchema conversion
// ============================================================================

impl ValidationSpec {
    /// Convert an XLSX `ValidationSpec` to the canonical `RangeSchema` format.
    ///
    /// `id` is the unique identifier for the generated range schema (caller provides).
    /// Returns `None` if no ranges can be parsed.
    pub fn to_range_schema(&self, id: String) -> Option<RangeSchema> {
        let ranges: Vec<IdentityRangeSchemaRef> = self
            .ranges
            .iter()
            .filter_map(|r| a1_range_to_identity_ref(r))
            .collect();
        if ranges.is_empty() {
            return None;
        }

        let (schema_type, mut constraints) = validation_rule_to_schema_parts(&self.rule);

        // Propagate allow_blank into constraints.
        match constraints {
            Some(ref mut c) => c.allow_blank = Some(self.allow_blank),
            None => {
                constraints = Some(SchemaConstraints {
                    allow_blank: Some(self.allow_blank),
                    ..Default::default()
                });
            }
        }

        let enforcement = Some(EnforcementLevel::from(self.error_style));

        let error_message =
            if self.show_error && (self.error_title.is_some() || self.error_message.is_some()) {
                Some(ErrorMessage {
                    title: self.error_title.clone(),
                    message: self.error_message.clone(),
                })
            } else {
                None
            };

        let input_message =
            if self.show_prompt && (self.prompt_title.is_some() || self.prompt_message.is_some()) {
                Some(InputMessage {
                    title: self.prompt_title.clone(),
                    message: self.prompt_message.clone(),
                })
            } else {
                None
            };

        let show_dropdown = match &self.rule {
            ValidationRule::List { show_dropdown, .. } => Some(*show_dropdown),
            _ => None,
        };

        let ui = if error_message.is_some() || input_message.is_some() || show_dropdown.is_some() {
            Some(RangeSchemaUi {
                show_dropdown,
                error_message,
                input_message,
            })
        } else {
            None
        };

        Some(RangeSchema {
            id,
            created_at: 0,
            ranges,
            schema: RangeSchemaDefinition {
                schema_type,
                constraints,
            },
            enforcement,
            ui,
        })
    }
}

impl RangeSchema {
    /// Convert a `RangeSchema` back to an XLSX `ValidationSpec`.
    ///
    /// This is the inverse of [`ValidationSpec::to_range_schema`]. It is used
    /// by the runtime schemas API (which still speaks `RangeSchema`) to upsert
    /// into the single canonical `properties/dataValidations` store.
    ///
    /// Returns `None` if the schema has no convertible rule or no valid ranges.
    pub fn to_validation_spec(&self) -> Option<ValidationSpec> {
        let a1_ranges: Vec<String> = self
            .ranges
            .iter()
            .filter_map(identity_range_to_a1)
            .collect();
        if a1_ranges.is_empty() {
            return None;
        }

        let rule =
            build_validation_rule(self.schema.schema_type, self.schema.constraints.as_ref())?;

        let error_style: ErrorStyle = self.enforcement.unwrap_or(EnforcementLevel::Strict).into();

        let allow_blank = self
            .schema
            .constraints
            .as_ref()
            .and_then(|c| c.allow_blank)
            .unwrap_or(true);

        let (show_error, error_title, error_message) =
            match self.ui.as_ref().and_then(|u| u.error_message.as_ref()) {
                Some(em) => (true, em.title.clone(), em.message.clone()),
                None => (true, None, None),
            };
        let (show_prompt, prompt_title, prompt_message) =
            match self.ui.as_ref().and_then(|u| u.input_message.as_ref()) {
                Some(im) => (true, im.title.clone(), im.message.clone()),
                None => (false, None, None),
            };

        // Preserve the RangeSchema id as the ValidationSpec uid so the
        // runtime view layer can continue to find it by id on subsequent
        // reads. Empty ids leave uid absent so the XLSX writer won't emit
        // a blank `xr:uid` attribute.
        let uid = if self.id.is_empty() {
            None
        } else {
            Some(self.id.clone())
        };

        Some(ValidationSpec {
            ranges: a1_ranges,
            rule,
            error_style,
            show_error,
            error_title,
            error_message,
            show_prompt,
            prompt_title,
            prompt_message,
            allow_blank,
            ime_mode: ImeMode::NoControl,
            uid,
        })
    }
}

/// Convert "row:col" positional string to (row, col) tuple.
fn parse_row_col_pos(id: &str) -> Option<(u32, u32)> {
    let (r_str, c_str) = id.split_once(':')?;
    Some((r_str.parse::<u32>().ok()?, c_str.parse::<u32>().ok()?))
}

/// Convert an [`IdentityRangeSchemaRef`] (with `row:col` positional ids) to an
/// A1-style range string (e.g. `"A1:B10"` or `"A1"` for a single cell).
fn identity_range_to_a1(rr: &IdentityRangeSchemaRef) -> Option<String> {
    let (sr, sc) = parse_row_col_pos(&rr.start_id)?;
    let (er, ec) = parse_row_col_pos(&rr.end_id)?;
    let start = pos_to_a1(sr, sc);
    let end = pos_to_a1(er, ec);
    if start == end {
        Some(start)
    } else {
        Some(format!("{start}:{end}"))
    }
}

/// Convert 0-based (row, col) to an A1-style cell reference (e.g. `"A1"`).
fn pos_to_a1(row: u32, col: u32) -> String {
    let mut c = col + 1;
    let mut letters = Vec::new();
    while c > 0 {
        let rem = ((c - 1) % 26) as u8;
        letters.push((b'A' + rem) as char);
        c = (c - 1) / 26;
    }
    let col_str: String = letters.into_iter().rev().collect();
    format!("{}{}", col_str, row + 1)
}

/// Build a [`ValidationRule`] from a schema type + constraints.
fn build_validation_rule(
    schema_type: Option<SchemaType>,
    constraints: Option<&SchemaConstraints>,
) -> Option<ValidationRule> {
    let c = constraints;

    if let Some(vals) = c.and_then(|c| c.enum_values.as_ref()) {
        let formula1 = format!("\"{}\"", vals.join(","));
        return Some(ValidationRule::List {
            formula1,
            show_dropdown: true,
        });
    }

    if let Some(formula) = c.and_then(|c| c.enum_source_formula.as_ref()) {
        return Some(ValidationRule::List {
            formula1: formula.clone(),
            show_dropdown: true,
        });
    }

    // Range-based list source — TS sends this for listSource = "=B1:B3".
    // Store the range as an A1-style formula1 so the round-trip reconstructs
    // `enum_source` in `validation_rule_to_schema_parts` below.
    if let Some(src) = c.and_then(|c| c.enum_source.as_ref())
        && let Some(a1) = identity_range_to_a1(src)
    {
        return Some(ValidationRule::List {
            formula1: a1,
            show_dropdown: true,
        });
    }

    if let Some(formula) = c.and_then(|c| c.formula.as_ref()) {
        return Some(ValidationRule::Custom {
            formula1: formula.clone(),
        });
    }

    // Text-length constraints without an explicit schema_type — TS sends
    // `{type: undefined, constraints: {minLength/maxLength}}` for textLength rules.
    if c.is_some_and(|c| c.min_length.is_some() || c.max_length.is_some()) {
        let (operator, f1, f2) = text_length_operator_and_formulas(c);
        if !f1.is_empty() {
            return Some(ValidationRule::TextLength {
                operator,
                formula1: f1,
                formula2: f2,
            });
        }
    }

    let st = schema_type?;

    match st {
        SchemaType::Integer => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::WholeNumber {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::Number | SchemaType::Currency | SchemaType::Percentage => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::Decimal {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::Date => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::Date {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::Time => {
            let (operator, f1, f2) = numeric_operator_and_formulas(c);
            Some(ValidationRule::Time {
                operator,
                formula1: f1,
                formula2: f2,
            })
        }
        SchemaType::String | SchemaType::Email | SchemaType::Url | SchemaType::Phone => {
            let (operator, f1, f2) = text_length_operator_and_formulas(c);
            if f1.is_empty() {
                None
            } else {
                Some(ValidationRule::TextLength {
                    operator,
                    formula1: f1,
                    formula2: f2,
                })
            }
        }
        _ => None,
    }
}

fn numeric_operator_and_formulas(
    constraints: Option<&SchemaConstraints>,
) -> (ValidationOperator, String, Option<String>) {
    let c = match constraints {
        Some(c) => c,
        None => return (ValidationOperator::Between, String::new(), None),
    };

    if let Some(v) = c.equal {
        return (ValidationOperator::Equal, v.to_string(), None);
    }
    if let Some(v) = c.not_equal {
        return (ValidationOperator::NotEqual, v.to_string(), None);
    }
    if let (Some(lo), Some(hi)) = (c.not_between_min, c.not_between_max) {
        return (
            ValidationOperator::NotBetween,
            lo.to_string(),
            Some(hi.to_string()),
        );
    }
    if let (Some(lo), Some(hi)) = (c.min, c.max) {
        return (
            ValidationOperator::Between,
            lo.to_string(),
            Some(hi.to_string()),
        );
    }
    if let Some(v) = c.exclusive_min {
        return (ValidationOperator::GreaterThan, v.to_string(), None);
    }
    if let Some(v) = c.min {
        return (ValidationOperator::GreaterThanOrEqual, v.to_string(), None);
    }
    if let Some(v) = c.exclusive_max {
        return (ValidationOperator::LessThan, v.to_string(), None);
    }
    if let Some(v) = c.max {
        return (ValidationOperator::LessThanOrEqual, v.to_string(), None);
    }

    (ValidationOperator::Between, String::new(), None)
}

fn text_length_operator_and_formulas(
    constraints: Option<&SchemaConstraints>,
) -> (ValidationOperator, String, Option<String>) {
    let c = match constraints {
        Some(c) => c,
        None => return (ValidationOperator::Between, String::new(), None),
    };

    if let (Some(lo), Some(hi)) = (c.min_length, c.max_length) {
        return (
            ValidationOperator::Between,
            lo.to_string(),
            Some(hi.to_string()),
        );
    }
    if let Some(v) = c.min_length {
        return (ValidationOperator::GreaterThanOrEqual, v.to_string(), None);
    }
    if let Some(v) = c.max_length {
        return (ValidationOperator::LessThanOrEqual, v.to_string(), None);
    }

    (ValidationOperator::Between, String::new(), None)
}

/// Parse an A1-style cell reference (e.g. "A1", "$B$10") into 0-based (row, col).
fn parse_a1_cell(s: &str) -> Option<(u32, u32)> {
    let s = s.trim_start_matches('$');
    let mut col: u32 = 0;
    let mut i = 0;
    let bytes = s.as_bytes();

    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        col = col * 26 + (bytes[i].to_ascii_uppercase() - b'A') as u32 + 1;
        i += 1;
    }
    if i == 0 || i == bytes.len() {
        return None;
    }
    col -= 1; // 0-based

    let row_str: String = s[i..].chars().filter(|c| *c != '$').collect();
    let row: u32 = row_str.parse().ok()?;
    if row == 0 {
        return None;
    }
    Some((row - 1, col))
}

/// Parse an A1 range string ("A1" or "A1:B10") into an `IdentityRangeSchemaRef`
/// using "row:col" positional format for start_id/end_id.
fn a1_range_to_identity_ref(range: &str) -> Option<IdentityRangeSchemaRef> {
    let parts: Vec<&str> = range.split(':').collect();
    let (sr, sc, er, ec) = if parts.len() == 2 {
        let (sr, sc) = parse_a1_cell(parts[0])?;
        let (er, ec) = parse_a1_cell(parts[1])?;
        (sr, sc, er, ec)
    } else {
        let (r, c) = parse_a1_cell(parts[0])?;
        (r, c, r, c)
    };
    Some(IdentityRangeSchemaRef {
        start_id: format!("{sr}:{sc}"),
        end_id: format!("{er}:{ec}"),
        sheet_id: None,
    })
}

/// Convert a `ValidationRule` to its `(SchemaType, SchemaConstraints)` representation.
fn validation_rule_to_schema_parts(
    rule: &ValidationRule,
) -> (Option<SchemaType>, Option<SchemaConstraints>) {
    match rule {
        ValidationRule::WholeNumber {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Integer), Some(c))
        }
        ValidationRule::Decimal {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Number), Some(c))
        }
        ValidationRule::Date {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Date), Some(c))
        }
        ValidationRule::Time {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_numeric_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::Time), Some(c))
        }
        ValidationRule::TextLength {
            operator,
            formula1,
            formula2,
        } => {
            let c =
                operator_formulas_to_length_constraints(operator, formula1, formula2.as_deref());
            (Some(SchemaType::String), Some(c))
        }
        ValidationRule::List {
            formula1,
            show_dropdown: _,
        } => {
            let mut c = SchemaConstraints::default();
            if formula1.starts_with('"') && formula1.ends_with('"') {
                let inner = &formula1[1..formula1.len() - 1];
                c.enum_values = Some(inner.split(',').map(|s| s.to_string()).collect());
            } else if !formula1.starts_with('=')
                && let Some(src) = a1_range_to_identity_ref(formula1)
            {
                // Simple range reference (e.g. "B1:B3"): expose as enum_source so
                // the SDK's getDropdownItems can query live cell values.
                c.enum_source = Some(src);
            } else {
                c.enum_source_formula = Some(formula1.clone());
            }
            (None, Some(c))
        }
        ValidationRule::Custom { formula1 } => {
            let c = SchemaConstraints {
                formula: Some(formula1.clone()),
                ..Default::default()
            };
            (None, Some(c))
        }
        ValidationRule::None { .. } => (None, None),
    }
}

/// Convert operator + formula values to numeric `SchemaConstraints`.
fn operator_formulas_to_numeric_constraints(
    operator: &ValidationOperator,
    formula1: &str,
    formula2: Option<&str>,
) -> SchemaConstraints {
    let mut c = SchemaConstraints::default();
    let f1: Option<f64> = formula1.parse().ok();
    let f2: Option<f64> = formula2.and_then(|s| s.parse().ok());

    match operator {
        ValidationOperator::Between => {
            c.min = f1;
            c.max = f2;
        }
        ValidationOperator::NotBetween => {
            c.not_between_min = f1;
            c.not_between_max = f2;
        }
        ValidationOperator::Equal => {
            c.equal = f1;
        }
        ValidationOperator::NotEqual => {
            c.not_equal = f1;
        }
        ValidationOperator::GreaterThan => {
            c.exclusive_min = f1;
        }
        ValidationOperator::GreaterThanOrEqual => {
            c.min = f1;
        }
        ValidationOperator::LessThan => {
            c.exclusive_max = f1;
        }
        ValidationOperator::LessThanOrEqual => {
            c.max = f1;
        }
    }
    c
}

/// Convert operator + formula values to text-length `SchemaConstraints`.
fn operator_formulas_to_length_constraints(
    operator: &ValidationOperator,
    formula1: &str,
    formula2: Option<&str>,
) -> SchemaConstraints {
    let mut c = SchemaConstraints::default();
    let f1: Option<usize> = formula1.parse().ok();
    let f2: Option<usize> = formula2.and_then(|s| s.parse().ok());

    match operator {
        ValidationOperator::Between => {
            c.min_length = f1;
            c.max_length = f2;
        }
        ValidationOperator::GreaterThanOrEqual => {
            c.min_length = f1;
        }
        ValidationOperator::LessThanOrEqual => {
            c.max_length = f1;
        }
        _ => {
            c.min_length = f1;
        }
    }
    c
}
