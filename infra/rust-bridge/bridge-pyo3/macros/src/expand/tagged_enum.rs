use super::*;

pub(super) fn emit_pyo3_tagged_enum_decode(
    param_ty: &str,
    spec: &PyO3TaggedEnumSpec,
    converted: &Ident,
    param_ident: &Ident,
) -> TokenStream {
    let enum_ty_str = param_ty.trim_start_matches('&').trim();
    let enum_ty: TokenStream = enum_ty_str.parse().unwrap_or_else(|_| quote! { _ });

    if spec.content.is_some() {
        return quote! {
            let #converted: #enum_ty = serde_json::from_str(&#param_ident)
                .map_err(|e| pyo3::exceptions::PyValueError::new_err(format!("{}", e)))?;
        };
    }

    let tag_lit = &spec.tag;
    let type_name = &spec.type_name;

    let variant_arms: Vec<TokenStream> = spec
        .variants
        .iter()
        .map(|v| emit_pyo3_tagged_enum_variant_arm(&enum_ty, v))
        .collect();

    quote! {
        let #converted: #enum_ty = {
            let __raw: ::serde_json::Value = ::serde_json::from_str(&#param_ident)
                .map_err(|e| pyo3::exceptions::PyValueError::new_err(
                    format!("{}: {}", #type_name, e)
                ))?;
            let __obj = __raw.as_object().ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err(
                    format!("{}: expected object with '{}' discriminator", #type_name, #tag_lit)
                )
            })?;
            let __tag = __obj.get(#tag_lit).and_then(|v| v.as_str()).ok_or_else(|| {
                pyo3::exceptions::PyValueError::new_err(
                    format!("{}: missing string '{}' discriminator", #type_name, #tag_lit)
                )
            })?;
            match __tag {
                #(#variant_arms)*
                other => {
                    return Err(pyo3::exceptions::PyValueError::new_err(
                        format!("{}: unknown variant '{}'", #type_name, other),
                    ));
                }
            }
        };
    }
}

pub(super) fn emit_pyo3_tagged_enum_variant_arm(
    enum_ty: &TokenStream,
    v: &PyO3VariantSpec,
) -> TokenStream {
    let wire = &v.wire_name;
    let variant_ident = format_ident!("{}", v.rust_name);

    if v.fields.is_empty() {
        return quote! {
            #wire => #enum_ty :: #variant_ident,
        };
    }

    let field_decodes: Vec<TokenStream> = v
        .fields
        .iter()
        .map(emit_pyo3_tagged_enum_field_decode)
        .collect();

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

pub(super) fn emit_pyo3_tagged_enum_field_decode(f: &PyO3VariantField) -> TokenStream {
    let rust_ident = format_ident!("{}", f.rust_name);
    let wire = &f.wire_name;

    match f.field_tag {
        PyO3FieldTag::Str => quote! {
            let #rust_ident: String = __obj
                .get(#wire)
                .and_then(|v| v.as_str())
                .ok_or_else(|| pyo3::exceptions::PyValueError::new_err(
                    format!("missing string field '{}'", #wire)
                ))?
                .to_string();
        },
        PyO3FieldTag::Prim => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        PyO3FieldTag::Bytes => quote! {
            let #rust_ident: Vec<u8> = ::serde_json::from_value(
                __obj.get(#wire).cloned().unwrap_or(::serde_json::Value::Null)
            ).map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        PyO3FieldTag::Serde => quote! {
            let #rust_ident = ::serde_json::from_value(
                __obj.get(#wire).cloned().ok_or_else(|| pyo3::exceptions::PyValueError::new_err(
                    format!("missing field '{}'", #wire)
                ))?
            ).map_err(|e| pyo3::exceptions::PyValueError::new_err(
                format!("field '{}': {}", #wire, e)
            ))?;
        },
        PyO3FieldTag::Parse => quote! {
            let #rust_ident = {
                let __s = __obj.get(#wire).and_then(|v| v.as_str()).ok_or_else(|| {
                    pyo3::exceptions::PyValueError::new_err(
                        format!("missing string field '{}'", #wire)
                    )
                })?;
                bridge_types::BridgeParse::bridge_parse(__s)
                    .map_err(|e| pyo3::exceptions::PyValueError::new_err(e))?
            };
        },
    }
}
