use crate::descriptor::{AccessLevel, LifecycleKind};

pub(crate) fn is_bridge_attr(attr: &syn::Attribute) -> bool {
    attr.path().segments.iter().any(|s| s.ident == "bridge")
}

/// Result of parsing method access attributes.
/// Contains the access level and whether the method is async.
pub(super) struct MethodAccessInfo {
    pub(super) access: AccessLevel,
    pub(super) is_async: bool,
}

/// Validate optional `kind = "subscribe"` method metadata.
pub(super) fn parse_access_attr_args(attr: &syn::Attribute) -> syn::Result<()> {
    if !matches!(&attr.meta, syn::Meta::List(_)) {
        return Ok(());
    }
    attr.parse_args_with(|input: syn::parse::ParseStream| {
        while !input.is_empty() {
            let key: syn::Ident = input.parse()?;
            match key.to_string().as_str() {
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
                            "unknown argument '{}' on bridge access attribute — expected `kind = \"subscribe\"`",
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
    Ok(())
}

pub(super) fn parse_method_access(
    attrs: &[syn::Attribute],
) -> syn::Result<Option<MethodAccessInfo>> {
    for attr in attrs {
        let segs: Vec<_> = attr.path().segments.iter().collect();
        if segs.len() == 2 && segs[0].ident == "bridge" {
            match segs[1].ident.to_string().as_str() {
                "read" => {
                    parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Read,
                        is_async: false,
                    }));
                }
                "write" => {
                    parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Write,
                        is_async: false,
                    }));
                }
                "structural" => {
                    parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Structural,
                        is_async: false,
                    }));
                }
                "pure" => {
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Pure,
                        is_async: false,
                    }));
                }
                "session" => {
                    // Session-scoped state mutation via interior mutability
                    // (e.g. `ArcSwap`). Takes `&self` at the FFI boundary;
                    // see `AccessLevel::Session` in descriptor.rs. Arguments are
                    // intentionally ignored for compatibility with existing use.
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Session,
                        is_async: false,
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
                        }));
                    }
                }
                "async_read" => {
                    parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Read,
                        is_async: true,
                    }));
                }
                "async_write" => {
                    parse_access_attr_args(attr)?;
                    return Ok(Some(MethodAccessInfo {
                        access: AccessLevel::Write,
                        is_async: true,
                    }));
                }
                _ => {}
            }
        }
    }
    Ok(None)
}
