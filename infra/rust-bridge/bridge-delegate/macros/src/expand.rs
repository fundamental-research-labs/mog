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

use proc_macro2::{Ident, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{LitBool, Token, braced};

// ---------------------------------------------------------------------------
// Intermediate representation (same as WASM, minus WASM-specific bits)
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct DelegateDescriptor {
    /// Target type that will receive the delegate methods (e.g., "ComputeService")
    target_type: String,
    /// Field on the target type that provides dispatch (e.g., "dispatch")
    dispatch_field: String,
    /// B.1: when set, wrap each gated method (read/write/structural) with the
    /// security fast-path + gated-path. `false` keeps the pre-B.1 codegen.
    gated: bool,
    /// When true, suppress the default `use compute_core::...` imports in the
    /// generated module. Tests use this to avoid a compute-core dev-dep; the
    /// production path (compute-api) keeps imports on (the default).
    skip_default_imports: bool,
    /// Original source type name (e.g., "YrsComputeEngine"). Kept in the IR
    /// for debugging / future use; downstream re-emission uses target_type.
    #[allow(dead_code)]
    source_type: String,
    /// Group name from the descriptor
    group: String,
    /// Function prefix from the descriptor
    fn_prefix: Option<String>,
    /// Whether this is a service (stateful) or stateless descriptor
    service: Option<ServiceMeta>,
    /// All methods from the descriptor
    methods: Vec<Method>,
}

#[derive(Debug)]
struct ServiceMeta {
    key_param: String,
}

#[derive(Debug)]
struct Method {
    access: Access,
    name: String,
    params: Vec<Param>,
    return_type: Option<ReturnInfo>,
    error_type: Option<String>,
    is_fallible: bool,
    is_async: bool,
    skip_targets: Vec<String>,
    /// B.1: `scope = "..."` from the engine attribute.
    scope: Option<String>,
    /// B.1: `needs_principal` on `#[bridge::write(needs_principal)]`.
    needs_principal: bool,
    /// Source span for the `method` DSL token — used for compile_error! targeting.
    span: proc_macro2::Span,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Access {
    Pure,
    Read,
    Write,
    Structural,
    /// R2.4: interior-mutable `&self` methods (e.g. `set_active_principal`
    /// via `ArcSwap`). Under `gated = true` the delegate treats these like
    /// `Pure` — no security gate is applied. They are re-emitted as
    /// `method session` so downstream codegens preserve the `&self`
    /// receiver shape.
    Session,
    LifecycleCreate,
}

#[derive(Debug)]
struct Param {
    name: String,
    ty: String,
    tag: ParamTag,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

#[derive(Debug)]
struct ReturnInfo {
    ty: String,
    #[allow(dead_code)]
    is_bytes_tuple: bool,
    /// The inner serde type when is_bytes_tuple is true
    #[allow(dead_code)]
    serde_inner_ty: Option<String>,
}

// ---------------------------------------------------------------------------
// Return type classification
// ---------------------------------------------------------------------------

fn classify_return(ty_str: &str) -> ReturnInfo {
    let trimmed = ty_str.trim();
    let (is_bytes_tuple, serde_inner_ty) = parse_bytes_tuple(trimmed);
    ReturnInfo {
        ty: trimmed.to_string(),
        is_bytes_tuple,
        serde_inner_ty,
    }
}

fn parse_bytes_tuple(ty: &str) -> (bool, Option<String>) {
    let trimmed = ty.trim();
    if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
        return (false, None);
    }
    let inner = trimmed[1..trimmed.len() - 1].trim();
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut angle_depth: i32 = 0;
    for ch in inner.chars() {
        match ch {
            '<' => {
                angle_depth += 1;
                current.push(ch);
            }
            '>' => {
                angle_depth -= 1;
                current.push(ch);
            }
            ',' if angle_depth == 0 => {
                parts.push(current.trim().to_string());
                current = String::new();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    if parts.len() != 2 {
        return (false, None);
    }
    let first = parts[0].replace(' ', "");
    if first != "Vec<u8>" {
        return (false, None);
    }
    (true, Some(parts[1].clone()))
}

// ---------------------------------------------------------------------------
// Parsing descriptor tokens
// ---------------------------------------------------------------------------

pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: DelegateDescriptor = syn::parse2(input)?;
    Ok(expand(&desc))
}

impl Parse for DelegateDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // First, parse delegate config tokens (prepended by the descriptor macro's second arm)
        // delegate_target = ComputeService;
        // delegate_dispatch = dispatch;
        // delegate_gated = true;    (optional — B.1; defaults false)
        let mut target_type: Option<String> = None;
        let mut dispatch_field: Option<String> = None;
        let mut gated: bool = false;
        let mut skip_default_imports: bool = false;

        while input.peek(syn::Ident)
            && (peek_ident_eq(input, "delegate_target")
                || peek_ident_eq(input, "delegate_dispatch")
                || peek_ident_eq(input, "delegate_gated")
                || peek_ident_eq(input, "delegate_skip_default_imports"))
        {
            let kw: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            match kw.to_string().as_str() {
                "delegate_target" => {
                    let val: Ident = input.parse()?;
                    target_type = Some(val.to_string());
                }
                "delegate_dispatch" => {
                    let val: Ident = input.parse()?;
                    dispatch_field = Some(val.to_string());
                }
                "delegate_gated" => {
                    let b: LitBool = input.parse()?;
                    gated = b.value;
                }
                "delegate_skip_default_imports" => {
                    let b: LitBool = input.parse()?;
                    skip_default_imports = b.value;
                }
                _ => {}
            }
            let _: Token![;] = input.parse()?;
        }

        let target_type = target_type
            .ok_or_else(|| syn::Error::new(input.span(), "missing delegate_target = <Type>;"))?;
        let dispatch_field = dispatch_field
            .ok_or_else(|| syn::Error::new(input.span(), "missing delegate_dispatch = <field>;"))?;

        // Now parse the standard descriptor DSL
        // bridge_version = 1;
        let _: Ident = input.parse()?;
        let _: Token![=] = input.parse()?;
        let _version: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        let mut service: Option<ServiceMeta> = None;
        let mut source_type: Option<String> = None;
        let mut group = String::new();
        let mut fn_prefix: Option<String> = None;

        // group = identifier;
        if input.peek(syn::Ident) && peek_ident_eq(input, "group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let g: Ident = input.parse()?;
            group = g.to_string();
            let _: Token![;] = input.parse()?;
        }

        // Optional: fn_prefix = ident | _;
        if input.peek(syn::Ident) && peek_ident_eq(input, "fn_prefix") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            if input.peek(Token![_]) {
                let _: Token![_] = input.parse()?;
                fn_prefix = Some(String::new());
            } else {
                let prefix_ident: Ident = input.parse()?;
                fn_prefix = Some(prefix_ident.to_string());
            }
            let _: Token![;] = input.parse()?;
        }

        // Optional: type_name = X;
        if input.peek(syn::Ident) && peek_ident_eq(input, "type_name") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let tn: Ident = input.parse()?;
            source_type = Some(tn.to_string());
            let _: Token![;] = input.parse()?;
        }

        // Optional: service = TypeName; key_type = str; key_param = "param_name";
        if input.peek(syn::Ident) && peek_ident_eq(input, "service") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let svc_ident: Ident = input.parse()?;
            source_type = Some(svc_ident.to_string());
            let _: Token![;] = input.parse()?;

            // key_type = str;
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let _key_type: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;

            // key_param = "store_id";
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let key_param_lit: syn::LitStr = input.parse()?;
            let _: Token![;] = input.parse()?;

            service = Some(ServiceMeta {
                key_param: key_param_lit.value(),
            });
        }

        // Parse methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            let method = parse_method(input)?;
            methods.push(method);
        }

        let source_type = source_type.unwrap_or_else(|| "Unknown".to_string());

        Ok(DelegateDescriptor {
            target_type,
            dispatch_field,
            gated,
            skip_default_imports,
            source_type,
            group,
            fn_prefix,
            service,
            methods,
        })
    }
}

fn peek_ident_eq(input: ParseStream, expected: &str) -> bool {
    input
        .fork()
        .parse::<Ident>()
        .map(|i| i == expected)
        .unwrap_or(false)
}

fn parse_method(input: ParseStream) -> syn::Result<Method> {
    let kind_ident: Ident = input.parse()?;
    let kind_str = kind_ident.to_string();
    let span = kind_ident.span();

    let (access, name) = match kind_str.as_str() {
        "lifecycle" => {
            let lifecycle_kind: Ident = input.parse()?;
            if lifecycle_kind != "create" {
                return Err(syn::Error::new(
                    lifecycle_kind.span(),
                    format!("unknown lifecycle kind: {}", lifecycle_kind),
                ));
            }
            let method_name: Ident = input.parse()?;
            (Access::LifecycleCreate, method_name.to_string())
        }
        "method" => {
            let access_ident: Ident = input.parse()?;
            let access = match access_ident.to_string().as_str() {
                "pure" => Access::Pure,
                "read" => Access::Read,
                "write" => Access::Write,
                "structural" => Access::Structural,
                "session" => Access::Session,
                other => {
                    return Err(syn::Error::new(
                        access_ident.span(),
                        format!("unknown access level: {}", other),
                    ));
                }
            };
            let method_name: Ident = input.parse()?;
            (access, method_name.to_string())
        }
        other => {
            return Err(syn::Error::new(
                kind_ident.span(),
                format!("expected 'lifecycle' or 'method', found '{}'", other),
            ));
        }
    };

    let content;
    braced!(content in input);

    // params { ... }
    let params_kw: Ident = content.parse()?;
    if params_kw != "params" {
        return Err(syn::Error::new(
            params_kw.span(),
            format!("expected 'params', found '{}'", params_kw),
        ));
    }
    let params_content;
    braced!(params_content in content);
    let params = parse_params(&params_content)?;

    let mut return_type: Option<ReturnInfo> = None;
    let mut error_type: Option<String> = None;
    let mut is_fallible = false;
    let mut is_async = false;
    let mut skip_targets = Vec::new();
    let mut scope: Option<String> = None;
    let mut needs_principal = false;

    while !content.is_empty() {
        // `async` is a Rust keyword so syn::Ident won't parse it —
        // check for it explicitly before falling through to Ident parsing.
        if content.peek(Token![async]) {
            let _: Token![async] = content.parse()?;
            let _: Token![;] = content.parse()?;
            is_async = true;
            continue;
        }

        let kw: Ident = content.parse()?;
        match kw.to_string().as_str() {
            "return_type" => {
                let _: Token![=] = content.parse()?;
                let ty_str = parse_type_until_semicolon(&content)?;
                let _: Token![;] = content.parse()?;
                let info = classify_return(&ty_str);
                return_type = Some(info);
            }
            "error_type" => {
                let _: Token![=] = content.parse()?;
                let ty_str = parse_type_until_semicolon(&content)?;
                let _: Token![;] = content.parse()?;
                error_type = Some(ty_str);
            }
            "fallible" => {
                let _: Token![;] = content.parse()?;
                is_fallible = true;
            }
            "scope" => {
                let _: Token![=] = content.parse()?;
                let lit: syn::LitStr = content.parse()?;
                let _: Token![;] = content.parse()?;
                scope = Some(lit.value());
            }
            "needs_principal" => {
                let _: Token![;] = content.parse()?;
                needs_principal = true;
            }
            "skip" => {
                let target: Ident = content.parse()?;
                let _: Token![;] = content.parse()?;
                skip_targets.push(target.to_string());
            }
            other => {
                return Err(syn::Error::new(
                    kw.span(),
                    format!("unexpected keyword: '{}'", other),
                ));
            }
        }
    }

    Ok(Method {
        access,
        name,
        params,
        return_type,
        error_type,
        is_fallible,
        is_async,
        skip_targets,
        scope,
        needs_principal,
        span,
    })
}

fn parse_params(input: ParseStream) -> syn::Result<Vec<Param>> {
    let mut params = Vec::new();
    while !input.is_empty() {
        let tag_content;
        syn::bracketed!(tag_content in input);
        let tag_ident: Ident = tag_content.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => ParamTag::Str,
            "prim" => ParamTag::Prim,
            "bytes" => ParamTag::Bytes,
            "serde" => ParamTag::Serde,
            "parse" => ParamTag::Parse,
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!("unknown param tag: {}", other),
                ));
            }
        };
        let name: Ident = input.parse()?;
        let _: Token![:] = input.parse()?;
        let ty_str = parse_type_until_comma_or_end(input)?;
        if input.peek(Token![,]) {
            let _: Token![,] = input.parse()?;
        }
        params.push(Param {
            name: name.to_string(),
            ty: ty_str,
            tag,
        });
    }
    Ok(params)
}

fn parse_type_until_semicolon(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    let mut angle_depth: i32 = 0;
    while !input.is_empty() {
        if angle_depth == 0 && input.peek(Token![;]) {
            break;
        }
        let tt: proc_macro2::TokenTree = input.parse()?;
        let s = tt.to_string();
        if s == "<" {
            angle_depth += 1;
        } else if s == ">" {
            angle_depth -= 1;
        }
        tokens.push(s);
    }
    Ok(join_type_tokens(&tokens))
}

fn parse_type_until_comma_or_end(input: ParseStream) -> syn::Result<String> {
    let mut tokens = Vec::new();
    let mut angle_depth: i32 = 0;
    while !input.is_empty() {
        if angle_depth == 0 && input.peek(Token![,]) {
            break;
        }
        let tt: proc_macro2::TokenTree = input.parse()?;
        let s = tt.to_string();
        if s == "<" {
            angle_depth += 1;
        } else if s == ">" {
            angle_depth -= 1;
        }
        tokens.push(s);
    }
    Ok(join_type_tokens(&tokens))
}

fn join_type_tokens(tokens: &[String]) -> String {
    let mut result = String::new();
    for (i, tok) in tokens.iter().enumerate() {
        if i > 0 {
            let prev = &tokens[i - 1];
            let skip_space = prev == "&"
                || prev.ends_with('<')
                || prev.ends_with('(')
                || tok.starts_with('<')
                || tok.starts_with('>')
                || tok == "&"
                || (prev == ":" && tok == ":")
                || (tok == ":" && i + 1 < tokens.len() && tokens[i + 1] == ":");
            if !skip_space {
                result.push(' ');
            }
        }
        result.push_str(tok);
    }
    result
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// B.1 gating helpers
// ---------------------------------------------------------------------------

/// Is this method kind subject to gating?
fn is_gated_kind(access: Access) -> bool {
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
fn find_param_by_type_substr(method: &Method, needle: &str) -> Option<String> {
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
fn sheet_by_value(method: &Method, param_name: &str) -> TokenStream {
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
fn trailing_is_principal_ref(method: &Method) -> bool {
    let Some(last) = method.params.last() else {
        return false;
    };
    let ty = last.ty.replace(char::is_whitespace, "");
    ty == "&Principal"
        || ty.ends_with("::Principal") && ty.starts_with('&')
        || ty.ends_with("&Principal")
}

/// Emit a `compile_error!(..)` token stream.
fn compile_error(span: proc_macro2::Span, msg: &str) -> TokenStream {
    syn::Error::new(span, msg).to_compile_error()
}

/// Classify scope. Returns None if the string is not a recognized scope.
#[derive(Debug, Clone, Copy)]
enum Scope {
    Cell,
    Range,
    Sheet,
    Workbook,
}

fn parse_scope(s: &str) -> Option<Scope> {
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
fn find_param_by_exact_name(method: &Method, name: &str) -> Option<String> {
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
fn cell_scope_row_col(method: &Method) -> Result<(TokenStream, TokenStream), TokenStream> {
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
fn range_scope_bounds(
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

/// Build the `AccessTarget` token stream for sheet- and workbook-scope
/// methods (the scopes that consult `check_write`). Cell- and range-
/// scope use `matrix.get` directly and have no `AccessTarget` (policies
/// never target individual cells — §6.5). Returns `Err` iff the scope
/// requires a `SheetId` that the signature lacks.
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

/// Verify the engine signature satisfies the scope's coordinate
/// requirements. Run once up-front from `emit_delegate_method` so a
/// signature mismatch short-circuits the whole method body — the caller
/// then only sees the scope-requirement compile_error, not a cascade of
/// unrelated plumbing errors against the stub service's missing fields.
fn validate_scope_signature(method: &Method, scope: Scope) -> Result<(), TokenStream> {
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

/// Build the gated body for `Access::Read` methods. Workbook-scope reads
/// skip the matrix fetch entirely (policies never redact workbook-level
/// metadata; the post-filter is a passthrough). All other scopes fetch
/// the (principal, sheet) matrix once on the engine thread and pass it
/// into the scope-appropriate post-filter.
fn emit_gated_read(
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
fn emit_gated_write(
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

/// Generate a single delegate method.
fn emit_delegate_method(method: &Method, dispatch_field: &Ident, gated: bool) -> TokenStream {
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

/// Re-emit a descriptor macro for the target type.
///
/// This produces `__bridge_descriptor_<TargetType>_<group>` which has the same
/// methods but with:
/// - service = <TargetType> (instead of the source type)
/// - bytes-tuple return types stripped to just the inner type
/// - scope and needs_principal stripped (downstream codegens don't know them)
/// - Structural collapsed to write (downstream codegens don't know structural)
/// - needs_principal-stripped signatures (drop trailing `caller: &Principal`)
///
/// Uses `quote!` token streams throughout — no string interpolation.
fn emit_new_descriptor(desc: &DelegateDescriptor) -> TokenStream {
    let target_ident = format_ident!("{}", desc.target_type);
    let group_ident = format_ident!("{}", desc.group);
    let macro_name = format_ident!("__bridge_descriptor_{}_{}", desc.target_type, desc.group);

    // Build method tokens using quote! (same DSL format as bridge-core/emit.rs)
    let mut method_tokens = Vec::new();

    for method in &desc.methods {
        let kind_and_access = match method.access {
            Access::LifecycleCreate => quote! { lifecycle create },
            Access::Pure => quote! { method pure },
            Access::Read => quote! { method read },
            // Structural collapses to write in re-emission — downstream codegens
            // (bridge-napi/pyo3/wasm/tauri) don't yet recognize `method structural`,
            // and from their perspective the method is a mutation either way.
            // The original Structural semantics were already consumed by the
            // delegate macro's gated wrapper above.
            Access::Write | Access::Structural => quote! { method write },
            // R2.4: keep `session` distinct when re-emitting so downstream
            // codegens preserve `&self`. All four (napi/pyo3/tauri/wasm)
            // now parse `method session` as an alias for `method read` at
            // the FFI-shape level.
            Access::Session => quote! { method session },
        };

        let name_ident = format_ident!("{}", method.name);

        // Strip the trailing principal param for needs_principal methods —
        // downstream codegens must see the public signature (without principal).
        let public_params: Vec<&Param> = if method.needs_principal {
            let n = method.params.len().saturating_sub(1);
            method.params.iter().take(n).collect()
        } else {
            method.params.iter().collect()
        };

        let param_tokens: Vec<TokenStream> = public_params
            .iter()
            .map(|p| {
                let tag = match p.tag {
                    ParamTag::Str => quote! { [str] },
                    ParamTag::Prim => quote! { [prim] },
                    ParamTag::Bytes => quote! { [bytes] },
                    ParamTag::Serde => quote! { [serde] },
                    ParamTag::Parse => quote! { [parse] },
                };
                let pname = format_ident!("{}", p.name);
                let pty: proc_macro2::TokenStream = p.ty.parse().unwrap_or_else(|_| quote!(()));
                quote! { #tag #pname: #pty, }
            })
            .collect();

        // Return type — keep original (no bytes-tuple stripping)
        let return_ty_str = if let Some(ref ret) = method.return_type {
            ret.ty.clone()
        } else {
            "()".to_string()
        };
        let return_ty: proc_macro2::TokenStream =
            return_ty_str.parse().unwrap_or_else(|_| quote!(()));
        let return_tokens = quote! { return_type = #return_ty; };

        // Error type
        let error_tokens = match &method.error_type {
            Some(et) => {
                let ety: proc_macro2::TokenStream = et.parse().unwrap_or_else(|_| quote!(()));
                quote! { error_type = #ety; }
            }
            None => TokenStream::new(),
        };

        // Fallible
        let fallible_tokens = if method.is_fallible {
            quote! { fallible; }
        } else {
            TokenStream::new()
        };

        // Async
        let async_tokens = if method.is_async {
            quote! { async; }
        } else {
            TokenStream::new()
        };

        // Note: scope and needs_principal are deliberately NOT re-emitted —
        // downstream codegens don't recognize them, and their contract was
        // already discharged by the gated wrapper.

        // Skip targets
        let skip_tokens: Vec<TokenStream> = method
            .skip_targets
            .iter()
            .map(|t| {
                let target = format_ident!("{}", t);
                quote! { skip #target; }
            })
            .collect();

        method_tokens.push(quote! {
            #kind_and_access #name_ident {
                params { #(#param_tokens)* }
                #return_tokens
                #error_tokens
                #fallible_tokens
                #async_tokens
                #(#skip_tokens)*
            }
        });
    }

    // Service metadata
    let service_tokens = if let Some(ref svc) = desc.service {
        let key_param_str = &svc.key_param;
        quote! {
            service = #target_ident;
            key_type = str;
            key_param = #key_param_str;
        }
    } else {
        quote! {
            type_name = #target_ident;
        }
    };

    // fn_prefix
    let fn_prefix_token = match &desc.fn_prefix {
        Some(p) if p.is_empty() => quote! { fn_prefix = _; },
        Some(p) => {
            let prefix_ident = format_ident!("{}", p);
            quote! { fn_prefix = #prefix_ident; }
        }
        None => TokenStream::new(),
    };

    quote! {
        #[doc(hidden)]
        #[macro_export]
        macro_rules! #macro_name {
            ($gen:path) => {
                $gen! {
                    bridge_version = 1;
                    group = #group_ident;
                    #fn_prefix_token
                    #service_tokens
                    #(#method_tokens)*
                }
            };
            ($gen:path, $($extra:tt)*) => {
                $gen! {
                    $($extra)*
                    bridge_version = 1;
                    group = #group_ident;
                    #fn_prefix_token
                    #service_tokens
                    #(#method_tokens)*
                }
            };
        }
    }
}
