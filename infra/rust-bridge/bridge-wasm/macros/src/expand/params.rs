//! WASM parameter conversion generation.

use proc_macro2::TokenStream;
use quote::{format_ident, quote};

use super::ir::{WasmParam, WasmParamTag};

pub(super) fn build_params_and_conversions(
    params: &[WasmParam],
) -> (Vec<TokenStream>, Vec<TokenStream>, Vec<TokenStream>) {
    let mut wasm_params = Vec::new();
    let mut conversions = Vec::new();
    let mut call_args = Vec::new();

    for param in params {
        let param_ident = format_ident!("{}", param.name);

        match param.tag {
            WasmParamTag::Str => {
                // &str stays as &str, String stays as String
                if param.ty.starts_with('&') {
                    wasm_params.push(quote! { #param_ident: &str });
                    call_args.push(quote! { #param_ident });
                } else {
                    wasm_params.push(quote! { #param_ident: String });
                    call_args.push(quote! { #param_ident });
                }
            }
            WasmParamTag::Prim => {
                let ty_ident: TokenStream = param.ty.parse().unwrap_or_else(|_| quote! { u32 });
                wasm_params.push(quote! { #param_ident: #ty_ident });
                call_args.push(quote! { #param_ident });
            }
            WasmParamTag::Bytes => {
                if param.ty.starts_with('&') {
                    wasm_params.push(quote! { #param_ident: &[u8] });
                    call_args.push(quote! { #param_ident });
                } else {
                    wasm_params.push(quote! { #param_ident: Vec<u8> });
                    call_args.push(quote! { #param_ident });
                }
            }
            WasmParamTag::Serde => {
                let converted = format_ident!("{}_converted", param.name);

                // Detect Option<&str> pattern: needs special handling because
                // &str can't be deserialized from owned data.
                let normalized = param.ty.replace(' ', "");
                if normalized == "Option<&str>" {
                    let owned = format_ident!("{}_owned", param.name);
                    wasm_params.push(quote! { #param_ident: wasm_bindgen::JsValue });
                    conversions.push(quote! {
                        let #owned: Option<String> = serde_wasm_bindgen::from_value(#param_ident)
                            .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))?;
                        let #converted = #owned.as_deref();
                    });
                    call_args.push(quote! { #converted });
                    continue;
                }

                wasm_params.push(quote! { #param_ident: wasm_bindgen::JsValue });

                if param.ty.starts_with('&') {
                    let inner = param.ty.trim_start_matches('&').trim();
                    if inner.starts_with('[') && inner.ends_with(']') {
                        // Slice reference (&[T]) → deserialize as Vec<T>, auto-deref to &[T].
                        let elem = inner[1..inner.len() - 1].trim();
                        let vec_type_str = format!("Vec<{}>", elem);
                        let vec_ty: TokenStream =
                            vec_type_str.parse().unwrap_or_else(|_| quote! { Vec<_> });
                        conversions.push(quote! {
                            let #converted: #vec_ty = {
                                let __input_clone = #param_ident.clone();
                                match serde_wasm_bindgen::from_value(#param_ident) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        let err_str = e.to_string();
                                        if err_str.contains("missing field") {
                                            if let Ok(__value) = serde_wasm_bindgen::from_value::<serde_json::Value>(__input_clone) {
                                                return Err(wasm_bindgen::JsError::new(
                                                    &bridge_types::enhance_missing_field_error(&__value, &err_str)
                                                ));
                                            }
                                        }
                                        return Err(wasm_bindgen::JsError::new(&err_str));
                                    }
                                }
                            };
                        });
                    } else {
                        // Non-slice reference (&T) → deserialize into owned T.
                        // No type annotation: Rust infers the type from the method call.
                        conversions.push(quote! {
                            let #converted = {
                                let __input_clone = #param_ident.clone();
                                match serde_wasm_bindgen::from_value(#param_ident) {
                                    Ok(v) => v,
                                    Err(e) => {
                                        let err_str = e.to_string();
                                        if err_str.contains("missing field") {
                                            if let Ok(__value) = serde_wasm_bindgen::from_value::<serde_json::Value>(__input_clone) {
                                                return Err(wasm_bindgen::JsError::new(
                                                    &bridge_types::enhance_missing_field_error(&__value, &err_str)
                                                ));
                                            }
                                        }
                                        return Err(wasm_bindgen::JsError::new(&err_str));
                                    }
                                }
                            };
                        });
                    }
                    call_args.push(quote! { &#converted });
                } else {
                    // Owned param: deserialize directly.
                    // No type annotation: Rust infers the type from the method call.
                    conversions.push(quote! {
                        let #converted = {
                            let __input_clone = #param_ident.clone();
                            match serde_wasm_bindgen::from_value(#param_ident) {
                                Ok(v) => v,
                                Err(e) => {
                                    let err_str = e.to_string();
                                    if err_str.contains("missing field") {
                                        if let Ok(__value) = serde_wasm_bindgen::from_value::<serde_json::Value>(__input_clone) {
                                            return Err(wasm_bindgen::JsError::new(
                                                &bridge_types::enhance_missing_field_error(&__value, &err_str)
                                            ));
                                        }
                                    }
                                    return Err(wasm_bindgen::JsError::new(&err_str));
                                }
                            }
                        };
                    });
                    call_args.push(quote! { #converted });
                }
            }
            WasmParamTag::Parse => {
                let converted = format_ident!("{}_converted", param.name);
                wasm_params.push(quote! { #param_ident: &str });
                conversions.push(quote! {
                    let #converted = bridge_types::BridgeParse::bridge_parse(#param_ident)
                        .map_err(|e| wasm_bindgen::JsError::new(&e))?;
                });
                // If the original type was a reference (&KeyId), pass a reference
                if param.ty.starts_with('&') {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
        }
    }

    (wasm_params, conversions, call_args)
}
