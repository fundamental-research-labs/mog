//! Target-neutral classification helpers used across downstream target
//! crates.
//!
//! Anything napi-specific (bytes-tuple detection, self-tuple detection,
//! `ReturnInfo`) lives in `bridge-napi-macros` as a per-target extension.
//! This module only holds helpers that every target would otherwise
//! re-implement identically.

/// Convert `PascalCase` / `camelCase` to `snake_case` using the simple
/// insert-underscore-before-each-capital rule. Matches the behaviour every
/// downstream codegen has needed for default function/prefix names.
///
/// This is intentionally a byte-level transform — it does NOT try to handle
/// acronyms specially (`HTTPServer` becomes `h_t_t_p_server`, not
/// `http_server`). All existing call sites rely on that behaviour.
pub fn to_snake_case(s: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snake_case_simple() {
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
}
