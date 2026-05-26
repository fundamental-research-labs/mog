use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields};

use crate::attrs::{AttrValueType, FieldAttrs, FieldKind, StructAttrs};

pub fn derive_xml_read(input: DeriveInput) -> syn::Result<TokenStream> {
    let struct_name = &input.ident;

    let fields = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(named) => &named.named,
            _ => {
                return Err(syn::Error::new_spanned(
                    &input,
                    "XmlRead can only be derived for structs with named fields",
                ));
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(
                &input,
                "XmlRead can only be derived for structs",
            ));
        }
    };

    let struct_attrs = StructAttrs::from_attrs(&input.attrs)?;
    let xml_mod = struct_attrs.xml_mod_path();
    let scanner_mod = struct_attrs.scanner_mod_path();

    // Collect parsed field info
    let mut parsed_fields: Vec<(syn::Ident, FieldAttrs, syn::Type)> = Vec::new();
    for field in fields.iter() {
        if let Some(fa) = FieldAttrs::from_field(field)? {
            let ident = field.ident.clone().unwrap();
            parsed_fields.push((ident, fa, field.ty.clone()));
        }
    }

    // Collect all known attr patterns (for preserve_attrs)
    let known_attr_patterns: Vec<String> = parsed_fields
        .iter()
        .filter_map(|(_, fa, _)| match &fa.kind {
            FieldKind::Attr { name, .. } => Some(format!("{}=\"", name)),
            _ => None,
        })
        .collect();

    // Generate field parse statements
    let mut stmts: Vec<TokenStream> = Vec::new();

    for (ident, fa, ty) in &parsed_fields {
        match &fa.kind {
            FieldKind::Attr {
                name,
                value_type,
                default_variant,
                ..
            } => {
                let attr_pattern = format!("{}=\"", name);
                let attr_bytes =
                    syn::LitByteStr::new(attr_pattern.as_bytes(), proc_macro2::Span::call_site());

                match value_type {
                    AttrValueType::String => {
                        if fa.is_optional {
                            stmts.push(quote! {
                                item.#ident = #xml_mod::parse_string_attr(tag, #attr_bytes);
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_string_attr(tag, #attr_bytes) {
                                    item.#ident = v;
                                } else {
                                    return None;
                                }
                            });
                        }
                    }
                    AttrValueType::Bool => {
                        if fa.is_optional {
                            stmts.push(quote! {
                                item.#ident = #xml_mod::parse_bool_attr_opt(tag, #attr_bytes);
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_bool_attr_opt(tag, #attr_bytes) {
                                    item.#ident = v;
                                }
                            });
                        }
                    }
                    AttrValueType::Enum => {
                        let inner_ty = if fa.is_optional {
                            crate::attrs::extract_option_inner(ty).unwrap_or(ty)
                        } else {
                            ty
                        };

                        if fa.is_optional {
                            if let Some(default_name) = default_variant {
                                let default_ident =
                                    syn::Ident::new(default_name, proc_macro2::Span::call_site());
                                stmts.push(quote! {
                                    if let Some(v) = #xml_mod::parse_bytes_attr(tag, #attr_bytes) {
                                        let parsed = #inner_ty::from_bytes(v);
                                        if matches!(parsed, #inner_ty::#default_ident) {
                                            item.#ident = None;
                                        } else {
                                            item.#ident = Some(parsed);
                                        }
                                    }
                                });
                            } else {
                                stmts.push(quote! {
                                    if let Some(v) = #xml_mod::parse_bytes_attr(tag, #attr_bytes) {
                                        item.#ident = Some(#inner_ty::from_bytes(v));
                                    }
                                });
                            }
                        } else if let Some(default_name) = default_variant {
                            let default_ident =
                                syn::Ident::new(default_name, proc_macro2::Span::call_site());
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_bytes_attr(tag, #attr_bytes) {
                                    item.#ident = #inner_ty::from_bytes(v);
                                } else {
                                    item.#ident = #inner_ty::#default_ident;
                                }
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_bytes_attr(tag, #attr_bytes) {
                                    item.#ident = #inner_ty::from_bytes(v);
                                }
                            });
                        }
                    }
                    AttrValueType::U32 => {
                        if fa.is_optional {
                            stmts.push(quote! {
                                item.#ident = #xml_mod::parse_u32_attr(tag, #attr_bytes);
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_u32_attr(tag, #attr_bytes) {
                                    item.#ident = v;
                                }
                            });
                        }
                    }
                    AttrValueType::U8 => {
                        if fa.is_optional {
                            stmts.push(quote! {
                                item.#ident = #xml_mod::parse_u8_attr(tag, #attr_bytes);
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_u8_attr(tag, #attr_bytes) {
                                    item.#ident = v;
                                }
                            });
                        }
                    }
                    AttrValueType::I32 => {
                        if fa.is_optional {
                            stmts.push(quote! {
                                item.#ident = #xml_mod::parse_i32_attr(tag, #attr_bytes);
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_i32_attr(tag, #attr_bytes) {
                                    item.#ident = v;
                                }
                            });
                        }
                    }
                    AttrValueType::F64 => {
                        if fa.is_optional {
                            stmts.push(quote! {
                                item.#ident = #xml_mod::parse_f64_attr(tag, #attr_bytes);
                            });
                        } else {
                            stmts.push(quote! {
                                if let Some(v) = #xml_mod::parse_f64_attr(tag, #attr_bytes) {
                                    item.#ident = v;
                                }
                            });
                        }
                    }
                }
            }

            FieldKind::ChildText { tag } => {
                let tag_bytes =
                    syn::LitByteStr::new(tag.as_bytes(), proc_macro2::Span::call_site());
                if fa.is_optional {
                    stmts.push(quote! {
                        item.#ident = #xml_mod::parse_element_content(xml, #tag_bytes);
                    });
                } else {
                    stmts.push(quote! {
                        if let Some(v) = #xml_mod::parse_element_content(xml, #tag_bytes) {
                            item.#ident = v;
                        } else {
                            return None;
                        }
                    });
                }
            }

            FieldKind::ChildStruct { tag } => {
                let tag_bytes =
                    syn::LitByteStr::new(tag.as_bytes(), proc_macro2::Span::call_site());
                let inner_ty = if fa.is_optional {
                    crate::attrs::extract_option_inner(ty).unwrap_or(ty)
                } else {
                    ty
                };

                if fa.is_optional {
                    stmts.push(quote! {
                        if let Some(child_start) = #scanner_mod::find_tag_simd(xml, #tag_bytes, 0) {
                            let child_end = #scanner_mod::find_closing_tag(xml, #tag_bytes, child_start)
                                .and_then(|ce| #scanner_mod::find_gt_simd(xml, ce).map(|p| p + 1))
                                .unwrap_or(xml.len());
                            item.#ident = #inner_ty::xml_parse(&xml[child_start..child_end]);
                        }
                    });
                } else {
                    stmts.push(quote! {
                        if let Some(child_start) = #scanner_mod::find_tag_simd(xml, #tag_bytes, 0) {
                            let child_end = #scanner_mod::find_closing_tag(xml, #tag_bytes, child_start)
                                .and_then(|ce| #scanner_mod::find_gt_simd(xml, ce).map(|p| p + 1))
                                .unwrap_or(xml.len());
                            if let Some(v) = #inner_ty::xml_parse(&xml[child_start..child_end]) {
                                item.#ident = v;
                            } else {
                                return None;
                            }
                        } else {
                            return None;
                        }
                    });
                }
            }

            FieldKind::ChildList { tag, .. } => {
                let tag_bytes =
                    syn::LitByteStr::new(tag.as_bytes(), proc_macro2::Span::call_site());
                // Extract the Vec<T> inner type
                let inner_ty = extract_vec_inner(ty);

                stmts.push(quote! {
                    {
                        let mut search_from = 0usize;
                        while let Some(child_start) = #scanner_mod::find_tag_simd(xml, #tag_bytes, search_from) {
                            let child_end = #scanner_mod::find_closing_tag(xml, #tag_bytes, child_start)
                                .and_then(|ce| #scanner_mod::find_gt_simd(xml, ce).map(|p| p + 1))
                                .unwrap_or(xml.len());
                            if let Some(child) = #inner_ty::xml_parse(&xml[child_start..child_end]) {
                                item.#ident.push(child);
                            }
                            search_from = child_end;
                        }
                    }
                });
            }

            FieldKind::PreserveAttrs => {
                let known_bytes: Vec<syn::LitByteStr> = known_attr_patterns
                    .iter()
                    .map(|p| syn::LitByteStr::new(p.as_bytes(), proc_macro2::Span::call_site()))
                    .collect();

                stmts.push(quote! {
                    item.#ident = #xml_mod::collect_unknown_attrs(
                        tag,
                        &[#(#known_bytes),*],
                    );
                });
            }

            FieldKind::PreserveRaw { tag } => {
                let tag_bytes =
                    syn::LitByteStr::new(tag.as_bytes(), proc_macro2::Span::call_site());
                stmts.push(quote! {
                    item.#ident = #xml_mod::extract_raw_element(xml, #tag_bytes);
                });
            }

            FieldKind::AutoCount { .. } => {
                // Skip during parse — auto_count is computed on write
            }
        }
    }

    let expanded = quote! {
        impl #struct_name {
            pub fn xml_parse(xml: &[u8]) -> Option<Self> {
                let mut item = Self::default();
                let tag_end = #scanner_mod::find_element_end(xml, 0)?;
                let tag = &xml[..tag_end];

                #(#stmts)*

                Some(item)
            }
        }
    };

    Ok(expanded)
}

/// Extract the inner type `T` from `Vec<T>`.
fn extract_vec_inner(ty: &syn::Type) -> &syn::Type {
    if let syn::Type::Path(ref p) = ty {
        if let Some(seg) = p.path.segments.last() {
            if seg.ident == "Vec" {
                if let syn::PathArguments::AngleBracketed(ref args) = seg.arguments {
                    if let Some(syn::GenericArgument::Type(inner)) = args.args.first() {
                        return inner;
                    }
                }
            }
        }
    }
    ty
}
