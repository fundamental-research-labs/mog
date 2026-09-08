use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

use super::ir::{Access, Method, ParamTag};

pub(super) fn emit_delegate_method(method: &Method, dispatch_field: &Ident) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);

    // Build parameter list (Rust types for the delegate method signature)
    let param_tokens: Vec<TokenStream> = method
        .params
        .iter()
        .map(|p| {
            let name = format_ident!("{}", p.name);
            let ty: proc_macro2::TokenStream = p.ty.parse().unwrap_or_else(|_| quote!(()));
            quote!(#name: #ty)
        })
        .collect();

    // Writes and structural changes require mutable engine dispatch.
    let is_mutating = matches!(method.access, Access::Write | Access::Structural);
    let dispatch_fn = if is_mutating {
        format_ident!("call_engine")
    } else {
        format_ident!("query_engine")
    };

    // Determine self receiver. Session rides the `&self` path like Read.
    let self_receiver = if is_mutating {
        quote!(&mut self)
    } else {
        quote!(&self)
    };

    // Use the original return type as-is (no bytes-tuple stripping).
    let return_type_str = method
        .return_type
        .as_ref()
        .map(|r| r.ty.clone())
        .unwrap_or_else(|| "()".to_string());

    let return_ty: proc_macro2::TokenStream =
        return_type_str.parse().unwrap_or_else(|_| quote!(()));

    // Build the engine call expression (using owned versions of ref params).
    let mut owned_bindings = Vec::new();
    let mut engine_call_args = Vec::new();

    for param in &method.params {
        let name = format_ident!("{}", param.name);
        let ty_contains_ref = param.ty.contains('&');

        if ty_contains_ref {
            let owned_name = format_ident!("{}_owned", param.name);
            if param.ty.starts_with('&') {
                match param.tag {
                    ParamTag::Str => {
                        owned_bindings.push(quote!(let #owned_name = #name.to_string();));
                    }
                    ParamTag::Bytes => {
                        owned_bindings.push(quote!(let #owned_name = #name.to_vec();));
                    }
                    _ => {
                        owned_bindings.push(quote!(let #owned_name = #name.to_owned();));
                    }
                }
                engine_call_args.push(quote!(&#owned_name));
            } else if param.ty.contains("Option")
                && (param.ty.contains("&str") || param.ty.contains("& str"))
            {
                owned_bindings.push(quote!(
                    let #owned_name: Option<String> = #name.map(|s| s.to_string());
                ));
                engine_call_args.push(quote!(#owned_name.as_deref()));
            } else {
                owned_bindings.push(quote!(let #owned_name = #name.clone();));
                engine_call_args.push(quote!(#owned_name));
            }
        } else {
            engine_call_args.push(quote!(#name));
        }
    }

    let engine_call_plain = quote! { e.#method_ident(#(#engine_call_args),*) };

    let dispatch_map_err = quote! {
        .map_err(|e| value_types::ComputeError::Eval { message: e.to_string() })?
    };

    // Own borrowed inputs before moving them onto the engine thread.
    let simple_body = if method.is_fallible {
        quote! {
            #(#owned_bindings)*
            self.#dispatch_field
                .#dispatch_fn(move |e| #engine_call_plain)
                #dispatch_map_err
        }
    } else {
        quote! {
            #(#owned_bindings)*
            self.#dispatch_field
                .#dispatch_fn(move |e| #engine_call_plain)
                .expect("bridge delegate: engine dispatch failed")
        }
    };

    // Build return type for the method signature
    if method.is_fallible {
        let error_ty: proc_macro2::TokenStream = method
            .error_type
            .as_deref()
            .unwrap_or("value_types::ComputeError")
            .parse()
            .unwrap_or_else(|_| quote!(value_types::ComputeError));
        quote! {
            pub fn #method_ident(#self_receiver, #(#param_tokens),*) -> Result<#return_ty, #error_ty> {
                #simple_body
            }
        }
    } else {
        quote! {
            pub fn #method_ident(#self_receiver, #(#param_tokens),*) -> #return_ty {
                #simple_body
            }
        }
    }
}
