use value_types::{CellError, CellValue};

use crate::{FunctionRegistry, PureFunction};

pub(super) struct FnCell;

impl PureFunction for FnCell {
    fn name(&self) -> &'static str {
        "CELL"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(2)
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        let info_str = match &args[0] {
            CellValue::Text(s) => s.to_lowercase(),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "CELL: first argument must be a text info_type",
                );
            }
        };

        let reference_value = if args.len() > 1 {
            &args[1]
        } else {
            &CellValue::Null
        };

        match info_str.as_str() {
            "type" => match reference_value {
                CellValue::Null => CellValue::Text("b".to_string().into()),
                CellValue::Text(_) => CellValue::Text("l".to_string().into()),
                _ => CellValue::Text("v".to_string().into()),
            },
            "contents" => reference_value.clone(),
            _ => CellValue::error_with_message(
                CellError::Na,
                format!("CELL: unsupported info_type \"{}\"", info_str),
            ),
        }
    }
}

pub(super) struct FnInfo;

impl PureFunction for FnInfo {
    fn name(&self) -> &'static str {
        "INFO"
    }

    fn min_args(&self) -> usize {
        1
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        if let CellValue::Error(e, _) = &args[0] {
            return CellValue::Error(*e, None);
        }
        let info_type = match args[0].coerce_to_string() {
            Ok(s) => s.to_lowercase(),
            Err(e) => {
                return CellValue::error_with_message(
                    e,
                    "INFO: could not convert argument to text",
                );
            }
        };

        match info_type.as_str() {
            "directory" => CellValue::Text("/".to_string().into()),
            "numfile" => CellValue::number(1.0),
            "origin" => CellValue::Text("$A$1".to_string().into()),
            "osversion" => CellValue::Text("Shortcut".to_string().into()),
            "recalc" => CellValue::Text("Automatic".to_string().into()),
            "release" => CellValue::Text("16.0".to_string().into()),
            "system" => CellValue::Text("pcdos".to_string().into()),
            _ => CellValue::error_with_message(
                CellError::Na,
                format!("INFO: unsupported info_type \"{}\"", info_type),
            ),
        }
    }
}

pub(super) struct FnSheet;

impl PureFunction for FnSheet {
    fn name(&self) -> &'static str {
        "SHEET"
    }

    fn min_args(&self) -> usize {
        0
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        if !args.is_empty()
            && let CellValue::Error(e, _) = &args[0]
        {
            return CellValue::Error(*e, None);
        }
        CellValue::number(1.0)
    }
}

pub(super) struct FnSheets;

impl PureFunction for FnSheets {
    fn name(&self) -> &'static str {
        "SHEETS"
    }

    fn min_args(&self) -> usize {
        0
    }

    fn max_args(&self) -> Option<usize> {
        Some(1)
    }

    fn call(&self, args: &[CellValue]) -> CellValue {
        if !args.is_empty()
            && let CellValue::Error(e, _) = &args[0]
        {
            return CellValue::Error(*e, None);
        }
        CellValue::number(1.0)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnCell));
    registry.register(Box::new(FnInfo));
    registry.register(Box::new(FnSheet));
    registry.register(Box::new(FnSheets));
}
