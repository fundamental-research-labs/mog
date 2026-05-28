use crate::drawings::{DrawingFill, EffectProperties, Outline, Scene3D, Shape3D};

// =============================================================================
// Format Scheme (CT_FmtScheme)
// =============================================================================

/// Format scheme defining fill, line, and effect styles (ECMA-376 CT_FmtScheme).
///
/// Each style list typically has 3 entries (subtle, moderate, intense).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FormatScheme {
    /// Scheme name (e.g., "Office")
    pub name: String,
    /// Fill style list (typically 3 entries: subtle, moderate, intense)
    pub fill_style_lst: Vec<DrawingFill>,
    /// Line style list (typically 3 entries)
    pub ln_style_lst: Vec<Outline>,
    /// Effect style list (typically 3 entries)
    pub effect_style_lst: Vec<EffectStyleItem>,
    /// Background fill style list (typically 3 entries)
    pub bg_fill_style_lst: Vec<DrawingFill>,
}

// =============================================================================
// Effect Style Item (CT_EffectStyleItem)
// =============================================================================

/// A single effect style entry within a format scheme (ECMA-376 CT_EffectStyleItem).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct EffectStyleItem {
    /// Effect properties (either an effect list or effect DAG)
    pub effect_properties: Option<EffectProperties>,
    /// Optional 3D scene properties
    pub scene_3d: Option<Scene3D>,
    /// Optional 3D shape properties
    pub sp_3d: Option<Shape3D>,
}
