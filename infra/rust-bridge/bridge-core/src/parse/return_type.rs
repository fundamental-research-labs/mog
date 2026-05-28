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
