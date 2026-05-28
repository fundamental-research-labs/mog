//! Compatibility facade for drawing object parsers.
//!
//! The implementation lives in `drawings::parse::*`; this module keeps the
//! historical parser paths stable.

pub use super::parse::non_visual::parse_nv_props;
pub use super::parse::shapes::parse_shape_preset;
