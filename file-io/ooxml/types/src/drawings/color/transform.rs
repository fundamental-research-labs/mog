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
