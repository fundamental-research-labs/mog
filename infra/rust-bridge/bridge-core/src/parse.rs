use crate::descriptor::*;
use std::collections::BTreeMap;
use syn::parse::Parser;
use syn::spanned::Spanned;

/// Parsed `#[bridge::api(...)]` attribute body.
#[derive(Debug)]
pub(crate) struct ApiAttrArgs {
    pub service: Option<ServiceMeta>,
    pub group: Option<String>,
    pub fn_prefix: Option<String>,
    pub crate_path: Option<String>,
    /// Unrecognized `key = "value"` pairs flow here verbatim. See
    /// `ApiDescriptor::extras` for the design rationale.
    pub extras: BTreeMap<String, String>,
}

pub(crate) fn parse_api_attr(tokens: proc_macro2::TokenStream) -> syn::Result<ApiAttrArgs> {
    if tokens.is_empty() {
        return Ok(ApiAttrArgs {
            service: None,
            group: None,
            fn_prefix: None,
            crate_path: None,
            extras: BTreeMap::new(),
        });
    }
    let metas = syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated
        .parse2(tokens)?;
    let mut service_name: Option<String> = None;
    let mut key_param: Option<String> = None;
    let mut group: Option<String> = None;
    let mut fn_prefix: Option<String> = None;
    let mut crate_path: Option<String> = None;
    let mut extras: BTreeMap<String, String> = BTreeMap::new();
    for meta in &metas {
        if let syn::Meta::NameValue(nv) = meta {
            let ident = nv.path.get_ident().map(|i| i.to_string());
            // Every name-value pair on `#[bridge::api(...)]` must have a string
            // literal value — reject non-string forms loudly so typos like
            // `cli_group = some_ident` surface here, not downstream.
            let str_value = match &nv.value {
                syn::Expr::Lit(lit) => match &lit.lit {
                    syn::Lit::Str(s) => Some(s.value()),
                    _ => None,
                },
                _ => None,
            };
            match ident.as_deref() {
                Some("service") => service_name = str_value,
                Some("key") => key_param = str_value,
                Some("group") => group = str_value,
                Some("fn_prefix") => fn_prefix = str_value,
                Some("crate_path") => crate_path = str_value,
                Some(other) => {
                    // Unknown keys flow to extras. This is how target-specific
                    // metadata (e.g. `cli_group = "sheets"` for bridge-cli)
                    // propagates through without bridge-core having to learn
                    // about every key. See `ApiDescriptor::extras` for the
                    // design note.
                    //
                    // Non-string values are a hard error — `cli_group = 42`
                    // is almost always a mistake, and allowing it would mean
                    // downstream targets have to re-parse tokens to decide
                    // whether the value shape is acceptable.
                    let value = str_value.ok_or_else(|| {
                        syn::Error::new(
                            nv.value.span(),
                            format!(
                                "bridge::api: value for key '{}' must be a string literal",
                                other
                            ),
                        )
                    })?;
                    extras.insert(other.to_string(), value);
                }
                None => {}
            }
        }
    }
    let service = match (service_name, key_param) {
        (Some(name), Some(key)) => Some(ServiceMeta {
            name: syn::Ident::new(&name, proc_macro2::Span::call_site()),
            module_path: None,
            key_type: "str".to_string(),
            key_param: key,
        }),
        (Some(_), None) => {
            return Err(syn::Error::new(
                proc_macro2::Span::call_site(),
                "bridge::api: `service` requires `key`",
            ));
        }
        _ => None,
    };
    Ok(ApiAttrArgs {
        service,
        group,
        fn_prefix,
        crate_path,
        extras,
    })
}

pub(crate) fn classify_param_type(ty: &syn::Type, has_parse: bool) -> ParamTag {
    if has_parse {
        return ParamTag::Parse;
    }
    // `#[bridge::tagged_enum(...)]` is resolved before reaching this function;
    // see `parse_tagged_enum_attr` / `classify_param_with_attrs`.
    match ty {
        syn::Type::Reference(r) => match &*r.elem {
            syn::Type::Path(p) if p.path.is_ident("str") => ParamTag::Str,
            syn::Type::Slice(s) => {
                if matches!(&*s.elem, syn::Type::Path(p) if p.path.is_ident("u8")) {
                    return ParamTag::Bytes;
                }
                ParamTag::Serde
            }
            _ => ParamTag::Serde,
        },
        syn::Type::Path(p) => {
            let last_seg = match p.path.segments.last() {
                Some(seg) => seg,
                None => return ParamTag::Serde,
            };
            match last_seg.ident.to_string().as_str() {
                "String" => ParamTag::Str,
                "bool" | "u8" | "u16" | "u32" | "u64" | "i8" | "i16" | "i32" | "i64" | "f32"
                | "f64" | "usize" | "isize" => ParamTag::Prim,
                "Vec" => {
                    let is_vec_u8 = match &last_seg.arguments {
                        syn::PathArguments::AngleBracketed(args) if args.args.len() == 1 => {
                            matches!(
                                &args.args[0],
                                syn::GenericArgument::Type(syn::Type::Path(inner))
                                    if inner.path.is_ident("u8")
                            )
                        }
                        _ => false,
                    };
                    if is_vec_u8 {
                        return ParamTag::Bytes;
                    }
                    ParamTag::Serde
                }
                _ => ParamTag::Serde,
            }
        }
        _ => ParamTag::Serde,
    }
}

pub(crate) fn parse_return_type(
    output: &syn::ReturnType,
) -> (Option<syn::Type>, Option<syn::Type>, bool) {
    match output {
        syn::ReturnType::Default => (None, None, false),
        syn::ReturnType::Type(_, ty) => {
            let result_args = match ty.as_ref() {
                syn::Type::Path(p) => p.path.segments.last().and_then(|seg| {
                    if seg.ident != "Result" {
                        return None;
                    }
                    match &seg.arguments {
                        syn::PathArguments::AngleBracketed(args) => Some(args),
                        _ => None,
                    }
                }),
                _ => None,
            };
            if let Some(args) = result_args {
                let types: Vec<&syn::Type> = args
                    .args
                    .iter()
                    .filter_map(|a| {
                        if let syn::GenericArgument::Type(t) = a {
                            Some(t)
                        } else {
                            None
                        }
                    })
                    .collect();
                if types.len() == 2 {
                    let ok_type = if is_unit_type(types[0]) {
                        None
                    } else {
                        Some(types[0].clone())
                    };
                    return (ok_type, Some(types[1].clone()), true);
                }
            }
            if is_unit_type(ty) {
                (None, None, false)
            } else {
                (Some(ty.as_ref().clone()), None, false)
            }
        }
    }
}

fn is_unit_type(ty: &syn::Type) -> bool {
    if let syn::Type::Tuple(t) = ty {
        t.elems.is_empty()
    } else {
        false
    }
}

pub(crate) fn is_bridge_attr(attr: &syn::Attribute) -> bool {
    attr.path().segments.iter().any(|s| s.ident == "bridge")
}

/// Result of parsing method access attributes.
/// Contains the access level and whether the method is async.
pub(crate) struct MethodAccessInfo {
    pub access: AccessLevel,
    pub is_async: bool,
    /// Phase B.1: `scope = "cell" | "range" | "sheet" | "workbook"` passthrough.
    /// Unvalidated here — bridge-delegate enforces under `gated = true`.
    pub scope: Option<String>,
    /// Phase B.1: `needs_principal` marker on `#[bridge::write(needs_principal)]`.
    /// Tells the delegate that the engine signature has a trailing `caller: &Principal`.
    pub needs_principal: bool,
}

/// Parse the attribute body for read/write/structural. Accepts an optional
/// `scope = "..."` name-value, a bare `needs_principal` flag, and/or
/// `kind = "subscribe"` (a TS-bridge-only annotation that flows through to
/// `manifest.gen.ts` — runtime semantics are unaffected). Unknown tokens are
/// rejected (so typos surface at the bridge-core layer, not silently
/// downstream).
fn parse_access_attr_args(attr: &syn::Attribute) -> syn::Result<(Option<String>, bool)> {
    // Absence of a parenthesized arg list → no scope, no needs_principal.
    let meta_list = match &attr.meta {
        syn::Meta::List(list) => list,
        _ => return Ok((None, false)),
    };
    let mut scope: Option<String> = None;
    let mut needs_principal = false;
    attr.parse_args_with(|input: syn::parse::ParseStream| {
        while !input.is_empty() {
            let key: syn::Ident = input.parse()?;
            match key.to_string().as_str() {
                "scope" => {
                    let _: syn::Token![=] = input.parse()?;
                    let lit: syn::LitStr = input.parse()?;
                    scope = Some(lit.value());
                }
                "needs_principal" => {
                    needs_principal = true;
                }
                "kind" => {
                    // TS-bridge-only annotation (e.g. `kind = "subscribe"`) for
                    // tagging methods in the generated bridge-method-kind manifest.
                    // Bridge-core has no runtime use for it — just consume and
                    // validate the literal so typos surface here.
                    let _: syn::Token![=] = input.parse()?;
                    let lit: syn::LitStr = input.parse()?;
                    let value = lit.value();
                    match value.as_str() {
                        "subscribe" => {}
                        other => {
                            return Err(syn::Error::new(
                                lit.span(),
                                format!(
                                    "unknown bridge access kind '{}' — expected `kind = \"subscribe\"`",
                                    other
                                ),
                            ));
                        }
                    }
                }
                other => {
                    return Err(syn::Error::new(
                        key.span(),
                        format!(
                            "unknown argument '{}' on bridge access attribute — expected `scope = \"...\"`, `needs_principal`, or `kind = \"subscribe\"`",
                            other
                        ),
                    ));
                }
            }
            if input.peek(syn::Token![,]) {
                let _: syn::Token![,] = input.parse()?;
            }
        }
        Ok::<(), syn::Error>(())
    })?;
    let _ = meta_list; // keep reference live until here so the closure can't outlive attr
    Ok((scope, needs_principal))
}

fn parse_method_access(attrs: &[syn::Attribute]) -> syn::Result<Option<MethodAccessInfo>> {
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        if segs.len() == 2 && segs[0].ident == "bridge" {
            match segs[1].ident.to_string().as_str() {
                "read" => {
                    // Propagate parse errors (unknown args, malformed
                    // scope literal) instead of silently defaulting to
                    // `(None, false)` — a typo like `scpoe = "cell"`
                    // should surface as "unknown argument 'scpoe'"
                    // here, not later as the downstream "missing scope"
                    // diagnostic which points at the method name rather
                    // than the typo.
                    let (scope, needs_principal) = parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Read,
                        is_async: false,
                        scope,
                        needs_principal,
                    }));
                }
                "write" => {
                    let (scope, needs_principal) = parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Write,
                        is_async: false,
                        scope,
                        needs_principal,
                    }));
                }
                "structural" => {
                    let (scope, needs_principal) = parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Structural,
                        is_async: false,
                        scope,
                        needs_principal,
                    }));
                }
                "pure" => {
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Pure,
                        is_async: false,
                        scope: None,
                        needs_principal: false,
                    }));
                }
                "session" => {
                    // Session-scoped state mutation via interior mutability
                    // (e.g. `ArcSwap`). Takes `&self` at the FFI boundary;
                    // see `AccessLevel::Session` in descriptor.rs. Accepts
                    // no extra args today — keep the attribute minimal so
                    // typos in `#[bridge::session(...)]` surface loudly.
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Session,
                        is_async: false,
                        scope: None,
                        needs_principal: false,
                    }));
                }
                "lifecycle" => {
                    // Parse attribute arguments to determine lifecycle kind:
                    // #[bridge::lifecycle(create)] → LifecycleKind::Create
                    // #[bridge::lifecycle(create_from = "name")] → LifecycleKind::CreateFrom { name }
                    if let Ok(kind) = attr.parse_args_with(|input: syn::parse::ParseStream| {
                        let ident: syn::Ident = input.parse()?;
                        match ident.to_string().as_str() {
                            "create" => Ok(LifecycleKind::Create),
                            "create_from" => {
                                let _eq: syn::Token![=] = input.parse()?;
                                let lit: syn::LitStr = input.parse()?;
                                Ok(LifecycleKind::CreateFrom { name: lit.value() })
                            }
                            _ => Err(syn::Error::new(
                                ident.span(),
                                "expected 'create' or 'create_from'",
                            )),
                        }
                    }) {
                        return Ok(Some(MethodAccessInfo {
                            access: AccessLevel::Lifecycle(kind),
                            is_async: false,
                            scope: None,
                            needs_principal: false,
                        }));
                    }
                }
                "async_read" => {
                    let (scope, needs_principal) = parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Read,
                        is_async: true,
                        scope,
                        needs_principal,
                    }));
                }
                "async_write" => {
                    let (scope, needs_principal) = parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Write,
                        is_async: true,
                        scope,
                        needs_principal,
                    }));
                }
                _ => {}
            }
        }
    }
    Ok(None)
}

fn has_parse_attr(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|a| {
        let segs: Vec<_> = a.path().segments.iter().collect();
        segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "parse"
    })
}

/// Parse a `#[bridge::tagged_enum(...)]` param-level attribute into a
/// `TaggedEnumSchema`. Returns `Ok(None)` when the attribute is absent.
///
/// Grammar (intentionally verbose — the bridge-core pass does not see the enum
/// definition, so variant info must be provided inline):
/// ```ignore
/// #[bridge::tagged_enum(
///     name = "AccessTarget",
///     tag = "kind",
///     content = "payload",                // optional
///     variants(
///         Workbook { },
///         Sheet { sheet_id: serde },
///         Column { sheet_id: serde, col_id: serde },
///     ),
/// )]
/// ```
/// Field classifications use the same tokens as the outer DSL (`str`, `prim`,
/// `bytes`, `serde`, `parse`). B.2 may extend this to auto-derive from the enum
/// definition when the two are co-located; today the explicit form keeps the
/// core parser self-contained.
fn parse_tagged_enum_attr(attrs: &[syn::Attribute]) -> syn::Result<Option<TaggedEnumSchema>> {
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        if segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "tagged_enum" {
            return attr.parse_args_with(parse_tagged_enum_body).map(Some);
        }
    }
    Ok(None)
}

fn parse_tagged_enum_body(input: syn::parse::ParseStream) -> syn::Result<TaggedEnumSchema> {
    let mut type_name: Option<String> = None;
    let mut tag: Option<String> = None;
    let mut content: Option<String> = None;
    let mut variants: Vec<VariantSchema> = Vec::new();

    while !input.is_empty() {
        let key: syn::Ident = input.parse()?;
        match key.to_string().as_str() {
            "name" => {
                let _: syn::Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                type_name = Some(lit.value());
            }
            "tag" => {
                let _: syn::Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                tag = Some(lit.value());
            }
            "content" => {
                let _: syn::Token![=] = input.parse()?;
                let lit: syn::LitStr = input.parse()?;
                content = Some(lit.value());
            }
            "variants" => {
                let inner;
                syn::parenthesized!(inner in input);
                while !inner.is_empty() {
                    variants.push(parse_variant_schema(&inner)?);
                    if inner.peek(syn::Token![,]) {
                        let _: syn::Token![,] = inner.parse()?;
                    }
                }
            }
            other => {
                return Err(syn::Error::new(
                    key.span(),
                    format!(
                        "bridge::tagged_enum: unknown key '{}', expected name/tag/content/variants",
                        other
                    ),
                ));
            }
        }
        if input.peek(syn::Token![,]) {
            let _: syn::Token![,] = input.parse()?;
        }
    }

    let type_name = type_name.ok_or_else(|| {
        syn::Error::new(
            proc_macro2::Span::call_site(),
            "bridge::tagged_enum: missing `name = \"...\"`",
        )
    })?;
    let tag = tag.ok_or_else(|| {
        syn::Error::new(
            proc_macro2::Span::call_site(),
            "bridge::tagged_enum: missing `tag = \"...\"`",
        )
    })?;

    Ok(TaggedEnumSchema {
        type_name,
        tag,
        content,
        variants,
    })
}

fn parse_variant_schema(input: syn::parse::ParseStream) -> syn::Result<VariantSchema> {
    let rust_ident: syn::Ident = input.parse()?;
    let rust_name = rust_ident.to_string();

    // Optional `= "wire_name"` rename. Falls back to rust_name.
    let wire_name = if input.peek(syn::Token![=]) {
        let _: syn::Token![=] = input.parse()?;
        let lit: syn::LitStr = input.parse()?;
        lit.value()
    } else {
        rust_name.clone()
    };

    let fields_group;
    syn::braced!(fields_group in input);

    let mut fields = Vec::new();
    while !fields_group.is_empty() {
        let field_ident: syn::Ident = fields_group.parse()?;

        // Optional `as "wire_name"` for per-field serde rename.
        let wire_field_name = if fields_group.peek(syn::Token![as]) {
            let _: syn::Token![as] = fields_group.parse()?;
            let lit: syn::LitStr = fields_group.parse()?;
            lit.value()
        } else {
            field_ident.to_string()
        };

        let _: syn::Token![:] = fields_group.parse()?;
        let tag_ident: syn::Ident = fields_group.parse()?;
        let tag = match tag_ident.to_string().as_str() {
            "str" => ParamTag::Str,
            "prim" => ParamTag::Prim,
            "bytes" => ParamTag::Bytes,
            "serde" => ParamTag::Serde,
            "parse" => ParamTag::Parse,
            other => {
                return Err(syn::Error::new(
                    tag_ident.span(),
                    format!(
                        "bridge::tagged_enum: unknown field tag '{}' — expected str/prim/bytes/serde/parse",
                        other
                    ),
                ));
            }
        };

        // `ty` stores the tag string as a best-effort type marker. B.2 may
        // extend this with richer type info when downstream codegens need it.
        let ty_str = tag_ident.to_string();

        fields.push(VariantField {
            rust_name: field_ident.to_string(),
            wire_name: wire_field_name,
            ty: ty_str,
            tag: Box::new(tag),
        });

        if fields_group.peek(syn::Token![,]) {
            let _: syn::Token![,] = fields_group.parse()?;
        }
    }

    Ok(VariantSchema {
        rust_name,
        wire_name,
        fields,
    })
}

fn parse_skip_targets(attrs: &[syn::Attribute]) -> Vec<String> {
    let mut targets = Vec::new();
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        let is_skip = segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "skip";
        if !is_skip {
            continue;
        }
        if let Ok(inner) = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Ident, syn::Token![,]>::parse_terminated,
        ) {
            targets.extend(inner.into_iter().map(|ident| ident.to_string()));
        }
    }
    targets
}

fn extract_type_name(ty: &syn::Type) -> syn::Result<syn::Ident> {
    match ty {
        syn::Type::Path(p) => p.path.segments.last().map_or_else(
            || {
                Err(syn::Error::new(
                    ty.span(),
                    "bridge::api: cannot determine type name",
                ))
            },
            |seg| Ok(seg.ident.clone()),
        ),
        _ => Err(syn::Error::new(
            ty.span(),
            "bridge::api: cannot determine type name",
        )),
    }
}

fn extract_param_name(pat: &syn::Pat) -> syn::Result<syn::Ident> {
    match pat {
        syn::Pat::Ident(pi) => Ok(pi.ident.clone()),
        _ => Err(syn::Error::new(
            pat.span(),
            "bridge::api: unsupported parameter pattern",
        )),
    }
}

pub(crate) fn parse_impl_block(
    item: &syn::ItemImpl,
    service: Option<ServiceMeta>,
    group: Option<String>,
    fn_prefix: Option<String>,
    crate_path: Option<String>,
    extras: BTreeMap<String, String>,
) -> syn::Result<ApiDescriptor> {
    let type_name = extract_type_name(&item.self_ty)?;
    let mut methods = Vec::new();
    for impl_item in &item.items {
        if let syn::ImplItem::Fn(method) = impl_item {
            let access_info = match parse_method_access(&method.attrs)? {
                Some(a) => a,
                None => continue,
            };
            let sig = &method.sig;
            let mut params = Vec::new();
            for arg in &sig.inputs {
                match arg {
                    syn::FnArg::Receiver(_) => {}
                    syn::FnArg::Typed(pat_type) => {
                        let name = extract_param_name(&pat_type.pat)?;
                        let has_p = has_parse_attr(&pat_type.attrs);
                        // `#[bridge::tagged_enum(...)]` wins over structural type
                        // classification — the explicit schema is authoritative.
                        let tag = match parse_tagged_enum_attr(&pat_type.attrs)? {
                            Some(schema) => ParamTag::TaggedEnum(schema),
                            None => classify_param_type(&pat_type.ty, has_p),
                        };
                        params.push(Param {
                            name,
                            ty: (*pat_type.ty).clone(),
                            tag,
                        });
                    }
                }
            }
            let (return_type, error_type, is_fallible) = parse_return_type(&sig.output);
            let skip_targets = parse_skip_targets(&method.attrs);
            methods.push(MethodDescriptor {
                access: access_info.access,
                name: sig.ident.clone(),
                params,
                return_type,
                error_type,
                is_fallible,
                is_async: access_info.is_async,
                skip_targets,
                scope: access_info.scope,
                needs_principal: access_info.needs_principal,
            });
        }
    }
    Ok(ApiDescriptor {
        service,
        methods,
        type_name,
        group_name: group,
        fn_prefix,
        crate_path,
        extras,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_impl(src: &str) -> syn::Result<ApiDescriptor> {
        let item: syn::ItemImpl = syn::parse_str(src)?;
        parse_impl_block(&item, None, None, None, None, BTreeMap::new())
    }

    #[test]
    fn structural_attribute_parses_as_structural_access() {
        let src = r#"
            impl Engine {
                #[bridge::structural]
                pub fn rename_sheet(&mut self, sheet: SheetId, name: String) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, AccessLevel::Structural);
        assert_eq!(desc.methods[0].name.to_string(), "rename_sheet");
        assert_eq!(desc.methods[0].params.len(), 2);
    }

    #[test]
    fn structural_attribute_ignores_passthrough_args() {
        // Passthrough args (e.g. planned `scope = "sheet"`) parse today.
        // Under B.1, `scope` is captured on the descriptor but not validated
        // here — bridge-delegate enforces under `gated = true`.
        let src = r#"
            impl Engine {
                #[bridge::structural(scope = "sheet")]
                pub fn rename_sheet(&mut self, sheet: SheetId) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods[0].access, AccessLevel::Structural);
        assert_eq!(desc.methods[0].scope.as_deref(), Some("sheet"));
    }

    #[test]
    fn read_attribute_captures_scope() {
        let src = r#"
            impl Engine {
                #[bridge::read(scope = "cell")]
                pub fn get_cell(&self, sheet: SheetId, addr: CellAddr) -> CellValue { todo!() }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods[0].access, AccessLevel::Read);
        assert_eq!(desc.methods[0].scope.as_deref(), Some("cell"));
        assert!(!desc.methods[0].needs_principal);
    }

    #[test]
    fn write_attribute_captures_needs_principal() {
        let src = r#"
            impl Engine {
                #[bridge::write(scope = "workbook", needs_principal)]
                pub fn add_policy(&mut self, p: Policy, caller: &Principal) -> Result<(), Err> { todo!() }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods[0].access, AccessLevel::Write);
        assert_eq!(desc.methods[0].scope.as_deref(), Some("workbook"));
        assert!(desc.methods[0].needs_principal);
    }

    #[test]
    fn scope_and_needs_principal_roundtrip_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read(scope = "cell")]
                pub fn get(&self, sheet: SheetId) -> u32 { 0 }
                #[bridge::write(needs_principal)]
                pub fn add(&mut self, caller: &Principal) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(tokens.contains("scope = \"cell\""), "emit: {}", tokens);
        assert!(tokens.contains("needs_principal"), "emit: {}", tokens);
    }

    #[test]
    fn method_without_scope_emits_no_scope_token() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn plain(&self) -> u32 { 0 }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(!tokens.contains("scope"), "emit leaked scope: {}", tokens);
        assert!(
            !tokens.contains("needs_principal"),
            "emit leaked needs_principal: {}",
            tokens
        );
    }

    #[test]
    fn unknown_access_attribute_arg_is_rejected() {
        let src = r#"
            impl Engine {
                #[bridge::read(ascension = "rapture")]
                pub fn get(&self) -> u32 { 0 }
            }
        "#;
        // Typos on bridge access attribute args must surface at parse
        // time, pointing at the offending ident. The previous
        // `unwrap_or((None, false))` silently dropped them, leaving
        // `scpoe = "cell"` to trip the bridge-delegate "missing scope"
        // diagnostic far downstream with no hint about the typo.
        let err = parse_impl(src).expect_err("unknown arg must be rejected");
        let msg = err.to_string();
        assert!(
            msg.contains("unknown argument 'ascension'"),
            "expected unknown-argument diagnostic, got: {}",
            msg
        );
    }

    #[test]
    fn unknown_access_attribute_scope_typo_points_at_typo() {
        // Regression guard for the specific example in the plan: a
        // mistyped `scpoe = "cell"` now surfaces as "unknown argument
        // 'scpoe'" rather than "missing scope".
        let src = r#"
            impl Engine {
                #[bridge::read(scpoe = "cell")]
                pub fn get(&self) -> u32 { 0 }
            }
        "#;
        let err = parse_impl(src).expect_err("typo must surface at parse");
        assert!(
            err.to_string().contains("unknown argument 'scpoe'"),
            "expected the typo to be the diagnostic's subject, got: {}",
            err
        );
    }

    #[test]
    fn structural_roundtrips_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::structural]
                pub fn delete_sheet(&mut self, sheet: SheetId) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(
            tokens.contains("method structural"),
            "emit output: {}",
            tokens
        );
        assert!(tokens.contains("delete_sheet"));
    }

    #[test]
    fn tagged_enum_attribute_populates_schema() {
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn check(
                    &self,
                    #[bridge::tagged_enum(
                        name = "AccessTarget",
                        tag = "kind",
                        variants(
                            Workbook = "workbook" { },
                            Sheet = "sheet" { sheet_id as "sheetId": serde },
                            Column = "column" { sheet_id as "sheetId": serde, col_id as "colId": serde },
                        ),
                    )]
                    target: AccessTarget,
                ) -> bool { false }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let schema = match &desc.methods[0].params[0].tag {
            ParamTag::TaggedEnum(s) => s,
            other => panic!("expected TaggedEnum, got {:?}", other),
        };
        assert_eq!(schema.type_name, "AccessTarget");
        assert_eq!(schema.tag, "kind");
        assert_eq!(schema.content, None);
        assert_eq!(schema.variants.len(), 3);
        assert_eq!(schema.variants[0].rust_name, "Workbook");
        assert_eq!(schema.variants[0].wire_name, "workbook");
        assert_eq!(schema.variants[0].fields.len(), 0);
        assert_eq!(schema.variants[1].rust_name, "Sheet");
        assert_eq!(schema.variants[1].wire_name, "sheet");
        assert_eq!(schema.variants[1].fields.len(), 1);
        assert_eq!(schema.variants[1].fields[0].rust_name, "sheet_id");
        assert_eq!(schema.variants[1].fields[0].wire_name, "sheetId");
        assert!(matches!(*schema.variants[1].fields[0].tag, ParamTag::Serde));
        assert_eq!(schema.variants[2].fields.len(), 2);
    }

    #[test]
    fn tagged_enum_content_key_is_preserved() {
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn probe(
                    &self,
                    #[bridge::tagged_enum(
                        name = "Msg",
                        tag = "t",
                        content = "c",
                        variants(Hello { name: str }),
                    )]
                    m: Msg,
                ) -> bool { false }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let schema = match &desc.methods[0].params[0].tag {
            ParamTag::TaggedEnum(s) => s,
            _ => panic!("expected TaggedEnum"),
        };
        assert_eq!(schema.content.as_deref(), Some("c"));
    }

    #[test]
    fn tagged_enum_roundtrips_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn check(
                    &self,
                    #[bridge::tagged_enum(
                        name = "AccessTarget",
                        tag = "kind",
                        variants(
                            Workbook { },
                            Sheet { sheet_id: serde },
                        ),
                    )]
                    target: AccessTarget,
                ) -> bool { false }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(tokens.contains("tagged_enum"), "emit output: {}", tokens);
        assert!(tokens.contains("AccessTarget"));
        assert!(tokens.contains("kind"));
        assert!(tokens.contains("sheet_id"));
    }

    #[test]
    fn existing_access_levels_unchanged() {
        // Guards against accidental regression of the original AccessLevel variants.
        let src = r#"
            impl Engine {
                #[bridge::pure]
                pub fn pure_fn() -> u32 { 0 }
                #[bridge::read]
                pub fn read_fn(&self) -> u32 { 0 }
                #[bridge::write]
                pub fn write_fn(&mut self) {}
                #[bridge::lifecycle(create)]
                pub fn new() -> Self { Self }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods.len(), 4);
        assert_eq!(desc.methods[0].access, AccessLevel::Pure);
        assert_eq!(desc.methods[1].access, AccessLevel::Read);
        assert_eq!(desc.methods[2].access, AccessLevel::Write);
        assert_eq!(
            desc.methods[3].access,
            AccessLevel::Lifecycle(LifecycleKind::Create)
        );
    }

    #[test]
    fn session_attribute_parses_as_session_access() {
        // R2.4: `#[bridge::session]` marks `&self` interior-mutable methods
        // (e.g. `set_active_principal` via `ArcSwap`). The IR must record
        // the distinct kind so downstream codegens can preserve `&self`
        // rather than defaulting to `&mut self` via the `write` pathway.
        let src = r#"
            impl Service {
                #[bridge::session]
                pub fn set_active_principal(&self, tags: Option<Vec<String>>) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        assert_eq!(desc.methods.len(), 1);
        assert_eq!(desc.methods[0].access, AccessLevel::Session);
        assert_eq!(desc.methods[0].name.to_string(), "set_active_principal");
    }

    #[test]
    fn session_roundtrips_through_emit_as_method_session() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Service {
                #[bridge::session]
                pub fn set_active_principal(&self, tags: Option<Vec<String>>) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(
            tokens.contains("method session"),
            "emit must preserve `method session` so downstream codegens \
             (bridge-napi/pyo3/tauri/wasm) parse `&self` semantics: {}",
            tokens
        );
    }

    #[test]
    fn descriptor_without_structural_emits_no_new_tokens() {
        // Backward-compat guarantee: a descriptor with no structural
        // methods and no tagged_enum params emits bytes identical to what B.0
        // would have produced before these extensions landed.
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn read_fn(&self, k: &str) -> u32 { 0 }
                #[bridge::write]
                pub fn write_fn(&mut self, v: u32) {}
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(!tokens.contains("structural"));
        assert!(!tokens.contains("tagged_enum"));
    }

    // -----------------------------------------------------------------
    // PR1 — impl-block-level extras bag.
    // -----------------------------------------------------------------

    fn parse_api_args(src: &str) -> syn::Result<ApiAttrArgs> {
        let tokens: proc_macro2::TokenStream = syn::parse_str(src)?;
        parse_api_attr(tokens)
    }

    #[test]
    fn api_attr_captures_unknown_string_keys_into_extras() {
        // Target-specific metadata like `cli_group = "sheets"` must flow to
        // extras without bridge-core having to learn every key. This is the
        // mechanism `bridge-cli` relies on to project the layer-2 group tree.
        let args = parse_api_args(
            r#"service = "Engine", key = "doc_id", cli_group = "sheets", tauri_window = "main""#,
        )
        .expect("parse");
        assert_eq!(
            args.extras.get("cli_group").map(String::as_str),
            Some("sheets")
        );
        assert_eq!(
            args.extras.get("tauri_window").map(String::as_str),
            Some("main")
        );
        assert_eq!(args.extras.len(), 2);
        // Known keys still land on typed fields, not extras.
        assert!(!args.extras.contains_key("service"));
        assert!(!args.extras.contains_key("key"));
    }

    #[test]
    fn api_attr_non_string_unknown_value_is_rejected() {
        // `cli_group = 42` is almost always a mistake — reject with a clear
        // diagnostic instead of silently accepting and letting the downstream
        // target produce a confusing error far from the source.
        let err = parse_api_args(r#"cli_group = 42"#).expect_err("must reject non-string");
        assert!(
            err.to_string().contains("must be a string literal"),
            "expected string-literal diagnostic, got: {}",
            err
        );
    }

    #[test]
    fn empty_extras_emits_no_extras_block() {
        // Backward-compat guarantee: an impl block with no extras must emit
        // byte-identical DSL to the pre-extras shape so downstream parsers
        // (bridge-napi/pyo3/wasm/tauri) don't break. They start consuming the
        // new block only when it first appears (PR5+).
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn plain(&self) -> u32 { 0 }
            }
        "#;
        let desc = parse_impl(src).expect("parse");
        let tokens = emit_descriptor(&desc, 0).to_string();
        assert!(
            !tokens.contains("extras"),
            "empty extras must not emit an extras block, got: {}",
            tokens
        );
    }

    #[test]
    fn non_empty_extras_roundtrip_through_emit() {
        use crate::emit::emit_descriptor;
        let src = r#"
            impl Engine {
                #[bridge::read]
                pub fn plain(&self) -> u32 { 0 }
            }
        "#;
        let mut desc = parse_impl(src).expect("parse");
        desc.extras
            .insert("cli_group".to_string(), "sheets".to_string());
        desc.extras
            .insert("bravo".to_string(), "charlie".to_string());
        let tokens = emit_descriptor(&desc, 0).to_string();
        // Both keys present.
        assert!(
            tokens.contains("cli_group = \"sheets\""),
            "emit: {}",
            tokens
        );
        assert!(tokens.contains("bravo = \"charlie\""), "emit: {}", tokens);
        // Deterministic order: BTreeMap iterates lexicographically, so `bravo`
        // comes before `cli_group` in the emitted token stream.
        let bravo_pos = tokens.find("bravo").expect("bravo in output");
        let cli_group_pos = tokens.find("cli_group").expect("cli_group in output");
        assert!(
            bravo_pos < cli_group_pos,
            "extras must emit in sorted order (BTreeMap), got: {}",
            tokens
        );
    }
}
