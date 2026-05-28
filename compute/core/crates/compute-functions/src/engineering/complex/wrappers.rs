macro_rules! complex_unary_fn {
    ($struct_name:ident, $name:literal, $body:expr) => {
        pub(super) struct $struct_name;
        impl $crate::PureFunction for $struct_name {
            fn name(&self) -> &'static str {
                $name
            }
            fn min_args(&self) -> usize {
                1
            }
            fn max_args(&self) -> Option<usize> {
                Some(1)
            }
            fn is_scalar_arg(&self, _index: usize) -> bool {
                true
            }
            fn call(&self, args: &[value_types::CellValue]) -> value_types::CellValue {
                let s = match super::super::helpers::coerce_str(args, 0) {
                    Ok(v) => v,
                    Err(e) => return e,
                };
                let (re, im, suffix) = match super::types::parse_complex(&s) {
                    Some(v) => v,
                    None => {
                        return value_types::CellValue::error_with_message(
                            value_types::CellError::Num,
                            format!("{}: argument is not a valid complex number", $name),
                        );
                    }
                };
                let f: fn(f64, f64, char) -> value_types::CellValue = $body;
                f(re, im, suffix)
            }
        }
    };
}

/// Macro for single-arg complex functions that return a number.
macro_rules! complex_to_num_fn {
    ($struct_name:ident, $name:literal, $body:expr) => {
        pub(super) struct $struct_name;
        impl $crate::PureFunction for $struct_name {
            fn name(&self) -> &'static str {
                $name
            }
            fn min_args(&self) -> usize {
                1
            }
            fn max_args(&self) -> Option<usize> {
                Some(1)
            }
            fn is_scalar_arg(&self, _index: usize) -> bool {
                true
            }
            fn call(&self, args: &[value_types::CellValue]) -> value_types::CellValue {
                let s = match super::super::helpers::coerce_str(args, 0) {
                    Ok(v) => v,
                    Err(e) => return e,
                };
                let (re, im, _suffix) = match super::types::parse_complex(&s) {
                    Some(v) => v,
                    None => {
                        return value_types::CellValue::error_with_message(
                            value_types::CellError::Num,
                            format!("{}: argument is not a valid complex number", $name),
                        );
                    }
                };
                let f: fn(f64, f64) -> value_types::CellValue = $body;
                f(re, im)
            }
        }
    };
}

pub(super) use complex_to_num_fn;
pub(super) use complex_unary_fn;
