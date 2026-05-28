use proc_macro2::Ident;
use syn::parse::{Parse, ParseStream};
use syn::{LitBool, Token, braced};

use super::ir::{Access, DelegateDescriptor, Method, Param, ParamTag, ReturnInfo, ServiceMeta};
use super::types::{classify_return, join_type_tokens};

impl Parse for DelegateDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // First, parse delegate config tokens (prepended by the descriptor macro's second arm)
        // delegate_target = ComputeService;
        // delegate_dispatch = dispatch;
        // delegate_gated = true;    (optional — B.1; defaults false)
        let mut target_type: Option<String> = None;
        let mut dispatch_field: Option<String> = None;
        let mut gated: bool = false;
        let mut skip_default_imports: bool = false;

        while input.peek(syn::Ident)
            && (peek_ident_eq(input, "delegate_target")
                || peek_ident_eq(input, "delegate_dispatch")
                || peek_ident_eq(input, "delegate_gated")
                || peek_ident_eq(input, "delegate_skip_default_imports"))
        {
            let kw: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            match kw.to_string().as_str() {
                "delegate_target" => {
                    let val: Ident = input.parse()?;
                    target_type = Some(val.to_string());
                }
                "delegate_dispatch" => {
                    let val: Ident = input.parse()?;
                    dispatch_field = Some(val.to_string());
                }
                "delegate_gated" => {
                    let b: LitBool = input.parse()?;
                    gated = b.value;
                }
                "delegate_skip_default_imports" => {
                    let b: LitBool = input.parse()?;
                    skip_default_imports = b.value;
                }
                _ => {}
            }
            let _: Token![;] = input.parse()?;
        }

        let target_type = target_type
            .ok_or_else(|| syn::Error::new(input.span(), "missing delegate_target = <Type>;"))?;
        let dispatch_field = dispatch_field
            .ok_or_else(|| syn::Error::new(input.span(), "missing delegate_dispatch = <field>;"))?;

        // Now parse the standard descriptor DSL
        // bridge_version = 1;
        let _: Ident = input.parse()?;
        let _: Token![=] = input.parse()?;
        let _version: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        let mut service: Option<ServiceMeta> = None;
        let mut source_type: Option<String> = None;
        let mut group = String::new();
        let mut fn_prefix: Option<String> = None;

        // group = identifier;
        if input.peek(syn::Ident) && peek_ident_eq(input, "group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let g: Ident = input.parse()?;
            group = g.to_string();
            let _: Token![;] = input.parse()?;
        }

        // Optional: fn_prefix = ident | _;
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
            source_type = Some(tn.to_string());
            let _: Token![;] = input.parse()?;
        }

        // Optional: service = TypeName; key_type = str; key_param = "param_name";
        if input.peek(syn::Ident) && peek_ident_eq(input, "service") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let svc_ident: Ident = input.parse()?;
            source_type = Some(svc_ident.to_string());
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

            service = Some(ServiceMeta {
                key_param: key_param_lit.value(),
            });
        }

        // Parse methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            let method = parse_method(input)?;
            methods.push(method);
        }

        let source_type = source_type.unwrap_or_else(|| "Unknown".to_string());

        Ok(DelegateDescriptor {
            target_type,
            dispatch_field,
            gated,
            skip_default_imports,
            source_type,
            group,
            fn_prefix,
            service,
            methods,
        })
    }
}

fn peek_ident_eq(input: ParseStream, expected: &str) -> bool {
    input
        .fork()
        .parse::<Ident>()
        .map(|i| i == expected)
        .unwrap_or(false)
}

fn parse_method(input: ParseStream) -> syn::Result<Method> {
    let kind_ident: Ident = input.parse()?;
    let kind_str = kind_ident.to_string();
    let span = kind_ident.span();

    let (access, name) = match kind_str.as_str() {
        "lifecycle" => {
            let lifecycle_kind: Ident = input.parse()?;
            if lifecycle_kind != "create" {
                return Err(syn::Error::new(
                    lifecycle_kind.span(),
                    format!("unknown lifecycle kind: {}", lifecycle_kind),
                ));
            }
            let method_name: Ident = input.parse()?;
            (Access::LifecycleCreate, method_name.to_string())
        }
        "method" => {
            let access_ident: Ident = input.parse()?;
            let access = match access_ident.to_string().as_str() {
                "pure" => Access::Pure,
                "read" => Access::Read,
                "write" => Access::Write,
                "structural" => Access::Structural,
                "session" => Access::Session,
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
    let mut scope: Option<String> = None;
    let mut needs_principal = false;

    while !content.is_empty() {
        // `async` is a Rust keyword so syn::Ident won't parse it —
        // check for it explicitly before falling through to Ident parsing.
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
                return_type = Some(info);
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
            "scope" => {
                let _: Token![=] = content.parse()?;
                let lit: syn::LitStr = content.parse()?;
                let _: Token![;] = content.parse()?;
                scope = Some(lit.value());
            }
            "needs_principal" => {
                let _: Token![;] = content.parse()?;
                needs_principal = true;
            }
            "skip" => {
                let target: Ident = content.parse()?;
                let _: Token![;] = content.parse()?;
                skip_targets.push(target.to_string());
            }
            other => {
                return Err(syn::Error::new(
                    kw.span(),
                    format!("unexpected keyword: '{}'", other),
                ));
            }
        }
    }

    Ok(Method {
        access,
        name,
        params,
        return_type,
        error_type,
        is_fallible,
        is_async,
        skip_targets,
        scope,
        needs_principal,
        span,
    })
}

fn parse_params(input: ParseStream) -> syn::Result<Vec<Param>> {
    let mut params = Vec::new();
    while !input.is_empty() {
        let tag_content;
        syn::bracketed!(tag_content in input);
        let tag_ident: Ident = tag_content.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => ParamTag::Str,
            "prim" => ParamTag::Prim,
            "bytes" => ParamTag::Bytes,
            "serde" => ParamTag::Serde,
            "parse" => ParamTag::Parse,
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!("unknown param tag: {}", other),
                ));
            }
        };
        let name: Ident = input.parse()?;
        let _: Token![:] = input.parse()?;
        let ty_str = parse_type_until_comma_or_end(input)?;
        if input.peek(Token![,]) {
            let _: Token![,] = input.parse()?;
        }
        params.push(Param {
            name: name.to_string(),
            ty: ty_str,
            tag,
        });
    }
    Ok(params)
}

fn parse_type_until_semicolon(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    let mut angle_depth: i32 = 0;
    while !input.is_empty() {
        if angle_depth == 0 && input.peek(Token![;]) {
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

fn parse_type_until_comma_or_end(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    let mut angle_depth: i32 = 0;
    while !input.is_empty() {
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
