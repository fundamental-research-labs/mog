use super::colors::{ColorDef, colors_eq};
use super::enums::BorderStyle;

// =============================================================================
// Border Side Definition
// =============================================================================

/// One side of a border (ECMA-376 CT_BorderPr).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BorderSideDef {
    /// Border style.
    pub style: BorderStyle,
    /// Border colour.
    pub color: Option<ColorDef>,
}

impl Default for BorderSideDef {
    fn default() -> Self {
        Self {
            style: BorderStyle::None,
            color: None,
        }
    }
}

// =============================================================================
// Border Definition
// =============================================================================

/// Border definition (ECMA-376 CT_Border).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct BorderDef {
    /// Left border.
    pub left: Option<BorderSideDef>,
    /// Right border.
    pub right: Option<BorderSideDef>,
    /// Top border.
    pub top: Option<BorderSideDef>,
    /// Bottom border.
    pub bottom: Option<BorderSideDef>,
    /// Diagonal border.
    pub diagonal: Option<BorderSideDef>,
    /// Diagonal up (bottom-left to top-right). `None` = absent (default false), `Some(bool)` = explicitly set.
    pub diagonal_up: Option<bool>,
    /// Diagonal down (top-left to bottom-right). `None` = absent (default false), `Some(bool)` = explicitly set.
    pub diagonal_down: Option<bool>,
    /// Start border (BiDi replacement for left).
    pub start: Option<BorderSideDef>,
    /// End border (BiDi replacement for right).
    pub end: Option<BorderSideDef>,
    /// Vertical interior border (table styles).
    pub vertical: Option<BorderSideDef>,
    /// Horizontal interior border (table styles).
    pub horizontal: Option<BorderSideDef>,
    /// Whether to draw outline borders (default true). `None` = absent (default true), `Some(bool)` = explicitly set.
    pub outline: Option<bool>,
}

impl BorderSideDef {
    /// Returns `true` if this side has no visible border (style=None, no color).
    pub fn is_empty(&self) -> bool {
        self.style == BorderStyle::None && self.color.is_none()
    }

    /// Semantic equality: compares style structurally and colour semantically.
    pub fn semantically_eq(&self, other: &BorderSideDef) -> bool {
        self.style == other.style && colors_eq(&self.color, &other.color)
    }
}

impl BorderDef {
    /// Normalize an `Option<BorderSideDef>`: collapse `Some(empty)` → `None`.
    fn normalize_side(side: &Option<BorderSideDef>) -> Option<&BorderSideDef> {
        side.as_ref().filter(|s| !s.is_empty())
    }

    /// Semantic equality: treats `Some(BorderSideDef { style: None, color: None })`
    /// the same as `None` for each border side, and compares colours semantically
    /// (e.g. `Indexed(64)` == `Rgb("FF000000")`).
    pub fn semantically_eq(&self, other: &BorderDef) -> bool {
        fn sides_eq(a: Option<&BorderSideDef>, b: Option<&BorderSideDef>) -> bool {
            match (a, b) {
                (Some(a), Some(b)) => a.semantically_eq(b),
                (None, None) => true,
                _ => false,
            }
        }
        sides_eq(
            Self::normalize_side(&self.left),
            Self::normalize_side(&other.left),
        ) && sides_eq(
            Self::normalize_side(&self.right),
            Self::normalize_side(&other.right),
        ) && sides_eq(
            Self::normalize_side(&self.top),
            Self::normalize_side(&other.top),
        ) && sides_eq(
            Self::normalize_side(&self.bottom),
            Self::normalize_side(&other.bottom),
        ) && sides_eq(
            Self::normalize_side(&self.diagonal),
            Self::normalize_side(&other.diagonal),
        ) && self.diagonal_up == other.diagonal_up
            && self.diagonal_down == other.diagonal_down
            && sides_eq(
                Self::normalize_side(&self.start),
                Self::normalize_side(&other.start),
            )
            && sides_eq(
                Self::normalize_side(&self.end),
                Self::normalize_side(&other.end),
            )
            && sides_eq(
                Self::normalize_side(&self.vertical),
                Self::normalize_side(&other.vertical),
            )
            && sides_eq(
                Self::normalize_side(&self.horizontal),
                Self::normalize_side(&other.horizontal),
            )
            && self.outline == other.outline
    }
}
