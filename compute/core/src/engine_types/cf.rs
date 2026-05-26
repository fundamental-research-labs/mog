//! Conditional formatting presets and icon set registry.
//!
//! Canonical CF types live in `domain_types::domain::conditional_format` —
//! import from there directly. This module only contains compute-core-specific
//! preset definitions and the icon set registry.

use domain_types::domain::conditional_format::{CFColorScale, CFDataBar, CFIconSet};

/// Cell range address for conditional formatting.
/// Type alias to [`cell_types::SheetRange`] — identical field names, with
/// additional `Copy`/`Eq`/`Hash` derives and range-math methods.
pub type CFCellRange = cell_types::SheetRange;

use serde::{Deserialize, Serialize};

// =============================================================================
// Presets
// =============================================================================

/// Preset category.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CFPresetCategory {
    /// Data bar preset.
    DataBar,
    /// Color scale preset.
    ColorScale,
    /// Icon set preset.
    IconSet,
}

/// A data bar preset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFDataBarPreset {
    /// Preset identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Data bar configuration.
    pub data_bar: CFDataBar,
}

/// A color scale preset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFColorScalePreset {
    /// Preset identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Color scale configuration.
    pub color_scale: CFColorScale,
}

/// An icon set preset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CFIconSetPreset {
    /// Preset identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Icon set configuration.
    pub icon_set: CFIconSet,
}

// =============================================================================
// Icon Set Registry
// =============================================================================

/// Metadata for an icon set (name, icon count, default thresholds).
#[derive(Debug, Clone, PartialEq)]
pub struct IconSetMetadata {
    /// Icon set name.
    pub name: &'static str,
    /// Number of icons in the set.
    pub icon_count: u8,
    /// Default percentage thresholds.
    pub default_thresholds: &'static [u8],
}

/// Registry of all available icon sets with their default thresholds.
pub const ICON_SET_REGISTRY: &[IconSetMetadata] = &[
    IconSetMetadata {
        name: "3Arrows",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3ArrowsGray",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3Flags",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3TrafficLights1",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3TrafficLights2",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3Signs",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3Symbols",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3Symbols2",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3Stars",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "3Triangles",
        icon_count: 3,
        default_thresholds: &[0, 33, 67],
    },
    IconSetMetadata {
        name: "4Arrows",
        icon_count: 4,
        default_thresholds: &[0, 25, 50, 75],
    },
    IconSetMetadata {
        name: "4ArrowsGray",
        icon_count: 4,
        default_thresholds: &[0, 25, 50, 75],
    },
    IconSetMetadata {
        name: "4Rating",
        icon_count: 4,
        default_thresholds: &[0, 25, 50, 75],
    },
    IconSetMetadata {
        name: "4RedToBlack",
        icon_count: 4,
        default_thresholds: &[0, 25, 50, 75],
    },
    IconSetMetadata {
        name: "4TrafficLights",
        icon_count: 4,
        default_thresholds: &[0, 25, 50, 75],
    },
    IconSetMetadata {
        name: "5Arrows",
        icon_count: 5,
        default_thresholds: &[0, 20, 40, 60, 80],
    },
    IconSetMetadata {
        name: "5ArrowsGray",
        icon_count: 5,
        default_thresholds: &[0, 20, 40, 60, 80],
    },
    IconSetMetadata {
        name: "5Rating",
        icon_count: 5,
        default_thresholds: &[0, 20, 40, 60, 80],
    },
    IconSetMetadata {
        name: "5Quarters",
        icon_count: 5,
        default_thresholds: &[0, 20, 40, 60, 80],
    },
    IconSetMetadata {
        name: "5Boxes",
        icon_count: 5,
        default_thresholds: &[0, 20, 40, 60, 80],
    },
];
