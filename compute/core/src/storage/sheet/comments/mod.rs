//! Cell comment CRUD with threading, resolution, and orphan cleanup.
//!
//! Comments keep typed stable cell anchors and all authored OOXML metadata.
//! Positions are resolved from the native identity index at query/export time.

mod cleanup;
mod mutations;
mod notes;
mod queries;
mod store;
pub(crate) use store::{CommentAnchor, StoredComment, relocate_anchors, remap_for_copy};

#[cfg(test)]
mod tests;

#[cfg(test)]
pub use domain_types::domain::comment::{AddCommentOptions, Comment, CommentType, RichTextRun};

pub use cleanup::validate_and_clean_comments;
pub use mutations::{
    add_comment, clear_all_comments, complete_thread_metadata, delete_comment,
    delete_comments_for_cell, set_thread_resolved, update_comment, update_comment_mentions,
};
pub use notes::{convert_note_to_thread, set_note_dimensions, set_note_visible};
pub use queries::{
    get_all_comments, get_all_notes, get_cell_ids_with_comments, get_comment, get_comment_count,
    get_comment_thread, get_comments_for_cell, get_note_count, has_comments,
};

pub(crate) use queries::cell_ids_with_comments;
