use crate::descriptor::ServiceMeta;
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
