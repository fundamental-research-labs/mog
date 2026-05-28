use proc_macro2::TokenStream;
use quote::{format_ident, quote};

use crate::expand_fn::{build_params_and_conversions, build_return_handling};
use crate::ir::NapiMethod;

use super::returns::build_class_return_body;

/// Emit a class instance method (&self for read, &mut self for write).
pub(super) fn emit_class_method(
    method: &NapiMethod,
    type_snake: &str,
    is_write: bool,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);
    let (napi_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    let js_name = if type_snake.is_empty() {
        method.name.clone()
    } else {
        format!("{}_{}", type_snake, method.name)
    };
    let js_name_lit = syn::LitStr::new(&js_name, proc_macro2::Span::call_site());

    let (return_type_tokens, _) = build_return_handling(&method.return_type, true);

    let self_param = if is_write {
        quote! { &mut self }
    } else {
        quote! { &self }
    };

    let await_suffix = if method.is_async {
        quote! { .await }
    } else {
        quote! {}
    };

    let inner_call = if method.is_fallible {
        quote! {
            self.inner.#method_ident(#(#call_args),*) #await_suffix
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?
        }
    } else {
        quote! {
            self.inner.#method_ident(#(#call_args),*) #await_suffix
        }
    };

    let body = build_class_return_body(method, conversion_stmts, inner_call);

    if method.is_async {
        quote! {
            #[napi(js_name = #js_name_lit)]
            pub async fn #method_ident(#self_param, #(#napi_params),*) -> #return_type_tokens {
                #body
            }
        }
    } else {
        quote! {
            #[napi(js_name = #js_name_lit)]
            pub fn #method_ident(#self_param, #(#napi_params),*) -> #return_type_tokens {
                #body
            }
        }
    }
}
