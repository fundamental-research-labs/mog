//! Schema Engine - Type validation and inference for spreadsheet cells.
//!
//! # Unified Schema-Format Model
//!
//! The schema system provides a single source of truth for cell semantics:
//!
//! - **Validation**: `validator::validate()` checks values against column schemas
//! - **Inference**: `inference::infer_type()` detects types from raw values
//! - **Coercion**: `coercion::coerce()` converts between types
//! - **Formatting**: `SchemaType::default_format_code()` maps types to Excel format codes
//! - **Reverse mapping**: `format_bridge::infer_schema_from_format()` maps format codes back to types
//! - **Editor**: `editor::resolve_editor_type()` determines cell editor from schema
//!
//! A `SchemaType::Currency` implies: validation accepts numbers, coercion handles "$1,234",
//! default format is `$#,##0.00`, and the editor shows text input with currency validation.

pub mod error;

pub mod coercion;
pub mod constraints;
pub mod editor;
pub mod format_bridge;
pub mod inference;
pub mod patterns;
pub mod schema_map;
pub mod types;
pub mod validator;

// Re-export key types
pub use types::*;
