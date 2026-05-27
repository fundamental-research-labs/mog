//! Compatibility facade for the drawing text parser.
//!
//! Text parsing now lives under `domain::drawings::parse::text` with the other
//! read-side OOXML parsers. Keep this module so existing callers can continue
//! importing `domain::drawings::text::parse_text_body` while migration finishes.

pub use super::parse::text::parse_text_body;
