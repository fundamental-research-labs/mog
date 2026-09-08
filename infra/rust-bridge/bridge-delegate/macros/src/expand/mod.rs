//! Code generation for delegate bindings.
//!
//! Consumes the same descriptor DSL as bridge-wasm, but instead of generating
//! WASM bindings, generates Rust delegate methods on a target type and re-emits
//! descriptor macros for that target type.

mod descriptor;
mod ir;
mod method;
mod parse;
mod types;

use proc_macro2::TokenStream;
use quote::{format_ident, quote};

use self::descriptor::emit_new_descriptor;
use self::ir::{Access, DelegateDescriptor};
use self::method::emit_delegate_method;

pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: DelegateDescriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}
fn expand(desc: &DelegateDescriptor) -> TokenStream {
    let target_ident = format_ident!("{}", desc.target_type);
    let dispatch_field = format_ident!("{}", desc.dispatch_field);

    let mut output = TokenStream::new();
    let mut delegate_methods = Vec::new();

    for method in &desc.methods {
        // Skip lifecycle (constructors) — those are hand-written
        if method.access == Access::LifecycleCreate {
            continue;
        }
        // Skip pure methods — those are stateless and don't need delegation
        if method.access == Access::Pure {
            continue;
        }

        let method_tokens = emit_delegate_method(method, &dispatch_field);
        delegate_methods.push(method_tokens);
    }

    // Wrap the impl block in a private module with type imports from bridge_types.
    // The bridge_types module in compute-core is the single source of truth for
    // all types used in bridge method signatures. Combined with crate_path rewriting
    // in emit.rs (crate:: → compute_core::), descriptors are fully self-contained.
    //
    // Tests invoking the macro without a compute-core dep set
    // `skip_default_imports = true` to suppress these imports. Production
    // consumers (compute-api) leave the flag off, using the standard imports.
    let mod_name = format_ident!("__bridge_delegate_{}", desc.group);
    let default_imports = if desc.skip_default_imports {
        TokenStream::new()
    } else {
        quote! {
            // Single import covers all bridge signature types — bare names, module aliases,
            // and external crate re-exports. See compute-core/src/bridge_types.rs.
            #[allow(unused_imports)]
            use compute_core::bridge_types::*;

            // Crate-level aliases for crate_path-rewritten paths
            // (e.g., compute_core::solver::SolverParams, compute_core::cf::types::CFRule)
            #[allow(unused_imports)]
            use compute_core::{cf, schema, snapshot, solver, data_table};
        }
    };
    output.extend(quote! {
        #[doc(hidden)]
        mod #mod_name {
            // Import everything from the parent module (gets Dispatch, ComputeService, etc.)
            use super::*;

            #default_imports

            impl super::#target_ident {
                #(#delegate_methods)*
            }
        }
    });

    // Re-emit descriptor macro for the target type (ComputeService).
    // Types are already qualified (crate:: → compute_core:: via emit.rs),
    // so the re-emitted descriptors are self-contained.
    output.extend(emit_new_descriptor(desc));

    output
}
