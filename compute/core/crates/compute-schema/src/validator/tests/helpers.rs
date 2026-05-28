use std::sync::Arc;

use value_types::{
    CellArray, CellControl, CellError, CellImage, CellImageSizing, CellValue, FiniteF64,
};

use crate::types::{ColumnSchema, SchemaConstraints, SchemaType};

pub(super) fn num(v: f64) -> CellValue {
    CellValue::Number(FiniteF64::new(v).unwrap())
}

pub(super) fn text(s: &str) -> CellValue {
    CellValue::Text(s.into())
}

pub(super) fn error_value() -> CellValue {
    CellValue::Error(CellError::Value, None)
}

pub(super) fn array_value() -> CellValue {
    CellValue::Array(Arc::new(CellArray::single_row(vec![num(1.0)])))
}

pub(super) fn control_value() -> CellValue {
    CellValue::Control(CellControl::checkbox(true))
}

pub(super) fn image_value() -> CellValue {
    CellValue::Image(CellImage::new(
        "https://example.com/image.png",
        Some(Arc::<str>::from("Example image")),
        CellImageSizing::Fit,
        None,
        None,
    ))
}

pub(super) fn make_schema(schema_type: SchemaType) -> ColumnSchema {
    ColumnSchema {
        id: "test".into(),
        name: "Test".into(),
        schema_type,
        constraints: None,
        distribution: None,
        description: None,
    }
}

pub(super) fn make_schema_with_constraints(
    schema_type: SchemaType,
    constraints: SchemaConstraints,
) -> ColumnSchema {
    ColumnSchema {
        id: "test".into(),
        name: "Test".into(),
        schema_type,
        constraints: Some(constraints),
        distribution: None,
        description: None,
    }
}
