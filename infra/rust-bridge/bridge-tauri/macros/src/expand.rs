//! Parse descriptor tokens and generate Tauri command code.

use proc_macro2::{Ident, Span, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{LitStr, Token, Type, braced, bracketed};

// ---------------------------------------------------------------------------
// Intermediate representation
// ---------------------------------------------------------------------------

pub(crate) struct TauriDescriptor {
    pub group: Ident,
    pub fn_prefix: Option<String>,
    pub type_name: Ident,
    pub service: Option<TauriServiceMeta>,
    pub methods: Vec<TauriMethod>,
    /// Optional security level (e.g., `Sensitive`, `Critical`).
    /// When set, each generated command gets extra params for
    /// `verify_request` (timestamp, nonce, signature, window, app).
    pub security_level: Option<Ident>,
}

pub(crate) struct TauriServiceMeta {
    pub key_param: String,
}

pub(crate) struct TauriMethod {
    pub access: TauriAccess,
    pub name: Ident,
    pub params: Vec<TauriParam>,
    pub return_info: ReturnInfo,
    pub is_fallible: bool,
    pub is_async: bool,
    pub skip_targets: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TauriAccess {
    Pure,
    Read,
    Write,
    LifecycleCreate,
    LifecycleCreateFrom { variant_name: String },
}

pub(crate) struct TauriParam {
    pub name: Ident,
    pub original_ty: Type,
    pub tag: TauriParamTag,
    pub is_ref: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TauriParamTag {
    Str,
    Prim,
    Bytes,
    Serde,
    Parse,
}

pub(crate) struct ReturnInfo {
    pub ty: Option<Type>,
    /// True when the return type is plain `Vec<u8>`. For Tauri, we return
    /// `tauri::ipc::Response` to send raw bytes over IPC instead of JSON.
    pub is_bytes: bool,
    /// True when the return type is a tuple `(Vec<u8>, T)`.
    pub is_bytes_tuple: bool,
    /// When `is_bytes_tuple` is true, this holds the serde-serializable inner
    /// type (the second element of the tuple).
    #[allow(dead_code)]
    pub serde_inner_ty: Option<Type>,
    /// True when the return type is a tuple `(Self, T)` — used for lifecycle
    /// create methods that return auxiliary data alongside the new instance.
    pub is_self_tuple: bool,
    /// When `is_self_tuple` is true, this holds the second element type.
    pub self_tuple_inner_ty: Option<Type>,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Try to parse an ident from a fork of the stream without consuming.
/// Returns Some(ident_string) if the next token is an ident, None otherwise.
fn try_peek_ident(input: ParseStream) -> Option<String> {
    let fork = input.fork();
    fork.parse::<Ident>().ok().map(|i| i.to_string())
}

impl Parse for TauriDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // Optional: security_level = Ident;
        // This is prepended by the generate! macro's second arm via the
        // descriptor macro's ($gen:path, $($extra:tt)*) arm.
        let security_level = if try_peek_ident(input).as_deref() == Some("security_level") {
            let _: Ident = input.parse()?; // "security_level"
            let _: Token![=] = input.parse()?;
            let level: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;
            Some(level)
        } else {
            None
        };

        // bridge_version = 1;
        let _: Ident = input.parse()?; // "bridge_version"
        let _: Token![=] = input.parse()?;
        let _: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        // group = identifier; (always present)
        let group = if try_peek_ident(input).as_deref() == Some("group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let g: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;
            g
        } else {
            Ident::new("default", Span::call_site())
        };

        // Optional: fn_prefix = ident;
        // `fn_prefix = _;` means empty (no prefix), `fn_prefix = foo;` means use "foo".
        let fn_prefix = if try_peek_ident(input).as_deref() == Some("fn_prefix") {
            let _: Ident = input.parse()?; // "fn_prefix"
            let _: Token![=] = input.parse()?;
            if input.peek(Token![_]) {
                let _: Token![_] = input.parse()?;
                let _: Token![;] = input.parse()?;
                Some(String::new())
            } else {
                let prefix_ident: Ident = input.parse()?;
                let _: Token![;] = input.parse()?;
                Some(prefix_ident.to_string())
            }
        } else {
            None
        };

        // Optional: type_name = TypeName; (emitted for stateless/non-service APIs)
        let mut type_name: Option<Ident> = None;
        if try_peek_ident(input).as_deref() == Some("type_name") {
            let _: Ident = input.parse()?; // "type_name"
            let _: Token![=] = input.parse()?;
            type_name = Some(input.parse()?);
            let _: Token![;] = input.parse()?;
        }

        // Optional: service = TypeName; key_type = str; key_param = "store_id";
        let (service, svc_type_name) = parse_service_header(input)?;
        // Service name takes precedence over type_name
        let type_name = svc_type_name.or(type_name);

        // Methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            methods.push(parse_method(input)?);
        }

        // For stateless descriptors, the type name is not in the token body
        // (it only appears in the macro name). Use "_" as a sentinel so we
        // know not to add a type prefix to generated function names.
        let type_name = type_name.unwrap_or_else(|| Ident::new("_", Span::call_site()));

        Ok(TauriDescriptor {
            group,
            fn_prefix,
            type_name,
            service,
            methods,
            security_level,
        })
    }
}

/// Parse optional service header, returning (service_meta, type_name).
fn parse_service_header(
    input: ParseStream,
) -> syn::Result<(Option<TauriServiceMeta>, Option<Ident>)> {
    // Check if next token is the ident "service"
    if try_peek_ident(input).as_deref() == Some("service") {
        let _: Ident = input.parse()?; // "service"
        let _: Token![=] = input.parse()?;
        let type_name: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        // key_type = str;
        let _kt_ident: Ident = input.parse()?; // "key_type"
        let _: Token![=] = input.parse()?;
        let _key_type: Ident = input.parse()?; // "str" (always use String for Tauri)
        let _: Token![;] = input.parse()?;

        // key_param = "store_id";
        let _kp_ident: Ident = input.parse()?; // "key_param"
        let _: Token![=] = input.parse()?;
        let key_param: LitStr = input.parse()?;
        let _: Token![;] = input.parse()?;

        return Ok((
            Some(TauriServiceMeta {
                key_param: key_param.value(),
            }),
            Some(type_name),
        ));
    }
    Ok((None, None))
}

fn parse_method(input: ParseStream) -> syn::Result<TauriMethod> {
    // Either: "lifecycle create method_name { ... }"
    // Or:     "method (pure|read|write) method_name { ... }"
    let keyword: Ident = input.parse()?;
    let access = match keyword.to_string().as_str() {
        "lifecycle" => {
            let kind: Ident = input.parse()?;
            match kind.to_string().as_str() {
                "create" => TauriAccess::LifecycleCreate,
                "create_from" => {
                    let variant_name: Ident = input.parse()?;
                    TauriAccess::LifecycleCreateFrom {
                        variant_name: variant_name.to_string(),
                    }
                }
                other => {
                    return Err(syn::Error::new(
                        kind.span(),
                        format!("expected 'create' or 'create_from', got '{}'", other),
                    ));
                }
            }
        }
        "method" => {
            let access_ident: Ident = input.parse()?;
            match access_ident.to_string().as_str() {
                "pure" => TauriAccess::Pure,
                "read" => TauriAccess::Read,
                "write" => TauriAccess::Write,
                // R2.4 added `session` for `&self` interior-mutable methods
                // (e.g. `set_active_principal`). Tauri commands are plain
                // functions that take service state by shared reference, so
                // `session` behaves like `read` here — same FFI shape, no
                // mut borrow.
                "session" => TauriAccess::Read,
                other => {
                    return Err(syn::Error::new(
                        access_ident.span(),
                        format!("expected pure/read/write/session, got '{}'", other),
                    ));
                }
            }
        }
        other => {
            return Err(syn::Error::new(
                keyword.span(),
                format!("expected 'lifecycle' or 'method', got '{}'", other),
            ));
        }
    };

    let name: Ident = input.parse()?;

    let body;
    braced!(body in input);

    // params { ... }
    let _params_kw: Ident = body.parse()?; // "params"
    let params_body;
    braced!(params_body in body);
    let mut params = Vec::new();
    while !params_body.is_empty() {
        params.push(parse_param(&params_body)?);
    }

    // return_type = Type;
    let _rt_kw: Ident = body.parse()?; // "return_type"
    let _: Token![=] = body.parse()?;
    let return_ty: Type = body.parse()?;
    let _: Token![;] = body.parse()?;

    let is_unit = is_unit_type(&return_ty);

    // Optional: error_type = Type;
    let mut is_fallible = false;
    if try_peek_ident(&body).as_deref() == Some("error_type") {
        let _: Ident = body.parse()?; // "error_type"
        let _: Token![=] = body.parse()?;
        let _error_ty: Type = body.parse()?;
        let _: Token![;] = body.parse()?;
    }

    // Optional: fallible;
    if try_peek_ident(&body).as_deref() == Some("fallible") {
        let _: Ident = body.parse()?;
        let _: Token![;] = body.parse()?;
        is_fallible = true;
    }

    // Optional: async;
    let mut is_async = false;
    if body.peek(Token![async]) {
        let _: Token![async] = body.parse()?;
        let _: Token![;] = body.parse()?;
        is_async = true;
    }

    // Optional: skip <target>;  (may appear multiple times)
    let mut skip_targets = Vec::new();
    while try_peek_ident(&body).as_deref() == Some("skip") {
        let _: Ident = body.parse()?;
        let target: Ident = body.parse()?;
        let _: Token![;] = body.parse()?;
        skip_targets.push(target.to_string());
    }

    let is_bytes = if !is_unit {
        is_vec_u8(&return_ty)
    } else {
        false
    };
    let (is_bytes_tuple, serde_inner_ty) = if !is_unit && !is_bytes {
        match extract_bytes_tuple_inner(&return_ty) {
            Some(inner) => (true, Some(inner)),
            None => (false, None),
        }
    } else {
        (false, None)
    };
    let (is_self_tuple, self_tuple_inner_ty) = if !is_unit && !is_bytes && !is_bytes_tuple {
        match extract_self_tuple_inner(&return_ty) {
            Some(inner) => (true, Some(inner)),
            None => (false, None),
        }
    } else {
        (false, None)
    };

    let return_info = ReturnInfo {
        ty: if is_unit { None } else { Some(return_ty) },
        is_bytes,
        is_bytes_tuple,
        serde_inner_ty,
        is_self_tuple,
        self_tuple_inner_ty,
    };

    Ok(TauriMethod {
        access,
        name,
        params,
        return_info,
        is_fallible,
        is_async,
        skip_targets,
    })
}

fn parse_param(input: ParseStream) -> syn::Result<TauriParam> {
    // [tag] name: Type,
    let tag_content;
    bracketed!(tag_content in input);
    let tag_ident: Ident = tag_content.parse()?;
    let tag = match tag_ident.to_string().as_str() {
        "str" => TauriParamTag::Str,
        "prim" => TauriParamTag::Prim,
        "bytes" => TauriParamTag::Bytes,
        "serde" => TauriParamTag::Serde,
        "parse" => TauriParamTag::Parse,
        other => {
            return Err(syn::Error::new(
                tag_ident.span(),
                format!("unknown param tag: '{}'", other),
            ));
        }
    };

    let name: Ident = input.parse()?;
    let _: Token![:] = input.parse()?;
    let ty: Type = input.parse()?;
    let _: Token![,] = input.parse()?;

    let is_ref = matches!(&ty, Type::Reference(_));

    Ok(TauriParam {
        name,
        original_ty: ty,
        tag,
        is_ref,
    })
}

fn is_unit_type(ty: &Type) -> bool {
    if let Type::Tuple(t) = ty {
        t.elems.is_empty()
    } else {
        false
    }
}

/// Check if a type is `Vec<u8>`.
fn is_vec_u8(ty: &Type) -> bool {
    if let Type::Path(p) = ty
        && let Some(seg) = p.path.segments.last()
        && seg.ident == "Vec"
        && let syn::PathArguments::AngleBracketed(args) = &seg.arguments
        && args.args.len() == 1
        && let syn::GenericArgument::Type(Type::Path(inner)) = &args.args[0]
    {
        return inner.path.is_ident("u8");
    }
    false
}

/// Check if a type is a `(Vec<u8>, T)` tuple, returning `Some(T)` if so.
fn extract_bytes_tuple_inner(ty: &Type) -> Option<Type> {
    if let Type::Tuple(t) = ty
        && t.elems.len() == 2
    {
        let first = &t.elems[0];
        if is_vec_u8(first) {
            return Some(t.elems[1].clone());
        }
    }
    None
}

/// Check if a type is a `(Self, T)` tuple, returning `Some(T)` if so.
fn extract_self_tuple_inner(ty: &Type) -> Option<Type> {
    if let Type::Tuple(t) = ty
        && t.elems.len() == 2
    {
        let first = &t.elems[0];
        if is_self_type(first) {
            return Some(t.elems[1].clone());
        }
    }
    None
}

fn is_self_type(ty: &Type) -> bool {
    if let Type::Path(p) = ty
        && let Some(seg) = p.path.segments.last()
    {
        return seg.ident == "Self";
    }
    false
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: TauriDescriptor = syn::parse2(input)?;
    Ok(expand_descriptor(&desc))
}

fn to_snake_case(name: &str) -> String {
    let mut result = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_uppercase() {
            if i > 0 {
                result.push('_');
            }
            result.push(ch.to_lowercase().next().unwrap());
        } else {
            result.push(ch);
        }
    }
    result
}

fn expand_descriptor(desc: &TauriDescriptor) -> TokenStream {
    let is_service = desc.service.is_some();
    let type_name = &desc.type_name;
    let type_snake = to_snake_case(&type_name.to_string());
    let has_type_prefix = *type_name != "_";

    // Compute the effective prefix for generated function names.
    // fn_prefix overrides the default type_snake prefix.
    let effective_prefix = match &desc.fn_prefix {
        Some(p) if !p.is_empty() => p.clone(),
        Some(_) => String::new(), // explicit empty = no prefix
        None => {
            if has_type_prefix {
                type_snake.clone()
            } else {
                String::new()
            }
        }
    };

    // Only the "primary" descriptor (the one that declares a non-skipped
    // lifecycle create) emits infrastructure: registry type, destroy command.
    // Secondary descriptors for the same service type only emit method functions.
    let declares_lifecycle = desc.methods.iter().any(|m| {
        matches!(
            m.access,
            TauriAccess::LifecycleCreate | TauriAccess::LifecycleCreateFrom { .. }
        ) && !m.skip_targets.contains(&"tauri".to_string())
    });

    let mut command_fns = Vec::new();

    // For service mode, generate the registry type and the state alias
    // ONLY if this descriptor has lifecycle create (primary descriptor).
    let registry_def = if is_service && declares_lifecycle {
        let registry_ident = format_ident!("{}Registry", type_name);
        quote! {
            pub struct TauriRegistry<T: Send + Sync + 'static> {
                inner: parking_lot::RwLock<std::collections::HashMap<String, T>>,
            }

            impl<T: Send + Sync + 'static> TauriRegistry<T> {
                pub fn new() -> Self {
                    Self {
                        inner: parking_lot::RwLock::new(std::collections::HashMap::new()),
                    }
                }

                pub fn insert(&self, key: String, value: T) {
                    self.inner.write().insert(key, value);
                }

                pub fn remove(&self, key: &str) -> Option<T> {
                    self.inner.write().remove(key)
                }

                pub fn with_read<F, R>(&self, key: &str, f: F) -> Result<R, String>
                where
                    F: FnOnce(&T) -> R,
                {
                    let guard = self.inner.read();
                    let value = guard.get(key).ok_or_else(|| {
                        format!("instance not found: {}", key)
                    })?;
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        f(value)
                    }))
                    .map_err(|_| "Internal panic".to_string())
                }

                pub fn with_write<F, R>(&self, key: &str, f: F) -> Result<R, String>
                where
                    F: FnOnce(&mut T) -> R,
                {
                    let mut guard = self.inner.write();
                    let value = guard.get_mut(key).ok_or_else(|| {
                        format!("instance not found: {}", key)
                    })?;
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        f(value)
                    }))
                    .map_err(|_| "Internal panic".to_string())
                }

                /// Clone a service instance out of the registry for async use.
                ///
                /// The lock is acquired only long enough to clone the value, then
                /// released before the caller `.await`s — avoiding the `!Send`
                /// problem with `parking_lot::RwLock` guards across await points.
                pub fn clone_for_async(&self, key: &str) -> Result<T, String>
                where
                    T: Clone,
                {
                    let guard = self.inner.read();
                    let value = guard.get(key).ok_or_else(|| {
                        format!("instance not found: {}", key)
                    })?;
                    Ok(value.clone())
                }
            }

            pub type #registry_ident = TauriRegistry<#type_name>;
        }
    } else {
        TokenStream::new()
    };

    // Generate each method, collecting command function names for the handlers macro.
    let mut command_names: Vec<Ident> = Vec::new();

    for method in &desc.methods {
        if method.skip_targets.contains(&"tauri".to_string()) {
            continue;
        }
        let (fn_tokens, fn_name) = expand_method(desc, method, &effective_prefix);
        command_fns.push(fn_tokens);
        command_names.push(fn_name);
    }

    // For service mode, also generate a destroy command (only in primary descriptor)
    if is_service
        && declares_lifecycle
        && let Some(ref svc) = desc.service
    {
        let key_param_ident = format_ident!("{}", svc.key_param);
        let fn_name = if effective_prefix.is_empty() {
            format_ident!("destroy")
        } else {
            format_ident!("{}_{}", effective_prefix, "destroy")
        };
        let registry_ident = format_ident!("{}Registry", type_name);

        let destroy_fn = if let Some(ref level) = desc.security_level {
            let operation_str = fn_name.to_string();
            quote! {
                #[tauri::command]
                pub async fn #fn_name(
                    state: tauri::State<'_, #registry_ident>,
                    #key_param_ident: String,
                    __sec_timestamp: Option<u64>,
                    __sec_nonce: Option<String>,
                    __sec_signature: Option<String>,
                    window: tauri::Window,
                    app: tauri::AppHandle,
                ) -> Result<(), String> {
                    let _ctx = crate::security::verify_request(
                        crate::security::SecurityLevel::#level,
                        #operation_str,
                        __sec_timestamp.unwrap_or(0),
                        &__sec_nonce.as_deref().unwrap_or(""),
                        &__sec_signature.as_deref().unwrap_or(""),
                        &window,
                        &app,
                    ).await?;
                    state.remove(&#key_param_ident);
                    Ok(())
                }
            }
        } else {
            quote! {
                #[tauri::command]
                pub async fn #fn_name(
                    state: tauri::State<'_, #registry_ident>,
                    #key_param_ident: String,
                ) -> Result<(), String> {
                    state.remove(&#key_param_ident);
                    Ok(())
                }
            }
        };
        command_fns.push(destroy_fn);
        command_names.push(fn_name);
    }

    // Wrap all generated code in a module to isolate Tauri's internal
    // `__cmd__*` macro definitions which otherwise conflict at module scope.
    let mod_name = format_ident!("__bridge_{}_{}", type_snake, desc.group);

    // Emit a helper macro that expands to the comma-separated list of
    // fully-qualified command handler paths for `tauri::generate_handler![]`.
    let handlers_macro_name = format_ident!("__bridge_handlers_{}_{}", type_snake, desc.group);
    let qualified_names: Vec<TokenStream> = command_names
        .iter()
        .map(|name| quote! { #mod_name::#name })
        .collect();

    quote! {
        mod #mod_name {
            use super::*;
            #registry_def
            #(#command_fns)*
        }
        pub use #mod_name::*;

        #[doc(hidden)]
        #[macro_export]
        macro_rules! #handlers_macro_name {
            () => {
                #(#qualified_names),*
            };
        }
    }
}

fn expand_method(
    desc: &TauriDescriptor,
    method: &TauriMethod,
    effective_prefix: &str,
) -> (TokenStream, Ident) {
    let method_name = &method.name;
    let fn_name = if effective_prefix.is_empty() {
        method_name.clone()
    } else {
        format_ident!("{}_{}", effective_prefix, method_name)
    };

    let type_name = &desc.type_name;
    let is_service = desc.service.is_some();

    // Build parameter list for the function signature
    let mut sig_params = Vec::new();
    let mut call_args = Vec::new();
    let mut parse_stmts = Vec::new();

    // For service methods (non-pure), add state and key params
    if is_service && method.access != TauriAccess::Pure {
        let registry_ident = format_ident!("{}Registry", type_name);
        if let Some(ref svc) = desc.service {
            let key_param_ident = format_ident!("{}", svc.key_param);
            sig_params.push(quote! { state: tauri::State<'_, #registry_ident> });
            sig_params.push(quote! { #key_param_ident: String });
        }
    }

    // For lifecycle create/create_from, the key param is already in sig_params
    // from the service block above. Skip it in the method params to avoid duplicates.
    let key_param_name = if is_service
        && matches!(
            method.access,
            TauriAccess::LifecycleCreate | TauriAccess::LifecycleCreateFrom { .. }
        ) {
        desc.service.as_ref().map(|s| s.key_param.clone())
    } else {
        None
    };

    // Add method parameters
    for param in &method.params {
        let param_name = &param.name;

        // Skip the key param for lifecycle create — already added above.
        let is_key_param = key_param_name.as_deref() == Some(&param_name.to_string());
        if is_key_param {
            // Still add to call_args so the constructor receives the value.
            call_args.push(quote! { #param_name });
            continue;
        }

        match param.tag {
            TauriParamTag::Str => {
                // &str -> String param, pass &param to call
                // String -> String param, pass directly
                sig_params.push(quote! { #param_name: String });
                if param.is_ref {
                    call_args.push(quote! { &#param_name });
                } else {
                    call_args.push(quote! { #param_name });
                }
            }
            TauriParamTag::Prim => {
                let ty = &param.original_ty;
                sig_params.push(quote! { #param_name: #ty });
                call_args.push(quote! { #param_name });
            }
            TauriParamTag::Bytes => {
                // &[u8] -> Vec<u8>, pass &param
                // Vec<u8> -> Vec<u8>, pass directly
                sig_params.push(quote! { #param_name: Vec<u8> });
                if param.is_ref {
                    call_args.push(quote! { &#param_name });
                } else {
                    call_args.push(quote! { #param_name });
                }
            }
            TauriParamTag::Serde => {
                // Accept serde_json::Value — Tauri auto-deserializes JSON into this.
                // We then explicitly deserialize to the target type so we can
                // intercept "missing field" errors and report ALL missing fields
                // at once via bridge_types::check_missing_fields.
                sig_params.push(quote! { #param_name: serde_json::Value });

                let converted = format_ident!("{}_converted", param.name);
                let target_ty = if param.is_ref {
                    let derefed = deref_type(&param.original_ty);
                    if let Type::Slice(ts) = &derefed {
                        let elem = &ts.elem;
                        syn::parse_quote! { Vec<#elem> }
                    } else {
                        derefed
                    }
                } else {
                    param.original_ty.clone()
                };

                parse_stmts.push(quote! {
                    let #converted: #target_ty = match serde_json::from_value::<#target_ty>(#param_name.clone()) {
                        Ok(v) => v,
                        Err(e) if e.to_string().contains("missing field") => {
                            return Err(bridge_types::enhance_missing_field_error(&#param_name, &e));
                        }
                        Err(e) => return Err(bridge_types::bridge_format_err!(e)),
                    };
                });

                if param.is_ref {
                    call_args.push(quote! { &#converted });
                } else {
                    call_args.push(quote! { #converted });
                }
            }
            TauriParamTag::Parse => {
                // String -> T::bridge_parse(&param)?
                let parsed_ident = format_ident!("{}_parsed", param_name);
                sig_params.push(quote! { #param_name: String });
                let inner_ty = if param.is_ref {
                    deref_type(&param.original_ty)
                } else {
                    param.original_ty.clone()
                };
                parse_stmts.push(quote! {
                    let #parsed_ident = <#inner_ty as bridge_types::BridgeParse>::bridge_parse(&#param_name)
                        .map_err(|e| bridge_types::bridge_format_err!(e))?;
                });
                if param.is_ref {
                    call_args.push(quote! { &#parsed_ident });
                } else {
                    call_args.push(quote! { #parsed_ident });
                }
            }
        }
    }

    // When security_level is set, add security params to the function signature
    // and prepend a verify_request call to the body.
    if desc.security_level.is_some() {
        sig_params.push(quote! { __sec_timestamp: Option<u64> });
        sig_params.push(quote! { __sec_nonce: Option<String> });
        sig_params.push(quote! { __sec_signature: Option<String> });
        sig_params.push(quote! { window: tauri::Window });
        sig_params.push(quote! { app: tauri::AppHandle });
    }

    // For bytes or bytes-tuple returns, we use tauri::ipc::Response to send
    // raw binary data instead of JSON-serialized number arrays.
    let is_binary_return = method.return_info.is_bytes || method.return_info.is_bytes_tuple;

    // Build the function body
    let raw_body = build_method_body(desc, method, &call_args, &parse_stmts);

    // Wrap the body for binary returns
    let body = if method.return_info.is_bytes {
        // Plain Vec<u8> -> tauri::ipc::Response
        quote! {
            let __raw_result = (|| { #raw_body })();
            __raw_result.map(|bytes| tauri::ipc::Response::new(bytes))
        }
    } else if method.return_info.is_bytes_tuple {
        // (Vec<u8>, T) -> tauri::ipc::Response with packed format:
        // [4-byte LE bytes length][raw bytes][JSON metadata]
        quote! {
            let __raw_result = (|| { #raw_body })();
            __raw_result.map(|(bytes, metadata)| {
                let meta_json = serde_json::to_vec(&metadata).unwrap_or_default();
                let bytes_len = (bytes.len() as u32).to_le_bytes();
                let mut buf = Vec::with_capacity(4 + bytes.len() + meta_json.len());
                buf.extend_from_slice(&bytes_len);
                buf.extend_from_slice(&bytes);
                buf.extend_from_slice(&meta_json);
                tauri::ipc::Response::new(buf)
            })
        }
    } else {
        raw_body
    };

    // Prepend security verification when security_level is set
    let body = if let Some(ref level) = desc.security_level {
        let operation_str = fn_name.to_string();
        quote! {
            let _ctx = crate::security::verify_request(
                crate::security::SecurityLevel::#level,
                #operation_str,
                __sec_timestamp.unwrap_or(0),
                &__sec_nonce.as_deref().unwrap_or(""),
                &__sec_signature.as_deref().unwrap_or(""),
                &window,
                &app,
            ).await?;
            #body
        }
    } else {
        body
    };

    // Return type
    let ret_type = if is_binary_return {
        quote! { Result<tauri::ipc::Response, String> }
    } else if method.return_info.is_self_tuple {
        // (Self, T) lifecycle create -> return T after storing Self
        let inner = method.return_info.self_tuple_inner_ty.as_ref().unwrap();
        quote! { Result<#inner, String> }
    } else {
        match &method.return_info.ty {
            Some(ty) if is_self_type(ty) => quote! { Result<(), String> },
            Some(ty) => quote! { Result<#ty, String> },
            None => quote! { Result<(), String> },
        }
    };

    let tokens = quote! {
        #[tauri::command]
        pub async fn #fn_name(#(#sig_params),*) -> #ret_type {
            #body
        }
    };

    (tokens, fn_name)
}

fn build_method_body(
    desc: &TauriDescriptor,
    method: &TauriMethod,
    call_args: &[TokenStream],
    parse_stmts: &[TokenStream],
) -> TokenStream {
    // Async methods use a separate code path that avoids holding RwLock
    // guards across `.await` points.
    if method.is_async {
        return build_async_method_body(desc, method, call_args, parse_stmts);
    }

    let type_name = &desc.type_name;
    let method_name = &method.name;

    let parse_block = if parse_stmts.is_empty() {
        TokenStream::new()
    } else {
        quote! { #(#parse_stmts)* }
    };

    match method.access {
        TauriAccess::Pure => {
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*) };
            let wrapped = wrap_with_catch_unwind(call_expr, method.is_fallible);
            quote! {
                #parse_block
                #wrapped
            }
        }
        TauriAccess::LifecycleCreate => {
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*) };
            let returns_self_tuple = method.return_info.is_self_tuple;

            // Clone the key before the constructor call, since the constructor
            // may consume the key parameter (e.g. `new(instance_id: String)`).
            if method.is_fallible {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let (instance, __data) = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let instance = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            } else {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let (instance, __data) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let instance = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            }
        }
        TauriAccess::LifecycleCreateFrom { .. } => {
            // Same behavior as LifecycleCreate — creates instance, stores in registry
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*) };
            let returns_self_tuple = method.return_info.is_self_tuple;

            if method.is_fallible {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let (instance, __data) = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        let instance = result.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            } else {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let (instance, __data) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let __key = #key_param_ident.clone();
                        let instance = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            #call_expr
                        }))
                        .map_err(|_| "Internal panic".to_string())?;
                        state.insert(__key, instance);
                        Ok(())
                    }
                }
            }
        }
        TauriAccess::Read => {
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let inner_call = quote! { svc.#method_name(#(#call_args),*) };

            if method.is_fallible {
                quote! {
                    #parse_block
                    state.with_read(&#key_param_ident, |svc| {
                        #inner_call
                    })?
                    .map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    state.with_read(&#key_param_ident, |svc| {
                        #inner_call
                    })
                }
            }
        }
        TauriAccess::Write => {
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let inner_call = quote! { svc.#method_name(#(#call_args),*) };

            if method.is_fallible {
                quote! {
                    #parse_block
                    state.with_write(&#key_param_ident, |svc| {
                        #inner_call
                    })?
                    .map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    state.with_write(&#key_param_ident, |svc| {
                        #inner_call
                    })
                }
            }
        }
    }
}

/// Build the body of an async method.
///
/// For service methods (Read/Write), we clone the service out of the registry
/// so the lock is released before the `.await`.  For pure (stateless) methods
/// we simply call the associated function with `.await`.
fn build_async_method_body(
    desc: &TauriDescriptor,
    method: &TauriMethod,
    call_args: &[TokenStream],
    parse_stmts: &[TokenStream],
) -> TokenStream {
    let type_name = &desc.type_name;
    let method_name = &method.name;

    let parse_block = if parse_stmts.is_empty() {
        TokenStream::new()
    } else {
        quote! { #(#parse_stmts)* }
    };

    match method.access {
        TauriAccess::Pure => {
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*).await };
            if method.is_fallible {
                quote! {
                    #parse_block
                    #call_expr.map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    Ok(#call_expr)
                }
            }
        }
        TauriAccess::Read | TauriAccess::Write => {
            // Both read and write async methods use clone_for_async.
            // The service manages its own internal mutability (e.g. via Arc<Mutex>).
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let inner_call = quote! { svc.#method_name(#(#call_args),*).await };

            if method.is_fallible {
                quote! {
                    #parse_block
                    let svc = state.clone_for_async(&#key_param_ident)?;
                    #inner_call.map_err(|e| bridge_types::bridge_format_err!(e))
                }
            } else {
                quote! {
                    #parse_block
                    let svc = state.clone_for_async(&#key_param_ident)?;
                    Ok(#inner_call)
                }
            }
        }
        TauriAccess::LifecycleCreate | TauriAccess::LifecycleCreateFrom { .. } => {
            // Lifecycle create/create_from is unlikely to be async, but handle it
            // for completeness. Fall back to the same pattern as sync — lifecycle
            // creates don't hold the lock across the call anyway.
            let key_param_ident = if let Some(ref svc) = desc.service {
                format_ident!("{}", svc.key_param)
            } else {
                format_ident!("key")
            };
            let call_expr = quote! { #type_name::#method_name(#(#call_args),*).await };
            let returns_self_tuple = method.return_info.is_self_tuple;

            if method.is_fallible {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let (instance, __data) = #call_expr.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let instance = #call_expr.map_err(|e| bridge_types::bridge_format_err!(e))?;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(())
                    }
                }
            } else {
                if returns_self_tuple {
                    quote! {
                        #parse_block
                        let (instance, __data) = #call_expr;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(__data)
                    }
                } else {
                    quote! {
                        #parse_block
                        let instance = #call_expr;
                        state.insert(#key_param_ident.clone(), instance);
                        Ok(())
                    }
                }
            }
        }
    }
}

fn wrap_with_catch_unwind(call_expr: TokenStream, is_fallible: bool) -> TokenStream {
    if is_fallible {
        quote! {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #call_expr
            }))
            .map_err(|_| "Internal panic".to_string())?
            .map_err(|e| bridge_types::bridge_format_err!(e))
        }
    } else {
        quote! {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #call_expr
            }))
            .map_err(|_| "Internal panic".to_string())
        }
    }
}

/// Strip one layer of reference from a type: `&T` -> `T`, `&mut T` -> `T`.
fn deref_type(ty: &Type) -> Type {
    if let Type::Reference(r) = ty {
        (*r.elem).clone()
    } else {
        ty.clone()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- snake_case tests ---

    #[test]
    fn snake_case_simple() {
        assert_eq!(to_snake_case("KvStore"), "kv_store");
    }

    #[test]
    fn snake_case_single_word() {
        assert_eq!(to_snake_case("Engine"), "engine");
    }

    #[test]
    fn snake_case_already_snake() {
        assert_eq!(to_snake_case("already_snake"), "already_snake");
    }

    #[test]
    fn snake_case_consecutive_caps() {
        assert_eq!(to_snake_case("HTTPServer"), "h_t_t_p_server");
    }

    #[test]
    fn snake_case_kv_utils() {
        assert_eq!(to_snake_case("KvUtils"), "kv_utils");
    }

    // --- Parsing tests ---

    fn parse_descriptor(tokens: &str) -> syn::Result<TauriDescriptor> {
        syn::parse_str::<TauriDescriptor>(tokens)
    }

    #[test]
    fn parse_service_descriptor() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.type_name.to_string(), "KvStore");
        assert!(desc.service.is_some());
        assert_eq!(desc.service.as_ref().unwrap().key_param, "store_id");
        assert_eq!(desc.methods.len(), 2);
        assert_eq!(desc.methods[0].access, TauriAccess::LifecycleCreate);
        assert_eq!(desc.methods[0].name.to_string(), "new");
        assert_eq!(desc.methods[1].access, TauriAccess::Read);
        assert_eq!(desc.methods[1].name.to_string(), "get");
    }

    #[test]
    fn parse_pure_method_params() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method pure validate_key {
                params { [str] key: &str, [prim] max_length: usize, }
                return_type = ();
                error_type = ValidationError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params.len(), 2);
        assert_eq!(m.params[0].tag, TauriParamTag::Str);
        assert_eq!(m.params[0].name.to_string(), "key");
        assert!(m.params[0].is_ref);
        assert_eq!(m.params[1].tag, TauriParamTag::Prim);
        assert_eq!(m.params[1].name.to_string(), "max_length");
        assert!(!m.params[1].is_ref);
        assert!(m.is_fallible);
    }

    #[test]
    fn parse_parse_tag() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "id";
            method read get_by_id {
                params { [parse] id: &KeyId, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params[0].tag, TauriParamTag::Parse);
        assert!(m.params[0].is_ref);
        // Verify the original type contains KeyId by rendering it to tokens
        let ty = &m.params[0].original_ty;
        let ty_tokens = quote!(#ty).to_string();
        assert!(
            ty_tokens.contains("KeyId"),
            "expected type to contain KeyId, got: {}",
            ty_tokens
        );
    }

    #[test]
    fn parse_stateless_descriptor() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = KvUtils;
            method pure hash_key {
                params { [str] key: &str, }
                return_type = u64;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.type_name.to_string(), "KvUtils");
        assert!(desc.service.is_none());
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, TauriAccess::Pure);
        assert_eq!(desc.methods[0].name.to_string(), "hash_key");
        assert!(!desc.methods[0].is_fallible);
    }

    #[test]
    fn parse_write_method() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            method write set {
                params { [str] key: &str, [serde] value: Record, }
                return_type = ();
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, TauriAccess::Write);
        assert_eq!(desc.methods[0].name.to_string(), "set");
        assert_eq!(desc.methods[0].params.len(), 2);
        assert_eq!(desc.methods[0].params[1].tag, TauriParamTag::Serde);
    }

    #[test]
    fn parse_group_name() {
        let input = r#"
            bridge_version = 1;
            group = my_group;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = u32;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.group.to_string(), "my_group");
    }

    #[test]
    fn parse_bytes_tag() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = BlobStore;
            key_type = str;
            key_param = "id";
            method write put {
                params { [bytes] data: &[u8], }
                return_type = ();
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let m = &desc.methods[0];
        assert_eq!(m.params[0].tag, TauriParamTag::Bytes);
        assert!(m.params[0].is_ref);
    }

    #[test]
    fn parse_non_fallible_method() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = Counter;
            key_type = str;
            key_param = "id";
            method read count {
                params {}
                return_type = u64;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert!(!desc.methods[0].is_fallible);
    }

    // --- Code generation tests ---

    #[test]
    fn expand_produces_tokens() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // Should contain the registry type alias
        assert!(
            code.contains("KvStoreRegistry"),
            "expected KvStoreRegistry in output, got:\n{}",
            code
        );
        // Should contain the create function
        assert!(
            code.contains("kv_store_new"),
            "expected kv_store_new in output, got:\n{}",
            code
        );
        // Should contain destroy function
        assert!(
            code.contains("kv_store_destroy"),
            "expected kv_store_destroy in output, got:\n{}",
            code
        );
        // Should contain the read method
        assert!(
            code.contains("kv_store_get"),
            "expected kv_store_get in output, got:\n{}",
            code
        );
    }

    #[test]
    fn registry_generation_requires_thread_safe_services() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();

        assert!(
            code.contains("pub struct TauriRegistry < T : Send + Sync + 'static >"),
            "expected registry type bound in output, got:\n{}",
            code
        );
        assert!(
            code.contains("impl < T : Send + Sync + 'static > TauriRegistry < T >"),
            "expected registry impl bound in output, got:\n{}",
            code
        );
        assert!(
            code.contains("pub type KvStoreRegistry = TauriRegistry < KvStore >"),
            "expected service registry alias in output, got:\n{}",
            code
        );
    }

    #[test]
    fn registry_generation_uses_borrowed_closure_dispatch() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params {}
                return_type = u32;
            }
            method write set {
                params { [prim] value: u32, }
                return_type = ();
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();

        assert!(
            code.contains("f (value)"),
            "expected direct closure call in registry accessors, got:\n{}",
            code
        );

        let forbidden = [
            ["unsafe", "impl"].join(" "),
            ["as", "*", "const"].join(" "),
            ["as", "*", "mut"].join(" "),
            ["unsafe", "{", "f"].join(" "),
            format!("{}{}", "*", "ptr"),
            ["*", "ptr"].join(" "),
            ["&", "*", "ptr"].join(" "),
            ["&", "mut", "*", "ptr"].join(" "),
        ];
        for marker in forbidden {
            assert!(
                !code.contains(&marker),
                "unexpected registry dispatch marker `{}` in output:\n{}",
                marker,
                code
            );
        }
    }

    #[test]
    fn expand_pure_method() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = KvUtils;
            method pure hash_key {
                params { [str] key: &str, }
                return_type = u64;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // Should contain the function name
        assert!(
            code.contains("kv_utils_hash_key"),
            "expected kv_utils_hash_key in output, got:\n{}",
            code
        );
        // Pure methods use catch_unwind
        assert!(
            code.contains("catch_unwind"),
            "expected catch_unwind in output, got:\n{}",
            code
        );
    }

    #[test]
    fn handlers_macro_emitted() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // Should contain the handlers macro
        assert!(
            code.contains("__bridge_handlers_kv_store_ops"),
            "expected handlers macro in output, got:\n{}",
            code
        );
        // Should reference the command function names
        assert!(
            code.contains("kv_store_new"),
            "expected kv_store_new in handlers macro output, got:\n{}",
            code
        );
        assert!(
            code.contains("kv_store_destroy"),
            "expected kv_store_destroy in handlers macro output, got:\n{}",
            code
        );
    }

    #[test]
    fn skip_tauri_method_is_excluded() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
            method write set_time {
                params { [prim] serial: f64, }
                return_type = ();
                skip tauri;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.methods.len(), 3);
        assert_eq!(desc.methods[2].skip_targets, vec!["tauri".to_string()]);

        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // set_time should be excluded from Tauri output
        assert!(
            !code.contains("kv_store_set_time"),
            "set_time should be skipped for tauri but was found in output: {}",
            code
        );
        // get should still be included
        assert!(
            code.contains("kv_store_get"),
            "get should be present in tauri output: {}",
            code
        );
    }

    #[test]
    fn skip_wasm_not_filtered_in_tauri() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
                skip wasm;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert_eq!(desc.methods[1].skip_targets, vec!["wasm".to_string()]);
        // This method targets wasm, not tauri, so it should NOT be filtered
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("kv_store_get"),
            "method with skip wasm should still appear in tauri output: {}",
            code
        );
    }

    #[test]
    fn skip_lifecycle_create_still_emits_registry_and_destroy() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
                skip tauri;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // When lifecycle create is skipped for this target, registry and destroy
        // should NOT be emitted — prevents duplicate definitions when multiple
        // descriptor groups share the same service type.
        assert!(
            !code.contains("TauriRegistry"),
            "registry should NOT be emitted when lifecycle is skipped for tauri: {}",
            code
        );
        assert!(
            !code.contains("kv_store_new"),
            "create fn should not be emitted when lifecycle create is skipped: {}",
            code
        );
        assert!(
            !code.contains("kv_store_destroy"),
            "destroy fn should NOT be emitted when lifecycle is skipped for tauri: {}",
            code
        );
    }

    // --- Bytes-tuple return tests ---

    #[test]
    fn parse_bytes_tuple_return() {
        let input = r#"
            bridge_version = 1;
            group = ops;
            service = Engine;
            key_type = str;
            key_param = "engine_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method write apply_mutations {
                params {}
                return_type = (Vec<u8>, MutationMeta);
                error_type = EngineError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let method = &desc.methods[1];
        assert!(
            method.return_info.is_bytes_tuple,
            "expected bytes_tuple return"
        );
        assert!(
            method.return_info.serde_inner_ty.is_some(),
            "expected serde inner type"
        );
        let inner = method.return_info.serde_inner_ty.as_ref().unwrap();
        let inner_str = quote!(#inner).to_string();
        assert!(
            inner_str.contains("MutationMeta"),
            "expected MutationMeta as inner type, got: {}",
            inner_str
        );
    }

    #[test]
    fn bytes_tuple_generates_inline_packing() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Engine;
            method pure get_data {
                params {}
                return_type = (Vec<u8>, DataMeta);
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // Should inline-pack bytes + metadata into a single Response
        assert!(
            code.contains("ipc :: Response"),
            "expected ipc::Response in output, got:\n{}",
            code
        );
        assert!(
            code.contains("serde_json :: to_vec"),
            "expected serde_json::to_vec for metadata serialization, got:\n{}",
            code
        );
        // Should contain the function
        assert!(
            code.contains("engine_get_data"),
            "expected function name in output, got:\n{}",
            code
        );
    }

    #[test]
    fn non_bytes_tuple_not_detected() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert!(!desc.methods[0].return_info.is_bytes_tuple);
    }

    // --- Security level tests ---

    #[test]
    fn parse_security_level() {
        let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert!(desc.security_level.is_some());
        assert_eq!(desc.security_level.unwrap().to_string(), "Sensitive");
    }

    #[test]
    fn parse_no_security_level() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert!(desc.security_level.is_none());
    }

    #[test]
    fn security_level_adds_params_to_output() {
        let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // Should contain security params
        assert!(
            code.contains("__sec_timestamp"),
            "expected __sec_timestamp in output, got:\n{}",
            code
        );
        assert!(
            code.contains("__sec_nonce"),
            "expected __sec_nonce in output, got:\n{}",
            code
        );
        assert!(
            code.contains("__sec_signature"),
            "expected __sec_signature in output, got:\n{}",
            code
        );
        assert!(
            code.contains("tauri :: Window"),
            "expected tauri::Window in output, got:\n{}",
            code
        );
        assert!(
            code.contains("tauri :: AppHandle"),
            "expected tauri::AppHandle in output, got:\n{}",
            code
        );
        // Should contain verify_request call
        assert!(
            code.contains("verify_request"),
            "expected verify_request in output, got:\n{}",
            code
        );
        // Should reference SecurityLevel::Sensitive
        assert!(
            code.contains("Sensitive"),
            "expected Sensitive level in output, got:\n{}",
            code
        );
    }

    #[test]
    fn security_level_critical() {
        let input = r#"
            security_level = Critical;
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params {}
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        assert!(
            code.contains("Critical"),
            "expected Critical level in output, got:\n{}",
            code
        );
    }

    #[test]
    fn no_security_level_no_extra_params() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = Foo;
            method pure bar {
                params { [str] key: &str, }
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        assert!(
            !code.contains("__sec_timestamp"),
            "unexpected __sec_timestamp in output without security_level:\n{}",
            code
        );
        assert!(
            !code.contains("verify_request"),
            "unexpected verify_request in output without security_level:\n{}",
            code
        );
    }

    #[test]
    fn security_level_service_destroy_has_security() {
        let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = ops;
            service = KvStore;
            key_type = str;
            key_param = "store_id";
            lifecycle create new {
                params { [serde] config: KvConfig, }
                return_type = Self;
                error_type = KvError;
                fallible;
            }
            method read get {
                params { [str] key: &str, }
                return_type = String;
                error_type = KvError;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // The destroy command should also have security params
        assert!(
            code.contains("kv_store_destroy"),
            "expected kv_store_destroy in output, got:\n{}",
            code
        );
        // Count occurrences of verify_request — should be one per non-skipped command
        // (new, get, destroy = 3 commands)
        let verify_count = code.matches("verify_request").count();
        assert_eq!(
            verify_count, 3,
            "expected 3 verify_request calls (new, get, destroy), got {}",
            verify_count
        );
    }

    #[test]
    fn security_level_uses_fn_name_as_operation() {
        let input = r#"
            security_level = Sensitive;
            bridge_version = 1;
            group = g0;
            type_name = MyParser;
            method pure parse_file {
                params { [str] path: &str, }
                return_type = String;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();
        // The operation string should be the generated function name
        assert!(
            code.contains("\"my_parser_parse_file\""),
            "expected operation string 'my_parser_parse_file' in output, got:\n{}",
            code
        );
    }

    // --- Async method tests ---

    #[test]
    fn async_method_generates_await() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            service = Database;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params { [str] config: String, }
                return_type = ();
                fallible;
            }
            method read query {
                params { [str] sql: &str, }
                return_type = String;
                error_type = String;
                fallible;
                async;
            }
            method read list {
                params {}
                return_type = String;
                fallible;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();

        // Verify parsing: query is async, list is not
        assert!(desc.methods[1].is_async, "query should be async");
        assert!(!desc.methods[2].is_async, "list should not be async");

        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();

        // The async method (query) should use clone_for_async + .await
        assert!(
            code.contains("clone_for_async"),
            "expected clone_for_async in output for async method, got:\n{}",
            code
        );

        // The sync method (list) should use with_read
        assert!(
            code.contains("with_read"),
            "expected with_read in output for sync method, got:\n{}",
            code
        );

        // The async method should contain .await
        assert!(
            code.contains(". await"),
            "expected .await in output for async method, got:\n{}",
            code
        );
    }

    #[test]
    fn async_pure_method_generates_await() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            type_name = DbUtils;
            method pure validate {
                params { [str] sql: &str, }
                return_type = String;
                error_type = String;
                fallible;
                async;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert!(desc.methods[0].is_async, "validate should be async");

        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();

        // Pure async should NOT use clone_for_async (stateless)
        assert!(
            !code.contains("clone_for_async"),
            "pure async should not use clone_for_async, got:\n{}",
            code
        );

        // Should contain .await
        assert!(
            code.contains(". await"),
            "expected .await in output for async pure method, got:\n{}",
            code
        );

        // Should NOT use catch_unwind (async methods skip it)
        assert!(
            !code.contains("catch_unwind"),
            "async pure methods should not use catch_unwind, got:\n{}",
            code
        );
    }

    #[test]
    fn async_write_method_uses_clone_for_async() {
        let input = r#"
            bridge_version = 1;
            group = g0;
            service = Database;
            key_type = str;
            key_param = "connection_id";
            lifecycle create new {
                params {}
                return_type = ();
            }
            method write execute {
                params { [str] sql: &str, }
                return_type = u64;
                error_type = String;
                fallible;
                async;
            }
        "#;
        let desc = parse_descriptor(input).unwrap();
        assert!(desc.methods[1].is_async, "execute should be async");

        let tokens = expand_descriptor(&desc);
        let code = tokens.to_string();

        // Async write should use clone_for_async, NOT with_write in the command body.
        // Note: with_write appears in the TauriRegistry definition itself, so we
        // check that the execute command body does not call state.with_write.
        assert!(
            code.contains("clone_for_async (& connection_id)"),
            "expected clone_for_async(&connection_id) for async write method, got:\n{}",
            code
        );
        // The execute command body should NOT dispatch through with_write closure
        assert!(
            !code.contains("state . with_write (& connection_id"),
            "async write command should not call state.with_write, got:\n{}",
            code
        );
    }
}
