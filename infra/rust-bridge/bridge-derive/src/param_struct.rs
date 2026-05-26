//! `#[derive(BridgeParamStruct)]` — emits an `__bridge_param_descriptor_<Name>!`
//! declarative macro alongside the annotated struct.
//!
//! The emitted macro mirrors the `__bridge_descriptor_*!` shape used by
//! `#[bridge::api]`: it takes a `$gen:path` and calls `$gen!` with a DSL body
//! that `bridge_ir::ParamStructDescriptor`'s `Parse` impl consumes. Downstream
//! targets (first consumer: `bridge-cli-macros` for Mode B flag expansion; see
//! ARCHITECTURE.md §2.4) use the IR to decide whether a `[serde]` method param
//! of this type emits per-field clap flags (Mode B) or only the `--<param>-json`
//! fallback (Mode A).
//!
//! Classification rules mirror the method-param taxonomy in
//! `bridge-core::classify_param_type`:
//!   - `String` / `&str` / `Cow<'_, str>` / `&String` → `[str]`
//!   - `bool` + all primitive numerics → `[prim]`
//!   - `Vec<u8>` / `&[u8]` → `[bytes]`
//!   - everything else → `[serde]`
//!
//! We do not recognize `[parse]` at the derive layer — `#[bridge::parse]` is a
//! param-level attribute that doesn't make sense on a struct field. If a struct
//! genuinely needs a parse-classified field, the owning API method should take
//! the underlying `String` and call `T::bridge_parse` itself.
//!
//! `Option<T>` is stripped once; the underlying `T` is classified and the
//! field gets `optional` set. Nested `Option<Option<T>>` is pathological and
//! treated as `[serde]` (serde-serialize the whole thing) rather than
//! trying to unwrap twice — keeps the logic simple and Mode-B emission doesn't
//! care because anything inside `Option` that isn't a scalar is already Mode A.

use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{Data, DeriveInput, Fields, parse_macro_input};

pub fn derive(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    let struct_name = &input.ident;

    let fields = match &input.data {
        Data::Struct(s) => match &s.fields {
            Fields::Named(named) => &named.named,
            _ => {
                return syn::Error::new_spanned(
                    struct_name,
                    "BridgeParamStruct requires a struct with named fields",
                )
                .to_compile_error()
                .into();
            }
        },
        _ => {
            return syn::Error::new_spanned(
                struct_name,
                "BridgeParamStruct can only be derived on structs",
            )
            .to_compile_error()
            .into();
        }
    };

    let field_tokens: Vec<proc_macro2::TokenStream> = fields
        .iter()
        .map(|f| {
            let name = f.ident.as_ref().expect("named field");
            let (tag_ident, optional) = classify_field(&f.ty);
            let optional_marker = if optional {
                quote! { (optional) }
            } else {
                quote! {}
            };
            quote! { [#tag_ident] #name #optional_marker; }
        })
        .collect();

    let macro_name = format_ident!("__bridge_param_descriptor_{}", struct_name);

    let expanded = quote! {
        #[doc(hidden)]
        #[macro_export]
        macro_rules! #macro_name {
            ($gen:path) => {
                $gen! {
                    param_struct_version = 1;
                    struct_name = #struct_name;
                    fields {
                        #(#field_tokens)*
                    }
                }
            };
            ($gen:path, $($extra:tt)*) => {
                $gen! {
                    $($extra)*
                    param_struct_version = 1;
                    struct_name = #struct_name;
                    fields {
                        #(#field_tokens)*
                    }
                }
            };
        }
    };
    expanded.into()
}

/// Returns (tag ident for the DSL, true iff the field was `Option<T>`).
fn classify_field(ty: &syn::Type) -> (syn::Ident, bool) {
    // Peel one layer of Option<T>. Nested Options fall through to serde.
    let (inner_ty, optional) = match unwrap_option(ty) {
        Some(inner) => (inner, true),
        None => (ty, false),
    };
    (format_ident!("{}", classify_tag(inner_ty)), optional)
}

fn classify_tag(ty: &syn::Type) -> &'static str {
    match ty {
        // `&str`, `&[u8]`, `&T` — peel the reference.
        syn::Type::Reference(r) => match &*r.elem {
            syn::Type::Path(p) if p.path.is_ident("str") => "str",
            syn::Type::Slice(s) => {
                if matches!(&*s.elem, syn::Type::Path(p) if p.path.is_ident("u8")) {
                    return "bytes";
                }
                "serde"
            }
            _ => "serde",
        },
        syn::Type::Path(p) => {
            let last_seg = match p.path.segments.last() {
                Some(s) => s,
                None => return "serde",
            };
            match last_seg.ident.to_string().as_str() {
                "String" => "str",
                "bool" | "u8" | "u16" | "u32" | "u64" | "u128" | "i8" | "i16" | "i32" | "i64"
                | "i128" | "f32" | "f64" | "usize" | "isize" => "prim",
                "Vec" => {
                    let is_vec_u8 = match &last_seg.arguments {
                        syn::PathArguments::AngleBracketed(args) => {
                            matches!(
                                args.args.first(),
                                Some(syn::GenericArgument::Type(syn::Type::Path(inner)))
                                    if inner.path.is_ident("u8")
                            )
                        }
                        _ => false,
                    };
                    if is_vec_u8 {
                        return "bytes";
                    }
                    "serde"
                }
                _ => "serde",
            }
        }
        _ => "serde",
    }
}

/// If `ty` is `Option<T>`, returns `Some(T)`. Otherwise `None`.
fn unwrap_option(ty: &syn::Type) -> Option<&syn::Type> {
    let p = match ty {
        syn::Type::Path(p) => p,
        _ => return None,
    };
    let last_seg = p.path.segments.last()?;
    if last_seg.ident != "Option" {
        return None;
    }
    let args = match &last_seg.arguments {
        syn::PathArguments::AngleBracketed(a) => a,
        _ => return None,
    };
    let first = args.args.first()?;
    match first {
        syn::GenericArgument::Type(t) => Some(t),
        _ => None,
    }
}
