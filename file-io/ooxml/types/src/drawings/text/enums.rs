// =============================================================================
// TextAnchor
// =============================================================================

/// Vertical text anchor within a text body (ECMA-376 ST_TextAnchoringType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextAnchor {
    /// Anchor text to the top.
    #[default]
    Top,
    /// Anchor text to the center.
    Center,
    /// Anchor text to the bottom.
    Bottom,
    /// Justified anchor.
    Justified,
    /// Distributed anchor.
    Distributed,
}

impl TextAnchor {
    /// Parse from an OOXML `anchor` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "t" => Self::Top,
            "ctr" => Self::Center,
            "b" => Self::Bottom,
            "just" => Self::Justified,
            "dist" => Self::Distributed,
            _ => Self::Top,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Top => "t",
            Self::Center => "ctr",
            Self::Bottom => "b",
            Self::Justified => "just",
            Self::Distributed => "dist",
        }
    }
}

// =============================================================================
// TextWrap
// =============================================================================

/// Text wrapping mode (ECMA-376 ST_TextWrappingType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextWrap {
    /// No wrapping.
    #[default]
    None,
    /// Square wrapping.
    Square,
}

impl TextWrap {
    /// Parse from an OOXML `wrap` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "square" => Self::Square,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Square => "square",
        }
    }
}

// =============================================================================
// TextAlign
// =============================================================================

/// Horizontal text alignment within a paragraph (ECMA-376 ST_TextAlignType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextAlign {
    /// Left alignment.
    #[default]
    Left,
    /// Center alignment.
    Center,
    /// Right alignment.
    Right,
    /// Justified alignment.
    Justify,
    /// Justify low alignment.
    JustifyLow,
    /// Distributed alignment.
    Distributed,
    /// Thai distributed alignment.
    ThaiDistributed,
}

impl TextAlign {
    /// Parse from an OOXML `algn` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "l" => Self::Left,
            "ctr" => Self::Center,
            "r" => Self::Right,
            "just" => Self::Justify,
            "justLow" => Self::JustifyLow,
            "dist" => Self::Distributed,
            "thaiDist" => Self::ThaiDistributed,
            _ => Self::Left,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Left => "l",
            Self::Center => "ctr",
            Self::Right => "r",
            Self::Justify => "just",
            Self::JustifyLow => "justLow",
            Self::Distributed => "dist",
            Self::ThaiDistributed => "thaiDist",
        }
    }
}

// TextVerticalType
// =============================================================================

/// Vertical text orientation (ECMA-376 ST_TextVerticalType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextVerticalType {
    /// Horizontal text (default).
    #[default]
    Horizontal,
    /// Vertical text.
    Vertical,
    /// Vertical text rotated 270 degrees.
    Vertical270,
    /// WordArt vertical text.
    WordArtVert,
    /// East Asian vertical text.
    EastAsianVert,
    /// Mongolian vertical text.
    MongolianVert,
    /// WordArt vertical right-to-left text.
    WordArtVertRtl,
}

impl TextVerticalType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "horz" => Self::Horizontal,
            "vert" => Self::Vertical,
            "vert270" => Self::Vertical270,
            "wordArtVert" => Self::WordArtVert,
            "eaVert" => Self::EastAsianVert,
            "mongolianVert" => Self::MongolianVert,
            "wordArtVertRtl" => Self::WordArtVertRtl,
            _ => Self::Horizontal,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Horizontal => "horz",
            Self::Vertical => "vert",
            Self::Vertical270 => "vert270",
            Self::WordArtVert => "wordArtVert",
            Self::EastAsianVert => "eaVert",
            Self::MongolianVert => "mongolianVert",
            Self::WordArtVertRtl => "wordArtVertRtl",
        }
    }
}

// =============================================================================
// TextVertOverflow
// =============================================================================

/// Vertical text overflow behaviour (ECMA-376 ST_TextVertOverflowType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextVertOverflow {
    /// Text overflows the bounding box.
    #[default]
    Overflow,
    /// Text is replaced with an ellipsis when it overflows.
    Ellipsis,
    /// Text is clipped at the bounding box boundary.
    Clip,
}

impl TextVertOverflow {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "overflow" => Self::Overflow,
            "ellipsis" => Self::Ellipsis,
            "clip" => Self::Clip,
            _ => Self::Overflow,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Overflow => "overflow",
            Self::Ellipsis => "ellipsis",
            Self::Clip => "clip",
        }
    }
}

// =============================================================================
// TextHorzOverflow
// =============================================================================

/// Horizontal text overflow behaviour (ECMA-376 ST_TextHorzOverflowType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextHorzOverflow {
    /// Text overflows the bounding box.
    #[default]
    Overflow,
    /// Text is clipped at the bounding box boundary.
    Clip,
}

impl TextHorzOverflow {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "overflow" => Self::Overflow,
            "clip" => Self::Clip,
            _ => Self::Overflow,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Overflow => "overflow",
            Self::Clip => "clip",
        }
    }
}

// TextFontAlignType
// =============================================================================

/// Font alignment within a paragraph (ECMA-376 ST_TextFontAlignType).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum TextFontAlignType {
    /// Automatic alignment.
    #[default]
    Auto,
    /// Align to top.
    Top,
    /// Align to centre.
    Center,
    /// Align to baseline.
    Baseline,
    /// Align to bottom.
    Bottom,
}

impl TextFontAlignType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "auto" => Self::Auto,
            "t" => Self::Top,
            "ctr" => Self::Center,
            "base" => Self::Baseline,
            "b" => Self::Bottom,
            _ => Self::Auto,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Top => "t",
            Self::Center => "ctr",
            Self::Baseline => "base",
            Self::Bottom => "b",
        }
    }
}
