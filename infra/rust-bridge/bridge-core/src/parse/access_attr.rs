use crate::descriptor::{AccessLevel, LifecycleKind};

pub(crate) fn is_bridge_attr(attr: &syn::Attribute) -> bool {
    attr.path().segments.iter().any(|s| s.ident == "bridge")
}

/// Result of parsing method access attributes.
/// Contains the access level and whether the method is async.
pub(super) struct MethodAccessInfo {
    pub(super) access: AccessLevel,
    pub(super) is_async: bool,
    /// `scope = "cell" | "range" | "sheet" | "workbook"` passthrough.
    /// Unvalidated here — bridge-delegate enforces under `gated = true`.
    pub(super) scope: Option<String>,
    /// `needs_principal` marker on `#[bridge::write(needs_principal)]`.
    /// Tells the delegate that the engine signature has a trailing `caller: &Principal`.
    pub(super) needs_principal: bool,
}

/// Parse the attribute body for read/write/structural. Accepts an optional
/// `scope = "..."` name-value, a bare `needs_principal` flag, and/or
/// `kind = "subscribe"` (a TS-bridge-only annotation that flows through to
/// `manifest.gen.ts` — runtime semantics are unaffected). Unknown tokens are
/// rejected (so typos surface at the bridge-core layer, not silently
/// downstream).
pub(super) fn parse_access_attr_args(attr: &syn::Attribute) -> syn::Result<(Option<String>, bool)> {
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

pub(super) fn parse_method_access(
    attrs: &[syn::Attribute],
) -> syn::Result<Option<MethodAccessInfo>> {
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
                    // see `AccessLevel::Session` in descriptor.rs. Arguments are
                    // intentionally ignored for compatibility with existing use.
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
