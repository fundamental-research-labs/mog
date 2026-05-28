use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::spec::ErrorStyle;

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
