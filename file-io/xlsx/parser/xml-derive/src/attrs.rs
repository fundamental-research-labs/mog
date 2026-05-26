//! Attribute parsing for `#[xml(...)]` annotations.
//!
//! Parses struct-level, field-level, and enum variant-level attributes into
//! typed configuration structs used by the XmlRead, XmlWrite, and XmlEnum derives.

use proc_macro2::Span;
use syn::{Attribute, Meta, Token};

// ============================================================================
// Struct-level attributes: #[xml(tag = "name", ns = "prefix")]
// ============================================================================

#[derive(Debug, Clone)]
pub struct StructAttrs {
    /// XML element tag name (required)
    pub tag: String,
    /// Namespace prefix (optional, e.g., "c", "a", "x14")
    pub ns: Option<String>,
    /// Override for the xml infra module path
    pub xml_mod: Option<syn::Path>,
    /// Override for the scanner infra module path
    pub scanner_mod: Option<syn::Path>,
    /// Override for the XmlWriter type path
    pub writer_type: Option<syn::Path>,
}

impl StructAttrs {
    pub fn from_attrs(attrs: &[Attribute]) -> syn::Result<Self> {
        let mut tag = None;
        let mut ns = None;
        let mut xml_mod = None;
        let mut scanner_mod = None;
        let mut writer_type = None;

        for attr in attrs {
            if !attr.path().is_ident("xml") {
                continue;
            }
            attr.parse_nested_meta(|meta| {
                if meta.path.is_ident("tag") {
                    let _eq: Token![=] = meta.input.parse()?;
                    let lit: syn::LitStr = meta.input.parse()?;
                    tag = Some(lit.value());
                } else if meta.path.is_ident("ns") {
                    let _eq: Token![=] = meta.input.parse()?;
                    let lit: syn::LitStr = meta.input.parse()?;
                    ns = Some(lit.value());
                } else if meta.path.is_ident("xml_mod") {
                    let _eq: Token![=] = meta.input.parse()?;
                    let lit: syn::LitStr = meta.input.parse()?;
                    xml_mod = Some(lit.parse()?);
                } else if meta.path.is_ident("scanner_mod") {
                    let _eq: Token![=] = meta.input.parse()?;
                    let lit: syn::LitStr = meta.input.parse()?;
                    scanner_mod = Some(lit.parse()?);
                } else if meta.path.is_ident("writer_type") {
                    let _eq: Token![=] = meta.input.parse()?;
                    let lit: syn::LitStr = meta.input.parse()?;
                    writer_type = Some(lit.parse()?);
                } else {
                    return Err(meta.error("unknown struct-level xml attribute"));
                }
                Ok(())
            })?;
        }

        let tag = tag.ok_or_else(|| {
            syn::Error::new(Span::call_site(), "missing required #[xml(tag = \"...\")]")
        })?;

        Ok(StructAttrs {
            tag,
            ns,
            xml_mod,
            scanner_mod,
            writer_type,
        })
    }

    /// Get the xml infra module path, falling back to default.
    pub fn xml_mod_path(&self) -> syn::Path {
        self.xml_mod
            .clone()
            .unwrap_or_else(|| syn::parse_str("crate::infra::xml").unwrap())
    }

    /// Get the scanner module path, falling back to default.
    pub fn scanner_mod_path(&self) -> syn::Path {
        self.scanner_mod
            .clone()
            .unwrap_or_else(|| syn::parse_str("crate::infra::scanner").unwrap())
    }

    /// Get the XmlWriter type path, falling back to default.
    pub fn writer_type_path(&self) -> syn::Path {
        self.writer_type
            .clone()
            .unwrap_or_else(|| syn::parse_str("crate::write::xml_writer::XmlWriter").unwrap())
    }
}

// ============================================================================
// Field-level attributes: #[xml(attr = "name", bool, ...)]
// ============================================================================

#[derive(Debug, Clone)]
pub enum FieldKind {
    /// XML attribute: `#[xml(attr = "name")]`
    Attr {
        name: String,
        value_type: AttrValueType,
        /// For bool: invert write semantics
        invert: bool,
        /// For enum: default variant name (for missing attr)
        default_variant: Option<String>,
        /// For enum: skip writing if value == default
        skip_default: bool,
    },
    /// Child element with text content: `#[xml(child = "tag", text)]`
    ChildText { tag: String },
    /// Single child struct: `#[xml(child_struct = "tag")]`
    ChildStruct { tag: String },
    /// Vec of child structs: `#[xml(child_list = "tag")]`
    ChildList { tag: String },
    /// Preserve unknown attributes for round-trip: `#[xml(preserve_attrs)]`
    PreserveAttrs,
    /// Opaque element passthrough: `#[xml(preserve_raw = "tag")]`
    PreserveRaw { tag: String },
    /// Auto-count attribute: `#[xml(attr = "count", num, auto_count = "field")]`
    AutoCount {
        attr_name: String,
        field_name: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AttrValueType {
    /// String (`String` or `Option<String>`)
    String,
    /// Boolean (`bool`)
    Bool,
    /// Enum (uses from_bytes/as_str)
    Enum,
    /// u32
    U32,
    /// u8
    U8,
    /// i32
    I32,
    /// f64
    F64,
}

#[derive(Debug, Clone)]
pub struct FieldAttrs {
    pub kind: FieldKind,
    /// Whether the field type is Option<T>
    pub is_optional: bool,
}

impl FieldAttrs {
    pub fn from_field(field: &syn::Field) -> syn::Result<Option<Self>> {
        let xml_attr = field.attrs.iter().find(|a| a.path().is_ident("xml"));
        let xml_attr = match xml_attr {
            Some(a) => a,
            None => return Ok(None),
        };

        let is_optional = is_option_type(&field.ty);

        let mut attr_name: Option<String> = None;
        let mut child_tag: Option<String> = None;
        let mut child_struct_tag: Option<String> = None;
        let mut child_list_tag: Option<String> = None;
        let mut preserve_raw_tag: Option<String> = None;
        let mut is_preserve_attrs = false;
        let mut is_text = false;
        let mut is_bool = false;
        let mut is_enum = false;
        let mut is_num = false;
        let mut invert = false;
        let mut default_variant: Option<String> = None;
        let mut skip_default = false;
        let mut auto_count_field: Option<String> = None;

        xml_attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("attr") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                attr_name = Some(lit.value());
            } else if meta.path.is_ident("child") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                child_tag = Some(lit.value());
            } else if meta.path.is_ident("child_struct") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                child_struct_tag = Some(lit.value());
            } else if meta.path.is_ident("child_list") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                child_list_tag = Some(lit.value());
            } else if meta.path.is_ident("preserve_attrs") {
                is_preserve_attrs = true;
            } else if meta.path.is_ident("preserve_raw") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                preserve_raw_tag = Some(lit.value());
            } else if meta.path.is_ident("text") {
                is_text = true;
            } else if meta.path.is_ident("bool") {
                is_bool = true;
            } else if meta.path.is_ident("num") {
                is_num = true;
            } else if meta.path.is_ident("enum") {
                is_enum = true;
            } else if meta.path.is_ident("invert") {
                invert = true;
            } else if meta.path.is_ident("default") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                default_variant = Some(lit.value());
            } else if meta.path.is_ident("skip_default") {
                skip_default = true;
            } else if meta.path.is_ident("auto_count") {
                let _eq: Token![=] = meta.input.parse()?;
                let lit: syn::LitStr = meta.input.parse()?;
                auto_count_field = Some(lit.value());
            } else {
                return Err(meta.error("unknown xml field attribute"));
            }
            Ok(())
        })?;

        // Determine the field kind
        let kind = if is_preserve_attrs {
            FieldKind::PreserveAttrs
        } else if let Some(tag) = preserve_raw_tag {
            FieldKind::PreserveRaw { tag }
        } else if let Some(tag) = child_list_tag {
            FieldKind::ChildList { tag }
        } else if let Some(tag) = child_struct_tag {
            FieldKind::ChildStruct { tag }
        } else if let Some(tag) = child_tag {
            if !is_text {
                return Err(syn::Error::new_spanned(
                    xml_attr,
                    "child element requires `text` attribute (e.g., #[xml(child = \"tag\", text)])",
                ));
            }
            FieldKind::ChildText { tag }
        } else if let Some(name) = attr_name {
            if let Some(count_field) = auto_count_field {
                FieldKind::AutoCount {
                    attr_name: name,
                    field_name: count_field,
                }
            } else {
                let value_type = if is_bool {
                    AttrValueType::Bool
                } else if is_enum {
                    AttrValueType::Enum
                } else if is_num {
                    // Determine numeric type from the Rust field type
                    determine_num_type(&field.ty)
                } else {
                    AttrValueType::String
                };

                FieldKind::Attr {
                    name,
                    value_type,
                    invert,
                    default_variant,
                    skip_default,
                }
            }
        } else {
            return Err(syn::Error::new_spanned(
                xml_attr,
                "field must have one of: attr, child, child_struct, child_list, preserve_attrs, preserve_raw",
            ));
        };

        Ok(Some(FieldAttrs { kind, is_optional }))
    }
}

// ============================================================================
// Enum variant attributes: #[xml("value", alias = "alt")]
// ============================================================================

#[derive(Debug, Clone)]
pub struct VariantAttrs {
    /// Primary XML string value
    pub value: String,
    /// Additional alias strings that map to this variant on parse
    pub aliases: Vec<String>,
}

impl VariantAttrs {
    pub fn from_variant(variant: &syn::Variant) -> syn::Result<Option<Self>> {
        let xml_attr = variant.attrs.iter().find(|a| a.path().is_ident("xml"));
        let xml_attr = match xml_attr {
            Some(a) => a,
            None => return Ok(None),
        };

        let mut value: Option<String> = None;
        let mut aliases: Vec<String> = Vec::new();

        // Parse #[xml("value", alias = "alt1", alias = "alt2")]
        xml_attr
            .parse_nested_meta(|meta| {
                if meta.path.is_ident("alias") {
                    let _eq: Token![=] = meta.input.parse()?;
                    let lit: syn::LitStr = meta.input.parse()?;
                    aliases.push(lit.value());
                } else {
                    // The first unnamed string literal is the value
                    // Since parse_nested_meta doesn't handle positional args well,
                    // we need to handle this differently
                    return Err(meta.error("unexpected attribute"));
                }
                Ok(())
            })
            .unwrap_or(());

        // Try parsing as a list with the primary value first
        // #[xml("value")] or #[xml("value", alias = "alt")]
        if value.is_none() {
            // Re-parse to get the primary value
            let meta = &xml_attr.meta;
            if let Meta::List(list) = meta {
                let tokens = list.tokens.clone();
                let parsed: syn::Result<XmlEnumAttrTokens> = syn::parse2(tokens);
                if let Ok(parsed) = parsed {
                    value = Some(parsed.value);
                    aliases = parsed.aliases;
                }
            }
        }

        match value {
            Some(v) => Ok(Some(VariantAttrs { value: v, aliases })),
            None => Ok(None),
        }
    }
}

/// Helper to parse `"value", alias = "alt1", alias = "alt2"` token stream
struct XmlEnumAttrTokens {
    value: String,
    aliases: Vec<String>,
}

impl syn::parse::Parse for XmlEnumAttrTokens {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let lit: syn::LitStr = input.parse()?;
        let value = lit.value();
        let mut aliases = Vec::new();

        while input.peek(Token![,]) {
            let _comma: Token![,] = input.parse()?;
            if input.is_empty() {
                break;
            }
            let ident: syn::Ident = input.parse()?;
            if ident != "alias" {
                return Err(syn::Error::new(ident.span(), "expected `alias`"));
            }
            let _eq: Token![=] = input.parse()?;
            let alias_lit: syn::LitStr = input.parse()?;
            aliases.push(alias_lit.value());
        }

        Ok(XmlEnumAttrTokens { value, aliases })
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Check if a type is `Option<T>`
pub fn is_option_type(ty: &syn::Type) -> bool {
    if let syn::Type::Path(ref p) = ty {
        if let Some(seg) = p.path.segments.last() {
            return seg.ident == "Option";
        }
    }
    false
}

/// Extract the inner type from `Option<T>`
pub fn extract_option_inner(ty: &syn::Type) -> Option<&syn::Type> {
    if let syn::Type::Path(ref p) = ty {
        if let Some(seg) = p.path.segments.last() {
            if seg.ident == "Option" {
                if let syn::PathArguments::AngleBracketed(ref args) = seg.arguments {
                    if let Some(syn::GenericArgument::Type(inner)) = args.args.first() {
                        return Some(inner);
                    }
                }
            }
        }
    }
    None
}

/// Determine numeric AttrValueType from a Rust type
fn determine_num_type(ty: &syn::Type) -> AttrValueType {
    let ty = if is_option_type(ty) {
        extract_option_inner(ty).unwrap_or(ty)
    } else {
        ty
    };

    if let syn::Type::Path(ref p) = ty {
        if let Some(seg) = p.path.segments.last() {
            return match seg.ident.to_string().as_str() {
                "u32" => AttrValueType::U32,
                "u8" => AttrValueType::U8,
                "i32" => AttrValueType::I32,
                "f64" => AttrValueType::F64,
                _ => AttrValueType::U32, // default numeric type
            };
        }
    }
    AttrValueType::U32
}
