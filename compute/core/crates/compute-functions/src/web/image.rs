//! In-cell image formula support.

use std::sync::Arc;

use value_types::{CellError, CellImage, CellImageSizing, CellValue};

use crate::{FunctionRegistry, PureFunction};

pub(crate) struct FnImage;

impl PureFunction for FnImage {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }

    fn name(&self) -> &'static str {
        "IMAGE"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(5)
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        for arg in args {
            if let CellValue::Error(e, _) = arg {
                return CellValue::Error(*e, None);
            }
        }

        let source = match args[0].coerce_to_string() {
            Ok(s) => s.into_owned(),
            Err(e) => return CellValue::Error(e, None),
        };
        if !is_supported_image_source(&source) {
            return CellValue::error_with_message(CellError::Value, "IMAGE: unsupported image URL");
        }

        let alt_text = if let Some(arg) = args.get(1) {
            match arg.coerce_to_string() {
                Ok(s) if s.is_empty() => None,
                Ok(s) => Some(Arc::<str>::from(s.into_owned())),
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            None
        };

        let sizing = match args.get(2) {
            Some(arg) => match coerce_sizing(arg) {
                Ok(s) => s,
                Err(e) => return CellValue::Error(e, None),
            },
            None => CellImageSizing::Fit,
        };

        let height = match args.get(3) {
            Some(arg) => match coerce_dimension(arg) {
                Ok(dim) => Some(dim),
                Err(e) => return CellValue::Error(e, None),
            },
            None => None,
        };
        let width = match args.get(4) {
            Some(arg) => match coerce_dimension(arg) {
                Ok(dim) => Some(dim),
                Err(e) => return CellValue::Error(e, None),
            },
            None => None,
        };

        if matches!(sizing, CellImageSizing::Custom) {
            if height.is_none() || width.is_none() {
                return CellValue::error_with_message(
                    CellError::Value,
                    "IMAGE: custom sizing requires height and width",
                );
            }
        } else if height.is_some() || width.is_some() {
            return CellValue::error_with_message(
                CellError::Value,
                "IMAGE: height and width require custom sizing",
            );
        }

        CellValue::Image(CellImage::new(source, alt_text, sizing, height, width))
    }
}

fn coerce_sizing(value: &CellValue) -> Result<CellImageSizing, CellError> {
    let n = value.coerce_to_number()?;
    if n.fract() != 0.0 {
        return Err(CellError::Value);
    }
    match n as i32 {
        0 => Ok(CellImageSizing::Fit),
        1 => Ok(CellImageSizing::Fill),
        2 => Ok(CellImageSizing::Original),
        3 => Ok(CellImageSizing::Custom),
        _ => Err(CellError::Value),
    }
}

fn coerce_dimension(value: &CellValue) -> Result<u32, CellError> {
    let n = value.coerce_to_number()?;
    if !n.is_finite() || n <= 0.0 || n > f64::from(u32::MAX) {
        return Err(CellError::Value);
    }
    Ok(n.round() as u32)
}

fn is_supported_image_source(source: &str) -> bool {
    let trimmed = source.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("https://")
        || lower.starts_with("blob:")
        || lower.starts_with("data:image/png;")
        || lower.starts_with("data:image/jpeg;")
        || lower.starts_with("data:image/jpg;")
        || lower.starts_with("data:image/gif;")
        || lower.starts_with("data:image/webp;")
        || lower.starts_with("data:image/svg+xml;")
}

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnImage));
}
