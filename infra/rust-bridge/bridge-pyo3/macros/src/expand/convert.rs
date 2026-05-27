use super::*;

pub(super) fn build_params_and_conversions(
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
pub(super) fn build_pyo3_return_type(ret: &ReturnInfo) -> TokenStream {
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
pub(super) fn build_return_handling(
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
