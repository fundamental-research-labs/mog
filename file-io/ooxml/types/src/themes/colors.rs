use crate::drawings::{DrawingColor, ExtensionList, SystemColorVal};

// =============================================================================
// Color Scheme
// =============================================================================

/// Theme color scheme with 12 named color slots (ECMA-376 CT_ColorScheme).
///
/// Each color slot holds a `DrawingColor` (EG_ColorChoice). In real Office themes,
/// dk1 and lt1 are typically system colors (`SysClr`), while the rest are sRGB colors.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorScheme {
    /// Scheme name (e.g., "Office")
    pub name: String,
    /// Dark 1 — primary dark color (usually black for text)
    pub dk1: DrawingColor,
    /// Light 1 — primary light color (usually white for background)
    pub lt1: DrawingColor,
    /// Dark 2 — secondary dark color
    pub dk2: DrawingColor,
    /// Light 2 — secondary light color
    pub lt2: DrawingColor,
    /// Accent color 1 (primary accent)
    pub accent1: DrawingColor,
    /// Accent color 2
    pub accent2: DrawingColor,
    /// Accent color 3
    pub accent3: DrawingColor,
    /// Accent color 4
    pub accent4: DrawingColor,
    /// Accent color 5
    pub accent5: DrawingColor,
    /// Accent color 6
    pub accent6: DrawingColor,
    /// Hyperlink color
    pub hlink: DrawingColor,
    /// Followed hyperlink color
    pub fol_hlink: DrawingColor,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

impl Default for ColorScheme {
    fn default() -> Self {
        Self::office_default()
    }
}

impl ColorScheme {
    /// Create the default Office color scheme (Office 2016+).
    ///
    /// dk1 and lt1 use system colors (windowText / window) as real Office themes do.
    /// All other slots use sRGB hex colors.
    pub fn office_default() -> Self {
        Self {
            name: "Office".to_string(),
            dk1: DrawingColor::SysClr {
                val: SystemColorVal::WindowText,
                last_clr: Some("000000".to_string()),
                transforms: vec![],
            },
            lt1: DrawingColor::SysClr {
                val: SystemColorVal::Window,
                last_clr: Some("FFFFFF".to_string()),
                transforms: vec![],
            },
            dk2: DrawingColor::SrgbClr {
                val: "44546A".to_string(),
                transforms: vec![],
            },
            lt2: DrawingColor::SrgbClr {
                val: "E7E6E6".to_string(),
                transforms: vec![],
            },
            accent1: DrawingColor::SrgbClr {
                val: "4472C4".to_string(),
                transforms: vec![],
            },
            accent2: DrawingColor::SrgbClr {
                val: "ED7D31".to_string(),
                transforms: vec![],
            },
            accent3: DrawingColor::SrgbClr {
                val: "A5A5A5".to_string(),
                transforms: vec![],
            },
            accent4: DrawingColor::SrgbClr {
                val: "FFC000".to_string(),
                transforms: vec![],
            },
            accent5: DrawingColor::SrgbClr {
                val: "5B9BD5".to_string(),
                transforms: vec![],
            },
            accent6: DrawingColor::SrgbClr {
                val: "70AD47".to_string(),
                transforms: vec![],
            },
            hlink: DrawingColor::SrgbClr {
                val: "0563C1".to_string(),
                transforms: vec![],
            },
            fol_hlink: DrawingColor::SrgbClr {
                val: "954F72".to_string(),
                transforms: vec![],
            },
            ext_lst: None,
        }
    }

    /// Get a color by theme index (0-11).
    ///
    /// Index mapping follows ECMA-376 clrScheme element order:
    /// 0=dk1, 1=lt1, 2=dk2, 3=lt2, 4-9=accent1-6, 10=hlink, 11=folHlink
    pub fn get_by_index(&self, index: u8) -> Option<&DrawingColor> {
        match index {
            0 => Some(&self.dk1),
            1 => Some(&self.lt1),
            2 => Some(&self.dk2),
            3 => Some(&self.lt2),
            4 => Some(&self.accent1),
            5 => Some(&self.accent2),
            6 => Some(&self.accent3),
            7 => Some(&self.accent4),
            8 => Some(&self.accent5),
            9 => Some(&self.accent6),
            10 => Some(&self.hlink),
            11 => Some(&self.fol_hlink),
            _ => None,
        }
    }

    /// Set a color by theme index (0-11).
    pub fn set_by_index(&mut self, index: u8, color: DrawingColor) {
        match index {
            0 => self.dk1 = color,
            1 => self.lt1 = color,
            2 => self.dk2 = color,
            3 => self.lt2 = color,
            4 => self.accent1 = color,
            5 => self.accent2 = color,
            6 => self.accent3 = color,
            7 => self.accent4 = color,
            8 => self.accent5 = color,
            9 => self.accent6 = color,
            10 => self.hlink = color,
            11 => self.fol_hlink = color,
            _ => {}
        }
    }

    /// Resolve a color slot to a hex RGB string (6 chars, e.g. "4472C4").
    ///
    /// For `SrgbClr`, returns the `val` directly.
    /// For `SysClr`, returns the `last_clr` if available.
    /// For other color types, returns `None` (would need full color resolution).
    pub fn resolve_hex(&self, index: u8) -> Option<String> {
        let color = self.get_by_index(index)?;
        match color {
            DrawingColor::SrgbClr { val, .. } => Some(val.clone()),
            DrawingColor::SysClr { last_clr, .. } => last_clr.clone(),
            _ => None,
        }
    }
}

// =============================================================================
// ST_ColorSchemeIndex
// =============================================================================

/// String-token enum for color mapping attributes (ECMA-376 ST_ColorSchemeIndex).
///
/// Used in `CT_ColorMapping` to map logical slots to scheme color indices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ColorSchemeIndex {
    Dk1,
    Lt1,
    Dk2,
    Lt2,
    Accent1,
    Accent2,
    Accent3,
    Accent4,
    Accent5,
    Accent6,
    Hlink,
    FolHlink,
}

impl ColorSchemeIndex {
    /// Parse from OOXML attribute value.
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
            _ => None,
        }
    }

    /// Convert to OOXML attribute value.
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
        }
    }
}

// =============================================================================
// Theme Color Index
// =============================================================================

/// Theme color indices (0-11) for the 12 standard Office theme colors.
///
/// Order matches ECMA-376 clrScheme element order and `SchemeColor::to_theme_index()`:
/// Dk1=0, Lt1=1, Dk2=2, Lt2=3, Accent1-6=4-9, Hyperlink=10, FollowedHyperlink=11.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum ThemeColorIndex {
    /// Dark 1 — Text 1 (usually black)
    Dark1 = 0,
    /// Light 1 — Background 1 (usually white)
    Light1 = 1,
    /// Dark 2 — Text 2
    Dark2 = 2,
    /// Light 2 — Background 2
    Light2 = 3,
    /// Accent color 1 (primary accent)
    Accent1 = 4,
    /// Accent color 2
    Accent2 = 5,
    /// Accent color 3
    Accent3 = 6,
    /// Accent color 4
    Accent4 = 7,
    /// Accent color 5
    Accent5 = 8,
    /// Accent color 6
    Accent6 = 9,
    /// Hyperlink color
    Hyperlink = 10,
    /// Followed hyperlink color
    FollowedHyperlink = 11,
}

impl ThemeColorIndex {
    /// Get all theme color indices in spec order.
    pub fn all() -> [ThemeColorIndex; 12] {
        [
            ThemeColorIndex::Dark1,
            ThemeColorIndex::Light1,
            ThemeColorIndex::Dark2,
            ThemeColorIndex::Light2,
            ThemeColorIndex::Accent1,
            ThemeColorIndex::Accent2,
            ThemeColorIndex::Accent3,
            ThemeColorIndex::Accent4,
            ThemeColorIndex::Accent5,
            ThemeColorIndex::Accent6,
            ThemeColorIndex::Hyperlink,
            ThemeColorIndex::FollowedHyperlink,
        ]
    }

    /// Convert to theme index (0-11).
    pub fn as_index(&self) -> u8 {
        *self as u8
    }

    /// Create from a numeric index (0-11).
    pub fn from_index(index: u8) -> Option<Self> {
        match index {
            0 => Some(Self::Dark1),
            1 => Some(Self::Light1),
            2 => Some(Self::Dark2),
            3 => Some(Self::Light2),
            4 => Some(Self::Accent1),
            5 => Some(Self::Accent2),
            6 => Some(Self::Accent3),
            7 => Some(Self::Accent4),
            8 => Some(Self::Accent5),
            9 => Some(Self::Accent6),
            10 => Some(Self::Hyperlink),
            11 => Some(Self::FollowedHyperlink),
            _ => None,
        }
    }
}
