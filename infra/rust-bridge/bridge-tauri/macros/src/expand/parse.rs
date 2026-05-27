use super::*;

fn try_peek_ident(input: ParseStream) -> Option<String> {
    let fork = input.fork();
    fork.parse::<Ident>().ok().map(|i| i.to_string())
}

impl Parse for TauriDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // Optional: security_level = Ident;
        // This is prepended by the generate! macro's second arm via the
        // descriptor macro's ($gen:path, $($extra:tt)*) arm.
        let security_level = if try_peek_ident(input).as_deref() == Some("security_level") {
            let _: Ident = input.parse()?; // "security_level"
            let _: Token![=] = input.parse()?;
            let level: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;
            Some(level)
        } else {
            None
        };

        // bridge_version = 1;
        let _: Ident = input.parse()?; // "bridge_version"
        let _: Token![=] = input.parse()?;
        let _: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        // group = identifier; (always present)
        let group = if try_peek_ident(input).as_deref() == Some("group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let g: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;
            g
        } else {
            Ident::new("default", Span::call_site())
        };

        // Optional: fn_prefix = ident;
        // `fn_prefix = _;` means empty (no prefix), `fn_prefix = foo;` means use "foo".
        let fn_prefix = if try_peek_ident(input).as_deref() == Some("fn_prefix") {
            let _: Ident = input.parse()?; // "fn_prefix"
            let _: Token![=] = input.parse()?;
            if input.peek(Token![_]) {
                let _: Token![_] = input.parse()?;
                let _: Token![;] = input.parse()?;
                Some(String::new())
            } else {
                let prefix_ident: Ident = input.parse()?;
                let _: Token![;] = input.parse()?;
                Some(prefix_ident.to_string())
            }
        } else {
            None
        };

        // Optional: type_name = TypeName; (emitted for stateless/non-service APIs)
        let mut type_name: Option<Ident> = None;
        if try_peek_ident(input).as_deref() == Some("type_name") {
            let _: Ident = input.parse()?; // "type_name"
            let _: Token![=] = input.parse()?;
            type_name = Some(input.parse()?);
            let _: Token![;] = input.parse()?;
        }

        // Optional: service = TypeName; key_type = str; key_param = "store_id";
        let (service, svc_type_name) = parse_service_header(input)?;
        // Service name takes precedence over type_name
        let type_name = svc_type_name.or(type_name);

        // Methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            methods.push(parse_method(input)?);
        }

        // For stateless descriptors, the type name is not in the token body
        // (it only appears in the macro name). Use "_" as a sentinel so we
        // know not to add a type prefix to generated function names.
        let type_name = type_name.unwrap_or_else(|| Ident::new("_", Span::call_site()));

        Ok(TauriDescriptor {
            group,
            fn_prefix,
            type_name,
            service,
            methods,
            security_level,
        })
    }
}

/// Parse optional service header, returning (service_meta, type_name).
fn parse_service_header(
    input: ParseStream,
) -> syn::Result<(Option<TauriServiceMeta>, Option<Ident>)> {
    // Check if next token is the ident "service"
    if try_peek_ident(input).as_deref() == Some("service") {
        let _: Ident = input.parse()?; // "service"
        let _: Token![=] = input.parse()?;
        let type_name: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        // key_type = str;
        let _kt_ident: Ident = input.parse()?; // "key_type"
        let _: Token![=] = input.parse()?;
        let _key_type: Ident = input.parse()?; // "str" (always use String for Tauri)
        let _: Token![;] = input.parse()?;

        // key_param = "store_id";
        let _kp_ident: Ident = input.parse()?; // "key_param"
        let _: Token![=] = input.parse()?;
        let key_param: LitStr = input.parse()?;
        let _: Token![;] = input.parse()?;

        return Ok((
            Some(TauriServiceMeta {
                key_param: key_param.value(),
            }),
            Some(type_name),
        ));
    }
    Ok((None, None))
}

fn parse_method(input: ParseStream) -> syn::Result<TauriMethod> {
    // Either: "lifecycle create method_name { ... }"
    // Or:     "method (pure|read|write) method_name { ... }"
    let keyword: Ident = input.parse()?;
    let access = match keyword.to_string().as_str() {
        "lifecycle" => {
            let kind: Ident = input.parse()?;
            match kind.to_string().as_str() {
                "create" => TauriAccess::LifecycleCreate,
                "create_from" => {
                    let variant_name: Ident = input.parse()?;
                    TauriAccess::LifecycleCreateFrom {
                        variant_name: variant_name.to_string(),
                    }
                }
                other => {
                    return Err(syn::Error::new(
                        kind.span(),
                        format!("expected 'create' or 'create_from', got '{}'", other),
                    ));
                }
            }
        }
        "method" => {
            let access_ident: Ident = input.parse()?;
            match access_ident.to_string().as_str() {
                "pure" => TauriAccess::Pure,
                "read" => TauriAccess::Read,
                "write" => TauriAccess::Write,
                // R2.4 added `session` for `&self` interior-mutable methods
                // (e.g. `set_active_principal`). Tauri commands are plain
                // functions that take service state by shared reference, so
                // `session` behaves like `read` here — same FFI shape, no
                // mut borrow.
                "session" => TauriAccess::Read,
                other => {
                    return Err(syn::Error::new(
                        access_ident.span(),
                        format!("expected pure/read/write/session, got '{}'", other),
                    ));
                }
            }
        }
        other => {
            return Err(syn::Error::new(
                keyword.span(),
                format!("expected 'lifecycle' or 'method', got '{}'", other),
            ));
        }
    };

    let name: Ident = input.parse()?;

    let body;
    braced!(body in input);

    // params { ... }
    let _params_kw: Ident = body.parse()?; // "params"
    let params_body;
    braced!(params_body in body);
    let mut params = Vec::new();
    while !params_body.is_empty() {
        params.push(parse_param(&params_body)?);
    }

    // return_type = Type;
    let _rt_kw: Ident = body.parse()?; // "return_type"
    let _: Token![=] = body.parse()?;
    let return_ty: Type = body.parse()?;
    let _: Token![;] = body.parse()?;

    let is_unit = is_unit_type(&return_ty);

    // Optional: error_type = Type;
    let mut is_fallible = false;
    if try_peek_ident(&body).as_deref() == Some("error_type") {
        let _: Ident = body.parse()?; // "error_type"
        let _: Token![=] = body.parse()?;
        let _error_ty: Type = body.parse()?;
        let _: Token![;] = body.parse()?;
    }

    // Optional: fallible;
    if try_peek_ident(&body).as_deref() == Some("fallible") {
        let _: Ident = body.parse()?;
        let _: Token![;] = body.parse()?;
        is_fallible = true;
    }

    // Optional: async;
    let mut is_async = false;
    if body.peek(Token![async]) {
        let _: Token![async] = body.parse()?;
        let _: Token![;] = body.parse()?;
        is_async = true;
    }

    // Optional: skip <target>;  (may appear multiple times)
    let mut skip_targets = Vec::new();
    while try_peek_ident(&body).as_deref() == Some("skip") {
        let _: Ident = body.parse()?;
        let target: Ident = body.parse()?;
        let _: Token![;] = body.parse()?;
        skip_targets.push(target.to_string());
    }

    let is_bytes = if !is_unit {
        is_vec_u8(&return_ty)
    } else {
        false
    };
    let (is_bytes_tuple, serde_inner_ty) = if !is_unit && !is_bytes {
        match extract_bytes_tuple_inner(&return_ty) {
            Some(inner) => (true, Some(inner)),
            None => (false, None),
        }
    } else {
        (false, None)
    };
    let (is_self_tuple, self_tuple_inner_ty) = if !is_unit && !is_bytes && !is_bytes_tuple {
        match extract_self_tuple_inner(&return_ty) {
            Some(inner) => (true, Some(inner)),
            None => (false, None),
        }
    } else {
        (false, None)
    };

    let return_info = ReturnInfo {
        ty: if is_unit { None } else { Some(return_ty) },
        is_bytes,
        is_bytes_tuple,
        serde_inner_ty,
        is_self_tuple,
        self_tuple_inner_ty,
    };

    Ok(TauriMethod {
        access,
        name,
        params,
        return_info,
        is_fallible,
        is_async,
        skip_targets,
    })
}

fn parse_param(input: ParseStream) -> syn::Result<TauriParam> {
    // [tag] name: Type,
    let tag_content;
    bracketed!(tag_content in input);
    let tag_ident: Ident = tag_content.parse()?;
    let tag = match tag_ident.to_string().as_str() {
        "str" => TauriParamTag::Str,
        "prim" => TauriParamTag::Prim,
        "bytes" => TauriParamTag::Bytes,
        "serde" => TauriParamTag::Serde,
        "parse" => TauriParamTag::Parse,
        other => {
            return Err(syn::Error::new(
                tag_ident.span(),
                format!("unknown param tag: '{}'", other),
            ));
        }
    };

    let name: Ident = input.parse()?;
    let _: Token![:] = input.parse()?;
    let ty: Type = input.parse()?;
    let _: Token![,] = input.parse()?;

    let is_ref = matches!(&ty, Type::Reference(_));

    Ok(TauriParam {
        name,
        original_ty: ty,
        tag,
        is_ref,
    })
}
