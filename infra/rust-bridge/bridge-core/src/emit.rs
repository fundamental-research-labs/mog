use crate::descriptor::*;
use proc_macro2::TokenStream;
use quote::{format_ident, quote};
use syn::visit_mut::VisitMut;

// ---------------------------------------------------------------------------
// crate:: path rewriting — makes descriptors self-contained
// ---------------------------------------------------------------------------

/// Rewrites `crate::` path prefixes to a specified crate path.
struct CratePathRewriter {
    replacement: Vec<syn::PathSegment>,
}

impl VisitMut for CratePathRewriter {
    fn visit_path_mut(&mut self, path: &mut syn::Path) {
        // Visit children first (handles generic args like Vec<crate::X>)
        syn::visit_mut::visit_path_mut(self, path);

        // Rewrite paths starting with `crate`
        if path.leading_colon.is_none()
            && !path.segments.is_empty()
            && path.segments[0].ident == "crate"
        {
            let tail: Vec<_> = path.segments.iter().skip(1).cloned().collect();
            path.segments.clear();
            for seg in &self.replacement {
                path.segments.push(seg.clone());
            }
            for seg in tail {
                path.segments.push(seg);
            }
        }
    }
}

/// Qualify `crate::` prefixes in a type to a specific crate path.
/// E.g., `crate::solver::SolverParams` → `compute_core::solver::SolverParams`
fn qualify_crate_paths(ty: &syn::Type, crate_path: &str) -> syn::Type {
    let mut ty = ty.clone();
    let replacement_path: syn::Path =
        syn::parse_str(crate_path).expect("bridge::api: invalid crate_path value");
    let mut rewriter = CratePathRewriter {
        replacement: replacement_path.segments.into_iter().collect(),
    };
    rewriter.visit_type_mut(&mut ty);
    ty
}

pub(crate) fn emit_descriptor(desc: &ApiDescriptor, counter: usize) -> TokenStream {
    let type_name = &desc.type_name;
    let macro_name = if let Some(ref group) = desc.group_name {
        format_ident!("__bridge_descriptor_{}_{}", type_name, group)
    } else {
        format_ident!("__bridge_descriptor_{}_{}", type_name, counter)
    };

    let service_tokens = emit_service_meta(&desc.service);
    let method_tokens: Vec<TokenStream> = desc
        .methods
        .iter()
        .map(|m| emit_method(m, desc.crate_path.as_deref()))
        .collect();

    // For stateless (non-service) APIs, emit type_name so generators know
    // which Rust type to call methods on.
    let type_name_token = if desc.service.is_none() {
        quote! { type_name = #type_name; }
    } else {
        TokenStream::new()
    };

    // Emit group identifier so generators can create unique module names.
    // Uses the same suffix as the macro name (group name or counter).
    let group_suffix = if let Some(ref group) = desc.group_name {
        group.clone()
    } else {
        format!("g{}", counter)
    };
    let group_ident = format_ident!("{}", group_suffix);
    let group_token = quote! { group = #group_ident; };

    // Emit fn_prefix if set. `_` means empty (no prefix), an ident means use that prefix.
    let fn_prefix_token = match &desc.fn_prefix {
        Some(p) if p.is_empty() => {
            // Empty string → emit `fn_prefix = _;` to signal "no prefix"
            quote! { fn_prefix = _; }
        }
        Some(p) => {
            let prefix_ident = format_ident!("{}", p);
            quote! { fn_prefix = #prefix_ident; }
        }
        None => TokenStream::new(),
    };

    // Emit extras block only when non-empty. An empty extras map produces
    // byte-identical DSL to the pre-extras shape — critical for preserving
    // backward compat with downstream parsers (bridge-napi/pyo3/wasm/tauri)
    // that don't yet know how to skip an `extras { ... }` block. Those parsers
    // learn to skip it only when the first non-empty extras lands (PR5+), at
    // which point bridge-ir extraction (PR2) teaches them.
    let extras_token = emit_extras_block(&desc.extras);

    quote! {
        #[doc(hidden)]
        #[macro_export]
        macro_rules! #macro_name {
            ($gen:path) => {
                $gen! {
                    bridge_version = 1;
                    #group_token
                    #fn_prefix_token
                    #type_name_token
                    #service_tokens
                    #extras_token
                    #(#method_tokens)*
                }
            };
            ($gen:path, $($extra:tt)*) => {
                $gen! {
                    $($extra)*
                    bridge_version = 1;
                    #group_token
                    #fn_prefix_token
                    #type_name_token
                    #service_tokens
                    #extras_token
                    #(#method_tokens)*
                }
            };
        }
    }
}

/// Emit the `extras { key = "value"; ... }` block, or nothing when the map is
/// empty. `BTreeMap`'s iteration order guarantees deterministic output.
fn emit_extras_block(extras: &std::collections::BTreeMap<String, String>) -> TokenStream {
    if extras.is_empty() {
        return TokenStream::new();
    }
    let entries: Vec<TokenStream> = extras
        .iter()
        .map(|(k, v)| {
            let key_ident = format_ident!("{}", k);
            quote! { #key_ident = #v; }
        })
        .collect();
    quote! {
        extras { #(#entries)* }
    }
}

fn emit_service_meta(service: &Option<ServiceMeta>) -> TokenStream {
    match service {
        Some(s) => {
            let name = &s.name;
            let key_type_str = &s.key_type;
            let key_param_str = &s.key_param;
            let key_type_ident = format_ident!("{}", key_type_str);
            quote! {
                service = #name;
                key_type = #key_type_ident;
                key_param = #key_param_str;
            }
        }
        None => TokenStream::new(),
    }
}

fn emit_method(method: &MethodDescriptor, crate_path: Option<&str>) -> TokenStream {
    let name = &method.name;

    let params: Vec<TokenStream> = method
        .params
        .iter()
        .map(|p| {
            let tag = match &p.tag {
                ParamTag::Str => quote! { [str] },
                ParamTag::Prim => quote! { [prim] },
                ParamTag::Bytes => quote! { [bytes] },
                ParamTag::Serde => quote! { [serde] },
                ParamTag::Parse => quote! { [parse] },
                ParamTag::TaggedEnum(schema) => emit_tagged_enum_tag(schema),
            };
            let pname = &p.name;
            let pty = match crate_path {
                Some(cp) => qualify_crate_paths(&p.ty, cp),
                None => p.ty.clone(),
            };
            quote! { #tag #pname: #pty, }
        })
        .collect();

    let return_tokens = match &method.return_type {
        Some(ty) => {
            let qty = match crate_path {
                Some(cp) => qualify_crate_paths(ty, cp),
                None => ty.clone(),
            };
            quote! { return_type = #qty; }
        }
        None => quote! { return_type = (); },
    };

    let error_tokens = match &method.error_type {
        Some(ty) => {
            let qty = match crate_path {
                Some(cp) => qualify_crate_paths(ty, cp),
                None => ty.clone(),
            };
            quote! { error_type = #qty; }
        }
        None => TokenStream::new(),
    };

    let fallible_token = if method.is_fallible {
        quote! { fallible; }
    } else {
        TokenStream::new()
    };

    let async_token = if method.is_async {
        quote! { async; }
    } else {
        TokenStream::new()
    };

    // Phase B.1: pass `scope` and `needs_principal` through the DSL so the
    // delegate macro can see them. Emitted only when set — methods that don't
    // opt in produce byte-identical DSL to the pre-B.1 shape, preserving
    // backward compat with downstream parsers (bridge-napi/pyo3/wasm/tauri)
    // that don't recognize these keywords. The delegate macro strips them
    // before re-emitting for downstream consumption.
    let scope_token = match &method.scope {
        Some(s) => quote! { scope = #s; },
        None => TokenStream::new(),
    };

    let needs_principal_token = if method.needs_principal {
        quote! { needs_principal; }
    } else {
        TokenStream::new()
    };

    let skip_tokens: Vec<TokenStream> = method
        .skip_targets
        .iter()
        .map(|t| {
            let target = format_ident!("{}", t);
            quote! { skip #target; }
        })
        .collect();

    // Build the method kind prefix
    let kind_and_access = match method.access {
        AccessLevel::Lifecycle(LifecycleKind::Create) => quote! { lifecycle create },
        AccessLevel::Lifecycle(LifecycleKind::CreateFrom { ref name }) => {
            let name_ident = format_ident!("{}", name);
            quote! { lifecycle create_from #name_ident }
        }
        AccessLevel::Pure => quote! { method pure },
        AccessLevel::Read => quote! { method read },
        AccessLevel::Write => quote! { method write },
        AccessLevel::Structural => quote! { method structural },
        // `session` rides through the descriptor DSL as its own keyword so
        // downstream codegens can choose to emit `&self` or `&mut self`
        // (they all emit `&self` today — see `method session` in
        // bridge-napi/pyo3/tauri/wasm expand.rs).
        AccessLevel::Session => quote! { method session },
    };

    quote! {
        #kind_and_access #name {
            params { #(#params)* }
            #return_tokens
            #error_tokens
            #fallible_token
            #async_token
            #scope_token
            #needs_principal_token
            #(#skip_tokens)*
        }
    }
}

/// Emit a `[tagged_enum ...]` wire form for a `ParamTag::TaggedEnum`.
///
/// Shape (consumed by B.2 NAPI/PyO3 codegens, mirrors the `#[bridge::tagged_enum(...)]`
/// attribute grammar):
/// ```ignore
/// [tagged_enum name = "AccessTarget", tag = "kind", content = "payload",
///     variants(
///         Workbook = "workbook" { },
///         Sheet = "sheet" { sheet_id as "sheetId": serde },
///     )
/// ]
/// ```
/// `content` is only emitted when present. Field and variant renames use the
/// `name as "wire"` form so parsers can detect them with a single `peek(as)`.
fn emit_tagged_enum_tag(schema: &TaggedEnumSchema) -> TokenStream {
    let type_name = &schema.type_name;
    let tag = &schema.tag;
    let content_token = match &schema.content {
        Some(c) => quote! { content = #c, },
        None => TokenStream::new(),
    };

    let variant_tokens: Vec<TokenStream> = schema
        .variants
        .iter()
        .map(|v| {
            let rust_ident = format_ident!("{}", v.rust_name);
            let wire = &v.wire_name;
            let field_tokens: Vec<TokenStream> = v
                .fields
                .iter()
                .map(|f| {
                    let rust_f = format_ident!("{}", f.rust_name);
                    let wire_f = &f.wire_name;
                    let tag_ident = match &*f.tag {
                        ParamTag::Str => format_ident!("str"),
                        ParamTag::Prim => format_ident!("prim"),
                        ParamTag::Bytes => format_ident!("bytes"),
                        ParamTag::Serde => format_ident!("serde"),
                        ParamTag::Parse => format_ident!("parse"),
                        // Nested tagged enums are rare in real schemas; defer to
                        // `serde` so the field round-trips through the generic
                        // path until B.2 grows nested support if needed.
                        ParamTag::TaggedEnum(_) => format_ident!("serde"),
                    };
                    quote! { #rust_f as #wire_f: #tag_ident, }
                })
                .collect();
            quote! { #rust_ident = #wire { #(#field_tokens)* }, }
        })
        .collect();

    quote! {
        [tagged_enum
            name = #type_name,
            tag = #tag,
            #content_token
            variants(#(#variant_tokens)*)
        ]
    }
}
