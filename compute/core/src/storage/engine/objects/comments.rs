use crate::snapshot::MutationResult;
use crate::storage::engine::ComputeEngine;
use crate::storage::engine::services;
use bridge_core as bridge;
use cell_types::SheetId;
use domain_types::domain::comment::{Comment, CommentMention, CommentType};
use value_types::ComputeError;

#[bridge::api(
    service = "ComputeEngine",
    key = "doc_id",
    group = "objects_comments",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl ComputeEngine {
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::add_comment(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                cell_id,
                text,
                author,
                author_id.as_deref(),
                parent_id.as_deref(),
                comment_type,
            )
        })
    }

    /// Convert an existing note to a threaded comment.
    /// Returns the updated `Comment` in `MutationResult.data` so the popover
    /// can re-render in thread mode after the bridge round-trip.
    #[bridge::write(scope = "sheet")]
    pub fn convert_note_to_thread(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::convert_note_to_thread(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                comment_id,
            )
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn update_comment(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
        text: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::update_comment(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                comment_id,
                text,
            )
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_comment(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::delete_comment(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                comment_id,
            )
        })
    }

    #[bridge::write(scope = "sheet")]
    pub fn set_thread_resolved(
        &mut self,
        sheet_id: &SheetId,
        cell_id: &str,
        resolved: bool,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::set_thread_resolved(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                cell_id,
                resolved,
            )
        })
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::set_note_visible(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                comment_id,
                visible,
            )
        })
    }

    /// Set the height and/or width of a note (in points).
    #[bridge::write(scope = "sheet")]
    pub fn set_note_dimensions(
        &mut self,
        sheet_id: &SheetId,
        comment_id: &str,
        height: Option<f64>,
        width: Option<f64>,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::set_note_dimensions(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                comment_id,
                height,
                width,
            )
        })
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::delete_comments_for_cell(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                cell_id,
            )
        })
    }

    /// Remove all comments from a sheet.
    #[bridge::write(scope = "sheet")]
    pub fn clear_all_comments(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::clear_all_comments(&mut engine.stores, &engine.cell_store, sheet_id)
        })
    }

    /// Validate comments and remove orphans whose parent cells no longer exist.
    /// Returns a `MutationResult` with the removed count in `data`.
    #[bridge::write(scope = "sheet")]
    pub fn validate_and_clean_comments(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::validate_and_clean_comments(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
            )
        })
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            services::objects::update_comment_mentions(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                comment_id,
                content,
                mentions,
            )
        })
    }

    // -------------------------------------------------------------------
    // Comments — position-based entry points
    // -------------------------------------------------------------------

    /// Add a comment to a cell identified by (row, col) position.
    ///
    /// Resolves or allocates the CellId in the shared cell store.
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
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let (result, cell_id) = services::objects::add_comment_by_position(
                &mut engine.stores,
                &mut engine.cell_store,
                sheet_id,
                row,
                col,
                text,
                author,
                author_id.as_deref(),
                parent_id.as_deref(),
                comment_type,
            )?;
            engine.cell_store.set_comment(sheet_id, cell_id);

            Ok(result)
        })
    }

    /// Get comments for a cell identified by (row, col) position.
    #[bridge::read(scope = "cell")]
    pub fn get_comments_for_cell_by_position(
        &self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Vec<Comment> {
        services::objects::get_comments_for_cell_by_position(
            &self.stores,
            &self.cell_store,
            sheet_id,
            row,
            col,
        )
    }

    /// Check whether a cell at (row, col) has any comments.
    #[bridge::read(scope = "cell")]
    pub fn has_comments_by_position(&self, sheet_id: &SheetId, row: u32, col: u32) -> bool {
        services::objects::has_comments_by_position(
            &self.stores,
            &self.cell_store,
            sheet_id,
            row,
            col,
        )
    }

    /// Delete all comments for a cell identified by (row, col) position.
    #[bridge::write(scope = "cell")]
    pub fn delete_comments_for_cell_by_position(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<MutationResult, ComputeError> {
        self.with_history(|engine| {
            let (result, cell_id) = services::objects::delete_comments_for_cell_by_position(
                &mut engine.stores,
                &engine.cell_store,
                sheet_id,
                row,
                col,
            )?;
            if let Some(cid) = cell_id {
                engine.cell_store.remove_comment(sheet_id, &cid);
            }
            Ok(result)
        })
    }

    // -------------------------------------------------------------------
    // Charts (stored as floating objects with type == "chart")
    // -------------------------------------------------------------------
}
