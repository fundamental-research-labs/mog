use proc_macro2::TokenStream;
use quote::{format_ident, quote};

use super::ir::{Access, DelegateDescriptor, ParamTag};

pub(super) fn emit_new_descriptor(desc: &DelegateDescriptor) -> TokenStream {
    let target_ident = format_ident!("{}", desc.target_type);
    let group_ident = format_ident!("{}", desc.group);
    let macro_name = format_ident!("__bridge_descriptor_{}_{}", desc.target_type, desc.group);

    // Build method tokens using quote! (same DSL format as bridge-core/emit.rs)
    let mut method_tokens = Vec::new();

    for method in &desc.methods {
        let kind_and_access = match method.access {
            Access::LifecycleCreate => quote! { lifecycle create },
            Access::Pure => quote! { method pure },
            Access::Read => quote! { method read },
            // Structural collapses to write in re-emission because remaining
            // descriptor consumers treat the method as a mutation either way.
            Access::Write | Access::Structural => quote! { method write },
            // R2.4: keep `session` distinct when re-emitting so `&self`
            // is preserved. `method session` is an alias for `method read`
            // at the FFI-shape level.
            Access::Session => quote! { method session },
        };

        let name_ident = format_ident!("{}", method.name);

        let param_tokens: Vec<TokenStream> = method
            .params
            .iter()
            .map(|p| {
                let tag = match p.tag {
                    ParamTag::Str => quote! { [str] },
                    ParamTag::Prim => quote! { [prim] },
                    ParamTag::Bytes => quote! { [bytes] },
                    ParamTag::Serde => quote! { [serde] },
                    ParamTag::Parse => quote! { [parse] },
                };
                let pname = format_ident!("{}", p.name);
                let pty: proc_macro2::TokenStream = p.ty.parse().unwrap_or_else(|_| quote!(()));
                quote! { #tag #pname: #pty, }
            })
            .collect();

        // Return type — keep original (no bytes-tuple stripping)
        let return_ty_str = if let Some(ref ret) = method.return_type {
            ret.ty.clone()
        } else {
            "()".to_string()
        };
        let return_ty: proc_macro2::TokenStream =
            return_ty_str.parse().unwrap_or_else(|_| quote!(()));
        let return_tokens = quote! { return_type = #return_ty; };

        // Error type
        let error_tokens = match &method.error_type {
            Some(et) => {
                let ety: proc_macro2::TokenStream = et.parse().unwrap_or_else(|_| quote!(()));
                quote! { error_type = #ety; }
            }
            None => TokenStream::new(),
        };

        // Fallible
        let fallible_tokens = if method.is_fallible {
            quote! { fallible; }
        } else {
            TokenStream::new()
        };

        // Async
        let async_tokens = if method.is_async {
            quote! { async; }
        } else {
            TokenStream::new()
        };

        // Skip targets
        let skip_tokens: Vec<TokenStream> = method
            .skip_targets
            .iter()
            .map(|t| {
                let target = format_ident!("{}", t);
                quote! { skip #target; }
            })
            .collect();

        method_tokens.push(quote! {
            #kind_and_access #name_ident {
                params { #(#param_tokens)* }
                #return_tokens
                #error_tokens
                #fallible_tokens
                #async_tokens
                #(#skip_tokens)*
            }
        });
    }

    // Service metadata
    let service_tokens = if let Some(ref svc) = desc.service {
        let key_param_str = &svc.key_param;
        quote! {
            service = #target_ident;
            key_type = str;
            key_param = #key_param_str;
        }
    } else {
        quote! {
            type_name = #target_ident;
        }
    };

    // fn_prefix
    let fn_prefix_token = match &desc.fn_prefix {
        Some(p) if p.is_empty() => quote! { fn_prefix = _; },
        Some(p) => {
            let prefix_ident = format_ident!("{}", p);
            quote! { fn_prefix = #prefix_ident; }
        }
        None => TokenStream::new(),
    };

    quote! {
        #[doc(hidden)]
        #[macro_export]
        macro_rules! #macro_name {
            ($gen:path) => {
                $gen! {
                    bridge_version = 1;
                    group = #group_ident;
                    #fn_prefix_token
                    #service_tokens
                    #(#method_tokens)*
                }
            };
            ($gen:path, $($extra:tt)*) => {
                $gen! {
                    $($extra)*
                    bridge_version = 1;
                    group = #group_ident;
                    #fn_prefix_token
                    #service_tokens
                    #(#method_tokens)*
                }
            };
        }
    }
}
