use super::*;

/// A run of formatted text within a comment (output form).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentRunOutput {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    /// Underline formatting, for round-trip fidelity.
    pub underline: bool,
    /// Strike-through formatting, for round-trip fidelity.
    pub strike: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Font color by indexed palette (e.g. 81 for comment default), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_indexed: Option<u32>,
    /// Font color by theme index, for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_theme: Option<u32>,
    /// Font color tint (used with theme colors), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_tint: Option<f64>,
    /// Font family (numeric, e.g. 2 = Swiss/sans-serif), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<u32>,
    /// Font scheme (e.g. "minor", "major"), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
    /// Character set (e.g. 1 for DEFAULT_CHARSET), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub charset: Option<u32>,
    /// Vertical alignment ("superscript" or "subscript"), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vert_align: Option<String>,
    /// Whether the original `<t>` element had `xml:space="preserve"`, for round-trip fidelity.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub preserve_space: bool,
}

/// Comment output for parse result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentOutput {
    pub cell_ref: String,
    pub author_id: usize,
    pub text: String,
    /// Rich text runs preserving formatting for round-trip fidelity.
    pub runs: Vec<CommentRunOutput>,
    /// Shape ID (shapeId attribute), for VML round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<u32>,
    /// Excel revision UID (xr:uid attribute), for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xr_uid: Option<String>,
    /// Legacy `<commentPr>` display properties.
    #[serde(skip)]
    pub comment_pr: Option<ooxml_types::comments::CommentPr>,
}
