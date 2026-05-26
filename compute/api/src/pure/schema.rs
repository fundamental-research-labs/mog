//! Schema validation and type inference — stateless, no engine instance needed.

// Re-export the types consumers need
pub use compute_core::CellValue;
pub use compute_core::schema::editor::EditorTypeResolutionInput;
pub use compute_core::schema::{
    ColumnSchema, EditorTypeResolutionResult, InferredSchema, SchemaType, ValidationResult,
};

use compute_core::bridge_pure::SchemaBridge;

/// Validate a cell value against a column schema.
pub fn validate(value: CellValue, schema: ColumnSchema) -> ValidationResult {
    SchemaBridge::schema_validate(value, schema)
}

/// Resolve the editor type for a given input.
pub fn resolve_editor(input: EditorTypeResolutionInput) -> EditorTypeResolutionResult {
    SchemaBridge::schema_resolve_editor(input)
}

/// Infer a schema type from a single cell value.
pub fn infer_type(value: CellValue) -> SchemaType {
    SchemaBridge::schema_infer_type(value)
}

/// Infer a column schema from multiple values.
pub fn infer_column(values: Vec<CellValue>) -> InferredSchema {
    SchemaBridge::schema_infer_column(values)
}
