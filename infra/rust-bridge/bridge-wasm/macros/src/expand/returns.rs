//! WASM return conversion generation.

use proc_macro2::TokenStream;
use quote::quote;

use super::ir::ReturnInfo;

pub(super) fn build_return_handling(
    return_type: &Option<ReturnInfo>,
    always_result: bool,
) -> (TokenStream, TokenStream) {
    match return_type {
        None => {
            // No return value (unit)
            if always_result {
                (
                    quote! { Result<(), wasm_bindgen::JsError> },
                    quote! { Ok(()) },
                )
            } else {
                (
                    quote! { Result<(), wasm_bindgen::JsError> },
                    quote! { Ok(()) },
                )
            }
        }
        Some(ret) => {
            if ret.is_string {
                (
                    quote! { Result<String, wasm_bindgen::JsError> },
                    quote! { Ok(result) },
                )
            } else if ret.is_prim {
                let ty: TokenStream = ret.ty.parse().unwrap_or_else(|_| quote! { u32 });
                (
                    quote! { Result<#ty, wasm_bindgen::JsError> },
                    quote! { Ok(result) },
                )
            } else if ret.is_bytes {
                (
                    quote! { Result<Vec<u8>, wasm_bindgen::JsError> },
                    quote! { Ok(result) },
                )
            } else if ret.is_bytes_tuple {
                // (Vec<u8>, T) → JS Array [Uint8Array, JsValue]
                // Bytes pass through as Uint8Array (no serde), T gets serde-serialized.
                (
                    quote! { Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> },
                    quote! {
                        {
                            let (bytes, metadata) = result;
                            let js_bytes = js_sys::Uint8Array::from(bytes.as_slice());
                            let js_metadata = serde::Serialize::serialize(
                                &metadata,
                                &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
                            )
                            .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))?;
                            let arr = js_sys::Array::new_with_length(2);
                            arr.set(0, js_bytes.into());
                            arr.set(1, js_metadata);
                            Ok(arr.into())
                        }
                    },
                )
            } else {
                // serde return
                (
                    quote! { Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> },
                    quote! {
                        serde::Serialize::serialize(
                            &result,
                            &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
                        )
                        .map_err(|e| wasm_bindgen::JsError::new(&e.to_string()))
                    },
                )
            }
        }
    }
}
