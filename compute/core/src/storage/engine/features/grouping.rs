use super::super::YrsComputeEngine;
use super::super::mutation::{EngineMutation, MutationOutput};
use super::super::services::features as svc;
use crate::snapshot::{Axis, ChangeKind, GroupingChange, MutationResult};
use crate::storage::sheet::grouping;
use cell_types::{SheetId, SheetPos};
use value_types::ComputeError;

// ---------------------------------------------------------------------------
// SubtotalsCellAccessor adapter
// ---------------------------------------------------------------------------

/// Adapter that implements [`grouping::SubtotalsCellAccessor`] by delegating to
/// the engine's storage and structural helpers.
///
/// We cannot implement the trait directly on `YrsComputeEngine` because
/// `create_subtotals`/`remove_subtotals` need `&mut dyn SubtotalsCellAccessor`
/// while also borrowing `doc` and `sheets` immutably.  A thin wrapper that
/// captures the necessary references avoids the borrow-conflict.
struct EngineSubtotalAccessor<'a> {
    engine: &'a mut YrsComputeEngine,
}

impl<'a> grouping::SubtotalsCellAccessor for EngineSubtotalAccessor<'a> {
    fn get_cell_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        self.engine
            .mirror
            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
            .map(|v| format!("{}", v))
            .unwrap_or_default()
    }

    fn set_cell_value(&mut self, sheet_id: &SheetId, row: u32, col: u32, value: &str) {
        if let Some(grid) = self.engine.stores.grid_indexes.get_mut(sheet_id) {
            let cell_id = grid.ensure_cell_id(row, col);
            let _ = self
                .engine
                .set_cell(sheet_id, cell_id, row, col, value.into());
        }
    }

    fn insert_rows(&mut self, sheet_id: &SheetId, start_row: u32, count: u32) {
        use formula_types::StructureChange;
        let change = StructureChange::InsertRows {
            at: start_row,
            count,
            new_row_ids: Vec::new(),
        };
        let _ = self.engine.structure_change(sheet_id, &change);
    }

    fn delete_rows(&mut self, sheet_id: &SheetId, start_row: u32, count: u32) {
        use formula_types::StructureChange;
        let change = StructureChange::DeleteRows {
            at: start_row,
            count,
            deleted_cell_ids: Vec::new(),
        };
        let _ = self.engine.structure_change(sheet_id, &change);
    }

    fn get_cell_raw_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        // Try to get formula first (raw value for SUBTOTAL detection)
        if let Some(grid) = self.engine.grid_index(sheet_id)
            && let Some(cell_id) = grid.cell_id_at(row, col)
            && let Some(f) = self.engine.compute().get_formula(&cell_id)
        {
            return f.to_string();
        }
        // Fall back to computed value
        self.engine
            .mirror
            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
            .map(|v| format!("{}", v))
            .unwrap_or_default()
    }
}

pub(super) fn group_rows(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::group_rows(&mut engine.stores, sheet_id, start_row, end_row).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn ungroup_rows(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::ungroup_rows(&mut engine.stores, sheet_id, start_row, end_row)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn group_columns(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    svc::group_columns(&mut engine.stores, sheet_id, start_col, end_col).map(|r| {
        (
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            r,
        )
    })
}

pub(super) fn ungroup_columns(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::ungroup_columns(&mut engine.stores, sheet_id, start_col, end_col)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn set_group_collapsed(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
    collapsed: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::set_group_collapsed(&mut engine.stores, sheet_id, group_id, collapsed)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn toggle_group_collapsed(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::toggle_group_collapsed(&mut engine.stores, sheet_id, group_id)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn expand_all_groups(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::expand_all_groups(&mut engine.stores, sheet_id)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn collapse_all_groups(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::collapse_all_groups(&mut engine.stores, sheet_id)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn get_sheet_grouping_config(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> grouping::SheetGroupingConfig {
    svc::get_sheet_grouping_config(&engine.stores, sheet_id)
}

pub(super) fn get_groups(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    axis: &str,
) -> Vec<grouping::GroupDefinition> {
    svc::get_groups(&engine.stores, sheet_id, axis)
}

pub(super) fn create_subtotals(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: grouping::SubtotalOptions,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    match engine.apply_mutation(EngineMutation::CreateSubtotals {
        sheet_id: *sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        options,
    })? {
        MutationOutput::Recalc(result) => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        )),
        _ => Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            MutationResult::empty(),
        )),
    }
}

pub(super) fn remove_subtotals(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);
    let doc = engine.stores.storage.doc().clone();
    let sheets_map = doc.get_or_insert_map("sheets");
    let mut accessor = EngineSubtotalAccessor { engine: engine };
    grouping::remove_subtotals(&doc, &sheets_map, &mut accessor, sheet_id, &range);
    Ok((
        compute_wire::mutation::serialize_multi_viewport_patches(&[]),
        MutationResult::empty(),
    ))
}

pub(super) fn auto_outline(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);
    let doc = engine.stores.storage.doc().clone();
    let sheets_map = doc.get_or_insert_map("sheets");
    let accessor = EngineSubtotalAccessor { engine: engine };
    let count = grouping::auto_outline(&doc, &sheets_map, &accessor, sheet_id, &range);
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    Ok((
        compute_wire::mutation::serialize_multi_viewport_patches(&[]),
        result.with_data(&count)?,
    ))
}

pub(super) fn get_subtotal_config(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> grouping::SheetGroupingConfig {
    svc::get_sheet_grouping_config(&engine.stores, sheet_id)
}

pub(super) fn get_group_in_sheet(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<grouping::GroupDefinition> {
    svc::get_group_in_sheet(&engine.stores, sheet_id, group_id)
}

pub(super) fn get_row_outline_levels(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<grouping::OutlineLevel> {
    svc::get_row_outline_levels(&engine.stores, sheet_id, start_row, end_row)
}

pub(super) fn get_column_outline_levels(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<grouping::OutlineLevel> {
    svc::get_column_outline_levels(&engine.stores, sheet_id, start_col, end_col)
}

pub(super) fn get_max_outline_level(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    axis: &str,
) -> u32 {
    svc::get_max_outline_level(&engine.stores, sheet_id, axis)
}

pub(super) fn get_outline_gutter_dimensions(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    level_width: u32,
    level_height: u32,
) -> Result<serde_json::Value, ComputeError> {
    svc::get_outline_gutter_dimensions(&engine.stores, sheet_id, level_width, level_height)
}

pub(super) fn get_outline_level_buttons(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
) -> Vec<grouping::OutlineLevelButton> {
    svc::get_outline_level_buttons(&engine.stores, sheet_id)
}

pub(super) fn get_outline_render_data(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    viewport: grouping::Viewport,
) -> grouping::OutlineRenderData {
    svc::get_outline_render_data(&engine.stores, sheet_id, &viewport)
}

pub(super) fn get_outline_symbols(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    viewport: grouping::Viewport,
) -> Vec<grouping::OutlineSymbol> {
    svc::get_outline_symbols(&engine.stores, sheet_id, &viewport)
}

pub(super) fn should_render_outlines(engine: &YrsComputeEngine, sheet_id: &SheetId) -> bool {
    svc::should_render_outlines(&engine.stores, sheet_id)
}

pub(super) fn get_affected_rows_by_group(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    svc::get_affected_rows_by_group(&engine.stores, sheet_id, group_id)
}

pub(super) fn get_affected_columns_by_group(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    svc::get_affected_columns_by_group(&engine.stores, sheet_id, group_id)
}

pub(super) fn is_row_visible_by_groups(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    svc::is_row_visible_by_groups(&engine.stores, sheet_id, row)
}

pub(super) fn is_column_visible_by_groups(
    engine: &YrsComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    svc::is_column_visible_by_groups(&engine.stores, sheet_id, col)
}

pub(super) fn set_level_collapsed(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    axis: &str,
    level: u32,
    collapsed: bool,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::set_level_collapsed(&mut engine.stores, sheet_id, axis, level, collapsed)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn set_outline_settings(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    settings: grouping::OutlineSettingsUpdate,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::set_outline_settings(&mut engine.stores, sheet_id, &settings)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn clear_row_grouping(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::clear_row_grouping(&mut engine.stores, sheet_id, start_row, end_row)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn clear_column_grouping(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::clear_column_grouping(&mut engine.stores, sheet_id, start_col, end_col)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}

pub(super) fn clear_all_grouping(
    engine: &mut YrsComputeEngine,
    sheet_id: &SheetId,
) -> Result<(Vec<u8>, MutationResult), ComputeError> {
    let result = svc::clear_all_grouping(&mut engine.stores, sheet_id)?;
    let patches = engine.produce_full_viewport_patches(sheet_id);
    Ok((patches, result))
}
