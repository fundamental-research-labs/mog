use super::*;

pub(crate) fn build_return_handling(
    return_type: &Option<ReturnInfo>,
    always_result: bool,
) -> (TokenStream, TokenStream) {
    match return_type {
        None => {
            // No return value (unit)
            let _ = always_result;
            (quote! { napi::Result<()> }, quote! { Ok(()) })
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
