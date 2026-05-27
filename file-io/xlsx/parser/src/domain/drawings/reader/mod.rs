//! Scoped XML reader primitives for spreadsheet drawings.
//!
//! These helpers wrap the low-level byte scanner with drawing-parser contracts:
//! callers operate on bounded element slices and direct children instead of
//! repeatedly searching broad parent XML.

pub(crate) mod attrs;
pub(crate) mod elements;
pub(crate) mod namespaces;
pub(crate) mod raw;
