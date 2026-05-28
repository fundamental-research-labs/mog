use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

use crate::expand_fn::build_params_and_conversions;
use crate::ir::NapiMethod;

/// Emit a constructor method for the class.
pub(super) fn emit_class_constructor(
    method: &NapiMethod,
    _type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi(constructor)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| napi::Error::from_reason(e.to_string()))?
                    ),
                })
            }
        }
    } else {
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
            #[napi(constructor)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self { inner: instance, __lifecycle_result: None })
            }
        }
    }
}

/// Emit a factory method for the class (for create_from lifecycle).
pub(super) fn emit_class_factory_method(
    method: &NapiMethod,
    _type_snake: &str,
    type_ident: &Ident,
    _variant_name: &str,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let returns_self_tuple = method
        .return_type
        .as_ref()
        .map(|r| r.is_self_tuple)
        .unwrap_or(false);

    if returns_self_tuple {
        let call_expr = if method.is_fallible {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (__inner, __data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi(factory)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: Some(
                        serde_json::to_string(&__data)
                            .map_err(|e| napi::Error::from_reason(e.to_string()))?
                    ),
                })
            }
        }
    } else {
        let call_expr = if method.is_fallible {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let __inner = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[napi(factory)]
            pub fn #method_ident(#(#napi_params),*) -> napi::Result<Self> {
                #(#conversion_stmts)*
                #call_expr
                Ok(Self {
                    inner: __inner,
                    __lifecycle_result: None,
                })
            }
        }
    }
}

/// Emit a `take_lifecycle_result` accessor method for class-mode lifecycle
/// creates that return `(Self, T)`.
pub(super) fn emit_take_lifecycle_result_method() -> TokenStream {
    quote! {
        #[napi]
        pub fn take_lifecycle_result(&mut self) -> Option<String> {
            self.__lifecycle_result.take()
        }
    }
}
