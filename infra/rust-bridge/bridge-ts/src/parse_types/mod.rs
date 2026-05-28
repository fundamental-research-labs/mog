//! Parse Rust structs and enums into TypeScript type definitions.
//!
//! Walks a parsed `syn::File` looking for items with `#[derive(Serialize)]`.
//! Structs become `TsInterface`, all-unit enums become `TsStringUnion`, and
//! enums with data variants become `TsTaggedUnion`.

mod config;
mod enums;
mod fields;
mod ident;
mod source;
mod structs;
mod type_resolver;

pub use config::TypeGenConfig;
pub use source::parse_types;

#[cfg(test)]
mod tests;
