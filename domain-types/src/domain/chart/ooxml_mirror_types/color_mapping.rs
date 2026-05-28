use serde::{Deserialize, Serialize};

use ooxml_types::themes as othemes;

/// Color scheme slot identifier (ST_ColorSchemeIndex).
///
/// Domain mirror of `ooxml_types::themes::ColorSchemeIndex`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColorSchemeSlot {
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

impl From<othemes::ColorSchemeIndex> for ColorSchemeSlot {
    fn from(v: othemes::ColorSchemeIndex) -> Self {
        match v {
            othemes::ColorSchemeIndex::Dk1 => Self::Dk1,
            othemes::ColorSchemeIndex::Lt1 => Self::Lt1,
            othemes::ColorSchemeIndex::Dk2 => Self::Dk2,
            othemes::ColorSchemeIndex::Lt2 => Self::Lt2,
            othemes::ColorSchemeIndex::Accent1 => Self::Accent1,
            othemes::ColorSchemeIndex::Accent2 => Self::Accent2,
            othemes::ColorSchemeIndex::Accent3 => Self::Accent3,
            othemes::ColorSchemeIndex::Accent4 => Self::Accent4,
            othemes::ColorSchemeIndex::Accent5 => Self::Accent5,
            othemes::ColorSchemeIndex::Accent6 => Self::Accent6,
            othemes::ColorSchemeIndex::Hlink => Self::Hlink,
            othemes::ColorSchemeIndex::FolHlink => Self::FolHlink,
        }
    }
}

impl From<ColorSchemeSlot> for othemes::ColorSchemeIndex {
    fn from(v: ColorSchemeSlot) -> Self {
        match v {
            ColorSchemeSlot::Dk1 => Self::Dk1,
            ColorSchemeSlot::Lt1 => Self::Lt1,
            ColorSchemeSlot::Dk2 => Self::Dk2,
            ColorSchemeSlot::Lt2 => Self::Lt2,
            ColorSchemeSlot::Accent1 => Self::Accent1,
            ColorSchemeSlot::Accent2 => Self::Accent2,
            ColorSchemeSlot::Accent3 => Self::Accent3,
            ColorSchemeSlot::Accent4 => Self::Accent4,
            ColorSchemeSlot::Accent5 => Self::Accent5,
            ColorSchemeSlot::Accent6 => Self::Accent6,
            ColorSchemeSlot::Hlink => Self::Hlink,
            ColorSchemeSlot::FolHlink => Self::FolHlink,
        }
    }
}

/// Full 12-slot color mapping (CT_ColorMapping without extLst).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartColorMapping {
    pub bg1: ColorSchemeSlot,
    pub tx1: ColorSchemeSlot,
    pub bg2: ColorSchemeSlot,
    pub tx2: ColorSchemeSlot,
    pub accent1: ColorSchemeSlot,
    pub accent2: ColorSchemeSlot,
    pub accent3: ColorSchemeSlot,
    pub accent4: ColorSchemeSlot,
    pub accent5: ColorSchemeSlot,
    pub accent6: ColorSchemeSlot,
    pub hlink: ColorSchemeSlot,
    pub fol_hlink: ColorSchemeSlot,
}

impl From<&othemes::ColorMapping> for ChartColorMapping {
    fn from(m: &othemes::ColorMapping) -> Self {
        Self {
            bg1: m.bg1.into(),
            tx1: m.tx1.into(),
            bg2: m.bg2.into(),
            tx2: m.tx2.into(),
            accent1: m.accent1.into(),
            accent2: m.accent2.into(),
            accent3: m.accent3.into(),
            accent4: m.accent4.into(),
            accent5: m.accent5.into(),
            accent6: m.accent6.into(),
            hlink: m.hlink.into(),
            fol_hlink: m.fol_hlink.into(),
        }
    }
}

impl From<ChartColorMapping> for othemes::ColorMapping {
    fn from(m: ChartColorMapping) -> Self {
        Self {
            bg1: m.bg1.into(),
            tx1: m.tx1.into(),
            bg2: m.bg2.into(),
            tx2: m.tx2.into(),
            accent1: m.accent1.into(),
            accent2: m.accent2.into(),
            accent3: m.accent3.into(),
            accent4: m.accent4.into(),
            accent5: m.accent5.into(),
            accent6: m.accent6.into(),
            hlink: m.hlink.into(),
            fol_hlink: m.fol_hlink.into(),
            ext_lst: None,
        }
    }
}

/// Color mapping override (CT_ColorMappingOverride).
///
/// Either the chart inherits the master color mapping or specifies a full
/// override.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[derive(Default)]
pub enum ChartColorMappingOverride {
    /// Inherit from the master theme (no override).
    #[default]
    Master,
    /// Full per-slot override.
    Override(ChartColorMapping),
}

impl From<&othemes::ColorMappingOverride> for ChartColorMappingOverride {
    fn from(v: &othemes::ColorMappingOverride) -> Self {
        match v {
            othemes::ColorMappingOverride::MasterClrMapping => Self::Master,
            othemes::ColorMappingOverride::OverrideClrMapping(m) => Self::Override(m.into()),
        }
    }
}

impl From<ChartColorMappingOverride> for othemes::ColorMappingOverride {
    fn from(v: ChartColorMappingOverride) -> Self {
        match v {
            ChartColorMappingOverride::Master => Self::MasterClrMapping,
            ChartColorMappingOverride::Override(m) => Self::OverrideClrMapping(m.into()),
        }
    }
}
