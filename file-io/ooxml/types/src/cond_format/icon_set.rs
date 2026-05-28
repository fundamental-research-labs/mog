use super::{Cfvo, default_true};

// ============================================================================
// IconSetType - Icon set type for conditional formatting
// ============================================================================

/// Icon set type (ST_IconSetType).
///
/// Uses descriptive variant names (ThreeArrows, FourArrows, etc.) with OOXML
/// string conversion to "3Arrows", "4Arrows", etc.
///
/// # Serde
///
/// Serializes to the OOXML attribute token (e.g. `"3Arrows"`, `"5Boxes"`, `"NoIcons"`),
/// matching `to_ooxml` / `from_ooxml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum IconSetType {
    /// 3 traffic lights (default) -- solid
    #[default]
    #[serde(rename = "3TrafficLights1")]
    ThreeTrafficLights1,
    /// 3 arrows (up/side/down)
    #[serde(rename = "3Arrows")]
    ThreeArrows,
    /// 3 arrows gray
    #[serde(rename = "3ArrowsGray")]
    ThreeArrowsGray,
    /// 3 flags
    #[serde(rename = "3Flags")]
    ThreeFlags,
    /// 3 traffic lights with border
    #[serde(rename = "3TrafficLights2")]
    ThreeTrafficLights2,
    /// 3 signs
    #[serde(rename = "3Signs")]
    ThreeSigns,
    /// 3 symbols (circled)
    #[serde(rename = "3Symbols")]
    ThreeSymbols,
    /// 3 symbols (uncircled)
    #[serde(rename = "3Symbols2")]
    ThreeSymbols2,
    /// 4 arrows
    #[serde(rename = "4Arrows")]
    FourArrows,
    /// 4 arrows gray
    #[serde(rename = "4ArrowsGray")]
    FourArrowsGray,
    /// 4 red to black
    #[serde(rename = "4RedToBlack")]
    FourRedToBlack,
    /// 4 rating
    #[serde(rename = "4Rating")]
    FourRating,
    /// 4 traffic lights
    #[serde(rename = "4TrafficLights")]
    FourTrafficLights,
    /// 5 arrows
    #[serde(rename = "5Arrows")]
    FiveArrows,
    /// 5 arrows gray
    #[serde(rename = "5ArrowsGray")]
    FiveArrowsGray,
    /// 5 rating
    #[serde(rename = "5Rating")]
    FiveRating,
    /// 5 quarters
    #[serde(rename = "5Quarters")]
    FiveQuarters,
    /// 3 stars
    #[serde(rename = "3Stars")]
    ThreeStars,
    /// 3 triangles
    #[serde(rename = "3Triangles")]
    ThreeTriangles,
    /// 5 boxes
    #[serde(rename = "5Boxes")]
    FiveBoxes,
    /// No icons (hide icons)
    #[serde(rename = "NoIcons")]
    NoIcons,
}

impl IconSetType {
    /// Strict parse. Returns `None` on any token not in the OOXML spec.
    /// Callers must handle `None` explicitly.
    pub fn from_ooxml_token(s: &str) -> Option<Self> {
        Some(match s {
            "3Arrows" => Self::ThreeArrows,
            "3ArrowsGray" => Self::ThreeArrowsGray,
            "3Flags" => Self::ThreeFlags,
            "3TrafficLights1" => Self::ThreeTrafficLights1,
            "3TrafficLights2" => Self::ThreeTrafficLights2,
            "3Signs" => Self::ThreeSigns,
            "3Symbols" => Self::ThreeSymbols,
            "3Symbols2" => Self::ThreeSymbols2,
            "4Arrows" => Self::FourArrows,
            "4ArrowsGray" => Self::FourArrowsGray,
            "4RedToBlack" => Self::FourRedToBlack,
            "4Rating" => Self::FourRating,
            "4TrafficLights" => Self::FourTrafficLights,
            "5Arrows" => Self::FiveArrows,
            "5ArrowsGray" => Self::FiveArrowsGray,
            "5Rating" => Self::FiveRating,
            "5Quarters" => Self::FiveQuarters,
            "3Stars" => Self::ThreeStars,
            "3Triangles" => Self::ThreeTriangles,
            "5Boxes" => Self::FiveBoxes,
            "NoIcons" => Self::NoIcons,
            _ => return None,
        })
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::ThreeArrows => "3Arrows",
            Self::ThreeArrowsGray => "3ArrowsGray",
            Self::ThreeFlags => "3Flags",
            Self::ThreeTrafficLights1 => "3TrafficLights1",
            Self::ThreeTrafficLights2 => "3TrafficLights2",
            Self::ThreeSigns => "3Signs",
            Self::ThreeSymbols => "3Symbols",
            Self::ThreeSymbols2 => "3Symbols2",
            Self::FourArrows => "4Arrows",
            Self::FourArrowsGray => "4ArrowsGray",
            Self::FourRedToBlack => "4RedToBlack",
            Self::FourRating => "4Rating",
            Self::FourTrafficLights => "4TrafficLights",
            Self::FiveArrows => "5Arrows",
            Self::FiveArrowsGray => "5ArrowsGray",
            Self::FiveRating => "5Rating",
            Self::FiveQuarters => "5Quarters",
            Self::ThreeStars => "3Stars",
            Self::ThreeTriangles => "3Triangles",
            Self::FiveBoxes => "5Boxes",
            Self::NoIcons => "NoIcons",
        }
    }

    /// Get the number of icons in this set.
    pub fn num_icons(&self) -> usize {
        match self {
            Self::ThreeArrows
            | Self::ThreeArrowsGray
            | Self::ThreeFlags
            | Self::ThreeSigns
            | Self::ThreeSymbols
            | Self::ThreeSymbols2
            | Self::ThreeTrafficLights1
            | Self::ThreeTrafficLights2
            | Self::ThreeStars
            | Self::ThreeTriangles => 3,
            Self::FourArrows
            | Self::FourArrowsGray
            | Self::FourRating
            | Self::FourRedToBlack
            | Self::FourTrafficLights => 4,
            Self::FiveArrows
            | Self::FiveArrowsGray
            | Self::FiveQuarters
            | Self::FiveRating
            | Self::FiveBoxes => 5,
            Self::NoIcons => 0,
        }
    }
}
/// Custom icon reference (ECMA-376 CT_CfIcon, Excel 2010+).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CfIcon {
    /// Icon set to source the icon from.
    pub icon_set: IconSetType,
    /// Zero-based icon index within the set.
    pub icon_id: u32,
}

/// Icon set (ECMA-376 CT_IconSet + x14 extensions).
///
/// Displays icons (arrows, flags, traffic lights, etc.) based on cell values.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct IconSet {
    /// Icon set type (default ThreeTrafficLights1).
    #[serde(default)]
    pub icon_set: IconSetType,
    /// Whether to show the cell value alongside the icon (default true).
    #[serde(default = "default_true")]
    pub show_value: bool,
    /// Whether CFVO values are percentages (default true).
    #[serde(default = "default_true")]
    pub percent: bool,
    /// Whether `percent` was explicitly present in source XML.
    #[serde(default)]
    pub percent_attr_present: bool,
    /// Reverse icon order (default false).
    #[serde(default)]
    pub reverse: bool,
    /// 2-5 CFVO thresholds depending on icon set size.
    pub cfvo: Vec<Cfvo>,

    // Excel 2010+ extensions
    /// Whether custom icons are used.
    #[serde(default)]
    pub custom: bool,
    /// Custom icon selections (one per threshold, x14).
    #[serde(default)]
    pub cf_icon: Vec<CfIcon>,
}

impl Default for IconSet {
    fn default() -> Self {
        Self {
            icon_set: IconSetType::default(),
            show_value: true,
            percent: true,
            percent_attr_present: false,
            reverse: false,
            cfvo: Vec::new(),
            custom: false,
            cf_icon: Vec::new(),
        }
    }
}
