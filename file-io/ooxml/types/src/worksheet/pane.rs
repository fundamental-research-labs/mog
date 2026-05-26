//! Pane types: SheetPane configuration, Pane identifier, and PaneState.

use super::merge::to_a1;

// ---------------------------------------------------------------------------
// Pane (ST_Pane)
// ---------------------------------------------------------------------------

/// Active pane identifier (ECMA-376 ST_Pane, 18.18.52).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum Pane {
    /// Bottom-left pane (when both row and column splits exist).
    BottomLeft,
    /// Bottom-right pane.
    BottomRight,
    /// Top-left pane (default).
    #[default]
    TopLeft,
    /// Top-right pane (when both row and column splits exist).
    TopRight,
}

impl Pane {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "bottomLeft" => Self::BottomLeft,
            "bottomRight" => Self::BottomRight,
            "topLeft" => Self::TopLeft,
            "topRight" => Self::TopRight,
            _ => Self::TopLeft,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::BottomLeft => "bottomLeft",
            Self::BottomRight => "bottomRight",
            Self::TopLeft => "topLeft",
            Self::TopRight => "topRight",
        }
    }
}

// ---------------------------------------------------------------------------
// PaneState (ST_PaneState)
// ---------------------------------------------------------------------------

/// Pane state (ECMA-376 ST_PaneState, 18.18.53).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum PaneState {
    /// Panes are frozen (cannot be resized).
    Frozen,
    /// Panes are frozen but were created from a split.
    FrozenSplit,
    /// Panes are split (resizable divider).
    #[default]
    Split,
}

impl PaneState {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "frozen" => Self::Frozen,
            "frozenSplit" => Self::FrozenSplit,
            "split" => Self::Split,
            _ => Self::Split,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Frozen => "frozen",
            Self::FrozenSplit => "frozenSplit",
            Self::Split => "split",
        }
    }
}

// ---------------------------------------------------------------------------
// SheetPane (CT_Pane)
// ---------------------------------------------------------------------------

/// Pane configuration for a worksheet (ECMA-376 CT_Pane, 18.3.1.66).
///
/// When `state` is `Frozen` or `FrozenSplit`, `x_split` and `y_split` are
/// column/row counts (integers). When `state` is `Split`, they are pixel
/// positions (twips). The type uses `f64` to handle both cases per spec.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SheetPane {
    /// Horizontal split position.
    /// - Frozen: number of columns frozen (left of split).
    /// - Split: position in 1/20th of a point from left edge.
    pub x_split: f64,
    /// Vertical split position.
    /// - Frozen: number of rows frozen (above split).
    /// - Split: position in 1/20th of a point from top edge.
    pub y_split: f64,
    /// Top-left cell in the bottom-right pane.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_left_cell: Option<String>,
    /// Which pane is active (receives input focus). XSD optional, default "topLeft".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_pane: Option<Pane>,
    /// Pane state (frozen, frozenSplit, or split). XSD optional, default "split".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<PaneState>,
}

impl SheetPane {
    /// Effective active pane (defaults to `TopLeft` when absent per XSD).
    #[must_use]
    pub fn effective_active_pane(&self) -> Pane {
        self.active_pane.unwrap_or(Pane::TopLeft)
    }

    /// Effective pane state (defaults to `Split` when absent per XSD).
    #[must_use]
    pub fn effective_state(&self) -> PaneState {
        self.state.unwrap_or(PaneState::Split)
    }

    /// Create a frozen pane from row and column counts.
    /// `rows` = number of frozen rows, `cols` = number of frozen columns.
    /// Takes u32 since frozen splits are always integer row/col counts.
    pub fn frozen(rows: u32, cols: u32) -> Self {
        let active_pane = match (rows > 0, cols > 0) {
            (true, true) => Pane::BottomRight,
            (true, false) => Pane::BottomLeft,
            (false, true) => Pane::TopRight,
            (false, false) => Pane::TopLeft,
        };
        Self {
            x_split: cols as f64,
            y_split: rows as f64,
            top_left_cell: Some(to_a1(rows, cols)),
            active_pane: Some(active_pane),
            state: Some(PaneState::Frozen),
        }
    }

    /// Create a split (non-frozen) pane from pixel positions in twips.
    pub fn split(x_pos: f64, y_pos: f64) -> Self {
        Self {
            x_split: x_pos,
            y_split: y_pos,
            top_left_cell: None,
            active_pane: Some(Pane::BottomRight),
            state: Some(PaneState::Split),
        }
    }

    /// Create from already-parsed OOXML attributes.
    ///
    /// Preserve the parsed pane attributes independently. For frozen panes,
    /// `xSplit`/`ySplit` are the frozen column/row counts, while `topLeftCell`
    /// is the scroll position of the unfrozen pane. They are related in the
    /// default case but are not interchangeable after the user scrolls.
    pub fn from_parsed(
        x_split: f64,
        y_split: f64,
        top_left_cell: Option<&str>,
        active_pane: Pane,
        state: PaneState,
    ) -> Self {
        Self {
            x_split,
            y_split,
            top_left_cell: top_left_cell.map(|s| s.to_string()),
            active_pane: Some(active_pane),
            state: Some(state),
        }
    }

    /// Number of frozen rows (only meaningful when state is Frozen/FrozenSplit).
    pub fn rows(&self) -> u32 {
        self.y_split as u32
    }

    /// Number of frozen columns (only meaningful when state is Frozen/FrozenSplit).
    pub fn cols(&self) -> u32 {
        self.x_split as u32
    }

    /// Whether this is a frozen pane.
    pub fn is_frozen(&self) -> bool {
        matches!(
            self.effective_state(),
            PaneState::Frozen | PaneState::FrozenSplit
        )
    }

    /// Whether this is a split (non-frozen) pane.
    pub fn is_split(&self) -> bool {
        matches!(self.effective_state(), PaneState::Split)
    }
}
