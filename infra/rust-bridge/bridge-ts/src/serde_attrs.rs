//! Serde attribute parsing for syn AST nodes.
//!
//! Extracts `#[serde(...)]` attributes from structs, enums, fields, and variants
//! to faithfully reproduce Rust's serde naming conventions in generated TypeScript.

/// Attributes parsed from a container-level (struct/enum) `#[serde(...)]`.
#[derive(Debug, Default)]
pub struct SerdeContainerAttrs {
    /// Rename rule applied to all fields/variants, e.g. `"camelCase"`.
    pub rename_all: Option<String>,
    /// Tag field name for internally/adjacently tagged enums, e.g. `"type"`.
    pub tag: Option<String>,
    /// Content field name for adjacently tagged enums, e.g. `"value"`.
    pub content: Option<String>,
    /// Whether the enum is untagged.
    pub untagged: bool,
    /// Target type for `#[serde(into = "Type")]` — serializes via `Into<Type>`.
    pub into: Option<String>,
    /// Source type for `#[serde(try_from = "Type")]` — deserializes via `TryFrom<Type>`.
    pub try_from: Option<String>,
}

impl SerdeContainerAttrs {
    /// Parse container-level serde attributes from a slice of `syn::Attribute`.
    pub fn from_attrs(attrs: &[syn::Attribute]) -> Self {
        let mut result = Self::default();

        for attr in attrs {
            if !attr.path().is_ident("serde") {
                continue;
            }

            let Ok(nested) = attr.parse_args_with(
                syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
            ) else {
                continue;
            };

            for meta in &nested {
                match meta {
                    syn::Meta::NameValue(nv) => {
                        let Some(ident) = nv.path.get_ident() else {
                            continue;
                        };
                        let value = lit_str_value(&nv.value);
                        match ident.to_string().as_str() {
                            "rename_all" => result.rename_all = value,
                            "tag" => result.tag = value,
                            "content" => result.content = value,
                            "into" => result.into = value,
                            "try_from" => result.try_from = value,
                            _ => {}
                        }
                    }
                    syn::Meta::Path(path) => {
                        if path.is_ident("untagged") {
                            result.untagged = true;
                        }
                    }
                    _ => {}
                }
            }
        }

        result
    }
}

/// Attributes parsed from a field-level or variant-level `#[serde(...)]`.
#[derive(Debug, Default)]
pub struct SerdeFieldAttrs {
    /// Explicit rename for this field, e.g. `"type"`.
    pub rename: Option<String>,
    /// Rename rule for children (variant-level `rename_all`), e.g. `"camelCase"`.
    /// On a variant, this applies to the variant's struct fields.
    pub rename_all: Option<String>,
    /// Predicate path for conditional serialization, e.g. `"Option::is_none"`.
    pub skip_serializing_if: Option<String>,
    /// Custom serializer function path.
    pub serialize_with: Option<String>,
    /// Whether this field is skipped entirely (`#[serde(skip)]` or `#[serde(skip_serializing)]`).
    pub skip: bool,
    /// Whether this field is flattened (`#[serde(flatten)]`).
    pub flatten: bool,
}

impl SerdeFieldAttrs {
    /// Parse field-level serde attributes from a slice of `syn::Attribute`.
    pub fn from_attrs(attrs: &[syn::Attribute]) -> Self {
        let mut result = Self::default();

        for attr in attrs {
            if !attr.path().is_ident("serde") {
                continue;
            }

            let Ok(nested) = attr.parse_args_with(
                syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
            ) else {
                continue;
            };

            for meta in &nested {
                match meta {
                    syn::Meta::NameValue(nv) => {
                        let Some(ident) = nv.path.get_ident() else {
                            continue;
                        };
                        let value = lit_str_value(&nv.value);
                        match ident.to_string().as_str() {
                            "rename" => result.rename = value,
                            "rename_all" => result.rename_all = value,
                            "skip_serializing_if" => result.skip_serializing_if = value,
                            "serialize_with" => result.serialize_with = value,
                            _ => {}
                        }
                    }
                    syn::Meta::Path(path) => {
                        if path.is_ident("skip") || path.is_ident("skip_serializing") {
                            result.skip = true;
                        }
                        if path.is_ident("flatten") {
                            result.flatten = true;
                        }
                    }
                    _ => {}
                }
            }
        }

        result
    }
}

/// Extract a string literal value from an expression (the RHS of `key = "value"`).
fn lit_str_value(expr: &syn::Expr) -> Option<String> {
    if let syn::Expr::Lit(syn::ExprLit {
        lit: syn::Lit::Str(s),
        ..
    }) = expr
    {
        Some(s.value())
    } else {
        None
    }
}

/// Apply a serde rename rule to a field or variant name.
///
/// Implements the same rename rules as serde:
/// - `"camelCase"` — `foo_bar` → `fooBar`
/// - `"lowercase"` — `Row` → `row`
/// - `"UPPERCASE"` — `Row` → `ROW`
/// - `"PascalCase"` — `foo_bar` → `FooBar`
/// - `"SCREAMING_SNAKE_CASE"` — `fooBar` → `FOO_BAR`
/// - `"snake_case"` — `FooBar` → `foo_bar`
/// - `"kebab-case"` — `foo_bar` → `foo-bar`
pub fn apply_rename_rule(rule: &str, name: &str) -> String {
    match rule {
        "camelCase" => to_camel_case(name),
        "lowercase" => name.to_lowercase(),
        "UPPERCASE" => name.to_uppercase(),
        "PascalCase" => to_pascal_case(name),
        "SCREAMING_SNAKE_CASE" => to_screaming_snake_case(name),
        "snake_case" => to_snake_case(name),
        "kebab-case" => to_kebab_case(name),
        _ => name.to_string(),
    }
}

/// Convert a name to camelCase.
///
/// Normalizes to snake_case first (to handle PascalCase input like enum
/// variant names), then converts snake_case → camelCase.
fn to_camel_case(name: &str) -> String {
    // Normalize through snake_case to handle both PascalCase and snake_case inputs
    let snake = to_snake_case(name);
    let parts: Vec<&str> = snake.split('_').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return String::new();
    }

    let mut result = parts[0].to_lowercase();
    for part in &parts[1..] {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            result.push(first.to_ascii_uppercase());
            result.extend(chars.map(|c| c.to_ascii_lowercase()));
        }
    }
    result
}

/// Convert a name to PascalCase.
///
/// Normalizes through snake_case first, then capitalizes each segment.
fn to_pascal_case(name: &str) -> String {
    let snake = to_snake_case(name);
    let parts: Vec<&str> = snake.split('_').filter(|s| !s.is_empty()).collect();
    let mut result = String::new();
    for part in &parts {
        let mut chars = part.chars();
        if let Some(first) = chars.next() {
            result.push(first.to_ascii_uppercase());
            result.extend(chars.map(|c| c.to_ascii_lowercase()));
        }
    }
    result
}

/// Convert a name to SCREAMING_SNAKE_CASE.
///
/// Splits camelCase/PascalCase on uppercase boundaries and joins with underscores.
fn to_screaming_snake_case(name: &str) -> String {
    let snake = to_snake_case(name);
    snake.to_uppercase()
}

/// Convert a name to snake_case.
///
/// Inserts underscores before uppercase characters and lowercases everything.
fn to_snake_case(name: &str) -> String {
    let mut result = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch == '_' {
            result.push('_');
            continue;
        }
        if ch.is_ascii_uppercase() && i > 0 {
            let prev = name.chars().nth(i - 1).unwrap();
            if prev != '_' && !prev.is_ascii_uppercase() {
                result.push('_');
            } else if prev.is_ascii_uppercase() {
                // Check if the next char is lowercase (e.g. "XMLParser" → "xml_parser")
                if let Some(next) = name.chars().nth(i + 1)
                    && next.is_ascii_lowercase()
                {
                    result.push('_');
                }
            }
        }
        result.push(ch.to_ascii_lowercase());
    }
    result
}

/// Convert a name to kebab-case.
///
/// Splits on underscores and joins with hyphens.
fn to_kebab_case(name: &str) -> String {
    let snake = to_snake_case(name);
    snake.replace('_', "-")
}

/// Returns `true` if the given `skip_serializing_if` predicate indicates the
/// field should be `?` optional in TypeScript.
///
/// All known predicates (and unknown ones) return true — if Rust can skip the
/// field during serialization, TypeScript should mark it optional.
pub fn is_optional_skip(predicate: &str) -> bool {
    // All predicates mean "this field may be absent", so always optional in TS.
    // Explicit list for documentation purposes:
    matches!(
        predicate,
        "Option::is_none" | "Vec::is_empty" | "std::ops::Not::not" | "is_false" | "is_zero"
    ) || !predicate.is_empty()
    // Any unknown predicate is also considered optional (safe default).
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ──────────────────────────────────────────────────────────

    fn parse_attrs(code: &str) -> Vec<syn::Attribute> {
        let item: syn::ItemStruct = syn::parse_str(code).unwrap();
        item.attrs
    }

    fn parse_field_attrs(code: &str) -> Vec<syn::Attribute> {
        let item: syn::ItemStruct = syn::parse_str(code).unwrap();
        if let syn::Fields::Named(fields) = &item.fields {
            fields.named[0].attrs.clone()
        } else {
            vec![]
        }
    }

    // ── SerdeContainerAttrs ─────────────────────────────────────────────

    #[test]
    fn container_rename_all_camel_case() {
        let attrs = parse_attrs(
            r#"
            #[serde(rename_all = "camelCase")]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename_all.as_deref(), Some("camelCase"));
        assert_eq!(parsed.tag, None);
        assert_eq!(parsed.content, None);
        assert!(!parsed.untagged);
    }

    #[test]
    fn container_tag_and_content() {
        let attrs = parse_attrs(
            r#"
            #[serde(tag = "type", content = "value")]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.tag.as_deref(), Some("type"));
        assert_eq!(parsed.content.as_deref(), Some("value"));
    }

    #[test]
    fn container_untagged() {
        let attrs = parse_attrs(
            r#"
            #[serde(untagged)]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert!(parsed.untagged);
    }

    #[test]
    fn container_no_serde_attrs() {
        let attrs = parse_attrs(
            r#"
            #[derive(Debug)]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename_all, None);
        assert_eq!(parsed.tag, None);
        assert_eq!(parsed.content, None);
        assert!(!parsed.untagged);
    }

    #[test]
    fn container_multiple_serde_attrs() {
        let attrs = parse_attrs(
            r#"
            #[serde(rename_all = "camelCase")]
            #[serde(tag = "kind")]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename_all.as_deref(), Some("camelCase"));
        assert_eq!(parsed.tag.as_deref(), Some("kind"));
    }

    #[test]
    fn container_ignores_unknown_serde_attrs() {
        let attrs = parse_attrs(
            r#"
            #[serde(rename_all = "camelCase", default, deny_unknown_fields)]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename_all.as_deref(), Some("camelCase"));
        assert!(!parsed.untagged);
    }

    #[test]
    fn container_into_string() {
        let attrs = parse_attrs(
            r#"
            #[serde(into = "String", try_from = "String")]
            pub struct SheetId { inner: u128 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.into.as_deref(), Some("String"));
        assert_eq!(parsed.try_from.as_deref(), Some("String"));
    }

    #[test]
    fn container_into_without_try_from() {
        let attrs = parse_attrs(
            r#"
            #[serde(into = "String")]
            pub struct Foo { x: u32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.into.as_deref(), Some("String"));
        assert_eq!(parsed.try_from, None);
    }

    #[test]
    fn container_combined_tag_content_rename_all() {
        let attrs = parse_attrs(
            r#"
            #[serde(tag = "type", content = "value", rename_all = "snake_case")]
            pub struct Foo { x: i32 }
            "#,
        );
        let parsed = SerdeContainerAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename_all.as_deref(), Some("snake_case"));
        assert_eq!(parsed.tag.as_deref(), Some("type"));
        assert_eq!(parsed.content.as_deref(), Some("value"));
    }

    // ── SerdeFieldAttrs ─────────────────────────────────────────────────

    #[test]
    fn field_rename() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(rename = "type")]
                kind: String,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename.as_deref(), Some("type"));
    }

    #[test]
    fn field_skip_serializing_if() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(skip_serializing_if = "Option::is_none")]
                value: Option<String>,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert_eq!(
            parsed.skip_serializing_if.as_deref(),
            Some("Option::is_none")
        );
    }

    #[test]
    fn field_serialize_with() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(serialize_with = "path::to::custom_fn")]
                value: Vec<u8>,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert_eq!(
            parsed.serialize_with.as_deref(),
            Some("path::to::custom_fn")
        );
    }

    #[test]
    fn field_skip() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(skip)]
                internal: usize,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert!(parsed.skip);
    }

    #[test]
    fn field_skip_serializing() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(skip_serializing)]
                internal: usize,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert!(parsed.skip);
    }

    #[test]
    fn field_combined_attrs() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(rename = "cellType", skip_serializing_if = "Option::is_none")]
                cell_type: Option<String>,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename.as_deref(), Some("cellType"));
        assert_eq!(
            parsed.skip_serializing_if.as_deref(),
            Some("Option::is_none")
        );
        assert!(!parsed.skip);
    }

    #[test]
    fn field_no_serde_attrs() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                value: String,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert_eq!(parsed.rename, None);
        assert_eq!(parsed.skip_serializing_if, None);
        assert_eq!(parsed.serialize_with, None);
        assert!(!parsed.skip);
        assert!(!parsed.flatten);
    }

    #[test]
    fn field_flatten() {
        let attrs = parse_field_attrs(
            r#"
            pub struct Foo {
                #[serde(flatten)]
                extra: Value,
            }
            "#,
        );
        let parsed = SerdeFieldAttrs::from_attrs(&attrs);
        assert!(parsed.flatten);
        assert!(!parsed.skip);
    }

    // ── apply_rename_rule: camelCase ────────────────────────────────────

    #[test]
    fn camel_case_col_width() {
        assert_eq!(apply_rename_rule("camelCase", "col_width"), "colWidth");
    }

    #[test]
    fn camel_case_custom_width() {
        assert_eq!(
            apply_rename_rule("camelCase", "custom_width"),
            "customWidth"
        );
    }

    #[test]
    fn camel_case_start_row() {
        assert_eq!(apply_rename_rule("camelCase", "start_row"), "startRow");
    }

    #[test]
    fn camel_case_has_formula() {
        assert_eq!(apply_rename_rule("camelCase", "has_formula"), "hasFormula");
    }

    #[test]
    fn camel_case_number_format_id() {
        assert_eq!(
            apply_rename_rule("camelCase", "number_format_id"),
            "numberFormatId"
        );
    }

    #[test]
    fn camel_case_fg_color() {
        assert_eq!(apply_rename_rule("camelCase", "fg_color"), "fgColor");
    }

    #[test]
    fn camel_case_single_word() {
        assert_eq!(apply_rename_rule("camelCase", "name"), "name");
    }

    // ── apply_rename_rule: lowercase ────────────────────────────────────

    #[test]
    fn lowercase_row() {
        assert_eq!(apply_rename_rule("lowercase", "Row"), "row");
    }

    #[test]
    fn lowercase_col() {
        assert_eq!(apply_rename_rule("lowercase", "Col"), "col");
    }

    #[test]
    fn lowercase_down() {
        assert_eq!(apply_rename_rule("lowercase", "Down"), "down");
    }

    #[test]
    fn lowercase_add_sheet() {
        assert_eq!(apply_rename_rule("lowercase", "AddSheet"), "addsheet");
    }

    // ── apply_rename_rule: UPPERCASE ────────────────────────────────────

    #[test]
    fn uppercase_row() {
        assert_eq!(apply_rename_rule("UPPERCASE", "Row"), "ROW");
    }

    #[test]
    fn uppercase_col() {
        assert_eq!(apply_rename_rule("UPPERCASE", "Col"), "COL");
    }

    // ── apply_rename_rule: PascalCase ───────────────────────────────────

    #[test]
    fn pascal_case_foo_bar() {
        assert_eq!(apply_rename_rule("PascalCase", "foo_bar"), "FooBar");
    }

    #[test]
    fn pascal_case_single_word() {
        assert_eq!(apply_rename_rule("PascalCase", "name"), "Name");
    }

    #[test]
    fn pascal_case_multi_segment() {
        assert_eq!(
            apply_rename_rule("PascalCase", "number_format_id"),
            "NumberFormatId"
        );
    }

    // ── apply_rename_rule: SCREAMING_SNAKE_CASE ─────────────────────────

    #[test]
    fn screaming_snake_case_foo_bar() {
        assert_eq!(
            apply_rename_rule("SCREAMING_SNAKE_CASE", "fooBar"),
            "FOO_BAR"
        );
    }

    #[test]
    fn screaming_snake_case_already_snake() {
        assert_eq!(
            apply_rename_rule("SCREAMING_SNAKE_CASE", "col_width"),
            "COL_WIDTH"
        );
    }

    // ── apply_rename_rule: snake_case ───────────────────────────────────

    #[test]
    fn snake_case_from_pascal() {
        assert_eq!(apply_rename_rule("snake_case", "FooBar"), "foo_bar");
    }

    #[test]
    fn snake_case_identity() {
        assert_eq!(apply_rename_rule("snake_case", "col_width"), "col_width");
    }

    // ── apply_rename_rule: kebab-case ───────────────────────────────────

    #[test]
    fn kebab_case_foo_bar() {
        assert_eq!(apply_rename_rule("kebab-case", "foo_bar"), "foo-bar");
    }

    #[test]
    fn kebab_case_number_format_id() {
        assert_eq!(
            apply_rename_rule("kebab-case", "number_format_id"),
            "number-format-id"
        );
    }

    // ── apply_rename_rule: unknown rule ─────────────────────────────────

    #[test]
    fn unknown_rule_returns_identity() {
        assert_eq!(apply_rename_rule("unknownRule", "foo_bar"), "foo_bar");
    }

    // ── is_optional_skip ────────────────────────────────────────────────

    #[test]
    fn optional_skip_option_is_none() {
        assert!(is_optional_skip("Option::is_none"));
    }

    #[test]
    fn optional_skip_vec_is_empty() {
        assert!(is_optional_skip("Vec::is_empty"));
    }

    #[test]
    fn optional_skip_std_not() {
        assert!(is_optional_skip("std::ops::Not::not"));
    }

    #[test]
    fn optional_skip_is_false() {
        assert!(is_optional_skip("is_false"));
    }

    #[test]
    fn optional_skip_is_zero() {
        assert!(is_optional_skip("is_zero"));
    }

    #[test]
    fn optional_skip_unknown_predicate() {
        assert!(is_optional_skip("some_custom_check"));
    }

    #[test]
    fn optional_skip_empty_string_is_false() {
        // Empty string is not a valid predicate — but matches! won't match it,
        // and the fallback `!predicate.is_empty()` returns false.
        assert!(!is_optional_skip(""));
    }
}
