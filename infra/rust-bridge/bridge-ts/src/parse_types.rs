//! Parse Rust structs and enums into TypeScript type definitions.
//!
//! Walks a parsed `syn::File` looking for items with `#[derive(Serialize)]`.
//! Structs become `TsInterface`, all-unit enums become `TsStringUnion`, and
//! enums with data variants become `TsTaggedUnion`.

use std::collections::HashMap;

use crate::mapping::rust_type_to_ts;
use crate::serde_attrs::{
    SerdeContainerAttrs, SerdeFieldAttrs, apply_rename_rule, is_optional_skip,
};
use crate::types::*;

/// Strip the `r#` prefix from Rust raw identifiers (e.g. `r#macro` → `macro`).
fn strip_raw_prefix(name: &str) -> &str {
    name.strip_prefix("r#").unwrap_or(name)
}

/// Configuration for type generation.
#[derive(Debug, Clone, Default)]
pub struct TypeGenConfig {
    /// Map from Rust type name (or path) to a fixed TsType.
    ///
    /// Checked by both last path segment (e.g. `"FiniteF64"`) and full
    /// qualified path (e.g. `"serde_json::Value"`).
    pub external_type_map: HashMap<String, TsType>,

    /// Default rename rule applied when a **struct** has no explicit
    /// `#[serde(rename_all = "...")]`. For example, `Some("camelCase".into())`
    /// makes all struct fields camelCase by default. An explicit `rename_all`
    /// on the container always takes precedence.
    ///
    /// **Not applied to enum variants.** Enum variant names follow serde's
    /// default behavior (preserve original casing) unless the enum itself has
    /// an explicit `#[serde(rename_all)]`. This matches serde semantics:
    /// struct fields are typically `snake_case` needing conversion, while enum
    /// variants are `PascalCase` and serialized as-is by default.
    pub default_rename_all: Option<String>,
}

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
fn has_derive_serialize(attrs: &[syn::Attribute]) -> bool {
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

/// Map a Rust type name from `serde(into = "...")` to a TsType.
fn into_target_to_ts_type(target: &str) -> TsType {
    match target {
        "String" | "&str" | "std::string::String" => TsType::String,
        "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32" | "f64" | "usize"
        | "isize" => TsType::Number,
        "bool" => TsType::Boolean,
        other => TsType::Named(other.to_string()),
    }
}

/// Parse a Rust struct into a `TsInterface`.
fn parse_struct(item: &syn::ItemStruct, config: &TypeGenConfig) -> Option<TsTypeDef> {
    let name = item.ident.to_string();
    let container_attrs = SerdeContainerAttrs::from_attrs(&item.attrs);

    // serde(into) → type alias (e.g. `#[serde(into = "String")]` → `export type Foo = string;`)
    if let Some(ref target) = container_attrs.into {
        return Some(TsTypeDef::TypeAlias {
            name,
            target: into_target_to_ts_type(target),
        });
    }

    let named_fields = match &item.fields {
        syn::Fields::Named(named) => Some(named),
        syn::Fields::Unit => None, // Unit struct → empty interface
        _ => return None,          // Skip tuple structs
    };

    let mut ts_fields = Vec::new();
    for field in named_fields.iter().flat_map(|f| &f.named) {
        let field_attrs = SerdeFieldAttrs::from_attrs(&field.attrs);

        // Skip fields with #[serde(skip)] or #[serde(skip_serializing)]
        if field_attrs.skip {
            continue;
        }

        let rust_name = strip_raw_prefix(&field.ident.as_ref()?.to_string()).to_owned();

        // Determine the JSON field name:
        // 1. Explicit #[serde(rename = "...")] wins
        // 2. Otherwise apply container rename_all rule
        // 3. Otherwise use the Rust name as-is
        let ts_name = if let Some(ref rename) = field_attrs.rename {
            rename.clone()
        } else if let Some(rule) = container_attrs
            .rename_all
            .as_ref()
            .or(config.default_rename_all.as_ref())
        {
            apply_rename_rule(rule, &rust_name)
        } else {
            rust_name.clone()
        };

        // Determine type and optionality
        let (ts_type, optional) = if field_attrs.serialize_with.is_some() {
            // serialize_with → we can't know the output type; default to string
            let opt = field_attrs
                .skip_serializing_if
                .as_deref()
                .is_some_and(is_optional_skip);
            (TsType::String, opt)
        } else if let Some(inner) = unwrap_option_type(&field.ty, config) {
            // Option<T>
            if field_attrs
                .skip_serializing_if
                .as_deref()
                .is_some_and(is_optional_skip)
            {
                // Option<T> + skip_serializing_if → field?: T (unwrapped, optional)
                (inner, true)
            } else {
                // Option<T> without skip → field: T | null (present, nullable)
                (TsType::Nullable(Box::new(inner)), false)
            }
        } else if field_attrs
            .skip_serializing_if
            .as_deref()
            .is_some_and(is_optional_skip)
        {
            // Non-Option with skip_serializing_if → field?: T
            (resolve_type(&field.ty, config), true)
        } else {
            (resolve_type(&field.ty, config), false)
        };

        ts_fields.push(TsField {
            ts_name,
            ts_type,
            optional,
        });
    }

    Some(TsTypeDef::Interface(TsInterface {
        name,
        fields: ts_fields,
    }))
}

/// Parse a Rust enum into a `TsStringUnion` (all unit) or `TsTaggedUnion` (has data).
fn parse_enum(item: &syn::ItemEnum, config: &TypeGenConfig) -> Vec<TsTypeDef> {
    let name = item.ident.to_string();
    let container_attrs = SerdeContainerAttrs::from_attrs(&item.attrs);

    // serde(into) → type alias
    if let Some(ref target) = container_attrs.into {
        return vec![TsTypeDef::TypeAlias {
            name,
            target: into_target_to_ts_type(target),
        }];
    }

    // Check if all variants are unit (no data)
    let all_unit = item
        .variants
        .iter()
        .all(|v| matches!(v.fields, syn::Fields::Unit));

    if all_unit {
        // All-unit enum → string union
        // NOTE: Only the enum's own rename_all applies here, NOT config.default_rename_all.
        // Serde preserves PascalCase variant names by default; the global default is for
        // struct fields (snake_case → camelCase) and would incorrectly lowercase variants.
        let variants = item
            .variants
            .iter()
            .map(|v| {
                let variant_name = strip_raw_prefix(&v.ident.to_string()).to_owned();
                let variant_attrs = SerdeFieldAttrs::from_attrs(&v.attrs);
                if let Some(ref explicit) = variant_attrs.rename {
                    // Per-variant #[serde(rename = "...")] takes precedence.
                    explicit.clone()
                } else if let Some(rule) = container_attrs.rename_all.as_ref() {
                    apply_rename_rule(rule, &variant_name)
                } else {
                    variant_name
                }
            })
            .collect();

        return vec![TsTypeDef::StringUnion(TsStringUnion { name, variants })];
    }

    // Enum with data variants → tagged union
    let tag_style = if container_attrs.untagged {
        TagStyle::Untagged
    } else if let Some(ref tag) = container_attrs.tag {
        if let Some(ref content) = container_attrs.content {
            TagStyle::Adjacent {
                tag: tag.clone(),
                content: content.clone(),
            }
        } else {
            TagStyle::Internal { tag: tag.clone() }
        }
    } else {
        TagStyle::External
    };

    // Collect helper interfaces for struct variants
    let mut helper_defs = Vec::new();

    // NOTE: Only the enum's own rename_all applies to discriminants, NOT config.default_rename_all.
    let variants = item
        .variants
        .iter()
        .map(|v| {
            let variant_name = strip_raw_prefix(&v.ident.to_string()).to_owned();
            let variant_attrs = SerdeFieldAttrs::from_attrs(&v.attrs);
            let discriminant = if let Some(ref explicit) = variant_attrs.rename {
                // Variant-level #[serde(rename = "...")] takes precedence.
                explicit.clone()
            } else if let Some(rule) = container_attrs.rename_all.as_ref() {
                apply_rename_rule(rule, &variant_name)
            } else {
                variant_name
            };

            let data_type = match &v.fields {
                syn::Fields::Unit => TsType::Void,
                syn::Fields::Unnamed(fields) => {
                    if fields.unnamed.len() == 1 {
                        resolve_type(&fields.unnamed[0].ty, config)
                    } else {
                        // Multi-field tuple variant → TS tuple
                        let elems: Vec<TsType> = fields
                            .unnamed
                            .iter()
                            .map(|f| resolve_type(&f.ty, config))
                            .collect();
                        TsType::Tuple(elems)
                    }
                }
                syn::Fields::Named(fields) => {
                    // Struct variant — emit a helper interface for the payload.
                    // Field naming priority: field-level rename > variant rename_all > container rename_all > raw name.
                    let variant_rename_all = variant_attrs
                        .rename_all
                        .as_deref()
                        .or(container_attrs.rename_all.as_deref());
                    let helper_name = format!("{}_{}", name, discriminant);
                    let ts_fields: Vec<TsField> = fields
                        .named
                        .iter()
                        .filter_map(|f| {
                            let field_attrs = SerdeFieldAttrs::from_attrs(&f.attrs);
                            if field_attrs.skip {
                                return None;
                            }
                            let field_name =
                                strip_raw_prefix(&f.ident.as_ref().unwrap().to_string()).to_owned();
                            let ts_name = if let Some(ref explicit) = field_attrs.rename {
                                explicit.clone()
                            } else if let Some(rule) = variant_rename_all {
                                apply_rename_rule(rule, &field_name)
                            } else {
                                field_name
                            };
                            let (ts_type, optional) =
                                if let Some(inner) = unwrap_option_type(&f.ty, config) {
                                    (inner, true)
                                } else {
                                    (resolve_type(&f.ty, config), false)
                                };
                            Some(TsField {
                                ts_name,
                                ts_type,
                                optional,
                            })
                        })
                        .collect();
                    helper_defs.push(TsTypeDef::Interface(TsInterface {
                        name: helper_name.clone(),
                        fields: ts_fields,
                    }));
                    TsType::Named(helper_name)
                }
            };

            TsTaggedVariant {
                variant_name: discriminant,
                data_type,
            }
        })
        .collect();

    let mut result = helper_defs;
    result.push(TsTypeDef::TaggedUnion(TsTaggedUnion {
        name,
        tag_style,
        variants,
    }));
    result
}

/// Resolve a `syn::Type` to a `TsType`, checking the external_type_map first.
fn resolve_type(ty: &syn::Type, config: &TypeGenConfig) -> TsType {
    // 1. Check external_type_map by last segment name and full path
    if let syn::Type::Path(type_path) = ty {
        let full_path = path_to_string(&type_path.path);

        // Check full path first (e.g., "serde_json::Value")
        if let Some(mapped) = config.external_type_map.get(&full_path) {
            return mapped.clone();
        }

        // Check last segment name (e.g., "FiniteF64", "Value")
        if let Some(last) = type_path.path.segments.last() {
            let last_name = last.ident.to_string();
            if let Some(mapped) = config.external_type_map.get(&last_name) {
                return mapped.clone();
            }
        }
    }

    // 2. Unwrap transparent wrappers: Arc<T>, Box<T>
    if let syn::Type::Path(type_path) = ty
        && let Some(last) = type_path.path.segments.last()
    {
        let name = last.ident.to_string();
        if (name == "Arc" || name == "Box")
            && let syn::PathArguments::AngleBracketed(args) = &last.arguments
            && args.args.len() == 1
            && let syn::GenericArgument::Type(inner) = &args.args[0]
        {
            return resolve_type(inner, config);
        }
    }

    // 2b. Resolve container inner types through external_type_map:
    //     Vec<T> -> T[], Option<T> -> T | null, HashMap<K,V> -> Record<K,V>
    if let syn::Type::Path(type_path) = ty
        && let Some(last) = type_path.path.segments.last()
    {
        let name = last.ident.to_string();
        if let syn::PathArguments::AngleBracketed(args) = &last.arguments {
            match name.as_str() {
                "Vec" if args.args.len() == 1 => {
                    if let syn::GenericArgument::Type(inner) = &args.args[0] {
                        // Vec<u8> → Uint8Array (special case)
                        if let syn::Type::Path(p) = inner
                            && p.path.is_ident("u8")
                        {
                            return TsType::Uint8Array;
                        }
                        return TsType::Array(Box::new(resolve_type(inner, config)));
                    }
                }
                "Option" if args.args.len() == 1 => {
                    if let syn::GenericArgument::Type(inner) = &args.args[0] {
                        return TsType::Nullable(Box::new(resolve_type(inner, config)));
                    }
                }
                "HashMap" | "BTreeMap" if args.args.len() == 2 => {
                    let types: Vec<_> = args
                        .args
                        .iter()
                        .filter_map(|a| {
                            if let syn::GenericArgument::Type(t) = a {
                                Some(t)
                            } else {
                                None
                            }
                        })
                        .collect();
                    if types.len() == 2 {
                        return TsType::Record(
                            Box::new(resolve_type(types[0], config)),
                            Box::new(resolve_type(types[1], config)),
                        );
                    }
                }
                _ => {}
            }
        }
    }

    // 3. Fall through to standard mapping
    let mapped = rust_type_to_ts(ty, false);

    // 4. Strip module paths from Named types: "formula_types::CellValue" -> "CellValue"
    if let TsType::Named(ref name) = mapped
        && name.contains("::")
        && let Some(last) = name.rsplit("::").next()
    {
        return TsType::Named(last.to_string());
    }

    mapped
}

/// If the type is `Option<T>`, resolve the inner T. Otherwise return None.
fn unwrap_option_type(ty: &syn::Type, config: &TypeGenConfig) -> Option<TsType> {
    if let syn::Type::Path(type_path) = ty
        && let Some(last) = type_path.path.segments.last()
        && last.ident == "Option"
        && let syn::PathArguments::AngleBracketed(args) = &last.arguments
        && args.args.len() == 1
        && let syn::GenericArgument::Type(inner) = &args.args[0]
    {
        return Some(resolve_type(inner, config));
    }
    None
}

/// Convert a `syn::Path` to a string using `::` as separator.
fn path_to_string(path: &syn::Path) -> String {
    path.segments
        .iter()
        .map(|s| s.ident.to_string())
        .collect::<Vec<_>>()
        .join("::")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_config() -> TypeGenConfig {
        TypeGenConfig::default()
    }

    // -- Basic struct tests --

    #[test]
    fn parse_simple_struct() {
        let source = r#"
            use serde::Serialize;
            #[derive(Debug, Clone, Serialize)]
            pub struct Point {
                pub x: f64,
                pub y: f64,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.name, "Point");
                assert_eq!(iface.fields.len(), 2);
                assert_eq!(iface.fields[0].ts_name, "x");
                assert_eq!(iface.fields[0].ts_type, TsType::Number);
                assert!(!iface.fields[0].optional);
                assert_eq!(iface.fields[1].ts_name, "y");
                assert_eq!(iface.fields[1].ts_type, TsType::Number);
                assert!(!iface.fields[1].optional);
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_unit_struct() {
        let source = r#"
            use serde::Serialize;
            #[derive(Debug, Clone, Serialize)]
            pub struct GrayscaleEffect;
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.name, "GrayscaleEffect");
                assert_eq!(iface.fields.len(), 0);
            }
            _ => panic!("Expected Interface for unit struct"),
        }
    }

    #[test]
    fn parse_multiple_unit_structs() {
        let source = r#"
            use serde::Serialize;
            #[derive(Debug, Clone, Serialize)]
            pub struct AlphaCeilingEffect;
            #[derive(Debug, Clone, Serialize)]
            pub struct AlphaFloorEffect;
            #[derive(Debug, Clone, Serialize)]
            pub struct GrayscaleEffect;
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 3);
        let names: Vec<&str> = defs.iter().map(|d| d.name()).collect();
        assert_eq!(
            names,
            vec!["AlphaCeilingEffect", "AlphaFloorEffect", "GrayscaleEffect"]
        );
    }

    // -- camelCase rename_all --

    #[test]
    fn parse_struct_rename_all_camel_case() {
        let source = r#"
            use serde::Serialize;
            #[derive(Debug, Clone, Serialize)]
            #[serde(rename_all = "camelCase")]
            pub struct ColWidth {
                pub col: u32,
                pub width: f64,
                #[serde(skip_serializing_if = "std::ops::Not::not")]
                pub custom_width: bool,
                #[serde(skip_serializing_if = "std::ops::Not::not")]
                pub hidden: bool,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.name, "ColWidth");
                assert_eq!(iface.fields.len(), 4);

                assert_eq!(iface.fields[0].ts_name, "col");
                assert_eq!(iface.fields[0].ts_type, TsType::Number);
                assert!(!iface.fields[0].optional);

                assert_eq!(iface.fields[1].ts_name, "width");
                assert_eq!(iface.fields[1].ts_type, TsType::Number);
                assert!(!iface.fields[1].optional);

                assert_eq!(iface.fields[2].ts_name, "customWidth");
                assert_eq!(iface.fields[2].ts_type, TsType::Boolean);
                assert!(iface.fields[2].optional);

                assert_eq!(iface.fields[3].ts_name, "hidden");
                assert_eq!(iface.fields[3].ts_type, TsType::Boolean);
                assert!(iface.fields[3].optional);
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Field rename --

    #[test]
    fn parse_struct_field_rename() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            pub struct FullCellData {
                pub row: u32,
                #[serde(rename = "type")]
                pub cell_type: u8,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields.len(), 2);
                assert_eq!(iface.fields[0].ts_name, "row");
                // Explicit rename overrides rename_all
                assert_eq!(iface.fields[1].ts_name, "type");
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Optional fields --

    #[test]
    fn parse_optional_with_skip() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                #[serde(skip_serializing_if = "Option::is_none")]
                pub label: Option<String>,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "label");
                // Option<String> + skip -> field?: string (unwrapped, optional)
                assert_eq!(iface.fields[0].ts_type, TsType::String);
                assert!(iface.fields[0].optional);
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_optional_without_skip() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub label: Option<String>,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "label");
                // Option<String> without skip -> field: string | null (present, nullable)
                assert_eq!(
                    iface.fields[0].ts_type,
                    TsType::Nullable(Box::new(TsType::String))
                );
                assert!(!iface.fields[0].optional);
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_vec_with_skip() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                #[serde(skip_serializing_if = "Vec::is_empty")]
                pub items: Vec<u32>,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "items");
                // Vec<u32> + skip_serializing_if -> field?: number[] (optional)
                assert_eq!(
                    iface.fields[0].ts_type,
                    TsType::Array(Box::new(TsType::Number))
                );
                assert!(iface.fields[0].optional);
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Unit enum --

    #[test]
    fn parse_unit_enum_lowercase() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(rename_all = "lowercase")]
            pub enum Axis { Row, Col }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::StringUnion(su) => {
                assert_eq!(su.name, "Axis");
                assert_eq!(su.variants, vec!["row", "col"]);
            }
            _ => panic!("Expected StringUnion"),
        }
    }

    #[test]
    fn parse_unit_enum_no_rename() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub enum Direction { Up, Down, Left, Right }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::StringUnion(su) => {
                assert_eq!(su.name, "Direction");
                assert_eq!(su.variants, vec!["Up", "Down", "Left", "Right"]);
            }
            _ => panic!("Expected StringUnion"),
        }
    }

    #[test]
    fn parse_unit_enum_per_variant_rename() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub enum ShadowAlignment {
                #[serde(rename = "tl")]
                TopLeft,
                #[serde(rename = "t")]
                Top,
                #[serde(rename = "br")]
                BottomRight,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::StringUnion(su) => {
                assert_eq!(su.name, "ShadowAlignment");
                assert_eq!(su.variants, vec!["tl", "t", "br"]);
            }
            _ => panic!("Expected StringUnion"),
        }
    }

    #[test]
    fn parse_unit_enum_per_variant_rename_with_rename_all() {
        // Per-variant rename takes precedence over rename_all
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            pub enum Mixed {
                #[serde(rename = "custom_one")]
                FirstVariant,
                SecondVariant,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::StringUnion(su) => {
                assert_eq!(su.name, "Mixed");
                // FirstVariant has explicit rename → "custom_one" (not camelCase)
                // SecondVariant has no rename → rename_all applies → "secondVariant"
                assert_eq!(su.variants, vec!["custom_one", "secondVariant"]);
            }
            _ => panic!("Expected StringUnion"),
        }
    }

    // -- Adjacently tagged enum --

    #[test]
    fn parse_adjacent_tagged_enum() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(tag = "type", content = "value")]
            pub enum CellValue {
                Number(f64),
                Text(String),
                Boolean(bool),
                Null,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                assert_eq!(tu.name, "CellValue");
                match &tu.tag_style {
                    TagStyle::Adjacent { tag, content } => {
                        assert_eq!(tag, "type");
                        assert_eq!(content, "value");
                    }
                    _ => panic!("Expected Adjacent tag style"),
                }
                assert_eq!(tu.variants.len(), 4);

                assert_eq!(tu.variants[0].variant_name, "Number");
                assert_eq!(tu.variants[0].data_type, TsType::Number);

                assert_eq!(tu.variants[1].variant_name, "Text");
                assert_eq!(tu.variants[1].data_type, TsType::String);

                assert_eq!(tu.variants[2].variant_name, "Boolean");
                assert_eq!(tu.variants[2].data_type, TsType::Boolean);

                assert_eq!(tu.variants[3].variant_name, "Null");
                assert_eq!(tu.variants[3].data_type, TsType::Void);
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    // -- Externally tagged enum --

    #[test]
    fn parse_external_tagged_enum() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub enum Shape {
                Circle(CircleData),
                Rect(RectData),
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                assert_eq!(tu.name, "Shape");
                assert!(matches!(tu.tag_style, TagStyle::External));
                assert_eq!(tu.variants.len(), 2);

                assert_eq!(tu.variants[0].variant_name, "Circle");
                assert_eq!(tu.variants[0].data_type, TsType::Named("CircleData".into()));

                assert_eq!(tu.variants[1].variant_name, "Rect");
                assert_eq!(tu.variants[1].data_type, TsType::Named("RectData".into()));
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    // -- Internally tagged enum --

    #[test]
    fn parse_internal_tagged_enum() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(tag = "kind")]
            pub enum Event {
                Click(ClickData),
                Resize(ResizeData),
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                assert_eq!(tu.name, "Event");
                match &tu.tag_style {
                    TagStyle::Internal { tag } => assert_eq!(tag, "kind"),
                    _ => panic!("Expected Internal tag style"),
                }
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    // -- Untagged enum --

    #[test]
    fn parse_untagged_enum() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(untagged)]
            pub enum NumberOrString {
                Num(f64),
                Str(String),
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                assert_eq!(tu.name, "NumberOrString");
                assert!(matches!(tu.tag_style, TagStyle::Untagged));
                assert_eq!(tu.variants[0].data_type, TsType::Number);
                assert_eq!(tu.variants[1].data_type, TsType::String);
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    // -- Skip non-serialize items --

    #[test]
    fn skip_items_without_derive_serialize() {
        let source = r#"
            pub struct NoDerive { pub x: u32 }
            #[derive(Debug, Clone)]
            pub struct NoSerialize { pub x: u32 }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert!(defs.is_empty());
    }

    #[test]
    fn skip_impl_blocks_and_use_statements() {
        let source = r#"
            use serde::Serialize;
            use std::collections::HashMap;

            impl Foo {
                fn bar() {}
            }

            #[derive(Serialize)]
            pub struct Baz {
                pub x: u32,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].name(), "Baz");
    }

    // -- External type map --

    #[test]
    fn external_type_map_overrides() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub data: Value,
                pub score: FiniteF64,
            }
        "#;
        let mut map = HashMap::new();
        map.insert("Value".to_string(), TsType::Named("unknown".into()));
        map.insert("FiniteF64".to_string(), TsType::Number);
        let config = TypeGenConfig {
            external_type_map: map,
            ..Default::default()
        };
        let defs = parse_types(source, &config).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "data");
                assert_eq!(iface.fields[0].ts_type, TsType::Named("unknown".into()));
                assert_eq!(iface.fields[1].ts_name, "score");
                assert_eq!(iface.fields[1].ts_type, TsType::Number);
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- serialize_with --

    #[test]
    fn parse_serialize_with_maps_to_string() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct FontOutput {
                #[serde(serialize_with = "serde_ooxml_output::underline_style::serialize")]
                pub underline: UnderlineStyle,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "underline");
                assert_eq!(iface.fields[0].ts_type, TsType::String);
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Skip field --

    #[test]
    fn parse_skip_field_excluded() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub visible: u32,
                #[serde(skip)]
                pub hidden: u32,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields.len(), 1);
                assert_eq!(iface.fields[0].ts_name, "visible");
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_skip_serializing_field_excluded() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub visible: u32,
                #[serde(skip_serializing)]
                pub hidden: u32,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields.len(), 1);
                assert_eq!(iface.fields[0].ts_name, "visible");
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_flatten_field_preserved() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub visible: u32,
                #[serde(flatten)]
                pub extra: Value,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                // Flatten fields are preserved (flatten attribute is parsed but
                // not used for skipping — available for future inlining support)
                assert_eq!(iface.fields.len(), 2);
                assert_eq!(iface.fields[0].ts_name, "visible");
                assert_eq!(iface.fields[1].ts_name, "extra");
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Complex types --

    #[test]
    fn parse_struct_with_vec_and_hashmap() {
        let source = r#"
            use serde::Serialize;
            use std::collections::HashMap;
            #[derive(Serialize)]
            pub struct Report {
                pub items: Vec<String>,
                pub metadata: HashMap<String, u32>,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "items");
                assert_eq!(
                    iface.fields[0].ts_type,
                    TsType::Array(Box::new(TsType::String))
                );
                assert_eq!(iface.fields[1].ts_name, "metadata");
                assert_eq!(
                    iface.fields[1].ts_type,
                    TsType::Record(Box::new(TsType::String), Box::new(TsType::Number))
                );
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_struct_with_nested_named_types() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Wrapper {
                pub point: Point,
                pub children: Vec<Widget>,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_type, TsType::Named("Point".into()));
                assert_eq!(
                    iface.fields[1].ts_type,
                    TsType::Array(Box::new(TsType::Named("Widget".into())))
                );
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Arc/Box unwrapping --

    #[test]
    fn parse_arc_and_box_unwrap() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub boxed: Box<String>,
                pub shared: Arc<u32>,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_type, TsType::String);
                assert_eq!(iface.fields[1].ts_type, TsType::Number);
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Module-qualified types --

    #[test]
    fn parse_module_qualified_type_strips_path() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub value: formula_types::CellValue,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                // Should strip module path to just "CellValue"
                assert_eq!(iface.fields[0].ts_type, TsType::Named("CellValue".into()));
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Multiple items in one file --

    #[test]
    fn parse_multiple_types() {
        let source = r#"
            use serde::Serialize;

            #[derive(Serialize)]
            pub struct Point { pub x: f64, pub y: f64 }

            #[derive(Serialize)]
            #[serde(rename_all = "lowercase")]
            pub enum Axis { Row, Col }

            pub struct NotSerialized { pub z: f64 }

            #[derive(Serialize)]
            #[serde(tag = "type", content = "value")]
            pub enum Value {
                Num(f64),
                Str(String),
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 3);
        assert_eq!(defs[0].name(), "Point");
        assert_eq!(defs[1].name(), "Axis");
        assert_eq!(defs[2].name(), "Value");
    }

    // -- Enum with rename_all on data variants --

    #[test]
    fn parse_tagged_enum_with_rename_all() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(tag = "t", content = "v", rename_all = "camelCase")]
            pub enum MyEvent {
                UserClick(ClickData),
                PageLoad(LoadData),
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                // PascalCase variant names -> camelCase
                assert_eq!(tu.variants[0].variant_name, "userClick");
                assert_eq!(tu.variants[1].variant_name, "pageLoad");
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    // -- Variant-level serde(rename) --

    #[test]
    fn parse_tagged_enum_with_variant_rename() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(tag = "type")]
            pub enum Source {
                #[serde(rename = "table")]
                Table { id: String },
                #[serde(rename = "pivot")]
                Pivot { id: String },
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        let union = defs.iter().find(|d| d.name() == "Source");
        match union {
            Some(TsTypeDef::TaggedUnion(tu)) => {
                assert_eq!(tu.variants[0].variant_name, "table");
                assert_eq!(tu.variants[1].variant_name, "pivot");
            }
            _ => panic!("Expected TaggedUnion for Source"),
        }
    }

    // -- Variant-level serde(rename_all) for struct variant fields --

    #[test]
    fn parse_tagged_enum_with_variant_rename_all() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(tag = "type")]
            pub enum Source {
                #[serde(rename = "table", rename_all = "camelCase")]
                Table {
                    table_id: String,
                    column_cell_id: String,
                },
                #[serde(rename = "pivot", rename_all = "camelCase")]
                Pivot {
                    pivot_id: String,
                    field_name: String,
                },
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        // Should produce helper interfaces + tagged union
        // Helper interfaces: Source_table, Source_pivot (using renamed discriminant)
        assert!(
            defs.len() >= 3,
            "Expected helper interfaces + union, got {}",
            defs.len()
        );

        // Find the helper interfaces
        let table_iface = defs.iter().find(|d| d.name() == "Source_table");
        assert!(
            table_iface.is_some(),
            "Expected Source_table helper interface"
        );
        if let Some(TsTypeDef::Interface(iface)) = table_iface {
            assert_eq!(iface.fields[0].ts_name, "tableId");
            assert_eq!(iface.fields[1].ts_name, "columnCellId");
        }

        let pivot_iface = defs.iter().find(|d| d.name() == "Source_pivot");
        assert!(
            pivot_iface.is_some(),
            "Expected Source_pivot helper interface"
        );
        if let Some(TsTypeDef::Interface(iface)) = pivot_iface {
            assert_eq!(iface.fields[0].ts_name, "pivotId");
            assert_eq!(iface.fields[1].ts_name, "fieldName");
        }

        // Check discriminant values
        let union = defs.iter().find(|d| d.name() == "Source");
        if let Some(TsTypeDef::TaggedUnion(tu)) = union {
            assert_eq!(tu.variants[0].variant_name, "table");
            assert_eq!(tu.variants[1].variant_name, "pivot");
        } else {
            panic!("Expected TaggedUnion for Source");
        }
    }

    // -- has_derive_serialize edge cases --

    #[test]
    fn derive_serialize_among_many() {
        let source = r#"
            use serde::Serialize;
            #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
            pub struct Foo { pub x: u32 }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
    }

    #[test]
    fn derive_serialize_alone() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo { pub x: u32 }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
    }

    // -- TsTypeDef::name() --

    #[test]
    fn ts_type_def_name_interface() {
        let def = TsTypeDef::Interface(TsInterface {
            name: "Foo".into(),
            fields: vec![],
        });
        assert_eq!(def.name(), "Foo");
    }

    #[test]
    fn ts_type_def_name_string_union() {
        let def = TsTypeDef::StringUnion(TsStringUnion {
            name: "Bar".into(),
            variants: vec![],
        });
        assert_eq!(def.name(), "Bar");
    }

    #[test]
    fn ts_type_def_name_tagged_union() {
        let def = TsTypeDef::TaggedUnion(TsTaggedUnion {
            name: "Baz".into(),
            tag_style: TagStyle::External,
            variants: vec![],
        });
        assert_eq!(def.name(), "Baz");
    }

    // -- External type map with full path --

    #[test]
    fn external_type_map_full_path() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct Foo {
                pub data: serde_json::Value,
            }
        "#;
        let mut map = HashMap::new();
        map.insert(
            "serde_json::Value".to_string(),
            TsType::Named("unknown".into()),
        );
        let config = TypeGenConfig {
            external_type_map: map,
            ..Default::default()
        };
        let defs = parse_types(source, &config).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_type, TsType::Named("unknown".into()));
            }
            _ => panic!("Expected Interface"),
        }
    }

    // -- Tuple variant with multiple fields --

    #[test]
    fn parse_enum_multi_field_tuple_variant() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub enum Pair {
                Two(u32, u32),
                One(u32),
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                assert_eq!(
                    tu.variants[0].data_type,
                    TsType::Tuple(vec![TsType::Number, TsType::Number])
                );
                assert_eq!(tu.variants[1].data_type, TsType::Number);
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    // -- Mixed unit and data variants --

    #[test]
    fn parse_enum_mixed_unit_and_data() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub enum MaybeNumber {
                Some(f64),
                None,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        // Has data variant, so it should be TaggedUnion (not StringUnion)
        match &defs[0] {
            TsTypeDef::TaggedUnion(tu) => {
                assert_eq!(tu.variants[0].variant_name, "Some");
                assert_eq!(tu.variants[0].data_type, TsType::Number);
                assert_eq!(tu.variants[1].variant_name, "None");
                assert_eq!(tu.variants[1].data_type, TsType::Void);
            }
            _ => panic!("Expected TaggedUnion"),
        }
    }

    #[test]
    fn parse_struct_with_serde_into_string() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(into = "String", try_from = "String")]
            pub struct SheetId {
                inner: u128,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::TypeAlias { name, target } => {
                assert_eq!(name, "SheetId");
                assert_eq!(*target, TsType::String);
            }
            _ => panic!("Expected TypeAlias, got {:?}", defs[0]),
        }
    }

    #[test]
    fn parse_enum_with_serde_into_string() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(into = "String")]
            pub enum Color {
                Red,
                Blue,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        assert_eq!(defs.len(), 1);
        match &defs[0] {
            TsTypeDef::TypeAlias { name, target } => {
                assert_eq!(name, "Color");
                assert_eq!(*target, TsType::String);
            }
            _ => panic!("Expected TypeAlias, got {:?}", defs[0]),
        }
    }

    // -- default_rename_all --

    #[test]
    fn default_rename_all_applies_when_no_explicit_rename() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct MyStruct {
                pub foo_bar: u32,
                pub baz_qux: String,
            }
        "#;
        let config = TypeGenConfig {
            default_rename_all: Some("camelCase".to_string()),
            ..Default::default()
        };
        let defs = parse_types(source, &config).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "fooBar");
                assert_eq!(iface.fields[1].ts_name, "bazQux");
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn explicit_rename_all_overrides_default() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(rename_all = "snake_case")]
            pub struct MyStruct {
                pub FooBar: u32,
            }
        "#;
        let config = TypeGenConfig {
            default_rename_all: Some("camelCase".to_string()),
            ..Default::default()
        };
        let defs = parse_types(source, &config).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                // Explicit snake_case should win over default camelCase
                assert_eq!(iface.fields[0].ts_name, "foo_bar");
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn default_rename_all_does_not_apply_to_enum_variants() {
        // default_rename_all is for struct fields only — enum variants preserve
        // their original casing (matching serde's default behavior).
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub enum Status {
                InProgress,
                NotStarted,
            }
        "#;
        let config = TypeGenConfig {
            default_rename_all: Some("camelCase".to_string()),
            ..Default::default()
        };
        let defs = parse_types(source, &config).unwrap();
        match &defs[0] {
            TsTypeDef::StringUnion(su) => {
                // Variants keep PascalCase — serde serializes as "InProgress", "NotStarted"
                assert_eq!(su.variants, vec!["InProgress", "NotStarted"]);
            }
            _ => panic!("Expected StringUnion"),
        }
    }

    #[test]
    fn no_default_rename_all_preserves_original_names() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            pub struct MyStruct {
                pub foo_bar: u32,
            }
        "#;
        let config = TypeGenConfig::default();
        let defs = parse_types(source, &config).unwrap();
        match &defs[0] {
            TsTypeDef::Interface(iface) => {
                assert_eq!(iface.fields[0].ts_name, "foo_bar");
            }
            _ => panic!("Expected Interface"),
        }
    }

    #[test]
    fn parse_struct_with_serde_into_number() {
        let source = r#"
            use serde::Serialize;
            #[derive(Serialize)]
            #[serde(into = "f64")]
            pub struct Score {
                inner: f64,
            }
        "#;
        let defs = parse_types(source, &default_config()).unwrap();
        match &defs[0] {
            TsTypeDef::TypeAlias { name, target } => {
                assert_eq!(name, "Score");
                assert_eq!(*target, TsType::Number);
            }
            _ => panic!("Expected TypeAlias"),
        }
    }
}
