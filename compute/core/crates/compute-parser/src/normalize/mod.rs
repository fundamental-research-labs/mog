//! Formula normalization entry points.
//!
//! This module owns two boundary normalizers:
//!
//! 1. XLSX import normalization decodes XML entities, strips XLSX-internal
//!    prefixes, and ensures imported formulas use the internal `=` prefix.
//! 2. User/agent input normalization applies Excel-compatible entry cleanup
//!    before formula parsing.
//!
//! Structured-reference qualification is also kept here because it is a formula
//! string boundary rewrite, not part of the structured-reference parser.

mod entry;
mod scan;
mod structured_refs;
mod xlsx;
mod xml;

pub use entry::normalize_formula_input;
pub use structured_refs::qualify_implicit_structured_refs;
pub use xlsx::normalize_xlsx_formula;
pub use xml::decode_xml_entities_str;

#[cfg(test)]
mod tests;
