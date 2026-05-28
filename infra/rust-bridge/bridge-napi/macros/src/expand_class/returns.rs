use proc_macro2::TokenStream;
use quote::quote;

use crate::classify::is_direct_return;
use crate::ir::NapiMethod;

pub(super) fn build_class_return_body(
    method: &NapiMethod,
    conversion_stmts: Vec<TokenStream>,
    inner_call: TokenStream,
) -> TokenStream {
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

    if needs_serde_return {
        quote! {
            #(#conversion_stmts)*
            let result = #inner_call;
            serde_json::to_string(&result)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))
        }
    } else if needs_bytes_tuple_return {
        quote! {
            #(#conversion_stmts)*
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
            #(#conversion_stmts)*
            let result = #inner_call;
            Ok(napi::bindgen_prelude::Buffer::from(result))
        }
    } else {
        let has_return = method.return_type.is_some();
        if has_return {
            quote! {
                #(#conversion_stmts)*
                let result = #inner_call;
                Ok(result)
            }
        } else {
            quote! {
                #(#conversion_stmts)*
                #inner_call;
                Ok(())
            }
        }
    }
}
