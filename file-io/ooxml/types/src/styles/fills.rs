use super::colors::{ColorDef, colors_eq};
use super::enums::{GradientType, PatternType};

// =============================================================================
// Gradient Stop
// =============================================================================

/// A colour stop in a gradient fill (ECMA-376 CT_GradientStop).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct GradientStop {
    /// Position within the gradient (0.0 to 1.0).
    pub position: f64,
    /// Colour at this position.
    pub color: ColorDef,
}

// =============================================================================
// Fill Definition
// =============================================================================

/// Fill definition (ECMA-376 CT_Fill).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub enum FillDef {
    /// No fill (patternType="none" with no colours).
    #[default]
    None,
    /// Solid fill with a single foreground colour.
    Solid {
        /// Foreground colour.
        fg_color: ColorDef,
    },
    /// Pattern fill.
    Pattern {
        /// Pattern type. `None` means the attribute was absent in the original XML
        /// (OOXML default is "none"). `Some(PatternType::None)` means `patternType="none"`
        /// was explicitly present.
        pattern_type: Option<PatternType>,
        /// Foreground colour.
        fg_color: Option<ColorDef>,
        /// Background colour.
        bg_color: Option<ColorDef>,
    },
    /// Gradient fill.
    Gradient {
        /// Gradient type (linear or path).
        gradient_type: GradientType,
        /// Gradient angle in degrees (for linear gradients).
        degree: Option<f64>,
        /// Colour stops.
        stops: Vec<GradientStop>,
        /// Fill-to rectangle for path gradients (percentages 0.0-1.0).
        left: Option<f64>,
        right: Option<f64>,
        top: Option<f64>,
        bottom: Option<f64>,
    },
}

impl FillDef {
    /// Semantic equality: variant-matched comparison where colour fields use
    /// `ColorDef::semantically_eq` and gradient stops compare colours semantically.
    pub fn semantically_eq(&self, other: &FillDef) -> bool {
        match (self, other) {
            (FillDef::None, FillDef::None) => true,
            (FillDef::Solid { fg_color: a }, FillDef::Solid { fg_color: b }) => {
                a.semantically_eq(b)
            }
            (
                FillDef::Pattern {
                    pattern_type: pt_a,
                    fg_color: fg_a,
                    bg_color: bg_a,
                },
                FillDef::Pattern {
                    pattern_type: pt_b,
                    fg_color: fg_b,
                    bg_color: bg_b,
                },
            ) => pt_a == pt_b && colors_eq(fg_a, fg_b) && colors_eq(bg_a, bg_b),
            (
                FillDef::Gradient {
                    gradient_type: gt_a,
                    degree: deg_a,
                    stops: stops_a,
                    left: l_a,
                    right: r_a,
                    top: t_a,
                    bottom: b_a,
                },
                FillDef::Gradient {
                    gradient_type: gt_b,
                    degree: deg_b,
                    stops: stops_b,
                    left: l_b,
                    right: r_b,
                    top: t_b,
                    bottom: b_b,
                },
            ) => {
                gt_a == gt_b
                    && deg_a == deg_b
                    && l_a == l_b
                    && r_a == r_b
                    && t_a == t_b
                    && b_a == b_b
                    && stops_a.len() == stops_b.len()
                    && stops_a
                        .iter()
                        .zip(stops_b.iter())
                        .all(|(a, b)| a.position == b.position && a.color.semantically_eq(&b.color))
            }
            _ => false,
        }
    }
}
