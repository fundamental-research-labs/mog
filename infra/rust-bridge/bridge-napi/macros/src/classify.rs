//! napi-specific type-string classification helpers.
//!
//! `to_snake_case` is target-neutral and lives in `bridge_ir::classify`; it
//! is re-exported here so `crate::classify::to_snake_case` keeps resolving
//! for the rest of this crate.
//!
//! Return-type classification (`ReturnInfo`) is napi-specific: the
//! `is_bytes_tuple` / `is_self_tuple` shapes are napi codegen concerns
//! (they select between Buffer return / registry-insert-then-return-aux
//! shapes that no other target uses).

use crate::ir::ReturnInfo;

// Re-export the target-neutral helper so `crate::classify::to_snake_case`
// keeps working for every existing call site in this crate.
pub(crate) use bridge_ir::classify::to_snake_case;

// ---------------------------------------------------------------------------
// Return type classification (napi-specific)
// ---------------------------------------------------------------------------

pub(crate) fn classify_return(ty_str: &str) -> ReturnInfo {
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

    // Detect self-tuple pattern: (Self, T) where first element is Self
    // and second element is a serde-serializable type.
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
/// Returns `(true, Some(inner_type_string))` if it matches, `(false, None)` otherwise.
fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();

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
/// Returns `(true, Some(inner_type_string))` if it matches, `(false, None)` otherwise.
fn parse_self_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();

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

    if parts.len() != 2 {
        return (false, None);
    }

    let first = parts[0].trim();
    if first != "Self" {
        return (false, None);
    }

    (true, Some(parts[1].clone()))
}

/// Returns true if the return type should be passed through directly (no serde).
pub(crate) fn is_direct_return(ret: &ReturnInfo) -> bool {
    ret.is_unit || ret.is_string || ret.is_prim || ret.is_bytes || ret.is_bytes_tuple
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snake_case_simple() {
        // Re-exported from bridge-ir; kept as a smoke test so the
        // re-export doesn't silently break.
        assert_eq!(to_snake_case("KvStore"), "kv_store");
    }

    #[test]
    fn snake_case_single_word() {
        assert_eq!(to_snake_case("Engine"), "engine");
    }

    #[test]
    fn snake_case_already_snake() {
        assert_eq!(to_snake_case("already_snake"), "already_snake");
    }

    #[test]
    fn snake_case_consecutive_caps() {
        assert_eq!(to_snake_case("HTTPServer"), "h_t_t_p_server");
    }

    #[test]
    fn snake_case_kv_utils() {
        assert_eq!(to_snake_case("KvUtils"), "kv_utils");
    }

    #[test]
    fn classify_return_unit() {
        let r = classify_return("()");
        assert!(r.is_unit);
        assert!(!r.is_string);
    }

    #[test]
    fn classify_return_string() {
        let r = classify_return("String");
        assert!(r.is_string);
        assert!(!r.is_prim);
    }

    #[test]
    fn classify_return_u64() {
        let r = classify_return("u64");
        assert!(r.is_prim);
        assert!(!r.is_string);
    }

    #[test]
    fn classify_return_vec_u8() {
        let r = classify_return("Vec<u8>");
        assert!(r.is_bytes);
    }

    #[test]
    fn classify_return_custom_struct() {
        let r = classify_return("StoreStats");
        assert!(!r.is_string);
        assert!(!r.is_prim);
        assert!(!r.is_bytes);
        assert!(!r.is_unit);
    }

    #[test]
    fn classify_return_bool() {
        let r = classify_return("bool");
        assert!(r.is_prim);
    }

    #[test]
    fn classify_return_vec_string() {
        let r = classify_return("Vec<String>");
        assert!(!r.is_prim);
        assert!(!r.is_string);
        assert!(!r.is_bytes);
        assert!(!r.is_unit);
        // Vec<String> is a serde return
    }

    // --- Bytes-tuple classification tests ---

    #[test]
    fn classify_return_bytes_tuple() {
        let r = classify_return("(Vec<u8>, MutationMeta)");
        assert!(r.is_bytes_tuple);
        assert!(!r.is_bytes);
        assert!(!r.is_prim);
        assert!(!r.is_string);
        assert!(!r.is_unit);
        assert_eq!(r.serde_inner_ty.as_deref(), Some("MutationMeta"));
    }

    #[test]
    fn classify_return_bytes_tuple_with_spaces() {
        let r = classify_return("(Vec < u8 > , SomeStruct)");
        assert!(r.is_bytes_tuple);
        assert_eq!(r.serde_inner_ty.as_deref(), Some("SomeStruct"));
    }

    #[test]
    fn classify_return_non_bytes_tuple() {
        // A tuple where the first element is NOT Vec<u8> should not match
        let r = classify_return("(String, u32)");
        assert!(!r.is_bytes_tuple);
        assert!(r.serde_inner_ty.is_none());
    }

    #[test]
    fn classify_return_triple_tuple_not_bytes_tuple() {
        // More than 2 elements should not match
        let r = classify_return("(Vec<u8>, String, u32)");
        assert!(!r.is_bytes_tuple);
    }

    #[test]
    fn classify_return_bytes_tuple_with_generic_inner() {
        let r = classify_return("(Vec<u8>, HashMap<String, Value>)");
        assert!(r.is_bytes_tuple);
        assert_eq!(r.serde_inner_ty.as_deref(), Some("HashMap<String, Value>"));
    }

    // --- (Self, T) lifecycle create classification tests ---

    #[test]
    fn classify_return_detects_self_tuple() {
        let r = classify_return("(Self, InitData)");
        assert!(
            r.is_self_tuple,
            "expected is_self_tuple for (Self, InitData)"
        );
        assert_eq!(r.self_tuple_inner_ty.as_deref(), Some("InitData"));
        assert!(!r.is_bytes_tuple);
        assert!(!r.is_string);
        assert!(!r.is_prim);
    }

    #[test]
    fn classify_return_self_not_in_tuple() {
        let r = classify_return("Self");
        assert!(!r.is_self_tuple, "plain Self is not a self-tuple");
    }

    #[test]
    fn parse_self_tuple_with_generic_inner() {
        let (is_self_tuple, inner) = parse_self_tuple("(Self, HashMap<String, Value>)");
        assert!(is_self_tuple);
        assert_eq!(inner.as_deref(), Some("HashMap<String, Value>"));
    }
}
