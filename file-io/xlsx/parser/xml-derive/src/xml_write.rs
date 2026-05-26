use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields};

use crate::attrs::{AttrValueType, FieldAttrs, FieldKind, StructAttrs};

pub fn derive_xml_write(input: DeriveInput) -> syn::Result<TokenStream> {
    let struct_name = &input.ident;

    let fields = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(named) => &named.named,
            _ => {
                return Err(syn::Error::new_spanned(
                    &input,
                    "XmlWrite can only be derived for structs with named fields",
                ));
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(
                &input,
                "XmlWrite can only be derived for structs",
            ));
        }
    };

    let struct_attrs = StructAttrs::from_attrs(&input.attrs)?;
    let writer_type = struct_attrs.writer_type_path();

    let qualified_tag = match &struct_attrs.ns {
        Some(ns) => format!("{}:{}", ns, struct_attrs.tag),
        None => struct_attrs.tag.clone(),
    };

    // Parse all field attributes
    let mut parsed_fields: Vec<(syn::Ident, FieldAttrs)> = Vec::new();
    for field in fields {
        if let Some(fa) = FieldAttrs::from_field(field)? {
            let ident = field
                .ident
                .clone()
                .ok_or_else(|| syn::Error::new_spanned(field, "expected named field"))?;
            parsed_fields.push((ident, fa));
        }
    }

    // Separate into attribute fields and child fields
    let mut attr_stmts: Vec<TokenStream> = Vec::new();
    let mut child_stmts: Vec<TokenStream> = Vec::new();
    let mut child_presence: Vec<TokenStream> = Vec::new();

    for (ident, fa) in &parsed_fields {
        match &fa.kind {
            FieldKind::Attr {
                name,
                value_type,
                invert,
                skip_default,
                ..
            } => {
                let stmt = gen_attr_write(
                    ident,
                    name,
                    value_type,
                    fa.is_optional,
                    *invert,
                    *skip_default,
                );
                attr_stmts.push(stmt);
            }
            FieldKind::AutoCount {
                attr_name,
                field_name,
            } => {
                let target_ident = syn::Ident::new(field_name, proc_macro2::Span::call_site());
                let stmt = quote! {
                    w.attr_num(#attr_name, self.#target_ident.len());
                };
                attr_stmts.push(stmt);
            }
            FieldKind::PreserveAttrs => {
                let stmt = quote! {
                    if let Some(ref preserved) = self.#ident {
                        for (name, value) in preserved {
                            w.attr(name, value);
                        }
                    }
                };
                attr_stmts.push(stmt);
            }
            FieldKind::ChildText { tag } => {
                if fa.is_optional {
                    child_presence.push(quote! { self.#ident.is_some() });
                    child_stmts.push(quote! {
                        if let Some(ref v) = self.#ident {
                            w.element_with_text(#tag, v);
                        }
                    });
                } else {
                    child_presence.push(quote! { true });
                    child_stmts.push(quote! {
                        w.element_with_text(#tag, &self.#ident);
                    });
                }
            }
            FieldKind::ChildStruct { .. } => {
                if fa.is_optional {
                    child_presence.push(quote! { self.#ident.is_some() });
                    child_stmts.push(quote! {
                        if let Some(ref child) = self.#ident {
                            child.xml_write(w);
                        }
                    });
                } else {
                    child_presence.push(quote! { true });
                    child_stmts.push(quote! {
                        self.#ident.xml_write(w);
                    });
                }
            }
            FieldKind::ChildList { .. } => {
                child_presence.push(quote! { !self.#ident.is_empty() });
                child_stmts.push(quote! {
                    for child in &self.#ident {
                        child.xml_write(w);
                    }
                });
            }
            FieldKind::PreserveRaw { .. } => {
                if fa.is_optional {
                    child_presence.push(quote! { self.#ident.is_some() });
                    child_stmts.push(quote! {
                        if let Some(ref raw) = self.#ident {
                            w.raw_str(raw);
                        }
                    });
                } else {
                    child_presence.push(quote! { true });
                    child_stmts.push(quote! {
                        w.raw_str(&self.#ident);
                    });
                }
            }
        }
    }

    // Build the body: if there are child fields, we need has_children logic
    let body = if child_stmts.is_empty() {
        // No children — always self-close
        quote! {
            w.start_element(#qualified_tag);
            #(#attr_stmts)*
            w.self_close();
        }
    } else {
        quote! {
            w.start_element(#qualified_tag);
            #(#attr_stmts)*

            let has_children = #(#child_presence)||*;
            if has_children {
                w.end_attrs();
                #(#child_stmts)*
                w.end_element(#qualified_tag);
            } else {
                w.self_close();
            }
        }
    };

    let expanded = quote! {
        impl #struct_name {
            pub fn xml_write(&self, w: &mut #writer_type) {
                #body
            }
        }
    };

    Ok(expanded)
}

/// Generate a token stream for writing a single XML attribute.
fn gen_attr_write(
    ident: &syn::Ident,
    attr_name: &str,
    value_type: &AttrValueType,
    is_optional: bool,
    invert: bool,
    skip_default: bool,
) -> TokenStream {
    match value_type {
        AttrValueType::Bool => {
            if invert {
                quote! {
                    if !self.#ident {
                        w.attr(#attr_name, "1");
                    }
                }
            } else {
                quote! {
                    if self.#ident {
                        w.attr(#attr_name, "1");
                    }
                }
            }
        }
        AttrValueType::Enum => {
            if skip_default {
                quote! {
                    if self.#ident != Default::default() {
                        w.attr(#attr_name, self.#ident.as_str());
                    }
                }
            } else {
                quote! {
                    w.attr(#attr_name, self.#ident.as_str());
                }
            }
        }
        AttrValueType::String => {
            if is_optional {
                quote! {
                    if let Some(ref v) = self.#ident {
                        w.attr(#attr_name, v);
                    }
                }
            } else {
                quote! {
                    w.attr(#attr_name, &self.#ident);
                }
            }
        }
        AttrValueType::U32 | AttrValueType::U8 | AttrValueType::I32 | AttrValueType::F64 => {
            if is_optional {
                quote! {
                    if let Some(v) = self.#ident {
                        w.attr_num(#attr_name, v);
                    }
                }
            } else {
                quote! {
                    w.attr_num(#attr_name, self.#ident);
                }
            }
        }
    }
}
