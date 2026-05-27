//! Free-function / service napi code generation. Emits the
//! `LazyLock<DashMap>` registry, `__with_read_*` / `__with_write_*`
//! helpers, destroy function, lifecycle create functions, and individual
//! pure / read / write / async service methods. Also hosts the
//! shared parameter-conversion and return-handling helpers reused by
//! `expand_class.rs`.

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

mod methods;
mod params;
mod returns;
mod service;
mod tagged_enum;

#[cfg(test)]
mod tests;

pub(crate) use methods::emit_pure_method;
pub(crate) use params::build_params_and_conversions;
pub(crate) use returns::build_return_handling;

use methods::emit_service_method;
use service::{emit_destroy, emit_helpers, emit_lifecycle_create, emit_registry};

use crate::classify::{is_direct_return, to_snake_case};
use crate::ir::{
    NapiAccess, NapiDescriptor, NapiFieldTag, NapiMethod, NapiParam, NapiParamTag, NapiServiceMeta,
    NapiTaggedEnumSpec, NapiVariantField, NapiVariantSpec, ReturnInfo,
};

/// Top-level parser entry point. Parses the descriptor DSL token stream
/// emitted by bridge-core's `__bridge_descriptor_*` macros.
pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: NapiDescriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}

/// Main entry point: given a parsed `NapiDescriptor`, emit the full napi
/// binding code as a `TokenStream`.
pub(crate) fn expand(desc: &NapiDescriptor) -> TokenStream {
    let type_snake = to_snake_case(&desc.type_name);
    let type_ident = format_ident!("{}", desc.type_name);

    // Compute effective prefix for function naming
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),   // explicit empty = no prefix
        None => type_snake.clone(), // default behavior
    };

    let mut output = TokenStream::new();

    // Infrastructure: emit if ANY method declares lifecycle (ignore skips for gating)
    let declares_lifecycle = desc.methods.iter().any(|m| {
        matches!(
            m.access,
            NapiAccess::LifecycleCreate | NapiAccess::LifecycleCreateFrom { .. }
        )
    });

    if let Some(ref svc) = desc.service {
        if declares_lifecycle {
            output.extend(emit_registry(desc, &effective_prefix, &type_ident));
            output.extend(emit_helpers(desc, &effective_prefix, &type_ident));
            output.extend(emit_destroy(desc, &effective_prefix, &type_ident));
        }

        // Emit each method
        for method in &desc.methods {
            if method.skip_targets.contains(&"napi".to_string()) {
                continue;
            }
            match method.access {
                NapiAccess::LifecycleCreate => {
                    output.extend(emit_lifecycle_create(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        svc,
                    ));
                }
                NapiAccess::LifecycleCreateFrom { .. } => {
                    output.extend(emit_lifecycle_create(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        svc,
                    ));
                }
                NapiAccess::Read => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        false,
                    ));
                }
                NapiAccess::Write => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        true,
                    ));
                }
                NapiAccess::Pure => {
                    output.extend(emit_pure_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                    ));
                }
            }
        }
    } else {
        // Stateless mode: all methods are pure
        for method in &desc.methods {
            if method.skip_targets.contains(&"napi".to_string()) {
                continue;
            }
            output.extend(emit_pure_method(
                desc,
                method,
                &effective_prefix,
                &type_ident,
            ));
        }
    }

    output
}
