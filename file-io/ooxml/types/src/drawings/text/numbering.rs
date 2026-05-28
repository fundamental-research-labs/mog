// TextAutonumberType
// =============================================================================

/// Autonumber bullet scheme (ECMA-376 ST_TextAutonumberScheme).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize, Default,
)]
pub enum TextAutonumberType {
    /// a), b), c), ...
    AlphaLcParenBoth,
    /// A), B), C), ...
    AlphaUcParenBoth,
    /// a), b), c), ... (right paren only)
    AlphaLcParenR,
    /// A), B), C), ... (right paren only)
    AlphaUcParenR,
    /// a., b., c., ...
    AlphaLcPeriod,
    /// A., B., C., ...
    AlphaUcPeriod,
    /// (1), (2), (3), ...
    ArabicParenBoth,
    /// 1), 2), 3), ...
    ArabicParenR,
    /// 1., 2., 3., ...
    #[default]
    ArabicPeriod,
    /// 1, 2, 3, ...
    ArabicPlain,
    /// (i), (ii), (iii), ...
    RomanLcParenBoth,
    /// (I), (II), (III), ...
    RomanUcParenBoth,
    /// i), ii), iii), ...
    RomanLcParenR,
    /// I), II), III), ...
    RomanUcParenR,
    /// i., ii., iii., ...
    RomanLcPeriod,
    /// I., II., III., ...
    RomanUcPeriod,
    /// Circled number (double-byte plain).
    CircleNumDbPlain,
    /// Circled number (wide black plain).
    CircleNumWdBlackPlain,
    /// Circled number (wide white plain).
    CircleNumWdWhitePlain,
    /// Arabic double-byte with period.
    ArabicDbPeriod,
    /// Arabic double-byte plain.
    ArabicDbPlain,
    /// East Asian CHS with period.
    Ea1ChsPeriod,
    /// East Asian CHS plain.
    Ea1ChsPlain,
    /// East Asian CHT with period.
    Ea1ChtPeriod,
    /// East Asian CHT plain.
    Ea1ChtPlain,
    /// East Asian Japanese/CHS double-byte with period.
    Ea1JpnChsDbPeriod,
    /// East Asian Japanese/Korean plain.
    Ea1JpnKorPlain,
    /// East Asian Japanese/Korean with period.
    Ea1JpnKorPeriod,
    /// Arabic 1 minus.
    Arabic1Minus,
    /// Arabic 2 minus.
    Arabic2Minus,
    /// Hebrew 2 minus.
    Hebrew2Minus,
    /// Thai alphabet with period.
    ThaiAlphaPeriod,
    /// Thai alphabet with right paren.
    ThaiAlphaParenR,
    /// Thai alphabet with both parens.
    ThaiAlphaParenBoth,
    /// Thai number with period.
    ThaiNumPeriod,
    /// Thai number with right paren.
    ThaiNumParenR,
    /// Thai number with both parens.
    ThaiNumParenBoth,
    /// Hindi alphabet with period.
    HindiAlphaPeriod,
    /// Hindi number with period.
    HindiNumPeriod,
    /// Hindi number with right paren.
    HindiNumParenR,
    /// Hindi alpha1 with period.
    HindiAlpha1Period,
}

impl TextAutonumberType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "alphaLcParenBoth" => Self::AlphaLcParenBoth,
            "alphaUcParenBoth" => Self::AlphaUcParenBoth,
            "alphaLcParenR" => Self::AlphaLcParenR,
            "alphaUcParenR" => Self::AlphaUcParenR,
            "alphaLcPeriod" => Self::AlphaLcPeriod,
            "alphaUcPeriod" => Self::AlphaUcPeriod,
            "arabicParenBoth" => Self::ArabicParenBoth,
            "arabicParenR" => Self::ArabicParenR,
            "arabicPeriod" => Self::ArabicPeriod,
            "arabicPlain" => Self::ArabicPlain,
            "romanLcParenBoth" => Self::RomanLcParenBoth,
            "romanUcParenBoth" => Self::RomanUcParenBoth,
            "romanLcParenR" => Self::RomanLcParenR,
            "romanUcParenR" => Self::RomanUcParenR,
            "romanLcPeriod" => Self::RomanLcPeriod,
            "romanUcPeriod" => Self::RomanUcPeriod,
            "circleNumDbPlain" => Self::CircleNumDbPlain,
            "circleNumWdBlackPlain" => Self::CircleNumWdBlackPlain,
            "circleNumWdWhitePlain" => Self::CircleNumWdWhitePlain,
            "arabicDbPeriod" => Self::ArabicDbPeriod,
            "arabicDbPlain" => Self::ArabicDbPlain,
            "ea1ChsPeriod" => Self::Ea1ChsPeriod,
            "ea1ChsPlain" => Self::Ea1ChsPlain,
            "ea1ChtPeriod" => Self::Ea1ChtPeriod,
            "ea1ChtPlain" => Self::Ea1ChtPlain,
            "ea1JpnChsDbPeriod" => Self::Ea1JpnChsDbPeriod,
            "ea1JpnKorPlain" => Self::Ea1JpnKorPlain,
            "ea1JpnKorPeriod" => Self::Ea1JpnKorPeriod,
            "arabic1Minus" => Self::Arabic1Minus,
            "arabic2Minus" => Self::Arabic2Minus,
            "hebrew2Minus" => Self::Hebrew2Minus,
            "thaiAlphaPeriod" => Self::ThaiAlphaPeriod,
            "thaiAlphaParenR" => Self::ThaiAlphaParenR,
            "thaiAlphaParenBoth" => Self::ThaiAlphaParenBoth,
            "thaiNumPeriod" => Self::ThaiNumPeriod,
            "thaiNumParenR" => Self::ThaiNumParenR,
            "thaiNumParenBoth" => Self::ThaiNumParenBoth,
            "hindiAlphaPeriod" => Self::HindiAlphaPeriod,
            "hindiNumPeriod" => Self::HindiNumPeriod,
            "hindiNumParenR" => Self::HindiNumParenR,
            "hindiAlpha1Period" => Self::HindiAlpha1Period,
            _ => Self::ArabicPeriod,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::AlphaLcParenBoth => "alphaLcParenBoth",
            Self::AlphaUcParenBoth => "alphaUcParenBoth",
            Self::AlphaLcParenR => "alphaLcParenR",
            Self::AlphaUcParenR => "alphaUcParenR",
            Self::AlphaLcPeriod => "alphaLcPeriod",
            Self::AlphaUcPeriod => "alphaUcPeriod",
            Self::ArabicParenBoth => "arabicParenBoth",
            Self::ArabicParenR => "arabicParenR",
            Self::ArabicPeriod => "arabicPeriod",
            Self::ArabicPlain => "arabicPlain",
            Self::RomanLcParenBoth => "romanLcParenBoth",
            Self::RomanUcParenBoth => "romanUcParenBoth",
            Self::RomanLcParenR => "romanLcParenR",
            Self::RomanUcParenR => "romanUcParenR",
            Self::RomanLcPeriod => "romanLcPeriod",
            Self::RomanUcPeriod => "romanUcPeriod",
            Self::CircleNumDbPlain => "circleNumDbPlain",
            Self::CircleNumWdBlackPlain => "circleNumWdBlackPlain",
            Self::CircleNumWdWhitePlain => "circleNumWdWhitePlain",
            Self::ArabicDbPeriod => "arabicDbPeriod",
            Self::ArabicDbPlain => "arabicDbPlain",
            Self::Ea1ChsPeriod => "ea1ChsPeriod",
            Self::Ea1ChsPlain => "ea1ChsPlain",
            Self::Ea1ChtPeriod => "ea1ChtPeriod",
            Self::Ea1ChtPlain => "ea1ChtPlain",
            Self::Ea1JpnChsDbPeriod => "ea1JpnChsDbPeriod",
            Self::Ea1JpnKorPlain => "ea1JpnKorPlain",
            Self::Ea1JpnKorPeriod => "ea1JpnKorPeriod",
            Self::Arabic1Minus => "arabic1Minus",
            Self::Arabic2Minus => "arabic2Minus",
            Self::Hebrew2Minus => "hebrew2Minus",
            Self::ThaiAlphaPeriod => "thaiAlphaPeriod",
            Self::ThaiAlphaParenR => "thaiAlphaParenR",
            Self::ThaiAlphaParenBoth => "thaiAlphaParenBoth",
            Self::ThaiNumPeriod => "thaiNumPeriod",
            Self::ThaiNumParenR => "thaiNumParenR",
            Self::ThaiNumParenBoth => "thaiNumParenBoth",
            Self::HindiAlphaPeriod => "hindiAlphaPeriod",
            Self::HindiNumPeriod => "hindiNumPeriod",
            Self::HindiNumParenR => "hindiNumParenR",
            Self::HindiAlpha1Period => "hindiAlpha1Period",
        }
    }
}
