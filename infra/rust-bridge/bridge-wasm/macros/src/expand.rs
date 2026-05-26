//! Code generation for WASM bindings.
//!
//! Converts a `WasmDescriptor` (parsed from descriptor tokens) into a
//! `TokenStream` containing `#[wasm_bindgen]` functions, thread-local
//! registries, and helper code.

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{Token, braced};

// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub(crate) struct WasmDescriptor {
    pub type_name: String,
    pub fn_prefix: Option<String>,
    pub service: Option<WasmServiceMeta>,
    pub methods: Vec<WasmMethod>,
}

#[derive(Debug)]
pub(crate) struct WasmServiceMeta {
    pub key_param: String,
}

#[derive(Debug)]
pub(crate) struct WasmMethod {
    pub access: WasmAccess,
    pub name: String,
    pub params: Vec<WasmParam>,
    pub return_type: Option<ReturnInfo>,
    #[allow(dead_code)]
    pub error_type: Option<String>,
    pub is_fallible: bool,
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WasmAccess {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

#[derive(Debug)]
pub(crate) struct WasmParam {
    pub name: String,
    pub ty: String,
    pub tag: WasmParamTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WasmParamTag {
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
    /// True when the return type is a tuple `(Vec<u8>, T)` — bytes pass through
    /// as Uint8Array (no serde), T gets serde-serialized.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serialized inner type
    /// (the second element of the tuple). Used for introspection and testing.
    #[allow(dead_code)]
    pub serde_inner_ty: Option<String>,
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

    // Detect bytes-tuple pattern: (Vec<u8>, T) where first element is Vec<u8>
    // and second element is a serde-serializable type.
    let (is_bytes_tuple, serde_inner_ty) = parse_bytes_tuple(trimmed);

    ReturnInfo {
        ty: trimmed.to_string(),
        is_string,
        is_prim,
        is_bytes,
        is_unit,
        is_bytes_tuple,
        serde_inner_ty,
    }
}

/// Try to parse a type string as a `(Vec<u8>, T)` bytes-tuple.
/// Returns `(true, Some(inner_type_string))` if it matches, `(false, None)` otherwise.
fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    // Strip outer parentheses
    let inner = trimmed[1..trimmed.len() - 1].trim();

    // Split by comma at depth 0 (respecting angle brackets)
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

    // Must be exactly 2 elements, first must be Vec<u8>
    if parts.len() != 2 {
        return (false, None);
    }

    let first = parts[0].replace(' ', "");
    if first != "Vec<u8>" {
        return (false, None);
    }

    (true, Some(parts[1].clone()))
}

/// Returns true if the return type should be passed through directly (no serde).
fn is_direct_return(ret: &ReturnInfo) -> bool {
    ret.is_unit || ret.is_string || ret.is_prim || ret.is_bytes || ret.is_bytes_tuple
}

// ---------------------------------------------------------------------------
// Parsing descriptor tokens
// ---------------------------------------------------------------------------

/// Top-level parser entry point. Parses the descriptor DSL token stream
/// emitted by bridge-core's `__bridge_descriptor_*` macros.
pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: WasmDescriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}

impl Parse for WasmDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // bridge_version = 1;
        let _: Ident = input.parse()?; // "bridge_version"
        let _: Token![=] = input.parse()?;
        let _version: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        let mut service: Option<WasmServiceMeta> = None;
        let mut type_name: Option<String> = None;

        // group = identifier; (always present, used by Tauri for module scoping)
        if input.peek(syn::Ident) && peek_ident_eq(input, "group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let _group: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;
        }

        // Optional: fn_prefix = ident; (custom prefix for generated function names)
        // `fn_prefix = _;` means empty (no prefix), `fn_prefix = foo;` means use "foo".
        let mut fn_prefix: Option<String> = None;
        if input.peek(syn::Ident) && peek_ident_eq(input, "fn_prefix") {
            let _: Ident = input.parse()?; // "fn_prefix"
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

        // Optional: type_name = X; (for stateless/non-service descriptors)
        if input.peek(syn::Ident) && peek_ident_eq(input, "type_name") {
            let _: Ident = input.parse()?; // "type_name"
            let _: Token![=] = input.parse()?;
            let tn: Ident = input.parse()?;
            type_name = Some(tn.to_string());
            let _: Token![;] = input.parse()?;
        }

        // Optional: service = TypeName; key_type = str; key_param = "param_name";
        if input.peek(syn::Ident) && peek_ident_eq(input, "service") {
            let _: Ident = input.parse()?; // "service"
            let _: Token![=] = input.parse()?;
            let svc_ident: Ident = input.parse()?;
            type_name = Some(svc_ident.to_string());
            let _: Token![;] = input.parse()?;

            // key_type = str;
            let _: Ident = input.parse()?; // "key_type"
            let _: Token![=] = input.parse()?;
            let _key_type: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;

            // key_param = "store_id";
            let _: Ident = input.parse()?; // "key_param"
            let _: Token![=] = input.parse()?;
            let key_param_lit: syn::LitStr = input.parse()?;
            let _: Token![;] = input.parse()?;

            service = Some(WasmServiceMeta {
                key_param: key_param_lit.value(),
            });
        }

        // Parse methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            let method = parse_method(input)?;
            methods.push(method);
        }

        // For stateless descriptors that don't yet emit `type_name = X;`,
        // fall back to a placeholder. bridge-core will be updated to emit
        // this line; until then, integration won't fully work for stateless APIs.
        let type_name = type_name.unwrap_or_else(|| "Unknown".to_string());

        Ok(WasmDescriptor {
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
fn parse_method(input: ParseStream) -> syn::Result<WasmMethod> {
    let kind_ident: Ident = input.parse()?;
    let kind_str = kind_ident.to_string();

    let (access, name) = match kind_str.as_str() {
        "lifecycle" => {
            let lifecycle_kind: Ident = input.parse()?;
            match lifecycle_kind.to_string().as_str() {
                "create" => {
                    let method_name: Ident = input.parse()?;
                    (WasmAccess::LifecycleCreate, method_name.to_string())
                }
                "create_from" => {
                    let variant_name: Ident = input.parse()?;
                    let method_name: Ident = input.parse()?;
                    (
                        WasmAccess::LifecycleCreateFrom {
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
                "pure" => WasmAccess::Pure,
                "read" => WasmAccess::Read,
                "write" => WasmAccess::Write,
                // R2.4 added `session` for `&self` interior-mutable methods
                // (e.g. `set_active_principal`). At the wasm-bindgen layer
                // it is identical to `read` — same `&self` receiver, same
                // wire serialization.
                "session" => WasmAccess::Read,
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

    // Parse the braced block
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

    // return_type = Type;
    let mut return_type: Option<ReturnInfo> = None;
    let mut error_type: Option<String> = None;
    let mut is_fallible = false;
    let mut is_async = false;
    let mut skip_targets = Vec::new();

    while !content.is_empty() {
        // `async` is a Rust keyword, so syn won't parse it as an Ident.
        // Handle it before the normal ident-based keyword dispatch.
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

    Ok(WasmMethod {
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
fn parse_params(input: ParseStream) -> syn::Result<Vec<WasmParam>> {
    let mut params = Vec::new();
    while !input.is_empty() {
        // Parse the tag: [str], [prim], [bytes], [serde], [parse]
        let tag_content;
        syn::bracketed!(tag_content in input);
        let tag_ident: Ident = tag_content.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => WasmParamTag::Str,
            "prim" => WasmParamTag::Prim,
            "bytes" => WasmParamTag::Bytes,
            "serde" => WasmParamTag::Serde,
            "parse" => WasmParamTag::Parse,
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!("unknown param tag: {}", other),
                ));
            }
        };

        // param_name: Type,
        let param_name: Ident = input.parse()?;
        let _: Token![:] = input.parse()?;
        let ty_str = parse_type_until_comma(input)?;
        let _: Token![,] = input.parse()?;

        params.push(WasmParam {
            name: param_name.to_string(),
            ty: ty_str,
            tag,
        });
    }
    Ok(params)
}

/// Consume tokens until we hit a semicolon, returning them as a string.
/// Does not consume the semicolon itself.
fn parse_type_until_semicolon(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    while !input.peek(Token![;]) {
        let tt: proc_macro2::TokenTree = input.parse()?;
        tokens.push(tt.to_string());
    }
    Ok(join_type_tokens(&tokens))
}

/// Consume tokens until we hit a comma at depth 0, returning them as a string.
/// Does not consume the comma itself.
/// Tracks `<`/`>` depth so commas inside generic types (e.g. `HashMap<K, V>`)
/// are not treated as parameter separators.
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
/// Handles `&str`, `&KeyId`, `Vec<String>`, `crate::path::Type`, etc.
fn join_type_tokens(tokens: &[String]) -> String {
    let mut result = String::new();
    for (i, tok) in tokens.iter().enumerate() {
        if i > 0 {
            let prev = &tokens[i - 1];
            // Don't add space after `&`, `<`, `(`, or before `<`, `>`, or
            // between consecutive `:` (path separator `::`)
            let skip_space = prev == "&"
                || prev.ends_with('<')
                || prev.ends_with('(')
                || tok.starts_with('<')
                || tok.starts_with('>')
                || tok == "&"
                || (prev == ":" && tok == ":")  // `::` path separator
                || (tok == ":" && i + 1 < tokens.len() && tokens[i + 1] == ":"); // before `::`
            if !skip_space {
                result.push(' ');
            }
        }
        result.push_str(tok);
    }
    result
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/// Main entry point: given a parsed `WasmDescriptor`, emit the full WASM
/// binding code as a `TokenStream`.
pub(crate) fn expand(desc: &WasmDescriptor) -> TokenStream {
    let type_snake = to_snake_case(&desc.type_name);
    let type_ident = format_ident!("{}", desc.type_name);

    // Compute effective prefix for function naming
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),   // explicit empty = no prefix
        None => type_snake.clone(), // default behavior
    };

    let mut output = TokenStream::new();

    // Infrastructure: emit if ANY non-skipped lifecycle method exists for this target
    let declares_lifecycle = desc.methods.iter().any(|m| {
        matches!(
            m.access,
            WasmAccess::LifecycleCreate | WasmAccess::LifecycleCreateFrom { .. }
        ) && !m.skip_targets.contains(&"wasm".to_string())
    });

    if let Some(ref svc) = desc.service {
        if declares_lifecycle {
            output.extend(emit_registry(desc, &effective_prefix, &type_ident));
            output.extend(emit_helpers(desc, &effective_prefix, &type_ident));
            output.extend(emit_destroy(desc, &effective_prefix, &type_ident));
        }

        // Emit each method
        for method in &desc.methods {
            if method.skip_targets.contains(&"wasm".to_string()) || method.is_async {
                continue;
            }
            match method.access {
                WasmAccess::LifecycleCreate | WasmAccess::LifecycleCreateFrom { .. } => {
                    output.extend(emit_lifecycle_create(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        svc,
                    ));
                }
                WasmAccess::Read => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        false,
                    ));
                }
                WasmAccess::Write => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        true,
                    ));
                }
                WasmAccess::Pure => {
                    output.extend(emit_pure_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                    ));
                }
            }
        }
    } else {
        // Stateless mode: all methods are pure
        for method in &desc.methods {
            if method.skip_targets.contains(&"wasm".to_string()) || method.is_async {
                continue;
            }
            output.extend(emit_pure_method(
                desc,
                method,
                &effective_prefix,
                &type_ident,
            ));
        }
    }

    output
}

/// Emit the `thread_local!` registry for a service type.
fn emit_registry(_desc: &WasmDescriptor, _type_snake: &str, type_ident: &Ident) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", _desc.type_name.to_uppercase());
    quote! {
        ::std::thread_local! {
            static #registry_name: ::std::cell::RefCell<
                ::std::collections::HashMap<String, #type_ident>
            > = ::std::cell::RefCell::new(::std::collections::HashMap::new());
        }
    }
}

/// Emit `__with_read_{type_snake}` and `__with_write_{type_snake}` helpers.
fn emit_helpers(desc: &WasmDescriptor, _type_snake: &str, type_ident: &Ident) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let internal_snake = to_snake_case(&desc.type_name);
    let read_fn = format_ident!("__with_read_{}", internal_snake);
    let write_fn = format_ident!("__with_write_{}", internal_snake);

    quote! {
        fn #read_fn<F, R>(id: &str, f: F) -> Result<R, wasm_bindgen::JsError>
        where
            F: FnOnce(&#type_ident) -> Result<R, wasm_bindgen::JsError>,
        {
            #registry_name.with(|reg| {
                let map = reg.borrow();
                let instance = map.get(id).ok_or_else(|| {
                    wasm_bindgen::JsError::new(&format!("instance not found: {}", id))
                })?;
                f(instance)
            })
        }

        fn #write_fn<F, R>(id: &str, f: F) -> Result<R, wasm_bindgen::JsError>
        where
            F: FnOnce(&mut #type_ident) -> Result<R, wasm_bindgen::JsError>,
        {
            #registry_name.with(|reg| {
                let mut map = reg.borrow_mut();
                let instance = map.get_mut(id).ok_or_else(|| {
                    wasm_bindgen::JsError::new(&format!("instance not found: {}", id))
                })?;
                f(instance)
            })
        }
    }
}

/// Emit `{type_snake}_destroy` function.
fn emit_destroy(desc: &WasmDescriptor, type_snake: &str, _type_ident: &Ident) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let destroy_fn = if type_snake.is_empty() {
        format_ident!("destroy")
    } else {
        format_ident!("{}_destroy", type_snake)
    };

    quote! {
        #[wasm_bindgen]
        pub fn #destroy_fn(id: &str) -> Result<(), wasm_bindgen::JsError> {
            #registry_name.with(|reg| {
                let mut map = reg.borrow_mut();
                map.remove(id).ok_or_else(|| {
                    wasm_bindgen::JsError::new(&format!("instance not found: {}", id))
                })?;
                Ok(())
            })
        }
    }
}

/// Emit a lifecycle create function.
fn emit_lifecycle_create(
    desc: &WasmDescriptor,
    method: &WasmMethod,
    type_snake: &str,
    type_ident: &Ident,
    svc: &WasmServiceMeta,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let key_param = format_ident!("{}", svc.key_param);

    let (wasm_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // The key param comes first in the WASM function signature
    let mut all_wasm_params = vec![quote! { #key_param: &str }];
    all_wasm_params.extend(wasm_params);

    let method_ident = format_ident!("{}", method.name);

    // When the lifecycle create declares a return_type, the Rust constructor
    // returns `(Self, T)`. We destructure the tuple, store `Self` in the
    // registry, and serialize+return `T`. Without a return_type, the
    // constructor returns plain `Self` and we return `Ok(())`.
    let has_return_data = method.return_type.is_some();

    if has_return_data {
        // (Self, T) variant — destructure, store instance, return serialized data.
        let call_expr = if method.is_fallible {
            quote! {
                let (instance, data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (instance, data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[wasm_bindgen]
            pub fn #fn_name(#(#all_wasm_params),*) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> {
                #(#conversion_stmts)*
                #call_expr
                #registry_name.with(|reg| {
                    reg.borrow_mut().insert(#key_param.to_string(), instance);
                });
                Ok(serde::Serialize::serialize(
                    &data,
                    &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
                )
                .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?)
            }
        }
    } else {
        // Plain Self variant — store instance, return nothing.
        let call_expr = if method.is_fallible {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[wasm_bindgen]
            pub fn #fn_name(#(#all_wasm_params),*) -> Result<(), wasm_bindgen::JsError> {
                #(#conversion_stmts)*
                #call_expr
                #registry_name.with(|reg| {
                    reg.borrow_mut().insert(#key_param.to_string(), instance);
                });
                Ok(())
            }
        }
    }
}

/// Emit a pure (stateless) method.
fn emit_pure_method(
    _desc: &WasmDescriptor,
    method: &WasmMethod,
    type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let method_ident = format_ident!("{}", method.name);

    let (wasm_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let (return_type_tokens, result_conversion) =
        build_return_handling(&method.return_type, method.is_fallible);

    let call_expr = if method.is_fallible {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*)
                .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?;
        }
    } else {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*);
        }
    };

    quote! {
        #[wasm_bindgen]
        pub fn #fn_name(#(#wasm_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #call_expr
            #result_conversion
        }
    }
}

/// Emit a service method (read or write).
fn emit_service_method(
    desc: &WasmDescriptor,
    method: &WasmMethod,
    type_snake: &str,
    _type_ident: &Ident,
    is_write: bool,
) -> TokenStream {
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };

    // Get the key param name from the service meta
    let key_param_name = desc
        .service
        .as_ref()
        .map(|s| s.key_param.clone())
        .unwrap_or_else(|| "id".to_string());
    let key_param = format_ident!("{}", key_param_name);

    let (wasm_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // Key param comes first
    let mut all_wasm_params = vec![quote! { #key_param: &str }];
    all_wasm_params.extend(wasm_params);

    let (return_type_tokens, _result_conversion) = build_return_handling(
        &method.return_type,
        method.is_fallible || desc.service.is_some(),
    );

    let internal_snake = to_snake_case(&desc.type_name);
    let helper_fn = if is_write {
        format_ident!("__with_write_{}", internal_snake)
    } else {
        format_ident!("__with_read_{}", internal_snake)
    };

    let method_ident = format_ident!("{}", method.name);

    let inner_call = if is_write {
        if method.is_fallible {
            quote! {
                instance.#method_ident(#(#call_args),*)
                    .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?
            }
        } else {
            quote! {
                instance.#method_ident(#(#call_args),*)
            }
        }
    } else if method.is_fallible {
        quote! {
            instance.#method_ident(#(#call_args),*)
                .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?
        }
    } else {
        quote! {
            instance.#method_ident(#(#call_args),*)
        }
    };

    // For serde returns, we need to do the conversion inside the closure
    let needs_serde_return = method
        .return_type
        .as_ref()
        .map(|r| !is_direct_return(r))
        .unwrap_or(false);

    // For bytes-tuple returns, we need to destructure and convert inside the closure
    let needs_bytes_tuple_return = method
        .return_type
        .as_ref()
        .map(|r| r.is_bytes_tuple)
        .unwrap_or(false);

    let closure_body = if needs_serde_return {
        quote! {
            let result = #inner_call;
            serde::Serialize::serialize(
                &result,
                &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
            )
            .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))
        }
    } else if needs_bytes_tuple_return {
        quote! {
            let result = #inner_call;
            let (bytes, metadata) = result;
            let js_bytes = js_sys::Uint8Array::from(bytes.as_slice());
            let js_metadata = serde::Serialize::serialize(
                &metadata,
                &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
            )
            .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))?;
            let arr = js_sys::Array::new_with_length(2);
            arr.set(0, js_bytes.into());
            arr.set(1, js_metadata);
            Ok(arr.into())
        }
    } else {
        let has_return = method.return_type.is_some();
        if has_return {
            quote! {
                let result = #inner_call;
                Ok(result)
            }
        } else {
            quote! {
                #inner_call;
                Ok(())
            }
        }
    };

    quote! {
        #[wasm_bindgen]
        pub fn #fn_name(#(#all_wasm_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #helper_fn(#key_param, |instance| {
                #closure_body
            })
        }
    }
}

/// Build WASM parameter declarations, conversion statements, and call arguments.
fn build_params_and_conversions(
    params: &[WasmParam],
) -> (Vec<TokenStream>, Vec<TokenStream>, Vec<TokenStream>) {
    let mut wasm_params = Vec::new();
    let mut conversions = Vec::new();
    let mut call_args = Vec::new();

    for param in params {
        let param_ident = format_ident!("{}", param.name);

        match param.tag {
            WasmParamTag::Str => {
                // &str stays as &str, String stays as String
                if param.ty.starts_with('&') {
                    wasm_params.push(quote! { #param_ident: &str });
                    call_args.push(quote! { #param_ident });
                } else {
                    wasm_params.push(quote! { #param_ident: String });
                    call_args.push(quote! { #param_ident });
                }
            }
            WasmParamTag::Prim => {
                let ty_ident: TokenStream = param.ty.parse().unwrap_or_else(|_| quote! { u32 });
                wasm_params.push(quote! { #param_ident: #ty_ident });
                call_args.push(quote! { #param_ident });
            }
            WasmParamTag::Bytes => {
                if param.ty.starts_with('&') {
                    wasm_params.push(quote! { #param_ident: &[u8] });
                    call_args.push(quote! { #param_ident });
                } else {
                    wasm_params.push(quote! { #param_ident: Vec<u8> });
                    call_args.push(quote! { #param_ident });
                }
            }
            WasmParamTag::Serde => {
                let converted = format_ident!("{}_converted", param.name);

                // Detect Option<&str> pattern: needs special handling because
                // &str can't be deserialized from owned data.
                let normalized = param.ty.replace(' ', "");
                if normalized == "Option<&str>" {
                    let owned = format_ident!("{}_owned", param.name);
                    wasm_params.push(quote! { #param_ident: wasm_bindgen::JsValue });
                    conversions.push(quote! {
                        let #owned: Option<String> = serde_wasm_bindgen::from_value(#param_ident)
                            .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))?;
                        let #converted = #owned.as_deref();
                    });
                    call_args.push(quote! { #converted });
                    continue;
                }

                wasm_params.push(quote! { #param_ident: wasm_bindgen::JsValue });

                if param.ty.starts_with('&') {
                    let inner = param.ty.trim_start_matches('&').trim();
                    if inner.starts_with('[') && inner.ends_with(']') {
                        // Slice reference (&[T]) → deserialize as Vec<T>, auto-deref to &[T].
                        let elem = inner[1..inner.len() - 1].trim();
                        let vec_type_str = format!("Vec<{}>", elem);
                        let vec_ty: TokenStream =
                            vec_type_str.parse().unwrap_or_else(|_| quote! { Vec<_> });
                        conversions.push(quote! {
                            let #converted: #vec_ty = {
                                let __input_clone = #param_ident.clone();
                                match serde_wasm_bindgen::from_value(#param_ident) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        let err_str = e.to_string();
                                        if err_str.contains("missing field") {
                                            if let Ok(__value) = serde_wasm_bindgen::from_value::<serde_json::Value>(__input_clone) {
                                                return Err(wasm_bindgen::JsError::new(
                                                    &bridge_types::enhance_missing_field_error(&__value, &err_str)
                                                ));
                                            }
                                        }
                                        return Err(wasm_bindgen::JsError::new(&err_str));
                                    }
                                }
                            };
                        });
                    } else {
                        // Non-slice reference (&T) → deserialize into owned T.
                        // No type annotation: Rust infers the type from the method call.
                        conversions.push(quote! {
                            let #converted = {
                                let __input_clone = #param_ident.clone();
                                match serde_wasm_bindgen::from_value(#param_ident) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        let err_str = e.to_string();
                                        if err_str.contains("missing field") {
                                            if let Ok(__value) = serde_wasm_bindgen::from_value::<serde_json::Value>(__input_clone) {
                                                return Err(wasm_bindgen::JsError::new(
                                                    &bridge_types::enhance_missing_field_error(&__value, &err_str)
                                                ));
                                            }
                                        }
                                        return Err(wasm_bindgen::JsError::new(&err_str));
                                    }
                                }
                            };
                        });
                    }
                    call_args.push(quote! { &#converted });
                } else {
                    // Owned param: deserialize directly.
                    // No type annotation: Rust infers the type from the method call.
                    conversions.push(quote! {
                        let #converted = {
                            let __input_clone = #param_ident.clone();
                            match serde_wasm_bindgen::from_value(#param_ident) {
                                Ok(v) => v,
                                Err(e) => {
                                    let err_str = e.to_string();
                                    if err_str.contains("missing field") {
                                        if let Ok(__value) = serde_wasm_bindgen::from_value::<serde_json::Value>(__input_clone) {
                                            return Err(wasm_bindgen::JsError::new(
                                                &bridge_types::enhance_missing_field_error(&__value, &err_str)
                                            ));
                                        }
                                    }
                                    return Err(wasm_bindgen::JsError::new(&err_str));
                                }
                            }
                        };
                    });
                    call_args.push(quote! { #converted });
                }
            }
            WasmParamTag::Parse => {
                let converted = format_ident!("{}_converted", param.name);
                wasm_params.push(quote! { #param_ident: &str });
                conversions.push(quote! {
                    let #converted = bridge_types::BridgeParse::bridge_parse(#param_ident)
                        .map_err(|e| wasm_bindgen::JsError::new(&e))?;
                });
                // If the original type was a reference (&KeyId), pass a reference
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
        }
    }

    (wasm_params, conversions, call_args)
}

/// Build the return type token and the result conversion expression.
fn build_return_handling(
    return_type: &Option<ReturnInfo>,
    always_result: bool,
) -> (TokenStream, TokenStream) {
    match return_type {
        None => {
            // No return value (unit)
            if always_result {
                (
                    quote! { Result<(), wasm_bindgen::JsError> },
                    quote! { Ok(()) },
                )
            } else {
                (
                    quote! { Result<(), wasm_bindgen::JsError> },
                    quote! { Ok(()) },
                )
            }
        }
        Some(ret) => {
            if ret.is_string {
                (
                    quote! { Result<String, wasm_bindgen::JsError> },
                    quote! { Ok(result) },
                )
            } else if ret.is_prim {
                let ty: TokenStream = ret.ty.parse().unwrap_or_else(|_| quote! { u32 });
                (
                    quote! { Result<#ty, wasm_bindgen::JsError> },
                    quote! { Ok(result) },
                )
            } else if ret.is_bytes {
                (
                    quote! { Result<Vec<u8>, wasm_bindgen::JsError> },
                    quote! { Ok(result) },
                )
            } else if ret.is_bytes_tuple {
                // (Vec<u8>, T) → JS Array [Uint8Array, JsValue]
                // Bytes pass through as Uint8Array (no serde), T gets serde-serialized.
                (
                    quote! { Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> },
                    quote! {
                        {
                            let (bytes, metadata) = result;
                            let js_bytes = js_sys::Uint8Array::from(bytes.as_slice());
                            let js_metadata = serde::Serialize::serialize(
                                &metadata,
                                &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
                            )
                            .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))?;
                            let arr = js_sys::Array::new_with_length(2);
                            arr.set(0, js_bytes.into());
                            arr.set(1, js_metadata);
                            Ok(arr.into())
                        }
                    },
                )
            } else {
                // serde return
                (
                    quote! { Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> },
                    quote! {
                        serde::Serialize::serialize(
                            &result,
                            &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
                        )
                        .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))
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

    // --- Parsing tests ---

    fn parse_descriptor(tokens: &str) -> syn::Result<WasmDescriptor> {
        syn::parse_str::<WasmDescriptor>(tokens)
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
        assert_eq!(desc.methods[0].access, WasmAccess::LifecycleCreate);
        assert_eq!(desc.methods[0].name, "new");
        assert_eq!(desc.methods[1].access, WasmAccess::Read);
        assert_eq!(desc.methods[1].name, "get");
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
        assert_eq!(m.params[0].tag, WasmParamTag::Str);
        assert_eq!(m.params[0].name, "key");
        assert_eq!(m.params[1].tag, WasmParamTag::Prim);
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
        assert_eq!(m.params[0].tag, WasmParamTag::Parse);
        assert!(m.params[0].ty.contains("KeyId"));
    }

    // --- Code generation tests ---

    #[test]
    fn expand_produces_tokens() {
        let desc = WasmDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(WasmServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![WasmMethod {
                access: WasmAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![WasmParam {
                    name: "config".to_string(),
                    ty: "KvConfig".to_string(),
                    tag: WasmParamTag::Serde,
                }],
                return_type: None, // Self for lifecycle
                error_type: Some("KvError".to_string()),
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should contain the registry
        assert!(code.contains("__REGISTRY_KVSTORE"));
        // Should contain the create function
        assert!(code.contains("kv_store_new"));
        // Should contain destroy function
        assert!(code.contains("kv_store_destroy"));
    }

    #[test]
    fn expand_pure_method() {
        let desc = WasmDescriptor {
            type_name: "KvUtils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![WasmMethod {
                access: WasmAccess::Pure,
                name: "hash_key".to_string(),
                params: vec![WasmParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: WasmParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "u64".to_string(),
                    is_string: false,
                    is_prim: true,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(code.contains("kv_utils_hash_key"));
        // Pure + not fallible, but we still wrap in Result
        assert!(code.contains("Result"));
    }

    #[test]
    fn skip_wasm_method_is_excluded() {
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
            method write set_time {
                params { [prim] serial: f64, }
                return_type = ();
                skip wasm;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods.len(), 3);
        assert_eq!(desc.methods[2].skip_targets, vec!["wasm".to_string()]);

        let tokens = expand(&desc);
        let code = tokens.to_string();
        // set_time should be excluded from WASM output
        assert!(
            !code.contains("kv_store_set_time"),
            "set_time should be skipped for wasm but was found in output"
        );
        // get should still be included
        assert!(
            code.contains("kv_store_get"),
            "get should be present in wasm output"
        );
    }

    #[test]
    fn skip_targets_parsed_correctly() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
                skip tauri;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods[0].skip_targets, vec!["tauri".to_string()]);
        // This method targets tauri, not wasm, so it should NOT be filtered
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("kv_store_get"),
            "method with skip tauri should still appear in wasm output"
        );
    }

    #[test]
    fn skip_lifecycle_create_still_emits_registry() {
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
                skip wasm;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // When lifecycle create is skipped for this target, registry/helpers/destroy
        // should NOT be emitted — prevents duplicate definitions when multiple
        // descriptor groups share the same service type.
        assert!(
            !code.contains("__REGISTRY_KVSTORE"),
            "registry should NOT be emitted when lifecycle is skipped for wasm"
        );
        assert!(
            !code.contains("kv_store_new"),
            "create fn should not be emitted when lifecycle create is skipped"
        );
        assert!(
            !code.contains("kv_store_destroy"),
            "destroy fn should NOT be emitted when lifecycle is skipped for wasm"
        );
    }

    #[test]
    fn async_method_skipped_in_wasm() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            type_name = DbDriver;
            method pure list {
                params {}
                return_type = Vec<String>;
                error_type = DbError;
                fallible;
            }
            method pure query {
                params { [str] sql: &str, }
                return_type = Vec<String>;
                error_type = DbError;
                fallible;
                async;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods.len(), 2);
        assert!(!desc.methods[0].is_async, "list should be sync");
        assert!(desc.methods[1].is_async, "query should be async");

        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("db_driver_list"),
            "sync method 'list' should appear in WASM output"
        );
        assert!(
            !code.contains("db_driver_query"),
            "async method 'query' should NOT appear in WASM output"
        );
    }

    // --- Bytes-tuple return tests ---

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

    #[test]
    fn bytes_tuple_pure_method_codegen() {
        let desc = WasmDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![WasmMethod {
                access: WasmAccess::Pure,
                name: "get_data".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "(Vec<u8>, MutationMeta)".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: true,
                    serde_inner_ty: Some("MutationMeta".to_string()),
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("engine_get_data"),
            "expected function name in output"
        );
        // Should use Uint8Array for bytes and serde for metadata
        assert!(
            code.contains("Uint8Array"),
            "expected Uint8Array conversion in output: {}",
            code
        );
        assert!(
            code.contains("serde_wasm_bindgen"),
            "expected serde conversion for metadata: {}",
            code
        );
        assert!(
            code.contains("Array"),
            "expected JS Array construction: {}",
            code
        );
    }

    #[test]
    fn bytes_tuple_service_method_codegen() {
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
            method write apply_mutations {
                params {}
                return_type = (Vec<u8>, MutationMeta);
                error_type = EngineError;
                fallible;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        let method = &desc.methods[1];
        assert!(method.return_type.is_some());
        let ret = method.return_type.as_ref().unwrap();
        assert!(
            ret.is_bytes_tuple,
            "expected bytes_tuple return for service method"
        );

        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("engine_apply_mutations"),
            "expected method in output: {}",
            code
        );
        assert!(
            code.contains("Uint8Array"),
            "expected Uint8Array in service method output: {}",
            code
        );
    }

    // --- Map-as-Object serializer tests ---
    //
    // These guard against regression of the bug where pivot placements (and
    // every other internally-tagged enum or HashMap return) round-tripped to
    // JS as `Map`s instead of plain objects. Fix is to serialize via a
    // `Serializer` configured with `serialize_maps_as_objects(true)`. If
    // anyone reverts to bare `serde_wasm_bindgen::to_value(&x)` these tests
    // fail.

    fn assert_uses_object_serializer(code: &str) {
        assert!(
            code.contains("serialize_maps_as_objects"),
            "generated code must serialize through a Serializer with \
             .serialize_maps_as_objects(true). Got:\n{}",
            code
        );
        // No bare `to_value(&...)` for serde-return paths. (`from_value` is
        // JS→Rust deserialization, allowed to remain.)
        assert!(
            !code.contains("to_value (&"),
            "generated code must not call serde_wasm_bindgen::to_value \
             directly — use the configured Serializer. Got:\n{}",
            code
        );
    }

    #[test]
    fn pure_method_serde_return_uses_object_serializer() {
        let desc = WasmDescriptor {
            type_name: "PivotUtils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![WasmMethod {
                access: WasmAccess::Pure,
                name: "describe_placement".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "PivotFieldPlacement".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let code = expand(&desc).to_string();
        assert_uses_object_serializer(&code);
    }

    #[test]
    fn service_method_serde_return_uses_object_serializer() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = PivotEngine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params { [str] id: &str, }
                return_type = PivotTableConfig;
                error_type = PivotError;
                fallible;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        let code = expand(&desc).to_string();
        assert_uses_object_serializer(&code);
    }

    #[test]
    fn lifecycle_create_with_data_uses_object_serializer() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = PivotEngine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = PivotTableConfig;
                error_type = PivotError;
                fallible;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        let code = expand(&desc).to_string();
        assert_uses_object_serializer(&code);
    }

    #[test]
    fn bytes_tuple_pure_method_uses_object_serializer() {
        let desc = WasmDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![WasmMethod {
                access: WasmAccess::Pure,
                name: "get_data".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "(Vec<u8>, MutationMeta)".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: true,
                    serde_inner_ty: Some("MutationMeta".to_string()),
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let code = expand(&desc).to_string();
        assert_uses_object_serializer(&code);
    }

    #[test]
    fn bytes_tuple_service_method_uses_object_serializer() {
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
            method write apply_mutations {
                params {}
                return_type = (Vec<u8>, MutationMeta);
                error_type = EngineError;
                fallible;
            }
        "#;
        let desc: WasmDescriptor = syn::parse_str(input).unwrap();
        let code = expand(&desc).to_string();
        assert_uses_object_serializer(&code);
    }
}
