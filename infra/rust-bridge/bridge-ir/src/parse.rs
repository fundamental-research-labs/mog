//! Descriptor DSL parser.
//!
//! Parses the token stream emitted by `bridge-core`'s `__bridge_descriptor_*!`
//! declarative macros (see `bridge-core/src/emit.rs`) into the target-neutral
//! [`ApiDescriptor`] IR. Every downstream target crate
//! (`bridge-napi-macros`, `bridge-cli-macros`, ...) calls
//! `syn::parse_macro_input!(input as bridge_ir::ApiDescriptor)` to consume
//! the DSL.
//!
//! The grammar supported here is the union of everything `bridge-core` emits:
//! group/fn_prefix header, stateless `type_name = X;` OR stateful
//! `service/key_type/key_param`, an optional `extras { ... }` block, and one
//! or more `method <access> <name> { ... }` / `lifecycle create[_from] <name> { ... }`
//! blocks. Every known shape round-trips losslessly so target crates never
//! need to re-parse raw tokens.

use std::collections::BTreeMap;

use proc_macro2::Ident;
use syn::parse::{Parse, ParseStream};
use syn::{Token, Type, braced};

use crate::ir::{
    AccessLevel, ApiDescriptor, LifecycleKind, MethodDescriptor, Param, ParamTag, ServiceMeta,
    TaggedEnumSchema, VariantField, VariantSchema,
};

impl Parse for ApiDescriptor {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // bridge_version = 1;
        expect_ident(input, "bridge_version")?;
        let _: Token![=] = input.parse()?;
        let _version: syn::LitInt = input.parse()?;
        let _: Token![;] = input.parse()?;

        // group = <ident>;  (always present today, but treated as optional
        // so older descriptors or hand-rolled ones keep working)
        let mut group_name: Option<String> = None;
        if peek_ident_eq(input, "group") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let g: Ident = input.parse()?;
            group_name = Some(g.to_string());
            let _: Token![;] = input.parse()?;
        }

        // Optional: fn_prefix = <ident>;  or  fn_prefix = _;  (empty prefix)
        let mut fn_prefix: Option<String> = None;
        if peek_ident_eq(input, "fn_prefix") {
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

        // Exactly one of:  type_name = <ident>;  (stateless)
        // or               service = <ident>; key_type = <ident>; key_param = "...";
        let mut type_name: Option<Ident> = None;
        let mut service: Option<ServiceMeta> = None;
        if peek_ident_eq(input, "type_name") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let tn: Ident = input.parse()?;
            type_name = Some(tn);
            let _: Token![;] = input.parse()?;
        } else if peek_ident_eq(input, "service") {
            let _: Ident = input.parse()?;
            let _: Token![=] = input.parse()?;
            let svc_ident: Ident = input.parse()?;
            type_name = Some(svc_ident.clone());
            let _: Token![;] = input.parse()?;

            expect_ident(input, "key_type")?;
            let _: Token![=] = input.parse()?;
            let key_ty: Ident = input.parse()?;
            let _: Token![;] = input.parse()?;

            expect_ident(input, "key_param")?;
            let _: Token![=] = input.parse()?;
            let key_param_lit: syn::LitStr = input.parse()?;
            let _: Token![;] = input.parse()?;

            service = Some(ServiceMeta {
                name: svc_ident,
                key_type: key_ty.to_string(),
                key_param: key_param_lit.value(),
            });
        }

        // Optional: extras { key = "val"; ... }  — only emitted by bridge-core
        // when the map is non-empty, but older descriptors may omit it.
        let extras = if peek_ident_eq(input, "extras") {
            let _: Ident = input.parse()?;
            let body;
            braced!(body in input);
            parse_extras_body(&body)?
        } else {
            BTreeMap::new()
        };

        // Methods
        let mut methods = Vec::new();
        while !input.is_empty() {
            methods.push(parse_method(input)?);
        }

        // Stateless descriptors older than the `type_name = X;` line fall
        // back to "Unknown". Preserving this so pre-existing snapshots still
        // parse — matches the bridge-napi parser's original behaviour.
        let type_name =
            type_name.unwrap_or_else(|| syn::Ident::new("Unknown", proc_macro2::Span::call_site()));

        Ok(ApiDescriptor {
            type_name,
            service,
            group_name,
            fn_prefix,
            crate_path: None,
            methods,
            extras,
        })
    }
}

/// Parse the body of `extras { key = "val"; ... }`.
fn parse_extras_body(input: ParseStream) -> syn::Result<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    while !input.is_empty() {
        let key: Ident = input.parse()?;
        let _: Token![=] = input.parse()?;
        let val: syn::LitStr = input.parse()?;
        let _: Token![;] = input.parse()?;
        map.insert(key.to_string(), val.value());
    }
    Ok(map)
}

fn parse_method(input: ParseStream) -> syn::Result<MethodDescriptor> {
    let kind_ident: Ident = input.parse()?;
    let kind_str = kind_ident.to_string();

    let (access, name) = match kind_str.as_str() {
        "lifecycle" => {
            let lifecycle_kind: Ident = input.parse()?;
            match lifecycle_kind.to_string().as_str() {
                "create" => {
                    let method_name: Ident = input.parse()?;
                    (AccessLevel::Lifecycle(LifecycleKind::Create), method_name)
                }
                "create_from" => {
                    let variant_name: Ident = input.parse()?;
                    let method_name: Ident = input.parse()?;
                    (
                        AccessLevel::Lifecycle(LifecycleKind::CreateFrom {
                            name: variant_name.to_string(),
                        }),
                        method_name,
                    )
                }
                other => {
                    return Err(syn::Error::new(
                        lifecycle_kind.span(),
                        format!("unknown lifecycle kind: {}", other),
                    ));
                }
            }
        }
        "method" => {
            let access_ident: Ident = input.parse()?;
            let access = match access_ident.to_string().as_str() {
                "pure" => AccessLevel::Pure,
                "read" => AccessLevel::Read,
                "write" => AccessLevel::Write,
                "structural" => AccessLevel::Structural,
                "session" => AccessLevel::Session,
                other => {
                    return Err(syn::Error::new(
                        access_ident.span(),
                        format!("unknown access level: {}", other),
                    ));
                }
            };
            let method_name: Ident = input.parse()?;
            (access, method_name)
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
    expect_ident(&content, "params")?;
    let params_content;
    braced!(params_content in content);
    let params = parse_params(&params_content)?;

    let mut return_type: Option<Type> = None;
    let mut error_type: Option<Type> = None;
    let mut is_fallible = false;
    let mut is_async = false;
    let mut skip_targets = Vec::new();
    let mut scope: Option<String> = None;
    let mut needs_principal = false;

    while !content.is_empty() {
        // `async` is a reserved keyword; handle it before the ident branch.
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
                let ty: Type = content.parse()?;
                let _: Token![;] = content.parse()?;
                // `()` (the unit type) means "no return". Carry through as
                // `None` so downstream codegen sees it the same as an
                // omitted return_type line. Detected via token match on the
                // parsed type.
                if !is_unit_type(&ty) {
                    return_type = Some(ty);
                }
            }
            "error_type" => {
                let _: Token![=] = content.parse()?;
                let ty: Type = content.parse()?;
                let _: Token![;] = content.parse()?;
                error_type = Some(ty);
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
                    format!("unexpected keyword in method body: '{}'", other),
                ));
            }
        }
    }

    Ok(MethodDescriptor {
        name,
        access,
        is_async,
        params,
        return_type,
        error_type,
        is_fallible,
        skip_targets,
        scope,
        needs_principal,
    })
}

fn parse_params(input: ParseStream) -> syn::Result<Vec<Param>> {
    let mut params = Vec::new();
    while !input.is_empty() {
        // [tag]  — either a simple `[str]/[prim]/[bytes]/[serde]/[parse]`
        // or a full `[tagged_enum name = "...", tag = "...", ...]` schema.
        let tag_content;
        syn::bracketed!(tag_content in input);
        let tag_ident: Ident = tag_content.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => ParamTag::Str,
            "prim" => ParamTag::Prim,
            "bytes" => ParamTag::Bytes,
            "serde" => ParamTag::Serde,
            "parse" => ParamTag::Parse,
            "tagged_enum" => ParamTag::TaggedEnum(parse_tagged_enum_spec(&tag_content)?),
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!("unknown param tag: {}", other),
                ));
            }
        };

        // param_name: Type,
        let param_name: Ident = input.parse()?;
        let _: Token![:] = input.parse()?;
        let ty = parse_type_until_comma(input)?;
        // Trailing comma — emit.rs always emits one after each param.
        let _: Token![,] = input.parse()?;

        params.push(Param {
            name: param_name,
            ty,
            tag,
        });
    }
    Ok(params)
}

fn parse_tagged_enum_spec(input: ParseStream) -> syn::Result<TaggedEnumSchema> {
    let mut type_name: Option<String> = None;
    let mut tag_key: Option<String> = None;
    let mut content: Option<String> = None;
    let mut variants: Vec<VariantSchema> = Vec::new();

    while !input.is_empty() {
        let key: Ident = input.parse()?;
        match key.to_string().as_str() {
            "name" => {
                let _: Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                type_name = Some(lit.value());
            }
            "tag" => {
                let _: Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                tag_key = Some(lit.value());
            }
            "content" => {
                let _: Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                content = Some(lit.value());
            }
            "variants" => {
                let inner;
                syn::parenthesized!(inner in input);
                while !inner.is_empty() {
                    variants.push(parse_tagged_enum_variant(&inner)?);
                    if inner.peek(Token![,]) {
                        let _: Token![,] = inner.parse()?;
                    }
                }
            }
            other => {
                return Err(syn::Error::new(
                    key.span(),
                    format!("tagged_enum: unknown key '{}'", other),
                ));
            }
        }
        if input.peek(Token![,]) {
            let _: Token![,] = input.parse()?;
        }
    }

    Ok(TaggedEnumSchema {
        type_name: type_name.ok_or_else(|| {
            syn::Error::new(proc_macro2::Span::call_site(), "tagged_enum: missing name")
        })?,
        tag: tag_key.ok_or_else(|| {
            syn::Error::new(proc_macro2::Span::call_site(), "tagged_enum: missing tag")
        })?,
        content,
        variants,
    })
}

fn parse_tagged_enum_variant(input: ParseStream) -> syn::Result<VariantSchema> {
    let rust_ident: Ident = input.parse()?;
    let rust_name = rust_ident.to_string();

    let wire_name = if input.peek(Token![=]) {
        let _: Token![=] = input.parse()?;
        let lit: syn::LitStr = input.parse()?;
        lit.value()
    } else {
        rust_name.clone()
    };

    let fields_group;
    braced!(fields_group in input);

    let mut fields = Vec::new();
    while !fields_group.is_empty() {
        let field_ident: Ident = fields_group.parse()?;
        let wire_field = if fields_group.peek(Token![as]) {
            let _: Token![as] = fields_group.parse()?;
            let lit: syn::LitStr = fields_group.parse()?;
            lit.value()
        } else {
            field_ident.to_string()
        };
        let _: Token![:] = fields_group.parse()?;
        let ftag_ident: Ident = fields_group.parse()?;
        let field_tag = match ftag_ident.to_string().as_str() {
            "str" => ParamTag::Str,
            "prim" => ParamTag::Prim,
            "bytes" => ParamTag::Bytes,
            "serde" => ParamTag::Serde,
            "parse" => ParamTag::Parse,
            other => {
                return Err(syn::Error::new(
                    ftag_ident.span(),
                    format!("tagged_enum: unknown field tag '{}'", other),
                ));
            }
        };
        fields.push(VariantField {
            rust_name: field_ident.to_string(),
            wire_name: wire_field,
            tag: Box::new(field_tag),
        });
        if fields_group.peek(Token![,]) {
            let _: Token![,] = fields_group.parse()?;
        }
    }

    Ok(VariantSchema {
        rust_name,
        wire_name,
        fields,
    })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/// Parse a `syn::Type`, collecting tokens up to (but not including) the next
/// top-level `,`. `syn::Type::parse` won't stop at comma on its own because
/// it doesn't know that's our delimiter; we walk tokens ourselves, tracking
/// `<>` depth so commas inside generic args don't end the type prematurely,
/// then feed the captured tokens back through `syn::parse2` so we still get
/// a proper `syn::Type` tree.
fn parse_type_until_comma(input: ParseStream) -> syn::Result<Type> {
    let mut tokens = proc_macro2::TokenStream::new();
    let mut angle_depth: i32 = 0;
    use quote::TokenStreamExt;
    loop {
        if angle_depth == 0 && input.peek(Token![,]) {
            break;
        }
        if input.is_empty() {
            break;
        }
        let tt: proc_macro2::TokenTree = input.parse()?;
        let s = tt.to_string();
        if s == "<" {
            angle_depth += 1;
        } else if s == ">" {
            angle_depth -= 1;
        }
        tokens.append(tt);
    }
    syn::parse2::<Type>(tokens)
}

fn peek_ident_eq(input: ParseStream, expected: &str) -> bool {
    input
        .fork()
        .parse::<Ident>()
        .map(|i| i == expected)
        .unwrap_or(false)
}

fn expect_ident(input: ParseStream, expected: &str) -> syn::Result<Ident> {
    let ident: Ident = input.parse()?;
    if ident != expected {
        return Err(syn::Error::new(
            ident.span(),
            format!("expected '{}', found '{}'", expected, ident),
        ));
    }
    Ok(ident)
}

/// Recognize the unit type `()`. `syn::Type::Tuple` with zero elements.
fn is_unit_type(ty: &Type) -> bool {
    matches!(ty, Type::Tuple(t) if t.elems.is_empty())
}
