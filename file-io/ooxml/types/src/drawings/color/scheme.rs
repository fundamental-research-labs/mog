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
