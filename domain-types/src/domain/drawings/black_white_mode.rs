//! ST_BlackWhiteMode enum — drawing black-and-white rendering mode
//! (typed OOXML preservation primitive).
//!
//! Mirror of `ooxml_types::drawings::BlackWhiteMode` (11 variants).
//! Used by `xdr:spPr/@bwMode` on CT_ShapeProperties and chart plot areas.
//!
//! Default is `Clr` (full color) to match the OOXML spec default.

use serde::{Deserialize, Serialize};

/// Black-and-white rendering mode (ST_BlackWhiteMode) — 11 tokens.
///
/// JSON serialization uses camelCase; the OOXML tokens themselves are a
/// mix of lowercase and camelCase (`clr`, `ltGray`, `grayWhite`, etc.)
/// and match camelCase serde output exactly.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlackWhiteMode {
    /// `clr` — full color (default).
    #[default]
    Clr,
    /// `auto` — driver-chosen rendering.
    Auto,
    /// `gray` — grayscale.
    Gray,
    /// `ltGray` — light gray.
    LtGray,
    /// `invGray` — inverted gray.
    InvGray,
    /// `grayWhite` — gray and white only.
    GrayWhite,
    /// `blackGray` — black and gray only.
    BlackGray,
    /// `blackWhite` — black and white only.
    BlackWhite,
    /// `black` — black only.
    Black,
    /// `white` — white only.
    White,
    /// `hidden` — not rendered.
    Hidden,
}

impl BlackWhiteMode {
    /// Parse from an OOXML attribute value. Unknown tokens default to `Clr`.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "clr" => Self::Clr,
            "auto" => Self::Auto,
            "gray" => Self::Gray,
            "ltGray" => Self::LtGray,
            "invGray" => Self::InvGray,
            "grayWhite" => Self::GrayWhite,
            "blackGray" => Self::BlackGray,
            "blackWhite" => Self::BlackWhite,
            "black" => Self::Black,
            "white" => Self::White,
            "hidden" => Self::Hidden,
            _ => Self::Clr,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Clr => "clr",
            Self::Auto => "auto",
            Self::Gray => "gray",
            Self::LtGray => "ltGray",
            Self::InvGray => "invGray",
            Self::GrayWhite => "grayWhite",
            Self::BlackGray => "blackGray",
            Self::BlackWhite => "blackWhite",
            Self::Black => "black",
            Self::White => "white",
            Self::Hidden => "hidden",
        }
    }
}

// ===========================================================================
// Converters to/from ooxml_types
// ===========================================================================

use ooxml_types::drawings::BlackWhiteMode as OBwMode;

impl From<&OBwMode> for BlackWhiteMode {
    fn from(m: &OBwMode) -> Self {
        match m {
            OBwMode::Clr => Self::Clr,
            OBwMode::Auto => Self::Auto,
            OBwMode::Gray => Self::Gray,
            OBwMode::LtGray => Self::LtGray,
            OBwMode::InvGray => Self::InvGray,
            OBwMode::GrayWhite => Self::GrayWhite,
            OBwMode::BlackGray => Self::BlackGray,
            OBwMode::BlackWhite => Self::BlackWhite,
            OBwMode::Black => Self::Black,
            OBwMode::White => Self::White,
            OBwMode::Hidden => Self::Hidden,
        }
    }
}

impl From<BlackWhiteMode> for OBwMode {
    fn from(m: BlackWhiteMode) -> Self {
        match m {
            BlackWhiteMode::Clr => Self::Clr,
            BlackWhiteMode::Auto => Self::Auto,
            BlackWhiteMode::Gray => Self::Gray,
            BlackWhiteMode::LtGray => Self::LtGray,
            BlackWhiteMode::InvGray => Self::InvGray,
            BlackWhiteMode::GrayWhite => Self::GrayWhite,
            BlackWhiteMode::BlackGray => Self::BlackGray,
            BlackWhiteMode::BlackWhite => Self::BlackWhite,
            BlackWhiteMode::Black => Self::Black,
            BlackWhiteMode::White => Self::White,
            BlackWhiteMode::Hidden => Self::Hidden,
        }
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_VARIANTS: [(OBwMode, &str); 11] = [
        (OBwMode::Clr, "clr"),
        (OBwMode::Auto, "auto"),
        (OBwMode::Gray, "gray"),
        (OBwMode::LtGray, "ltGray"),
        (OBwMode::InvGray, "invGray"),
        (OBwMode::GrayWhite, "grayWhite"),
        (OBwMode::BlackGray, "blackGray"),
        (OBwMode::BlackWhite, "blackWhite"),
        (OBwMode::Black, "black"),
        (OBwMode::White, "white"),
        (OBwMode::Hidden, "hidden"),
    ];

    #[test]
    fn default_is_clr() {
        assert_eq!(BlackWhiteMode::default(), BlackWhiteMode::Clr);
    }

    #[test]
    fn all_variants_round_trip_ooxml() {
        for (original, _) in ALL_VARIANTS {
            let dom: BlackWhiteMode = (&original).into();
            let round: OBwMode = dom.into();
            assert_eq!(original, round);
        }
    }

    #[test]
    fn token_parsing_round_trip() {
        for (_, tok) in ALL_VARIANTS {
            let parsed = BlackWhiteMode::from_ooxml(tok);
            assert_eq!(parsed.to_ooxml(), tok);
        }
    }

    #[test]
    fn unknown_token_defaults_to_clr() {
        assert_eq!(BlackWhiteMode::from_ooxml("nonsense"), BlackWhiteMode::Clr);
    }

    #[test]
    fn camelcase_json_matches_ooxml_token() {
        // Verify serde camelCase output matches the OOXML token (which is
        // also effectively camelCase).
        let mode = BlackWhiteMode::LtGray;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, r#""ltGray""#);
        let round: BlackWhiteMode = serde_json::from_str(&json).unwrap();
        assert_eq!(mode, round);
    }
}
