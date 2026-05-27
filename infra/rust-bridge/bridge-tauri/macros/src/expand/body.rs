use super::*;

pub(super) fn build_method_body(
    desc: &TauriDescriptor,
    method: &TauriMethod,
    call_args: &[TokenStream],
    parse_stmts: &[TokenStream],
) -> TokenStream {
    // Async methods use a separate code path that avoids holding RwLock
    // guards across `.await` points.
    if method.is_async {
        return build_async_method_body(desc, method, call_args, parse_stmts);
    }

    let type_name = &desc.type_name;
    let method_name = &method.name;

    let parse_block = if parse_stmts.is_empty() {
        TokenStream::new()
    } else {
        quote! { #(#parse_stmts)* }
    };

    match method.access {
        TauriAccess::Pure => {
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*) };
            let wrapped = wrap_with_catch_unwind(call_expr, method.is_fallible);
            quote! {
                #parse_block
                #wrapped
            }
        }
        TauriAccess::LifecycleCreate => {
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*) };
            let returns_self_tuple = method.return_info.is_self_tuple;

            // Clone the key before the constructor call, since the constructor
            // may consume the key parameter (e.g. `new(instance_id: String)`).
            if method.is_fallible {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let (instance, __data) = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let instance = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            } else {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let (instance, __data) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let instance = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            }
        }
        TauriAccess::LifecycleCreateFrom { .. } => {
            // Same behavior as LifecycleCreate — creates instance, stores in registry
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*) };
            let returns_self_tuple = method.return_info.is_self_tuple;

            if method.is_fallible {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let (instance, __data) = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let instance = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            } else {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let (instance, __data) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let instance = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            }
        }
        TauriAccess::Read => {
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let inner_call = quote! { svc.#method_name(#(#call_args),*) };

            if method.is_fallible {
                quote! {
                    #parse_block
                    state.with_read(&#key_param_ident, |svc| {
                        #inner_call
                    })?
                    .map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    state.with_read(&#key_param_ident, |svc| {
                        #inner_call
                    })
                }
            }
        }
        TauriAccess::Write => {
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let inner_call = quote! { svc.#method_name(#(#call_args),*) };

            if method.is_fallible {
                quote! {
                    #parse_block
                    state.with_write(&#key_param_ident, |svc| {
                        #inner_call
                    })?
                    .map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    state.with_write(&#key_param_ident, |svc| {
                        #inner_call
                    })
                }
            }
        }
    }
}

/// Build the body of an async method.
///
/// For service methods (Read/Write), we clone the service out of the registry
/// so the lock is released before the `.await`.  For pure (stateless) methods
/// we simply call the associated function with `.await`.
pub(super) fn build_async_method_body(
    desc: &TauriDescriptor,
    method: &TauriMethod,
    call_args: &[TokenStream],
    parse_stmts: &[TokenStream],
) -> TokenStream {
    let type_name = &desc.type_name;
    let method_name = &method.name;

    let parse_block = if parse_stmts.is_empty() {
        TokenStream::new()
    } else {
        quote! { #(#parse_stmts)* }
    };

    match method.access {
        TauriAccess::Pure => {
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*).await };
            if method.is_fallible {
                quote! {
                    #parse_block
                    #call_expr.map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    Ok(#call_expr)
                }
            }
        }
        TauriAccess::Read | TauriAccess::Write => {
            // Both read and write async methods use clone_for_async.
            // The service manages its own internal mutability (e.g. via Arc<Mutex>).
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let inner_call = quote! { svc.#method_name(#(#call_args),*).await };

            if method.is_fallible {
                quote! {
                    #parse_block
                    let svc = state.clone_for_async(&#key_param_ident)?;
                    #inner_call.map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    let svc = state.clone_for_async(&#key_param_ident)?;
                    Ok(#inner_call)
                }
            }
        }
        TauriAccess::LifecycleCreate | TauriAccess::LifecycleCreateFrom { .. } => {
            // Lifecycle create/create_from is unlikely to be async, but handle it
            // for completeness. Fall back to the same pattern as sync — lifecycle
            // creates don't hold the lock across the call anyway.
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*).await };
            let returns_self_tuple = method.return_info.is_self_tuple;

            if method.is_fallible {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let (instance, __data) = #call_expr.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let instance = #call_expr.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(())
                    }
                }
            } else {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let (instance, __data) = #call_expr;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let instance = #call_expr;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(())
                    }
                }
            }
        }
    }
}

pub(super) fn wrap_with_catch_unwind(call_expr: TokenStream, is_fallible: bool) -> TokenStream {
    if is_fallible {
        quote! {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #call_expr
            }))
            .map_err(|_| "Internal panic".to_string())?
            .map_err(|e| bridge_types::bridge_format_err!(e))
        }
    } else {
        quote! {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #call_expr
            }))
            .map_err(|_| "Internal panic".to_string())
        }
    }
}
