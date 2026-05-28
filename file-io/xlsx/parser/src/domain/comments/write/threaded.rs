use crate::write::xml_writer::XmlWriter;

use super::helpers::{current_timestamp, generate_guid};
use super::namespaces::THREADED_COMMENTS_NS;
use super::types::{ThreadedAuthor, ThreadedComment};

// ============================================================================
// Threaded Comments Writer
// ============================================================================

/// Writer for threaded comments (Excel 365)
#[derive(Debug, Clone, Default)]
pub struct ThreadedCommentsWriter {
    authors: Vec<ThreadedAuthor>,
    comments: Vec<ThreadedComment>,
    root_namespace_attrs: Vec<(String, String)>,
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

    /// Set preserved root namespace declarations for regenerated threaded comments.
    pub fn set_root_namespace_attrs(&mut self, attrs: Vec<(String, String)>) {
        self.root_namespace_attrs = attrs;
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

        let mut root = w.start_element("ThreadedComments");
        if self.root_namespace_attrs.is_empty() {
            root = root.attr("xmlns", THREADED_COMMENTS_NS);
        } else {
            let has_default = self
                .root_namespace_attrs
                .iter()
                .any(|(name, _)| name == "xmlns");
            if !has_default {
                root = root.attr("xmlns", THREADED_COMMENTS_NS);
            }
            for (name, value) in &self.root_namespace_attrs {
                root = root.attr(name, value);
            }
        }
        root.end_attrs();

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
