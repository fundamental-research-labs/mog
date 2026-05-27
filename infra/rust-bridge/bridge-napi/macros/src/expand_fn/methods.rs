use super::*;

pub(crate) fn emit_pure_method(
    _desc: &NapiDescriptor,
    method: &NapiMethod,
    type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let method_ident = format_ident!("{}", method.name);

    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let (return_type_tokens, result_conversion) =
        build_return_handling(&method.return_type, method.is_fallible);

    let call_expr = if method.is_fallible {
        if method.is_async {
            quote! {
                let result = #type_ident::#method_ident(#(#call_args),*).await
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let result = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        }
    } else if method.is_async {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*).await;
        }
    } else {
        quote! {
            let result = #type_ident::#method_ident(#(#call_args),*);
        }
    };

    let fn_keyword = if method.is_async {
        quote! { pub async fn }
    } else {
        quote! { pub fn }
    };

    quote! {
        #[napi_derive::napi]
        #fn_keyword #fn_name(#(#napi_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #call_expr
            #result_conversion
        }
    }
}

/// Emit a service method (read or write).
pub(super) fn emit_service_method(
    desc: &NapiDescriptor,
    method: &NapiMethod,
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

    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // Key param comes first
    let mut all_napi_params = vec![quote! { #key_param: String }];
    all_napi_params.extend(napi_params);

    let (return_type_tokens, _result_conversion) = build_return_handling(
        &method.return_type,
        method.is_fallible || desc.service.is_some(),
    );

    // Async service methods clone the service from the registry so the lock
    // isn't held across the await point. Sync methods use the closure-based
    // helper which borrows from the DashMap guard.
    if method.is_async {
        return emit_async_service_method(
            desc,
            method,
            &fn_name,
            &key_param,
            &all_napi_params,
            &conversion_stmts,
            &call_args,
            &return_type_tokens,
            is_write,
        );
    }

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
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?
            }
        } else {
            quote! {
                instance.#method_ident(#(#call_args),*)
            }
        }
    } else if method.is_fallible {
        quote! {
            instance.#method_ident(#(#call_args),*)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?
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

    // For plain bytes returns (Vec<u8>), we need to convert to Buffer inside the closure
    let needs_bytes_return = method
        .return_type
        .as_ref()
        .map(|r| r.is_bytes)
        .unwrap_or(false);

    let closure_body = if needs_serde_return {
        quote! {
            let result = #inner_call;
            serde_json::to_string(&result)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))
        }
    } else if needs_bytes_tuple_return {
        quote! {
            let result = #inner_call;
            let (bytes, metadata) = result;
            let meta_json = serde_json::to_string(&metadata)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            let json_bytes = meta_json.as_bytes();
            let mut packed = Vec::with_capacity(4 + bytes.len() + json_bytes.len());
            packed.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            packed.extend_from_slice(&bytes);
            packed.extend_from_slice(json_bytes);
            Ok(napi::bindgen_prelude::Buffer::from(packed))
        }
    } else if needs_bytes_return {
        quote! {
            let result = #inner_call;
            Ok(napi::bindgen_prelude::Buffer::from(result))
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
        #[napi_derive::napi]
        pub fn #fn_name(#(#all_napi_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #helper_fn(&#key_param, |instance| {
                #closure_body
            })
        }
    }
}

/// Emit an async service method.
///
/// Async service methods clone the service instance out of the registry so that
/// the DashMap guard is not held across an `.await` point. The cloned instance
/// is then used to call the async method.
#[allow(clippy::too_many_arguments)]
pub(super) fn emit_async_service_method(
    desc: &NapiDescriptor,
    method: &NapiMethod,
    fn_name: &Ident,
    key_param: &Ident,
    all_napi_params: &[TokenStream],
    conversion_stmts: &[TokenStream],
    call_args: &[TokenStream],
    return_type_tokens: &TokenStream,
    is_write: bool,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let method_ident = format_ident!("{}", method.name);

    // Clone the service out of the registry so we don't hold the lock across await.
    // For write access we remove-then-reinsert so the async fn gets an owned mutable copy.
    let clone_stmt = if is_write {
        quote! {
            let mut svc = {
                let entry = #registry_name.get(&#key_param).ok_or_else(|| {
                    napi::Error::from_reason(format!("instance not found: {}", #key_param))
                })?;
                entry.value().clone()
            };
        }
    } else {
        quote! {
            let svc = {
                let entry = #registry_name.get(&#key_param).ok_or_else(|| {
                    napi::Error::from_reason(format!("instance not found: {}", #key_param))
                })?;
                entry.value().clone()
            };
        }
    };

    let inner_call = if method.is_fallible {
        quote! {
            svc.#method_ident(#(#call_args),*).await
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?
        }
    } else {
        quote! {
            svc.#method_ident(#(#call_args),*).await
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

    let body = if needs_serde_return {
        quote! {
            let result = #inner_call;
            serde_json::to_string(&result)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))
        }
    } else if needs_bytes_tuple_return {
        quote! {
            let result = #inner_call;
            let (bytes, metadata) = result;
            let meta_json = serde_json::to_string(&metadata)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            let json_bytes = meta_json.as_bytes();
            let mut packed = Vec::with_capacity(4 + bytes.len() + json_bytes.len());
            packed.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            packed.extend_from_slice(&bytes);
            packed.extend_from_slice(json_bytes);
            Ok(napi::bindgen_prelude::Buffer::from(packed))
        }
    } else if needs_bytes_return {
        quote! {
            let result = #inner_call;
            Ok(napi::bindgen_prelude::Buffer::from(result))
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
        #[napi_derive::napi]
        pub async fn #fn_name(#(#all_napi_params),*) -> #return_type_tokens {
            #(#conversion_stmts)*
            #clone_stmt
            #body
        }
    }
}
