//! Conversion functions: TEXT, VALUE, CHAR, CODE, FIXED, DOLLAR, NUMBERVALUE,
//! VALUETOTEXT, ARRAYTOTEXT, TO_DATE, TO_DOLLARS, TO_PERCENT, TO_PURE_NUMBER,
//! TO_TEXT

mod array_text;
mod char_code;
mod number_format;
mod sheets_to;
mod text_format;
mod value_parse;

use crate::FunctionRegistry;

pub fn register(registry: &mut FunctionRegistry) {
    text_format::register(registry);
    value_parse::register(registry);
    char_code::register(registry);
    number_format::register(registry);
    array_text::register(registry);
    sheets_to::register(registry);
}

#[cfg(test)]
mod tests;
