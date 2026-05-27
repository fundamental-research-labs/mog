//! Compatibility re-export for write-side style types.
//!
//! New domain code should import from `crate::domain::styles::types`; this
//! module remains so existing public `write::styles::*` paths keep working.

pub use crate::domain::styles::types::*;
