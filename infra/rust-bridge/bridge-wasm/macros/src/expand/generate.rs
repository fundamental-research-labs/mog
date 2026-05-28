//! Top-level WASM expansion orchestration.

use proc_macro2::TokenStream;
use quote::format_ident;

use super::ir::{WasmAccess, WasmDescriptor};
use super::method::{emit_pure_method, emit_service_method};
use super::names::to_snake_case;
use super::registry::{emit_destroy, emit_helpers, emit_lifecycle_create, emit_registry};

pub(super) fn expand(desc: &WasmDescriptor) -> TokenStream {
    let type_snake = to_snake_case(&desc.type_name);
    let type_ident = format_ident!("{}", desc.type_name);

    // Compute effective prefix for function naming
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(),   // explicit empty = no prefix
        None => type_snake.clone(), // default behavior
    };

    let mut output = TokenStream::new();

    // Infrastructure: emit if ANY non-skipped lifecycle method exists for this target
    let declares_lifecycle = desc.methods.iter().any(|m| {
        matches!(
            m.access,
            WasmAccess::LifecycleCreate | WasmAccess::LifecycleCreateFrom { .. }
        ) && !m.skip_targets.contains(&"wasm".to_string())
    });

    if let Some(ref svc) = desc.service {
        if declares_lifecycle {
            output.extend(emit_registry(desc, &effective_prefix, &type_ident));
            output.extend(emit_helpers(desc, &effective_prefix, &type_ident));
            output.extend(emit_destroy(desc, &effective_prefix, &type_ident));
        }

        // Emit each method
        for method in &desc.methods {
            if method.skip_targets.contains(&"wasm".to_string()) || method.is_async {
                continue;
            }
            match method.access {
                WasmAccess::LifecycleCreate | WasmAccess::LifecycleCreateFrom { .. } => {
                    output.extend(emit_lifecycle_create(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        svc,
                    ));
                }
                WasmAccess::Read => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        false,
                    ));
                }
                WasmAccess::Write => {
                    output.extend(emit_service_method(
                        desc,
                        method,
                        &effective_prefix,
                        &type_ident,
                        true,
                    ));
                }
                WasmAccess::Pure => {
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
            if method.skip_targets.contains(&"wasm".to_string()) || method.is_async {
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
