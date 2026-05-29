//! Read-side comments domain types.

/// A complete comments collection from a worksheet
#[derive(Debug, Clone, Default)]
pub struct Comments {
    /// List of authors who created comments
    pub authors: Vec<String>,
    /// Individual comment entries
    pub comments: Vec<Comment>,
    /// Original root element namespace declarations for round-trip fidelity.
    /// Each entry is (attr_name, attr_value), e.g. ("xmlns:mc", "http://...").
    /// Also includes non-xmlns attrs like mc:Ignorable.
    pub root_namespace_attrs: Vec<(String, String)>,
    /// Root-level `<extLst>...</extLst>` under `<comments>`, outside
    /// `<commentList>`.
    pub ext_lst_xml: Option<String>,
}

/// A single cell comment
#[derive(Debug, Clone, Default)]
pub struct Comment {
    /// Cell reference (e.g., "A1", "B3")
    pub cell_ref: String,
    /// Author ID (index into the authors list)
    pub author_id: u32,
    /// Rich text content of the comment
    pub rich_text: Vec<CommentRun>,
    /// GUID for threaded comments (optional)
    pub guid: Option<String>,
    /// Shape ID for VML positioning (optional)
    pub shape_id: Option<u32>,
    /// Excel revision UID (xr:uid attribute, for round-trip fidelity)
    pub xr_uid: Option<String>,
    /// Legacy `<commentPr>` display properties.
    pub comment_pr: Option<ooxml_types::comments::CommentPr>,
}

impl Comment {
    /// Get the plain text content of the comment (concatenated runs)
    pub fn text(&self) -> String {
        let mut result = String::new();
        for run in &self.rich_text {
            result.push_str(&run.text);
        }
        result
    }
}

/// A run of formatted text within a comment
#[derive(Debug, Clone, Default)]
pub struct CommentRun {
    /// The text content
    pub text: String,
    /// Font properties (optional)
    pub font: Option<CommentFont>,
    /// Whether the original `<t>` element had `xml:space="preserve"`.
    pub preserve_space: bool,
}

/// Font properties for a comment text run
#[derive(Debug, Clone, Default)]
pub struct CommentFont {
    /// Font name
    pub name: Option<String>,
    /// Font size in points
    pub size: Option<f64>,
    /// Bold formatting
    pub bold: bool,
    /// Italic formatting
    pub italic: bool,
    /// Underline formatting
    pub underline: bool,
    /// Strike-through formatting
    pub strike: bool,
    /// Font color (RGB hex)
    pub color: Option<String>,
    /// Font color by indexed palette (e.g. 81 for comment default)
    pub color_indexed: Option<u32>,
    /// Font color by theme index
    pub color_theme: Option<u32>,
    /// Font color tint (used with theme colors)
    pub color_tint: Option<f64>,
    /// Font family (numeric, e.g. 2 = Swiss/sans-serif)
    pub family: Option<u32>,
    /// Font scheme (e.g. "minor", "major")
    pub scheme: Option<String>,
    /// Character set (e.g. 1 for DEFAULT_CHARSET, 128 for SHIFTJIS_CHARSET)
    pub charset: Option<u32>,
}

/// Threaded comments container
#[derive(Debug, Clone, Default)]
pub struct ThreadedComments {
    /// Person list (authors in threaded comments)
    pub persons: Vec<ThreadedPerson>,
    /// Individual threaded comment entries
    pub comments: Vec<ThreadedComment>,
}

/// A person in threaded comments
#[derive(Debug, Clone, Default)]
pub struct ThreadedPerson {
    /// Display name
    pub display_name: String,
    /// Unique ID
    pub id: String,
    /// User ID (for identity provider)
    pub user_id: Option<String>,
    /// Provider ID
    pub provider_id: Option<String>,
}

/// A parsed mention element from `<mentions><mention .../></mentions>` inside a threaded comment.
#[derive(Debug, Clone, Default)]
pub struct ParsedMention {
    /// Person ID of the mentioned user (mentionpersonId attribute).
    pub mention_person_id: String,
    /// Zero-based start index of the mention within the plain text content.
    pub start_index: u32,
    /// Length of the mention text within the plain text content.
    pub length: u32,
}

/// A single threaded comment
#[derive(Debug, Clone, Default)]
pub struct ThreadedComment {
    /// Unique ID of this comment
    pub id: String,
    /// Cell reference
    pub cell_ref: String,
    /// Person ID (author)
    pub person_id: String,
    /// Parent comment ID (for replies)
    pub parent_id: Option<String>,
    /// Comment text
    pub text: String,
    /// Creation timestamp (ISO 8601)
    pub created: Option<String>,
    /// Whether this comment is done/resolved
    pub done: bool,
    /// Raw `<extLst>...</extLst>` XML for round-trip fidelity (hyperlink metadata etc.)
    pub ext_lst_xml: Option<String>,
    /// Mentions parsed from `<mentions>` child elements.
    pub mentions: Vec<ParsedMention>,
}

/// VML shape information for comment positioning
#[derive(Debug, Clone, Default)]
pub struct CommentShape {
    /// Shape ID
    pub id: String,
    /// Associated cell reference
    pub cell_ref: Option<String>,
    /// Anchor position (left column)
    pub left_column: u32,
    /// Anchor position (left offset in pixels)
    pub left_offset: u32,
    /// Anchor position (top row)
    pub top_row: u32,
    /// Anchor position (top offset in pixels)
    pub top_offset: u32,
    /// Anchor position (right column)
    pub right_column: u32,
    /// Anchor position (right offset in pixels)
    pub right_offset: u32,
    /// Anchor position (bottom row)
    pub bottom_row: u32,
    /// Anchor position (bottom offset in pixels)
    pub bottom_offset: u32,
    /// Whether the shape is visible
    pub visible: bool,
    /// Note callout box height in points (from VML style `height:NNpt`)
    pub note_height: Option<f64>,
    /// Note callout box width in points (from VML style `width:NNpt`)
    pub note_width: Option<f64>,
    /// Parsed VML height declaration, retained as typed provenance.
    pub note_height_style: Option<domain_types::VmlStyleDimensionInfo>,
    /// Parsed VML width declaration, retained as typed provenance.
    pub note_width_style: Option<domain_types::VmlStyleDimensionInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_comment_default() {
        let comment = Comment::default();
        assert!(comment.cell_ref.is_empty());
        assert_eq!(comment.author_id, 0);
        assert!(comment.rich_text.is_empty());
    }

    #[test]
    fn test_comment_text() {
        let comment = Comment {
            cell_ref: "A1".to_string(),
            author_id: 0,
            rich_text: vec![
                CommentRun {
                    text: "Hello ".to_string(),
                    font: None,
                    preserve_space: false,
                },
                CommentRun {
                    text: "World".to_string(),
                    font: None,
                    preserve_space: false,
                },
            ],
            ..Default::default()
        };
        assert_eq!(comment.text(), "Hello World");
    }
}
