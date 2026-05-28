use proc_macro2::TokenStream;
use quote::{format_ident, quote};

use super::ir::{Access, Method};

pub(super) fn is_gated_kind(access: Access) -> bool {
    matches!(access, Access::Read | Access::Write | Access::Structural)
}

/// Extract the first param name whose recorded type string matches
/// `needle` on its *last path segment*. The matcher strips whitespace,
/// then strips a single leading `&` and any `mut` qualifier, then
/// splits on `::` and compares the final segment for exact equality.
///
/// This powers the type-based AccessTarget constructor — we never match
/// on param names, only on the type token sequence, so renaming params
/// is safe (§6.5). Using last-path-segment equality (rather than
/// `ends_with`) avoids a classic suffix pitfall: a param typed
/// `MySheetId` would otherwise satisfy `ends_with("SheetId")` and be
/// promoted to the sheet slot, silently routing a different domain
/// type through the gating primitive.
pub(super) fn find_param_by_type_substr(method: &Method, needle: &str) -> Option<String> {
    let needle = needle.replace(char::is_whitespace, "");
    for p in &method.params {
        let mut ty = p.ty.replace(char::is_whitespace, "");
        // Strip outer `&` and optional `mut`.
        if let Some(rest) = ty.strip_prefix('&') {
            ty = rest.to_string();
        }
        if let Some(rest) = ty.strip_prefix("mut") {
            ty = rest.to_string();
        }
        // Compare the last path segment for exact equality. Splitting on
        // `::` handles both unqualified (`SheetId`) and qualified
        // (`types::SheetId`, `crate::cell_types::SheetId`) forms.
        let last = ty.rsplit("::").next().unwrap_or(&ty);
        if last == needle.as_str() {
            return Some(p.name.clone());
        }
    }
    None
}

/// Build a token stream that evaluates to `SheetId` **by value** inside
/// the engine-thread closure. When the declared param is `&SheetId`,
/// `emit_delegate_method` produces a sibling `{name}_owned` binding
/// (via `owned_bindings`) of the owned type on the service thread —
/// the closure captures `{name}_owned` and passes it by value. When
/// the param is already `SheetId`, we pass it directly.
///
/// Using the `_owned` binding is critical inside `move` closures: a
/// `&SheetId` borrowed for the method body cannot cross into a `'static`
/// closure. The `_owned` copy (cheap — `SheetId: Copy`) is what moves.
pub(super) fn sheet_by_value(method: &Method, param_name: &str) -> TokenStream {
    let is_ref = method
        .params
        .iter()
        .find(|p| p.name == param_name)
        .map(|p| p.ty.trim().starts_with('&') || p.ty.contains("& SheetId"))
        .unwrap_or(false);
    if is_ref {
        let owned = format_ident!("{}_owned", param_name);
        quote! { #owned }
    } else {
        let ident = format_ident!("{}", param_name);
        quote! { #ident }
    }
}

/// True when the method's signature ends in a `caller: &Principal` param.
pub(super) fn trailing_is_principal_ref(method: &Method) -> bool {
    let Some(last) = method.params.last() else {
        return false;
    };
    let ty = last.ty.replace(char::is_whitespace, "");
    ty == "&Principal"
        || ty.ends_with("::Principal") && ty.starts_with('&')
        || ty.ends_with("&Principal")
}

/// Emit a `compile_error!(..)` token stream.
pub(super) fn compile_error(span: proc_macro2::Span, msg: &str) -> TokenStream {
    syn::Error::new(span, msg).to_compile_error()
}

/// Classify scope. Returns None if the string is not a recognized scope.
#[derive(Debug, Clone, Copy)]
pub(super) enum Scope {
    Cell,
    Range,
    Sheet,
    Workbook,
}

pub(super) fn parse_scope(s: &str) -> Option<Scope> {
    match s {
        "cell" => Some(Scope::Cell),
        "range" => Some(Scope::Range),
        "sheet" => Some(Scope::Sheet),
        "workbook" => Some(Scope::Workbook),
        _ => None,
    }
}

/// Look up a parameter by its exact declared name. Unlike
/// `find_param_by_type_substr`, this is strictly a name match — used only
/// for the `row: u32` / `col: u32` pair that identifies cell addresses in
/// the engine's flat-u32 convention (no `CellAddr` type exists in the
/// compute-core engine; its methods always take `row: u32, col: u32`).
///
/// This keeps the rename-safe property for the common scope=cell case:
/// both `row` and `col` must be present under those exact names for the
/// macro to accept the method, which is a reviewable token just like a
/// type annotation would be.
pub(super) fn find_param_by_exact_name(method: &Method, name: &str) -> Option<String> {
    method
        .params
        .iter()
        .find(|p| p.name == name)
        .map(|p| p.name.clone())
}

/// Resolve a (row, col) identifier pair for cell-scope gating. Two
/// conventions are accepted, in order:
/// 1. `addr: CellAddr` — type-based extraction; `addr.row` and `addr.col`
///    are used downstream.
/// 2. `row: u32, col: u32` — name-based extraction; both must be present.
///
/// Returns token streams that evaluate to `row` and `col` u32s.
pub(super) fn cell_scope_row_col(
    method: &Method,
) -> Result<(TokenStream, TokenStream), TokenStream> {
    if let Some(addr_name) = find_param_by_type_substr(method, "CellAddr") {
        let ident = format_ident!("{}", addr_name);
        return Ok((quote! { #ident.row }, quote! { #ident.col }));
    }
    let row = find_param_by_exact_name(method, "row").ok_or_else(|| {
        compile_error(
            method.span,
            &format!(
                "method {}: scope = \"cell\" requires either `addr: CellAddr` or `row: u32, col: u32`",
                method.name
            ),
        )
    })?;
    let col = find_param_by_exact_name(method, "col").ok_or_else(|| {
        compile_error(
            method.span,
            &format!(
                "method {}: scope = \"cell\" requires `col: u32` alongside `row: u32`",
                method.name
            ),
        )
    })?;
    let row_i = format_ident!("{}", row);
    let col_i = format_ident!("{}", col);
    Ok((quote! { #row_i }, quote! { #col_i }))
}

/// Resolve (start_row, start_col, end_row, end_col) for range-scope
/// gating. Accepts:
/// 1. `range: CellRange` — type-based; the iteration uses
///    `range.start.row..=range.end.row`, similarly for col.
/// 2. `start_row: u32, start_col: u32, end_row: u32, end_col: u32` —
///    name-based; the flat-u32 convention pervasive in compute-core.
pub(super) fn range_scope_bounds(
    method: &Method,
) -> Result<(TokenStream, TokenStream, TokenStream, TokenStream), TokenStream> {
    if let Some(range_name) = find_param_by_type_substr(method, "CellRange") {
        let ident = format_ident!("{}", range_name);
        return Ok((
            quote! { #ident.start.row },
            quote! { #ident.start.col },
            quote! { #ident.end.row },
            quote! { #ident.end.col },
        ));
    }
    let names = ["start_row", "start_col", "end_row", "end_col"];
    for n in &names {
        if find_param_by_exact_name(method, n).is_none() {
            return Err(compile_error(
                method.span,
                &format!(
                    "method {}: scope = \"range\" requires either `range: CellRange` or `start_row/start_col/end_row/end_col: u32`",
                    method.name
                ),
            ));
        }
    }
    let [sr, sc, er, ec] = names.map(|n| format_ident!("{}", n));
    Ok((
        quote! { #sr },
        quote! { #sc },
        quote! { #er },
        quote! { #ec },
    ))
}

/// Verify the engine signature satisfies the scope's coordinate
/// requirements. Run once up-front from `emit_delegate_method` so a
/// signature mismatch short-circuits the whole method body — the caller
/// then only sees the scope-requirement compile_error, not a cascade of
/// unrelated plumbing errors against the stub service's missing fields.
pub(super) fn validate_scope_signature(method: &Method, scope: Scope) -> Result<(), TokenStream> {
    match scope {
        Scope::Cell => {
            // Cell-scope reads and writes both require a SheetId plus a
            // (row, col) pair — either as `addr: CellAddr` or as two
            // `u32`s named `row` and `col`.
            if find_param_by_type_substr(method, "SheetId").is_none() {
                return Err(compile_error(
                    method.span,
                    &format!(
                        "method {}: scope = \"cell\" requires a param of type SheetId",
                        method.name
                    ),
                ));
            }
            if find_param_by_type_substr(method, "CellAddr").is_none()
                && (find_param_by_exact_name(method, "row").is_none()
                    || find_param_by_exact_name(method, "col").is_none())
            {
                return Err(compile_error(
                    method.span,
                    &format!(
                        "method {}: scope = \"cell\" requires either `addr: CellAddr` or `row: u32, col: u32`",
                        method.name
                    ),
                ));
            }
        }
        Scope::Range => {
            if find_param_by_type_substr(method, "SheetId").is_none() {
                return Err(compile_error(
                    method.span,
                    &format!(
                        "method {}: scope = \"range\" requires a param of type SheetId",
                        method.name
                    ),
                ));
            }
            if find_param_by_type_substr(method, "CellRange").is_none() {
                let names = ["start_row", "start_col", "end_row", "end_col"];
                if names
                    .iter()
                    .any(|n| find_param_by_exact_name(method, n).is_none())
                {
                    return Err(compile_error(
                        method.span,
                        &format!(
                            "method {}: scope = \"range\" requires either `range: CellRange` or `start_row/start_col/end_row/end_col: u32`",
                            method.name
                        ),
                    ));
                }
            }
        }
        Scope::Sheet => {
            if find_param_by_type_substr(method, "SheetId").is_none() {
                return Err(compile_error(
                    method.span,
                    &format!(
                        "method {}: scope = \"sheet\" requires a param of type SheetId",
                        method.name
                    ),
                ));
            }
        }
        Scope::Workbook => {
            // Workbook scope: no signature requirements. A `SheetId` param
            // is permitted (and common — many workbook-level reads pass a
            // sheet for scoping) but not required.
        }
    }
    Ok(())
}
