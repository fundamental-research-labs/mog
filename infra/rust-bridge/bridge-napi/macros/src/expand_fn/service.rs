use super::*;

pub(super) fn emit_registry(
    desc: &NapiDescriptor,
    _type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    quote! {
        static #registry_name: ::std::sync::LazyLock<
            ::dashmap::DashMap<String, #type_ident>
        > = ::std::sync::LazyLock::new(::dashmap::DashMap::new);
    }
}

/// Emit `__with_read_{type_snake}` and `__with_write_{type_snake}` helpers.
pub(super) fn emit_helpers(
    desc: &NapiDescriptor,
    _type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
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
pub(super) fn emit_destroy(
    desc: &NapiDescriptor,
    type_snake: &str,
    _type_ident: &Ident,
) -> TokenStream {
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
pub(super) fn emit_lifecycle_create(
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
