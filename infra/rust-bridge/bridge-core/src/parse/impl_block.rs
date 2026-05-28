use super::access_attr::parse_method_access;
use super::param::{extract_param_name, has_parse_attr, parse_skip_targets};
use super::tagged_enum::parse_tagged_enum_attr;
use super::{classify_param_type, parse_return_type};
use crate::descriptor::*;
use std::collections::BTreeMap;
use syn::spanned::Spanned;

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
