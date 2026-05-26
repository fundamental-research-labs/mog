//! Image compression state — CT_BlipFillProperties `@cstate` mirror
//! (typed OOXML preservation A.7 primitive).
//!
//! Mirror of `ooxml_types::drawings::CompressionState`. The OOXML attribute
//! values are `"email" | "screen" | "print" | "hqprint" | "none"`; this
//! domain enum carries the same discriminants with Rust-idiomatic naming,
//! and ships `From<&ooxml>` / `From<dom> -> ooxml` converters.

use serde::{Deserialize, Serialize};

/// Image compression state applied when saving a blip
/// (ECMA-376 ST_BlipCompression).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CompressionState {
    /// Email quality — highest compression.
    Email,
    /// Screen quality.
    Screen,
    /// Print quality.
    Print,
    /// High-quality print.
    HqPrint,
    /// No compression.
    #[default]
    None,
}

impl CompressionState {
    /// Parse from the raw OOXML attribute value (e.g. `"email"`, `"hqprint"`).
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "email" => Self::Email,
            "screen" => Self::Screen,
            "print" => Self::Print,
            "hqprint" => Self::HqPrint,
            "none" => Self::None,
            _ => Self::None,
        }
    }

    /// Serialize to the raw OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Screen => "screen",
            Self::Print => "print",
            Self::HqPrint => "hqprint",
            Self::None => "none",
        }
    }
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::CompressionState as OCompressionState;

impl From<&OCompressionState> for CompressionState {
    fn from(c: &OCompressionState) -> Self {
        match c {
            OCompressionState::Email => Self::Email,
            OCompressionState::Screen => Self::Screen,
            OCompressionState::Print => Self::Print,
            OCompressionState::HqPrint => Self::HqPrint,
            OCompressionState::None => Self::None,
        }
    }
}

impl From<OCompressionState> for CompressionState {
    fn from(c: OCompressionState) -> Self {
        (&c).into()
    }
}

impl From<CompressionState> for OCompressionState {
    fn from(c: CompressionState) -> Self {
        match c {
            CompressionState::Email => Self::Email,
            CompressionState::Screen => Self::Screen,
            CompressionState::Print => Self::Print,
            CompressionState::HqPrint => Self::HqPrint,
            CompressionState::None => Self::None,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_all_variants() {
        for original in [
            OCompressionState::Email,
            OCompressionState::Screen,
            OCompressionState::Print,
            OCompressionState::HqPrint,
            OCompressionState::None,
        ] {
            let dom: CompressionState = original.into();
            let round: OCompressionState = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn default_is_none() {
        assert_eq!(CompressionState::default(), CompressionState::None);
    }

    #[test]
    fn ooxml_tokens_round_trip() {
        for s in ["email", "screen", "print", "hqprint", "none"] {
            let parsed = CompressionState::from_ooxml(s);
            assert_eq!(parsed.to_ooxml(), s);
        }
    }
}
