//! Style types (ECMA-376 CT_Font, CT_Fill, CT_Border, CT_CellAlignment, CT_CellProtection,
//! CT_Xf, CT_NumFmt).
//!
//! Unified from xlsx-parser read (`read/styles.rs`) and write (`write/styles/types.rs`) sides.
//! The read side used raw strings for enum-like fields (e.g., `pattern_type: String`); the write
//! side had proper enums with `as_str()` methods. This module defines the canonical enum types
//! with `from_ooxml` / `to_ooxml` converters so both sides share one vocabulary.

mod types;

pub use types::*;

#[cfg(test)]
mod tests;
