//! Free-function / service napi code generation. Emits the
//! `LazyLock<DashMap>` registry, `__with_read_*` / `__with_write_*`
//! helpers, destroy function, lifecycle create functions, and individual
//! pure / read / write / async service methods. Also hosts the
//! shared parameter-conversion and return-handling helpers reused by
//! `expand_class.rs`.

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

use crate::classify::{is_direct_return, to_snake_case};
use crate::ir::{
    NapiAccess, NapiDescriptor, NapiFieldTag, NapiMethod, NapiParam, NapiParamTag, NapiServiceMeta,
    NapiTaggedEnumSpec, NapiVariantField, NapiVariantSpec, ReturnInfo,
};

/// Top-level parser entry point. Parses the descriptor DSL token stream
/// emitted by bridge-core's `__bridge_descriptor_*` macros.
pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: NapiDescriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}

/// Main entry point: given a parsed `NapiDescriptor`, emit the full napi
/// binding code as a `TokenStream`.
pub(crate) fn expand(desc: &NapiDescriptor) -> TokenStream {
    let type_snake = to_snake_case(&desc.type_name);
    let type_ident = format_ident!("{}", desc.type_name);

    // Compute effective prefix for function naming
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),   // explicit empty = no prefix
        None => type_snake.clone(), // default behavior
    };

    let mut output = TokenStream::new();

    // Infrastructure: emit if ANY method declares lifecycle (ignore skips for gating)
    let declares_lifecycle = desc.methods.iter().any(|m| {
        matches!(
            m.access,
            NapiAccess::LifecycleCreate | NapiAccess::LifecycleCreateFrom { .. }
        )
    });

    if let Some(ref svc) = desc.service {
        if declares_lifecycle {
            output.extend(emit_registry(desc, &effective_prefix, &type_ident));
            output.extend(emit_helpers(desc, &effective_prefix, &type_ident));
            output.extend(emit_destroy(desc, &effective_prefix, &type_ident));
        }

        // Emit each method
        for method in &desc.methods {
            if method.skip_targets.contains(&"napi".to_string()) {
                continue;
            }
            match method.access {
                NapiAccess::LifecycleCreate => {
                    output.extend(emit_lifecycle_create(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        svc,
                    ));
                }
                NapiAccess::LifecycleCreateFrom { .. } => {
                    output.extend(emit_lifecycle_create(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        svc,
                    ));
                }
                NapiAccess::Read => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        false,
                    ));
                }
                NapiAccess::Write => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        true,
                    ));
                }
                NapiAccess::Pure => {
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
            if method.skip_targets.contains(&"napi".to_string()) {
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

/// Emit the `LazyLock<DashMap>` registry for a service type.
fn emit_registry(desc: &NapiDescriptor, _type_snake: &str, type_ident: &Ident) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    quote! {
        static #registry_name: ::std::sync::LazyLock<
            ::dashmap::DashMap<String, #type_ident>
        > = ::std::sync::LazyLock::new(::dashmap::DashMap::new);
    }
}

/// Emit `__with_read_{type_snake}` and `__with_write_{type_snake}` helpers.
fn emit_helpers(desc: &NapiDescriptor, _type_snake: &str, type_ident: &Ident) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let internal_snake = to_snake_case(&desc.type_name);
    let read_fn = format_ident!("__with_read_{}", internal_snake);
    let write_fn = format_ident!("__with_write_{}", internal_snake);

    quote! {
        fn #read_fn<F, R>(id: &str, f: F) -> napi::Result<R>
        where
            F: FnOnce(&#type_ident) -> napi::Result<R>,
        {
            let entry = #registry_name.get(id).ok_or_else(|| {
                napi::Error::from_reason(format!("instance not found: {}", id))
            })?;
            f(entry.value())
        }

        fn #write_fn<F, R>(id: &str, f: F) -> napi::Result<R>
        where
            F: FnOnce(&mut #type_ident) -> napi::Result<R>,
        {
            let mut entry = #registry_name.get_mut(id).ok_or_else(|| {
                napi::Error::from_reason(format!("instance not found: {}", id))
            })?;
            f(entry.value_mut())
        }
    }
}

/// Emit `{type_snake}_destroy` function.
fn emit_destroy(desc: &NapiDescriptor, type_snake: &str, _type_ident: &Ident) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let destroy_fn = if type_snake.is_empty() {
        format_ident!("destroy")
    } else {
        format_ident!("{}_destroy", type_snake)
    };

    quote! {
        #[napi_derive::napi]
        pub fn #destroy_fn(id: String) -> napi::Result<()> {
            #registry_name.remove(&id).ok_or_else(|| {
                napi::Error::from_reason(format!("instance not found: {}", id))
            })?;
            Ok(())
        }
    }
}

/// Emit a lifecycle create function.
fn emit_lifecycle_create(
    desc: &NapiDescriptor,
    method: &NapiMethod,
    type_snake: &str,
    type_ident: &Ident,
    svc: &NapiServiceMeta,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let key_param = format_ident!("{}", svc.key_param);

    // Filter out the key param from method params for the napi function signature —
    // the bridge always prepends `key_param: String` as the first napi parameter,
    // so including it again from the method's own params would cause a duplicate
    // binding error. However, we still need it in call_args so the constructor
    // receives the key value.
    let filtered_params: Vec<_> = method
        .params
        .iter()
        .filter(|p| p.name != svc.key_param)
        .cloned()
        .collect();
    let (napi_params, conversion_stmts, mut call_args) =
        build_params_and_conversions(&filtered_params);

    // If the constructor method explicitly takes the key param, re-insert it at
    // the front of call_args so the generated call passes it through.
    let method_has_key_param = method.params.iter().any(|p| p.name == svc.key_param);
    if method_has_key_param {
        call_args.insert(0, quote! { #key_param.clone() });
    }

    // The key param comes first in the napi function signature
    let mut all_napi_params = vec![quote! { #key_param: String }];
    all_napi_params.extend(napi_params);

    let method_ident = format_ident!("{}", method.name);

    // Check if the lifecycle create returns (Self, T)
    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        // (Self, T) variant: destructure the tuple, store instance in registry,
        // return the auxiliary data as a JSON string.
        let call_expr = if method.is_fallible {
            quote! {
                let (__instance, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (__instance, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi_derive::napi]
            pub fn #fn_name(#(#all_napi_params),*) -> napi::Result<String> {
                #(#conversion_stmts)*
                #call_expr
                #registry_name.insert(#key_param.to_string(), __instance);
                let __json = serde_json::to_string(&__data)
                    .map_err(|e| napi::Error::from_reason(e.to_string()))?;
                Ok(__json)
            }
        }
    } else {
        // Plain Self variant: store instance in registry, return ()
        let call_expr = if method.is_fallible {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi_derive::napi]
            pub fn #fn_name(#(#all_napi_params),*) -> napi::Result<()> {
                #(#conversion_stmts)*
                #call_expr
                #registry_name.insert(#key_param.to_string(), instance);
                Ok(())
            }
        }
    }
}

/// Emit a pure (stateless) method.
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
fn emit_service_method(
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
fn emit_async_service_method(
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

/// Build napi parameter declarations, conversion statements, and call arguments.
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

/// Emit the decode block that turns a JSON-string FFI param into a typed Rust
/// enum value, branching on the schema's discriminator tag. Only internally-
/// tagged enums are supported (`content: None` in the schema). For adjacent-
/// tagged enums (`#[serde(tag, content)]`) we fall back to a direct
/// `serde_json::from_str` call — serde already produces the correct wire shape
/// for those, and the explicit per-field decode adds no value in that branch.
fn emit_tagged_enum_decode(
    param_ty: &str,
    spec: &NapiTaggedEnumSpec,
    converted: &Ident,
    param_ident: &Ident,
) -> TokenStream {
    // Resolve the enum type token. `param.ty` may be `&AccessTarget` or
    // `AccessTarget` — strip the leading `&` for the decoded local binding.
    let enum_ty_str = param_ty.trim_start_matches('&').trim();
    let enum_ty: TokenStream = enum_ty_str.parse().unwrap_or_else(|_| quote! { _ });

    if spec.content.is_some() {
        // Adjacent-tagged enum — fall through to generic serde decode.
        return quote! {
            let #converted: #enum_ty = serde_json::from_str(&#param_ident)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
        };
    }

    let tag_lit = &spec.tag;
    let type_name = &spec.type_name;

    let variant_arms: Vec<TokenStream> = spec
        .variants
        .iter()
        .map(|v| emit_tagged_enum_variant_arm(&enum_ty, v))
        .collect();

    quote! {
        let #converted: #enum_ty = {
            let __raw: ::serde_json::Value = ::serde_json::from_str(&#param_ident)
                .map_err(|e| napi::Error::from_reason(format!("{}: {}", #type_name, e)))?;
            let __obj = __raw.as_object().ok_or_else(|| {
                napi::Error::from_reason(format!("{}: expected object with '{}' discriminator", #type_name, #tag_lit))
            })?;
            let __tag = __obj.get(#tag_lit).and_then(|v| v.as_str()).ok_or_else(|| {
                napi::Error::from_reason(format!("{}: missing string '{}' discriminator", #type_name, #tag_lit))
            })?;
            match __tag {
                #(#variant_arms)*
                other => {
                    return Err(napi::Error::from_reason(
                        format!("{}: unknown variant '{}'", #type_name, other),
                    ));
                }
            }
        };
    }
}

fn emit_tagged_enum_variant_arm(enum_ty: &TokenStream, v: &NapiVariantSpec) -> TokenStream {
    let wire = &v.wire_name;
    let variant_ident = format_ident!("{}", v.rust_name);

    if v.fields.is_empty() {
        return quote! {
            #wire => #enum_ty :: #variant_ident,
        };
    }

    let field_decodes: Vec<TokenStream> =
        v.fields.iter().map(emit_tagged_enum_field_decode).collect();

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

fn emit_tagged_enum_field_decode(f: &NapiVariantField) -> TokenStream {
    let rust_ident = format_ident!("{}", f.rust_name);
    let wire = &f.wire_name;

    match f.field_tag {
        NapiFieldTag::Str => quote! {
            let #rust_ident: String = __obj
                .get(#wire)
                .and_then(|v| v.as_str())
                .ok_or_else(|| napi::Error::from_reason(
                    format!("missing string field '{}'", #wire)
                ))?
                .to_string();
        },
        NapiFieldTag::Prim => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| napi::Error::from_reason(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        NapiFieldTag::Bytes => quote! {
            let #rust_ident: Vec<u8> = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| napi::Error::from_reason(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        NapiFieldTag::Serde => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().ok_or_else(|| napi::Error::from_reason(
                    format!("missing field '{}'", #wire)
                ))?
            ).map_err(|e| napi::Error::from_reason(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        NapiFieldTag::Parse => quote! {
            let #rust_ident = {
                let __s = __obj.get(#wire).and_then(|v| v.as_str()).ok_or_else(|| {
                    napi::Error::from_reason(format!("missing string field '{}'", #wire))
                })?;
                bridge_types::BridgeParse::bridge_parse(__s)
                    .map_err(|e| napi::Error::from_reason(e))?
            };
        },
    }
}

/// Build the return type token and the result conversion expression.
pub(crate) fn build_return_handling(
    return_type: &Option<ReturnInfo>,
    always_result: bool,
) -> (TokenStream, TokenStream) {
    match return_type {
        None => {
            // No return value (unit)
            if always_result {
                (quote! { napi::Result<()> }, quote! { Ok(()) })
            } else {
                (quote! { napi::Result<()> }, quote! { Ok(()) })
            }
        }
        Some(ret) => {
            if ret.is_string {
                (quote! { napi::Result<String> }, quote! { Ok(result) })
            } else if ret.is_prim {
                let ty: TokenStream = ret.ty.parse().unwrap_or_else(|_| quote! { u32 });
                (quote! { napi::Result<#ty> }, quote! { Ok(result) })
            } else if ret.is_bytes {
                (
                    quote! { napi::Result<napi::bindgen_prelude::Buffer> },
                    quote! { Ok(napi::bindgen_prelude::Buffer::from(result)) },
                )
            } else if ret.is_bytes_tuple {
                // (Vec<u8>, T) -> single packed Buffer
                // Layout: [4-byte LE binary_len][binary_bytes][json_string_bytes]
                // The TS side unpacks via unpackBytesTuple() in compute-backend-adapter.ts.
                // We pack into a single Buffer because napi-rs #[napi] class methods
                // do not support tuple return types like (Buffer, String).
                (
                    quote! { napi::Result<napi::bindgen_prelude::Buffer> },
                    quote! {
                        {
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
                    },
                )
            } else {
                // serde return -> JSON string
                (
                    quote! { napi::Result<String> },
                    quote! {
                        serde_json::to_string(&result)
                            .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))
                    },
                )
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::classify::classify_return;
    use crate::ir::{
        NapiAccess, NapiDescriptor, NapiFieldTag, NapiMethod, NapiParam, NapiParamTag,
        NapiServiceMeta, NapiTaggedEnumSpec, NapiVariantField, NapiVariantSpec, ReturnInfo,
    };

    fn parse_descriptor(tokens: &str) -> syn::Result<NapiDescriptor> {
        syn::parse_str::<NapiDescriptor>(tokens)
    }

    #[test]
    fn expand_produces_tokens() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![NapiParam {
                    name: "config".to_string(),
                    ty: "KvConfig".to_string(),
                    tag: NapiParamTag::Serde,
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
        assert!(
            code.contains("__REGISTRY_KVSTORE"),
            "expected registry in output: {}",
            code
        );
        // Should contain the create function
        assert!(
            code.contains("kv_store_new"),
            "expected create fn in output: {}",
            code
        );
        // Should contain destroy function
        assert!(
            code.contains("kv_store_destroy"),
            "expected destroy fn in output: {}",
            code
        );
    }

    #[test]
    fn expand_pure_method() {
        let desc = NapiDescriptor {
            type_name: "KvUtils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "hash_key".to_string(),
                params: vec![NapiParam {
                    name: "key".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "u64".to_string(),
                    is_string: false,
                    is_prim: true,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
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
            code.contains("kv_utils_hash_key"),
            "expected fn name in output: {}",
            code
        );
        // Should wrap in napi::Result
        assert!(code.contains("napi"), "expected napi in output: {}", code);
    }

    #[test]
    fn skip_napi_method_is_excluded() {
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
                skip napi;
            }
        "#;
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods.len(), 3);
        assert_eq!(desc.methods[2].skip_targets, vec!["napi".to_string()]);

        let tokens = expand(&desc);
        let code = tokens.to_string();
        // set_time should be excluded from napi output
        assert!(
            !code.contains("kv_store_set_time"),
            "set_time should be skipped for napi but was found in output"
        );
        // get should still be included
        assert!(
            code.contains("kv_store_get"),
            "get should be present in napi output"
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
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
        assert_eq!(desc.methods[0].skip_targets, vec!["tauri".to_string()]);
        // This method targets tauri, not napi, so it should NOT be filtered
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("kv_store_get"),
            "method with skip tauri should still appear in napi output"
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
                skip napi;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // lifecycle create is skipped, but registry/helpers/destroy are still emitted
        // because declares_lifecycle is true (the lifecycle method exists, just skipped)
        assert!(
            code.contains("__REGISTRY_KVSTORE"),
            "registry should be emitted when lifecycle is declared even if skipped"
        );
        assert!(
            !code.contains("kv_store_new"),
            "create fn should not be emitted when lifecycle create is skipped"
        );
        assert!(
            code.contains("kv_store_destroy"),
            "destroy fn should be emitted when lifecycle is declared even if skipped"
        );
    }

    #[test]
    fn bytes_tuple_pure_method_codegen() {
        let desc = NapiDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
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
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
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
        // Should use Buffer for bytes and serde_json for metadata
        assert!(
            code.contains("Buffer"),
            "expected Buffer conversion in output: {}",
            code
        );
        assert!(
            code.contains("serde_json"),
            "expected serde_json conversion for metadata: {}",
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
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
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
            code.contains("Buffer"),
            "expected Buffer in service method output: {}",
            code
        );
    }

    #[test]
    fn registry_uses_lazy_lock_dashmap() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Registry should use LazyLock<DashMap>
        assert!(
            code.contains("LazyLock"),
            "expected LazyLock in registry: {}",
            code
        );
        assert!(
            code.contains("DashMap"),
            "expected DashMap in registry: {}",
            code
        );
        // Should NOT contain thread_local
        assert!(
            !code.contains("thread_local"),
            "should not contain thread_local: {}",
            code
        );
    }

    #[test]
    fn str_tag_emits_string_param() {
        let desc = NapiDescriptor {
            type_name: "KvUtils".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "echo".to_string(),
                params: vec![NapiParam {
                    name: "input".to_string(),
                    ty: "&str".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // The function signature should take String, not &str
        assert!(
            code.contains("input : String"),
            "expected String param in output: {}",
            code
        );
        // The inner call should pass &input
        assert!(
            code.contains("& input"),
            "expected &input in call: {}",
            code
        );
    }

    #[test]
    fn bytes_tag_emits_buffer_type() {
        let desc = NapiDescriptor {
            type_name: "BlobStore".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "hash".to_string(),
                params: vec![NapiParam {
                    name: "data".to_string(),
                    ty: "&[u8]".to_string(),
                    tag: NapiParamTag::Bytes,
                }],
                return_type: Some(ReturnInfo {
                    ty: "u64".to_string(),
                    is_string: false,
                    is_prim: true,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should use napi::bindgen_prelude::Buffer for bytes param
        assert!(
            code.contains("Buffer"),
            "expected Buffer type for bytes param: {}",
            code
        );
        // Should convert using as_ref() for &[u8]
        assert!(
            code.contains("as_ref"),
            "expected as_ref() conversion for &[u8]: {}",
            code
        );
    }

    #[test]
    fn serde_return_uses_serde_json() {
        let desc = NapiDescriptor {
            type_name: "MyService".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "get_stats".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "StoreStats".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should use serde_json::to_string, not serde_wasm_bindgen::to_value
        assert!(
            code.contains("serde_json :: to_string"),
            "expected serde_json::to_string in output: {}",
            code
        );
        assert!(
            !code.contains("serde_wasm_bindgen"),
            "should not contain serde_wasm_bindgen: {}",
            code
        );
    }

    #[test]
    fn napi_derive_attribute_emitted() {
        let desc = NapiDescriptor {
            type_name: "Foo".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should contain #[napi_derive::napi] attribute
        assert!(
            code.contains("napi_derive :: napi"),
            "expected napi_derive::napi attribute in output: {}",
            code
        );
    }

    #[test]
    fn error_type_uses_napi_error() {
        let desc = NapiDescriptor {
            type_name: "Svc".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "id".to_string(),
            }),
            methods: vec![
                NapiMethod {
                    access: NapiAccess::LifecycleCreate,
                    name: "new".to_string(),
                    params: vec![],
                    return_type: None,
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
                NapiMethod {
                    access: NapiAccess::Read,
                    name: "get".to_string(),
                    params: vec![NapiParam {
                        name: "key".to_string(),
                        ty: "&str".to_string(),
                        tag: NapiParamTag::Str,
                    }],
                    return_type: Some(ReturnInfo {
                        ty: "String".to_string(),
                        is_string: true,
                        is_prim: false,
                        is_bytes: false,
                        is_unit: false,
                        is_bytes_tuple: false,
                        serde_inner_ty: None,
                        is_self_tuple: false,
                        self_tuple_inner_ty: None,
                    }),
                    error_type: Some("SvcError".to_string()),
                    is_fallible: true,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
            ],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should use napi::Error::from_reason for errors
        assert!(
            code.contains("napi :: Error :: from_reason"),
            "expected napi::Error::from_reason in output: {}",
            code
        );
        // Should use napi::Result return type
        assert!(
            code.contains("napi :: Result"),
            "expected napi::Result in output: {}",
            code
        );
        // Should NOT use JsError
        assert!(
            !code.contains("JsError"),
            "should not contain JsError: {}",
            code
        );
    }

    #[test]
    fn destroy_takes_string_param() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "store_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Destroy function should take String (owned), not &str
        assert!(
            code.contains("id : String"),
            "expected owned String param for destroy: {}",
            code
        );
    }

    #[test]
    fn fn_prefix_override() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: Some("kv".to_string()),
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "get".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should use custom prefix "kv_get" instead of "kv_store_get"
        assert!(
            code.contains("kv_get"),
            "expected kv_get with custom prefix: {}",
            code
        );
        assert!(
            !code.contains("kv_store_get"),
            "should not contain default prefix kv_store_get: {}",
            code
        );
    }

    #[test]
    fn fn_prefix_empty() {
        let desc = NapiDescriptor {
            type_name: "KvStore".to_string(),
            fn_prefix: Some(String::new()),
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "get".to_string(),
                params: vec![],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // With empty prefix, function name should just be "get"
        assert!(
            code.contains("fn get"),
            "expected bare fn name 'get' with empty prefix: {}",
            code
        );
    }

    #[test]
    fn bytes_return_emits_buffer() {
        let desc = NapiDescriptor {
            type_name: "Enc".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "encode".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "Vec<u8>".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: true,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Return type should be Buffer
        assert!(
            code.contains("Buffer"),
            "expected Buffer return type: {}",
            code
        );
        assert!(
            code.contains("Buffer :: from"),
            "expected Buffer::from conversion: {}",
            code
        );
    }

    #[test]
    fn serde_param_uses_serde_json_from_str() {
        let desc = NapiDescriptor {
            type_name: "Svc".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "process".to_string(),
                params: vec![NapiParam {
                    name: "config".to_string(),
                    ty: "MyConfig".to_string(),
                    tag: NapiParamTag::Serde,
                }],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Serde params should use serde_json::from_str
        assert!(
            code.contains("serde_json :: from_str"),
            "expected serde_json::from_str in output: {}",
            code
        );
        // Param should be String (JSON), not JsValue
        assert!(
            code.contains("config : String"),
            "expected String param for serde: {}",
            code
        );
        assert!(
            !code.contains("JsValue"),
            "should not contain JsValue: {}",
            code
        );
    }

    #[test]
    fn parse_tag_uses_string_param() {
        let desc = NapiDescriptor {
            type_name: "Svc".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "lookup".to_string(),
                params: vec![NapiParam {
                    name: "id".to_string(),
                    ty: "&KeyId".to_string(),
                    tag: NapiParamTag::Parse,
                }],
                return_type: None,
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Parse param should take String
        assert!(
            code.contains("id : String"),
            "expected String param for parse tag: {}",
            code
        );
        // Should use BridgeParse with &id
        assert!(
            code.contains("bridge_parse"),
            "expected bridge_parse call: {}",
            code
        );
    }

    #[test]
    fn service_key_param_is_string() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
        let desc: NapiDescriptor = syn::parse_str(input).unwrap();
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Service key param should be String (owned), not &str
        assert!(
            code.contains("store_id : String"),
            "expected owned String for service key param: {}",
            code
        );
    }

    // --- Async method codegen tests ---

    #[test]
    fn async_pure_method_emits_async_fn_and_await() {
        let desc = NapiDescriptor {
            type_name: "DbService".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "validate".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "bool".to_string(),
                    is_string: false,
                    is_prim: true,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: true,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should emit `pub async fn`
        assert!(
            code.contains("pub async fn db_service_validate"),
            "expected pub async fn: {}",
            code
        );
        // Should contain .await (token stream renders as ". await")
        assert!(
            code.contains(". await"),
            "expected .await in async method: {}",
            code
        );
    }

    #[test]
    fn async_pure_method_fallible_emits_await_before_map_err() {
        let desc = NapiDescriptor {
            type_name: "DbService".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "query".to_string(),
                params: vec![NapiParam {
                    name: "sql".to_string(),
                    ty: "String".to_string(),
                    tag: NapiParamTag::Str,
                }],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: Some("DbError".to_string()),
                is_fallible: true,
                is_async: true,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("pub async fn"),
            "expected pub async fn: {}",
            code
        );
        assert!(code.contains(". await"), "expected .await: {}", code);
        // .await should appear before .map_err (token stream renders as ". await")
        let await_pos = code.find(". await").unwrap();
        let map_err_pos = code.find("map_err").unwrap();
        assert!(await_pos < map_err_pos, "expected .await before .map_err");
    }

    #[test]
    fn sync_pure_method_unchanged_when_is_async_false() {
        let desc = NapiDescriptor {
            type_name: "DbService".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "version".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "String".to_string(),
                    is_string: true,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: false,
                    self_tuple_inner_ty: None,
                }),
                error_type: None,
                is_fallible: false,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should NOT emit `async`
        assert!(
            !code.contains("async"),
            "sync method should not contain async: {}",
            code
        );
        // Should NOT contain .await
        assert!(
            !code.contains(".await"),
            "sync method should not contain .await: {}",
            code
        );
    }

    #[test]
    fn async_service_method_clones_from_registry() {
        let desc = NapiDescriptor {
            type_name: "DbDriver".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "connection_id".to_string(),
            }),
            methods: vec![
                NapiMethod {
                    access: NapiAccess::LifecycleCreate,
                    name: "new".to_string(),
                    params: vec![],
                    return_type: None,
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
                NapiMethod {
                    access: NapiAccess::Read,
                    name: "query".to_string(),
                    params: vec![NapiParam {
                        name: "sql".to_string(),
                        ty: "String".to_string(),
                        tag: NapiParamTag::Str,
                    }],
                    return_type: Some(ReturnInfo {
                        ty: "String".to_string(),
                        is_string: true,
                        is_prim: false,
                        is_bytes: false,
                        is_unit: false,
                        is_bytes_tuple: false,
                        serde_inner_ty: None,
                        is_self_tuple: false,
                        self_tuple_inner_ty: None,
                    }),
                    error_type: Some("DbError".to_string()),
                    is_fallible: true,
                    is_async: true,
                    skip_targets: Vec::new(),
                },
            ],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // The async method should use `pub async fn`
        assert!(
            code.contains("pub async fn db_driver_query"),
            "expected pub async fn: {}",
            code
        );
        // Should clone from registry (not use closure helper)
        assert!(
            code.contains(". clone ()"),
            "expected .clone() from registry for async method: {}",
            code
        );
        // Should contain .await (token stream renders as ". await")
        assert!(
            code.contains(". await"),
            "expected .await in async service method: {}",
            code
        );
        // Lifecycle create should still be sync
        assert!(
            code.contains("pub fn db_driver_new"),
            "lifecycle create should remain sync: {}",
            code
        );
    }

    #[test]
    fn async_service_write_method_clones_mut() {
        let desc = NapiDescriptor {
            type_name: "DbDriver".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "connection_id".to_string(),
            }),
            methods: vec![
                NapiMethod {
                    access: NapiAccess::LifecycleCreate,
                    name: "new".to_string(),
                    params: vec![],
                    return_type: None,
                    error_type: None,
                    is_fallible: false,
                    is_async: false,
                    skip_targets: Vec::new(),
                },
                NapiMethod {
                    access: NapiAccess::Write,
                    name: "execute".to_string(),
                    params: vec![NapiParam {
                        name: "sql".to_string(),
                        ty: "String".to_string(),
                        tag: NapiParamTag::Str,
                    }],
                    return_type: None,
                    error_type: Some("DbError".to_string()),
                    is_fallible: true,
                    is_async: true,
                    skip_targets: Vec::new(),
                },
            ],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("pub async fn db_driver_execute"),
            "expected pub async fn: {}",
            code
        );
        // Should use `let mut svc` for write access
        assert!(
            code.contains("let mut svc"),
            "expected mutable clone for async write method: {}",
            code
        );
        assert!(code.contains(". await"), "expected .await: {}", code);
    }

    #[test]
    fn async_flag_parsed_from_descriptor() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = DbDriver;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read query {
                params { [str] sql: String, }
                return_type = String;
                error_type = DbError;
                fallible;
                async;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.methods.len(), 2);
        // Lifecycle create is NOT async
        assert!(
            !desc.methods[0].is_async,
            "lifecycle create should not be async"
        );
        // query IS async
        assert!(desc.methods[1].is_async, "query method should be async");
    }

    #[test]
    fn registry_lifecycle_create_self_tuple_returns_string() {
        let desc = NapiDescriptor {
            type_name: "Engine".to_string(),
            fn_prefix: None,
            service: Some(NapiServiceMeta {
                key_param: "engine_id".to_string(),
            }),
            methods: vec![NapiMethod {
                access: NapiAccess::LifecycleCreate,
                name: "new".to_string(),
                params: vec![],
                return_type: Some(ReturnInfo {
                    ty: "(Self, InitData)".to_string(),
                    is_string: false,
                    is_prim: false,
                    is_bytes: false,
                    is_unit: false,
                    is_bytes_tuple: false,
                    serde_inner_ty: None,
                    is_self_tuple: true,
                    self_tuple_inner_ty: Some("InitData".to_string()),
                }),
                error_type: None,
                is_fallible: true,
                is_async: false,
                skip_targets: Vec::new(),
            }],
        };
        let tokens = expand(&desc);
        let code = tokens.to_string();
        // Should return String (the serialized auxiliary data)
        assert!(
            code.contains("napi :: Result < String >"),
            "expected napi::Result<String> return for (Self, T) registry create: {}",
            code
        );
        // Should destructure the tuple
        assert!(
            code.contains("__instance"),
            "expected __instance destructure: {}",
            code
        );
        assert!(
            code.contains("__data"),
            "expected __data destructure: {}",
            code
        );
        // Should serialize with serde_json
        assert!(
            code.contains("serde_json :: to_string"),
            "expected serde_json::to_string: {}",
            code
        );
        // Should insert instance (not tuple) into registry
        assert!(
            code.contains("__instance"),
            "expected __instance in registry insert: {}",
            code
        );
    }

    #[test]
    fn tagged_enum_param_emits_kind_branch_decode() {
        let desc = NapiDescriptor {
            type_name: "Gate".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "check".to_string(),
                params: vec![NapiParam {
                    name: "target".to_string(),
                    ty: "AccessTarget".to_string(),
                    tag: NapiParamTag::TaggedEnum(NapiTaggedEnumSpec {
                        type_name: "AccessTarget".to_string(),
                        tag: "kind".to_string(),
                        content: None,
                        variants: vec![
                            NapiVariantSpec {
                                rust_name: "Workbook".to_string(),
                                wire_name: "workbook".to_string(),
                                fields: vec![],
                            },
                            NapiVariantSpec {
                                rust_name: "Sheet".to_string(),
                                wire_name: "sheet".to_string(),
                                fields: vec![NapiVariantField {
                                    rust_name: "sheet_id".to_string(),
                                    wire_name: "sheet_id".to_string(),
                                    field_tag: NapiFieldTag::Serde,
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
        // The FFI param should still be a String (JSON).
        assert!(
            code.contains("target : String"),
            "expected String FFI param: {}",
            code
        );
        // The decode should branch on the "kind" discriminator.
        assert!(code.contains("\"kind\""), "expected kind literal: {}", code);
        // The decode should reference both wire names.
        assert!(
            code.contains("\"workbook\""),
            "expected workbook arm: {}",
            code
        );
        assert!(code.contains("\"sheet\""), "expected sheet arm: {}", code);
        // And the rust enum path.
        assert!(
            code.contains("AccessTarget :: Workbook"),
            "expected constructed Workbook: {}",
            code
        );
        assert!(
            code.contains("AccessTarget :: Sheet"),
            "expected constructed Sheet: {}",
            code
        );
    }

    #[test]
    fn tagged_enum_param_with_content_key_falls_back_to_serde() {
        // content = Some(_) means adjacent tagging; generated code uses
        // serde_json::from_str directly.
        let desc = NapiDescriptor {
            type_name: "X".to_string(),
            fn_prefix: None,
            service: None,
            methods: vec![NapiMethod {
                access: NapiAccess::Pure,
                name: "probe".to_string(),
                params: vec![NapiParam {
                    name: "msg".to_string(),
                    ty: "Msg".to_string(),
                    tag: NapiParamTag::TaggedEnum(NapiTaggedEnumSpec {
                        type_name: "Msg".to_string(),
                        tag: "t".to_string(),
                        content: Some("c".to_string()),
                        variants: vec![NapiVariantSpec {
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
        // Adjacent-tagged decode falls through to serde_json::from_str.
        assert!(
            code.contains("serde_json :: from_str"),
            "expected serde_json::from_str fallback: {}",
            code
        );
        // No explicit "kind"-style branching for adjacent form.
        assert!(
            !code.contains("\"t\" => ") && !code.contains("__tag"),
            "should not emit discriminator branch for adjacent tag: {}",
            code
        );
    }
}
