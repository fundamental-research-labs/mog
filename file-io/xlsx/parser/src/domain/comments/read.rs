//! Comments parser for XLSX worksheets.
//!
//! This module parses comments from XLSX files, including:
//! - `xl/comments*.xml` - Cell comments with rich text formatting
//! - Legacy VML shape positioning (optional)
//! - Threaded comments (modern Excel)
//!
//! # XLSX Comments Structure
//!
//! Comments in XLSX consist of:
//! 1. `xl/comments*.xml` - Comment content and author information
//! 2. `xl/drawings/vmlDrawing*.vml` - Legacy positioning (optional)
//! 3. `xl/threadedComments/threadedComment*.xml` - Modern threaded comments
//!
//! # Example Usage
//!
//! ```ignore
//! use xlsx_parser::comments::{parse_comments, Comments};
//!
//! let xml = archive.read_file("xl/comments1.xml")?;
//! let comments = parse_comments(&xml);
//!
//! for comment in comments.comments {
//!     println!("Cell {}: {}", comment.cell_ref, comment.text());
//! }
//! ```
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices XML
//! tag / attribute content at byte offsets produced by ASCII-only XML
//! syntax (`<`, `>`, `/`, `"`, `=`). Char-boundary by construction.
//! File-scope allow documented here.

#![allow(clippy::string_slice)]

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    decode_xml_entities, parse_bool_attr, parse_f64_attr, parse_string_attr,
    parse_string_attr_verbatim, parse_u32_attr,
};

// ============================================================================
// Core Data Structures
// ============================================================================

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

// ============================================================================
// Threaded Comments (Modern Excel)
// ============================================================================

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

// ============================================================================
// VML Shape Positioning
// ============================================================================

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
}

// ============================================================================
// Parsing Functions
// ============================================================================

/// Parse comments from comments*.xml
///
/// # Arguments
/// * `xml` - Raw bytes of the comments XML file
///
/// # Returns
/// Parsed Comments structure
pub fn parse_comments(xml: &[u8]) -> Comments {
    let mut comments = Comments::default();

    // Find the comments element
    let comments_start = match find_tag_simd(xml, b"comments", 0) {
        Some(pos) => pos,
        None => return comments,
    };

    // Extract root element namespace declarations for round-trip fidelity.
    comments.root_namespace_attrs = parse_comments_root_attrs(xml);

    // Parse authors
    if let Some(authors_start) = find_tag_simd(xml, b"authors", comments_start) {
        let authors_end = find_closing_tag(xml, b"authors", authors_start).unwrap_or(xml.len());
        comments.authors = parse_authors(&xml[authors_start..authors_end]);
    }

    // Parse comment list
    if let Some(list_start) = find_tag_simd(xml, b"commentList", comments_start) {
        let list_end = find_closing_tag(xml, b"commentList", list_start).unwrap_or(xml.len());
        comments.comments = parse_comment_list(&xml[list_start..list_end]);
    }

    comments
}

/// Extract namespace declarations and `mc:Ignorable` from the root `<comments>` element.
///
/// Returns `(attr_name, attr_value)` pairs preserving original order.
/// Captures `xmlns`, `xmlns:*`, and `mc:Ignorable` attributes.
fn parse_comments_root_attrs(xml: &[u8]) -> Vec<(String, String)> {
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    // Skip XML declaration if present.
    let start = if let Some(decl_end) = xml_str.find("?>") {
        decl_end + 2
    } else {
        0
    };

    // Find the opening '<' of the root element.
    let root_start = match xml_str[start..].find('<') {
        Some(p) => start + p,
        None => return Vec::new(),
    };

    // Find the end of the opening tag ('>' or '/>').
    let root_end = match xml_str[root_start..].find('>') {
        Some(p) => root_start + p,
        None => return Vec::new(),
    };

    let root_tag = &xml_str[root_start..=root_end];

    let mut attrs = Vec::new();

    // Parse all xmlns declarations.
    let mut pos = 0;
    while let Some(xmlns_pos) = root_tag[pos..].find("xmlns") {
        let abs_pos = pos + xmlns_pos;
        let after = &root_tag[abs_pos..];

        // Determine the full attribute name (xmlns or xmlns:prefix).
        let (attr_name, rest) = if after.len() > 5 && after.as_bytes()[5] == b':' {
            // xmlns:prefix="..."
            let after_colon = &after[6..];
            let end = after_colon
                .find(|c: char| c == '=' || c.is_whitespace())
                .unwrap_or(after_colon.len());
            let prefix = &after_colon[..end];
            (format!("xmlns:{}", prefix), &after[6 + end..])
        } else if after.len() > 5
            && (after.as_bytes()[5] == b'=' || after.as_bytes()[5].is_ascii_whitespace())
        {
            // xmlns="..."
            ("xmlns".to_string(), &after[5..])
        } else {
            pos = abs_pos + 5;
            continue;
        };

        // Find '=' and then the quoted value.
        if let Some(eq_pos) = rest.find('=') {
            let after_eq = rest[eq_pos + 1..].trim_start();
            if let Some(quote) = after_eq.chars().next() {
                if quote == '"' || quote == '\'' {
                    let value_start = &after_eq[1..];
                    if let Some(end_quote) = value_start.find(quote) {
                        let uri = &value_start[..end_quote];
                        attrs.push((attr_name, uri.to_string()));
                    }
                }
            }
        }

        pos = abs_pos + 5;
    }

    // Also capture mc:Ignorable attribute.
    pos = 0;
    while let Some(mc_pos) = root_tag[pos..].find("mc:Ignorable") {
        let abs_pos = pos + mc_pos;
        let after = &root_tag[abs_pos + 12..]; // len("mc:Ignorable") == 12

        if let Some(eq_pos) = after.find('=') {
            let after_eq = after[eq_pos + 1..].trim_start();
            if let Some(quote) = after_eq.chars().next() {
                if quote == '"' || quote == '\'' {
                    let value_start = &after_eq[1..];
                    if let Some(end_quote) = value_start.find(quote) {
                        let value = &value_start[..end_quote];
                        attrs.push(("mc:Ignorable".to_string(), value.to_string()));
                    }
                }
            }
        }

        pos = abs_pos + 12;
    }

    attrs
}

/// Parse threaded comments from threadedComment*.xml
///
/// # Arguments
/// * `xml` - Raw bytes of the threaded comments XML file
///
/// # Returns
/// Parsed ThreadedComments structure
pub fn parse_threaded_comments(xml: &[u8]) -> ThreadedComments {
    let mut threaded = ThreadedComments::default();

    // Find the ThreadedComments element
    let tc_start = match find_tag_simd(xml, b"ThreadedComments", 0) {
        Some(pos) => pos,
        None => return threaded,
    };

    let tc_end = find_closing_tag(xml, b"ThreadedComments", tc_start).unwrap_or(xml.len());

    // Parse person list
    if let Some(persons_start) = find_tag_simd(xml, b"personList", tc_start) {
        let persons_end = find_closing_tag(xml, b"personList", persons_start).unwrap_or(tc_end);
        threaded.persons = parse_persons(&xml[persons_start..persons_end]);
    }

    // Parse threaded comments
    let mut pos = tc_start;
    while let Some(comment_start) = find_tag_simd(&xml[..tc_end], b"threadedComment", pos) {
        if comment_start >= tc_end {
            break;
        }

        let comment_end =
            find_closing_tag(xml, b"threadedComment", comment_start).unwrap_or(tc_end);

        if let Some(comment) = parse_threaded_comment(&xml[comment_start..comment_end]) {
            threaded.comments.push(comment);
        }

        pos = comment_end + 1;
    }

    threaded
}

/// Parse VML shapes for comment positioning
///
/// # Arguments
/// * `xml` - Raw bytes of the VML drawing file
///
/// # Returns
/// Vector of CommentShape structures
pub fn parse_vml_shapes(xml: &[u8]) -> Vec<CommentShape> {
    let mut shapes = Vec::new();
    let mut pos = 0;

    // Look for v:shape elements with comment client data
    while let Some(shape_start) = find_tag_simd(xml, b"v:shape", pos) {
        let shape_end = find_closing_tag(xml, b"v:shape", shape_start).unwrap_or(xml.len());

        // Only process shapes with x:ClientData (comment shapes)
        if find_tag_simd(&xml[shape_start..shape_end], b"x:ClientData", 0).is_some() {
            if let Some(shape) = parse_vml_shape(&xml[shape_start..shape_end]) {
                shapes.push(shape);
            }
        }

        pos = shape_end + 1;
    }

    shapes
}

// ============================================================================
// Helper Parsing Functions
// ============================================================================

fn parse_authors(xml: &[u8]) -> Vec<String> {
    let mut authors = Vec::new();
    let mut pos = 0;

    while let Some(author_start) = find_tag_simd(xml, b"author", pos) {
        let gt_pos = find_gt_simd(xml, author_start).unwrap_or(xml.len());

        // Detect self-closing <author/> — the byte before '>' is '/'
        if gt_pos > 0 && xml[gt_pos - 1] == b'/' {
            // Self-closing tag means empty author name
            authors.push(String::new());
            pos = gt_pos + 1;
            continue;
        }

        let content_start = gt_pos + 1;
        let author_end = find_closing_tag(xml, b"author", author_start).unwrap_or(xml.len());

        if content_start <= author_end {
            if content_start == author_end {
                // <author></author> — empty text
                authors.push(String::new());
            } else {
                let author_text = decode_xml_entities(&xml[content_start..author_end]);
                authors.push(author_text);
            }
        }

        pos = author_end + 1;
    }

    authors
}

fn parse_comment_list(xml: &[u8]) -> Vec<Comment> {
    let mut comments = Vec::new();
    let mut pos = 0;

    while let Some(comment_start) = find_tag_simd(xml, b"comment", pos) {
        // Make sure we're not matching commentList
        if comment_start + 8 < xml.len() && xml[comment_start + 8] == b'L' {
            pos = comment_start + 1;
            continue;
        }

        let comment_end = find_closing_tag(xml, b"comment", comment_start).unwrap_or(xml.len());

        if let Some(comment) = parse_single_comment(&xml[comment_start..comment_end]) {
            comments.push(comment);
        }

        pos = comment_end + 1;
    }

    comments
}

fn parse_single_comment(xml: &[u8]) -> Option<Comment> {
    let mut comment = Comment::default();

    // Parse opening tag attributes
    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];

    // Parse ref attribute (required)
    comment.cell_ref = parse_string_attr(tag, b"ref=\"")?;

    // Parse authorId attribute
    comment.author_id = parse_u32_attr(tag, b"authorId=\"").unwrap_or(0);

    // Parse guid attribute (optional)
    comment.guid = parse_string_attr(tag, b"guid=\"");

    // Parse shapeId attribute (optional)
    comment.shape_id = parse_u32_attr(tag, b"shapeId=\"");

    // Parse xr:uid attribute (optional, Excel revision tracking)
    comment.xr_uid = parse_string_attr(tag, b"xr:uid=\"");

    // Parse text element with rich text runs
    if let Some(text_start) = find_tag_simd(xml, b"text", 0) {
        let text_end = find_closing_tag(xml, b"text", text_start).unwrap_or(xml.len());
        comment.rich_text = parse_rich_text(&xml[text_start..text_end]);
    }

    Some(comment)
}

fn parse_rich_text(xml: &[u8]) -> Vec<CommentRun> {
    let mut runs = Vec::new();
    let mut pos = 0;

    // Check for simple text (no <r> elements)
    let has_runs = find_tag_simd(xml, b"r", 0).is_some();

    if !has_runs {
        // Simple case: just a <t> element
        if let Some(t_start) = find_tag_simd(xml, b"t", 0) {
            let gt_pos = find_gt_simd(xml, t_start).unwrap_or(xml.len());
            let content_start = if gt_pos < xml.len() {
                gt_pos + 1
            } else {
                xml.len()
            };
            let t_end = find_closing_tag(xml, b"t", t_start).unwrap_or(xml.len());
            let tag_bytes = &xml[t_start..gt_pos.min(xml.len())];
            let preserve_space = tag_bytes.windows(9).any(|w| w == b"xml:space");

            if content_start < t_end {
                runs.push(CommentRun {
                    text: decode_xml_entities(&xml[content_start..t_end]),
                    font: None,
                    preserve_space,
                });
            }
        }
        return runs;
    }

    // Rich text with <r> elements
    while let Some(r_start) = find_tag_simd(xml, b"r", pos) {
        let r_end = find_closing_tag(xml, b"r", r_start).unwrap_or(xml.len());

        let run_xml = &xml[r_start..r_end];
        let mut run = CommentRun::default();

        // Parse font properties from <rPr>
        if let Some(rpr_start) = find_tag_simd(run_xml, b"rPr", 0) {
            let rpr_end = find_closing_tag(run_xml, b"rPr", rpr_start).unwrap_or(run_xml.len());
            run.font = Some(parse_comment_font(&run_xml[rpr_start..rpr_end]));
        }

        // Parse text content from <t>
        if let Some(t_start) = find_tag_simd(run_xml, b"t", 0) {
            let gt_pos = find_gt_simd(run_xml, t_start).unwrap_or(run_xml.len());
            let content_start = if gt_pos < run_xml.len() {
                gt_pos + 1
            } else {
                run_xml.len()
            };
            let t_end = find_closing_tag(run_xml, b"t", t_start).unwrap_or(run_xml.len());
            let tag_bytes = &run_xml[t_start..gt_pos.min(run_xml.len())];
            run.preserve_space = tag_bytes.windows(9).any(|w| w == b"xml:space");

            if content_start < t_end {
                run.text = decode_xml_entities(&run_xml[content_start..t_end]);
            }
        }

        if !run.text.is_empty() {
            runs.push(run);
        }

        pos = r_end + 1;
    }

    runs
}

fn parse_comment_font(xml: &[u8]) -> CommentFont {
    let mut font = CommentFont::default();

    // Parse font name <rFont val="..."/>
    if let Some(name_start) = find_tag_simd(xml, b"rFont", 0) {
        let tag_end = find_gt_simd(xml, name_start).unwrap_or(xml.len());
        let element = &xml[name_start..tag_end + 1];
        font.name = parse_string_attr(element, b"val=\"");
    }

    // Parse font size <sz val="..."/>
    if let Some(sz_start) = find_tag_simd(xml, b"sz", 0) {
        let tag_end = find_gt_simd(xml, sz_start).unwrap_or(xml.len());
        let element = &xml[sz_start..tag_end + 1];
        font.size = parse_f64_attr(element, b"val=\"");
    }

    // Parse bold <b/> or <b val="1"/>
    font.bold = find_tag_simd(xml, b"b", 0).is_some();

    // Parse italic <i/> or <i val="1"/>
    font.italic = find_tag_simd(xml, b"i", 0).is_some();

    // Parse underline <u/> or <u val="..."/>
    font.underline = find_tag_simd(xml, b"u", 0).is_some();

    // Parse strike <strike/> or <strike val="1"/>
    font.strike = find_tag_simd(xml, b"strike", 0).is_some();

    // Parse color <color rgb="..." indexed="..." theme="..." tint="..."/>
    if let Some(color_start) = find_tag_simd(xml, b"color", 0) {
        let tag_end = find_gt_simd(xml, color_start).unwrap_or(xml.len());
        let element = &xml[color_start..tag_end + 1];
        font.color = parse_string_attr(element, b"rgb=\"");
        font.color_indexed = parse_u32_attr(element, b"indexed=\"");
        font.color_theme = parse_u32_attr(element, b"theme=\"");
        font.color_tint = parse_f64_attr(element, b"tint=\"");
    }

    // Parse font family <family val="N"/>
    if let Some(family_start) = find_tag_simd(xml, b"family", 0) {
        let tag_end = find_gt_simd(xml, family_start).unwrap_or(xml.len());
        let element = &xml[family_start..tag_end + 1];
        font.family = parse_u32_attr(element, b"val=\"");
    }

    // Parse font scheme <scheme val="minor|major"/>
    if let Some(scheme_start) = find_tag_simd(xml, b"scheme", 0) {
        let tag_end = find_gt_simd(xml, scheme_start).unwrap_or(xml.len());
        let element = &xml[scheme_start..tag_end + 1];
        font.scheme = parse_string_attr(element, b"val=\"");
    }

    // Parse character set <charset val="N"/>
    if let Some(charset_start) = find_tag_simd(xml, b"charset", 0) {
        let tag_end = find_gt_simd(xml, charset_start).unwrap_or(xml.len());
        let element = &xml[charset_start..tag_end + 1];
        font.charset = parse_u32_attr(element, b"val=\"");
    }

    font
}

fn parse_persons(xml: &[u8]) -> Vec<ThreadedPerson> {
    let mut persons = Vec::new();
    let mut pos = 0;

    while let Some(person_start) = find_tag_simd(xml, b"person", pos) {
        // Skip personList tag
        if person_start + 7 < xml.len() && xml[person_start + 7] == b'L' {
            pos = person_start + 1;
            continue;
        }

        let tag_end = find_gt_simd(xml, person_start).unwrap_or(xml.len());
        let element = &xml[person_start..tag_end + 1];

        let person = ThreadedPerson {
            display_name: parse_string_attr(element, b"displayName=\"").unwrap_or_default(),
            id: parse_string_attr(element, b"id=\"").unwrap_or_default(),
            user_id: parse_string_attr(element, b"userId=\""),
            provider_id: parse_string_attr(element, b"providerId=\""),
        };

        persons.push(person);
        pos = tag_end + 1;
    }

    persons
}

fn parse_threaded_comment(xml: &[u8]) -> Option<ThreadedComment> {
    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];

    let mut comment = ThreadedComment {
        id: parse_string_attr(tag, b"id=\"")?,
        cell_ref: parse_string_attr(tag, b"ref=\"").unwrap_or_default(),
        person_id: parse_string_attr(tag, b"personId=\"").unwrap_or_default(),
        parent_id: parse_string_attr(tag, b"parentId=\""),
        done: parse_bool_attr(tag, b"done=\""),
        created: parse_string_attr(tag, b"dT=\""),
        ..Default::default()
    };

    // Parse text content
    if let Some(text_start) = find_tag_simd(xml, b"text", 0) {
        let content_start = find_gt_simd(xml, text_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let text_end = find_closing_tag(xml, b"text", text_start).unwrap_or(xml.len());

        if content_start < text_end {
            comment.text = decode_xml_entities(&xml[content_start..text_end]);
        }
    }

    // Parse extLst for round-trip fidelity (hyperlink metadata etc.)
    if let Some(ext_start) = find_tag_simd(xml, b"extLst", 0) {
        let ext_end = find_closing_tag(xml, b"extLst", ext_start).unwrap_or(xml.len());
        let ext_close_end = ext_end + b"</extLst>".len();
        if ext_close_end <= xml.len() {
            comment.ext_lst_xml = std::str::from_utf8(&xml[ext_start..ext_close_end])
                .ok()
                .map(|s| s.to_string());
        }
    }

    // Parse mentions
    if let Some(mentions_start) = find_tag_simd(xml, b"mentions", 0) {
        let mentions_end = find_closing_tag(xml, b"mentions", mentions_start).unwrap_or(xml.len());
        let mentions_xml = &xml[mentions_start..mentions_end];
        let mut mpos = 0;
        while let Some(m_start) = find_tag_simd(mentions_xml, b"mention", mpos) {
            let m_tag_end = find_gt_simd(mentions_xml, m_start).unwrap_or(mentions_xml.len());
            let m_tag = &mentions_xml[m_start..m_tag_end + 1];
            let mention_person_id =
                parse_string_attr(m_tag, b"mentionpersonId=\"").unwrap_or_default();
            let start_index = parse_u32_attr(m_tag, b"startIndex=\"").unwrap_or(0);
            let length = parse_u32_attr(m_tag, b"length=\"").unwrap_or(0);
            comment.mentions.push(ParsedMention {
                mention_person_id,
                start_index,
                length,
            });
            mpos = m_tag_end + 1;
        }
    }

    Some(comment)
}

fn parse_vml_shape(xml: &[u8]) -> Option<CommentShape> {
    let mut shape = CommentShape::default();

    // Parse id from v:shape
    let tag_end = find_gt_simd(xml, 0)?;
    let tag = &xml[..tag_end + 1];
    shape.id = parse_string_attr_verbatim(tag, b"id=\"").unwrap_or_default();

    // Check visibility and extract dimensions from style attribute
    if let Some(style) = parse_string_attr(tag, b"style=\"") {
        shape.visible = !style.contains("visibility:hidden");
        // Extract width and height from CSS-like style (e.g. "width:108pt;height:59.25pt")
        shape.note_width = parse_pt_value(&style, "width:");
        shape.note_height = parse_pt_value(&style, "height:");
    }

    // Parse x:ClientData for comment-specific info
    if let Some(cd_start) = find_tag_simd(xml, b"x:ClientData", 0) {
        let cd_end = find_closing_tag(xml, b"x:ClientData", cd_start).unwrap_or(xml.len());
        let cd_xml = &xml[cd_start..cd_end];

        // Parse anchor positions
        if let Some(anchor_start) = find_tag_simd(cd_xml, b"x:Anchor", 0) {
            let content_start = find_gt_simd(cd_xml, anchor_start)
                .map(|p| p + 1)
                .unwrap_or(cd_xml.len());
            let anchor_end =
                find_closing_tag(cd_xml, b"x:Anchor", anchor_start).unwrap_or(cd_xml.len());

            if content_start < anchor_end {
                parse_anchor_values(&cd_xml[content_start..anchor_end], &mut shape);
            }
        }

        // Parse row/column for cell reference
        if let Some(row_start) = find_tag_simd(cd_xml, b"x:Row", 0) {
            let content_start = find_gt_simd(cd_xml, row_start)
                .map(|p| p + 1)
                .unwrap_or(cd_xml.len());
            let row_end = find_closing_tag(cd_xml, b"x:Row", row_start).unwrap_or(cd_xml.len());

            if content_start < row_end {
                if let Some(row) = parse_u32_content(&cd_xml[content_start..row_end]) {
                    if let Some(col_start) = find_tag_simd(cd_xml, b"x:Column", 0) {
                        let col_content_start = find_gt_simd(cd_xml, col_start)
                            .map(|p| p + 1)
                            .unwrap_or(cd_xml.len());
                        let col_end = find_closing_tag(cd_xml, b"x:Column", col_start)
                            .unwrap_or(cd_xml.len());

                        if col_content_start < col_end {
                            if let Some(col) =
                                parse_u32_content(&cd_xml[col_content_start..col_end])
                            {
                                shape.cell_ref = Some(column_to_ref(col, row));
                            }
                        }
                    }
                }
            }
        }
    }

    Some(shape)
}

fn parse_anchor_values(anchor: &[u8], shape: &mut CommentShape) {
    // Anchor format: "col, offset, row, offset, col, offset, row, offset"
    // where values are comma-separated
    let text = std::str::from_utf8(anchor).unwrap_or("");
    let parts: Vec<&str> = text.split(',').map(|s| s.trim()).collect();

    if parts.len() >= 8 {
        shape.left_column = parts[0].parse().unwrap_or(0);
        shape.left_offset = parts[1].parse().unwrap_or(0);
        shape.top_row = parts[2].parse().unwrap_or(0);
        shape.top_offset = parts[3].parse().unwrap_or(0);
        shape.right_column = parts[4].parse().unwrap_or(0);
        shape.right_offset = parts[5].parse().unwrap_or(0);
        shape.bottom_row = parts[6].parse().unwrap_or(0);
        shape.bottom_offset = parts[7].parse().unwrap_or(0);
    }
}

fn column_to_ref(col: u32, row: u32) -> String {
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
// Attribute Parsing Helpers
// ============================================================================

/// Extract a `pt` dimension value from a CSS-like style string.
/// e.g. `parse_pt_value("width:108pt;height:59.25pt", "width:")` -> Some(108.0)
fn parse_pt_value(style: &str, key: &str) -> Option<f64> {
    let start = style.find(key)?;
    let after_key = &style[start + key.len()..];
    let end = after_key.find("pt")?;
    after_key[..end].trim().parse::<f64>().ok()
}

fn parse_u32_content(xml: &[u8]) -> Option<u32> {
    let s = std::str::from_utf8(xml).ok()?.trim();
    s.parse().ok()
}

// ============================================================================
// Domain Coordinator
// ============================================================================

fn extract_comments_path_for_sheet(sheet_num: usize, rels_xml: &[u8]) -> Option<String> {
    let relationships = crate::infra::opc::parse_owned_relationships(
        crate::infra::opc::PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        rels_xml,
    );
    crate::infra::opc::WorksheetRelationships::new(&relationships)
        .comments()
        .into_iter()
        .next()
        .and_then(|rel| rel.target.path().map(ToOwned::to_owned))
}

/// Parse comments for a specific sheet.
///
/// Uses the sheet relationship file (`xl/worksheets/_rels/sheet{N}.xml.rels`)
/// to discover the actual comments file path, so that files where the
/// comments numbering does not match the sheet numbering are handled
/// correctly.
///
/// The OOXML specification requires that the link from a worksheet to its
/// comments file is established through the worksheet's OPC relationships
/// file.  Absent that relationship, the sheet has no comments.  This
/// function therefore:
///   1. Reads `xl/worksheets/_rels/sheet{N}.xml.rels`.
///   2. Looks for a relationship whose `Type` ends with `/comments`.
///   3. If found, resolves the `Target` to an archive path and reads it.
///   4. If the rels file is absent **or** contains no comments
///      relationship, the sheet has no comments.
///
/// # Arguments
/// * `archive` - The XLSX archive
/// * `sheet_num` - The 1-based sheet number
///
/// # Returns
/// A tuple of (comments, authors, root_namespace_attrs) for the sheet.
/// The third element contains original root element namespace declarations
/// for round-trip fidelity (xmlns, xmlns:*, mc:Ignorable, etc.).
pub fn parse_comments_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> (
    Vec<crate::output::results::CommentOutput>,
    Vec<String>,
    Vec<(String, String)>,
) {
    // Determine the comments file path via the sheet rels file.
    // If there is no rels file, or the rels file has no comments relationship,
    // this sheet has no comments — do NOT fall back to xl/comments{N}.xml
    // because that file might belong to a different sheet.
    let comments_path = {
        let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
        match archive.read_file(&rels_path) {
            Ok(rels_xml) => match extract_comments_path_for_sheet(sheet_num, &rels_xml) {
                Some(path) => path,
                None => {
                    // Sheet rels exist but contain no comments relationship.
                    return (Vec::new(), Vec::new(), Vec::new());
                }
            },
            Err(_) => {
                // No rels file for this sheet — no comments.
                return (Vec::new(), Vec::new(), Vec::new());
            }
        }
    };

    if let Ok(comments_xml) = archive.read_file(&comments_path) {
        let comments_result = parse_comments(&comments_xml);
        let authors = comments_result.authors.clone();
        let root_ns_attrs = comments_result.root_namespace_attrs.clone();
        let comments = comments_result
            .comments
            .iter()
            .map(|c| {
                let runs = c
                    .rich_text
                    .iter()
                    .map(|run| {
                        let (
                            font_name,
                            font_size,
                            bold,
                            italic,
                            underline,
                            strike,
                            color,
                            color_indexed,
                            color_theme,
                            color_tint,
                            font_family,
                            scheme,
                            charset,
                        ) = match &run.font {
                            Some(f) => (
                                f.name.clone(),
                                f.size,
                                f.bold,
                                f.italic,
                                f.underline,
                                f.strike,
                                f.color.clone(),
                                f.color_indexed,
                                f.color_theme,
                                f.color_tint,
                                f.family,
                                f.scheme.clone(),
                                f.charset,
                            ),
                            None => (
                                None, None, false, false, false, false, None, None, None, None,
                                None, None, None,
                            ),
                        };
                        crate::output::results::CommentRunOutput {
                            text: run.text.clone(),
                            font_name,
                            font_size,
                            bold,
                            italic,
                            underline,
                            strike,
                            color,
                            color_indexed,
                            color_theme,
                            color_tint,
                            font_family,
                            scheme,
                            charset,
                            vert_align: None,
                            preserve_space: run.preserve_space,
                        }
                    })
                    .collect();
                crate::output::results::CommentOutput {
                    cell_ref: c.cell_ref.clone(),
                    author_id: c.author_id as usize,
                    text: c.text(),
                    runs,
                    shape_id: c.shape_id,
                    xr_uid: c.xr_uid.clone(),
                }
            })
            .collect();
        (comments, authors, root_ns_attrs)
    } else {
        (Vec::new(), Vec::new(), Vec::new())
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Comment struct tests
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // parse_comments tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_comments_empty() {
        let xml = b"<?xml version=\"1.0\"?><worksheet></worksheet>";
        let comments = parse_comments(xml);
        assert!(comments.authors.is_empty());
        assert!(comments.comments.is_empty());
    }

    #[test]
    fn test_parse_comments_basic() {
        let xml = br#"<?xml version="1.0"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <authors>
        <author>John Doe</author>
        <author>Jane Smith</author>
    </authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text>
                <t>This is a comment</t>
            </text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.authors.len(), 2);
        assert_eq!(comments.authors[0], "John Doe");
        assert_eq!(comments.authors[1], "Jane Smith");
        assert_eq!(comments.comments.len(), 1);
        assert_eq!(comments.comments[0].cell_ref, "A1");
        assert_eq!(comments.comments[0].author_id, 0);
        assert_eq!(comments.comments[0].text(), "This is a comment");
    }

    #[test]
    fn test_parse_comments_rich_text() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>Author</author></authors>
    <commentList>
        <comment ref="B2" authorId="0">
            <text>
                <r>
                    <rPr><b/><sz val="11"/></rPr>
                    <t>Bold </t>
                </r>
                <r>
                    <rPr><i/></rPr>
                    <t>Italic</t>
                </r>
            </text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.comments.len(), 1);

        let comment = &comments.comments[0];
        assert_eq!(comment.rich_text.len(), 2);
        assert_eq!(comment.rich_text[0].text, "Bold ");
        assert!(comment.rich_text[0].font.as_ref().unwrap().bold);
        assert_eq!(comment.rich_text[0].font.as_ref().unwrap().size, Some(11.0));
        assert_eq!(comment.rich_text[1].text, "Italic");
        assert!(comment.rich_text[1].font.as_ref().unwrap().italic);
        assert_eq!(comment.text(), "Bold Italic");
    }

    #[test]
    fn test_parse_comments_with_entities() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>A &amp; B</author></authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text><t>&lt;tag&gt; &amp; &quot;text&quot;</t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.authors[0], "A & B");
        assert_eq!(comments.comments[0].text(), "<tag> & \"text\"");
    }

    #[test]
    fn test_parse_comments_multiple() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>User</author></authors>
    <commentList>
        <comment ref="A1" authorId="0"><text><t>First</t></text></comment>
        <comment ref="B2" authorId="0"><text><t>Second</t></text></comment>
        <comment ref="C3" authorId="0"><text><t>Third</t></text></comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.comments.len(), 3);
        assert_eq!(comments.comments[0].cell_ref, "A1");
        assert_eq!(comments.comments[1].cell_ref, "B2");
        assert_eq!(comments.comments[2].cell_ref, "C3");
    }

    #[test]
    fn test_parse_comment_with_guid() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>User</author></authors>
    <commentList>
        <comment ref="A1" authorId="0" guid="{12345678-1234-1234-1234-123456789012}">
            <text><t>Comment with GUID</t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(
            comments.comments[0].guid,
            Some("{12345678-1234-1234-1234-123456789012}".to_string())
        );
    }

    // -------------------------------------------------------------------------
    // Threaded comments tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_threaded_comments_empty() {
        let xml = b"<?xml version=\"1.0\"?><worksheet></worksheet>";
        let threaded = parse_threaded_comments(xml);
        assert!(threaded.persons.is_empty());
        assert!(threaded.comments.is_empty());
    }

    #[test]
    fn test_parse_threaded_comments_basic() {
        let xml = br#"<?xml version="1.0"?>
<ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments">
    <personList>
        <person displayName="John Doe" id="TC_1"/>
    </personList>
    <threadedComment ref="A1" id="TC_C1" personId="TC_1">
        <text>This is a threaded comment</text>
    </threadedComment>
</ThreadedComments>"#;

        let threaded = parse_threaded_comments(xml);
        assert_eq!(threaded.persons.len(), 1);
        assert_eq!(threaded.persons[0].display_name, "John Doe");
        assert_eq!(threaded.comments.len(), 1);
        assert_eq!(threaded.comments[0].cell_ref, "A1");
        assert_eq!(threaded.comments[0].text, "This is a threaded comment");
    }

    #[test]
    fn test_parse_threaded_comments_with_reply() {
        let xml = br#"<?xml version="1.0"?>
<ThreadedComments>
    <personList>
        <person displayName="User1" id="P1"/>
        <person displayName="User2" id="P2"/>
    </personList>
    <threadedComment ref="A1" id="C1" personId="P1">
        <text>Original comment</text>
    </threadedComment>
    <threadedComment ref="A1" id="C2" personId="P2" parentId="C1">
        <text>Reply to original</text>
    </threadedComment>
</ThreadedComments>"#;

        let threaded = parse_threaded_comments(xml);
        assert_eq!(threaded.comments.len(), 2);
        assert!(threaded.comments[0].parent_id.is_none());
        assert_eq!(threaded.comments[1].parent_id, Some("C1".to_string()));
    }

    // -------------------------------------------------------------------------
    // VML shape tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_vml_shapes_empty() {
        let xml = b"<?xml version=\"1.0\"?><xml></xml>";
        let shapes = parse_vml_shapes(xml);
        assert!(shapes.is_empty());
    }

    #[test]
    fn test_parse_vml_shape_basic() {
        let xml = br#"<?xml version="1.0"?>
<xml>
    <v:shape id="_x0000_s1025" style="position:absolute">
        <x:ClientData ObjectType="Note">
            <x:Anchor>1, 15, 0, 2, 3, 15, 5, 14</x:Anchor>
            <x:Row>0</x:Row>
            <x:Column>0</x:Column>
        </x:ClientData>
    </v:shape>
</xml>"#;

        let shapes = parse_vml_shapes(xml);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].id, "_x0000_s1025");
        assert_eq!(shapes[0].left_column, 1);
        assert_eq!(shapes[0].left_offset, 15);
        assert_eq!(shapes[0].top_row, 0);
        assert_eq!(shapes[0].cell_ref, Some("A1".to_string()));
    }

    #[test]
    fn test_parse_vml_shape_hidden() {
        let xml = br#"<?xml version="1.0"?>
<xml>
    <v:shape id="s1" style="visibility:hidden">
        <x:ClientData ObjectType="Note">
            <x:Row>0</x:Row>
            <x:Column>0</x:Column>
        </x:ClientData>
    </v:shape>
</xml>"#;

        let shapes = parse_vml_shapes(xml);
        assert!(!shapes[0].visible);
    }

    // -------------------------------------------------------------------------
    // Helper function tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_column_to_ref() {
        assert_eq!(column_to_ref(0, 0), "A1");
        assert_eq!(column_to_ref(1, 0), "B1");
        assert_eq!(column_to_ref(25, 0), "Z1");
        assert_eq!(column_to_ref(26, 0), "AA1");
        assert_eq!(column_to_ref(27, 0), "AB1");
        assert_eq!(column_to_ref(0, 99), "A100");
    }

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
    }

    #[test]
    fn test_decode_xml_entities_numeric() {
        // xml_utils::decode_xml_entities handles numeric character references
        assert_eq!(decode_xml_entities(b"&#65;"), "A");
        assert_eq!(decode_xml_entities(b"&#x41;"), "A");
        assert_eq!(decode_xml_entities(b"&#10;"), "\n");
    }

    #[test]
    fn test_parse_comment_font() {
        let xml = br#"<rPr>
            <rFont val="Arial"/>
            <sz val="12"/>
            <b/>
            <i/>
            <u/>
            <strike/>
            <color rgb="FF0000"/>
        </rPr>"#;

        let font = parse_comment_font(xml);
        assert_eq!(font.name, Some("Arial".to_string()));
        assert_eq!(font.size, Some(12.0));
        assert!(font.bold);
        assert!(font.italic);
        assert!(font.underline);
        assert!(font.strike);
        assert_eq!(font.color, Some("FF0000".to_string()));
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_comments_empty_text() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors><author>User</author></authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text><t></t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert_eq!(comments.comments.len(), 1);
        assert_eq!(comments.comments[0].text(), "");
    }

    #[test]
    fn test_parse_comments_no_authors() {
        let xml = br#"<?xml version="1.0"?>
<comments>
    <authors></authors>
    <commentList>
        <comment ref="A1" authorId="0">
            <text><t>Orphan comment</t></text>
        </comment>
    </commentList>
</comments>"#;

        let comments = parse_comments(xml);
        assert!(comments.authors.is_empty());
        assert_eq!(comments.comments.len(), 1);
    }

    #[test]
    fn test_parse_anchor_values() {
        let mut shape = CommentShape::default();
        parse_anchor_values(b"1, 15, 2, 10, 4, 20, 6, 30", &mut shape);

        assert_eq!(shape.left_column, 1);
        assert_eq!(shape.left_offset, 15);
        assert_eq!(shape.top_row, 2);
        assert_eq!(shape.top_offset, 10);
        assert_eq!(shape.right_column, 4);
        assert_eq!(shape.right_offset, 20);
        assert_eq!(shape.bottom_row, 6);
        assert_eq!(shape.bottom_offset, 30);
    }
}
