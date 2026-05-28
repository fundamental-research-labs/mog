//! Comments writer for XLSX worksheets.
//!
//! This module provides writers for generating comment XML files in XLSX format, including:
//! - `xl/comments*.xml` - Legacy cell comments with rich text formatting
//! - `xl/drawings/vmlDrawing*.vml` - VML shape positioning for legacy comments
//! - `xl/threadedComments/threadedComment*.xml` - Modern threaded comments (Excel 365)
//! - `xl/persons/person.xml` - Person list for threaded comments
//!
//! # XLSX Comments Structure
//!
//! Comments in XLSX consist of multiple related files:
//! 1. `xl/comments*.xml` - Comment content and author information
//! 2. `xl/drawings/vmlDrawing*.vml` - Legacy VML positioning for comment shapes
//! 3. `xl/threadedComments/threadedComment*.xml` - Modern threaded comments
//! 4. `xl/persons/person.xml` - Author information for threaded comments
//!
//! # Example Usage
//!
//! ## Legacy Comments
//!
//! ```ignore
//! use xlsx_parser::write::comments_writer::CommentsWriter;
//!
//! let mut writer = CommentsWriter::new();
//! writer
//!     .add_simple("A1", "John Doe", "This is a comment")
//!     .add_simple("B2", "Jane Smith", "Another comment");
//!
//! let comments_xml = writer.to_xml();
//! let vml_xml = writer.to_vml();
//! ```
//!
//! ## Threaded Comments (Excel 365)
//!
//! ```ignore
//! use xlsx_parser::write::comments_writer::ThreadedCommentsWriter;
//!
//! let mut writer = ThreadedCommentsWriter::new();
//! let author_id = writer.add_author("John Doe");
//! writer.add_simple("A1", &author_id, "This is a threaded comment");
//!
//! let comments_xml = writer.to_xml();
//! let persons_xml = writer.to_persons_xml();
//! ```

use crate::write::xml_writer::XmlWriter;
use domain_types::domain::comment::CommentType;

// ============================================================================
// Constants
// ============================================================================

/// Main namespace for spreadsheetml
const SPREADSHEETML_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/// Markup compatibility namespace (for mc:Ignorable)
const MC_NS: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

/// Excel revision namespace (xr:uid on comment elements)
const XR_NS: &str = "http://schemas.microsoft.com/office/spreadsheetml/2014/revision";

/// Threaded comments namespace (Excel 365)
const THREADED_COMMENTS_NS: &str =
    "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";

/// VML namespace
const VML_NS: &str = "urn:schemas-microsoft-com:vml";

/// Office namespace for VML
const OFFICE_NS: &str = "urn:schemas-microsoft-com:office:office";

/// Excel namespace for VML
const EXCEL_NS: &str = "urn:schemas-microsoft-com:office:excel";

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
        }
    }
}

// ============================================================================
// Legacy Comments Writer
// ============================================================================

/// Writer for legacy Excel comments (comments.xml)
#[derive(Debug, Clone, Default)]
pub struct CommentsWriter {
    authors: Vec<CommentAuthor>,
    comments: Vec<LegacyComment>,
    shapes: Vec<CommentShape>,
    /// Original root element namespace declarations for round-trip fidelity.
    /// Each entry is (attr_name, attr_value), e.g. ("xmlns:mc", "http://...").
    /// When set, these are emitted instead of the hardcoded defaults.
    root_namespace_attrs: Vec<(String, String)>,
}

impl CommentsWriter {
    /// Create a new empty comments writer
    pub fn new() -> Self {
        Self::default()
    }

    /// Set preserved root namespace declarations for round-trip fidelity.
    ///
    /// When set, these declarations are emitted on the root `<comments>` element
    /// instead of the hardcoded defaults, preserving the original prefix assignments
    /// and declaration order.
    pub fn set_root_namespace_attrs(&mut self, attrs: Vec<(String, String)>) {
        self.root_namespace_attrs = attrs;
    }

    /// Add an author and return their ID
    pub fn add_author(&mut self, name: &str) -> u32 {
        let id = self.authors.len() as u32;
        self.authors.push(CommentAuthor {
            id,
            name: name.to_string(),
        });
        id
    }

    /// Get or create an author by name, returns their ID
    pub fn get_or_create_author(&mut self, name: &str) -> u32 {
        // Check if author already exists
        for author in &self.authors {
            if author.name == name {
                return author.id;
            }
        }
        // Create new author
        self.add_author(name)
    }

    /// Add a comment
    pub fn add_comment(&mut self, comment: LegacyComment) -> &mut Self {
        // Create default shape for this comment
        let shape = CommentShape::for_cell(&comment.cell_ref);
        self.shapes.push(shape);
        self.comments.push(comment);
        self
    }

    /// Add a simple text comment
    pub fn add_simple(&mut self, cell_ref: &str, author: &str, text: &str) -> &mut Self {
        let author_id = self.get_or_create_author(author);
        let comment = LegacyComment {
            cell_ref: cell_ref.to_string(),
            author_id,
            text: vec![
                CommentTextRun {
                    text: format!("{}:\n", author),
                    bold: true,
                    font_size: Some(9.0),
                    font_name: Some("Tahoma".to_string()),
                    ..Default::default()
                },
                CommentTextRun {
                    text: text.to_string(),
                    font_size: Some(9.0),
                    font_name: Some("Tahoma".to_string()),
                    ..Default::default()
                },
            ],
            visible: false,
            shape_id: None,
            xr_uid: None,
        };
        self.add_comment(comment)
    }

    /// Add comment with custom shape positioning
    pub fn add_with_shape(&mut self, comment: LegacyComment, shape: CommentShape) -> &mut Self {
        self.shapes.push(shape);
        self.comments.push(comment);
        self
    }

    /// Check if there are any comments
    pub fn is_empty(&self) -> bool {
        self.comments.is_empty()
    }

    /// Get the number of comments
    pub fn len(&self) -> usize {
        self.comments.len()
    }

    /// Generate comments.xml content
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        // Start comments element.  When preserved root namespace attributes are
        // available (round-trip from an existing file), replay them verbatim
        // to maintain round-trip fidelity (preserving prefixes and order).
        w.start_element("comments");

        if !self.root_namespace_attrs.is_empty() {
            // Emit preserved namespace declarations from the original file.
            for (attr_name, attr_value) in &self.root_namespace_attrs {
                w.attr(attr_name, attr_value);
            }
        } else {
            // Fallback: synthesize namespace declarations.
            // Only include mc/xr namespaces when at least one comment actually
            // carries an xr:uid attribute. Adding them unconditionally causes
            // semantic diffs on files whose original comments had no xr:uid.
            w.attr("xmlns", SPREADSHEETML_NS);
            let has_xr_uid = self.comments.iter().any(|c| c.xr_uid.is_some());
            if has_xr_uid {
                w.attr("xmlns:mc", MC_NS)
                    .attr("mc:Ignorable", "xr")
                    .attr("xmlns:xr", XR_NS);
            }
        }
        w.end_attrs();

        // Write authors
        w.start_element("authors").end_attrs();
        for author in &self.authors {
            w.element_with_text("author", &author.name);
        }
        w.end_element("authors");

        // Write comment list
        w.start_element("commentList").end_attrs();
        for comment in &self.comments {
            self.write_comment(&mut w, comment);
        }
        w.end_element("commentList");

        w.end_element("comments");

        w.finish()
    }

    /// Generate VML drawing for comment shapes
    pub fn to_vml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        // VML doesn't use XML declaration
        w.start_element("xml")
            .attr("xmlns:v", VML_NS)
            .attr("xmlns:o", OFFICE_NS)
            .attr("xmlns:x", EXCEL_NS)
            .end_attrs();

        // Shape layout
        w.start_element_ns("o", "shapelayout")
            .attr("v:ext", "edit")
            .end_attrs();
        w.start_element_ns("o", "idmap")
            .attr("v:ext", "edit")
            .attr("data", "1")
            .self_close();
        w.end_element_ns("o", "shapelayout");

        // Shape type definition for notes
        w.start_element_ns("v", "shapetype")
            .attr("id", "_x0000_t202")
            .attr("coordsize", "21600,21600")
            .attr("o:spt", "202")
            .attr("path", "m,l,21600r21600,l21600,xe")
            .end_attrs();
        w.start_element_ns("v", "stroke")
            .attr("joinstyle", "miter")
            .self_close();
        w.start_element_ns("v", "path")
            .attr("gradientshapeok", "t")
            .attr("o:connecttype", "rect")
            .self_close();
        w.end_element_ns("v", "shapetype");

        // Write shapes for each comment
        for (index, shape) in self.shapes.iter().enumerate() {
            self.write_vml_shape(&mut w, shape, index);
        }

        w.end_element("xml");

        w.finish()
    }

    /// Write a single comment element
    fn write_comment(&self, w: &mut XmlWriter, comment: &LegacyComment) {
        w.start_element("comment")
            .attr("ref", &comment.cell_ref)
            .attr_num("authorId", comment.author_id);
        if let Some(shape_id) = comment.shape_id {
            w.attr_num("shapeId", shape_id);
        }
        if let Some(ref uid) = comment.xr_uid {
            w.attr("xr:uid", uid);
        }
        w.end_attrs();

        // Write text element with rich text runs
        w.start_element("text").end_attrs();

        if comment.text.is_empty() {
            // Empty text element
            w.start_element("t").end_attrs().end_element("t");
        } else if comment.text.len() == 1 && !self.has_formatting(&comment.text[0]) {
            // Simple text without formatting
            let run = &comment.text[0];
            let t = w.start_element("t");
            if run.preserve_space {
                t.attr("xml:space", "preserve");
            }
            t.end_attrs().text(&run.text).end_element("t");
        } else {
            // Rich text with runs
            for run in &comment.text {
                self.write_text_run(w, run);
            }
        }

        w.end_element("text");
        w.end_element("comment");
    }

    /// Check if a text run has any formatting
    fn has_formatting(&self, run: &CommentTextRun) -> bool {
        run.bold
            || run.italic
            || run.underline
            || run.strike
            || run.font_size.is_some()
            || run.font_name.is_some()
            || run.color.is_some()
            || run.color_indexed.is_some()
            || run.color_theme.is_some()
            || run.font_family.is_some()
            || run.scheme.is_some()
            || run.charset.is_some()
    }

    /// Write a rich text run element
    fn write_text_run(&self, w: &mut XmlWriter, run: &CommentTextRun) {
        w.start_element("r").end_attrs();

        // Write run properties if any formatting
        if self.has_formatting(run) {
            w.start_element("rPr").end_attrs();

            if run.bold {
                w.start_element("b").self_close();
            }
            if run.italic {
                w.start_element("i").self_close();
            }
            if run.underline {
                w.start_element("u").self_close();
            }
            if run.strike {
                w.start_element("strike").self_close();
            }
            if let Some(size) = run.font_size {
                w.start_element("sz").attr_num("val", size).self_close();
            }
            if let Some(indexed) = run.color_indexed {
                w.start_element("color")
                    .attr_num("indexed", indexed)
                    .self_close();
            } else if let Some(theme) = run.color_theme {
                let el = w.start_element("color").attr_num("theme", theme);
                if let Some(tint) = run.color_tint {
                    el.attr_num("tint", tint);
                }
                el.self_close();
            } else if let Some(ref color) = run.color {
                w.start_element("color").attr("rgb", color).self_close();
            }
            if let Some(ref font) = run.font_name {
                w.start_element("rFont").attr("val", font).self_close();
            }
            if let Some(family) = run.font_family {
                w.start_element("family")
                    .attr_num("val", family)
                    .self_close();
            }
            if let Some(ref scheme) = run.scheme {
                w.start_element("scheme").attr("val", scheme).self_close();
            }
            if let Some(charset) = run.charset {
                w.start_element("charset")
                    .attr_num("val", charset)
                    .self_close();
            }

            w.end_element("rPr");
        }

        // Write text content — only emit xml:space="preserve" when the original had it.
        let t = w.start_element("t");
        if run.preserve_space {
            t.attr("xml:space", "preserve");
        }
        t.end_attrs().text(&run.text).end_element("t");

        w.end_element("r");
    }

    /// Write a VML shape for a comment
    fn write_vml_shape(&self, w: &mut XmlWriter, shape: &CommentShape, index: usize) {
        let shape_id = format!("_x0000_s{}", 1025 + index);
        let (col, row) = parse_cell_ref(&shape.cell_ref);

        // Calculate style
        let visibility = if shape.visible { "visible" } else { "hidden" };
        let width_pt = shape.note_width.unwrap_or(96.0);
        let height_pt = shape.note_height.unwrap_or(55.5);
        let style = format!(
            "position:absolute;margin-left:{}pt;margin-top:{}pt;width:{}pt;height:{}pt;z-index:{};visibility:{}",
            shape.left_offset + (shape.left_col as f64 * 64.0),
            shape.top_offset + (shape.top_row as f64 * 15.0),
            width_pt,
            height_pt,
            index + 1,
            visibility
        );

        w.start_element_ns("v", "shape")
            .attr("id", &shape_id)
            .attr("type", "#_x0000_t202")
            .attr("style", &style)
            .attr("fillcolor", "#ffffe1")
            .attr("o:insetmode", "auto")
            .end_attrs();

        // Fill
        w.start_element_ns("v", "fill")
            .attr("color2", "#ffffe1")
            .self_close();

        // Shadow
        w.start_element_ns("v", "shadow")
            .attr("color", "black")
            .attr("obscured", "t")
            .self_close();

        // Path
        w.start_element_ns("v", "path")
            .attr("o:connecttype", "none")
            .self_close();

        // Textbox
        w.start_element_ns("v", "textbox")
            .attr("style", "mso-direction-alt:auto")
            .end_attrs();
        w.raw_str("<div style=\"text-align:left\"/>");
        w.end_element_ns("v", "textbox");

        // Client data
        w.start_element_ns("x", "ClientData")
            .attr("ObjectType", "Note")
            .end_attrs();

        w.start_element_ns("x", "MoveWithCells").self_close();
        w.start_element_ns("x", "SizeWithCells").self_close();

        // Anchor: left_col, left_offset, top_row, top_offset, right_col, right_offset, bottom_row, bottom_offset
        let anchor = format!(
            "{}, {}, {}, {}, {}, {}, {}, {}",
            shape.left_col,
            shape.left_offset as u32,
            shape.top_row,
            shape.top_offset as u32,
            shape.right_col,
            shape.right_offset as u32,
            shape.bottom_row,
            shape.bottom_offset as u32
        );
        w.element_with_text_and_attrs("x:Anchor", &[], &anchor);

        w.element_with_text("x:AutoFill", "False");
        w.element_with_text("x:Row", &row.to_string());
        w.element_with_text("x:Column", &col.to_string());

        w.end_element_ns("x", "ClientData");
        w.end_element_ns("v", "shape");
    }
}

// ============================================================================
// Threaded Comments Writer
// ============================================================================

/// Writer for threaded comments (Excel 365)
#[derive(Debug, Clone, Default)]
pub struct ThreadedCommentsWriter {
    authors: Vec<ThreadedAuthor>,
    comments: Vec<ThreadedComment>,
}

impl ThreadedCommentsWriter {
    /// Create a new empty threaded comments writer
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an author and return their ID (GUID)
    pub fn add_author(&mut self, display_name: &str) -> String {
        let author = ThreadedAuthor {
            id: generate_guid(),
            display_name: display_name.to_string(),
            user_id: None,
            provider_id: None,
        };
        let id = author.id.clone();
        self.authors.push(author);
        id
    }

    /// Add an author with full details
    pub fn add_author_full(&mut self, author: ThreadedAuthor) -> String {
        let id = author.id.clone();
        self.authors.push(author);
        id
    }

    /// Get an author ID by display name, or None if not found
    pub fn get_author_id(&self, display_name: &str) -> Option<String> {
        self.authors
            .iter()
            .find(|a| a.display_name == display_name)
            .map(|a| a.id.clone())
    }

    /// Add a comment
    pub fn add_comment(&mut self, comment: ThreadedComment) -> &mut Self {
        self.comments.push(comment);
        self
    }

    /// Add a simple threaded comment
    pub fn add_simple(&mut self, cell_ref: &str, author_id: &str, text: &str) -> &mut Self {
        let comment = ThreadedComment {
            id: generate_guid(),
            cell_ref: cell_ref.to_string(),
            author_id: author_id.to_string(),
            text: text.to_string(),
            timestamp: current_timestamp(),
            parent_id: None,
            done: false,
            ext_lst_xml: None,
            mentions: Vec::new(),
        };
        self.comments.push(comment);
        self
    }

    /// Add a reply to an existing comment
    pub fn add_reply(&mut self, parent_id: &str, author_id: &str, text: &str) -> &mut Self {
        // Find parent comment to get cell_ref
        let cell_ref = self
            .comments
            .iter()
            .find(|c| c.id == parent_id)
            .map(|c| c.cell_ref.clone())
            .unwrap_or_default();

        let comment = ThreadedComment {
            id: generate_guid(),
            cell_ref,
            author_id: author_id.to_string(),
            text: text.to_string(),
            timestamp: current_timestamp(),
            parent_id: Some(parent_id.to_string()),
            done: false,
            ext_lst_xml: None,
            mentions: Vec::new(),
        };
        self.comments.push(comment);
        self
    }

    /// Check if there are any comments
    pub fn is_empty(&self) -> bool {
        self.comments.is_empty()
    }

    /// Get the number of comments
    pub fn len(&self) -> usize {
        self.comments.len()
    }

    /// Generate threadedComment.xml content
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        w.start_element("ThreadedComments")
            .attr("xmlns", THREADED_COMMENTS_NS)
            .end_attrs();

        for comment in &self.comments {
            self.write_threaded_comment(&mut w, comment);
        }

        w.end_element("ThreadedComments");

        w.finish()
    }

    /// Generate persons.xml content (author list)
    pub fn to_persons_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        w.write_declaration();

        w.start_element("personList")
            .attr("xmlns", THREADED_COMMENTS_NS)
            .end_attrs();

        for author in &self.authors {
            w.start_element("person")
                .attr("displayName", &author.display_name)
                .attr("id", &author.id);

            if let Some(ref user_id) = author.user_id {
                w.attr("userId", user_id);
            }
            if let Some(ref provider_id) = author.provider_id {
                w.attr("providerId", provider_id);
            }

            w.self_close();
        }

        w.end_element("personList");

        w.finish()
    }

    /// Write a single threaded comment element
    fn write_threaded_comment(&self, w: &mut XmlWriter, comment: &ThreadedComment) {
        w.start_element("threadedComment")
            .attr("ref", &comment.cell_ref)
            .attr("dT", &comment.timestamp)
            .attr("personId", &comment.author_id)
            .attr("id", &comment.id);

        if let Some(ref parent_id) = comment.parent_id {
            w.attr("parentId", parent_id);
        }

        if comment.done {
            w.attr("done", "1");
        }

        w.end_attrs();

        // Emit xml:space="preserve" when text has leading/trailing whitespace
        let needs_preserve = comment.text.starts_with(|c: char| c.is_whitespace())
            || comment.text.ends_with(|c: char| c.is_whitespace());
        if needs_preserve {
            w.start_element("text")
                .attr("xml:space", "preserve")
                .end_attrs()
                .text(&comment.text)
                .end_element("text");
        } else {
            w.element_with_text("text", &comment.text);
        }

        // Emit preserved extLst (hyperlink metadata etc.) for round-trip fidelity
        if let Some(ref ext) = comment.ext_lst_xml {
            if !crate::infra::xml::raw_xml_contains_relationship_attr(ext) {
                w.raw(ext.as_bytes());
            }
        }

        // Emit mentions if present
        if !comment.mentions.is_empty() {
            w.start_element("mentions").end_attrs();
            for m in &comment.mentions {
                w.start_element("mention")
                    .attr("mentionpersonId", &m.mention_person_id)
                    .attr("startIndex", &m.start_index.to_string())
                    .attr("length", &m.length.to_string())
                    .self_close();
            }
            w.end_element("mentions");
        }

        w.end_element("threadedComment");
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Generate a GUID in standard format: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}
pub fn generate_guid() -> String {
    // Simple pseudo-random GUID based on time and a counter
    // In production, you'd want a proper UUID library
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let timestamp = standalone_unix_nanos() as u64;

    let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    // Mix timestamp and counter for uniqueness
    let a = (timestamp & 0xFFFFFFFF) as u32;
    let b = ((timestamp >> 32) & 0xFFFF) as u16;
    let c = (counter & 0xFFFF) as u16 | 0x4000; // Version 4
    let d = ((counter >> 16) & 0x3FFF) as u16 | 0x8000; // Variant
    let e = ((timestamp >> 48) as u64 | (counter << 16)) & 0xFFFFFFFFFFFF;

    format!("{{{:08X}-{:04X}-{:04X}-{:04X}-{:012X}}}", a, b, c, d, e)
}

/// Get current timestamp in ISO 8601 format
fn current_timestamp() -> String {
    let ms = standalone_unix_millis();
    let (secs, subsec_millis) = (ms / 1000, (ms % 1000) as u32);

    // Convert to datetime components
    // This is a simplified version - in production use chrono or time crate
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;

    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let millis = subsec_millis;

    // Calculate year, month, day from days since epoch
    let mut year = 1970;
    let mut remaining_days = days_since_epoch as i64;

    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: [i64; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for &days in &days_in_months {
        if remaining_days < days {
            break;
        }
        remaining_days -= days;
        month += 1;
    }

    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}",
        year, month, day, hours, minutes, seconds, millis
    )
}

fn standalone_unix_millis() -> u64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        js_sys::Date::now() as u64
    }
}

fn standalone_unix_nanos() -> u128 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};

        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    }
    #[cfg(target_arch = "wasm32")]
    {
        (js_sys::Date::now() * 1_000_000.0) as u128
    }
}

/// Check if a year is a leap year
fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Parse a cell reference (e.g., "A1") into (column, row) indices (0-based)
fn parse_cell_ref(cell_ref: &str) -> (u32, u32) {
    let mut col: u32 = 0;
    let mut row: u32 = 0;
    let mut in_col = true;

    for c in cell_ref.chars() {
        if in_col {
            if c.is_ascii_alphabetic() {
                col = col * 26 + (c.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
            } else {
                in_col = false;
                if c.is_ascii_digit() {
                    row = c as u32 - '0' as u32;
                }
            }
        } else if c.is_ascii_digit() {
            row = row * 10 + (c as u32 - '0' as u32);
        }
    }

    // Convert to 0-based
    (col.saturating_sub(1), row.saturating_sub(1))
}

/// Convert column and row indices (0-based) to cell reference
#[cfg(test)]
fn indices_to_cell_ref(col: u32, row: u32) -> String {
    let mut col_str = String::new();
    let mut c = col;

    loop {
        col_str.insert(0, (b'A' + (c % 26) as u8) as char);
        if c < 26 {
            break;
        }
        c = c / 26 - 1;
    }

    format!("{}{}", col_str, row + 1)
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_generate_guid() {
        let guid1 = generate_guid();
        let guid2 = generate_guid();

        // Should have correct format
        assert!(guid1.starts_with('{'));
        assert!(guid1.ends_with('}'));
        assert_eq!(guid1.len(), 38); // {8-4-4-4-12} = 36 chars + 2 braces

        // Should be unique
        assert_ne!(guid1, guid2);
    }

    #[test]
    fn test_parse_cell_ref() {
        assert_eq!(parse_cell_ref("A1"), (0, 0));
        assert_eq!(parse_cell_ref("B1"), (1, 0));
        assert_eq!(parse_cell_ref("Z1"), (25, 0));
        assert_eq!(parse_cell_ref("AA1"), (26, 0));
        assert_eq!(parse_cell_ref("AB1"), (27, 0));
        assert_eq!(parse_cell_ref("A100"), (0, 99));
        assert_eq!(parse_cell_ref("XFD1048576"), (16383, 1048575));
    }

    #[test]
    fn test_indices_to_cell_ref() {
        assert_eq!(indices_to_cell_ref(0, 0), "A1");
        assert_eq!(indices_to_cell_ref(1, 0), "B1");
        assert_eq!(indices_to_cell_ref(25, 0), "Z1");
        assert_eq!(indices_to_cell_ref(26, 0), "AA1");
        assert_eq!(indices_to_cell_ref(27, 0), "AB1");
        assert_eq!(indices_to_cell_ref(0, 99), "A100");
    }

    #[test]
    fn test_current_timestamp() {
        let ts = current_timestamp();
        // Should be in ISO 8601 format
        assert!(ts.contains('T'));
        assert!(ts.contains('-'));
        assert!(ts.contains(':'));
        assert!(ts.contains('.'));
    }

    // -------------------------------------------------------------------------
    // CommentTextRun tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_comment_text_run_plain() {
        let run = CommentTextRun::plain("Hello");
        assert_eq!(run.text, "Hello");
        assert!(!run.bold);
        assert!(!run.italic);
    }

    #[test]
    fn test_comment_text_run_bold() {
        let run = CommentTextRun::bold("Bold text");
        assert_eq!(run.text, "Bold text");
        assert!(run.bold);
        assert!(!run.italic);
    }

    #[test]
    fn test_comment_text_run_italic() {
        let run = CommentTextRun::italic("Italic text");
        assert_eq!(run.text, "Italic text");
        assert!(!run.bold);
        assert!(run.italic);
    }

    // -------------------------------------------------------------------------
    // CommentsWriter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_comments_writer_new() {
        let writer = CommentsWriter::new();
        assert!(writer.is_empty());
        assert_eq!(writer.len(), 0);
    }

    #[test]
    fn test_comments_writer_add_author() {
        let mut writer = CommentsWriter::new();
        let id1 = writer.add_author("John Doe");
        let id2 = writer.add_author("Jane Smith");

        assert_eq!(id1, 0);
        assert_eq!(id2, 1);
    }

    #[test]
    fn test_comments_writer_get_or_create_author() {
        let mut writer = CommentsWriter::new();
        let id1 = writer.get_or_create_author("John Doe");
        let id2 = writer.get_or_create_author("John Doe");
        let id3 = writer.get_or_create_author("Jane Smith");

        assert_eq!(id1, 0);
        assert_eq!(id2, 0); // Same author, same ID
        assert_eq!(id3, 1);
    }

    #[test]
    fn test_comments_writer_add_simple() {
        let mut writer = CommentsWriter::new();
        writer.add_simple("A1", "John Doe", "Test comment");

        assert_eq!(writer.len(), 1);
        assert!(!writer.is_empty());
    }

    #[test]
    fn test_comments_writer_to_xml() {
        let mut writer = CommentsWriter::new();
        writer.add_simple("A1", "John Doe", "Test comment");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Check XML structure
        assert!(xml_str.contains("<?xml version=\"1.0\""));
        assert!(xml_str.contains("<comments xmlns="));
        assert!(xml_str.contains("<authors>"));
        assert!(xml_str.contains("<author>John Doe</author>"));
        assert!(xml_str.contains("<commentList>"));
        assert!(xml_str.contains("ref=\"A1\""));
        assert!(xml_str.contains("authorId=\"0\""));
        assert!(xml_str.contains("Test comment"));
    }

    #[test]
    fn test_comments_writer_to_xml_rich_text() {
        let mut writer = CommentsWriter::new();
        let author_id = writer.add_author("User");

        let comment = LegacyComment {
            cell_ref: "B2".to_string(),
            author_id,
            text: vec![
                CommentTextRun {
                    text: "Bold ".to_string(),
                    bold: true,
                    font_size: Some(11.0),
                    ..Default::default()
                },
                CommentTextRun {
                    text: "Normal".to_string(),
                    ..Default::default()
                },
            ],
            visible: false,
            shape_id: None,
            xr_uid: None,
        };
        writer.add_comment(comment);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<r>"));
        assert!(xml_str.contains("<rPr>"));
        assert!(xml_str.contains("<b/>"));
        assert!(xml_str.contains("val=\"11\""));
        assert!(xml_str.contains("Bold "));
        assert!(xml_str.contains("Normal"));
    }

    #[test]
    fn test_comments_writer_to_vml() {
        let mut writer = CommentsWriter::new();
        writer.add_simple("A1", "John Doe", "Test comment");

        let vml = writer.to_vml();
        let vml_str = String::from_utf8(vml).unwrap();

        // Check VML structure
        assert!(vml_str.contains("xmlns:v=\"urn:schemas-microsoft-com:vml\""));
        assert!(vml_str.contains("xmlns:o=\"urn:schemas-microsoft-com:office:office\""));
        assert!(vml_str.contains("xmlns:x=\"urn:schemas-microsoft-com:office:excel\""));
        assert!(vml_str.contains("<o:shapelayout"));
        assert!(vml_str.contains("<v:shapetype"));
        assert!(vml_str.contains("<v:shape"));
        assert!(vml_str.contains("ObjectType=\"Note\""));
        assert!(vml_str.contains("<x:Anchor>"));
        assert!(vml_str.contains("<x:Row>"));
        assert!(vml_str.contains("<x:Column>"));
    }

    #[test]
    fn test_comments_writer_multiple_comments() {
        let mut writer = CommentsWriter::new();
        writer
            .add_simple("A1", "User1", "First comment")
            .add_simple("B2", "User2", "Second comment")
            .add_simple("C3", "User1", "Third comment");

        assert_eq!(writer.len(), 3);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("ref=\"A1\""));
        assert!(xml_str.contains("ref=\"B2\""));
        assert!(xml_str.contains("ref=\"C3\""));
        assert!(xml_str.contains("<author>User1</author>"));
        assert!(xml_str.contains("<author>User2</author>"));
    }

    // -------------------------------------------------------------------------
    // ThreadedCommentsWriter tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_threaded_writer_new() {
        let writer = ThreadedCommentsWriter::new();
        assert!(writer.is_empty());
        assert_eq!(writer.len(), 0);
    }

    #[test]
    fn test_threaded_writer_add_author() {
        let mut writer = ThreadedCommentsWriter::new();
        let id = writer.add_author("John Doe");

        assert!(!id.is_empty());
        assert!(id.starts_with('{'));
        assert!(id.ends_with('}'));
    }

    #[test]
    fn test_threaded_writer_add_simple() {
        let mut writer = ThreadedCommentsWriter::new();
        let author_id = writer.add_author("John Doe");
        writer.add_simple("A1", &author_id, "Test comment");

        assert_eq!(writer.len(), 1);
    }

    #[test]
    fn test_threaded_writer_add_reply() {
        let mut writer = ThreadedCommentsWriter::new();
        let author1 = writer.add_author("User1");
        let author2 = writer.add_author("User2");

        writer.add_simple("A1", &author1, "Original comment");
        let parent_id = writer.comments[0].id.clone();

        writer.add_reply(&parent_id, &author2, "Reply to original");

        assert_eq!(writer.len(), 2);
        assert!(writer.comments[1].parent_id.is_some());
        assert_eq!(writer.comments[1].parent_id.as_ref().unwrap(), &parent_id);
    }

    #[test]
    fn test_threaded_writer_to_xml() {
        let mut writer = ThreadedCommentsWriter::new();
        let author_id = writer.add_author("John Doe");
        writer.add_simple("A1", &author_id, "Test comment");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<?xml version=\"1.0\""));
        assert!(xml_str.contains("<ThreadedComments xmlns="));
        assert!(
            xml_str.contains(
                "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"
            )
        );
        assert!(xml_str.contains("<threadedComment"));
        assert!(xml_str.contains("ref=\"A1\""));
        assert!(xml_str.contains("personId="));
        assert!(xml_str.contains("dT="));
        assert!(xml_str.contains("<text>Test comment</text>"));
    }

    #[test]
    fn test_threaded_writer_to_xml_with_reply() {
        let mut writer = ThreadedCommentsWriter::new();
        let author1 = writer.add_author("User1");
        let author2 = writer.add_author("User2");

        writer.add_simple("A1", &author1, "Original");
        let parent_id = writer.comments[0].id.clone();
        writer.add_reply(&parent_id, &author2, "Reply");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("parentId="));
    }

    #[test]
    fn test_threaded_writer_to_persons_xml() {
        let mut writer = ThreadedCommentsWriter::new();
        writer.add_author("John Doe");
        writer.add_author("Jane Smith");

        let xml = writer.to_persons_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("<?xml version=\"1.0\""));
        assert!(xml_str.contains("<personList xmlns="));
        assert!(xml_str.contains("<person"));
        assert!(xml_str.contains("displayName=\"John Doe\""));
        assert!(xml_str.contains("displayName=\"Jane Smith\""));
        assert!(xml_str.contains("id=\"{"));
    }

    #[test]
    fn test_threaded_writer_done_comment() {
        let mut writer = ThreadedCommentsWriter::new();
        let author_id = writer.add_author("User");

        let comment = ThreadedComment {
            id: generate_guid(),
            cell_ref: "A1".to_string(),
            author_id: author_id.clone(),
            text: "Resolved comment".to_string(),
            timestamp: current_timestamp(),
            parent_id: None,
            done: true,
            ext_lst_xml: None,
            mentions: Vec::new(),
        };
        writer.add_comment(comment);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("done=\"1\""));
    }

    // -------------------------------------------------------------------------
    // CommentShape tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_comment_shape_for_cell() {
        let shape = CommentShape::for_cell("A1");
        assert_eq!(shape.cell_ref, "A1");
        assert_eq!(shape.left_col, 1);
        assert_eq!(shape.top_row, 0);
        assert!(!shape.visible);
    }

    #[test]
    fn test_comment_shape_for_cell_b5() {
        let shape = CommentShape::for_cell("B5");
        assert_eq!(shape.cell_ref, "B5");
        assert_eq!(shape.left_col, 2); // B is col 1, so left_col = 1 + 1 = 2
        assert_eq!(shape.top_row, 4); // Row 5 is index 4
    }

    // -------------------------------------------------------------------------
    // Integration tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_roundtrip_comments_xml() {
        let mut writer = CommentsWriter::new();
        writer
            .add_simple("A1", "Author1", "Comment 1")
            .add_simple("B2", "Author2", "Comment 2");

        let xml = writer.to_xml();

        // Parse it back (basic validation)
        let xml_str = String::from_utf8(xml).unwrap();
        assert!(xml_str.contains("Comment 1"));
        assert!(xml_str.contains("Comment 2"));
        assert!(xml_str.contains("Author1"));
        assert!(xml_str.contains("Author2"));
    }

    #[test]
    fn test_xml_escaping_in_comments() {
        let mut writer = CommentsWriter::new();
        writer.add_simple("A1", "John & Jane", "Test <tag> & \"quotes\"");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Should have escaped entities in author name (appears in text content)
        assert!(xml_str.contains("John &amp; Jane"));
        // Should escape angle brackets in text content
        assert!(xml_str.contains("&lt;tag&gt;"));
        // Should escape ampersand
        assert!(xml_str.contains("&amp;"));
        // Double quotes don't need to be escaped in XML text content
        // (only in attribute values), so they appear as-is
        assert!(xml_str.contains("\"quotes\""));
    }

    #[test]
    fn test_empty_comments_writer() {
        let writer = CommentsWriter::new();
        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // Should still produce valid XML
        assert!(xml_str.contains("<comments"));
        assert!(xml_str.contains("<authors>"));
        assert!(xml_str.contains("</authors>"));
        assert!(xml_str.contains("<commentList>"));
        assert!(xml_str.contains("</commentList>"));
    }

    #[test]
    fn test_threaded_author_full() {
        let mut writer = ThreadedCommentsWriter::new();
        let author = ThreadedAuthor {
            id: "{12345678-1234-1234-1234-123456789012}".to_string(),
            display_name: "John Doe".to_string(),
            user_id: Some("john.doe@example.com".to_string()),
            provider_id: Some("AD".to_string()),
        };
        writer.add_author_full(author);

        let xml = writer.to_persons_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("id=\"{12345678-1234-1234-1234-123456789012}\""));
        assert!(xml_str.contains("userId=\"john.doe@example.com\""));
        assert!(xml_str.contains("providerId=\"AD\""));
    }

    #[test]
    fn test_get_author_id() {
        let mut writer = ThreadedCommentsWriter::new();
        writer.add_author("John Doe");
        writer.add_author("Jane Smith");

        let id1 = writer.get_author_id("John Doe");
        let id2 = writer.get_author_id("Jane Smith");
        let id3 = writer.get_author_id("Unknown");

        assert!(id1.is_some());
        assert!(id2.is_some());
        assert!(id3.is_none());
    }

    #[test]
    fn test_comment_with_newlines() {
        let mut writer = CommentsWriter::new();
        writer.add_simple("A1", "User", "Line 1\nLine 2\nLine 3");

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        // preserve_space defaults to false, so xml:space="preserve" should NOT appear
        // unless explicitly set (round-trip from parsed data).
        assert!(!xml_str.contains("xml:space=\"preserve\""));
        assert!(xml_str.contains("Line 1\nLine 2\nLine 3"));
    }

    #[test]
    fn test_comment_with_preserve_space_roundtrip() {
        let mut writer = CommentsWriter::new();
        let author_id = writer.get_or_create_author("User");
        let comment = LegacyComment {
            cell_ref: "A1".to_string(),
            author_id,
            text: vec![CommentTextRun {
                text: "  spaced  ".to_string(),
                preserve_space: true,
                ..Default::default()
            }],
            visible: false,
            shape_id: None,
            xr_uid: None,
        };
        let shape = CommentShape::for_cell("A1");
        writer.add_with_shape(comment, shape);

        let xml = writer.to_xml();
        let xml_str = String::from_utf8(xml).unwrap();

        assert!(xml_str.contains("xml:space=\"preserve\""));
        assert!(xml_str.contains("  spaced  "));
    }

    // -------------------------------------------------------------------------
    // Dispatch on `comment_type` (Track 1 invariant)
    // -------------------------------------------------------------------------

    #[test]
    fn test_dispatch_note_writes_only_to_legacy_xml() {
        let note = domain_types::Comment {
            id: "note-001".to_string(),
            cell_ref: "A1".to_string(),
            author: "Alice".to_string(),
            content: Some("A legacy note".to_string()),
            comment_type: CommentType::Note,
            thread_id: None,
            parent_id: None,
            ..Default::default()
        };

        // Legacy comments XML must contain the note's author (not "tc=...").
        let (legacy_xml, _vml_xml) = comments_from_domain(1, &[note.clone()], None, None);
        let legacy_str = String::from_utf8(legacy_xml).expect("utf8");
        assert!(
            legacy_str.contains("<author>Alice</author>"),
            "legacy XML must contain note author"
        );
        assert!(
            !legacy_str.contains("tc="),
            "legacy XML for a note must NOT contain `tc=` author"
        );

        // Threaded XML must be `None` — notes never write threaded entries.
        let threaded = threaded_comments_xml_from_domain(&[note]);
        assert!(
            threaded.is_none(),
            "notes must not produce threaded XML output"
        );
    }

    #[test]
    fn test_note_with_tc_author_and_stale_thread_id_stays_legacy_only() {
        let note = domain_types::Comment {
            id: "note-001".to_string(),
            cell_ref: "A1".to_string(),
            author: "tc={LITERAL-AUTHOR}".to_string(),
            runs: vec![domain_types::RichTextRun {
                text: "Literal legacy note".to_string(),
                ..Default::default()
            }],
            comment_type: CommentType::Note,
            thread_id: Some("stale-thread-id".to_string()),
            xr_uid: Some("xr-note-uid".to_string()),
            ..Default::default()
        };

        let (legacy_xml, _vml_xml) = comments_from_domain(1, &[note.clone()], None, None);
        let legacy_str = String::from_utf8(legacy_xml).expect("utf8");

        assert!(legacy_str.contains("<author>tc={LITERAL-AUTHOR}</author>"));
        assert!(legacy_str.contains("Literal legacy note"));
        assert!(legacy_str.contains("xr:uid=\"xr-note-uid\""));
        assert!(
            !legacy_str.contains("stale-thread-id"),
            "a note's thread_id metadata must not rewrite its legacy author or xr:uid"
        );
        assert!(
            threaded_comments_xml_from_domain(&[note]).is_none(),
            "threaded XML is gated by CommentType, not thread_id"
        );
    }

    #[test]
    fn test_dispatch_threaded_writes_to_both() {
        let thread = domain_types::Comment {
            id: "thread-001".to_string(),
            cell_ref: "B2".to_string(),
            author: "Bob".to_string(),
            content: Some("A thread".to_string()),
            comment_type: CommentType::ThreadedComment,
            thread_id: Some("thread-001".to_string()),
            parent_id: None,
            ..Default::default()
        };

        let (legacy_xml, _vml_xml) = comments_from_domain(1, &[thread.clone()], None, None);
        let legacy_str = String::from_utf8(legacy_xml).expect("utf8");
        assert!(
            legacy_str.contains("tc=thread-001"),
            "threaded comment must use `tc={{thread_id}}` author in legacy XML"
        );

        let threaded = threaded_comments_xml_from_domain(&[thread])
            .expect("threaded comment must produce threaded XML");
        let threaded_str = String::from_utf8(threaded).expect("utf8");
        assert!(threaded_str.contains("thread-001"));
    }
}

// ============================================================================
// Bridge functions: domain → XML
// ============================================================================

/// Build comments XML and VML drawing XML from domain `Comment` list.
///
/// When `original_authors` is provided (from round-trip context), all original
/// authors are pre-populated so that unused authors are preserved for fidelity.
/// When `root_namespace_attrs` is provided, they are set on the `<comments>` root
/// element for round-trip fidelity of namespace declarations.
///
/// Returns `(comments_xml, vml_xml)`.
pub fn comments_from_domain(
    _sheet_num: usize,
    comments: &[domain_types::Comment],
    original_authors: Option<&[String]>,
    root_namespace_attrs: Option<&[(String, String)]>,
) -> (Vec<u8>, Vec<u8>) {
    let mut cw = CommentsWriter::new();

    // Preserve original root namespace declarations for round-trip fidelity.
    if let Some(attrs) = root_namespace_attrs {
        cw.set_root_namespace_attrs(attrs.to_vec());
    }

    // Pre-populate the author list from the original file for round-trip fidelity.
    // This preserves unused authors and the original author ordering.
    if let Some(authors) = original_authors {
        for author in authors {
            cw.add_author(author);
        }
    }

    for comment in comments {
        // Skip threaded replies — they don't get their own legacy comment entry.
        if comment.parent_id.is_some() {
            continue;
        }

        let (author_name, runs, xr_uid) = if comment.comment_type == CommentType::ThreadedComment {
            // Threaded comment: legacy author is "tc={GUID}". The thread_id
            // is the canonical GUID; fall back to comment.id if missing
            // (storage invariant says threads have `Some(...)`, but the writer
            // is the last line of defense).
            let thread_id_str = comment
                .thread_id
                .as_deref()
                .unwrap_or(comment.id.as_str())
                .to_string();
            let tc_author = format!("tc={}", thread_id_str);

            // If the comment has original rich text runs from a parsed file, preserve
            // them for round-trip fidelity.  Only generate the placeholder stub when
            // creating a brand-new threaded comment that has no original runs.
            let runs = if !comment.runs.is_empty() {
                comment
                    .runs
                    .iter()
                    .map(|r| CommentTextRun {
                        text: r.text.clone(),
                        bold: r.bold,
                        italic: r.italic,
                        underline: r.underline,
                        strike: r.strikethrough,
                        font_size: r.font_size,
                        font_name: r.font_name.clone(),
                        color: r.color.clone(),
                        color_indexed: r.color_indexed,
                        color_theme: r.color_theme,
                        color_tint: r.color_tint,
                        font_family: r.family,
                        scheme: r.scheme.clone(),
                        charset: r.charset,
                        preserve_space: r.preserve_space,
                    })
                    .collect()
            } else {
                let stub_text = format!(
                    "[Threaded comment]\n\n\
                     Your version of Excel allows you to read this threaded comment; \
                     however, any edits to it will get removed if the file is opened \
                     in a newer version of Excel. Learn more: \
                     https://go.microsoft.com/fwlink/?linkid=870924\n\n\
                     Comment:\n    {}",
                    comment.content.as_deref().unwrap_or("")
                );
                vec![CommentTextRun {
                    text: stub_text,
                    ..Default::default()
                }]
            };
            (tc_author, runs, Some(thread_id_str))
        } else if comment.runs.is_empty() {
            let text = comment.content.as_deref().unwrap_or("");
            let runs = vec![
                CommentTextRun {
                    text: format!("{}:\n", comment.author),
                    bold: true,
                    font_size: Some(9.0),
                    font_name: Some("Tahoma".to_string()),
                    ..Default::default()
                },
                CommentTextRun {
                    text: text.to_string(),
                    font_size: Some(9.0),
                    font_name: Some("Tahoma".to_string()),
                    ..Default::default()
                },
            ];
            (comment.author.clone(), runs, None)
        } else {
            let runs = comment
                .runs
                .iter()
                .map(|r| CommentTextRun {
                    text: r.text.clone(),
                    bold: r.bold,
                    italic: r.italic,
                    underline: r.underline,
                    strike: r.strikethrough,
                    font_size: r.font_size,
                    font_name: r.font_name.clone(),
                    color: r.color.clone(),
                    color_indexed: r.color_indexed,
                    color_theme: r.color_theme,
                    color_tint: r.color_tint,
                    font_family: r.family,
                    scheme: r.scheme.clone(),
                    charset: r.charset,
                    preserve_space: r.preserve_space,
                })
                .collect();
            (comment.author.clone(), runs, comment.xr_uid.clone())
        };

        let author_id = cw.get_or_create_author(&author_name);

        let visible = comment.visible.unwrap_or(false);
        let legacy = LegacyComment {
            cell_ref: comment.cell_ref.clone(),
            author_id,
            text: runs,
            visible,
            shape_id: comment.shape_id,
            xr_uid,
        };
        let mut shape = CommentShape::for_cell(&comment.cell_ref);
        shape.visible = visible;
        shape.note_height = comment.note_height;
        shape.note_width = comment.note_width;
        if let Some(anchor) = &comment.note_shape_anchor {
            shape.left_col = anchor.left_column;
            shape.left_offset = anchor.left_offset as f64;
            shape.top_row = anchor.top_row;
            shape.top_offset = anchor.top_offset as f64;
            shape.right_col = anchor.right_column;
            shape.right_offset = anchor.right_offset as f64;
            shape.bottom_row = anchor.bottom_row;
            shape.bottom_offset = anchor.bottom_offset as f64;
        }
        cw.add_with_shape(legacy, shape);
    }

    (cw.to_xml(), cw.to_vml())
}

/// Build threaded comments XML for a single sheet.
/// Returns `None` if there are no comments tagged as `ThreadedComment`.
///
/// Dispatch is `comment_type`-driven (single discriminator end-to-end). The
/// storage invariant says threaded comments always have `thread_id = Some(...)`,
/// so the unwrap inside is safe; we fall back to `comment.id` defensively.
pub fn threaded_comments_xml_from_domain(comments: &[domain_types::Comment]) -> Option<Vec<u8>> {
    let threaded: Vec<&domain_types::Comment> = comments
        .iter()
        .filter(|c| c.comment_type == CommentType::ThreadedComment)
        .collect();
    if threaded.is_empty() {
        return None;
    }

    let mut tw = ThreadedCommentsWriter::new();

    for comment in &threaded {
        let thread_id = comment
            .thread_id
            .as_deref()
            .unwrap_or(comment.id.as_str())
            .to_string();
        let person_id = comment.person_id.clone().unwrap_or_default();
        let timestamp = comment.timestamp.clone().unwrap_or_default();

        // Convert domain mentions to writer mentions
        let mentions: Vec<ThreadedMention> = comment
            .mentions
            .iter()
            .map(|m| ThreadedMention {
                mention_person_id: m.user_id.clone(),
                start_index: m.start_index,
                length: m.length,
            })
            .collect();

        tw.add_comment(ThreadedComment {
            id: thread_id.clone(),
            cell_ref: comment.cell_ref.clone(),
            author_id: person_id,
            text: comment.content.as_deref().unwrap_or("").to_string(),
            timestamp,
            parent_id: comment.parent_id.clone(),
            done: comment.resolved.unwrap_or(false),
            ext_lst_xml: comment.ext_lst_xml.clone(),
            mentions,
        });
    }

    Some(tw.to_xml())
}

/// Build persons.xml from the workbook-level person list.
pub fn persons_xml_from_domain(persons: &[domain_types::PersonInfo]) -> Vec<u8> {
    let mut tw = ThreadedCommentsWriter::new();
    for person in persons {
        tw.add_author_full(ThreadedAuthor {
            id: person.id.clone(),
            display_name: person.display_name.clone(),
            user_id: person.user_id.clone(),
            provider_id: person.provider_id.clone(),
        });
    }
    tw.to_persons_xml()
}
