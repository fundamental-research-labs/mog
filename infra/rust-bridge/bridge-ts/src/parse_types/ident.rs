/// Strip the `r#` prefix from Rust raw identifiers (e.g. `r#macro` → `macro`).
pub(super) fn strip_raw_prefix(name: &str) -> &str {
    name.strip_prefix("r#").unwrap_or(name)
}
