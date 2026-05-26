//! Color types for DrawingML (ECMA-376 EG_ColorChoice).

// =============================================================================
// SchemeColor
// =============================================================================

/// Theme / scheme colour name (ECMA-376 ST_SchemeColorVal).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum SchemeColor {
    /// Dark 1 (typically black / near-black).
    #[default]
    Dk1,
    /// Light 1 (typically white / near-white).
    Lt1,
    /// Dark 2.
    Dk2,
    /// Light 2.
    Lt2,
    /// Accent 1.
    Accent1,
    /// Accent 2.
    Accent2,
    /// Accent 3.
    Accent3,
    /// Accent 4.
    Accent4,
    /// Accent 5.
    Accent5,
    /// Accent 6.
    Accent6,
    /// Hyperlink colour.
    Hlink,
    /// Followed hyperlink colour.
    FolHlink,
    /// Background 1 (semantically lt1 in most themes, but distinct scheme value).
    Bg1,
    /// Background 2 (semantically lt2 in most themes).
    Bg2,
    /// Text 1 (semantically dk1 in most themes).
    Tx1,
    /// Text 2 (semantically dk2 in most themes).
    Tx2,
    /// Placeholder color (used in theme style matrices, resolved at runtime).
    PhClr,
}

impl SchemeColor {
    /// Parse from an OOXML `val` attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        match s {
            "dk1" => Some(Self::Dk1),
            "lt1" => Some(Self::Lt1),
            "dk2" => Some(Self::Dk2),
            "lt2" => Some(Self::Lt2),
            "accent1" => Some(Self::Accent1),
            "accent2" => Some(Self::Accent2),
            "accent3" => Some(Self::Accent3),
            "accent4" => Some(Self::Accent4),
            "accent5" => Some(Self::Accent5),
            "accent6" => Some(Self::Accent6),
            "hlink" => Some(Self::Hlink),
            "folHlink" => Some(Self::FolHlink),
            "bg1" => Some(Self::Bg1),
            "bg2" => Some(Self::Bg2),
            "tx1" => Some(Self::Tx1),
            "tx2" => Some(Self::Tx2),
            "phClr" => Some(Self::PhClr),
            _ => None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Dk1 => "dk1",
            Self::Lt1 => "lt1",
            Self::Dk2 => "dk2",
            Self::Lt2 => "lt2",
            Self::Accent1 => "accent1",
            Self::Accent2 => "accent2",
            Self::Accent3 => "accent3",
            Self::Accent4 => "accent4",
            Self::Accent5 => "accent5",
            Self::Accent6 => "accent6",
            Self::Hlink => "hlink",
            Self::FolHlink => "folHlink",
            Self::Bg1 => "bg1",
            Self::Bg2 => "bg2",
            Self::Tx1 => "tx1",
            Self::Tx2 => "tx2",
            Self::PhClr => "phClr",
        }
    }

    /// Convert to the conventional theme colour index (0-based).
    ///
    /// The mapping follows the ECMA-376 convention:
    /// dk1=0, lt1=1, dk2=2, lt2=3, accent1=4, ..., accent6=9, hlink=10, folHlink=11.
    #[must_use]
    pub fn to_theme_index(&self) -> u32 {
        match self {
            Self::Dk1 => 0,
            Self::Lt1 => 1,
            Self::Dk2 => 2,
            Self::Lt2 => 3,
            Self::Accent1 => 4,
            Self::Accent2 => 5,
            Self::Accent3 => 6,
            Self::Accent4 => 7,
            Self::Accent5 => 8,
            Self::Accent6 => 9,
            Self::Hlink => 10,
            Self::FolHlink => 11,
            Self::Bg1 => 1,    // same as Lt1
            Self::Bg2 => 3,    // same as Lt2
            Self::Tx1 => 0,    // same as Dk1
            Self::Tx2 => 2,    // same as Dk2
            Self::PhClr => 12, // placeholder — no standard mapping
        }
    }

    /// Create from a theme colour index (0-based).
    #[must_use]
    pub fn from_theme_index(idx: u32) -> Option<Self> {
        match idx {
            0 => Some(Self::Dk1),
            1 => Some(Self::Lt1),
            2 => Some(Self::Dk2),
            3 => Some(Self::Lt2),
            4 => Some(Self::Accent1),
            5 => Some(Self::Accent2),
            6 => Some(Self::Accent3),
            7 => Some(Self::Accent4),
            8 => Some(Self::Accent5),
            9 => Some(Self::Accent6),
            10 => Some(Self::Hlink),
            11 => Some(Self::FolHlink),
            _ => None,
        }
    }
}

// =============================================================================
// ColorTransform
// =============================================================================

/// Color transform applied to a base color (ECMA-376 EG_ColorTransform).
///
/// Transforms are applied in document order. Multiple transforms can chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum ColorTransform {
    /// Set absolute alpha (0-100000 = 0%-100%).
    Alpha { val: i32 },
    /// Shift alpha by offset (-100000 to 100000).
    AlphaOff { val: i32 },
    /// Multiply alpha by percentage (0-positive).
    AlphaMod { val: i32 },
    /// Set absolute hue (0-21600000, 60000ths of a degree).
    Hue { val: i32 },
    /// Shift hue by angle.
    HueOff { val: i32 },
    /// Multiply hue by percentage.
    HueMod { val: i32 },
    /// Set absolute saturation (0-100000).
    Sat { val: i32 },
    /// Shift saturation.
    SatOff { val: i32 },
    /// Multiply saturation.
    SatMod { val: i32 },
    /// Set absolute luminance (0-100000).
    Lum { val: i32 },
    /// Shift luminance.
    LumOff { val: i32 },
    /// Multiply luminance.
    LumMod { val: i32 },
    /// Set absolute red (0-100000).
    Red { val: i32 },
    /// Shift red.
    RedOff { val: i32 },
    /// Multiply red.
    RedMod { val: i32 },
    /// Set absolute green (0-100000).
    Green { val: i32 },
    /// Shift green.
    GreenOff { val: i32 },
    /// Multiply green.
    GreenMod { val: i32 },
    /// Set absolute blue (0-100000).
    Blue { val: i32 },
    /// Shift blue.
    BlueOff { val: i32 },
    /// Multiply blue.
    BlueMod { val: i32 },
    /// Tint — mix towards white (0-100000).
    Tint { val: i32 },
    /// Shade — mix towards black (0-100000).
    Shade { val: i32 },
    /// Complement — invert hue.
    Comp,
    /// Inverse — invert RGB.
    Inv,
    /// Convert to grayscale.
    Gray,
    /// Apply sRGB gamma.
    Gamma,
    /// Invert sRGB gamma.
    InvGamma,
}

impl ColorTransform {
    /// Parse a color transform element name and value from OOXML.
    #[must_use]
    pub fn from_ooxml(name: &str, val: Option<i32>) -> Option<Self> {
        match name {
            "alpha" => Some(Self::Alpha {
                val: val.unwrap_or(100000),
            }),
            "alphaOff" => Some(Self::AlphaOff {
                val: val.unwrap_or(0),
            }),
            "alphaMod" => Some(Self::AlphaMod {
                val: val.unwrap_or(100000),
            }),
            "hue" => Some(Self::Hue {
                val: val.unwrap_or(0),
            }),
            "hueOff" => Some(Self::HueOff {
                val: val.unwrap_or(0),
            }),
            "hueMod" => Some(Self::HueMod {
                val: val.unwrap_or(100000),
            }),
            "sat" => Some(Self::Sat {
                val: val.unwrap_or(100000),
            }),
            "satOff" => Some(Self::SatOff {
                val: val.unwrap_or(0),
            }),
            "satMod" => Some(Self::SatMod {
                val: val.unwrap_or(100000),
            }),
            "lum" => Some(Self::Lum {
                val: val.unwrap_or(100000),
            }),
            "lumOff" => Some(Self::LumOff {
                val: val.unwrap_or(0),
            }),
            "lumMod" => Some(Self::LumMod {
                val: val.unwrap_or(100000),
            }),
            "red" => Some(Self::Red {
                val: val.unwrap_or(0),
            }),
            "redOff" => Some(Self::RedOff {
                val: val.unwrap_or(0),
            }),
            "redMod" => Some(Self::RedMod {
                val: val.unwrap_or(100000),
            }),
            "green" => Some(Self::Green {
                val: val.unwrap_or(0),
            }),
            "greenOff" => Some(Self::GreenOff {
                val: val.unwrap_or(0),
            }),
            "greenMod" => Some(Self::GreenMod {
                val: val.unwrap_or(100000),
            }),
            "blue" => Some(Self::Blue {
                val: val.unwrap_or(0),
            }),
            "blueOff" => Some(Self::BlueOff {
                val: val.unwrap_or(0),
            }),
            "blueMod" => Some(Self::BlueMod {
                val: val.unwrap_or(100000),
            }),
            "tint" => Some(Self::Tint {
                val: val.unwrap_or(100000),
            }),
            "shade" => Some(Self::Shade {
                val: val.unwrap_or(100000),
            }),
            "comp" => Some(Self::Comp),
            "inv" => Some(Self::Inv),
            "gray" => Some(Self::Gray),
            "gamma" => Some(Self::Gamma),
            "invGamma" => Some(Self::InvGamma),
            _ => None,
        }
    }

    /// Return the OOXML element name for this transform.
    #[must_use]
    pub fn to_ooxml_name(&self) -> &'static str {
        match self {
            Self::Alpha { .. } => "alpha",
            Self::AlphaOff { .. } => "alphaOff",
            Self::AlphaMod { .. } => "alphaMod",
            Self::Hue { .. } => "hue",
            Self::HueOff { .. } => "hueOff",
            Self::HueMod { .. } => "hueMod",
            Self::Sat { .. } => "sat",
            Self::SatOff { .. } => "satOff",
            Self::SatMod { .. } => "satMod",
            Self::Lum { .. } => "lum",
            Self::LumOff { .. } => "lumOff",
            Self::LumMod { .. } => "lumMod",
            Self::Red { .. } => "red",
            Self::RedOff { .. } => "redOff",
            Self::RedMod { .. } => "redMod",
            Self::Green { .. } => "green",
            Self::GreenOff { .. } => "greenOff",
            Self::GreenMod { .. } => "greenMod",
            Self::Blue { .. } => "blue",
            Self::BlueOff { .. } => "blueOff",
            Self::BlueMod { .. } => "blueMod",
            Self::Tint { .. } => "tint",
            Self::Shade { .. } => "shade",
            Self::Comp => "comp",
            Self::Inv => "inv",
            Self::Gray => "gray",
            Self::Gamma => "gamma",
            Self::InvGamma => "invGamma",
        }
    }

    /// Return the value for this transform, if it has one.
    #[must_use]
    pub fn val(&self) -> Option<i32> {
        match self {
            Self::Alpha { val }
            | Self::AlphaOff { val }
            | Self::AlphaMod { val }
            | Self::Hue { val }
            | Self::HueOff { val }
            | Self::HueMod { val }
            | Self::Sat { val }
            | Self::SatOff { val }
            | Self::SatMod { val }
            | Self::Lum { val }
            | Self::LumOff { val }
            | Self::LumMod { val }
            | Self::Red { val }
            | Self::RedOff { val }
            | Self::RedMod { val }
            | Self::Green { val }
            | Self::GreenOff { val }
            | Self::GreenMod { val }
            | Self::Blue { val }
            | Self::BlueOff { val }
            | Self::BlueMod { val }
            | Self::Tint { val }
            | Self::Shade { val } => Some(*val),
            Self::Comp | Self::Inv | Self::Gray | Self::Gamma | Self::InvGamma => None,
        }
    }
}

// =============================================================================
// SystemColorVal
// =============================================================================

/// System color value (ECMA-376 ST_SystemColorVal).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum SystemColorVal {
    ScrollBar,
    Background,
    ActiveCaption,
    InactiveCaption,
    Menu,
    Window,
    WindowFrame,
    MenuText,
    WindowText,
    CaptionText,
    ActiveBorder,
    InactiveBorder,
    AppWorkspace,
    Highlight,
    HighlightText,
    BtnFace,
    BtnShadow,
    GrayText,
    BtnText,
    InactiveCaptionText,
    BtnHighlight,
    ThreeDDkShadow,
    ThreeDLight,
    InfoText,
    InfoBk,
    HotLight,
    GradientActiveCaption,
    GradientInactiveCaption,
    MenuHighlight,
    MenuBar,
}

impl SystemColorVal {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "scrollBar" => Self::ScrollBar,
            "background" => Self::Background,
            "activeCaption" => Self::ActiveCaption,
            "inactiveCaption" => Self::InactiveCaption,
            "menu" => Self::Menu,
            "window" => Self::Window,
            "windowFrame" => Self::WindowFrame,
            "menuText" => Self::MenuText,
            "windowText" => Self::WindowText,
            "captionText" => Self::CaptionText,
            "activeBorder" => Self::ActiveBorder,
            "inactiveBorder" => Self::InactiveBorder,
            "appWorkspace" => Self::AppWorkspace,
            "highlight" => Self::Highlight,
            "highlightText" => Self::HighlightText,
            "btnFace" => Self::BtnFace,
            "btnShadow" => Self::BtnShadow,
            "grayText" => Self::GrayText,
            "btnText" => Self::BtnText,
            "inactiveCaptionText" => Self::InactiveCaptionText,
            "btnHighlight" => Self::BtnHighlight,
            "3dDkShadow" => Self::ThreeDDkShadow,
            "3dLight" => Self::ThreeDLight,
            "infoText" => Self::InfoText,
            "infoBk" => Self::InfoBk,
            "hotLight" => Self::HotLight,
            "gradientActiveCaption" => Self::GradientActiveCaption,
            "gradientInactiveCaption" => Self::GradientInactiveCaption,
            "menuHighlight" => Self::MenuHighlight,
            "menuBar" => Self::MenuBar,
            _ => Self::Window, // safe default
        }
    }

    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::ScrollBar => "scrollBar",
            Self::Background => "background",
            Self::ActiveCaption => "activeCaption",
            Self::InactiveCaption => "inactiveCaption",
            Self::Menu => "menu",
            Self::Window => "window",
            Self::WindowFrame => "windowFrame",
            Self::MenuText => "menuText",
            Self::WindowText => "windowText",
            Self::CaptionText => "captionText",
            Self::ActiveBorder => "activeBorder",
            Self::InactiveBorder => "inactiveBorder",
            Self::AppWorkspace => "appWorkspace",
            Self::Highlight => "highlight",
            Self::HighlightText => "highlightText",
            Self::BtnFace => "btnFace",
            Self::BtnShadow => "btnShadow",
            Self::GrayText => "grayText",
            Self::BtnText => "btnText",
            Self::InactiveCaptionText => "inactiveCaptionText",
            Self::BtnHighlight => "btnHighlight",
            Self::ThreeDDkShadow => "3dDkShadow",
            Self::ThreeDLight => "3dLight",
            Self::InfoText => "infoText",
            Self::InfoBk => "infoBk",
            Self::HotLight => "hotLight",
            Self::GradientActiveCaption => "gradientActiveCaption",
            Self::GradientInactiveCaption => "gradientInactiveCaption",
            Self::MenuHighlight => "menuHighlight",
            Self::MenuBar => "menuBar",
        }
    }
}

// =============================================================================
// PresetColorVal
// =============================================================================

/// Preset color value (ECMA-376 ST_PresetColorVal).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum PresetColorVal {
    AliceBlue,
    AntiqueWhite,
    Aqua,
    Aquamarine,
    Azure,
    Beige,
    Bisque,
    Black,
    BlanchedAlmond,
    Blue,
    BlueViolet,
    Brown,
    BurlyWood,
    CadetBlue,
    Chartreuse,
    Chocolate,
    Coral,
    CornflowerBlue,
    Cornsilk,
    Crimson,
    Cyan,
    DkBlue,
    DkCyan,
    DkGoldenrod,
    DkGray,
    DkGreen,
    DkKhaki,
    DkMagenta,
    DkOliveGreen,
    DkOrange,
    DkOrchid,
    DkRed,
    DkSalmon,
    DkSeaGreen,
    DkSlateBlue,
    DkSlateGray,
    DkTurquoise,
    DkViolet,
    DeepPink,
    DeepSkyBlue,
    DimGray,
    DodgerBlue,
    Firebrick,
    FloralWhite,
    ForestGreen,
    Fuchsia,
    Gainsboro,
    GhostWhite,
    Gold,
    Goldenrod,
    Gray,
    Green,
    GreenYellow,
    Honeydew,
    HotPink,
    IndianRed,
    Indigo,
    Ivory,
    Khaki,
    Lavender,
    LavenderBlush,
    LawnGreen,
    LemonChiffon,
    LtBlue,
    LtCoral,
    LtCyan,
    LtGoldenrodYellow,
    LtGray,
    LtGreen,
    LtPink,
    LtSalmon,
    LtSeaGreen,
    LtSkyBlue,
    LtSlateGray,
    LtSteelBlue,
    LtYellow,
    Lime,
    LimeGreen,
    Linen,
    Magenta,
    Maroon,
    MedAquamarine,
    MedBlue,
    MedOrchid,
    MedPurple,
    MedSeaGreen,
    MedSlateBlue,
    MedSpringGreen,
    MedTurquoise,
    MedVioletRed,
    MidnightBlue,
    MintCream,
    MistyRose,
    Moccasin,
    NavajoWhite,
    Navy,
    OldLace,
    Olive,
    OliveDrab,
    Orange,
    OrangeRed,
    Orchid,
    PaleGoldenrod,
    PaleGreen,
    PaleTurquoise,
    PaleVioletRed,
    PapayaWhip,
    PeachPuff,
    Peru,
    Pink,
    Plum,
    PowderBlue,
    Purple,
    Red,
    RosyBrown,
    RoyalBlue,
    SaddleBrown,
    Salmon,
    SandyBrown,
    SeaGreen,
    SeaShell,
    Sienna,
    Silver,
    SkyBlue,
    SlateBlue,
    SlateGray,
    Snow,
    SpringGreen,
    SteelBlue,
    Tan,
    Teal,
    Thistle,
    Tomato,
    Turquoise,
    Violet,
    Wheat,
    White,
    WhiteSmoke,
    Yellow,
    YellowGreen,
}

impl PresetColorVal {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "aliceBlue" => Self::AliceBlue,
            "antiqueWhite" => Self::AntiqueWhite,
            "aqua" => Self::Aqua,
            "aquamarine" => Self::Aquamarine,
            "azure" => Self::Azure,
            "beige" => Self::Beige,
            "bisque" => Self::Bisque,
            "black" => Self::Black,
            "blanchedAlmond" => Self::BlanchedAlmond,
            "blue" => Self::Blue,
            "blueViolet" => Self::BlueViolet,
            "brown" => Self::Brown,
            "burlyWood" => Self::BurlyWood,
            "cadetBlue" => Self::CadetBlue,
            "chartreuse" => Self::Chartreuse,
            "chocolate" => Self::Chocolate,
            "coral" => Self::Coral,
            "cornflowerBlue" => Self::CornflowerBlue,
            "cornsilk" => Self::Cornsilk,
            "crimson" => Self::Crimson,
            "cyan" => Self::Cyan,
            "dkBlue" => Self::DkBlue,
            "dkCyan" => Self::DkCyan,
            "dkGoldenrod" => Self::DkGoldenrod,
            "dkGray" => Self::DkGray,
            "dkGreen" => Self::DkGreen,
            "dkKhaki" => Self::DkKhaki,
            "dkMagenta" => Self::DkMagenta,
            "dkOliveGreen" => Self::DkOliveGreen,
            "dkOrange" => Self::DkOrange,
            "dkOrchid" => Self::DkOrchid,
            "dkRed" => Self::DkRed,
            "dkSalmon" => Self::DkSalmon,
            "dkSeaGreen" => Self::DkSeaGreen,
            "dkSlateBlue" => Self::DkSlateBlue,
            "dkSlateGray" => Self::DkSlateGray,
            "dkTurquoise" => Self::DkTurquoise,
            "dkViolet" => Self::DkViolet,
            "deepPink" => Self::DeepPink,
            "deepSkyBlue" => Self::DeepSkyBlue,
            "dimGray" => Self::DimGray,
            "dodgerBlue" => Self::DodgerBlue,
            "firebrick" => Self::Firebrick,
            "floralWhite" => Self::FloralWhite,
            "forestGreen" => Self::ForestGreen,
            "fuchsia" => Self::Fuchsia,
            "gainsboro" => Self::Gainsboro,
            "ghostWhite" => Self::GhostWhite,
            "gold" => Self::Gold,
            "goldenrod" => Self::Goldenrod,
            "gray" => Self::Gray,
            "green" => Self::Green,
            "greenYellow" => Self::GreenYellow,
            "honeydew" => Self::Honeydew,
            "hotPink" => Self::HotPink,
            "indianRed" => Self::IndianRed,
            "indigo" => Self::Indigo,
            "ivory" => Self::Ivory,
            "khaki" => Self::Khaki,
            "lavender" => Self::Lavender,
            "lavenderBlush" => Self::LavenderBlush,
            "lawnGreen" => Self::LawnGreen,
            "lemonChiffon" => Self::LemonChiffon,
            "ltBlue" => Self::LtBlue,
            "ltCoral" => Self::LtCoral,
            "ltCyan" => Self::LtCyan,
            "ltGoldenrodYellow" => Self::LtGoldenrodYellow,
            "ltGray" => Self::LtGray,
            "ltGreen" => Self::LtGreen,
            "ltPink" => Self::LtPink,
            "ltSalmon" => Self::LtSalmon,
            "ltSeaGreen" => Self::LtSeaGreen,
            "ltSkyBlue" => Self::LtSkyBlue,
            "ltSlateGray" => Self::LtSlateGray,
            "ltSteelBlue" => Self::LtSteelBlue,
            "ltYellow" => Self::LtYellow,
            "lime" => Self::Lime,
            "limeGreen" => Self::LimeGreen,
            "linen" => Self::Linen,
            "magenta" => Self::Magenta,
            "maroon" => Self::Maroon,
            "medAquamarine" => Self::MedAquamarine,
            "medBlue" => Self::MedBlue,
            "medOrchid" => Self::MedOrchid,
            "medPurple" => Self::MedPurple,
            "medSeaGreen" => Self::MedSeaGreen,
            "medSlateBlue" => Self::MedSlateBlue,
            "medSpringGreen" => Self::MedSpringGreen,
            "medTurquoise" => Self::MedTurquoise,
            "medVioletRed" => Self::MedVioletRed,
            "midnightBlue" => Self::MidnightBlue,
            "mintCream" => Self::MintCream,
            "mistyRose" => Self::MistyRose,
            "moccasin" => Self::Moccasin,
            "navajoWhite" => Self::NavajoWhite,
            "navy" => Self::Navy,
            "oldLace" => Self::OldLace,
            "olive" => Self::Olive,
            "oliveDrab" => Self::OliveDrab,
            "orange" => Self::Orange,
            "orangeRed" => Self::OrangeRed,
            "orchid" => Self::Orchid,
            "paleGoldenrod" => Self::PaleGoldenrod,
            "paleGreen" => Self::PaleGreen,
            "paleTurquoise" => Self::PaleTurquoise,
            "paleVioletRed" => Self::PaleVioletRed,
            "papayaWhip" => Self::PapayaWhip,
            "peachPuff" => Self::PeachPuff,
            "peru" => Self::Peru,
            "pink" => Self::Pink,
            "plum" => Self::Plum,
            "powderBlue" => Self::PowderBlue,
            "purple" => Self::Purple,
            "red" => Self::Red,
            "rosyBrown" => Self::RosyBrown,
            "royalBlue" => Self::RoyalBlue,
            "saddleBrown" => Self::SaddleBrown,
            "salmon" => Self::Salmon,
            "sandyBrown" => Self::SandyBrown,
            "seaGreen" => Self::SeaGreen,
            "seaShell" => Self::SeaShell,
            "sienna" => Self::Sienna,
            "silver" => Self::Silver,
            "skyBlue" => Self::SkyBlue,
            "slateBlue" => Self::SlateBlue,
            "slateGray" => Self::SlateGray,
            "snow" => Self::Snow,
            "springGreen" => Self::SpringGreen,
            "steelBlue" => Self::SteelBlue,
            "tan" => Self::Tan,
            "teal" => Self::Teal,
            "thistle" => Self::Thistle,
            "tomato" => Self::Tomato,
            "turquoise" => Self::Turquoise,
            "violet" => Self::Violet,
            "wheat" => Self::Wheat,
            "white" => Self::White,
            "whiteSmoke" => Self::WhiteSmoke,
            "yellow" => Self::Yellow,
            "yellowGreen" => Self::YellowGreen,

            // -----------------------------------------------------------------
            // ECMA-376 ST_PresetColorVal long-form aliases (dark*, light*, medium*)
            // These are separate enumeration values in the spec that map to the
            // same color as their abbreviated counterparts. We always write the
            // abbreviated form (see `to_ooxml`), but must accept both on read.
            // -----------------------------------------------------------------

            // dark* → Dk*
            "darkBlue" => Self::DkBlue,
            "darkCyan" => Self::DkCyan,
            "darkGoldenrod" => Self::DkGoldenrod,
            "darkGray" => Self::DkGray,
            "darkGreen" => Self::DkGreen,
            "darkKhaki" => Self::DkKhaki,
            "darkMagenta" => Self::DkMagenta,
            "darkOliveGreen" => Self::DkOliveGreen,
            "darkOrange" => Self::DkOrange,
            "darkOrchid" => Self::DkOrchid,
            "darkRed" => Self::DkRed,
            "darkSalmon" => Self::DkSalmon,
            "darkSeaGreen" => Self::DkSeaGreen,
            "darkSlateBlue" => Self::DkSlateBlue,
            "darkSlateGray" => Self::DkSlateGray,
            "darkTurquoise" => Self::DkTurquoise,
            "darkViolet" => Self::DkViolet,

            // light* → Lt*
            "lightBlue" => Self::LtBlue,
            "lightCoral" => Self::LtCoral,
            "lightCyan" => Self::LtCyan,
            "lightGoldenrodYellow" => Self::LtGoldenrodYellow,
            "lightGray" => Self::LtGray,
            "lightGreen" => Self::LtGreen,
            "lightPink" => Self::LtPink,
            "lightSalmon" => Self::LtSalmon,
            "lightSeaGreen" => Self::LtSeaGreen,
            "lightSkyBlue" => Self::LtSkyBlue,
            "lightSlateGray" => Self::LtSlateGray,
            "lightSteelBlue" => Self::LtSteelBlue,
            "lightYellow" => Self::LtYellow,

            // medium* → Med*
            "mediumAquamarine" => Self::MedAquamarine,
            "mediumBlue" => Self::MedBlue,
            "mediumOrchid" => Self::MedOrchid,
            "mediumPurple" => Self::MedPurple,
            "mediumSeaGreen" => Self::MedSeaGreen,
            "mediumSlateBlue" => Self::MedSlateBlue,
            "mediumSpringGreen" => Self::MedSpringGreen,
            "mediumTurquoise" => Self::MedTurquoise,
            "mediumVioletRed" => Self::MedVioletRed,

            // -----------------------------------------------------------------
            // Grey spelling variants (British spelling accepted by the spec)
            // -----------------------------------------------------------------

            // Abbreviated grey forms
            "grey" => Self::Gray,
            "dimGrey" => Self::DimGray,
            "dkGrey" => Self::DkGray,
            "dkSlateGrey" => Self::DkSlateGray,
            "ltGrey" => Self::LtGray,
            "ltSlateGrey" => Self::LtSlateGray,
            "slateGrey" => Self::SlateGray,

            // Long-form grey variants
            "darkGrey" => Self::DkGray,
            "darkSlateGrey" => Self::DkSlateGray,
            "lightGrey" => Self::LtGray,
            "lightSlateGrey" => Self::LtSlateGray,

            _ => Self::Black, // safe default
        }
    }

    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::AliceBlue => "aliceBlue",
            Self::AntiqueWhite => "antiqueWhite",
            Self::Aqua => "aqua",
            Self::Aquamarine => "aquamarine",
            Self::Azure => "azure",
            Self::Beige => "beige",
            Self::Bisque => "bisque",
            Self::Black => "black",
            Self::BlanchedAlmond => "blanchedAlmond",
            Self::Blue => "blue",
            Self::BlueViolet => "blueViolet",
            Self::Brown => "brown",
            Self::BurlyWood => "burlyWood",
            Self::CadetBlue => "cadetBlue",
            Self::Chartreuse => "chartreuse",
            Self::Chocolate => "chocolate",
            Self::Coral => "coral",
            Self::CornflowerBlue => "cornflowerBlue",
            Self::Cornsilk => "cornsilk",
            Self::Crimson => "crimson",
            Self::Cyan => "cyan",
            Self::DkBlue => "dkBlue",
            Self::DkCyan => "dkCyan",
            Self::DkGoldenrod => "dkGoldenrod",
            Self::DkGray => "dkGray",
            Self::DkGreen => "dkGreen",
            Self::DkKhaki => "dkKhaki",
            Self::DkMagenta => "dkMagenta",
            Self::DkOliveGreen => "dkOliveGreen",
            Self::DkOrange => "dkOrange",
            Self::DkOrchid => "dkOrchid",
            Self::DkRed => "dkRed",
            Self::DkSalmon => "dkSalmon",
            Self::DkSeaGreen => "dkSeaGreen",
            Self::DkSlateBlue => "dkSlateBlue",
            Self::DkSlateGray => "dkSlateGray",
            Self::DkTurquoise => "dkTurquoise",
            Self::DkViolet => "dkViolet",
            Self::DeepPink => "deepPink",
            Self::DeepSkyBlue => "deepSkyBlue",
            Self::DimGray => "dimGray",
            Self::DodgerBlue => "dodgerBlue",
            Self::Firebrick => "firebrick",
            Self::FloralWhite => "floralWhite",
            Self::ForestGreen => "forestGreen",
            Self::Fuchsia => "fuchsia",
            Self::Gainsboro => "gainsboro",
            Self::GhostWhite => "ghostWhite",
            Self::Gold => "gold",
            Self::Goldenrod => "goldenrod",
            Self::Gray => "gray",
            Self::Green => "green",
            Self::GreenYellow => "greenYellow",
            Self::Honeydew => "honeydew",
            Self::HotPink => "hotPink",
            Self::IndianRed => "indianRed",
            Self::Indigo => "indigo",
            Self::Ivory => "ivory",
            Self::Khaki => "khaki",
            Self::Lavender => "lavender",
            Self::LavenderBlush => "lavenderBlush",
            Self::LawnGreen => "lawnGreen",
            Self::LemonChiffon => "lemonChiffon",
            Self::LtBlue => "ltBlue",
            Self::LtCoral => "ltCoral",
            Self::LtCyan => "ltCyan",
            Self::LtGoldenrodYellow => "ltGoldenrodYellow",
            Self::LtGray => "ltGray",
            Self::LtGreen => "ltGreen",
            Self::LtPink => "ltPink",
            Self::LtSalmon => "ltSalmon",
            Self::LtSeaGreen => "ltSeaGreen",
            Self::LtSkyBlue => "ltSkyBlue",
            Self::LtSlateGray => "ltSlateGray",
            Self::LtSteelBlue => "ltSteelBlue",
            Self::LtYellow => "ltYellow",
            Self::Lime => "lime",
            Self::LimeGreen => "limeGreen",
            Self::Linen => "linen",
            Self::Magenta => "magenta",
            Self::Maroon => "maroon",
            Self::MedAquamarine => "medAquamarine",
            Self::MedBlue => "medBlue",
            Self::MedOrchid => "medOrchid",
            Self::MedPurple => "medPurple",
            Self::MedSeaGreen => "medSeaGreen",
            Self::MedSlateBlue => "medSlateBlue",
            Self::MedSpringGreen => "medSpringGreen",
            Self::MedTurquoise => "medTurquoise",
            Self::MedVioletRed => "medVioletRed",
            Self::MidnightBlue => "midnightBlue",
            Self::MintCream => "mintCream",
            Self::MistyRose => "mistyRose",
            Self::Moccasin => "moccasin",
            Self::NavajoWhite => "navajoWhite",
            Self::Navy => "navy",
            Self::OldLace => "oldLace",
            Self::Olive => "olive",
            Self::OliveDrab => "oliveDrab",
            Self::Orange => "orange",
            Self::OrangeRed => "orangeRed",
            Self::Orchid => "orchid",
            Self::PaleGoldenrod => "paleGoldenrod",
            Self::PaleGreen => "paleGreen",
            Self::PaleTurquoise => "paleTurquoise",
            Self::PaleVioletRed => "paleVioletRed",
            Self::PapayaWhip => "papayaWhip",
            Self::PeachPuff => "peachPuff",
            Self::Peru => "peru",
            Self::Pink => "pink",
            Self::Plum => "plum",
            Self::PowderBlue => "powderBlue",
            Self::Purple => "purple",
            Self::Red => "red",
            Self::RosyBrown => "rosyBrown",
            Self::RoyalBlue => "royalBlue",
            Self::SaddleBrown => "saddleBrown",
            Self::Salmon => "salmon",
            Self::SandyBrown => "sandyBrown",
            Self::SeaGreen => "seaGreen",
            Self::SeaShell => "seaShell",
            Self::Sienna => "sienna",
            Self::Silver => "silver",
            Self::SkyBlue => "skyBlue",
            Self::SlateBlue => "slateBlue",
            Self::SlateGray => "slateGray",
            Self::Snow => "snow",
            Self::SpringGreen => "springGreen",
            Self::SteelBlue => "steelBlue",
            Self::Tan => "tan",
            Self::Teal => "teal",
            Self::Thistle => "thistle",
            Self::Tomato => "tomato",
            Self::Turquoise => "turquoise",
            Self::Violet => "violet",
            Self::Wheat => "wheat",
            Self::White => "white",
            Self::WhiteSmoke => "whiteSmoke",
            Self::Yellow => "yellow",
            Self::YellowGreen => "yellowGreen",
        }
    }
}

// =============================================================================
// DrawingColor
// =============================================================================

/// Unified color specification (ECMA-376 EG_ColorChoice + EG_ColorTransform).
///
/// Every DrawingML color is one of 6 base types, optionally followed by
/// a chain of transforms applied in document order.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum DrawingColor {
    /// sRGB color (e.g., val="FF0000").
    SrgbClr {
        val: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// Theme/scheme color (e.g., val="accent1").
    SchemeClr {
        val: SchemeColor,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// HSL color.
    HslClr {
        hue: i32,
        sat: i32,
        lum: i32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// System color (e.g., val="windowText").
    SysClr {
        val: SystemColorVal,
        /// Last computed color (sRGB hex), provided by producing application.
        last_clr: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// Preset named color (e.g., val="red").
    PrstClr {
        val: PresetColorVal,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
    /// scRGB color (linear RGB, percentages).
    ScrgbClr {
        r: i32,
        g: i32,
        b: i32,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        transforms: Vec<ColorTransform>,
    },
}

impl Default for DrawingColor {
    fn default() -> Self {
        Self::SrgbClr {
            val: String::new(),
            transforms: Vec::new(),
        }
    }
}
