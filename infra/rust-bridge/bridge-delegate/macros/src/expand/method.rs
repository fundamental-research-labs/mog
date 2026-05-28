use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

use super::gated::{emit_gated_read, emit_gated_write};
use super::ir::{Access, Method, Param, ParamTag};
use super::scope::{
    Scope, compile_error, is_gated_kind, parse_scope, trailing_is_principal_ref,
    validate_scope_signature,
};

pub(super) fn emit_delegate_method(
    method: &Method,
    dispatch_field: &Ident,
    gated: bool,
) -> TokenStream {
    let method_ident = format_ident!("{}", method.name);

    // B.1: validate scope/needs_principal contracts when gated. Failures emit
    // compile_error! tokens that short-circuit the whole method emission so
    // the body's plumbing (security_active, active_principal, principal_pool)
    // never gets generated for an invalid method — trybuild sees exactly one
    // error per contract violation.
    if gated && is_gated_kind(method.access) {
        if method.scope.is_none() {
            return compile_error(
                method.span,
                &format!(
                    "method {}: missing scope = \"cell\" | \"range\" | \"sheet\" | \"workbook\" under gated = true",
                    method.name
                ),
            );
        }
        let scope = match parse_scope(method.scope.as_deref().unwrap_or("")) {
            Some(s) => s,
            None => {
                return compile_error(
                    method.span,
                    &format!(
                        "method {}: invalid scope \"{}\" — expected one of cell/range/sheet/workbook",
                        method.name,
                        method.scope.as_deref().unwrap_or("")
                    ),
                );
            }
        };
        // ARCHITECTURE.md §6.5: `#[bridge::structural]` is strictly
        // coarse-grained. Fine-grained scopes don't carry structural
        // semantics (structure bumps invalidate matrices for the whole
        // sheet or workbook; there is no per-cell structural mutation).
        if matches!(method.access, Access::Structural)
            && !matches!(scope, Scope::Sheet | Scope::Workbook)
        {
            return compile_error(
                method.span,
                &format!(
                    "method {}: #[bridge::structural] only allows scope = \"sheet\" | \"workbook\"",
                    method.name
                ),
            );
        }
        // Scope-specific signature requirements. Run them up-front so a
        // signature mismatch short-circuits the whole emission rather
        // than producing a valid method body with the compile_error
        // buried inside (which would collide with the rest of the
        // method's plumbing and surface as a cascade of unrelated
        // errors against the caller's service type).
        if let Err(err_tok) = validate_scope_signature(method, scope) {
            return err_tok;
        }
    }

    // `needs_principal` contract: only on write/structural; trailing arg must be &Principal.
    if method.needs_principal {
        if !matches!(method.access, Access::Write | Access::Structural) {
            return compile_error(
                method.span,
                &format!(
                    "method {}: needs_principal is only valid on bridge::write / bridge::structural",
                    method.name
                ),
            );
        }
        if !trailing_is_principal_ref(method) {
            return compile_error(
                method.span,
                &format!(
                    "method {}: needs_principal requires trailing param `caller: &Principal`",
                    method.name
                ),
            );
        }
    } else if gated && trailing_is_principal_ref(method) {
        // Explicit &Principal without `needs_principal` is always a bug — a
        // raw Principal argument is a security-relevant slot and must be
        // declared intentionally.
        return compile_error(
            method.span,
            &format!(
                "method {}: trailing `&Principal` param requires the `needs_principal` flag on the access attribute",
                method.name
            ),
        );
    }

    // The delegate's public signature strips the trailing `caller: &Principal`
    // for needs_principal methods. Engine-thread closure supplies it.
    let effective_params: Vec<&Param> = if method.needs_principal {
        let n = method.params.len().saturating_sub(1);
        method.params.iter().take(n).collect()
    } else {
        method.params.iter().collect()
    };

    // Build parameter list (Rust types for the delegate method signature)
    let param_tokens: Vec<TokenStream> = effective_params
        .iter()
        .map(|p| {
            let name = format_ident!("{}", p.name);
            let ty: proc_macro2::TokenStream = p.ty.parse().unwrap_or_else(|_| quote!(()));
            quote!(#name: #ty)
        })
        .collect();

    // Determine dispatch call: call_engine (write/structural) or query_engine
    // (read / session — both take `&self`). `Session` is never gated because
    // it mutates only session-scoped state on the service via interior
    // mutability; it never touches the engine thread's state.
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
    // `effective_params` already excludes the trailing principal when
    // needs_principal is set; the engine still takes it, so we inject it
    // separately below.
    let mut owned_bindings = Vec::new();
    let mut engine_call_args = Vec::new();

    for param in &effective_params {
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

    // --- Non-gated straight-dispatch body (pre-B.1 shape, also fast-path body) ---
    // Includes the principal-append branch for needs_principal methods so that
    // fast-path (if ever applicable) still threads the principal. Per B.1 spec,
    // needs_principal methods never actually take the fast path — the principal
    // is always materialized. But we share the body builder.
    let engine_call_with_principal = if method.needs_principal {
        quote! { e.#method_ident(#(#engine_call_args,)* &__principal) }
    } else {
        quote! { e.#method_ident(#(#engine_call_args),*) }
    };
    let engine_call_plain = quote! { e.#method_ident(#(#engine_call_args),*) };

    let error_ty: proc_macro2::TokenStream = method
        .error_type
        .as_deref()
        .unwrap_or("value_types::ComputeError")
        .parse()
        .unwrap_or_else(|_| quote!(value_types::ComputeError));
    let dispatch_map_err = quote! {
        .map_err(|e| value_types::ComputeError::Eval { message: e.to_string() })?
    };

    // Non-gated simple body (as pre-B.1): owns params, dispatches, returns.
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

    // Gated body — used only under `gated = true` for read/write/structural.
    let gated_body = if gated && is_gated_kind(method.access) {
        // Scope is guaranteed non-None (validated above).
        let scope = parse_scope(method.scope.as_deref().unwrap_or("")).unwrap();

        // `Principal::anonymous` takes a `&PrincipalPool`; we thread the
        // service-side pool so fail-safe anonymous principals share the
        // same intern-pool identity as explicitly-constructed ones.
        let principal_materialize = quote! {
            let __principal = self.active_principal
                .load_full()
                .as_ref()
                .clone()
                .unwrap_or_else(|| compute_security::Principal::anonymous(&self.principal_pool));
        };

        // Fast-path straight dispatch. Skipped for needs_principal methods
        // (B.1 / §6.3): attenuation must run even when enforcement is off.
        let fast_path = if method.needs_principal {
            quote!()
        } else if method.is_fallible {
            quote! {
                if !self.security_active.load(std::sync::atomic::Ordering::Relaxed) {
                    #(#owned_bindings)*
                    return self.#dispatch_field
                        .#dispatch_fn(move |e| #engine_call_plain)
                        #dispatch_map_err;
                }
            }
        } else {
            quote! {
                if !self.security_active.load(std::sync::atomic::Ordering::Relaxed) {
                    #(#owned_bindings)*
                    return self.#dispatch_field
                        .#dispatch_fn(move |e| #engine_call_plain)
                        .expect("bridge delegate: engine dispatch failed");
                }
            }
        };

        // Engine-thread closure bodies per access kind.
        match method.access {
            Access::Read => emit_gated_read(
                method,
                scope,
                dispatch_field,
                &fast_path,
                &principal_materialize,
                &owned_bindings,
                &engine_call_plain,
                &error_ty,
                &dispatch_map_err,
            ),
            Access::Write | Access::Structural => emit_gated_write(
                method,
                scope,
                dispatch_field,
                &fast_path,
                &principal_materialize,
                &owned_bindings,
                &engine_call_with_principal,
                &dispatch_map_err,
            ),
            _ => unreachable!("is_gated_kind guard"),
        }
    } else {
        simple_body
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
                #gated_body
            }
        }
    } else {
        quote! {
            pub fn #method_ident(#self_receiver, #(#param_tokens),*) -> #return_ty {
                #gated_body
            }
        }
    }
}
