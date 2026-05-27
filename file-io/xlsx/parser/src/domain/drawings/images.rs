//! Compatibility facade for picture parsing.
//!
//! The implementation lives in `drawings::parse::pictures`; this module keeps
//! the historical internal paths stable while picture parsing migrates under
//! the parse layer.

#![allow(unused_imports)]

pub(crate) use super::parse::pictures::parse_picture_locking;
pub use super::parse::pictures::{parse_blip_fill, parse_compression_state, parse_picture};
