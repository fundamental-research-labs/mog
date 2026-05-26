//! Comment types (ECMA-376 Part 1, Section 18.7 — SpreadsheetML Comments).
//!
//! Types modelling the contents of `xl/comments{N}.xml`: the comments root
//! element, individual comments (with cell reference and rich text body),
//! and comment display properties.
//!
//! Comment text reuses [`crate::shared_strings::Rst`] (CT_Rst).
//!
//! Threaded comments (Office 365 extension, `xl/threadedComments/`) are not
//! included here — they are outside ECMA-376 Part 1 scope.

use crate::shared_strings::Rst;

// ============================================================================
// CommentHAlign — Horizontal alignment for comment text
// ============================================================================

/// Horizontal alignment for comment text.
///
/// Controls how text is aligned horizontally within the comment box.
/// Corresponds to the `textHAlign` attribute of CT_CommentPr.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CommentHAlign {
    /// Left-aligned (default).
    #[default]
    #[xml("left")]
    Left,
    /// Center-aligned.
    #[xml("center")]
    Center,
    /// Right-aligned.
    #[xml("right")]
    Right,
    /// Justified — text stretched to fill the line.
    #[xml("justify")]
    Justify,
    /// Distributed — characters evenly spread across the line.
    #[xml("distributed")]
    Distributed,
}

// ============================================================================
// CommentVAlign — Vertical alignment for comment text
// ============================================================================

/// Vertical alignment for comment text.
///
/// Controls how text is aligned vertically within the comment box.
/// Corresponds to the `textVAlign` attribute of CT_CommentPr.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CommentVAlign {
    /// Top-aligned (default).
    #[default]
    #[xml("top")]
    Top,
    /// Center-aligned.
    #[xml("center")]
    Center,
    /// Bottom-aligned.
    #[xml("bottom")]
    Bottom,
    /// Justified — text stretched to fill the vertical space.
    #[xml("justify")]
    Justify,
    /// Distributed — lines evenly spread across the vertical space.
    #[xml("distributed")]
    Distributed,
}

// ============================================================================
// CommentDisplayMode — ST_Comments (§18.18.14)
// ============================================================================

/// Comment display mode (ST_Comments, ECMA-376 §18.18.14).
///
/// Controls how comments are displayed in the workbook view. This is
/// distinct from ST_CellComments which controls comment printing behaviour.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum CommentDisplayMode {
    /// Do not show comments or indicators (default).
    #[default]
    #[xml("commNone")]
    None,
    /// Show indicator only (small triangle in cell corner).
    #[xml("commIndicator")]
    Indicator,
    /// Show both indicator and comment text.
    #[xml("commIndAndComment")]
    IndicatorAndComment,
}

// ============================================================================
// Comments (CT_Comments) — Root element of xl/comments{N}.xml
// ============================================================================

/// Root element of `xl/comments{N}.xml` (CT_Comments).
///
/// Contains a list of authors and a list of comments. Each comment references
/// an author by index into the `authors` vector.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Comments {
    /// Author names (`<authors><author>` children).
    ///
    /// Each comment references an author by zero-based index into this list.
    pub authors: Vec<String>,

    /// Individual comments (`<commentList><comment>` children).
    pub comment_list: Vec<Comment>,
}

// ============================================================================
// Comment (CT_Comment) — A single comment
// ============================================================================

/// A single comment attached to a cell (CT_Comment).
///
/// Each comment references a cell by its A1-style address (`ref`) and an
/// author by index. The comment body is rich text ([`Rst`]).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Comment {
    /// Cell reference in A1 notation (e.g. `"A1"`, `"B12"`). Required attribute.
    pub r#ref: String,

    /// Zero-based index into [`Comments::authors`]. Required attribute.
    pub author_id: u32,

    /// Globally unique identifier for this comment (optional).
    pub guid: Option<String>,

    /// Shape ID linking to the VML drawing (optional).
    pub shape_id: Option<u32>,

    /// Rich-text body of the comment (`<text>` child, CT_Rst).
    pub text: Rst,

    /// Display properties for the comment (`<commentPr>` child, optional).
    pub comment_pr: Option<CommentPr>,
}

// ============================================================================
// CommentPr (CT_CommentPr) — Comment display properties
// ============================================================================

/// Display properties for a comment (CT_CommentPr).
///
/// Controls visual presentation and behaviour of the comment box.
/// All boolean defaults follow the ECMA-376 spec (Section 18.7.6).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CommentPr {
    /// Object anchor positioning (required per XSD, but modelled as Option
    /// for ergonomic construction — callers should always set this).
    pub anchor: Option<crate::ole::ObjectAnchor>,

    /// Whether the comment is locked when the sheet is protected. Default: `true`.
    pub locked: bool,

    /// Whether the comment uses its default size. Default: `true`.
    pub default_size: bool,

    /// Whether the comment is printed when the sheet is printed. Default: `true`.
    pub print: bool,

    /// Whether the comment is disabled (hidden and non-interactive). Default: `false`.
    pub disabled: bool,

    /// Whether the comment box auto-fills its background. Default: `true`.
    pub auto_fill: bool,

    /// Whether the comment box auto-sizes to fit line breaks. Default: `true`.
    pub auto_line: bool,

    /// Alternative text for accessibility (optional).
    pub alt_text: Option<String>,

    /// Horizontal alignment of the comment text (optional).
    pub text_h_align: Option<CommentHAlign>,

    /// Vertical alignment of the comment text (optional).
    pub text_v_align: Option<CommentVAlign>,

    /// Whether the text within the comment is locked. Default: `true`.
    pub lock_text: bool,

    /// Whether to justify the last line of text. Default: `false`.
    pub just_last_x: bool,

    /// Whether to auto-scale the text to fit the comment box. Default: `false`.
    pub auto_scale: bool,
}

impl CommentPr {
    /// Returns the effective horizontal text alignment, using the XSD default
    /// of `Left` when the field is absent.
    #[must_use]
    pub fn effective_text_h_align(&self) -> CommentHAlign {
        self.text_h_align.unwrap_or(CommentHAlign::Left)
    }

    /// Returns the effective vertical text alignment, using the XSD default
    /// of `Top` when the field is absent.
    #[must_use]
    pub fn effective_text_v_align(&self) -> CommentVAlign {
        self.text_v_align.unwrap_or(CommentVAlign::Top)
    }
}

impl Default for CommentPr {
    fn default() -> Self {
        Self {
            anchor: None,
            locked: true,
            default_size: true,
            print: true,
            disabled: false,
            auto_fill: true,
            auto_line: true,
            alt_text: None,
            text_h_align: None,
            text_v_align: None,
            lock_text: true,
            just_last_x: false,
            auto_scale: false,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_h_align_roundtrip() {
        let variants = [
            (CommentHAlign::Left, "left"),
            (CommentHAlign::Center, "center"),
            (CommentHAlign::Right, "right"),
            (CommentHAlign::Justify, "justify"),
            (CommentHAlign::Distributed, "distributed"),
        ];
        for (variant, s) in &variants {
            assert_eq!(CommentHAlign::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                CommentHAlign::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn comment_v_align_roundtrip() {
        let variants = [
            (CommentVAlign::Top, "top"),
            (CommentVAlign::Center, "center"),
            (CommentVAlign::Bottom, "bottom"),
            (CommentVAlign::Justify, "justify"),
            (CommentVAlign::Distributed, "distributed"),
        ];
        for (variant, s) in &variants {
            assert_eq!(CommentVAlign::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                CommentVAlign::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn comment_display_mode_roundtrip() {
        let variants = [
            (CommentDisplayMode::None, "commNone"),
            (CommentDisplayMode::Indicator, "commIndicator"),
            (CommentDisplayMode::IndicatorAndComment, "commIndAndComment"),
        ];
        for (variant, s) in &variants {
            assert_eq!(
                CommentDisplayMode::from_ooxml(s),
                *variant,
                "from_ooxml({s})"
            );
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                CommentDisplayMode::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn unknown_enum_defaults() {
        assert_eq!(CommentHAlign::from_ooxml("unknown"), CommentHAlign::Left);
        assert_eq!(CommentHAlign::from_bytes(b"garbage"), CommentHAlign::Left);
        assert_eq!(CommentVAlign::from_ooxml("unknown"), CommentVAlign::Top);
        assert_eq!(CommentVAlign::from_bytes(b"garbage"), CommentVAlign::Top);
        assert_eq!(
            CommentDisplayMode::from_ooxml("unknown"),
            CommentDisplayMode::None
        );
        assert_eq!(
            CommentDisplayMode::from_bytes(b"garbage"),
            CommentDisplayMode::None
        );
    }

    #[test]
    fn comments_default() {
        let c = Comments::default();
        assert!(c.authors.is_empty());
        assert!(c.comment_list.is_empty());
    }

    #[test]
    fn comment_default() {
        let c = Comment::default();
        assert_eq!(c.r#ref, "");
        assert_eq!(c.author_id, 0);
        assert_eq!(c.guid, None);
        assert_eq!(c.shape_id, None);
        assert_eq!(c.text, Rst::default());
        assert_eq!(c.comment_pr, None);
    }

    #[test]
    fn comment_pr_defaults() {
        let pr = CommentPr::default();
        // anchor is required per XSD but Option for ergonomic construction
        assert!(pr.anchor.is_none());
        // Spec defaults: most protective flags are true
        assert!(pr.locked, "locked should default to true");
        assert!(pr.default_size, "default_size should default to true");
        assert!(pr.print, "print should default to true");
        assert!(pr.auto_fill, "auto_fill should default to true");
        assert!(pr.auto_line, "auto_line should default to true");
        assert!(pr.lock_text, "lock_text should default to true");
        // These default to false
        assert!(!pr.disabled, "disabled should default to false");
        assert!(!pr.just_last_x, "just_last_x should default to false");
        assert!(!pr.auto_scale, "auto_scale should default to false");
        // Optional fields
        assert_eq!(pr.alt_text, None);
        assert_eq!(pr.text_h_align, None);
        assert_eq!(pr.text_v_align, None);
        // effective defaults
        assert_eq!(pr.effective_text_h_align(), CommentHAlign::Left);
        assert_eq!(pr.effective_text_v_align(), CommentVAlign::Top);
    }
}
