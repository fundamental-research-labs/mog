use proc_macro::TokenStream;
use quote::quote;
use syn::{DeriveInput, Fields, Meta, Type, parse_macro_input};

/// Derive `DescribeSchema` for a struct.
///
/// Generates `impl DescribeSchema for MyStruct` with a `required_field_names()`
/// method that returns the wire-format names of all required fields.
///
/// A field is **required** unless:
/// - Its type is `Option<T>`
/// - It has `#[serde(default)]` or `#[serde(default = "...")]`
///
/// If the struct has `#[serde(default)]` at the container level, ALL fields are
/// optional and `required_field_names()` returns `&[]`.
///
/// Field names are transformed according to:
/// - `#[serde(rename_all = "camelCase")]` (or other cases) at struct level
/// - `#[serde(rename = "foo")]` on individual fields
///
/// # Example
///
/// ```ignore
/// #[derive(Deserialize, DescribeSchema)]
/// #[serde(rename_all = "camelCase")]
/// pub struct PivotTableConfig {
///     pub id: String,                           // required → "id"
///     pub source_sheet_name: String,             // required → "sourceSheetName"
///     pub layout: Option<PivotTableLayout>,      // optional (skipped)
///     #[serde(default)]
///     pub calculated_fields: Option<Vec<Field>>, // optional (skipped — default)
/// }
/// ```
#[proc_macro_derive(DescribeSchema, attributes(serde))]
pub fn derive_describe_schema(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let name = &input.ident;
    let (impl_generics, ty_generics, where_clause) = input.generics.split_for_impl();

    // Check for container-level #[serde(default)]
    let container_has_default = has_serde_default(&input.attrs);

    // Check for container-level #[serde(rename_all = "...")]
    let rename_all = get_serde_rename_all(&input.attrs);

    let fields = match &input.data {
        syn::Data::Struct(data) => match &data.fields {
            Fields::Named(named) => &named.named,
            _ => {
                return syn::Error::new_spanned(
                    &input.ident,
                    "DescribeSchema only supports structs with named fields",
                )
                .to_compile_error()
                .into();
            }
        },
        _ => {
            return syn::Error::new_spanned(&input.ident, "DescribeSchema only supports structs")
                .to_compile_error()
                .into();
        }
    };

    // If container has #[serde(default)], all fields are optional
    if container_has_default {
        return quote! {
            impl #impl_generics bridge_types::DescribeSchema for #name #ty_generics #where_clause {
                fn required_field_names() -> &'static [&'static str] {
                    &[]
                }
            }
        }
        .into();
    }

    let mut required_names: Vec<String> = Vec::new();

    for field in fields {
        let field_name = field.ident.as_ref().unwrap();

        // Skip if type is Option<T>
        if is_option_type(&field.ty) {
            continue;
        }

        // Skip if field has #[serde(default)] or #[serde(default = "...")]
        if has_serde_default(&field.attrs) {
            continue;
        }

        // Determine wire name: #[serde(rename = "...")] takes priority, else apply rename_all
        let wire_name = if let Some(renamed) = get_serde_rename(&field.attrs) {
            renamed
        } else {
            let raw = field_name.to_string();
            match rename_all.as_deref() {
                Some("camelCase") => to_camel_case(&raw),
                Some("snake_case") => raw, // already snake_case in Rust
                Some("PascalCase") => to_pascal_case(&raw),
                Some("SCREAMING_SNAKE_CASE") => raw.to_uppercase(),
                Some("kebab-case") => raw.replace('_', "-"),
                Some("SCREAMING-KEBAB-CASE") => raw.replace('_', "-").to_uppercase(),
                _ => raw, // no rename_all or unknown — use as-is
            }
        };

        required_names.push(wire_name);
    }

    let names = &required_names;

    quote! {
        impl #impl_generics bridge_types::DescribeSchema for #name #ty_generics #where_clause {
            fn required_field_names() -> &'static [&'static str] {
                &[#(#names),*]
            }
        }
    }
    .into()
}

/// Check if a type is `Option<T>` by examining the last path segment.
fn is_option_type(ty: &Type) -> bool {
    matches!(
        ty,
        Type::Path(type_path)
            if type_path
                .path
                .segments
                .last()
                .is_some_and(|segment| segment.ident == "Option")
    )
}

/// Check if attrs contain `#[serde(default)]` or `#[serde(default = "...")]`.
fn has_serde_default(attrs: &[syn::Attribute]) -> bool {
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        if let Meta::List(meta_list) = &attr.meta {
            let tokens = meta_list.tokens.to_string();
            // Match "default" as a standalone token or "default = ..."
            // We split by comma and check each part
            for part in tokens.split(',') {
                let trimmed = part.trim();
                if trimmed == "default" || trimmed.starts_with("default =") {
                    return true;
                }
            }
        }
    }
    false
}

/// Extract `rename_all = "..."` from serde container attributes.
fn get_serde_rename_all(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        if let Meta::List(meta_list) = &attr.meta {
            let tokens = meta_list.tokens.to_string();
            for part in tokens.split(',') {
                let trimmed = part.trim();
                if let Some(value) = trimmed.strip_prefix("rename_all") {
                    let value = value.trim().strip_prefix('=')?.trim();
                    // Strip quotes
                    let value = value.trim_matches('"');
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Extract `rename = "..."` from a field's serde attributes.
fn get_serde_rename(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        if let Meta::List(meta_list) = &attr.meta {
            let tokens = meta_list.tokens.to_string();
            for part in tokens.split(',') {
                let trimmed = part.trim();
                // Match `rename = "..."` but NOT `rename_all = "..."`
                if trimmed.starts_with("rename =") || trimmed.starts_with("rename=") {
                    let value = trimmed
                        .strip_prefix("rename")?
                        .trim()
                        .strip_prefix('=')?
                        .trim()
                        .trim_matches('"');
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

/// Convert snake_case to camelCase.
fn to_camel_case(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut capitalize_next = false;

    for (i, ch) in s.chars().enumerate() {
        if ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            result.push(ch.to_ascii_uppercase());
            capitalize_next = false;
        } else if i == 0 {
            result.push(ch.to_ascii_lowercase());
        } else {
            result.push(ch);
        }
    }

    result
}

/// Convert snake_case to PascalCase.
fn to_pascal_case(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut capitalize_next = true;

    for ch in s.chars() {
        if ch == '_' {
            capitalize_next = true;
        } else if capitalize_next {
            result.push(ch.to_ascii_uppercase());
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }

    result
}
