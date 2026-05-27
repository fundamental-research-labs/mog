use super::*;

pub(super) fn expand_method(
    desc: &TauriDescriptor,
    method: &TauriMethod,
    effective_prefix: &str,
) -> (TokenStream, Ident) {
    let method_name = &method.name;
    let fn_name = if effective_prefix.is_empty() {
        method_name.clone()
    } else {
        format_ident!("{}_{}", effective_prefix, method_name)
    };

    let type_name = &desc.type_name;
    let is_service = desc.service.is_some();

    // Build parameter list for the function signature
    let mut sig_params = Vec::new();
    let mut call_args = Vec::new();
    let mut parse_stmts = Vec::new();

    // For service methods (non-pure), add state and key params
    if is_service && method.access != TauriAccess::Pure {
        let registry_ident = format_ident!("{}Registry", type_name);
        if let Some(ref svc) = desc.service {
            let key_param_ident = format_ident!("{}", svc.key_param);
            sig_params.push(quote! { state: tauri::State<'_, #registry_ident> });
            sig_params.push(quote! { #key_param_ident: String });
        }
    }

    // For lifecycle create/create_from, the key param is already in sig_params
    // from the service block above. Skip it in the method params to avoid duplicates.
    let key_param_name = if is_service
        && matches!(
            method.access,
            TauriAccess::LifecycleCreate | TauriAccess::LifecycleCreateFrom { .. }
        ) {
        desc.service.as_ref().map(|s| s.key_param.clone())
    } else {
        None
    };

    // Add method parameters
    for param in &method.params {
        let param_name = &param.name;

        // Skip the key param for lifecycle create — already added above.
        let is_key_param = key_param_name.as_deref() == Some(&param_name.to_string());
        if is_key_param {
            // Still add to call_args so the constructor receives the value.
            call_args.push(quote! { #param_name });
            continue;
        }

        match param.tag {
            TauriParamTag::Str => {
                // &str -> String param, pass &param to call
                // String -> String param, pass directly
                sig_params.push(quote! { #param_name: String });
                if param.is_ref {
                    call_args.push(quote! { &#param_name });
                } else {
                    call_args.push(quote! { #param_name });
                }
            }
            TauriParamTag::Prim => {
                let ty = &param.original_ty;
                sig_params.push(quote! { #param_name: #ty });
                call_args.push(quote! { #param_name });
            }
            TauriParamTag::Bytes => {
                // &[u8] -> Vec<u8>, pass &param
                // Vec<u8> -> Vec<u8>, pass directly
                sig_params.push(quote! { #param_name: Vec<u8> });
                if param.is_ref {
                    call_args.push(quote! { &#param_name });
                } else {
                    call_args.push(quote! { #param_name });
                }
            }
            TauriParamTag::Serde => {
                // Accept serde_json::Value — Tauri auto-deserializes JSON into this.
                // We then explicitly deserialize to the target type so we can
                // intercept "missing field" errors and report ALL missing fields
                // at once via bridge_types::check_missing_fields.
                sig_params.push(quote! { #param_name: serde_json::Value });

                let converted = format_ident!("{}_converted", param.name);
                let target_ty = if param.is_ref {
                    let derefed = deref_type(&param.original_ty);
                    if let Type::Slice(ts) = &derefed {
                        let elem = &ts.elem;
                        syn::parse_quote! { Vec<#elem> }
                    } else {
                        derefed
                    }
                } else {
                    param.original_ty.clone()
                };

                parse_stmts.push(quote! {
                    let #converted: #target_ty = match serde_json::from_value::<#target_ty>(#param_name.clone()) {
                        Ok(v) => v,
                        Err(e) if e.to_string().contains("missing field") => {
                            return Err(bridge_types::enhance_missing_field_error(&#param_name, &e));
                        }
                        Err(e) => return Err(bridge_types::bridge_format_err!(e)),
                    };
                });

                if param.is_ref {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
            TauriParamTag::Parse => {
                // String -> T::bridge_parse(&param)?
                let parsed_ident = format_ident!("{}_parsed", param_name);
                sig_params.push(quote! { #param_name: String });
                let inner_ty = if param.is_ref {
                    deref_type(&param.original_ty)
                } else {
                    param.original_ty.clone()
                };
                parse_stmts.push(quote! {
                    let #parsed_ident = <#inner_ty as bridge_types::BridgeParse>::bridge_parse(&#param_name)
                        .map_err(|e| bridge_types::bridge_format_err!(e))?;
                });
                if param.is_ref {
                    call_args.push(quote! { &#parsed_ident });
                } else {
                    call_args.push(quote! { #parsed_ident });
                }
            }
        }
    }

    // When security_level is set, add security params to the function signature
    // and prepend a verify_request call to the body.
    if desc.security_level.is_some() {
        sig_params.push(quote! { __sec_timestamp: Option<u64> });
        sig_params.push(quote! { __sec_nonce: Option<String> });
        sig_params.push(quote! { __sec_signature: Option<String> });
        sig_params.push(quote! { window: tauri::Window });
        sig_params.push(quote! { app: tauri::AppHandle });
    }

    // For bytes or bytes-tuple returns, we use tauri::ipc::Response to send
    // raw binary data instead of JSON-serialized number arrays.
    let is_binary_return = method.return_info.is_bytes || method.return_info.is_bytes_tuple;

    // Build the function body
    let raw_body = build_method_body(desc, method, &call_args, &parse_stmts);

    // Wrap the body for binary returns
    let body = if method.return_info.is_bytes {
        // Plain Vec<u8> -> tauri::ipc::Response
        quote! {
            let __raw_result = (|| { #raw_body })();
            __raw_result.map(|bytes| tauri::ipc::Response::new(bytes))
        }
    } else if method.return_info.is_bytes_tuple {
        // (Vec<u8>, T) -> tauri::ipc::Response with packed format:
        // [4-byte LE bytes length][raw bytes][JSON metadata]
        quote! {
            let __raw_result = (|| { #raw_body })();
            __raw_result.map(|(bytes, metadata)| {
                let meta_json = serde_json::to_vec(&metadata).unwrap_or_default();
                let bytes_len = (bytes.len() as u32).to_le_bytes();
                let mut buf = Vec::with_capacity(4 + bytes.len() + meta_json.len());
                buf.extend_from_slice(&bytes_len);
                buf.extend_from_slice(&bytes);
                buf.extend_from_slice(&meta_json);
                tauri::ipc::Response::new(buf)
            })
        }
    } else {
        raw_body
    };

    // Prepend security verification when security_level is set
    let body = if let Some(ref level) = desc.security_level {
        let operation_str = fn_name.to_string();
        quote! {
            let _ctx = crate::security::verify_request(
                crate::security::SecurityLevel::#level,
                #operation_str,
                __sec_timestamp.unwrap_or(0),
                &__sec_nonce.as_deref().unwrap_or(""),
                &__sec_signature.as_deref().unwrap_or(""),
                &window,
                &app,
            ).await?;
            #body
        }
    } else {
        body
    };

    // Return type
    let ret_type = if is_binary_return {
        quote! { Result<tauri::ipc::Response, String> }
    } else if method.return_info.is_self_tuple {
        // (Self, T) lifecycle create -> return T after storing Self
        let inner = method.return_info.self_tuple_inner_ty.as_ref().unwrap();
        quote! { Result<#inner, String> }
    } else {
        match &method.return_info.ty {
            Some(ty) if is_self_type(ty) => quote! { Result<(), String> },
            Some(ty) => quote! { Result<#ty, String> },
            None => quote! { Result<(), String> },
        }
    };

    let tokens = quote! {
        #[tauri::command]
        pub async fn #fn_name(#(#sig_params),*) -> #ret_type {
            #body
        }
    };

    (tokens, fn_name)
}
