use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};

use super::ir::{Access, Method};
use super::scope::{
    Scope, cell_scope_row_col, compile_error, find_param_by_type_substr, range_scope_bounds,
    sheet_by_value,
};

fn build_check_write_target(method: &Method, scope: Scope) -> Result<TokenStream, TokenStream> {
    match scope {
        Scope::Sheet => {
            let sheet = find_param_by_type_substr(method, "SheetId").ok_or_else(|| {
                compile_error(
                    method.span,
                    &format!(
                        "method {}: scope = \"sheet\" requires a param of type SheetId",
                        method.name
                    ),
                )
            })?;
            let sheet_val = sheet_by_value(method, &sheet);
            Ok(quote! {
                compute_security::AccessTarget::Sheet { sheet_id: #sheet_val }
            })
        }
        Scope::Workbook => Ok(quote! { compute_security::AccessTarget::Workbook }),
        // Cell- and range-scope writes use matrix.get, not check_write —
        // callers guard against this via the gated-write emit function.
        Scope::Cell | Scope::Range => {
            unreachable!("build_check_write_target is only valid for sheet/workbook scope")
        }
    }
}

/// Categorize the return type to pick the right read post-filter.
///
/// Resolution order:
/// 1. `Vec<u8>` or `bytes::Bytes` with `scope = "sheet"` → viewport buffer filter
/// 2. `Vec<...>` with `scope = "range"` → range-values filter
/// 3. `scope = "cell"` → scalar redactor
/// 4. `scope = "workbook"` or other → passthrough (no per-cell filter)
///
/// The function names emitted here are references to symbols defined in
/// `compute_security` / `compute_wire`. R1/R2/R4 fill in the actual
/// implementations; the macro only wires the call.
fn emit_read_postfilter(
    method: &Method,
    scope: Scope,
    raw_binding: &Ident,
    matrix_binding: &Ident,
) -> TokenStream {
    let return_ty_str = method
        .return_type
        .as_ref()
        .map(|r| r.ty.replace(char::is_whitespace, ""))
        .unwrap_or_default();

    let is_byte_vec = return_ty_str == "Vec<u8>"
        || return_ty_str.ends_with("::Bytes")
        || return_ty_str == "Bytes";
    let is_vec_any = return_ty_str.starts_with("Vec<");

    match scope {
        Scope::Sheet if is_byte_vec => {
            quote! {
                {
                    let mut __buf = #raw_binding;
                    compute_wire::filter_viewport_buffer(&mut __buf, &#matrix_binding);
                    __buf
                }
            }
        }
        Scope::Range if is_vec_any => {
            let (sr, sc, er, ec) = match range_scope_bounds(method) {
                Ok(bounds) => bounds,
                Err(err_tok) => return err_tok,
            };
            // Per §6.5: range reads pass the matrix + bounds; the filter
            // decides per-cell whether to redact. The signature accepts
            // either a `CellRange` param (indexed access) or four flat
            // `u32`s (engine convention).
            quote! {
                {
                    let mut __values = #raw_binding;
                    compute_security::filter_range_values(
                        &mut __values,
                        #sr, #sc, #er, #ec,
                        &#matrix_binding,
                    );
                    __values
                }
            }
        }
        Scope::Cell => {
            let (row, col) = match cell_scope_row_col(method) {
                Ok(rc) => rc,
                Err(err_tok) => return err_tok,
            };
            quote! {
                compute_security::redact_scalar(#raw_binding, #matrix_binding.get(#row, #col))
            }
        }
        // Workbook reads, or range/sheet reads with shapes we don't hard-filter:
        // pass through. Workbook-level denials are surfaced via check-read at
        // higher layers (R1/R2 may refine this); the macro keeps the plumbing
        // uniform.
        _ => {
            // Suppress unused-var warning on matrix_binding for passthrough case.
            quote! {
                {
                    let _ = &#matrix_binding;
                    #raw_binding
                }
            }
        }
    }
}

/// Build the gated body for `Access::Read` methods. Workbook-scope reads
/// skip the matrix fetch entirely (policies never redact workbook-level
/// metadata; the post-filter is a passthrough). All other scopes fetch
/// the (principal, sheet) matrix once on the engine thread and pass it
/// into the scope-appropriate post-filter.
pub(super) fn emit_gated_read(
    method: &Method,
    scope: Scope,
    dispatch_field: &Ident,
    fast_path: &TokenStream,
    principal_materialize: &TokenStream,
    owned_bindings: &[TokenStream],
    engine_call_plain: &TokenStream,
    error_ty: &TokenStream,
    dispatch_map_err: &TokenStream,
) -> TokenStream {
    let raw_binding = format_ident!("__raw");
    let matrix_binding = format_ident!("__matrix");

    // Workbook-scope reads: no matrix, no post-filter — but we still
    // need to enforce `effective_access(principal, Workbook) >= Read`
    // before dispatching, per ARCHITECTURE.md §6.5:
    //   "effective_access < required ⇒ error before dispatch".
    // The fast path above already handles `security_active == false`;
    // this is the gated arm. Fallible signatures surface denial via
    // `SecurityError::Denied`; non-fallible signatures have no error
    // channel, so they can only call `effective_access` as a side
    // effect (event-bus observation) and let the engine call proceed —
    // method authors who want enforcement must opt into `Result<_,
    // SecurityError>` on the return type.
    if matches!(scope, Scope::Workbook) {
        let required_level = quote! { compute_security::AccessLevel::Read };
        let method_name_lit = method.name.clone();
        return if method.is_fallible {
            quote! {
                #fast_path
                #principal_materialize
                #(#owned_bindings)*
                self.#dispatch_field
                    .query_engine(move |e| -> Result<_, #error_ty> {
                        let __actual = e.effective_access(
                            &__principal,
                            &compute_security::AccessTarget::Workbook,
                        );
                        if __actual < #required_level {
                            return Err(compute_security::SecurityError::Denied {
                                principal: __principal.clone(),
                                target: compute_security::AccessTarget::Workbook,
                                required: #required_level,
                                actual: __actual,
                                operation: #method_name_lit,
                            }
                            .into());
                        }
                        Ok(#engine_call_plain?)
                    })
                    #dispatch_map_err
            }
        } else {
            // Non-fallible workbook reads: no error channel, so denial
            // cannot be signalled. We still consult `effective_access`
            // so (a) the principal is observed (R5.4 event-bus hook),
            // and (b) the dispatch shape matches the fallible arm for
            // audit consistency — mirrors the non-fallible sheet/
            // workbook write path below (`let _ = e.check_write(...)`).
            // The macro cannot gate without the caller opting into a
            // `Result<..., SecurityError>` return; that's a method-
            // author choice, not a codegen hack.
            quote! {
                #fast_path
                #principal_materialize
                #(#owned_bindings)*
                self.#dispatch_field
                    .query_engine(move |e| {
                        let _ = e.effective_access(
                            &__principal,
                            &compute_security::AccessTarget::Workbook,
                        );
                        #engine_call_plain
                    })
                    .expect("bridge delegate: engine dispatch failed")
            }
        };
    }

    // Cell / range / sheet scopes: fetch the matrix for the sheet on
    // the engine thread. Signature must carry a `SheetId` — enforced by
    // `validate_scope_signature` up-front so we should never see None
    // here for cell/range/sheet scope.
    let sheet_name = match find_param_by_type_substr(method, "SheetId") {
        Some(n) => n,
        None => {
            return compile_error(
                method.span,
                &format!(
                    "method {}: scope = \"{}\" requires a param of type SheetId",
                    method.name,
                    match scope {
                        Scope::Cell => "cell",
                        Scope::Range => "range",
                        Scope::Sheet => "sheet",
                        Scope::Workbook => unreachable!(),
                    }
                ),
            );
        }
    };
    let sheet_val = sheet_by_value(method, &sheet_name);
    let matrix_stmt = quote! {
        let #matrix_binding = e.active_matrix(&__principal, #sheet_val);
    };
    let postfilter = emit_read_postfilter(method, scope, &raw_binding, &matrix_binding);

    if method.is_fallible {
        quote! {
            #fast_path
            #principal_materialize
            #(#owned_bindings)*
            self.#dispatch_field
                .query_engine(move |e| -> Result<_, #error_ty> {
                    let #raw_binding = #engine_call_plain?;
                    #matrix_stmt
                    Ok(#postfilter)
                })
                #dispatch_map_err
        }
    } else {
        quote! {
            #fast_path
            #principal_materialize
            #(#owned_bindings)*
            self.#dispatch_field
                .query_engine(move |e| {
                    let #raw_binding = #engine_call_plain;
                    #matrix_stmt
                    #postfilter
                })
                .expect("bridge delegate: engine dispatch failed")
        }
    }
}

/// Build the gated body for `Access::Write` / `Access::Structural`.
/// Per ARCHITECTURE.md §6.5:
/// - `scope = "cell"` writes use `matrix.get(row, col)` (no `AccessTarget::Cell`).
/// - `scope = "range"` writes use `matrix.is_uniform()` fast path or a
///   per-cell iteration over `matrix.get` across the range bounds.
/// - `scope = "sheet"` / `scope = "workbook"` writes use `check_write`
///   against the corresponding `AccessTarget` — the policy model's
///   native coarse-grained granularity.
pub(super) fn emit_gated_write(
    method: &Method,
    scope: Scope,
    dispatch_field: &Ident,
    fast_path: &TokenStream,
    principal_materialize: &TokenStream,
    owned_bindings: &[TokenStream],
    engine_call_with_principal: &TokenStream,
    dispatch_map_err: &TokenStream,
) -> TokenStream {
    let required_level = if matches!(method.access, Access::Structural) {
        quote! { compute_security::AccessLevel::Admin }
    } else {
        quote! { compute_security::AccessLevel::Write }
    };

    match scope {
        Scope::Cell => {
            // Cell-scope writes: single matrix.get + compare. The denial
            // target is reported as the enclosing sheet because policies
            // never target individual cells — the matrix IS the per-cell
            // primitive.
            let sheet_name = match find_param_by_type_substr(method, "SheetId") {
                Some(n) => n,
                None => {
                    return compile_error(
                        method.span,
                        &format!(
                            "method {}: scope = \"cell\" requires a param of type SheetId",
                            method.name
                        ),
                    );
                }
            };
            let sheet_val = sheet_by_value(method, &sheet_name);
            let (row, col) = match cell_scope_row_col(method) {
                Ok(rc) => rc,
                Err(err_tok) => return err_tok,
            };
            let method_name_lit = method.name.clone();

            if method.is_fallible {
                quote! {
                    #fast_path
                    #principal_materialize
                    #(#owned_bindings)*
                    self.#dispatch_field
                        .call_engine(move |e| {
                            let __matrix = e.active_matrix(&__principal, #sheet_val);
                            let __actual = __matrix.get(#row, #col);
                            if __actual < #required_level {
                                // Cell-scope denial constructs the typed
                                // error directly (not via check_write),
                                // so emit the diagnostic event here too.
                                e.push_security_event(
                                    compute_security::SecurityEvent::AccessDenied {
                                        principal_tags: __principal.tags().to_vec(),
                                        target: compute_security::AccessTarget::Sheet { sheet_id: #sheet_val },
                                        operation: #method_name_lit.to_string(),
                                    },
                                );
                                return Err(compute_security::SecurityError::Denied {
                                    principal: __principal.clone(),
                                    target: compute_security::AccessTarget::Sheet { sheet_id: #sheet_val },
                                    required: #required_level,
                                    actual: __actual,
                                    operation: #method_name_lit,
                                }
                                .into());
                            }
                            #engine_call_with_principal
                        })
                        #dispatch_map_err
                }
            } else {
                // Non-fallible cell-scope writes under gating are unusual;
                // keep symmetry with the rest of the emission. Denial
                // silently drops — the design expects writes to be fallible.
                quote! {
                    #fast_path
                    #principal_materialize
                    #(#owned_bindings)*
                    self.#dispatch_field
                        .call_engine(move |e| {
                            let __matrix = e.active_matrix(&__principal, #sheet_val);
                            if __matrix.get(#row, #col) < #required_level {
                                return Default::default();
                            }
                            #engine_call_with_principal
                        })
                        .expect("bridge delegate: engine dispatch failed")
                }
            }
        }
        Scope::Range => {
            // Range-scope writes: is_uniform() fast path, else iterate.
            let sheet_name = match find_param_by_type_substr(method, "SheetId") {
                Some(n) => n,
                None => {
                    return compile_error(
                        method.span,
                        &format!(
                            "method {}: scope = \"range\" requires a param of type SheetId",
                            method.name
                        ),
                    );
                }
            };
            let sheet_val = sheet_by_value(method, &sheet_name);
            let (sr, sc, er, ec) = match range_scope_bounds(method) {
                Ok(b) => b,
                Err(err_tok) => return err_tok,
            };
            let method_name_lit = method.name.clone();

            if method.is_fallible {
                quote! {
                    #fast_path
                    #principal_materialize
                    #(#owned_bindings)*
                    self.#dispatch_field
                        .call_engine(move |e| {
                            let __matrix = e.active_matrix(&__principal, #sheet_val);
                            if let Some(__lvl) = __matrix.is_uniform() {
                                if __lvl < #required_level {
                                    // Emit the diagnostic event before
                                    // returning the typed error so SDK
                                    // consumers draining the buffer see
                                    // the denial (mirrors the emission
                                    // inside `check_write` for the
                                    // sheet/workbook arm).
                                    e.push_security_event(
                                        compute_security::SecurityEvent::AccessDenied {
                                            principal_tags: __principal.tags().to_vec(),
                                            target: compute_security::AccessTarget::Sheet { sheet_id: #sheet_val },
                                            operation: #method_name_lit.to_string(),
                                        },
                                    );
                                    return Err(compute_security::SecurityError::Denied {
                                        principal: __principal.clone(),
                                        target: compute_security::AccessTarget::Sheet { sheet_id: #sheet_val },
                                        required: #required_level,
                                        actual: __lvl,
                                        operation: #method_name_lit,
                                    }
                                    .into());
                                }
                            } else {
                                let (__sr, __sc, __er, __ec) =
                                    (#sr, #sc, #er, #ec);
                                for __r in __sr..=__er {
                                    for __c in __sc..=__ec {
                                        let __actual = __matrix.get(__r, __c);
                                        if __actual < #required_level {
                                            // Range-scope is fail-fast:
                                            // one emitted event per
                                            // denied call falls out
                                            // naturally here.
                                            e.push_security_event(
                                                compute_security::SecurityEvent::AccessDenied {
                                                    principal_tags: __principal.tags().to_vec(),
                                                    target: compute_security::AccessTarget::Sheet { sheet_id: #sheet_val },
                                                    operation: #method_name_lit.to_string(),
                                                },
                                            );
                                            return Err(compute_security::SecurityError::Denied {
                                                principal: __principal.clone(),
                                                target: compute_security::AccessTarget::Sheet { sheet_id: #sheet_val },
                                                required: #required_level,
                                                actual: __actual,
                                                operation: #method_name_lit,
                                            }
                                            .into());
                                        }
                                    }
                                }
                            }
                            #engine_call_with_principal
                        })
                        #dispatch_map_err
                }
            } else {
                // Non-fallible range-scope writes are ill-formed under
                // gated = true: a range crossing non-uniform column
                // policies requires per-cell denial, but a non-fallible
                // signature has no error channel — the denial would
                // silently fall through to `Default::default()` and
                // the mutation would never happen, without the caller
                // ever learning it was denied. That's a correctness
                // trap. Reject at the macro boundary; all in-tree
                // range-scope writes are fallible (return
                // `Result<_, ComputeError>`). A method author who
                // wants range-scope gating must make the return
                // fallible so denial can surface.
                compile_error(
                    method.span,
                    &format!(
                        "method {}: non-fallible scope = \"range\" writes are not supported under gated = true — range writes must be fallible so per-cell denial can be signalled (non-uniform column policies cannot be enforced on a signature without an error channel)",
                        method.name
                    ),
                )
            }
        }
        Scope::Sheet | Scope::Workbook => {
            // Sheet / Workbook: coarse-grained check_write.
            let access_target = match build_check_write_target(method, scope) {
                Ok(t) => t,
                Err(err_tok) => return err_tok,
            };
            // `method_name_lit` is defined locally in the cell (:1211) and
            // range (:1275) arms above — mirror that here so the
            // `#method_name_lit` expansion below has it in scope. The
            // literal threads into `check_write`'s new `operation` arg
            // (R9.1) so the emitted `AccessDenied` event carries the
            // caller-visible method name.
            let method_name_lit = method.name.clone();
            if method.is_fallible {
                quote! {
                    #fast_path
                    #principal_materialize
                    #(#owned_bindings)*
                    self.#dispatch_field
                        .call_engine(move |e| {
                            e.check_write(&__principal, &#access_target, #required_level, #method_name_lit)?;
                            #engine_call_with_principal
                        })
                        #dispatch_map_err
                }
            } else {
                quote! {
                    #fast_path
                    #principal_materialize
                    #(#owned_bindings)*
                    self.#dispatch_field
                        .call_engine(move |e| {
                            let _ = e.check_write(&__principal, &#access_target, #required_level, #method_name_lit);
                            #engine_call_with_principal
                        })
                        .expect("bridge delegate: engine dispatch failed")
                }
            }
        }
    }
}
