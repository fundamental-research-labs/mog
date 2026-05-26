//! Code generation for PyO3 Python bindings.
//!
//! Converts a `PyO3Descriptor` (parsed from descriptor tokens) into a
//! `TokenStream` containing `#[pyclass]`, `#[pymethods]`, and `#[pyfunction]`
//! code.
//!
//! This is the PyO3 equivalent of `bridge-napi/macros/src/expand.rs`.
//! Key differences from NAPI:
//! - No registry mode (class-only)
//! - No async support (sync only)
//! - `PyResult<T>` instead of `napi::Result<T>`
//! - `PyErr::new::<PyRuntimeError, _>(msg)` instead of `napi::Error::from_reason`
//! - `Vec<u8>` for bytes (PyO3 auto-converts to/from Python bytes)
//! - `(Vec<u8>, String)` tuples returned as Python tuples (no packing)

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{Token, braced};

// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) struct PyO3Descriptor {
    pub type_name: String,
    pub fn_prefix: Option<String>,
    /// Parsed from descriptor DSL but not used in free-function mode.
    /// Retained for parity with bridge-napi and potential future use.
    #[allow(dead_code)]
    pub service: Option<PyO3ServiceMeta>,
    pub methods: Vec<PyO3Method>,
}

#[derive(Debug)]
pub(crate) struct PyO3ServiceMeta {
    /// Parsed from descriptor DSL for parity with bridge-napi.
    #[allow(dead_code)]
    pub key_param: String,
}

#[derive(Debug)]
pub(crate) struct PyO3Method {
    pub access: PyO3Access,
    pub name: String,
    pub params: Vec<PyO3Param>,
    pub return_type: Option<ReturnInfo>,
    #[allow(dead_code)]
    pub error_type: Option<String>,
    pub is_fallible: bool,
    /// Parsed from descriptor DSL but not used — PyO3 bindings are sync-only.
    #[allow(dead_code)]
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PyO3Access {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

#[derive(Debug, Clone)]
pub(crate) struct PyO3Param {
    pub name: String,
    pub ty: String,
    pub tag: PyO3ParamTag,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PyO3ParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
    /// Serde-tagged enum (from `#[bridge::tagged_enum(...)]`). The FFI wire
    /// form on the PyO3 boundary is still a JSON string; the Python caller
    /// sends `json.dumps(dict)`. The generated code uses the schema to emit
    /// explicit discriminator-branch decode, which matches the B.2 plan's
    /// "Option A" (dict-discriminator helper) — chosen for speed-to-ship over
    /// Option B's pydantic-style sibling classes, which can be layered on top
    /// later without changing the FFI surface.
    TaggedEnum(PyO3TaggedEnumSpec),
}

/// PyO3-side mirror of `bridge_core::descriptor::TaggedEnumSchema`. Kept in
/// this crate to avoid a dependency on `bridge-core`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PyO3TaggedEnumSpec {
    pub type_name: String,
    pub tag: String,
    pub content: Option<String>,
    pub variants: Vec<PyO3VariantSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PyO3VariantSpec {
    pub rust_name: String,
    pub wire_name: String,
    pub fields: Vec<PyO3VariantField>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PyO3VariantField {
    pub rust_name: String,
    pub wire_name: String,
    pub field_tag: PyO3FieldTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PyO3FieldTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

#[derive(Debug)]
pub(crate) struct ReturnInfo {
    pub ty: String,
    pub is_string: bool,
    pub is_prim: bool,
    pub is_bytes: bool,
    pub is_unit: bool,
    /// True when the return type is a tuple `(Vec<u8>, T)` -- bytes + serde value.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serialized inner type.
    #[allow(dead_code)]
    pub serde_inner_ty: Option<String>,
    /// True when the return type is a tuple `(Self, T)` -- lifecycle create with aux data.
    pub is_self_tuple: bool,
    /// When `is_self_tuple` is true, this holds the second element type string.
    #[allow(dead_code)]
    pub self_tuple_inner_ty: Option<String>,
}

// ---------------------------------------------------------------------------
// snake_case helper
// ---------------------------------------------------------------------------

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

fn classify_return(ty_str: &str) -> ReturnInfo {
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
fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
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
fn parse_self_tuple(ty: &str) -> (bool, Option<String>) {
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
fn split_tuple_at_depth_zero(s: &str) -> Vec<String> {
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
fn is_direct_return(ret: &ReturnInfo) -> bool {
    ret.is_unit || ret.is_string || ret.is_prim || ret.is_bytes || ret.is_bytes_tuple
}

// ---------------------------------------------------------------------------
// Parsing descriptor tokens
// ---------------------------------------------------------------------------

/// Top-level parser entry point for free-function mode (`generate!`).
pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: PyO3Descriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}

impl Parse for PyO3Descriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // bridge_version = 1;
        let _: Ident = input.parse()?; // "bridge_version"
        let _: Token![=] = input.parse()?;
        let _version: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        let mut service: Option<PyO3ServiceMeta> = None;
        let mut type_name: Option<String> = None;

        // group = identifier;
        if input.peek(syn::Ident) && peek_ident_eq(input, "group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let _group: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;
        }

        // Optional: fn_prefix = ident;
        let mut fn_prefix: Option<String> = None;
        if input.peek(syn::Ident) && peek_ident_eq(input, "fn_prefix") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            if input.peek(Token![_]) {
                let _: Token![_] = input.parse()?;
                fn_prefix = Some(String::new());
            } else {
                let prefix_ident: Ident = input.parse()?;
                fn_prefix = Some(prefix_ident.to_string());
            }
            let _: Token![;] = input.parse()?;
        }

        // Optional: type_name = X;
        if input.peek(syn::Ident) && peek_ident_eq(input, "type_name") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let tn: Ident = input.parse()?;
            type_name = Some(tn.to_string());
            let _: Token![;] = input.parse()?;
        }

        // Optional: service = TypeName; key_type = str; key_param = "param_name";
        if input.peek(syn::Ident) && peek_ident_eq(input, "service") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let svc_ident: Ident = input.parse()?;
            type_name = Some(svc_ident.to_string());
            let _: Token![;] = input.parse()?;

            // key_type = str;
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let _key_type: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;

            // key_param = "store_id";
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let key_param_lit: syn::LitStr = input.parse()?;
            let _: Token![;] = input.parse()?;

            service = Some(PyO3ServiceMeta {
                key_param: key_param_lit.value(),
            });
        }

        // Parse methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            let method = parse_method(input)?;
            methods.push(method);
        }

        let type_name = type_name.unwrap_or_else(|| "Unknown".to_string());

        Ok(PyO3Descriptor {
            type_name,
            fn_prefix,
            service,
            methods,
        })
    }
}

/// Peek at the next ident without consuming it.
fn peek_ident_eq(input: ParseStream, expected: &str) -> bool {
    input
        .fork()
        .parse::<Ident>()
        .map(|i| i == expected)
        .unwrap_or(false)
}

/// Parse a single method or lifecycle block from the descriptor DSL.
fn parse_method(input: ParseStream) -> syn::Result<PyO3Method> {
    let kind_ident: Ident = input.parse()?;
    let kind_str = kind_ident.to_string();

    let (access, name) = match kind_str.as_str() {
        "lifecycle" => {
            let lifecycle_kind: Ident = input.parse()?;
            match lifecycle_kind.to_string().as_str() {
                "create" => {
                    let method_name: Ident = input.parse()?;
                    (PyO3Access::LifecycleCreate, method_name.to_string())
                }
                "create_from" => {
                    let variant_name: Ident = input.parse()?;
                    let method_name: Ident = input.parse()?;
                    (
                        PyO3Access::LifecycleCreateFrom {
                            variant_name: variant_name.to_string(),
                        },
                        method_name.to_string(),
                    )
                }
                other => {
                    return Err(syn::Error::new(
                        lifecycle_kind.span(),
                        format!("unknown lifecycle kind: {}", other),
                    ));
                }
            }
        }
        "method" => {
            let access_ident: Ident = input.parse()?;
            let access = match access_ident.to_string().as_str() {
                "pure" => PyO3Access::Pure,
                "read" => PyO3Access::Read,
                "write" => PyO3Access::Write,
                // B.0 added `structural`. At the PyO3 FFI layer it is identical
                // to `write`; the gating distinction belongs to bridge-delegate.
                "structural" => PyO3Access::Write,
                // R2.4 added `session` for interior-mutable `&self` methods.
                // FFI-shape is identical to `read` (both emit `&self` pymethods),
                // so we collapse to `Read` here — see `AccessLevel::Session` in
                // bridge-core for rationale.
                "session" => PyO3Access::Read,
                other => {
                    return Err(syn::Error::new(
                        access_ident.span(),
                        format!("unknown access level: {}", other),
                    ));
                }
            };
            let method_name: Ident = input.parse()?;
            (access, method_name.to_string())
        }
        other => {
            return Err(syn::Error::new(
                kind_ident.span(),
                format!("expected 'lifecycle' or 'method', found '{}'", other),
            ));
        }
    };

    let content;
    braced!(content in input);

    // params { ... }
    let params_kw: Ident = content.parse()?;
    if params_kw != "params" {
        return Err(syn::Error::new(
            params_kw.span(),
            format!("expected 'params', found '{}'", params_kw),
        ));
    }
    let params_content;
    braced!(params_content in content);
    let params = parse_params(&params_content)?;

    let mut return_type: Option<ReturnInfo> = None;
    let mut error_type: Option<String> = None;
    let mut is_fallible = false;
    let mut is_async = false;
    let mut skip_targets = Vec::new();

    while !content.is_empty() {
        if content.peek(Token![async]) {
            let _: Token![async] = content.parse()?;
            let _: Token![;] = content.parse()?;
            is_async = true;
            continue;
        }

        let kw: Ident = content.parse()?;
        match kw.to_string().as_str() {
            "return_type" => {
                let _: Token![=] = content.parse()?;
                let ty_str = parse_type_until_semicolon(&content)?;
                let _: Token![;] = content.parse()?;
                let info = classify_return(&ty_str);
                if !info.is_unit {
                    return_type = Some(info);
                }
            }
            "error_type" => {
                let _: Token![=] = content.parse()?;
                let ty_str = parse_type_until_semicolon(&content)?;
                let _: Token![;] = content.parse()?;
                error_type = Some(ty_str);
            }
            "fallible" => {
                let _: Token![;] = content.parse()?;
                is_fallible = true;
            }
            "skip" => {
                let target: Ident = content.parse()?;
                let _: Token![;] = content.parse()?;
                skip_targets.push(target.to_string());
            }
            other => {
                return Err(syn::Error::new(
                    kw.span(),
                    format!("unexpected keyword in method body: '{}'", other),
                ));
            }
        }
    }

    Ok(PyO3Method {
        access,
        name,
        params,
        return_type,
        error_type,
        is_fallible,
        is_async,
        skip_targets,
    })
}

/// Parse a list of tagged parameters from inside `params { ... }`.
fn parse_params(input: ParseStream) -> syn::Result<Vec<PyO3Param>> {
    let mut params = Vec::new();
    while !input.is_empty() {
        let tag_content;
        syn::bracketed!(tag_content in input);
        let tag_ident: Ident = tag_content.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => PyO3ParamTag::Str,
            "prim" => PyO3ParamTag::Prim,
            "bytes" => PyO3ParamTag::Bytes,
            "serde" => PyO3ParamTag::Serde,
            "parse" => PyO3ParamTag::Parse,
            "tagged_enum" => PyO3ParamTag::TaggedEnum(parse_pyo3_tagged_enum_spec(&tag_content)?),
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!("unknown param tag: {}", other),
                ));
            }
        };

        let param_name: Ident = input.parse()?;
        let _: Token![:] = input.parse()?;
        let ty_str = parse_type_until_comma(input)?;
        let _: Token![,] = input.parse()?;

        params.push(PyO3Param {
            name: param_name.to_string(),
            ty: ty_str,
            tag,
        });
    }
    Ok(params)
}

/// Parse the `[tagged_enum ...]` body after the leading `tagged_enum` ident.
/// Mirrors `parse_tagged_enum_spec` in the napi crate — kept duplicated to
/// avoid a shared helper crate for proc-macro-only code.
fn parse_pyo3_tagged_enum_spec(input: ParseStream) -> syn::Result<PyO3TaggedEnumSpec> {
    let mut type_name: Option<String> = None;
    let mut tag_key: Option<String> = None;
    let mut content: Option<String> = None;
    let mut variants: Vec<PyO3VariantSpec> = Vec::new();

    while !input.is_empty() {
        let key: Ident = input.parse()?;
        match key.to_string().as_str() {
            "name" => {
                let _: Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                type_name = Some(lit.value());
            }
            "tag" => {
                let _: Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                tag_key = Some(lit.value());
            }
            "content" => {
                let _: Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                content = Some(lit.value());
            }
            "variants" => {
                let inner;
                syn::parenthesized!(inner in input);
                while !inner.is_empty() {
                    variants.push(parse_pyo3_tagged_enum_variant(&inner)?);
                    if inner.peek(Token![,]) {
                        let _: Token![,] = inner.parse()?;
                    }
                }
            }
            other => {
                return Err(syn::Error::new(
                    key.span(),
                    format!("tagged_enum: unknown key '{}'", other),
                ));
            }
        }
        if input.peek(Token![,]) {
            let _: Token![,] = input.parse()?;
        }
    }

    Ok(PyO3TaggedEnumSpec {
        type_name: type_name.ok_or_else(|| {
            syn::Error::new(proc_macro2::Span::call_site(), "tagged_enum: missing name")
        })?,
        tag: tag_key.ok_or_else(|| {
            syn::Error::new(proc_macro2::Span::call_site(), "tagged_enum: missing tag")
        })?,
        content,
        variants,
    })
}

fn parse_pyo3_tagged_enum_variant(input: ParseStream) -> syn::Result<PyO3VariantSpec> {
    let rust_ident: Ident = input.parse()?;
    let rust_name = rust_ident.to_string();

    let wire_name = if input.peek(Token![=]) {
        let _: Token![=] = input.parse()?;
        let lit: syn::LitStr = input.parse()?;
        lit.value()
    } else {
        rust_name.clone()
    };

    let fields_group;
    braced!(fields_group in input);

    let mut fields = Vec::new();
    while !fields_group.is_empty() {
        let field_ident: Ident = fields_group.parse()?;
        let wire_field = if fields_group.peek(Token![as]) {
            let _: Token![as] = fields_group.parse()?;
            let lit: syn::LitStr = fields_group.parse()?;
            lit.value()
        } else {
            field_ident.to_string()
        };
        let _: Token![:] = fields_group.parse()?;
        let ftag_ident: Ident = fields_group.parse()?;
        let field_tag = match ftag_ident.to_string().as_str() {
            "str" => PyO3FieldTag::Str,
            "prim" => PyO3FieldTag::Prim,
            "bytes" => PyO3FieldTag::Bytes,
            "serde" => PyO3FieldTag::Serde,
            "parse" => PyO3FieldTag::Parse,
            other => {
                return Err(syn::Error::new(
                    ftag_ident.span(),
                    format!("tagged_enum: unknown field tag '{}'", other),
                ));
            }
        };
        fields.push(PyO3VariantField {
            rust_name: field_ident.to_string(),
            wire_name: wire_field,
            field_tag,
        });
        if fields_group.peek(Token![,]) {
            let _: Token![,] = fields_group.parse()?;
        }
    }

    Ok(PyO3VariantSpec {
        rust_name,
        wire_name,
        fields,
    })
}

/// Consume tokens until we hit a semicolon, returning them as a string.
fn parse_type_until_semicolon(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    while !input.peek(Token![;]) {
        let tt: proc_macro2::TokenTree = input.parse()?;
        tokens.push(tt.to_string());
    }
    Ok(join_type_tokens(&tokens))
}

/// Consume tokens until we hit a comma at depth 0, returning them as a string.
fn parse_type_until_comma(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    let mut angle_depth: i32 = 0;
    loop {
        if angle_depth == 0 && input.peek(Token![,]) {
            break;
        }
        let tt: proc_macro2::TokenTree = input.parse()?;
        let s = tt.to_string();
        if s == "<" {
            angle_depth += 1;
        } else if s == ">" {
            angle_depth -= 1;
        }
        tokens.push(s);
    }
    Ok(join_type_tokens(&tokens))
}

/// Join type tokens back into a normalized string.
fn join_type_tokens(tokens: &[String]) -> String {
    let mut result = String::new();
    for (i, tok) in tokens.iter().enumerate() {
        if i > 0 {
            let prev = &tokens[i - 1];
            let skip_space = prev == "&"
                || prev.ends_with('<')
                || prev.ends_with('(')
                || tok.starts_with('<')
                || tok.starts_with('>')
                || tok == "&"
                || (prev == ":" && tok == ":")
                || (tok == ":" && i + 1 < tokens.len() && tokens[i + 1] == ":");
            if !skip_space {
                result.push(' ');
            }
        }
        result.push_str(tok);
    }
    result
}

// ---------------------------------------------------------------------------
// Code generation — class mode (`generate_class!`)
// ---------------------------------------------------------------------------

/// Parse `__class_name = ClassName; <descriptor tokens>` and generate
/// class-based PyO3 bindings.
pub(crate) fn parse_and_expand_class(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: ClassExpandInput = syn::parse2(input)?;
    let desc: PyO3Descriptor = syn::parse2(parsed.descriptor_tokens)?;
    Ok(expand_class(&parsed.class_name, &desc))
}

/// Input for `__expand_class`: `__class_name = ClassName; <descriptor tokens>`.
struct ClassExpandInput {
    class_name: String,
    descriptor_tokens: proc_macro2::TokenStream,
}

impl Parse for ClassExpandInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let kw: Ident = input.parse()?;
        if kw != "__class_name" {
            return Err(syn::Error::new(kw.span(), "expected '__class_name'"));
        }
        let _: Token![=] = input.parse()?;
        let class_ident: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        let descriptor_tokens: proc_macro2::TokenStream = input.parse()?;

        Ok(ClassExpandInput {
            class_name: class_ident.to_string(),
            descriptor_tokens,
        })
    }
}

/// Generate class-based PyO3 code from a `PyO3Descriptor`.
///
/// Emits:
/// - `#[pymethods] impl ClassName { ... }` blocks with `&self` / `&mut self` methods
/// - Pure methods stay as free `#[pyfunction]` functions
/// - No registry, no destroy
///
/// The struct definition is NOT emitted here — it's emitted by `generate_class!`.
pub(crate) fn expand_class(class_name: &str, desc: &PyO3Descriptor) -> TokenStream {
    let class_ident = format_ident!("{}", class_name);
    let type_ident = format_ident!("{}", desc.type_name);

    let type_snake = to_snake_case(&desc.type_name);
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),
        None => type_snake.clone(),
    };

    let mut impl_methods = Vec::new();
    let mut pure_functions = TokenStream::new();
    let mut has_self_tuple_lifecycle = false;

    for method in &desc.methods {
        if method.skip_targets.contains(&"pyo3".to_string()) {
            continue;
        }
        match method.access {
            PyO3Access::LifecycleCreate => {
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_constructor(method, &type_ident));
            }
            PyO3Access::LifecycleCreateFrom { ref variant_name } => {
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_factory_method(method, &type_ident, variant_name));
            }
            PyO3Access::Read => {
                impl_methods.push(emit_class_method(method, &effective_prefix, false));
            }
            PyO3Access::Write => {
                impl_methods.push(emit_class_method(method, &effective_prefix, true));
            }
            PyO3Access::Pure => {
                pure_functions.extend(emit_pure_function(method, &effective_prefix, &type_ident));
            }
        }
    }

    // If any lifecycle create returns (Self, T), add the accessor method
    if has_self_tuple_lifecycle {
        impl_methods.push(emit_take_lifecycle_result_method());
    }

    let mut output = TokenStream::new();

    if !impl_methods.is_empty() {
        output.extend(quote! {
            #[pyo3::pymethods]
            impl #class_ident {
                #(#impl_methods)*
            }
        });
    }

    output.extend(pure_functions);

    output
}

/// Emit a `#[new]` constructor method for the class.
fn emit_class_constructor(method: &PyO3Method, type_ident: &Ident) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[new]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        let call_expr = if method.is_fallible {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[new]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self { inner: instance, __lifecycle_result: None })
            }
        }
    }
}

/// Emit a `#[staticmethod]` factory method for create_from lifecycle.
fn emit_class_factory_method(
    method: &PyO3Method,
    type_ident: &Ident,
    _variant_name: &str,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[staticmethod]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        let call_expr = if method.is_fallible {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
            }
        } else {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[staticmethod]
            pub fn #method_ident(#(#py_params),*) -> pyo3::PyResult<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: None,
                })
            }
        }
    }
}

/// Emit a `take_lifecycle_result` accessor method.
fn emit_take_lifecycle_result_method() -> TokenStream {
    quote! {
        pub fn take_lifecycle_result(&mut self) -> Option<String> {
            self.__lifecycle_result.take()
        }
    }
}

/// Emit a class instance method (&self for read, &mut self for write).
fn emit_class_method(method: &PyO3Method, type_snake: &str, is_write: bool) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // PyO3 method name: use pyo3(name = "...") to set the Python-visible name
    let py_name = if type_snake.is_empty() {
        method.name.clone()
    } else {
        format!("{}_{}", type_snake, method.name)
    };
    let py_name_lit = syn::LitStr::new(&py_name, proc_macro2::Span::call_site());

    let self_param = if is_write {
        quote! { &mut self }
    } else {
        quote! { &self }
    };

    let inner_call = if method.is_fallible {
        quote! {
            self.inner.#method_ident(#(#call_args),*)
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?
        }
    } else {
        quote! {
            self.inner.#method_ident(#(#call_args),*)
        }
    };

    let needs_serde_return = method
        .return_type
        .as_ref()
        .map(|r| !is_direct_return(r))
        .unwrap_or(false);

    let needs_bytes_tuple_return = method
        .return_type
        .as_ref()
        .map(|r| r.is_bytes_tuple)
        .unwrap_or(false);

    let needs_bytes_return = method
        .return_type
        .as_ref()
        .map(|r| r.is_bytes)
        .unwrap_or(false);

    let (return_type_tokens, body) = if needs_serde_return {
        (
            quote! { pyo3::PyResult<String> },
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                serde_json::to_string(&result)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))
            },
        )
    } else if needs_bytes_tuple_return {
        // Return Python tuple (bytes, str)
        (
            quote! { pyo3::PyResult<(Vec<u8>, String)> },
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                let (bytes, metadata) = result;
                let meta_json = serde_json::to_string(&metadata)
                    .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
                Ok((bytes, meta_json))
            },
        )
    } else if needs_bytes_return {
        (
            quote! { pyo3::PyResult<Vec<u8>> },
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                Ok(result)
            },
        )
    } else {
        let has_return = method.return_type.is_some();
        if has_return {
            let ret = method.return_type.as_ref().unwrap();
            let rt = build_pyo3_return_type(ret);
            (
                quote! { pyo3::PyResult<#rt> },
                quote! {
                    #(#conversion_stmts)*
                    let result = #inner_call;
                    Ok(result)
                },
            )
        } else {
            (
                quote! { pyo3::PyResult<()> },
                quote! {
                    #(#conversion_stmts)*
                    #inner_call;
                    Ok(())
                },
            )
        }
    };

    quote! {
        #[pyo3(name = #py_name_lit)]
        pub fn #method_ident(#self_param, #(#py_params),*) -> #return_type_tokens {
            #body
        }
    }
}

// ---------------------------------------------------------------------------
// Code generation — free-function mode (`generate!`)
// ---------------------------------------------------------------------------

/// Main entry point for free-function mode: emit `#[pyfunction]` functions.
///
/// For PyO3, the `generate!` macro only emits pure/stateless functions.
/// Service lifecycle and read/write methods are handled by `generate_class!`.
pub(crate) fn expand(desc: &PyO3Descriptor) -> TokenStream {
    let type_snake = to_snake_case(&desc.type_name);
    let type_ident = format_ident!("{}", desc.type_name);

    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),
        None => type_snake.clone(),
    };

    let mut output = TokenStream::new();

    // In free-function mode, all methods become #[pyfunction]
    for method in &desc.methods {
        if method.skip_targets.contains(&"pyo3".to_string()) {
            continue;
        }
        output.extend(emit_pure_function(method, &effective_prefix, &type_ident));
    }

    output
}

/// Emit a pure (stateless) function as a `#[pyfunction]`.
fn emit_pure_function(method: &PyO3Method, type_snake: &str, type_ident: &Ident) -> TokenStream {
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let method_ident = format_ident!("{}", method.name);

    let (py_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let (return_type_tokens, result_conversion) =
        build_return_handling(&method.return_type, method.is_fallible);

    let call_expr = if method.is_fallible {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*)
                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
        }
    } else {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*);
        }
    };

    quote! {
        #[pyo3::pyfunction]
        pub fn #fn_name(#(#py_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #call_expr
            #result_conversion
        }
    }
}

// ---------------------------------------------------------------------------
// `generate_class!` parsing and code generation
// ---------------------------------------------------------------------------

/// Input for `__generate_class`:
/// `struct ClassName(path::to::InnerType); desc1, desc2, ...`
pub(crate) struct GenerateClassInput {
    pub class_name: Ident,
    pub inner_type: syn::Path,
    pub descriptors: Vec<syn::Path>,
}

impl Parse for GenerateClassInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let _: Token![struct] = input.parse()?;
        let class_name: Ident = input.parse()?;

        let content;
        syn::parenthesized!(content in input);
        let inner_type: syn::Path = content.parse()?;

        let _: Token![;] = input.parse()?;
        let _ = input.parse::<Option<Token![,]>>();

        let descriptors =
            syn::punctuated::Punctuated::<syn::Path, Token![,]>::parse_terminated(input)?;

        Ok(GenerateClassInput {
            class_name,
            inner_type,
            descriptors: descriptors.into_iter().collect(),
        })
    }
}

/// Generate a `#[pyclass]` struct definition and dispatch descriptor macros
/// through `__expand_class`.
pub(crate) fn generate_class_impl(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: GenerateClassInput = syn::parse2(input)?;

    let class_ident = &parsed.class_name;
    let inner_path = &parsed.inner_type;
    let callback_name = format_ident!("__pyo3_class_expand_{}", class_ident);

    // We need to emit a `$` inside a macro_rules body.
    let dollar = proc_macro2::Punct::new('$', proc_macro2::Spacing::Alone);

    let mut output = quote! {
        #[pyo3::pyclass]
        pub struct #class_ident {
            pub(crate) inner: #inner_path,
            /// Stash for auxiliary data returned by `(Self, T)` lifecycle creates.
            /// Populated by the constructor when the Rust create method returns a
            /// tuple, and retrieved via `take_lifecycle_result()`. Always `None`
            /// for plain `Self` constructors.
            pub(crate) __lifecycle_result: Option<String>,
        }

        macro_rules! #callback_name {
            (#dollar ( #dollar tt:tt)*) => {
                bridge_pyo3::__expand_class!{ __class_name = #class_ident; #dollar ( #dollar tt)* }
            }
        }
    };

    for desc_path in &parsed.descriptors {
        output.extend(quote! {
            #desc_path!(#callback_name);
        });
    }

    Ok(output)
}

// ---------------------------------------------------------------------------
// Parameter and return type helpers
// ---------------------------------------------------------------------------

/// Build PyO3 parameter declarations, conversion statements, and call arguments.
fn build_params_and_conversions(
    params: &[PyO3Param],
) -> (Vec<TokenStream>, Vec<TokenStream>, Vec<TokenStream>) {
    let mut py_params = Vec::new();
    let mut conversions = Vec::new();
    let mut call_args = Vec::new();

    for param in params {
        let param_ident = format_ident!("{}", param.name);

        match &param.tag {
            PyO3ParamTag::Str => {
                // PyO3: take String. If inner Rust needs &str, pass &param.
                py_params.push(quote! { #param_ident: String });
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#param_ident });
                } else {
                    call_args.push(quote! { #param_ident });
                }
            }
            PyO3ParamTag::Prim => {
                let ty_ident: TokenStream = param.ty.parse().unwrap_or_else(|_| quote! { u32 });
                py_params.push(quote! { #param_ident: #ty_ident });
                call_args.push(quote! { #param_ident });
            }
            PyO3ParamTag::Bytes => {
                // PyO3: take Vec<u8> (auto-converted from Python bytes).
                // If the inner Rust call needs &[u8], pass a reference.
                py_params.push(quote! { #param_ident: Vec<u8> });
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#param_ident });
                } else {
                    call_args.push(quote! { #param_ident });
                }
            }
            PyO3ParamTag::Serde => {
                let converted = format_ident!("{}_converted", param.name);

                // Detect Option<&str> pattern
                let normalized = param.ty.replace(' ', "");
                if normalized == "Option<&str>" {
                    let owned = format_ident!("{}_owned", param.name);
                    py_params.push(quote! { #param_ident: String });
                    conversions.push(quote! {
                        let #owned: Option<String> = serde_json::from_str(&#param_ident)
                            .map_err(|e| pyo3::exceptions::PyValueError::new_err(format!("{}", e)))?;
                        let #converted = #owned.as_deref();
                    });
                    call_args.push(quote! { #converted });
                    continue;
                }

                py_params.push(quote! { #param_ident: String });

                if param.ty.starts_with('&') {
                    let inner = param.ty.trim_start_matches('&').trim();
                    if inner.starts_with('[') && inner.ends_with(']') {
                        // Slice reference (&[T]) -> deserialize as Vec<T>, auto-deref to &[T].
                        let elem = inner[1..inner.len() - 1].trim();
                        let vec_type_str = format!("Vec<{}>", elem);
                        let vec_ty: TokenStream =
                            vec_type_str.parse().unwrap_or_else(|_| quote! { Vec<_> });
                        conversions.push(quote! {
                            let #converted: #vec_ty = match serde_json::from_str(&#param_ident) {
                                Ok(v) => v,
                                Err(e) if e.to_string().contains("missing field") => {
                                    if let Ok(__value) = serde_json::from_str::<serde_json::Value>(&#param_ident) {
                                        return Err(pyo3::exceptions::PyValueError::new_err(
                                            bridge_types::enhance_missing_field_error(&__value, &e)
                                        ));
                                    }
                                    return Err(pyo3::exceptions::PyValueError::new_err(format!("{}", e)));
                                }
                                Err(e) => return Err(pyo3::exceptions::PyValueError::new_err(format!("{}", e))),
                            };
                        });
                    } else {
                        // Non-slice reference (&T) -> deserialize into owned T.
                        conversions.push(quote! {
                            let #converted = match serde_json::from_str(&#param_ident) {
                                Ok(v) => v,
                                Err(e) if e.to_string().contains("missing field") => {
                                    if let Ok(__value) = serde_json::from_str::<serde_json::Value>(&#param_ident) {
                                        return Err(pyo3::exceptions::PyValueError::new_err(
                                            bridge_types::enhance_missing_field_error(&__value, &e)
                                        ));
                                    }
                                    return Err(pyo3::exceptions::PyValueError::new_err(format!("{}", e)));
                                }
                                Err(e) => return Err(pyo3::exceptions::PyValueError::new_err(format!("{}", e))),
                            };
                        });
                    }
                    call_args.push(quote! { &#converted });
                } else {
                    // Owned param: deserialize directly.
                    conversions.push(quote! {
                        let #converted = match serde_json::from_str(&#param_ident) {
                            Ok(v) => v,
                            Err(e) if e.to_string().contains("missing field") => {
                                if let Ok(__value) = serde_json::from_str::<serde_json::Value>(&#param_ident) {
                                    return Err(pyo3::exceptions::PyValueError::new_err(
                                        bridge_types::enhance_missing_field_error(&__value, &e)
                                    ));
                                }
                                return Err(pyo3::exceptions::PyValueError::new_err(format!("{}", e)));
                            }
                            Err(e) => return Err(pyo3::exceptions::PyValueError::new_err(format!("{}", e))),
                        };
                    });
                    call_args.push(quote! { #converted });
                }
            }
            PyO3ParamTag::Parse => {
                let converted = format_ident!("{}_converted", param.name);
                py_params.push(quote! { #param_ident: String });
                conversions.push(quote! {
                    let #converted = bridge_types::BridgeParse::bridge_parse(&#param_ident)
                        .map_err(|e| pyo3::exceptions::PyValueError::new_err(e))?;
                });
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
            PyO3ParamTag::TaggedEnum(spec) => {
                let converted = format_ident!("{}_converted", param.name);
                py_params.push(quote! { #param_ident: String });
                let decode =
                    emit_pyo3_tagged_enum_decode(&param.ty, spec, &converted, &param_ident);
                conversions.push(decode);
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
        }
    }

    (py_params, conversions, call_args)
}

/// Emit a PyO3-side decode for a `tagged_enum` param.
///
/// Python surface (Option A from the B.2 plan):
///   - The Python caller constructs a plain `dict` with a discriminator key
///     (`schema.tag`, e.g. `"kind"`) plus the variant fields by wire name.
///   - The caller passes `json.dumps(d)` across the FFI boundary (parity with
///     the existing `Serde` path). The generated code parses the JSON and
///     dispatches per variant using the schema.
///
/// Option B (pydantic-style sibling dataclasses with a `Union` discriminator)
/// is left as a future enhancement that can sit on top of this same FFI
/// contract without codegen changes.
fn emit_pyo3_tagged_enum_decode(
    param_ty: &str,
    spec: &PyO3TaggedEnumSpec,
    converted: &Ident,
    param_ident: &Ident,
) -> TokenStream {
    let enum_ty_str = param_ty.trim_start_matches('&').trim();
    let enum_ty: TokenStream = enum_ty_str.parse().unwrap_or_else(|_| quote! { _ });

    if spec.content.is_some() {
        return quote! {
            let #converted: #enum_ty = serde_json::from_str(&#param_ident)
                .map_err(|e| pyo3::exceptions::PyValueError::new_err(format!("{}", e)))?;
        };
    }

    let tag_lit = &spec.tag;
    let type_name = &spec.type_name;

    let variant_arms: Vec<TokenStream> = spec
        .variants
        .iter()
        .map(|v| emit_pyo3_tagged_enum_variant_arm(&enum_ty, v))
        .collect();

    quote! {
        let #converted: #enum_ty = {
            let __raw: ::serde_json::Value = ::serde_json::from_str(&#param_ident)
                .map_err(|e| pyo3::exceptions::PyValueError::new_err(
                    format!("{}: {}", #type_name, e)
                ))?;
            let __obj = __raw.as_object().ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err(
                    format!("{}: expected object with '{}' discriminator", #type_name, #tag_lit)
                )
            })?;
            let __tag = __obj.get(#tag_lit).and_then(|v| v.as_str()).ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err(
                    format!("{}: missing string '{}' discriminator", #type_name, #tag_lit)
                )
            })?;
            match __tag {
                #(#variant_arms)*
                other => {
                    return Err(pyo3::exceptions::PyValueError::new_err(
                        format!("{}: unknown variant '{}'", #type_name, other),
                    ));
                }
            }
        };
    }
}

fn emit_pyo3_tagged_enum_variant_arm(enum_ty: &TokenStream, v: &PyO3VariantSpec) -> TokenStream {
    let wire = &v.wire_name;
    let variant_ident = format_ident!("{}", v.rust_name);

    if v.fields.is_empty() {
        return quote! {
            #wire => #enum_ty :: #variant_ident,
        };
    }

    let field_decodes: Vec<TokenStream> = v
        .fields
        .iter()
        .map(emit_pyo3_tagged_enum_field_decode)
        .collect();

    let field_idents: Vec<Ident> = v
        .fields
        .iter()
        .map(|f| format_ident!("{}", f.rust_name))
        .collect();

    quote! {
        #wire => {
            #(#field_decodes)*
            #enum_ty :: #variant_ident { #(#field_idents),* }
        }
    }
}

fn emit_pyo3_tagged_enum_field_decode(f: &PyO3VariantField) -> TokenStream {
    let rust_ident = format_ident!("{}", f.rust_name);
    let wire = &f.wire_name;

    match f.field_tag {
        PyO3FieldTag::Str => quote! {
            let #rust_ident: String = __obj
                .get(#wire)
                .and_then(|v| v.as_str())
                .ok_or_else(|| pyo3::exceptions::PyValueError::new_err(
                    format!("missing string field '{}'", #wire)
                ))?
                .to_string();
        },
        PyO3FieldTag::Prim => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        PyO3FieldTag::Bytes => quote! {
            let #rust_ident: Vec<u8> = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        PyO3FieldTag::Serde => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().ok_or_else(|| pyo3::exceptions::PyValueError::new_err(
                    format!("missing field '{}'", #wire)
                ))?
            ).map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        PyO3FieldTag::Parse => quote! {
            let #rust_ident = {
                let __s = __obj.get(#wire).and_then(|v| v.as_str()).ok_or_else(|| {
                    pyo3::exceptions::PyValueError::new_err(
                        format!("missing string field '{}'", #wire)
                    )
                })?;
                bridge_types::BridgeParse::bridge_parse(__s)
                    .map_err(|e| pyo3::exceptions::PyValueError::new_err(e))?
            };
        },
    }
}

/// Build the PyO3 return type from a `ReturnInfo`.
fn build_pyo3_return_type(ret: &ReturnInfo) -> TokenStream {
    if ret.is_string {
        quote! { String }
    } else if ret.is_prim {
        let ty: TokenStream = ret.ty.parse().unwrap_or_else(|_| quote! { u32 });
        ty
    } else if ret.is_bytes {
        quote! { Vec<u8> }
    } else {
        // Fallback for unknown direct types — shouldn't normally reach here
        quote! { String }
    }
}

/// Build the return type token and the result conversion expression.
fn build_return_handling(
    return_type: &Option<ReturnInfo>,
    _always_result: bool,
) -> (TokenStream, TokenStream) {
    match return_type {
        None => (quote! { pyo3::PyResult<()> }, quote! { Ok(()) }),
        Some(ret) => {
            if ret.is_string {
                (quote! { pyo3::PyResult<String> }, quote! { Ok(result) })
            } else if ret.is_prim {
                let ty: TokenStream = ret.ty.parse().unwrap_or_else(|_| quote! { u32 });
                (quote! { pyo3::PyResult<#ty> }, quote! { Ok(result) })
            } else if ret.is_bytes {
                (quote! { pyo3::PyResult<Vec<u8>> }, quote! { Ok(result) })
            } else if ret.is_bytes_tuple {
                // (Vec<u8>, T) -> Python tuple (bytes, str)
                (
                    quote! { pyo3::PyResult<(Vec<u8>, String)> },
                    quote! {
                        {
                            let (bytes, metadata) = result;
                            let meta_json = serde_json::to_string(&metadata)
                                .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))?;
                            Ok((bytes, meta_json))
                        }
                    },
                )
            } else {
                // serde return -> JSON string
                (
                    quote! { pyo3::PyResult<String> },
                    quote! {
                        serde_json::to_string(&result)
                            .map_err(|e| pyo3::exceptions::PyRuntimeError::new_err(format!("{}", e)))
                    },
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    fn classify_return_bytes_tuple() {
        let r = classify_return("(Vec<u8>, SomeMetadata)");
        assert!(r.is_bytes_tuple);
        assert_eq!(r.serde_inner_ty.as_deref(), Some("SomeMetadata"));
    }

    #[test]
    fn classify_return_self_tuple() {
        let r = classify_return("(Self, InitResult)");
        assert!(r.is_self_tuple);
        assert_eq!(r.self_tuple_inner_ty.as_deref(), Some("InitResult"));
    }

    #[test]
    fn classify_return_bool() {
        let r = classify_return("bool");
        assert!(r.is_prim);
    }

    // --- Parsing tests ---

    fn parse_descriptor(tokens: &str) -> syn::Result<PyO3Descriptor> {
        syn::parse_str::<PyO3Descriptor>(tokens)
    }

    #[test]
    fn parse_service_descriptor() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.type_name, "KvStore");
        assert!(desc.service.is_some());
        assert_eq!(desc.service.as_ref().unwrap().key_param, "store_id");
        assert_eq!(desc.methods.len(), 2);
        assert_eq!(desc.methods[0].access, PyO3Access::LifecycleCreate);
        assert_eq!(desc.methods[0].name, "new");
        assert_eq!(desc.methods[1].access, PyO3Access::Read);
        assert_eq!(desc.methods[1].name, "get");
    }

    #[test]
    fn parse_session_method_collapses_to_read() {
        // R2.4: `method session` collapses to `PyO3Access::Read` so the
        // emission path uses `&self`, not `&mut self`. See bridge-core's
        // `AccessLevel::Session` for rationale.
        let input = r#"
            bridge_version = 1;
            group = session_lifecycle;
            service = MyService;
            key_type = str;
            key_param = "id";
            method session set_active_principal {
                params { [serde] tags: Option<Vec<String>>, }
                return_type = ();
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, PyO3Access::Read);
        assert_eq!(desc.methods[0].name, "set_active_principal");
    }

    #[test]
    fn parse_pure_method_params() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method pure validate_key {
                params { [str] key: &str, [prim] max_length: usize, }
                return_type = ();
                error_type = ValidationError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params.len(), 2);
        assert_eq!(m.params[0].tag, PyO3ParamTag::Str);
        assert_eq!(m.params[0].name, "key");
        assert_eq!(m.params[1].tag, PyO3ParamTag::Prim);
        assert_eq!(m.params[1].name, "max_length");
        assert!(m.is_fallible);
    }

    #[test]
    fn parse_parse_tag() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method read get_by_id {
                params { [parse] id: &KeyId, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params[0].tag, PyO3ParamTag::Parse);
        assert!(m.params[0].ty.contains("KeyId"));
    }

    #[test]
    fn parse_skip_target_pyo3() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            type_name = Utils;
            method pure do_something {
                params {}
                return_type = String;
                skip pyo3;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert!(m.skip_targets.contains(&"pyo3".to_string()));
    }

    #[test]
    fn parse_create_from_lifecycle() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "id";
            lifecycle create_from snapshot restore {
                params { [bytes] data: Vec<u8>, }
                error_type = EngineError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(
            m.access,
            PyO3Access::LifecycleCreateFrom {
                variant_name: "snapshot".to_string()
            }
        );
        assert_eq!(m.name, "restore");
    }

    // --- Code generation tests ---

    #[test]
    fn expand_pure_produces_pyfunction() {
        let desc = PyO3Descriptor {
            type_name: "Utils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![PyO3Method {
                access: PyO3Access::Pure,
                name: "greet".to_string(),
                params: vec![PyO3Param {
                    name: "name".to_string(),
                    ty: "String".to_string(),
                    tag: PyO3ParamTag::Str,
                }],
                return_type: Some(classify_return("String")),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("pyfunction"),
            "expected #[pyfunction] in output: {}",
            code
        );
        assert!(
            code.contains("utils_greet"),
            "expected utils_greet in output: {}",
            code
        );
    }

    #[test]
    fn expand_skips_pyo3_target() {
        let desc = PyO3Descriptor {
            type_name: "Utils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![PyO3Method {
                access: PyO3Access::Pure,
                name: "napi_only".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: vec!["pyo3".to_string()],
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            !code.contains("napi_only"),
            "should have skipped pyo3-targeted method: {}",
            code
        );
    }

    #[test]
    fn expand_class_produces_pymethods() {
        let desc = PyO3Descriptor {
            type_name: "MyEngine".to_string(),
            fn_prefix: Some(String::new()),
            service: Some(PyO3ServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![PyO3Method {
                access: PyO3Access::Read,
                name: "get_value".to_string(),
                params: vec![PyO3Param {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: PyO3ParamTag::Str,
                }],
                return_type: Some(classify_return("String")),
                error_type: None,
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand_class("ComputeEngine", &desc);
        let code = tokens.to_string();
        assert!(
            code.contains("pymethods"),
            "expected #[pymethods] in output: {}",
            code
        );
        assert!(
            code.contains("get_value"),
            "expected get_value method in output: {}",
            code
        );
    }

    // --- Tagged-enum (B.2) tests ---

    #[test]
    fn parse_tagged_enum_param() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            type_name = Gate;
            method read check {
                params {
                    [tagged_enum
                        name = "AccessTarget",
                        tag = "kind",
                        variants(
                            Workbook = "workbook" { },
                            Sheet = "sheet" { sheet_id as "sheet_id": serde, },
                            Column = "column" { sheet_id as "sheet_id": serde, col_id as "col_id": serde, },
                        )
                    ] target: AccessTarget,
                }
                return_type = bool;
            }
        "#;
        let desc: PyO3Descriptor = syn::parse_str(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params.len(), 1);
        let spec = match &m.params[0].tag {
            PyO3ParamTag::TaggedEnum(s) => s,
            other => panic!("expected TaggedEnum, got {:?}", other),
        };
        assert_eq!(spec.type_name, "AccessTarget");
        assert_eq!(spec.tag, "kind");
        assert_eq!(spec.content, None);
        assert_eq!(spec.variants.len(), 3);
        assert_eq!(spec.variants[0].wire_name, "workbook");
        assert!(spec.variants[0].fields.is_empty());
        assert_eq!(spec.variants[1].fields.len(), 1);
        assert_eq!(spec.variants[1].fields[0].rust_name, "sheet_id");
        assert_eq!(spec.variants[1].fields[0].field_tag, PyO3FieldTag::Serde);
    }

    #[test]
    fn tagged_enum_param_emits_branch_decode() {
        let desc = PyO3Descriptor {
            type_name: "Gate".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![PyO3Method {
                access: PyO3Access::Pure,
                name: "check".to_string(),
                params: vec![PyO3Param {
                    name: "target".to_string(),
                    ty: "AccessTarget".to_string(),
                    tag: PyO3ParamTag::TaggedEnum(PyO3TaggedEnumSpec {
                        type_name: "AccessTarget".to_string(),
                        tag: "kind".to_string(),
                        content: None,
                        variants: vec![
                            PyO3VariantSpec {
                                rust_name: "Workbook".to_string(),
                                wire_name: "workbook".to_string(),
                                fields: vec![],
                            },
                            PyO3VariantSpec {
                                rust_name: "Sheet".to_string(),
                                wire_name: "sheet".to_string(),
                                fields: vec![PyO3VariantField {
                                    rust_name: "sheet_id".to_string(),
                                    wire_name: "sheet_id".to_string(),
                                    field_tag: PyO3FieldTag::Serde,
                                }],
                            },
                        ],
                    }),
                }],
                return_type: Some(classify_return("bool")),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("target : String"),
            "expected String FFI param: {}",
            code
        );
        assert!(code.contains("\"kind\""), "expected kind literal: {}", code);
        assert!(
            code.contains("\"workbook\""),
            "expected workbook arm: {}",
            code
        );
        assert!(code.contains("\"sheet\""), "expected sheet arm: {}", code);
        assert!(
            code.contains("AccessTarget :: Workbook"),
            "expected Workbook variant ctor: {}",
            code
        );
        assert!(
            code.contains("AccessTarget :: Sheet"),
            "expected Sheet variant ctor: {}",
            code
        );
    }

    #[test]
    fn tagged_enum_adjacent_content_falls_back_to_serde() {
        let desc = PyO3Descriptor {
            type_name: "X".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![PyO3Method {
                access: PyO3Access::Pure,
                name: "probe".to_string(),
                params: vec![PyO3Param {
                    name: "m".to_string(),
                    ty: "Msg".to_string(),
                    tag: PyO3ParamTag::TaggedEnum(PyO3TaggedEnumSpec {
                        type_name: "Msg".to_string(),
                        tag: "t".to_string(),
                        content: Some("c".to_string()),
                        variants: vec![PyO3VariantSpec {
                            rust_name: "Hello".to_string(),
                            wire_name: "Hello".to_string(),
                            fields: vec![],
                        }],
                    }),
                }],
                return_type: Some(classify_return("bool")),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("serde_json :: from_str"),
            "expected serde_json::from_str fallback: {}",
            code
        );
    }

    #[test]
    fn structural_access_collapses_to_write() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method structural rename_sheet {
                params { [serde] sheet: SheetId, [str] name: String, }
                return_type = ();
            }
        "#;
        let desc: PyO3Descriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods[1].access, PyO3Access::Write);
    }
}
