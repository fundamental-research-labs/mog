//! Compatibility facade for XLSX defined-name parsing.
//!
//! The model types live in `types.rs`; parsing implementations are split
//! between element and section parser modules. This module preserves the
//! historical `domain::names::read::*` import path.

pub use super::types::{BuiltInName, DefinedName, DefinedNames};
