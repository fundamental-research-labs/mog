//! Service registry, lifecycle, and destroy emission.

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

use super::ir::{WasmDescriptor, WasmMethod, WasmServiceMeta};
use super::names::to_snake_case;
use super::params::build_params_and_conversions;

pub(super) fn emit_registry(
    _desc: &WasmDescriptor,
    _type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", _desc.type_name.to_uppercase());
    quote! {
        ::std::thread_local! {
            static #registry_name: ::std::cell::RefCell<
                ::std::collections::HashMap<String, #type_ident>
            > = ::std::cell::RefCell::new(::std::collections::HashMap::new());
        }
    }
}

/// Emit `__with_read_{type_snake}` and `__with_write_{type_snake}` helpers.
pub(super) fn emit_helpers(
    desc: &WasmDescriptor,
    _type_snake: &str,
    type_ident: &Ident,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let internal_snake = to_snake_case(&desc.type_name);
    let read_fn = format_ident!("__with_read_{}", internal_snake);
    let write_fn = format_ident!("__with_write_{}", internal_snake);

    quote! {
        fn #read_fn<F, R>(id: &str, f: F) -> Result<R, wasm_bindgen::JsError>
        where
            F: FnOnce(&#type_ident) -> Result<R, wasm_bindgen::JsError>,
        {
            #registry_name.with(|reg| {
                let map = reg.borrow();
                let instance = map.get(id).ok_or_else(|| {
                    wasm_bindgen::JsError::new(&format!("instance not found: {}", id))
                })?;
                f(instance)
            })
        }

        fn #write_fn<F, R>(id: &str, f: F) -> Result<R, wasm_bindgen::JsError>
        where
            F: FnOnce(&mut #type_ident) -> Result<R, wasm_bindgen::JsError>,
        {
            #registry_name.with(|reg| {
                let mut map = reg.borrow_mut();
                let instance = map.get_mut(id).ok_or_else(|| {
                    wasm_bindgen::JsError::new(&format!("instance not found: {}", id))
                })?;
                f(instance)
            })
        }
    }
}

/// Emit `{type_snake}_destroy` function.
pub(super) fn emit_destroy(
    desc: &WasmDescriptor,
    type_snake: &str,
    _type_ident: &Ident,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let destroy_fn = if type_snake.is_empty() {
        format_ident!("destroy")
    } else {
        format_ident!("{}_destroy", type_snake)
    };

    quote! {
        #[wasm_bindgen]
        pub fn #destroy_fn(id: &str) -> Result<(), wasm_bindgen::JsError> {
            #registry_name.with(|reg| {
                let mut map = reg.borrow_mut();
                map.remove(id).ok_or_else(|| {
                    wasm_bindgen::JsError::new(&format!("instance not found: {}", id))
                })?;
                Ok(())
            })
        }
    }
}

/// Emit a lifecycle create function.
pub(super) fn emit_lifecycle_create(
    desc: &WasmDescriptor,
    method: &WasmMethod,
    type_snake: &str,
    type_ident: &Ident,
    svc: &WasmServiceMeta,
) -> TokenStream {
    let registry_name = format_ident!("__REGISTRY_{}", desc.type_name.to_uppercase());
    let fn_name = if type_snake.is_empty() {
        format_ident!("{}", method.name)
    } else {
        format_ident!("{}_{}", type_snake, method.name)
    };
    let key_param = format_ident!("{}", svc.key_param);

    let (wasm_params, conversion_stmts, call_args) = build_params_and_conversions(&method.params);

    // The key param comes first in the WASM function signature
    let mut all_wasm_params = vec![quote! { #key_param: &str }];
    all_wasm_params.extend(wasm_params);

    let method_ident = format_ident!("{}", method.name);

    // When the lifecycle create declares a return_type, the Rust constructor
    // returns `(Self, T)`. We destructure the tuple, store `Self` in the
    // registry, and serialize+return `T`. Without a return_type, the
    // constructor returns plain `Self` and we return `Ok(())`.
    let has_return_data = method.return_type.is_some();

    if has_return_data {
        // (Self, T) variant — destructure, store instance, return serialized data.
        let call_expr = if method.is_fallible {
            quote! {
                let (instance, data) = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let (instance, data) = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[wasm_bindgen]
            pub fn #fn_name(#(#all_wasm_params),*) -> Result<wasm_bindgen::JsValue, wasm_bindgen::JsError> {
                #(#conversion_stmts)*
                #call_expr
                #registry_name.with(|reg| {
                    reg.borrow_mut().insert(#key_param.to_string(), instance);
                });
                Ok(serde::Serialize::serialize(
                    &data,
                    &serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true),
                )
                .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?)
            }
        }
    } else {
        // Plain Self variant — store instance, return nothing.
        let call_expr = if method.is_fallible {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*)
                    .map_err(|e| wasm_bindgen::JsError::new(&bridge_types::bridge_format_err!(e)))?;
            }
        } else {
            quote! {
                let instance = #type_ident::#method_ident(#(#call_args),*);
            }
        };

        quote! {
            #[wasm_bindgen]
            pub fn #fn_name(#(#all_wasm_params),*) -> Result<(), wasm_bindgen::JsError> {
                #(#conversion_stmts)*
                #call_expr
                #registry_name.with(|reg| {
                    reg.borrow_mut().insert(#key_param.to_string(), instance);
                });
                Ok(())
            }
        }
    }
}
