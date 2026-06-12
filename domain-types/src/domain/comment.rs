use serde::{Deserialize, Serialize};

/// Distinguishes plain text comments from those containing @mentions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommentContentType {
    Plain,
    Mention,
}

/// A mention of a user within a comment's rich text content.
/// Maps to OfficeJS CommentMention / OOXML `<threadedComment>` mention content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentMention {
    /// Display text shown for the mention (e.g. "@Jane Smith").
    pub display_text: String,
    /// User identifier (email, userId, or other identity key).
    pub user_id: String,
    /// Optional email address of the mentioned user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Zero-based start index of the mention within the plain text content.
    pub start_index: u32,
    /// Length of the mention text within the plain text content.
    pub length: u32,
}

/// Legacy VML note shape anchor.
///
/// Excel stores legacy note callout geometry in VML `<x:Anchor>` as
/// `leftColumn,leftOffset,topRow,topOffset,rightColumn,rightOffset,bottomRow,bottomOffset`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteShapeAnchor {
    pub left_column: u32,
    pub left_offset: u32,
    pub top_row: u32,
    pub top_offset: u32,
    pub right_column: u32,
    pub right_offset: u32,
    pub bottom_row: u32,
    pub bottom_offset: u32,
}

/// Whether a comment is a legacy note or a modern threaded comment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CommentType {
    /// Legacy note (from `xl/comments*.xml` without threaded counterpart).
    Note,
    /// Modern threaded comment (from `xl/threadedComments/*.xml`).
    ThreadedComment,
}

impl Default for CommentType {
    /// Modern default — `..Default::default()` on `Comment` / `AddCommentOptions`
    /// produces a threaded comment, matching Excel's default for new comments
    /// created via the cell context menu.
    fn default() -> Self {
        Self::ThreadedComment
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    /// Unique identifier for this comment.
    #[serde(default)]
    pub id: String,
    /// A1 notation (position-keyed in ParseOutput)
    pub cell_ref: String,
    pub author: String,
    /// Unique identifier of the comment author.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    /// Email address of the comment author (best-effort extraction from XLSX PersonInfo).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_email: Option<String>,
    pub content: Option<String>,
    /// Formatted text segments
    pub runs: Vec<RichTextRun>,
    pub thread_id: Option<String>,
    /// For threaded replies
    pub parent_id: Option<String>,
    /// Person GUID from person.xml (threaded comments identity).
    /// When present, links this comment to a `PersonInfo` entry in `ParseOutput.persons`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub person_id: Option<String>,
    /// Whether this comment thread is resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<bool>,
    /// ISO 8601 timestamp from the threaded comment's `dT` attribute.
    /// Preserved as a string for lossless round-tripping (e.g. "2026-01-28T02:38:50.07").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// Unix millis
    pub created_at: Option<u64>,
    /// Unix millis
    pub modified_at: Option<u64>,
    /// Excel revision UID (xr:uid attribute on `<comment>` element).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
    /// Shape ID for VML positioning (shapeId attribute on `<comment>` element).
    /// Typically 0 for legacy comments. Preserved for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<u32>,
    /// Raw `<extLst>...</extLst>` XML from threaded comment for round-trip fidelity.
    /// Contains hyperlink metadata, checksums, etc.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
    /// Content type: plain text or mention-containing.
    /// None treated as Plain for backward compatibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<CommentContentType>,
    /// Mentions embedded within the comment text.
    /// Empty vec when content_type is Plain or None.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mentions: Vec<CommentMention>,
    /// Whether this is a legacy note or a modern threaded comment.
    /// Required (single discriminator end-to-end). Reads of legacy yrs rows
    /// without a `commentType` key default to `ThreadedComment` in
    /// `yrs_schema::comment::from_yrs_map` — that's the migration site.
    #[serde(default)]
    pub comment_type: CommentType,
    /// Whether the note shape is visible (from VML `style="visibility:visible"`).
    /// Only meaningful for notes; `None` means hidden (default).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    /// Note callout box height in points (from VML <v:shape> style).
    /// Only meaningful when comment_type == CommentType::Note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_height: Option<f64>,
    /// Note callout box width in points (from VML <v:shape> style).
    /// Only meaningful when comment_type == CommentType::Note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_width: Option<f64>,
    /// Full VML note shape anchor geometry.
    /// Only meaningful when comment_type == CommentType::Note.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_shape_anchor: Option<NoteShapeAnchor>,
    /// Legacy SpreadsheetML `<commentPr>` display properties.
    ///
    /// This is note/comment package fidelity that is regenerated from typed
    /// state on export rather than replayed as raw XML.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment_pr: Option<ooxml_types::comments::CommentPr>,
}

impl Default for Comment {
    fn default() -> Self {
        Self {
            id: String::new(),
            cell_ref: String::new(),
            author: String::new(),
            author_id: None,
            author_email: None,
            content: None,
            runs: Vec::new(),
            thread_id: None,
            parent_id: None,
            person_id: None,
            resolved: None,
            timestamp: None,
            created_at: None,
            modified_at: None,
            xr_uid: None,
            shape_id: None,
            ext_lst_xml: None,
            content_type: None,
            mentions: Vec::new(),
            comment_type: CommentType::ThreadedComment,
            visible: None,
            note_height: None,
            note_width: None,
            note_shape_anchor: None,
            comment_pr: None,
        }
    }
}

/// Person identity for threaded comments.
/// Stored at workbook level in `ParseOutput.persons`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonInfo {
    /// GUID (e.g. "{DCF80C0B-8D7B-4F8A-98C0-0B0B9540AAD8}")
    pub id: String,
    /// Display name (e.g. "Logan Hancock")
    pub display_name: String,
    /// User ID for identity provider (e.g. "S::user@org.onmicrosoft.com::uuid")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// Provider ID (e.g. "AD")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct RichTextRun {
    pub text: String,
    pub font_name: Option<String>,
    /// Points
    pub font_size: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub underline_style: Option<ooxml_types::styles::UnderlineStyle>,
    pub underline: bool,
    pub strikethrough: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outline: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condense: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extend: Option<bool>,
    /// Resolved RGB "#RRGGBB"
    pub color: Option<String>,
    /// Font color by indexed palette (e.g. 81 for default comment text color).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_indexed: Option<u32>,
    /// Font color by theme index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_theme: Option<u32>,
    /// Font color tint modifier (used with theme colors, range -1.0 to 1.0).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
    pub charset: Option<u32>,
    pub family: Option<u32>,
    pub scheme: Option<String>,
    /// Vertical alignment: "superscript" or "subscript" (from `<vertAlign val="..."/>`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
    /// Whether the `<t>` element had `xml:space="preserve"`.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub preserve_space: bool,
}

/// Options for adding a comment.
///
/// `comment_type` is mandatory — callers must explicitly indicate whether
/// they're adding a legacy note or a modern threaded comment. The `Default`
/// derive picks `CommentType::ThreadedComment` (modern default), so
/// `..Default::default()` continues to compile.
#[derive(Debug, Clone, Default)]
pub struct AddCommentOptions {
    /// Unique identifier of the comment author.
    pub author_id: Option<String>,
    /// Threaded-comment person GUID stored in workbook-level `PersonInfo`.
    pub person_id: Option<String>,
    /// Parent comment ID when replying to an existing comment.
    pub parent_id: Option<String>,
    /// Plain text content for modern threaded comments.
    pub content: Option<String>,
    /// Thread resolved state. Threaded comments default to unresolved at callers.
    pub resolved: Option<bool>,
    /// ISO 8601 timestamp for modern threaded comments.
    pub timestamp: Option<String>,
    /// Content type: plain text or mention-containing.
    pub content_type: Option<CommentContentType>,
    /// Mentions embedded within the comment text.
    pub mentions: Option<Vec<CommentMention>>,
    /// Whether to add a legacy note or a modern threaded comment.
    /// Required (single discriminator end-to-end).
    pub comment_type: CommentType,
}
