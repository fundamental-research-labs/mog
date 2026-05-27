use super::*;

use super::tagged_enum::emit_tagged_enum_decode;

pub(crate) fn build_params_and_conversions(
    params: &[NapiParam],
) -> (Vec<TokenStream>, Vec<TokenStream>, Vec<TokenStream>) {
    let mut napi_params = Vec::new();
    let mut conversions = Vec::new();
    let mut call_args = Vec::new();

    for param in params {
        let param_ident = format_ident!("{}", param.name);

        match &param.tag {
            NapiParamTag::Str => {
                // napi FFI: always take String (owned). If the inner Rust
                // call needs &str, pass &param; if it needs String, pass directly.
                napi_params.push(quote! { #param_ident: String });
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#param_ident });
                } else {
                    call_args.push(quote! { #param_ident });
                }
            }
            NapiParamTag::Prim => {
                let ty_ident: TokenStream = param.ty.parse().unwrap_or_else(|_| quote! { u32 });
                napi_params.push(quote! { #param_ident: #ty_ident });
                call_args.push(quote! { #param_ident });
            }
            NapiParamTag::Bytes => {
                // napi FFI: always take Buffer. Convert to &[u8] or Vec<u8>
                // depending on the original type.
                napi_params.push(quote! { #param_ident: napi::bindgen_prelude::Buffer });
                if param.ty.starts_with('&') {
                    call_args.push(quote! { #param_ident.as_ref() });
                } else {
                    call_args.push(quote! { #param_ident.to_vec() });
                }
            }
            NapiParamTag::Serde => {
                let converted = format_ident!("{}_converted", param.name);

                // Detect Option<&str> pattern: needs special handling because
                // &str can't be deserialized from owned data.
                let normalized = param.ty.replace(' ', "");
                if normalized == "Option<&str>" {
                    let owned = format_ident!("{}_owned", param.name);
                    napi_params.push(quote! { #param_ident: String });
                    conversions.push(quote! {
                        let #owned: Option<String> = serde_json::from_str(&#param_ident)
                            .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
                        let #converted = #owned.as_deref();
                    });
                    call_args.push(quote! { #converted });
                    continue;
                }

                napi_params.push(quote! { #param_ident: String });

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
                                        return Err(napi::Error::from_reason(
                                            bridge_types::enhance_missing_field_error(&__value, &e)
                                        ));
                                    }
                                    return Err(napi::Error::from_reason(bridge_types::bridge_format_err!(e)));
                                }
                                Err(e) => return Err(napi::Error::from_reason(bridge_types::bridge_format_err!(e))),
                            };
                        });
                    } else {
                        // Non-slice reference (&T) -> deserialize into owned T.
                        // No type annotation: Rust infers the type from the method call.
                        conversions.push(quote! {
                            let #converted = match serde_json::from_str(&#param_ident) {
                                Ok(v) => v,
                                Err(e) if e.to_string().contains("missing field") => {
                                    if let Ok(__value) = serde_json::from_str::<serde_json::Value>(&#param_ident) {
                                        return Err(napi::Error::from_reason(
                                            bridge_types::enhance_missing_field_error(&__value, &e)
                                        ));
                                    }
                                    return Err(napi::Error::from_reason(bridge_types::bridge_format_err!(e)));
                                }
                                Err(e) => return Err(napi::Error::from_reason(bridge_types::bridge_format_err!(e))),
                            };
                        });
                    }
                    call_args.push(quote! { &#converted });
                } else {
                    // Owned param: deserialize directly.
                    // No type annotation: Rust infers the type from the method call.
                    conversions.push(quote! {
                        let #converted = match serde_json::from_str(&#param_ident) {
                            Ok(v) => v,
                            Err(e) if e.to_string().contains("missing field") => {
                                if let Ok(__value) = serde_json::from_str::<serde_json::Value>(&#param_ident) {
                                    return Err(napi::Error::from_reason(
                                        bridge_types::enhance_missing_field_error(&__value, &e)
                                    ));
                                }
                                return Err(napi::Error::from_reason(bridge_types::bridge_format_err!(e)));
                            }
                            Err(e) => return Err(napi::Error::from_reason(bridge_types::bridge_format_err!(e))),
                        };
                    });
                    call_args.push(quote! { #converted });
                }
            }
            NapiParamTag::Parse => {
                let converted = format_ident!("{}_converted", param.name);
                napi_params.push(quote! { #param_ident: String });
                conversions.push(quote! {
                    let #converted = bridge_types::BridgeParse::bridge_parse(&#param_ident)
                        .map_err(|e| napi::Error::from_reason(e))?;
                });
                // If the original type was a reference (&KeyId), pass a reference
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
            NapiParamTag::TaggedEnum(spec) => {
                let converted = format_ident!("{}_converted", param.name);
                napi_params.push(quote! { #param_ident: String });
                let decode = emit_tagged_enum_decode(&param.ty, spec, &converted, &param_ident);
                conversions.push(decode);
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
        }
    }

    (napi_params, conversions, call_args)
}
