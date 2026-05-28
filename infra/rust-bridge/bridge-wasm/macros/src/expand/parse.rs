//! Parser for the WASM descriptor DSL.

use proc_macro2::Ident;
use syn::parse::{Parse, ParseStream};
use syn::{Token, braced};

use super::ir::{
    ReturnInfo, WasmAccess, WasmDescriptor, WasmMethod, WasmParam, WasmParamTag, WasmServiceMeta,
};
use super::types::classify_return;

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
