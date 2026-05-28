//! Comments parser facade for XLSX worksheets.
//!
//! The child modules own parsing for the OOXML comments parts while this module
//! preserves the historical `domain::comments::read::*` import surface.

mod legacy;
mod rich_text;
mod sheet;
mod support;
mod threaded;
mod vml;

pub use crate::domain::comments::types::{
    Comment, CommentFont, CommentRun, CommentShape, Comments, ParsedMention, ThreadedComment,
    ThreadedComments, ThreadedPerson,
};
pub use legacy::parse_comments;
pub use sheet::parse_comments_for_sheet;
pub use threaded::{parse_threaded_comments, parse_threaded_comments_root_attrs};
pub use vml::parse_vml_shapes;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_facade_reexports_comment_types() {
        let comment = Comment {
            rich_text: vec![CommentRun {
                text: "facade".to_string(),
                font: Some(CommentFont::default()),
                preserve_space: false,
            }],
            ..Default::default()
        };

        let _: Comments = Comments::default();
        let _: ThreadedComments = ThreadedComments::default();
        let _: ThreadedPerson = ThreadedPerson::default();
        let _: ParsedMention = ParsedMention::default();
        let _: ThreadedComment = ThreadedComment::default();
        let _: CommentShape = CommentShape::default();
        assert_eq!(comment.text(), "facade");
    }
}
