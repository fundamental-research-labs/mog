use super::helpers::{current_timestamp, generate_guid, parse_cell_ref};

// ============================================================================
// Data Structures
// ============================================================================

/// Comment author
#[derive(Debug, Clone)]
pub struct CommentAuthor {
    /// Unique ID (index in author list)
    pub id: u32,
    /// Author display name
    pub name: String,
}

/// Rich text run in comment
#[derive(Debug, Clone)]
pub struct CommentTextRun {
    /// Text content
    pub text: String,
    /// Bold formatting
    pub bold: bool,
    /// Italic formatting
    pub italic: bool,
    /// Underline formatting
    pub underline: bool,
    /// Strike-through formatting
    pub strike: bool,
    /// Font size in points
    pub font_size: Option<f64>,
    /// Font name
    pub font_name: Option<String>,
    /// Font color (RGB hex, e.g., "FF0000")
    pub color: Option<String>,
    /// Font color by indexed palette (e.g. 81 for comment default)
    pub color_indexed: Option<u32>,
    /// Font color by theme index
    pub color_theme: Option<u32>,
    /// Font color tint (used with theme colors)
    pub color_tint: Option<f64>,
    /// Font family (numeric, e.g. 2 = Swiss/sans-serif)
    pub font_family: Option<u32>,
    /// Font scheme (e.g. "minor", "major")
    pub scheme: Option<String>,
    /// Character set (e.g. 1 for DEFAULT_CHARSET, 128 for SHIFTJIS_CHARSET)
    pub charset: Option<u32>,
    /// Whether to emit `xml:space="preserve"` on the `<t>` element.
    pub preserve_space: bool,
}

impl Default for CommentTextRun {
    fn default() -> Self {
        Self {
            text: String::new(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            font_size: None,
            font_name: None,
            color: None,
            color_indexed: None,
            color_theme: None,
            color_tint: None,
            font_family: None,
            scheme: None,
            charset: None,
            preserve_space: false,
        }
    }
}

impl CommentTextRun {
    /// Create a plain text run
    pub fn plain(text: &str) -> Self {
        Self {
            text: text.to_string(),
            ..Default::default()
        }
    }

    /// Create a bold text run
    pub fn bold(text: &str) -> Self {
        Self {
            text: text.to_string(),
            bold: true,
            ..Default::default()
        }
    }

    /// Create an italic text run
    pub fn italic(text: &str) -> Self {
        Self {
            text: text.to_string(),
            italic: true,
            ..Default::default()
        }
    }
}

/// Legacy comment
#[derive(Debug, Clone)]
pub struct LegacyComment {
    /// Cell reference (e.g., "A1", "B3")
    pub cell_ref: String,
    /// Author ID (index into authors list)
    pub author_id: u32,
    /// Rich text content
    pub text: Vec<CommentTextRun>,
    /// Whether comment is always visible
    pub visible: bool,
    /// Shape ID for VML positioning (shapeId attribute)
    pub shape_id: Option<u32>,
    /// Excel revision UID (xr:uid attribute)
    pub xr_uid: Option<String>,
    /// Legacy `<commentPr>` display properties.
    pub comment_pr: Option<ooxml_types::comments::CommentPr>,
}

impl Default for LegacyComment {
    fn default() -> Self {
        Self {
            cell_ref: String::new(),
            author_id: 0,
            text: Vec::new(),
            visible: false,
            shape_id: None,
            xr_uid: None,
            comment_pr: None,
        }
    }
}

/// A mention to write inside a `<threadedComment>`.
#[derive(Debug, Clone)]
pub struct ThreadedMention {
    /// Person ID of the mentioned user.
    pub mention_person_id: String,
    /// Zero-based start index of the mention within the plain text content.
    pub start_index: u32,
    /// Length of the mention text.
    pub length: u32,
}

/// Threaded comment (Excel 365)
#[derive(Debug, Clone)]
pub struct ThreadedComment {
    /// Unique ID (GUID format)
    pub id: String,
    /// Cell reference (e.g., "A1")
    pub cell_ref: String,
    /// Author ID (GUID format)
    pub author_id: String,
    /// Comment text (plain text only)
    pub text: String,
    /// Timestamp (ISO 8601 format)
    pub timestamp: String,
    /// Parent comment ID for replies
    pub parent_id: Option<String>,
    /// Whether comment is resolved
    pub done: bool,
    /// Raw `<extLst>...</extLst>` XML for round-trip fidelity (hyperlink metadata etc.)
    pub ext_lst_xml: Option<String>,
    /// Mentions embedded in this comment.
    pub mentions: Vec<ThreadedMention>,
}

impl Default for ThreadedComment {
    fn default() -> Self {
        Self {
            id: generate_guid(),
            cell_ref: String::new(),
            author_id: String::new(),
            text: String::new(),
            timestamp: current_timestamp(),
            parent_id: None,
            done: false,
            ext_lst_xml: None,
            mentions: Vec::new(),
        }
    }
}

/// Threaded comment author
#[derive(Debug, Clone)]
pub struct ThreadedAuthor {
    /// Unique ID (GUID format)
    pub id: String,
    /// Display name
    pub display_name: String,
    /// User ID (for identity provider)
    pub user_id: Option<String>,
    /// Provider ID
    pub provider_id: Option<String>,
}

impl Default for ThreadedAuthor {
    fn default() -> Self {
        Self {
            id: generate_guid(),
            display_name: String::new(),
            user_id: None,
            provider_id: None,
        }
    }
}

/// Comment shape positioning for VML
#[derive(Debug, Clone)]
pub struct CommentShape {
    /// Cell reference this shape is associated with
    pub cell_ref: String,
    /// Left anchor column (0-based)
    pub left_col: u32,
    /// Left offset within column (in pixels)
    pub left_offset: f64,
    /// Top anchor row (0-based)
    pub top_row: u32,
    /// Top offset within row (in pixels)
    pub top_offset: f64,
    /// Right anchor column (0-based)
    pub right_col: u32,
    /// Right offset within column (in pixels)
    pub right_offset: f64,
    /// Bottom anchor row (0-based)
    pub bottom_row: u32,
    /// Bottom offset within row (in pixels)
    pub bottom_offset: f64,
    /// Whether shape is visible
    pub visible: bool,
    /// Note callout box height in points (from domain Comment.note_height)
    pub note_height: Option<f64>,
    /// Note callout box width in points (from domain Comment.note_width)
    pub note_width: Option<f64>,
    /// Imported VML height declaration, reused only when it matches current
    /// typed geometry for this note owner.
    pub note_height_style: Option<domain_types::VmlStyleDimensionInfo>,
    /// Imported VML width declaration, reused only when it matches current
    /// typed geometry for this note owner.
    pub note_width_style: Option<domain_types::VmlStyleDimensionInfo>,
    /// Whether this shape has imported owner-scoped VML provenance.
    pub has_vml_note_provenance: bool,
}

impl Default for CommentShape {
    fn default() -> Self {
        Self {
            cell_ref: String::new(),
            left_col: 0,
            left_offset: 15.0,
            top_row: 0,
            top_offset: 2.0,
            right_col: 2,
            right_offset: 31.0,
            bottom_row: 4,
            bottom_offset: 14.0,
            visible: false,
            note_height: None,
            note_width: None,
            note_height_style: None,
            note_width_style: None,
            has_vml_note_provenance: false,
        }
    }
}

impl CommentShape {
    /// Create a default shape for a cell reference
    pub fn for_cell(cell_ref: &str) -> Self {
        let (col, row) = parse_cell_ref(cell_ref);
        Self {
            cell_ref: cell_ref.to_string(),
            left_col: col + 1,
            left_offset: 15.0,
            top_row: row,
            top_offset: 2.0,
            right_col: col + 3,
            right_offset: 31.0,
            bottom_row: row + 4,
            bottom_offset: 14.0,
            visible: false,
            note_height: None,
            note_width: None,
            note_height_style: None,
            note_width_style: None,
            has_vml_note_provenance: false,
        }
    }
}
