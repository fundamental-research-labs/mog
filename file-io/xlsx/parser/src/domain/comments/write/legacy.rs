use crate::write::xml_writer::XmlWriter;

use super::namespaces::{MC_NS, SPREADSHEETML_NS, XR_NS};
use super::types::{CommentAuthor, CommentShape, CommentTextRun, LegacyComment};
use super::vml;

const XDR_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

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
    /// Safe root-level `<extLst>...</extLst>` from imported comments XML.
    root_ext_lst_xml: Option<String>,
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

    /// Set a preserved root-level `<extLst>` for owner-scoped comment package
    /// metadata. Relationship-bearing fragments are rejected at emission.
    pub fn set_root_ext_lst_xml(&mut self, ext_lst_xml: Option<String>) {
        self.root_ext_lst_xml = ext_lst_xml;
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
            comment_pr: None,
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

        let has_comment_pr_anchor = self
            .comments
            .iter()
            .any(|c| c.comment_pr.as_ref().and_then(|pr| pr.anchor).is_some());
        if !self.root_namespace_attrs.is_empty() {
            // Emit root namespace declarations from the original file.
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
        if has_comment_pr_anchor
            && !self
                .root_namespace_attrs
                .iter()
                .any(|(name, _)| name == "xmlns:xdr")
        {
            w.attr("xmlns:xdr", XDR_NS);
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

        if let Some(ref ext_lst_xml) = self.root_ext_lst_xml {
            if !crate::infra::xml::raw_xml_contains_relationship_attr(ext_lst_xml) {
                w.raw_str(ext_lst_xml);
            }
        }

        w.end_element("comments");

        w.finish()
    }

    /// Generate VML drawing for comment shapes
    pub fn to_vml(&self) -> Vec<u8> {
        vml::write_vml(&self.shapes)
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
        if let Some(ref comment_pr) = comment.comment_pr
            && comment_pr.anchor.is_some()
        {
            self.write_comment_pr(w, comment_pr);
        }
        w.end_element("comment");
    }

    fn write_comment_pr(&self, w: &mut XmlWriter, comment_pr: &ooxml_types::comments::CommentPr) {
        w.start_element("commentPr");
        if !comment_pr.locked {
            w.attr("locked", "0");
        }
        if !comment_pr.default_size {
            w.attr("defaultSize", "0");
        }
        if !comment_pr.print {
            w.attr("print", "0");
        }
        if comment_pr.disabled {
            w.attr("disabled", "1");
        }
        if !comment_pr.auto_fill {
            w.attr("autoFill", "0");
        }
        if !comment_pr.auto_line {
            w.attr("autoLine", "0");
        }
        if let Some(ref alt_text) = comment_pr.alt_text {
            w.attr("altText", alt_text);
        }
        if let Some(text_h_align) = comment_pr.text_h_align {
            w.attr("textHAlign", text_h_align.to_ooxml());
        }
        if let Some(text_v_align) = comment_pr.text_v_align {
            w.attr("textVAlign", text_v_align.to_ooxml());
        }
        if !comment_pr.lock_text {
            w.attr("lockText", "0");
        }
        if comment_pr.just_last_x {
            w.attr("justLastX", "1");
        }
        if comment_pr.auto_scale {
            w.attr("autoScale", "1");
        }
        w.end_attrs();

        if let Some(anchor) = comment_pr.anchor {
            self.write_object_anchor(w, anchor);
        }

        w.end_element("commentPr");
    }

    fn write_object_anchor(&self, w: &mut XmlWriter, anchor: ooxml_types::ole::ObjectAnchor) {
        w.start_element("anchor");
        if anchor.move_with_cells {
            w.attr("moveWithCells", "1");
        }
        if anchor.size_with_cells {
            w.attr("sizeWithCells", "1");
        }
        w.end_attrs();
        self.write_anchor_point(w, "xdr:from", anchor.from);
        self.write_anchor_point(w, "xdr:to", anchor.to);
        w.end_element("anchor");
    }

    fn write_anchor_point(
        &self,
        w: &mut XmlWriter,
        element_name: &str,
        point: ooxml_types::ole::CellAnchorPoint,
    ) {
        w.start_element(element_name).end_attrs();
        w.element_with_text("xdr:col", &point.col.to_string());
        w.element_with_text("xdr:colOff", &point.col_offset.to_string());
        w.element_with_text("xdr:row", &point.row.to_string());
        w.element_with_text("xdr:rowOff", &point.row_offset.to_string());
        w.end_element(element_name);
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

        // Write text content - only emit xml:space="preserve" when the original had it.
        let t = w.start_element("t");
        if run.preserve_space {
            t.attr("xml:space", "preserve");
        }
        t.end_attrs().text(&run.text).end_element("t");

        w.end_element("r");
    }
}
