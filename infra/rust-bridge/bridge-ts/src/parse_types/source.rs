use crate::parse_types::config::TypeGenConfig;
use crate::parse_types::enums::parse_enum;
use crate::parse_types::structs::parse_struct;
use crate::types::TsTypeDef;

/// Parse Rust source code and extract type definitions from items with
/// `#[derive(Serialize)]`.
///
/// Returns type definitions in source order.
pub fn parse_types(source: &str, config: &TypeGenConfig) -> Result<Vec<TsTypeDef>, String> {
    let file: syn::File =
        syn::parse_str(source).map_err(|e| format!("Failed to parse source: {}", e))?;

    let mut defs = Vec::new();

    for item in &file.items {
        match item {
            syn::Item::Struct(s) if has_derive_serialize(&s.attrs) => {
                if let Some(def) = parse_struct(s, config) {
                    defs.push(def);
                }
            }
            syn::Item::Enum(e) if has_derive_serialize(&e.attrs) => {
                defs.extend(parse_enum(e, config));
            }
            _ => {}
        }
    }

    Ok(defs)
}
/// Check whether an item has `#[derive(Serialize)]` among its attributes.
pub(super) fn has_derive_serialize(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|attr| {
        if !attr.path().is_ident("derive") {
            return false;
        }
        let Ok(nested) = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
        ) else {
            return false;
        };
        nested.iter().any(|p| {
            p.is_ident("Serialize") || p.segments.last().is_some_and(|s| s.ident == "Serialize")
        })
    })
}
