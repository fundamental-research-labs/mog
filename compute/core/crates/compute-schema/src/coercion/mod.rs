//! Type coercion engine.
//!
//! Converts cell values between schema types while preserving semantics.
//! Times are represented as fractional days (0.0-1.0) matching Excel convention.

mod date;
mod money;
mod number;
mod percentage;
mod scalar;
mod time;

use value_types::CellValue;

use crate::types::{CellValueResult, CoercionResult, SchemaType};

/// Coerce a `CellValue` to the target `SchemaType`.
pub fn coerce(value: &CellValue, target: SchemaType) -> CoercionResult {
    if matches!(value, CellValue::Null) {
        return match target {
            SchemaType::Null | SchemaType::Any => CoercionResult::ok(CellValueResult::Null),
            SchemaType::String
            | SchemaType::Email
            | SchemaType::Url
            | SchemaType::Phone
            | SchemaType::Company
            | SchemaType::Person
            | SchemaType::Stock
            | SchemaType::Location => CoercionResult::ok(CellValueResult::Text(String::new())),
            _ => CoercionResult::err("Cannot coerce null to non-null type"),
        };
    }

    if target == SchemaType::Any {
        return scalar::coerce_passthrough(value);
    }

    match target {
        SchemaType::Null => scalar::coerce_to_null(value),
        SchemaType::Boolean => scalar::coerce_to_boolean(value),
        SchemaType::Number => number::coerce_to_number(value),
        SchemaType::Integer => scalar::coerce_to_integer(value),
        SchemaType::String => scalar::coerce_to_string(value),
        SchemaType::Date => date::coerce_to_date(value),
        SchemaType::Time => time::coerce_to_time(value),
        SchemaType::Email
        | SchemaType::Url
        | SchemaType::Phone
        | SchemaType::Company
        | SchemaType::Person
        | SchemaType::Stock
        | SchemaType::Location => scalar::coerce_to_string(value),
        SchemaType::Currency => money::coerce_to_currency(value),
        SchemaType::Percentage => percentage::coerce_to_percentage(value),
        SchemaType::Distribution => number::coerce_to_number(value),
        SchemaType::Any => unreachable!(),
    }
}

#[cfg(test)]
mod tests;
