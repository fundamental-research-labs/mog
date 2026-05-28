//! Code generation for delegate bindings.
//!
//! Consumes the same descriptor DSL as bridge-wasm, but instead of generating
//! WASM bindings, generates Rust delegate methods on a target type and re-emits
//! descriptor macros for that target type.
//!
//! ## Gated delegate codegen
//!
//! When `gated = true` is set on the `delegate!` invocation, each `read`/`write`/
//! `structural` method is wrapped with a security gate.
//!
//! - A fast-path prelude short-circuits straight to engine dispatch when
//!   `self.security_active` is `false` (document has no policies).
//! - On the gated path, the current principal is materialized with an anonymous
//!   fail-safe fallback (NEVER owner). `Read` post-filters return values via a
//!   scope-specific filter (`redact_scalar`, `filter_range_values`,
//!   `filter_viewport_buffer`). `Write` and `Structural` pre-check via
//!   `engine.check_write(..)` at `AccessLevel::Write` / `::Admin`.
//! - `Pure` and `Lifecycle` are passthrough under all settings.
//! - `#[bridge::write(needs_principal)]` methods (security ops) bypass the fast
//!   path and always thread the principal into the engine call. Their trailing
//!   `caller: &Principal` param is stripped from the delegate's public signature.
//!
//! ## Compile-time audit
//!
//! Under `gated = true` the macro rejects any `read`/`write`/`structural` method
//! that omits `scope = "cell" | "range" | "sheet" | "workbook"`, and any
//! `scope = "cell"` whose signature lacks a `CellAddr`-typed parameter. Bad
//! `needs_principal` declarations (wrong signature shape) also fail to compile.
//! See §6.5 for rationale — silent inference is a correctness-risk class.

mod descriptor;
mod gated;
mod ir;
mod method;
mod parse;
mod scope;
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

        let method_tokens = emit_delegate_method(method, &dispatch_field, desc.gated);
        delegate_methods.push(method_tokens);
    }

    // Wrap the impl block in a private module with type imports from bridge_types.
    // The bridge_types module in compute-core is the single source of truth for
    // all types used in bridge method signatures. Combined with crate_path rewriting
    // in emit.rs (crate:: → compute_core::), descriptors are fully self-contained.
    //
    // Tests invoking the macro without a compute-core dep set
    // `skip_default_imports = true` to suppress these imports. Production
    // consumers (compute-api) leave the flag off, preserving the pre-B.1 shape.
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
