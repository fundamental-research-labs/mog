//! Styling, locking, and non-visual property types for DrawingML.

use super::color::DrawingColor;
use super::primitives::{StDrawingElementId, StStyleMatrixColumnIndex};

// =============================================================================
// DrawingLocking
// =============================================================================

/// Unified drawing locking properties (ECMA-376 AG_Locking + `noCrop` + `noTextEdit`).
///
/// Covers `CT_ConnectorLocking` (10 base fields from `AG_Locking`),
/// `CT_PictureLocking` (10 base fields + `noCrop`), and `CT_ShapeLocking`
/// (10 base fields + `noTextEdit`). The `no_crop` and `no_text_edit` fields
/// are only meaningful for their respective shape types but are harmless on
/// others (default to `false`).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct DrawingLocking {
    /// Disallow cropping (picture-only, CT_PictureLocking).
    pub no_crop: bool,
    /// Disallow text editing (shape-only, CT_ShapeLocking).
    pub no_text_edit: bool,
    /// Disallow grouping.
    pub no_grp: bool,
    /// Disallow selection.
    pub no_select: bool,
    /// Disallow rotation.
    pub no_rot: bool,
    /// Disallow aspect ratio changes.
    pub no_change_aspect: bool,
    /// Disallow moving.
    pub no_move: bool,
    /// Disallow resizing.
    pub no_resize: bool,
    /// Disallow editing connection points.
    pub no_edit_points: bool,
    /// Disallow adjusting handles.
    pub no_adjust_handles: bool,
    /// Disallow changing arrowheads.
    pub no_change_arrowheads: bool,
    /// Disallow changing the shape type.
    pub no_change_shape_type: bool,
    /// Extension list — opaque XML passthrough (CT_ConnectorLocking/CT_ShapeLocking/CT_PictureLocking extLst).
    pub ext_lst: Option<String>,
}

// =============================================================================
// GroupLocking
// =============================================================================

/// Group shape locking properties (ECMA-376 `CT_GroupLocking`, `dml-main.xsd:759-770`).
///
/// Unlike `DrawingLocking` (which uses `AG_Locking` with 11 attributes), `CT_GroupLocking`
/// defines its 7 attributes directly — it does NOT have `noEditPoints`, `noAdjustHandles`,
/// `noChangeArrowheads`, or `noChangeShapeType`. It does have `noUngrp` which is unique
/// to groups.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GroupLocking {
    /// Disallow grouping (`@noGrp`, default false).
    pub no_grp: bool,
    /// Disallow ungrouping (`@noUngrp`, default false) — unique to groups.
    pub no_ungrp: bool,
    /// Disallow selection (`@noSelect`, default false).
    pub no_select: bool,
    /// Disallow rotation (`@noRot`, default false).
    pub no_rot: bool,
    /// Disallow aspect ratio changes (`@noChangeAspect`, default false).
    pub no_change_aspect: bool,
    /// Disallow moving (`@noMove`, default false).
    pub no_move: bool,
    /// Disallow resizing (`@noResize`, default false).
    pub no_resize: bool,
    /// Extension list — opaque XML passthrough (complete `<a:extLst>...</a:extLst>` element).
    pub ext_lst: Option<String>,
}

impl GroupLocking {
    /// Returns `true` if any locking flag is set (used to decide whether to emit the element).
    pub fn has_any(&self) -> bool {
        self.no_grp
            || self.no_ungrp
            || self.no_select
            || self.no_rot
            || self.no_change_aspect
            || self.no_move
            || self.no_resize
            || self.ext_lst.is_some()
    }
}

// =============================================================================
// Hyperlink
// =============================================================================

/// Hyperlink properties (ECMA-376 CT_Hyperlink).
///
/// The `snd` child element (CT_EmbeddedWAVAudioFile) is deferred.
///
/// The `url` field is a resolution cache — not part of the XSD schema. It stores
/// the resolved target URL from the relationship lookup, avoiding repeated
/// relationship resolution at render time.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Hyperlink {
    /// Resolved target URL (not in XSD — cached from relationship resolution).
    pub url: Option<String>,
    /// Relationship ID to target (`r:id`).
    pub r_id: Option<String>,
    /// Action string (e.g., `"ppaction://hlinksldjump"`).
    pub action: Option<String>,
    /// Hover tooltip text.
    pub tooltip: Option<String>,
    /// Target frame for navigation.
    pub tgt_frame: Option<String>,
    /// Original URL if deemed invalid.
    pub invalid_url: Option<String>,
    /// Whether to add to navigation history (default: true).
    pub history: Option<bool>,
    /// Highlight on click.
    pub highlight_click: Option<bool>,
    /// Stop previous sound on click.
    pub end_snd: Option<bool>,
    /// Extension list — opaque XML passthrough (CT_Hyperlink extLst).
    pub ext_lst: Option<String>,
}

// =============================================================================
// Shape Style
// =============================================================================

/// Font collection index (ECMA-376 ST_FontCollectionIndex).
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum FontCollectionIndex {
    /// Major font (headings).
    Major,
    /// Minor font (body).
    #[default]
    Minor,
    /// No theme font.
    None,
}

impl FontCollectionIndex {
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "major" => Self::Major,
            "minor" => Self::Minor,
            "none" => Self::None,
            _ => Self::Minor,
        }
    }

    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Major => "major",
            Self::Minor => "minor",
            Self::None => "none",
        }
    }
}

/// Font reference (ECMA-376 CT_FontReference).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FontReference {
    /// Font collection index.
    pub idx: FontCollectionIndex,
    /// Optional colour override.
    pub color: Option<super::color::DrawingColor>,
}

/// Shape style reference (ECMA-376 CT_ShapeStyle).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ShapeStyle {
    /// Line reference.
    pub line_ref: StyleRef,
    /// Fill reference.
    pub fill_ref: StyleRef,
    /// Effect reference.
    pub effect_ref: StyleRef,
    /// Font reference.
    pub font_ref: FontReference,
}

/// A reference into a theme's style matrix (ECMA-376 CT_StyleMatrixReference).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StyleRef {
    /// Index into the theme.
    pub idx: StStyleMatrixColumnIndex,
    /// Optional colour override.
    pub color: Option<DrawingColor>,
}

// =============================================================================
// Non-Visual Properties
// =============================================================================

/// Non-visual properties common to all drawing objects (ECMA-376 CT_NonVisualDrawingProps).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct NonVisualProps {
    /// Unique ID within the drawing.
    pub id: StDrawingElementId,
    /// Name (required per ECMA-376 `@name` on `CT_NonVisualDrawingProps`).
    pub name: String,
    /// Description / alt text.
    pub descr: Option<String>,
    /// Hidden flag.
    pub hidden: bool,
    /// Title (ECMA-376 `@title` attribute).
    pub title: Option<String>,
    /// Hyperlink on click (ECMA-376 `hlinkClick` element, CT_Hyperlink).
    pub hlink_click: Option<Hyperlink>,
    /// Hyperlink on hover (ECMA-376 `hlinkHover` element, CT_Hyperlink).
    pub hlink_hover: Option<Hyperlink>,
    /// Extension list — opaque XML passthrough (CT_NonVisualDrawingProps extLst).
    pub ext_lst: Option<String>,
}

// =============================================================================
// Connection
// =============================================================================

/// Connection point on a shape for connectors (ECMA-376 CT_Connection).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Connection {
    /// Target shape ID.
    pub shape_id: u32,
    /// Connection site index on the target shape.
    pub idx: u32,
}

// =============================================================================
// ClientData
// =============================================================================

/// Client data for drawing anchors (ECMA-376 CT_AnchorClientData).
///
/// Both fields default to `true` per the OOXML spec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClientData {
    /// Whether the object is locked when the sheet is protected.
    pub locks_with_sheet: bool,
    /// Whether the object prints when the sheet is printed.
    pub prints_with_sheet: bool,
}

impl Default for ClientData {
    fn default() -> Self {
        Self {
            locks_with_sheet: true,
            prints_with_sheet: true,
        }
    }
}

// =============================================================================
// BlackWhiteMode
// =============================================================================

/// Black and white rendering mode (ECMA-376 ST_BlackWhiteMode).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BlackWhiteMode {
    #[default]
    Clr,
    Auto,
    Gray,
    LtGray,
    InvGray,
    GrayWhite,
    BlackGray,
    BlackWhite,
    Black,
    White,
    Hidden,
}

impl BlackWhiteMode {
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "clr" => Self::Clr,
            "auto" => Self::Auto,
            "gray" => Self::Gray,
            "ltGray" => Self::LtGray,
            "invGray" => Self::InvGray,
            "grayWhite" => Self::GrayWhite,
            "blackGray" => Self::BlackGray,
            "blackWhite" => Self::BlackWhite,
            "black" => Self::Black,
            "white" => Self::White,
            "hidden" => Self::Hidden,
            _ => Self::Clr,
        }
    }

    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Clr => "clr",
            Self::Auto => "auto",
            Self::Gray => "gray",
            Self::LtGray => "ltGray",
            Self::InvGray => "invGray",
            Self::GrayWhite => "grayWhite",
            Self::BlackGray => "blackGray",
            Self::BlackWhite => "blackWhite",
            Self::Black => "black",
            Self::White => "white",
            Self::Hidden => "hidden",
        }
    }
}
