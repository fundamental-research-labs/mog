//! Parse descriptor tokens and generate Tauri command code.

use proc_macro2::{Ident, Span, TokenStream};
use quote::{format_ident, quote};
use syn::parse::{Parse, ParseStream};
use syn::{LitStr, Token, Type, braced, bracketed};

mod body;
mod generate;
mod ir;
mod method;
mod names;
mod parse;
mod types;

#[cfg(test)]
mod tests;

use body::*;
use generate::expand_descriptor;
use ir::*;
use method::expand_method;
use names::to_snake_case;
use types::*;

pub(crate) fn parse_and_expand(input: proc_macro2::TokenStream) -> syn::Result<TokenStream> {
    let desc: TauriDescriptor = syn::parse2(input)?;
    Ok(expand_descriptor(&desc))
}
