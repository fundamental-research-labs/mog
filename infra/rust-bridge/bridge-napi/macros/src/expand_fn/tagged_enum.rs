use super::*;

pub(super) fn emit_tagged_enum_decode(
    param_ty: &str,
    spec: &NapiTaggedEnumSpec,
    converted: &Ident,
    param_ident: &Ident,
) -> TokenStream {
    // Resolve the enum type token. `param.ty` may be `&AccessTarget` or
    // `AccessTarget` — strip the leading `&` for the decoded local binding.
    let enum_ty_str = param_ty.trim_start_matches('&').trim();
    let enum_ty: TokenStream = enum_ty_str.parse().unwrap_or_else(|_| quote! { _ });

    if spec.content.is_some() {
        // Adjacent-tagged enum — fall through to generic serde decode.
        return quote! {
            let #converted: #enum_ty = serde_json::from_str(&#param_ident)
                .map_err(|e| napi::Error::from_reason(bridge_types::bridge_format_err!(e)))?;
        };
    }

    let tag_lit = &spec.tag;
    let type_name = &spec.type_name;

    let variant_arms: Vec<TokenStream> = spec
        .variants
        .iter()
        .map(|v| emit_tagged_enum_variant_arm(&enum_ty, v))
        .collect();

    quote! {
        let #converted: #enum_ty = {
            let __raw: ::serde_json::Value = ::serde_json::from_str(&#param_ident)
                .map_err(|e| napi::Error::from_reason(format!("{}: {}", #type_name, e)))?;
            let __obj = __raw.as_object().ok_or_else(|| {
                napi::Error::from_reason(format!("{}: expected object with '{}' discriminator", #type_name, #tag_lit))
            })?;
            let __tag = __obj.get(#tag_lit).and_then(|v| v.as_str()).ok_or_else(|| {
                napi::Error::from_reason(format!("{}: missing string '{}' discriminator", #type_name, #tag_lit))
            })?;
            match __tag {
                #(#variant_arms)*
                other => {
                    return Err(napi::Error::from_reason(
                        format!("{}: unknown variant '{}'", #type_name, other),
                    ));
                }
            }
        };
    }
}

pub(super) fn emit_tagged_enum_variant_arm(
    enum_ty: &TokenStream,
    v: &NapiVariantSpec,
) -> TokenStream {
    let wire = &v.wire_name;
    let variant_ident = format_ident!("{}", v.rust_name);

    if v.fields.is_empty() {
        return quote! {
            #wire => #enum_ty :: #variant_ident,
        };
    }

    let field_decodes: Vec<TokenStream> =
        v.fields.iter().map(emit_tagged_enum_field_decode).collect();

    let field_idents: Vec<Ident> = v
        .fields
        .iter()
        .map(|f| format_ident!("{}", f.rust_name))
        .collect();

    quote! {
        #wire => {
            #(#field_decodes)*
            #enum_ty :: #variant_ident { #(#field_idents),* }
        }
    }
}

pub(super) fn emit_tagged_enum_field_decode(f: &NapiVariantField) -> TokenStream {
    let rust_ident = format_ident!("{}", f.rust_name);
    let wire = &f.wire_name;

    match f.field_tag {
        NapiFieldTag::Str => quote! {
            let #rust_ident: String = __obj
                .get(#wire)
                .and_then(|v| v.as_str())
                .ok_or_else(|| napi::Error::from_reason(
                    format!("missing string field '{}'", #wire)
                ))?
                .to_string();
        },
        NapiFieldTag::Prim => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| napi::Error::from_reason(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        NapiFieldTag::Bytes => quote! {
            let #rust_ident: Vec<u8> = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| napi::Error::from_reason(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        NapiFieldTag::Serde => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().ok_or_else(|| napi::Error::from_reason(
                    format!("missing field '{}'", #wire)
                ))?
            ).map_err(|e| napi::Error::from_reason(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        NapiFieldTag::Parse => quote! {
            let #rust_ident = {
                let __s = __obj.get(#wire).and_then(|v| v.as_str()).ok_or_else(|| {
                    napi::Error::from_reason(format!("missing string field '{}'", #wire))
                })?;
                bridge_types::BridgeParse::bridge_parse(__s)
                    .map_err(|e| napi::Error::from_reason(e))?
            };
        },
    }
}
