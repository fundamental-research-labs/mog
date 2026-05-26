//! Manipulation functions: UPPER, LOWER, PROPER, TRIM, CLEAN, T

use value_types::CellValue;

use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

/// Excel TRIM algorithm: removes leading/trailing ASCII space (0x20) only,
/// and collapses multiple ASCII spaces into one. Does NOT touch
/// tabs, newlines, or other Unicode whitespace.
fn excel_trim(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut prev_was_space = true; // treat start as "after space" to skip leading
    for ch in s.chars() {
        if ch == ' ' {
            if !prev_was_space {
                result.push(' ');
            }
            prev_was_space = true;
        } else {
            result.push(ch);
            prev_was_space = false;
        }
    }
    // Remove trailing space if any
    if result.ends_with(' ') {
        result.pop();
    }
    result
}

/// Apply UPPER to a single (non-array) value.
fn upper_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => CellValue::Text(s.to_uppercase().into()),
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnUpper;
impl PureFunction for FnUpper {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "UPPER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(upper_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => upper_single(&args[0]),
        }
    }
}

/// Apply LOWER to a single (non-array) value.
fn lower_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => CellValue::Text(s.to_lowercase().into()),
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnLower;
impl PureFunction for FnLower {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "LOWER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(lower_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => lower_single(&args[0]),
        }
    }
}

/// Apply PROPER to a single (non-array) value.
fn proper_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => {
            // Excel PROPER: capitalize first letter of each word.
            // Word boundary is any non-letter character.
            let mut result = String::with_capacity(s.len());
            let mut capitalize_next = true;
            for ch in s.chars() {
                if ch.is_alphabetic() {
                    if capitalize_next {
                        for upper in ch.to_uppercase() {
                            result.push(upper);
                        }
                    } else {
                        for lower in ch.to_lowercase() {
                            result.push(lower);
                        }
                    }
                    capitalize_next = false;
                } else {
                    result.push(ch);
                    capitalize_next = true;
                }
            }
            CellValue::Text(result.into())
        }
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnProper;
impl PureFunction for FnProper {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "PROPER"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(proper_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => proper_single(&args[0]),
        }
    }
}

/// Apply TRIM to a single (non-array) value.
fn trim_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => CellValue::Text(excel_trim(&s).into()),
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnTrim;
impl PureFunction for FnTrim {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "TRIM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(trim_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => trim_single(&args[0]),
        }
    }
}

/// Apply CLEAN to a single (non-array) value.
fn clean_single(val: &CellValue) -> CellValue {
    if let Some(e) = check_error(val) {
        return e;
    }
    match val.coerce_to_string() {
        Ok(s) => {
            // Excel CLEAN: removes non-printable characters (ASCII 0-31)
            let cleaned: String = s.chars().filter(|&c| c as u32 > 31).collect();
            CellValue::Text(cleaned.into())
        }
        Err(e) => CellValue::Error(e, None),
    }
}

pub(crate) struct FnClean;
impl PureFunction for FnClean {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        false
    }
    fn name(&self) -> &'static str {
        "CLEAN"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        match &args[0] {
            CellValue::Array(arr) => {
                let result: Vec<CellValue> = arr.iter().map(clean_single).collect();
                CellValue::array(result, arr.cols())
            }
            _ => clean_single(&args[0]),
        }
    }
}

pub(crate) struct FnT;
impl PureFunction for FnT {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "T"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        // T returns text if text, empty string otherwise
        match &args[0] {
            CellValue::Text(s) => CellValue::Text(s.clone()),
            _ => CellValue::Text(String::new().into()),
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnUpper));
    registry.register(Box::new(FnLower));
    registry.register(Box::new(FnProper));
    registry.register(Box::new(FnTrim));
    registry.register(Box::new(FnClean));
    registry.register(Box::new(FnT));
}
