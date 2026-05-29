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

mod from_domain;
mod helpers;
mod legacy;
mod namespaces;
#[cfg(test)]
mod tests;
mod threaded;
mod types;
mod vml;

pub use from_domain::{
    comments_from_domain, comments_from_domain_with_package, persons_xml_from_domain,
    threaded_comments_xml_from_domain,
};
pub use helpers::generate_guid;
pub use legacy::CommentsWriter;
pub use threaded::ThreadedCommentsWriter;
pub use types::{
    CommentAuthor, CommentShape, CommentTextRun, LegacyComment, ThreadedAuthor, ThreadedComment,
    ThreadedMention,
};
