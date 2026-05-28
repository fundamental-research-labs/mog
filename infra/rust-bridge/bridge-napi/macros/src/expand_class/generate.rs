use proc_macro2::TokenStream;
use quote::{format_ident, quote};

use crate::classify::to_snake_case;
use crate::expand_fn::emit_pure_method;
use crate::ir::{NapiAccess, NapiDescriptor};

use super::lifecycle::{
    emit_class_constructor, emit_class_factory_method, emit_take_lifecycle_result_method,
};
use super::methods::emit_class_method;

/// Generate class-based napi code from a `NapiDescriptor`.
///
/// Instead of a registry + free functions, this emits:
/// - `#[napi] impl ClassName { ... }` blocks with `&self` / `&mut self` methods
/// - Pure methods stay as free functions (outside the impl block)
/// - No registry, no destroy, no `__with_read_*` / `__with_write_*` helpers
///
/// The struct definition is NOT emitted here; it's emitted by `generate_class!`.
pub(super) fn expand_class(class_name: &str, desc: &NapiDescriptor) -> TokenStream {
    let class_ident = format_ident!("{}", class_name);
    let type_ident = format_ident!("{}", desc.type_name);

    let type_snake = to_snake_case(&desc.type_name);
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),
        None => type_snake.clone(),
    };

    let mut impl_methods = Vec::new();
    let mut pure_functions = TokenStream::new();
    let mut has_self_tuple_lifecycle = false;

    for method in &desc.methods {
        if method.skip_targets.contains(&"napi".to_string()) {
            continue;
        }
        match method.access {
            NapiAccess::LifecycleCreate => {
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_constructor(
                    method,
                    &effective_prefix,
                    &type_ident,
                ));
            }
            NapiAccess::LifecycleCreateFrom { ref variant_name } => {
                if method
                    .return_type
                    .as_ref()
                    .map(|r| r.is_self_tuple)
                    .unwrap_or(false)
                {
                    has_self_tuple_lifecycle = true;
                }
                impl_methods.push(emit_class_factory_method(
                    method,
                    &effective_prefix,
                    &type_ident,
                    variant_name,
                ));
            }
            NapiAccess::Read => {
                impl_methods.push(emit_class_method(method, &effective_prefix, false));
            }
            NapiAccess::Write => {
                impl_methods.push(emit_class_method(method, &effective_prefix, true));
            }
            NapiAccess::Pure => {
                pure_functions.extend(emit_pure_method(
                    desc,
                    method,
                    &effective_prefix,
                    &type_ident,
                ));
            }
        }
    }

    if has_self_tuple_lifecycle {
        impl_methods.push(emit_take_lifecycle_result_method());
    }

    let mut output = TokenStream::new();

    if !impl_methods.is_empty() {
        output.extend(quote! {
            #[napi_derive::napi]
            impl #class_ident {
                #(#impl_methods)*
            }
        });
    }

    output.extend(pure_functions);

    output
}
