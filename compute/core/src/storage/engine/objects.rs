//! Object methods (comments, charts, floating objects, pivots) for YrsComputeEngine.

use super::YrsComputeEngine;
use crate::engine_types::floating_objects::{
    CreateShapeConfig, FlipAxis, MoveTarget, ResizeConfig, ShapeStyleUpdate,
};
use crate::engine_types::{SerializedFloatingObjectGroup, ZOrderEntry};
use crate::snapshot::{ChangeKind, FloatingObjectBounds, MutationResult, PivotTableChange};
use bridge_core as bridge;
use cell_types::SheetId;
use compute_pivot::PivotTableDefExt;
use compute_pivot::types::validate_pivot_config_json;
use compute_pivot::types::{PivotExpansionState, PivotFieldItems, PivotTableResult};
use domain_types::domain::comment::{Comment, CommentMention, CommentType};
use domain_types::domain::floating_object::FloatingObject;
use domain_types::domain::pivot::PivotTableConfig;
use value_types::ComputeError;

use super::services;
use crate::storage::sheet::hyperlinks;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "objects",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    fn resolve_pivot_source_identity(
        &self,
        mut config: PivotTableConfig,
    ) -> Result<PivotTableConfig, ComputeError> {
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
            let source_id = SheetId::from_uuid_str(source_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot sourceSheetId '{source_sheet_id}': {e}"),
                }
            })?;
            let sheet =
                self.mirror
                    .get_sheet(&source_id)
                    .ok_or_else(|| ComputeError::SheetNotFound {
                        sheet_id: source_sheet_id.to_string(),
                    })?;
            if !config.source_sheet_name.is_empty() && config.source_sheet_name != sheet.name {
                return Err(ComputeError::InvalidInput {
                    message: format!(
                        "Pivot source identity conflict: sourceSheetId '{}' resolves to sheet '{}', but sourceSheetName is '{}'",
                        source_sheet_id, sheet.name, config.source_sheet_name
                    ),
                });
            }
            config.source_sheet_name = sheet.name.clone();
            config.source_sheet_id = Some(source_id.to_uuid_string());
            return Ok(config);
        }

        if config.source_sheet_name.is_empty() {
            return Err(ComputeError::InvalidInput {
                message: "Pivot source identity requires sourceSheetId or sourceSheetName"
                    .to_string(),
            });
        }

        let source_id = self
            .mirror
            .sheet_by_name(&config.source_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.source_sheet_name.clone(),
            })?;
        config.source_sheet_id = Some(source_id.to_uuid_string());
        Ok(config)
    }

    fn derive_pivot_source_name(&self, mut config: PivotTableConfig) -> PivotTableConfig {
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref()
            && let Ok(source_id) = SheetId::from_uuid_str(source_sheet_id)
            && let Some(sheet) = self.mirror.get_sheet(&source_id)
        {
            config.source_sheet_name = sheet.name.clone();
            config.source_sheet_id = Some(source_id.to_uuid_string());
        } else if config.source_sheet_id.is_none()
            && !config.source_sheet_name.is_empty()
            && let Some(source_id) = self.mirror.sheet_by_name(&config.source_sheet_name)
        {
            config.source_sheet_id = Some(source_id.to_uuid_string());
        }
        config
    }

    fn pivot_source_sheet_id(&self, config: &PivotTableConfig) -> Result<SheetId, ComputeError> {
        if let Some(source_sheet_id) = config.source_sheet_id.as_deref() {
            let source_id = SheetId::from_uuid_str(source_sheet_id).map_err(|e| {
                ComputeError::InvalidInput {
                    message: format!("Invalid pivot sourceSheetId '{source_sheet_id}': {e}"),
                }
            })?;
            if self.mirror.get_sheet(&source_id).is_some() {
                return Ok(source_id);
            }
            return Err(ComputeError::SheetNotFound {
                sheet_id: source_sheet_id.to_string(),
            });
        }

        self.mirror
            .sheet_by_name(&config.source_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.source_sheet_name.clone(),
            })
    }

    // -------------------------------------------------------------------
    // Comments
    // -------------------------------------------------------------------

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
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
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
            compute_wire::mutation::serialize_multi_viewport_patches(&[])
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
            let patches = compute_wire::mutation::serialize_multi_viewport_patches(&[]);
            Ok((patches, result))
        }
    }

    // -------------------------------------------------------------------
    // Charts (stored as floating objects with type == "chart")
    // -------------------------------------------------------------------

    /// Create a chart as a floating object. Chart domain data is stored as individual
    /// keys directly on the floating object's Y.Map (no `chartConfig` sub-object).
    /// Returns `floating_object_changes` with `Created` kind.
    #[bridge::write(scope = "sheet")]
    pub fn create_chart(
        &mut self,
        sheet_id: &SheetId,
        config: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_chart(&mut self.stores, sheet_id, config).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Update a chart's config fields as individual Y.Map keys on the floating object.
    #[bridge::write(scope = "sheet")]
    pub fn update_chart(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
        updates: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_chart(&mut self.stores, sheet_id, chart_id, updates).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Delete a chart by removing the floating object. Returns `floating_object_changes` with `Removed` kind.
    #[bridge::write(scope = "sheet")]
    pub fn delete_chart(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::delete_chart(&mut self.stores, sheet_id, chart_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Get a single chart by ID. Reads from floating objects filtered by type=="chart".
    #[bridge::read(scope = "sheet")]
    pub fn get_chart(&self, sheet_id: &SheetId, chart_id: &str) -> Option<FloatingObject> {
        services::objects::get_chart(&self.stores, sheet_id, chart_id)
    }

    /// Get all charts in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_charts(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_all_charts(&self.stores, sheet_id)
    }

    /// Bring a chart to the front (highest z-order). Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn bring_chart_to_front(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_chart_to_front(&mut self.stores, sheet_id, chart_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Send a chart to the back (lowest z-order). Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn send_chart_to_back(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_chart_to_back(&mut self.stores, sheet_id, chart_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Bring a chart one step forward in z-order. Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn bring_chart_forward(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_chart_forward(&mut self.stores, sheet_id, chart_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Send a chart one step backward in z-order. Delegates to floating object z-order.
    #[bridge::write(scope = "sheet")]
    pub fn send_chart_backward(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_chart_backward(&mut self.stores, sheet_id, chart_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Get all charts sorted by z-order (back to front).
    #[bridge::read(scope = "sheet")]
    pub fn get_charts_in_z_order(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_charts_in_z_order(&self.stores, sheet_id)
    }

    /// Link a chart to a table by setting its source table ID.
    #[bridge::write(scope = "sheet")]
    pub fn link_chart_to_table(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
        table_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::link_chart_to_table(&mut self.stores, sheet_id, chart_id, table_id).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Unlink a chart from its table.
    #[bridge::write(scope = "sheet")]
    pub fn unlink_chart_from_table(
        &mut self,
        sheet_id: &SheetId,
        chart_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::unlink_chart_from_table(&mut self.stores, sheet_id, chart_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Check whether a chart is linked to any table.
    #[bridge::read(scope = "sheet")]
    pub fn is_chart_linked_to_table(&self, sheet_id: &SheetId, chart_id: &str) -> bool {
        services::objects::is_chart_linked_to_table(&self.stores, sheet_id, chart_id)
    }

    /// Get all charts linked to a specific table.
    #[bridge::read(scope = "sheet")]
    pub fn get_charts_linked_to_table(
        &self,
        sheet_id: &SheetId,
        table_id: &str,
    ) -> Vec<FloatingObject> {
        services::objects::get_charts_linked_to_table(&self.stores, sheet_id, table_id)
    }

    /// Get the maximum z-index among all charts in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_max_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_max_z_index(&self.stores, sheet_id)
    }

    /// Get the minimum z-index among all charts in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_min_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_min_z_index(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Floating Objects
    // -------------------------------------------------------------------

    #[bridge::write(scope = "sheet")]
    pub fn set_floating_object(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        json: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_floating_object(&mut self.stores, sheet_id, object_id, json).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object(
        &self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<Option<serde_json::Value>, ComputeError> {
        services::objects::get_floating_object(&self.stores, sheet_id, object_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_objects_in_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
        services::objects::get_floating_objects_in_sheet(&self.stores, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_floating_object(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::delete_floating_object(&mut self.stores, sheet_id, object_id).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    // -------------------------------------------------------------------
    // Floating Object Groups
    // -------------------------------------------------------------------

    #[bridge::write(scope = "sheet")]
    pub fn set_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        json: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_floating_object_group(&mut self.stores, sheet_id, group_id, json)
            .map(|r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            })
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_group(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Result<Option<serde_json::Value>, ComputeError> {
        services::objects::get_floating_object_group(&self.stores, sheet_id, group_id)
    }

    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_groups_in_sheet(
        &self,
        sheet_id: &SheetId,
    ) -> Result<Vec<(String, serde_json::Value)>, ComputeError> {
        services::objects::get_floating_object_groups_in_sheet(&self.stores, sheet_id)
    }

    #[bridge::write(scope = "sheet")]
    pub fn delete_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::delete_floating_object_group(&mut self.stores, sheet_id, group_id).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    // -------------------------------------------------------------------
    // Typed Floating Objects (new API)
    // -------------------------------------------------------------------

    /// Create a new floating object with auto-generated ID, timestamps, and z-index.
    #[bridge::write(scope = "sheet")]
    pub fn create_floating_object(
        &mut self,
        sheet_id: &SheetId,
        config: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_floating_object(&mut self.stores, sheet_id, config).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Update a floating object by merging partial JSON updates.
    #[bridge::write(scope = "sheet")]
    pub fn update_floating_object(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        updates: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_floating_object(&mut self.stores, sheet_id, object_id, updates)
            .map(|r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            })
    }

    /// Create a shape from a typed config. Rust owns ID gen, z-index, timestamps, defaults.
    #[bridge::write(scope = "sheet")]
    pub fn create_shape(
        &mut self,
        sheet_id: &SheetId,
        config: CreateShapeConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_shape(&mut self.stores, sheet_id, config).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Move a floating object to a new position.
    #[bridge::write(scope = "sheet")]
    pub fn move_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        target: MoveTarget,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::move_floating_object_typed(&mut self.stores, sheet_id, object_id, target)
            .map(|r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            })
    }

    /// Resize a floating object.
    #[bridge::write(scope = "sheet")]
    pub fn resize_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        config: ResizeConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::resize_floating_object_typed(
            &mut self.stores,
            sheet_id,
            object_id,
            config,
        )
        .map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Rotate a floating object to a given angle in degrees.
    #[bridge::write(scope = "sheet")]
    pub fn rotate_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        rotation: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::rotate_floating_object_typed(
            &mut self.stores,
            sheet_id,
            object_id,
            rotation,
        )
        .map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Update the style properties of a shape.
    #[bridge::write(scope = "sheet")]
    pub fn update_shape_style(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        style: ShapeStyleUpdate,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_shape_style(&mut self.stores, sheet_id, object_id, style).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Flip a floating object along an axis.
    #[bridge::write(scope = "sheet")]
    pub fn flip_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        axis: FlipAxis,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::flip_floating_object_typed(&mut self.stores, sheet_id, object_id, axis)
            .map(|r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            })
    }

    /// Duplicate a floating object with pixel offsets.
    #[bridge::write(scope = "sheet")]
    pub fn duplicate_floating_object_typed(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
        offset_x: f64,
        offset_y: f64,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::duplicate_floating_object_typed(
            &mut self.stores,
            sheet_id,
            object_id,
            offset_x,
            offset_y,
        )
        .map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Find all connectors in a sheet that reference a given shape via
    /// `startConnection.shapeId` or `endConnection.shapeId`.
    ///
    /// Returns a list of `(objectId, JSON)` pairs. Used by the TS connector
    /// re-routing coordination to discover which connectors need updating
    /// when a shape moves or resizes.
    #[bridge::read(scope = "sheet")]
    pub fn find_connectors_for_shape(
        &self,
        sheet_id: &SheetId,
        shape_id: &str,
    ) -> Vec<FloatingObject> {
        services::objects::find_connectors_for_shape(&self.stores, sheet_id, shape_id)
    }

    /// Get a single floating object by ID as a typed struct.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_typed(
        &self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Option<FloatingObject> {
        services::objects::get_floating_object_typed(&self.stores, sheet_id, object_id)
    }

    /// Get all floating objects in a sheet as typed structs.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_floating_objects_typed(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_all_floating_objects_typed(&self.stores, sheet_id)
    }

    /// Compute pixel bounds for ALL floating objects on a sheet in a single batch call.
    ///
    /// Returns a vec of `(object_id, bounds)` pairs. Objects whose bounds cannot be
    /// computed (e.g., missing layout) are omitted from the result.
    ///
    /// This avoids N individual IPC round-trips during sheet switches and full syncs.
    #[bridge::read(scope = "sheet")]
    pub fn compute_all_object_bounds(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<(String, FloatingObjectBounds)> {
        services::objects::compute_all_object_bounds(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Floating Object Z-Order
    // -------------------------------------------------------------------

    /// Bring a floating object to the front (highest z-order).
    #[bridge::write(scope = "sheet")]
    pub fn bring_floating_object_to_front(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_floating_object_to_front(&mut self.stores, sheet_id, object_id)
            .map(|r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            })
    }

    /// Send a floating object to the back (lowest z-order).
    #[bridge::write(scope = "sheet")]
    pub fn send_floating_object_to_back(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_floating_object_to_back(&mut self.stores, sheet_id, object_id).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Bring a floating object one step forward in z-order.
    #[bridge::write(scope = "sheet")]
    pub fn bring_floating_object_forward(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::bring_floating_object_forward(&mut self.stores, sheet_id, object_id).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Send a floating object one step backward in z-order.
    #[bridge::write(scope = "sheet")]
    pub fn send_floating_object_backward(
        &mut self,
        sheet_id: &SheetId,
        object_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::send_floating_object_backward(&mut self.stores, sheet_id, object_id).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Get all floating objects sorted by z-order (back to front).
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_objects_in_z_order(&self, sheet_id: &SheetId) -> Vec<FloatingObject> {
        services::objects::get_floating_objects_in_z_order(&self.stores, sheet_id)
    }

    /// Get the maximum z-index among all floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_max_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_floating_object_max_z_index(&self.stores, sheet_id)
    }

    /// Get the minimum z-index among all floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_min_z_index(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_floating_object_min_z_index(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Typed Floating Object Groups (new API)
    // -------------------------------------------------------------------

    /// Create a new floating object group with auto-generated ID.
    #[bridge::write(scope = "sheet")]
    pub fn create_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        config: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::create_floating_object_group(&mut self.stores, sheet_id, config).map(
            |r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            },
        )
    }

    /// Update a floating object group by merging partial JSON updates.
    #[bridge::write(scope = "sheet")]
    pub fn update_floating_object_group(
        &mut self,
        sheet_id: &SheetId,
        group_id: &str,
        updates: &serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::update_floating_object_group(
            &mut self.stores,
            sheet_id,
            group_id,
            updates,
        )
        .map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Get a single floating object group by ID as a typed struct.
    #[bridge::read(scope = "sheet")]
    pub fn get_floating_object_group_typed(
        &self,
        sheet_id: &SheetId,
        group_id: &str,
    ) -> Option<SerializedFloatingObjectGroup> {
        services::objects::get_floating_object_group_typed(&self.stores, sheet_id, group_id)
    }

    /// Get all floating object groups in a sheet as typed structs.
    #[bridge::read(scope = "sheet")]
    pub fn get_all_floating_object_groups_typed(
        &self,
        sheet_id: &SheetId,
    ) -> Vec<SerializedFloatingObjectGroup> {
        services::objects::get_all_floating_object_groups_typed(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Unified Z-Order (Charts + Floating Objects)
    // -------------------------------------------------------------------

    /// Get the maximum z-index across ALL charts and floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_max_z_index_all(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_max_z_index_all(&self.stores, sheet_id)
    }

    /// Get the minimum z-index across ALL charts and floating objects in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn get_min_z_index_all(&self, sheet_id: &SheetId) -> i32 {
        services::objects::get_min_z_index_all(&self.stores, sheet_id)
    }

    /// Get all charts and floating objects interleaved by z-order (ascending, back to front).
    #[bridge::read(scope = "sheet")]
    pub fn get_all_in_z_order(&self, sheet_id: &SheetId) -> Vec<ZOrderEntry> {
        services::objects::get_all_in_z_order(&self.stores, sheet_id)
    }

    // -------------------------------------------------------------------
    // Hyperlinks
    // -------------------------------------------------------------------

    /// Set a hyperlink on a cell at the given position.
    #[bridge::write(scope = "cell")]
    pub fn set_hyperlink(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
        url: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::set_hyperlink(
            &mut self.stores,
            &mut self.mirror,
            sheet_id,
            row,
            col,
            url,
        )
        .map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Remove the hyperlink from a cell at the given position.
    #[bridge::write(scope = "cell")]
    pub fn remove_hyperlink(
        &mut self,
        sheet_id: &SheetId,
        row: u32,
        col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::remove_hyperlink(&mut self.stores, &mut self.mirror, sheet_id, row, col)
            .map(|r| {
                (
                    compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                    r,
                )
            })
    }

    /// Get the hyperlink URL for a cell at the given position.
    /// Reads directly from the Yrs CRDT document (not the in-memory mirror).
    #[bridge::read(scope = "cell")]
    pub fn get_hyperlink(&self, sheet_id: &SheetId, row: u32, col: u32) -> Option<String> {
        let grid = self.stores.grid_indexes.get(sheet_id)?;
        hyperlinks::get_hyperlink(
            self.stores.storage.doc(),
            self.stores.storage.sheets(),
            sheet_id,
            grid,
            row,
            col,
        )
    }

    /// Remove all hyperlinks in a rectangular range (single bridge call).
    ///
    /// Iterates every cell in the range, checks for a hyperlink, and removes
    /// it if present. This replaces the N-IPC-call pattern in the TS kernel.
    #[bridge::write(scope = "range")]
    pub fn clear_hyperlinks_in_range(
        &mut self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        for row in start_row..=end_row {
            for col in start_col..=end_col {
                let has = self
                    .stores
                    .grid_indexes
                    .get(sheet_id)
                    .map(|grid| {
                        hyperlinks::get_hyperlink(
                            self.stores.storage.doc(),
                            self.stores.storage.sheets(),
                            sheet_id,
                            grid,
                            row,
                            col,
                        )
                        .is_some()
                    })
                    .unwrap_or(false);
                if has {
                    services::objects::remove_hyperlink(
                        &mut self.stores,
                        &mut self.mirror,
                        sheet_id,
                        row,
                        col,
                    )?;
                }
            }
        }
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        ))
    }

    // -------------------------------------------------------------------
    // Pivot Tables
    // -------------------------------------------------------------------

    /// Create a new pivot table in the given sheet.
    ///
    /// Accepts raw JSON and validates ALL required fields upfront before
    /// deserialization, so that callers get a single comprehensive error
    /// listing every missing/wrong field — not one-at-a-time serde failures.
    ///
    /// Returns `MutationResult` with `PivotTableConfig` in `data`.
    #[bridge::write(scope = "workbook")]
    pub fn pivot_create(
        &mut self,
        config: serde_json::Value,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Validate all fields upfront — one comprehensive error, not one-at-a-time
        validate_pivot_config_json(&config)
            .map_err(|msg| ComputeError::InvalidInput { message: msg })?;
        let config: PivotTableConfig =
            serde_json::from_value(config).map_err(|e| ComputeError::Deserialize {
                message: e.to_string(),
            })?;
        let config = self.resolve_pivot_source_identity(config)?;
        let sheet_id = self
            .mirror
            .sheet_by_name(&config.output_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.output_sheet_name.clone(),
            })?;
        let result = services::objects::pivot_create(&mut self.stores, &sheet_id, config)?;
        // Pivot CRUD doesn't touch cells but `recalculate_with_options` uses
        // `materialize_all_pivots` to render output — must not short-circuit.
        self.stores.compute.mark_dirty();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Atomically create a new sheet AND a pivot table on it.
    ///
    /// Both the sheet creation and pivot creation happen within a single
    /// `#[bridge::write(scope = "workbook")]` scope, so undo reverts both operations together.
    /// Returns the new sheet's ID (hex) and the stored pivot config.
    ///
    /// Accepts raw JSON with comprehensive upfront validation.
    #[bridge::skip(ts_bridge)]
    #[bridge::write(scope = "workbook")]
    pub fn pivot_create_with_sheet(
        &mut self,
        sheet_name: &str,
        config: serde_json::Value,
    ) -> Result<(String, PivotTableConfig, MutationResult), ComputeError> {
        // Validate all fields upfront — one comprehensive error, not one-at-a-time
        validate_pivot_config_json(&config)
            .map_err(|msg| ComputeError::InvalidInput { message: msg })?;
        let mut config: PivotTableConfig =
            serde_json::from_value(config).map_err(|e| ComputeError::Deserialize {
                message: e.to_string(),
            })?;
        config = self.resolve_pivot_source_identity(config)?;
        let (sheet_hex, mut sheet_result) = self.mutation_create_sheet(sheet_name)?;
        let sheet_id = SheetId::from_uuid_str(&sheet_hex).map_err(|e| ComputeError::Eval {
            message: format!("Invalid SheetId after creation: {e}"),
        })?;
        // Default output_sheet_name to the newly created sheet when empty
        if config.output_sheet_name.is_empty() {
            config.output_sheet_name = sheet_name.to_string();
        }
        let pivot =
            services::objects::pivot_create_with_sheet_inner(&mut self.stores, &sheet_id, config)?;
        sheet_result.pivot_changes.push(PivotTableChange {
            sheet_id: sheet_id.to_uuid_string(),
            pivot_id: pivot.id.clone(),
            kind: ChangeKind::Set,
        });
        Ok((sheet_hex, pivot, sheet_result))
    }

    /// Replace a pivot table config.
    ///
    /// Returns `MutationResult` with `PivotTableConfig | null` in `data`.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_update(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        config: PivotTableConfig,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let config = self.resolve_pivot_source_identity(config)?;
        let result = services::objects::pivot_update(&mut self.stores, sheet_id, pivot_id, config)?;
        // Pivot config changes layout/aggregation — next calculate must
        // re-materialize, so don't let the idempotent short-circuit skip it.
        self.stores.compute.mark_dirty();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Delete a pivot table by ID. Returns `MutationResult` with `bool` in `data`.
    /// Clears materialized cells before deleting.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_delete(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        // Clear materialized cells before deleting
        if let Some(config) = services::objects::pivot_get(&self.stores, sheet_id, pivot_id)
            && let Some(output_sheet_id) = self.mirror.sheet_by_name(&config.output_sheet_name)
        {
            let output_sheet_uuid = output_sheet_id.to_uuid_string();
            let old_def = self
                .mirror
                .find_pivot_table_def(pivot_id, &config.name, &output_sheet_uuid)
                .cloned();
            if let Some(def) = old_def {
                let old_rows = def.rendered_row_count();
                let old_cols = def.rendered_col_count();
                if old_rows > 0 && old_cols > 0 {
                    self.mirror.clear_pivot_region(
                        &output_sheet_id,
                        def.start_row,
                        def.start_col,
                        old_rows,
                        old_cols,
                    );
                }
            }
        }
        let result = services::objects::pivot_delete(&mut self.stores, sheet_id, pivot_id)?;
        // Removed pivot must not be re-materialized on next calculate —
        // but cells we just cleared need the flush; mark dirty either way.
        self.stores.compute.mark_dirty();
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }

    /// Get a single pivot table by ID.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get(&self, sheet_id: &SheetId, pivot_id: &str) -> Option<PivotTableConfig> {
        services::objects::pivot_get(&self.stores, sheet_id, pivot_id)
            .map(|config| self.derive_pivot_source_name(config))
    }

    /// Get all pivot tables in a sheet.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get_all(&self, sheet_id: &SheetId) -> Vec<PivotTableConfig> {
        services::objects::pivot_get_all(&self.stores, sheet_id)
            .into_iter()
            .map(|config| self.derive_pivot_source_name(config))
            .collect()
    }

    /// Compute a pivot table from its stored config, reading source data directly
    /// from the engine. This avoids the TS→Rust→TS data round-trip that the
    /// stateless `pivot_compute` free function requires.
    ///
    /// Auto-detects fields from source data if the config has placements but no
    /// field metadata (common when fields are added via the TS `addField()` API).
    #[bridge::read(scope = "sheet")]
    pub fn pivot_compute_from_source(
        &self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, ComputeError> {
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        let range = &config.source_range;
        let total_cells = (range.end_row() as u64 - range.start_row() as u64 + 1)
            * (range.end_col() as u64 - range.start_col() as u64 + 1);
        if total_cells > 10_000_000 {
            return Err(ComputeError::Eval {
                message: "Pivot source range exceeds 10M cells".to_string(),
            });
        }

        // Read source data from the engine's cell mirror
        let source_sid = self.pivot_source_sheet_id(&config)?;
        let mut data = Vec::with_capacity((range.end_row() - range.start_row() + 1) as usize);
        for row in range.start_row()..=range.end_row() {
            let mut row_values =
                Vec::with_capacity((range.end_col() - range.start_col() + 1) as usize);
            for col in range.start_col()..=range.end_col() {
                let value = crate::storage::cells::values::get_effective_value(
                    &self.mirror,
                    &source_sid,
                    row,
                    col,
                )
                .unwrap_or_default();
                row_values.push(value);
            }
            data.push(row_values);
        }

        if data.is_empty() {
            return Err(ComputeError::Eval {
                message: "Pivot source range is empty".to_string(),
            });
        }

        // Auto-detect fields if missing. When fields are added via the TS
        // addField() API, placements use the field name as the fieldId (e.g.,
        // "Region") but detect_fields generates IDs like "field_0". We set
        // detected field IDs to match the names used by placements.
        let mut config = config;
        if config.fields.is_empty() && !config.placements.is_empty() {
            let mut detected = compute_pivot::detect_fields(&data);
            // Set each detected field's ID to its name, matching how
            // the TS addField() API uses field names as placement fieldIds.
            for field in &mut detected {
                field.id = compute_pivot::FieldId::new(field.name.clone());
            }
            config.fields = detected;
        }

        let engine_config =
            compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| ComputeError::Eval {
                message: format!("Pivot config conversion error: {e}"),
            })?;
        let resolved = compute_pivot::validate_and_resolve(&engine_config).map_err(|e| {
            ComputeError::Eval {
                message: format!("Pivot validation error: {e}"),
            }
        })?;

        Ok(compute_pivot::compute_with_show_values_as_resolved(
            &resolved,
            &data,
            expansion_state.as_ref(),
        ))
    }

    /// Get pivot items for all placed fields.
    ///
    /// Computes the pivot result from stored config and source data, then extracts
    /// discrete `PivotItemInfo` objects for each non-value field. This avoids the
    /// TS layer needing to walk raw row/column headers itself.
    #[bridge::read(scope = "sheet")]
    pub fn pivot_get_all_items(
        &self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<Vec<PivotFieldItems>, ComputeError> {
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        // Guard against excessive source ranges (same as pivot_compute_from_source)
        let range = &config.source_range;
        let total_cells = (range.end_row() as u64 - range.start_row() as u64 + 1)
            * (range.end_col() as u64 - range.start_col() as u64 + 1);
        if total_cells > 10_000_000 {
            return Err(ComputeError::Eval {
                message: "Pivot source range exceeds 10M cells".to_string(),
            });
        }

        // Read source data from the engine's cell mirror (same pattern as pivot_compute_from_source)
        let source_sid = self.pivot_source_sheet_id(&config)?;
        let mut data = Vec::with_capacity((range.end_row() - range.start_row() + 1) as usize);
        for row in range.start_row()..=range.end_row() {
            let mut row_values =
                Vec::with_capacity((range.end_col() - range.start_col() + 1) as usize);
            for col in range.start_col()..=range.end_col() {
                let value = crate::storage::cells::values::get_effective_value(
                    &self.mirror,
                    &source_sid,
                    row,
                    col,
                )
                .unwrap_or_default();
                row_values.push(value);
            }
            data.push(row_values);
        }

        if data.is_empty() {
            return Err(ComputeError::Eval {
                message: "Pivot source range is empty".to_string(),
            });
        }

        // Auto-detect fields if missing (same as pivot_compute_from_source)
        let mut config = config;
        if config.fields.is_empty() && !config.placements.is_empty() {
            let mut detected = compute_pivot::detect_fields(&data);
            for field in &mut detected {
                field.id = compute_pivot::FieldId::new(field.name.clone());
            }
            config.fields = detected;
        }

        // Compute the result
        let engine_config =
            compute_pivot::PivotEngineConfig::try_from(config).map_err(|e| ComputeError::Eval {
                message: format!("Pivot config conversion error: {e}"),
            })?;
        let resolved = compute_pivot::validate_and_resolve(&engine_config).map_err(|e| {
            ComputeError::Eval {
                message: format!("Pivot validation error: {e}"),
            }
        })?;
        let result = compute_pivot::compute_with_show_values_as_resolved(
            &resolved,
            &data,
            expansion_state.as_ref(),
        );

        // Extract items
        Ok(compute_pivot::get_all_field_items(
            &result,
            &engine_config,
            Some(&data),
        ))
    }

    /// Register a rendered pivot table definition for GETPIVOTDATA formula evaluation.
    ///
    /// Called by the TS layer after computing a pivot table to register its rendered
    /// bounds in the CellMirror. GETPIVOTDATA reads from these definitions to locate
    /// values in rendered pivot cells.
    ///
    /// The `bounds` parameter provides the rendered extent from the pivot compute result.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_register_def(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        total_rows: u32,
        total_cols: u32,
        first_data_row: u32,
        first_data_col: u32,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::pivot_register_def(
            &self.stores,
            &mut self.mirror,
            sheet_id,
            pivot_id,
            total_rows,
            total_cols,
            first_data_row,
            first_data_col,
        )
        .map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Remove a pivot table definition from the GETPIVOTDATA registry.
    ///
    /// Called when a pivot table is deleted to ensure stale definitions don't
    /// linger in the CellMirror.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_unregister_def(
        &mut self,
        sheet_id: &SheetId,
        pivot_name: &str,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        services::objects::pivot_unregister_def(&mut self.mirror, sheet_id, pivot_name).map(|r| {
            (
                compute_wire::mutation::serialize_multi_viewport_patches(&[]),
                r,
            )
        })
    }

    /// Compute and materialize a pivot table to sheet cells.
    ///
    /// This reads source data, computes the pivot, writes result cells into the
    /// output sheet's col_data, and registers the rendered bounds for GETPIVOTDATA.
    #[bridge::write(scope = "sheet")]
    pub fn pivot_materialize(
        &mut self,
        sheet_id: &SheetId,
        pivot_id: &str,
        expansion_state: Option<PivotExpansionState>,
    ) -> Result<PivotTableResult, ComputeError> {
        // 1. Look up config
        let config =
            services::objects::pivot_get(&self.stores, sheet_id, pivot_id).ok_or_else(|| {
                ComputeError::Eval {
                    message: format!("Pivot table '{pivot_id}' not found"),
                }
            })?;

        // 2. Resolve output sheet
        let output_sheet_id = self
            .mirror
            .sheet_by_name(&config.output_sheet_name)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: config.output_sheet_name.clone(),
            })?;

        // 3. Clear old cells if previously materialized
        {
            let output_sheet_uuid = output_sheet_id.to_uuid_string();
            let old_def = self
                .mirror
                .find_pivot_table_def(pivot_id, &config.name, &output_sheet_uuid)
                .cloned();
            if let Some(def) = old_def {
                let old_rows = def.rendered_row_count();
                let old_cols = def.rendered_col_count();
                if old_rows > 0 && old_cols > 0 {
                    self.mirror.clear_pivot_region(
                        &output_sheet_id,
                        def.start_row,
                        def.start_col,
                        old_rows,
                        old_cols,
                    );
                }
            }
        }

        // 4. Compute pivot result
        let result = self.pivot_compute_from_source(sheet_id, pivot_id, expansion_state)?;
        let engine_config =
            compute_pivot::PivotEngineConfig::try_from(config.clone()).map_err(|e| {
                ComputeError::Eval {
                    message: format!("Pivot config conversion error: {e}"),
                }
            })?;

        // 5. Write cells
        // Collect row field display names for the header row.
        let row_field_names: Vec<String> = engine_config
            .row_placements()
            .iter()
            .map(|p| {
                p.display_name()
                    .map(String::from)
                    .or_else(|| {
                        engine_config
                            .fields
                            .iter()
                            .find(|f| f.id == *p.field_id())
                            .map(|f| f.name.clone())
                    })
                    .unwrap_or_else(|| p.field_id().to_string())
            })
            .collect();
        self.mirror.materialize_pivot(
            &output_sheet_id,
            config.output_location.row,
            config.output_location.col,
            &result,
            &row_field_names,
        );

        // 6. Register bounds for GETPIVOTDATA
        let bounds = &result.rendered_bounds;
        let def = engine_config.to_pivot_table_def(bounds, &output_sheet_id);
        self.mirror.upsert_pivot_table_def(def);

        Ok(result)
    }
}
