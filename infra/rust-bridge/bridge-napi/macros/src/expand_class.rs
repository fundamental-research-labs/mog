//! Class-based napi code generation.

mod class_decl;
mod generate;
mod input;
mod lifecycle;
mod methods;
mod returns;

#[cfg(test)]
mod tests;

use proc_macro2::TokenStream;

use crate::ir::NapiDescriptor;

pub(crate) use class_decl::generate_class_impl;

/// Parse `__class_name = ClassName; <descriptor tokens>` and generate
/// class-based napi bindings.
pub(crate) fn parse_and_expand_class(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let parsed: input::ClassExpandInput = syn::parse2(input)?;
    let desc: NapiDescriptor = syn::parse2(parsed.descriptor_tokens)?;
    Ok(generate::expand_class(&parsed.class_name, &desc))
}
