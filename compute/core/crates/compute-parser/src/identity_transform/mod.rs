//! A1 formula string -> `IdentityFormula` conversion.
//!
//! Parses a formula string, walks the AST to collect cell/range references,
//! and builds an [`formula_types::IdentityFormula`] with numbered template
//! placeholders.

mod entrypoints;
mod external;
mod flags;
mod refs;
mod template;

pub use entrypoints::{
    ast_to_identity, to_identity_formula, to_identity_formula_with_external_binder,
    to_identity_formula_with_rect_ranges,
};
pub use external::ExternalLinkBinder;

#[cfg(test)]
mod tests;
