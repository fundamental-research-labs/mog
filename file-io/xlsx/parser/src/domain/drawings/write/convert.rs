//! Compatibility re-export for the drawing conversion boundary.
//!
//! Conversion now lives in `domain::drawings::convert`; the historical
//! `domain::drawings::write::convert` path remains available for existing tests
//! and callers.

pub use super::super::convert::*;
