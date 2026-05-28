//! Cell comment CRUD with threading, resolution, and orphan cleanup.
//!
//! Port of `spreadsheet-model/src/comments.ts` (spreadsheet-model elimination).
//!
//! ## Yrs Storage Layout
//!
//! Each sheet has a `comments` map storing comments as structured Y.Maps keyed
//! by comment ID:
//! ```text
//! sheets: Y.Map<SheetId, Y.Map>
//!   +-- {sheetId}: Y.Map
//!       +-- comments: Y.Map
//!           +-- {commentId}: Y.Map  (structured fields: id, cellRef, author, ...)
//! ```
//!
//! ## Cell Identity Model
//!
//! Comments reference cells via CellId (stable UUID). Position is resolved at
//! render time. `validate_and_clean_comments()` removes orphaned comments when
//! their parent cells are deleted.

// Keep this file as the compatibility facade for `storage::sheet::comments`.
// New implementation logic belongs in the focused submodules below.
mod cleanup;
mod mutations;
mod notes;
mod queries;
mod yrs_io;

#[cfg(test)]
mod tests;

pub use domain_types::domain::comment::{AddCommentOptions, Comment, CommentType, RichTextRun};

pub use cleanup::validate_and_clean_comments;
pub use mutations::{
    add_comment, clear_all_comments, delete_comment, delete_comments_for_cell, set_thread_resolved,
    update_comment, update_comment_mentions,
};
pub use notes::{convert_note_to_thread, set_note_dimensions, set_note_visible};
pub use queries::{
    get_all_comments, get_all_notes, get_cell_ids_with_comments, get_comment, get_comment_count,
    get_comment_thread, get_comments_for_cell, get_note_count, has_comments,
};
