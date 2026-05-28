use proc_macro2::{Ident, TokenStream};
use syn::Token;
use syn::parse::{Parse, ParseStream};

/// Input for `__expand_class`: `__class_name = ClassName; <descriptor tokens>`.
pub(super) struct ClassExpandInput {
    pub(super) class_name: String,
    pub(super) descriptor_tokens: TokenStream,
}

impl Parse for ClassExpandInput {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let kw: Ident = input.parse()?;
        if kw != "__class_name" {
            return Err(syn::Error::new(kw.span(), "expected '__class_name'"));
        }
        let _: Token![=] = input.parse()?;
        let class_ident: Ident = input.parse()?;
        let _: Token![;] = input.parse()?;

        let descriptor_tokens: TokenStream = input.parse()?;

        Ok(ClassExpandInput {
            class_name: class_ident.to_string(),
            descriptor_tokens,
        })
    }
}
