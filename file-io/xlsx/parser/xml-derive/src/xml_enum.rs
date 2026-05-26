use proc_macro2::TokenStream;
use quote::quote;
use syn::{Data, DeriveInput, Fields};

use crate::attrs::VariantAttrs;

pub fn derive_xml_enum(input: DeriveInput) -> syn::Result<TokenStream> {
    let enum_name = &input.ident;

    let variants = match &input.data {
        Data::Enum(data) => &data.variants,
        _ => {
            return Err(syn::Error::new_spanned(
                &input,
                "XmlEnum can only be derived for enums",
            ));
        }
    };

    let mut from_bytes_arms = Vec::new();
    let mut from_ooxml_arms = Vec::new();
    let mut to_ooxml_arms = Vec::new();

    for variant in variants {
        // Only unit variants are supported
        if !matches!(&variant.fields, Fields::Unit) {
            return Err(syn::Error::new_spanned(
                variant,
                "XmlEnum only supports unit variants",
            ));
        }

        let attrs = VariantAttrs::from_variant(variant)?;
        let attrs = match attrs {
            Some(a) => a,
            None => {
                return Err(syn::Error::new_spanned(
                    variant,
                    "all XmlEnum variants must have #[xml(\"...\")] attribute",
                ));
            }
        };

        let variant_ident = &variant.ident;
        let primary = &attrs.value;

        // Build from_bytes arm: b"primary" | b"alias1" | b"alias2" => Self::Variant
        let byte_patterns: Vec<TokenStream> = std::iter::once(primary.as_str())
            .chain(attrs.aliases.iter().map(|s| s.as_str()))
            .map(|s| {
                let lit = syn::LitByteStr::new(s.as_bytes(), proc_macro2::Span::call_site());
                quote! { #lit }
            })
            .collect();

        from_bytes_arms.push(quote! {
            #(#byte_patterns)|* => Self::#variant_ident,
        });

        // Build from_ooxml arm: "primary" | "alias1" | "alias2" => Self::Variant
        let str_patterns: Vec<&str> = std::iter::once(primary.as_str())
            .chain(attrs.aliases.iter().map(|s| s.as_str()))
            .collect();

        from_ooxml_arms.push(quote! {
            #(#str_patterns)|* => Self::#variant_ident,
        });

        // Build to_ooxml arm: Self::Variant => "primary"
        to_ooxml_arms.push(quote! {
            Self::#variant_ident => #primary,
        });
    }

    let expanded = quote! {
        impl #enum_name {
            /// Parse from XML attribute bytes. Lenient fallback to default
            /// on unknown tokens — this is the XLSX external-format read
            /// path where Excel forward-compat occasionally surfaces tokens
            /// newer than our vocabulary. For *internal* read paths (Yrs,
            /// palette, domain conversions), use the strict equivalent on
            /// hand-written enums (round-D 2026-04-23) or audit the enum
            /// for a strict form (a dedicated round will extend strictness
            /// to every OOXML enum).
            pub fn from_bytes(bytes: &[u8]) -> Self {
                match bytes {
                    #(#from_bytes_arms)*
                    _ => Self::default(),
                }
            }

            /// Parse from XML attribute value. Lenient fallback to default.
            pub fn from_ooxml(s: &str) -> Self {
                match s {
                    #(#from_ooxml_arms)*
                    _ => Self::default(),
                }
            }

            pub fn to_ooxml(&self) -> &'static str {
                match self {
                    #(#to_ooxml_arms)*
                }
            }

            pub fn as_str(&self) -> &'static str {
                self.to_ooxml()
            }
        }
    };

    Ok(expanded)
}
