use super::*;

pub(crate) fn to_snake_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Return type classification
// ---------------------------------------------------------------------------

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

    let (is_bytes_tuple, serde_inner_ty) = parse_bytes_tuple(trimmed);

    let (is_self_tuple, self_tuple_inner_ty) = if !is_bytes_tuple {
        parse_self_tuple(trimmed)
    } else {
        (false, None)
    };

    ReturnInfo {
        ty: trimmed.to_string(),
        is_string,
        is_prim,
        is_bytes,
        is_unit,
        is_bytes_tuple,
        serde_inner_ty,
        is_self_tuple,
        self_tuple_inner_ty,
    }
}

/// Try to parse a type string as a `(Vec<u8>, T)` bytes-tuple.
pub(super) fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();
    let parts = split_tuple_at_depth_zero(inner);
    if parts.len() != 2 {
        return (false, None);
    }
    let first = parts[0].replace(' ', "");
    if first != "Vec<u8>" {
        return (false, None);
    }
    (true, Some(parts[1].clone()))
}

/// Try to parse a type string as a `(Self, T)` self-tuple.
pub(super) fn parse_self_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();
    let parts = split_tuple_at_depth_zero(inner);
    if parts.len() != 2 {
        return (false, None);
    }
    let first = parts[0].trim();
    if first != "Self" {
        return (false, None);
    }
    (true, Some(parts[1].clone()))
}

/// Split a string by commas at angle-bracket depth 0.
pub(super) fn split_tuple_at_depth_zero(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut angle_depth: i32 = 0;
    for ch in s.chars() {
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
    parts
}

/// Returns true if the return type should be passed through directly (no serde).
pub(super) fn is_direct_return(ret: &ReturnInfo) -> bool {
    ret.is_unit || ret.is_string || ret.is_prim || ret.is_bytes || ret.is_bytes_tuple
}

// ---------------------------------------------------------------------------
// Parsing descriptor tokens
