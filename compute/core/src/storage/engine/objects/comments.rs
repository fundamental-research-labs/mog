use super::shared;
use crate::snapshot::MutationResult;
use crate::storage::engine::YrsComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::domain::comment::{Comment, CommentMention, CommentType};
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects_comments",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    #[bridge::skip(ts_bridge)]
    #[bridge::write(scope = "sheet")]
    #[allow(clippy::too_many_arguments)]
    pub fn add_comment(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &str,
        text: &str,
        author: &str,
        author_id: Option<String>,
        parent_id: Option<String>,
        comment_type: CommentType,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (result, row, col) = services::objects::add_comment(
            &mut self.stores,
            sheet_id,
            cell_id,
            text,
            author,
            author_id.as_deref(),
            parent_id.as_deref(),
            comment_type,
        )?;
        let patches = self.produce_comment_viewport_patches(sheet_id, &[(row, col)], true);
        Ok((patches, result))
    }

    /// Convert an existing note to a threaded comment.
    /// Returns the updated `Comment` in `MutationResult.data` so the popover
    /// can re-render in thread mode after the bridge round-trip.
    #[bridge::write(scope = "sheet")]
    pub fn convert_note_to_thread(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::convert_note_to_thread(&mut self.stores, sheet_id, comment_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_comment(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
        text: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_comment(&mut self.stores, sheet_id, comment_id, text)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_comment(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (result, cell_pos, still_has) =
            services::objects::delete_comment(&mut self.stores, sheet_id, comment_id)?;
        let patches = if let Some((row, col)) = cell_pos {
            self.produce_comment_viewport_patches(sheet_id, &[(row, col)], still_has)
        } else {
            shared::empty_patches()
        };
        Ok((patches, result))
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_thread_resolved(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &str,
        resolved: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_thread_resolved(&mut self.stores, sheet_id, cell_id, resolved)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_comments_for_cell(&self, sheet_id: &SheetId, cell_id: &str) -> Vec<Comment> {
        services::objects::get_comments_for_cell(&self.stores, sheet_id, cell_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_all_comments(&self, sheet_id: &SheetId) -> Vec<Comment> {
        services::objects::get_all_comments(&self.stores, sheet_id)
    }

    /// Get a single comment by its ID.
    #[bridge::read(scope = "sheet")]
    pub fn get_comment(&self, sheet_id: &SheetId, comment_id: &str) -> Option<Comment> {
        services::objects::get_comment(&self.stores, sheet_id, comment_id)
    }

    /// Get all comments in a thread, sorted by creation time.
    #[bridge::read(scope = "sheet")]
    pub fn get_comment_thread(&self, sheet_id: &SheetId, thread_id: &str) -> Vec<Comment> {
        services::objects::get_comment_thread(&self.stores, sheet_id, thread_id)
    }

    /// Get the total number of comments in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_comment_count(&self, sheet_id: &SheetId) -> u32 {
        services::objects::get_comment_count(&self.stores, sheet_id)
    }

    /// Get the count of notes (comments with `comment_type == Note`) in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_note_count(&self, sheet_id: &SheetId) -> u32 {
        services::objects::get_note_count(&self.stores, sheet_id)
    }

    /// Get all notes (comments with `comment_type == Note`) in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_notes(&self, sheet_id: &SheetId) -> Vec<Comment> {
        services::objects::get_all_notes(&self.stores, sheet_id)
    }

    /// Set the `visible` flag on a note (VML note visibility).
    #[bridge::write(scope = "sheet")]
    pub fn set_note_visible(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
        visible: bool,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_note_visible(&mut self.stores, sheet_id, comment_id, visible)
    }

    /// Set the height and/or width of a note (in points).
    #[bridge::write(scope = "sheet")]
    pub fn set_note_dimensions(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
        height: Option<f64>,
        width: Option<f64>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_note_dimensions(
            &mut self.stores,
            sheet_id,
            comment_id,
            height,
            width,
        )
    }

    /// Check whether a cell has any comments.
    #[bridge::read(scope = "sheet")]
    pub fn has_comments(&self, sheet_id: &SheetId, cell_id: &str) -> bool {
        services::objects::has_comments(&self.stores, sheet_id, cell_id)
    }

    /// Delete all comments associated with a specific cell. Returns a `MutationResult` with the
    /// deleted count in `data`.
    /// Skipped for napi: usize is not supported by napi-rs FFI.
    #[bridge::write(scope = "sheet")]
    #[bridge::skip(napi)]
    pub fn delete_comments_for_cell(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (result, row, col) =
            services::objects::delete_comments_for_cell(&mut self.stores, sheet_id, cell_id)?;
        let patches = self.produce_comment_viewport_patches(sheet_id, &[(row, col)], false);
        Ok((patches, result))
    }

    /// Remove all comments from a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_comments(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (result, positions) =
            services::objects::clear_all_comments(&mut self.stores, sheet_id)?;
        let patches = if positions.is_empty() {
            shared::empty_patches()
        } else {
            self.produce_comment_viewport_patches(sheet_id, &positions, false)
        };
        Ok((patches, result))
    }

    /// Validate comments and remove orphans whose parent cells no longer exist.
    /// Returns a `MutationResult` with the removed count in `data`.
    #[bridge::write(scope = "sheet")]
    pub fn validate_and_clean_comments(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::validate_and_clean_comments(&mut self.stores, sheet_id)
    }

    /// Update a comment with mention content. Sets content, content_type to Mention,
    /// and mentions array in a single mutation.
    #[bridge::write(scope = "sheet")]
    pub fn update_comment_mentions(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
        content: &str,
        mentions: Vec<CommentMention>,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_comment_mentions(
            &mut self.stores,
            sheet_id,
            comment_id,
            content,
            mentions,
        )
    }

    // -------------------------------------------------------------------
    // Comments — position-based entry points
    // -------------------------------------------------------------------

    /// Add a comment to a cell identified by (row, col) position.
    ///
    /// Resolves the CellId from the grid index. If no cell exists at the
    /// position, a new CellId is created and registered in both the
    /// in-memory grid index and the Yrs grid index maps.
    #[bridge::write(scope = "cell")]
    #[allow(clippy::too_many_arguments)]
    pub fn add_comment_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        text: &str,
        author: &str,
        author_id: Option<String>,
        parent_id: Option<String>,
        comment_type: CommentType,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (result, cell_id) = services::objects::add_comment_by_position(
            &mut self.stores,
            &self.mirror,
            sheet_id,
            row,
            col,
            text,
            author,
            author_id.as_deref(),
            parent_id.as_deref(),
            comment_type,
        )?;
        self.mirror.set_comment(sheet_id, cell_id);
        let patches = self.produce_comment_viewport_patches(sheet_id, &[(row, col)], true);
        Ok((patches, result))
    }

    /// Get comments for a cell identified by (row, col) position.
    #[bridge::read(scope = "cell")]
    pub fn get_comments_for_cell_by_position(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<Comment> {
        services::objects::get_comments_for_cell_by_position(&self.stores, sheet_id, row, col)
    }

    /// Check whether a cell at (row, col) has any comments.
    #[bridge::read(scope = "cell")]
    pub fn has_comments_by_position(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        services::objects::has_comments_by_position(&self.stores, sheet_id, row, col)
    }

    /// Delete all comments for a cell identified by (row, col) position.
    #[bridge::write(scope = "cell")]
    pub fn delete_comments_for_cell_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let (result, cell_id) = services::objects::delete_comments_for_cell_by_position(
            &mut self.stores,
            sheet_id,
            row,
            col,
        )?;
        if let Some(cid) = cell_id {
            self.mirror.remove_comment(sheet_id, &cid);
            let patches = self.produce_comment_viewport_patches(sheet_id, &[(row, col)], false);
            Ok((patches, result))
        } else {
            let patches = shared::empty_patches();
            Ok((patches, result))
        }
    }

    // -------------------------------------------------------------------
    // Charts (stored as floating objects with type == "chart")
    // -------------------------------------------------------------------
}
