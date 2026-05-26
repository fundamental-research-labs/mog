//! Formatting functions for structured references.

use super::super::types::{SpecialItem, StructuredRef, StructuredRefSpecifier};

/// Format a `StructuredRef` back to its string representation.
///
/// Roundtrip: `parse_structured_ref(&format_structured_ref(ref_))` should produce
/// an equivalent `StructuredRef`.
pub fn format_structured_ref(ref_: &StructuredRef) -> String {
    let table_name = &ref_.table_name;
    let specifiers = &ref_.specifiers;

    if specifiers.is_empty() {
        return table_name.clone();
    }

    // Check if it's a simple case (single specifier, no nesting needed)
    if specifiers.len() == 1 {
        return format!("{}{}", table_name, format_single_specifier(&specifiers[0]));
    }

    // Multiple specifiers — check if it's @ + column (shorthand)
    if specifiers.len() == 2
        && let (StructuredRefSpecifier::ThisRow, StructuredRefSpecifier::Column { name }) =
            (&specifiers[0], &specifiers[1])
    {
        return format!("{}[@{}]", table_name, escape_column_name(name));
    }

    // General case: nested brackets [[spec1],[spec2],...]
    let parts: Vec<String> = specifiers.iter().map(format_specifier_bracketed).collect();
    format!("{}[{}]", table_name, parts.join(","))
}

/// Format a single specifier (no outer table brackets needed in the simple case).
fn format_single_specifier(spec: &StructuredRefSpecifier) -> String {
    match spec {
        StructuredRefSpecifier::Column { name } => {
            format!("[{}]", escape_column_name(name))
        }
        StructuredRefSpecifier::ColumnRange { start, end } => {
            format!(
                "[[{}]:[{}]]",
                escape_column_name(start),
                escape_column_name(end)
            )
        }
        StructuredRefSpecifier::ThisRow => "[@]".to_string(),
        StructuredRefSpecifier::Special { item } => {
            format!("[{}]", format_special_item(item))
        }
    }
}

/// Format a specifier with brackets (for use in nested expressions).
fn format_specifier_bracketed(spec: &StructuredRefSpecifier) -> String {
    match spec {
        StructuredRefSpecifier::Column { name } => {
            format!("[{}]", escape_column_name(name))
        }
        StructuredRefSpecifier::ColumnRange { start, end } => {
            format!(
                "[{}]:[{}]",
                escape_column_name(start),
                escape_column_name(end)
            )
        }
        StructuredRefSpecifier::ThisRow => "[#This Row]".to_string(),
        StructuredRefSpecifier::Special { item } => {
            format!("[{}]", format_special_item(item))
        }
    }
}

/// Format a specifier (public API for external callers).
pub fn format_specifier(spec: &StructuredRefSpecifier) -> String {
    format_specifier_bracketed(spec)
}

/// Escape a column name for use in a structured reference string.
///
/// Doubles `'`, `[`, `]` and wraps in single quotes if the name contains
/// `#`, `@`, `[`, `]`, or `'`.
pub(crate) fn escape_column_name(name: &str) -> String {
    if name.contains('\'')
        || name.contains('[')
        || name.contains(']')
        || name.contains('#')
        || name.contains('@')
    {
        let escaped = name
            .replace('\'', "''")
            .replace('[', "[[")
            .replace(']', "]]");
        format!("'{}'", escaped)
    } else {
        name.to_string()
    }
}

fn format_special_item(item: &SpecialItem) -> String {
    match item {
        SpecialItem::All => "#All".to_string(),
        SpecialItem::Data => "#Data".to_string(),
        SpecialItem::Headers => "#Headers".to_string(),
        SpecialItem::Totals => "#Totals".to_string(),
        SpecialItem::ThisRow => "#This Row".to_string(),
    }
}
