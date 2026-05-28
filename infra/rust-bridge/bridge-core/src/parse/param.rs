use crate::descriptor::ParamTag;
use syn::spanned::Spanned;

pub(crate) fn classify_param_type(ty: &syn::Type, has_parse: bool) -> ParamTag {
    if has_parse {
        return ParamTag::Parse;
    }
    // `#[bridge::tagged_enum(...)]` is resolved before reaching this function.
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

pub(super) fn has_parse_attr(attrs: &[syn::Attribute]) -> bool {
    attrs.iter().any(|a| {
        let segs: Vec<_> = a.path().segments.iter().collect();
        segs.len() == 2 && segs[0].ident == "bridge" && segs[1].ident == "parse"
    })
}

pub(super) fn parse_skip_targets(attrs: &[syn::Attribute]) -> Vec<String> {
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

pub(super) fn extract_param_name(pat: &syn::Pat) -> syn::Result<syn::Ident> {
    match pat {
        syn::Pat::Ident(pi) => Ok(pi.ident.clone()),
        _ => Err(syn::Error::new(
            pat.span(),
            "bridge::api: unsupported parameter pattern",
        )),
    }
}
