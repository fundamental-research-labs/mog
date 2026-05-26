//! `xml-derive` — Proc-macro crate for declarative XML <-> Rust struct mapping.
//!
//! Provides three derive macros:
//! - `XmlEnum` — generates `from_bytes`, `from_ooxml`, `to_ooxml`, `as_str` for enums
//! - `XmlRead` — generates `xml_parse(xml: &[u8]) -> Option<Self>` for structs
//! - `XmlWrite` — generates `xml_write(&self, w: &mut XmlWriter)` for structs
//!
//! Generated code calls existing infra functions (SIMD scanner, attribute parsers,
//! XmlWriter) — the macro is a boilerplate eliminator, not a new parser.

extern crate proc_macro;

mod attrs;
mod xml_enum;
mod xml_read;
mod xml_write;

use proc_macro::TokenStream;
use syn::parse_macro_input;

/// Derive `from_bytes`, `from_ooxml`, `to_ooxml`, and `as_str` for an enum.
///
/// # Example
/// ```ignore
/// #[derive(XmlEnum)]
/// pub enum DataValidationType {
///     #[default]
///     #[xml("none")]
///     None,
///     #[xml("whole")]
///     Whole,
///     #[xml("SHA-1", alias = "SHA1")]
///     Sha1,
/// }
/// ```
#[proc_macro_derive(XmlEnum, attributes(xml))]
pub fn derive_xml_enum(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as syn::DeriveInput);
    match xml_enum::derive_xml_enum(input) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}

/// Derive `xml_parse(xml: &[u8]) -> Option<Self>` for a struct.
///
/// # Example
/// ```ignore
/// #[derive(XmlRead)]
/// #[xml(tag = "dataValidation")]
/// pub struct DataValidation {
///     #[xml(attr = "sqref")]
///     pub sqref: String,
///     #[xml(attr = "type", enum)]
///     pub validation_type: DataValidationType,
///     #[xml(child = "formula1", text)]
///     pub formula1: Option<String>,
/// }
/// ```
#[proc_macro_derive(XmlRead, attributes(xml))]
pub fn derive_xml_read(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as syn::DeriveInput);
    match xml_read::derive_xml_read(input) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}

/// Derive `xml_write(&self, w: &mut XmlWriter)` for a struct.
///
/// # Example
/// ```ignore
/// #[derive(XmlWrite)]
/// #[xml(tag = "dataValidation")]
/// pub struct DataValidation {
///     #[xml(attr = "sqref")]
///     pub sqref: String,
///     #[xml(attr = "allowBlank", bool)]
///     pub allow_blank: bool,
///     #[xml(child = "formula1", text)]
///     pub formula1: Option<String>,
/// }
/// ```
#[proc_macro_derive(XmlWrite, attributes(xml))]
pub fn derive_xml_write(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as syn::DeriveInput);
    match xml_write::derive_xml_write(input) {
        Ok(tokens) => tokens.into(),
        Err(e) => e.to_compile_error().into(),
    }
}
