//! Return type classification for WASM bindings.

use super::ir::ReturnInfo;

pub(super) fn classify_return(ty_str: &str) -> ReturnInfo {
    let trimmed = ty_str.trim();
    let is_unit = trimmed == "()" || trimmed.is_empty();
    let is_string = trimmed == "String" || trimmed == "&str";
    let is_prim = matches!(
        trimmed,
        "bool"
            | "u8"
            | "u16"
            | "u32"
            | "u64"
            | "i8"
            | "i16"
            | "i32"
            | "i64"
            | "f32"
            | "f64"
            | "usize"
            | "isize"
    );
    let is_bytes = trimmed == "Vec<u8>" || trimmed == "Vec < u8 >";

    // Detect bytes-tuple pattern: (Vec<u8>, T) where first element is Vec<u8>
    // and second element is a serde-serializable type.
    let (is_bytes_tuple, serde_inner_ty) = parse_bytes_tuple(trimmed);

    ReturnInfo {
        ty: trimmed.to_string(),
        is_string,
        is_prim,
        is_bytes,
        is_unit,
        is_bytes_tuple,
        serde_inner_ty,
    }
}

/// Try to parse a type string as a `(Vec<u8>, T)` bytes-tuple.
/// Returns `(true, Some(inner_type_string))` if it matches, `(false, None)` otherwise.
fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    // Strip outer parentheses
    let inner = trimmed[1..trimmed.len() - 1].trim();

    // Split by comma at depth 0 (respecting angle brackets)
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut angle_depth: i32 = 0;
    for ch in inner.chars() {
        match ch {
            '<' => {
                angle_depth += 1;
                current.push(ch);
            }
            '>' => {
                angle_depth -= 1;
                current.push(ch);
            }
            ',' if angle_depth == 0 => {
                parts.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }

    // Must be exactly 2 elements, first must be Vec<u8>
    if parts.len() != 2 {
        return (false, None);
    }

    let first = parts[0].replace(' ', "");
    if first != "Vec<u8>" {
        return (false, None);
    }

    (true, Some(parts[1].clone()))
}

/// Returns true if the return type should be passed through directly (no serde).
pub(super) fn is_direct_return(ret: &ReturnInfo) -> bool {
    ret.is_unit || ret.is_string || ret.is_prim || ret.is_bytes || ret.is_bytes_tuple
}
