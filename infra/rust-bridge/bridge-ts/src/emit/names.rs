//! Shared naming and command-name helpers for TypeScript emitters.

use crate::types::TsService;

/// Convert `PascalCase` or `camelCase` to `snake_case`.
pub fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(ch.to_lowercase().next().unwrap());
        } else {
            result.push(ch);
        }
    }
    result
}

/// Convert `snake_case` to `camelCase`.
///
/// Strips leading underscores (Rust's "unused" convention) so that
/// `_sheet_id` becomes `sheetId`, not `SheetId`.
pub fn to_camel_case(s: &str) -> String {
    let s = s.strip_prefix('_').unwrap_or(s);
    let mut result = String::new();
    let mut capitalize_next = false;
    for ch in s.chars() {
        if ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            result.push(ch.to_uppercase().next().unwrap());
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }
    result
}

/// Compute the effective command name prefix for a service.
pub(crate) fn compute_effective_prefix(svc: &TsService) -> String {
    match &svc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),
        None => to_snake_case(&svc.rust_name),
    }
}

pub(crate) fn method_command_name(effective_prefix: &str, method_name: &str) -> String {
    if effective_prefix.is_empty() {
        method_name.to_string()
    } else {
        format!("{}_{}", effective_prefix, method_name)
    }
}

pub(crate) fn destroy_command_name(effective_prefix: &str) -> String {
    if effective_prefix.is_empty() {
        "destroy".to_string()
    } else {
        format!("{}_destroy", effective_prefix)
    }
}
