//! Threaded comment operations for a sheet.

use crate::dispatch::Dispatch;
use crate::error::ComputeApiError;
use cell_types::SheetId;
use domain_types::Comment;
use domain_types::domain::comment::{CommentMention, CommentType};
use snapshot_types::MutationResult;

/// Sub-API for comment operations on a single sheet.
pub struct SheetComments {
    dispatch: Dispatch,
    sheet_id: SheetId,
}

impl SheetComments {
    pub(crate) fn new(dispatch: Dispatch, sheet_id: SheetId) -> Self {
        Self { dispatch, sheet_id }
    }

    // -----------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------

    /// Get all comments attached to a specific cell.
    pub fn get_for_cell(&self, cell_id: &str) -> Result<Vec<Comment>, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = cell_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_comments_for_cell(&sid, &cid))
    }

    /// Get all comments in this sheet.
    pub fn get_all(&self) -> Result<Vec<Comment>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_all_comments(&sid))
    }

    /// Get a single comment by its ID.
    pub fn get(&self, comment_id: &str) -> Result<Option<Comment>, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_comment(&sid, &cid))
    }

    /// Get all comments in a thread, sorted by creation time.
    pub fn get_thread(&self, thread_id: &str) -> Result<Vec<Comment>, ComputeApiError> {
        let sid = self.sheet_id;
        let tid = thread_id.to_string();
        self.dispatch
            .query_engine(move |e| e.get_comment_thread(&sid, &tid))
    }

    /// Get the total number of comments in this sheet.
    pub fn count(&self) -> Result<u32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .query_engine(move |e| e.get_comment_count(&sid))
    }

    /// Get the count of notes (comments with `comment_type == Note`) in this sheet.
    pub fn note_count(&self) -> Result<u32, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_note_count(&sid))
    }

    /// Get all notes (comments with `comment_type == Note`) in this sheet.
    pub fn get_all_notes(&self) -> Result<Vec<Comment>, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch.query_engine(move |e| e.get_all_notes(&sid))
    }

    /// Set the `visible` flag on a note (VML note visibility).
    pub fn set_note_visible(
        &self,
        comment_id: &str,
        visible: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        self.dispatch
            .call_engine(move |e| e.set_note_visible(&sid, &cid, visible))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Set the height and/or width of a note (in points).
    pub fn set_note_dimensions(
        &self,
        comment_id: &str,
        height: Option<f64>,
        width: Option<f64>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        self.dispatch
            .call_engine(move |e| e.set_note_dimensions(&sid, &cid, height, width))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Check whether a cell has any comments.
    pub fn has_comments(&self, cell_id: &str) -> Result<bool, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = cell_id.to_string();
        self.dispatch
            .query_engine(move |e| e.has_comments(&sid, &cid))
    }

    // -----------------------------------------------------------------
    // Mutations
    // -----------------------------------------------------------------

    /// Add a comment to a cell.
    ///
    /// `comment_type` is the discriminator: `Note` writes a legacy note (no
    /// thread membership, can't have replies), `ThreadedComment` writes a
    /// modern threaded comment. Notes with a non-`None` `parent_id` are
    /// rejected as a contract violation.
    #[allow(clippy::too_many_arguments)]
    pub fn add(
        &self,
        cell_id: &str,
        author: &str,
        text: &str,
        author_id: Option<&str>,
        parent_id: Option<&str>,
        comment_type: CommentType,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = cell_id.to_string();
        let auth = author.to_string();
        let txt = text.to_string();
        let aid = author_id.map(|s| s.to_string());
        let pid = parent_id.map(|s| s.to_string());
        self.dispatch
            .call_engine(move |e| e.add_comment(&sid, &cid, &txt, &auth, aid, pid, comment_type))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Convert an existing note into a threaded comment. Returns
    /// `MutationResult` whose `data` contains the updated `Comment`.
    pub fn convert_note_to_thread(
        &self,
        comment_id: &str,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        self.dispatch
            .call_engine(move |e| e.convert_note_to_thread(&sid, &cid))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Update a comment's text.
    pub fn update(&self, comment_id: &str, text: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        let txt = text.to_string();
        self.dispatch
            .call_engine(move |e| e.update_comment(&sid, &cid, &txt))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Update a comment with mention content.
    pub fn update_mentions(
        &self,
        comment_id: &str,
        content: &str,
        mentions: Vec<CommentMention>,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        let cnt = content.to_string();
        self.dispatch
            .call_engine(move |e| e.update_comment_mentions(&sid, &cid, &cnt, mentions))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Delete a comment by ID.
    pub fn delete(&self, comment_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = comment_id.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_comment(&sid, &cid))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Set thread resolved status.
    pub fn set_thread_resolved(
        &self,
        cell_id: &str,
        resolved: bool,
    ) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = cell_id.to_string();
        self.dispatch
            .call_engine(move |e| e.set_thread_resolved(&sid, &cid, resolved))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Delete all comments associated with a specific cell.
    pub fn delete_for_cell(&self, cell_id: &str) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        let cid = cell_id.to_string();
        self.dispatch
            .call_engine(move |e| e.delete_comments_for_cell(&sid, &cid))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }

    /// Remove all comments from this sheet.
    pub fn clear_all(&self) -> Result<MutationResult, ComputeApiError> {
        let sid = self.sheet_id;
        self.dispatch
            .call_engine(move |e| e.clear_all_comments(&sid))
            .and_then(|r| {
                r.map(|(_patches, result)| result)
                    .map_err(ComputeApiError::from)
            })
    }
}
