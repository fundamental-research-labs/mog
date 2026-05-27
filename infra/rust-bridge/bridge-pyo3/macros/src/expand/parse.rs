use super::*;

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
