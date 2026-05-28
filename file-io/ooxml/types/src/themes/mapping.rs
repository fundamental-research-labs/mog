use crate::drawings::ExtensionList;

use super::colors::{ColorScheme, ColorSchemeIndex};

// =============================================================================
// Color Mapping (CT_ColorMapping)
// =============================================================================

/// Maps logical color slots to scheme color indices (ECMA-376 CT_ColorMapping).
///
/// Used in slide masters and layouts to remap logical colors (bg1, tx1, etc.)
/// to scheme color slots (dk1, lt1, etc.).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ColorMapping {
    /// Background 1
    pub bg1: ColorSchemeIndex,
    /// Text 1
    pub tx1: ColorSchemeIndex,
    /// Background 2
    pub bg2: ColorSchemeIndex,
    /// Text 2
    pub tx2: ColorSchemeIndex,
    /// Accent 1
    pub accent1: ColorSchemeIndex,
    /// Accent 2
    pub accent2: ColorSchemeIndex,
    /// Accent 3
    pub accent3: ColorSchemeIndex,
    /// Accent 4
    pub accent4: ColorSchemeIndex,
    /// Accent 5
    pub accent5: ColorSchemeIndex,
    /// Accent 6
    pub accent6: ColorSchemeIndex,
    /// Hyperlink
    pub hlink: ColorSchemeIndex,
    /// Followed hyperlink
    pub fol_hlink: ColorSchemeIndex,
    /// Extension list
    pub ext_lst: Option<ExtensionList>,
}

impl ColorMapping {
    /// Create the identity mapping where each logical slot maps to its own scheme color.
    pub fn identity() -> Self {
        Self {
            bg1: ColorSchemeIndex::Lt1,
            tx1: ColorSchemeIndex::Dk1,
            bg2: ColorSchemeIndex::Lt2,
            tx2: ColorSchemeIndex::Dk2,
            accent1: ColorSchemeIndex::Accent1,
            accent2: ColorSchemeIndex::Accent2,
            accent3: ColorSchemeIndex::Accent3,
            accent4: ColorSchemeIndex::Accent4,
            accent5: ColorSchemeIndex::Accent5,
            accent6: ColorSchemeIndex::Accent6,
            hlink: ColorSchemeIndex::Hlink,
            fol_hlink: ColorSchemeIndex::FolHlink,
            ext_lst: None,
        }
    }
}

impl Default for ColorMapping {
    fn default() -> Self {
        Self::identity()
    }
}

// =============================================================================
// Color Mapping Override (CT_ColorMappingOverride)
// =============================================================================

/// Override for color mapping — either inherit from master or provide a full override
/// (ECMA-376 CT_ColorMappingOverride).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub enum ColorMappingOverride {
    /// Use the master color mapping (no override)
    #[default]
    MasterClrMapping,
    /// Provide a full override color mapping
    OverrideClrMapping(ColorMapping),
}

// =============================================================================
// Color Scheme And Mapping (CT_ColorSchemeAndMapping)
// =============================================================================

/// A color scheme paired with an optional color mapping (ECMA-376 CT_ColorSchemeAndMapping).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColorSchemeAndMapping {
    /// The color scheme
    pub clr_scheme: ColorScheme,
    /// Optional color mapping
    pub clr_map: Option<ColorMapping>,
}

// =============================================================================
// Color Scheme List (CT_ColorSchemeList)
// =============================================================================

/// List of extra color scheme/mapping pairs (ECMA-376 CT_ColorSchemeList).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ColorSchemeList {
    /// Extra color scheme entries
    pub extra_clr_scheme: Vec<ColorSchemeAndMapping>,
}
