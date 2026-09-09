use super::super::ComputeEngine;
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
/// We cannot implement the trait directly on `ComputeEngine` because
/// `create_subtotals`/`remove_subtotals` need `&mut dyn SubtotalsCellAccessor`
/// while also borrowing `doc` and `sheets` immutably.  A thin wrapper that
/// captures the necessary references avoids the borrow-conflict.
pub(in crate::storage::engine) struct EngineSubtotalAccessor<'a> {
    pub(in crate::storage::engine) engine: &'a mut ComputeEngine,
}

impl<'a> grouping::SubtotalsCellAccessor for EngineSubtotalAccessor<'a> {
    fn group_rows(
        &mut self,
        sheet_id: &SheetId,
        start: u32,
        end: u32,
    ) -> Result<grouping::GroupDefinition, String> {
        grouping::group_rows(&mut self.engine.stores.storage, sheet_id, start, end)
    }
    fn clear_row_grouping(&mut self, sheet_id: &SheetId, start: u32, end: u32) {
        grouping::clear_row_grouping(&mut self.engine.stores.storage, sheet_id, start, end);
    }
    fn get_row_groups(&self, sheet_id: &SheetId) -> Vec<grouping::GroupDefinition> {
        grouping::get_groups(
            &self.engine.stores.storage,
            sheet_id,
            grouping::GroupAxis::Row,
        )
    }

    fn get_cell_value(&self, sheet_id: &SheetId, row: u32, col: u32) -> String {
        self.engine
            .cell_store
            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
            .map(|v| format!("{}", v))
            .unwrap_or_default()
    }

    fn set_cell_value(&mut self, sheet_id: &SheetId, row: u32, col: u32, value: &str) {
        let _ = self.engine.set_cell_value_parsed(sheet_id, row, col, value);
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
        if let Some(cell_id) = self
            .engine
            .cell_store
            .resolve_cell_id(sheet_id, SheetPos::new(row, col))
            && let Some(f) = self.engine.compute().get_formula(&cell_id)
        {
            return f.to_string();
        }
        // Fall back to computed value
        self.engine
            .cell_store
            .get_cell_value_at(sheet_id, SheetPos::new(row, col))
            .map(|v| format!("{}", v))
            .unwrap_or_default()
    }
}

pub(super) fn group_rows(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<MutationResult, ComputeError> {
    svc::group_rows(&mut engine.stores, sheet_id, start_row, end_row)
}

pub(super) fn ungroup_rows(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<MutationResult, ComputeError> {
    let result = svc::ungroup_rows(&mut engine.stores, sheet_id, start_row, end_row)?;

    Ok(result)
}

pub(super) fn group_columns(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    svc::group_columns(&mut engine.stores, sheet_id, start_col, end_col)
}

pub(super) fn ungroup_columns(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let result = svc::ungroup_columns(&mut engine.stores, sheet_id, start_col, end_col)?;

    Ok(result)
}

pub(super) fn set_group_collapsed(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
    collapsed: bool,
) -> Result<MutationResult, ComputeError> {
    let result = svc::set_group_collapsed(&mut engine.stores, sheet_id, group_id, collapsed)?;

    Ok(result)
}

pub(super) fn toggle_group_collapsed(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Result<MutationResult, ComputeError> {
    let result = svc::toggle_group_collapsed(&mut engine.stores, sheet_id, group_id)?;

    Ok(result)
}

pub(super) fn expand_all_groups(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let result = svc::expand_all_groups(&mut engine.stores, sheet_id)?;

    Ok(result)
}

pub(super) fn collapse_all_groups(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let result = svc::collapse_all_groups(&mut engine.stores, sheet_id)?;

    Ok(result)
}

pub(super) fn get_sheet_grouping_config(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> grouping::SheetGroupingConfig {
    svc::get_sheet_grouping_config(&engine.stores, sheet_id)
}

pub(super) fn get_groups(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    axis: &str,
) -> Vec<grouping::GroupDefinition> {
    svc::get_groups(&engine.stores, sheet_id, axis)
}

pub(super) fn create_subtotals(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    options: grouping::SubtotalOptions,
) -> Result<MutationResult, ComputeError> {
    match engine.apply_mutation(EngineMutation::CreateSubtotals {
        sheet_id: *sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        options,
    })? {
        MutationOutput::Recalc(result) => Ok(result),
        _ => Ok(MutationResult::empty()),
    }
}

pub(super) fn remove_subtotals(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);

    let mut accessor = EngineSubtotalAccessor { engine };
    grouping::remove_subtotals(&mut accessor, sheet_id, &range);
    Ok(MutationResult::empty())
}

pub(super) fn auto_outline(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let range = grouping::CellRange::new(start_row, start_col, end_row, end_col);

    let mut accessor = EngineSubtotalAccessor { engine };
    let count = grouping::auto_outline(&mut accessor, sheet_id, &range);
    let mut result = MutationResult::empty();
    result.grouping_changes.push(GroupingChange {
        sheet_id: sheet_id.to_uuid_string(),
        axis: Axis::Row,
        kind: ChangeKind::Set,
    });
    Ok(result.with_data(&count)?)
}

pub(super) fn get_subtotal_config(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> grouping::SheetGroupingConfig {
    svc::get_sheet_grouping_config(&engine.stores, sheet_id)
}

pub(super) fn get_group_in_sheet(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Option<grouping::GroupDefinition> {
    svc::get_group_in_sheet(&engine.stores, sheet_id, group_id)
}

pub(super) fn get_row_outline_levels(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Vec<grouping::OutlineLevel> {
    svc::get_row_outline_levels(&engine.stores, sheet_id, start_row, end_row)
}

pub(super) fn get_column_outline_levels(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Vec<grouping::OutlineLevel> {
    svc::get_column_outline_levels(&engine.stores, sheet_id, start_col, end_col)
}

pub(super) fn get_max_outline_level(engine: &ComputeEngine, sheet_id: &SheetId, axis: &str) -> u32 {
    svc::get_max_outline_level(&engine.stores, sheet_id, axis)
}

pub(super) fn get_outline_gutter_dimensions(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    level_width: u32,
    level_height: u32,
) -> Result<serde_json::Value, ComputeError> {
    svc::get_outline_gutter_dimensions(&engine.stores, sheet_id, level_width, level_height)
}

pub(super) fn get_outline_level_buttons(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
) -> Vec<grouping::OutlineLevelButton> {
    svc::get_outline_level_buttons(&engine.stores, sheet_id)
}

pub(super) fn get_outline_render_data(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    viewport: grouping::Viewport,
) -> grouping::OutlineRenderData {
    svc::get_outline_render_data(&engine.stores, sheet_id, &viewport)
}

pub(super) fn get_outline_symbols(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    viewport: grouping::Viewport,
) -> Vec<grouping::OutlineSymbol> {
    svc::get_outline_symbols(&engine.stores, sheet_id, &viewport)
}

pub(super) fn should_render_outlines(engine: &ComputeEngine, sheet_id: &SheetId) -> bool {
    svc::should_render_outlines(&engine.stores, sheet_id)
}

pub(super) fn get_affected_rows_by_group(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    svc::get_affected_rows_by_group(&engine.stores, sheet_id, group_id)
}

pub(super) fn get_affected_columns_by_group(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    group_id: &str,
) -> Vec<u32> {
    svc::get_affected_columns_by_group(&engine.stores, sheet_id, group_id)
}

pub(super) fn is_row_visible_by_groups(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    row: u32,
) -> bool {
    svc::is_row_visible_by_groups(&engine.stores, sheet_id, row)
}

pub(super) fn is_column_visible_by_groups(
    engine: &ComputeEngine,
    sheet_id: &SheetId,
    col: u32,
) -> bool {
    svc::is_column_visible_by_groups(&engine.stores, sheet_id, col)
}

pub(super) fn set_level_collapsed(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    axis: &str,
    level: u32,
    collapsed: bool,
) -> Result<MutationResult, ComputeError> {
    let result = svc::set_level_collapsed(&mut engine.stores, sheet_id, axis, level, collapsed)?;

    Ok(result)
}

pub(super) fn set_outline_settings(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    settings: grouping::OutlineSettingsUpdate,
) -> Result<MutationResult, ComputeError> {
    let result = svc::set_outline_settings(&mut engine.stores, sheet_id, &settings)?;

    Ok(result)
}

pub(super) fn clear_row_grouping(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_row: u32,
    end_row: u32,
) -> Result<MutationResult, ComputeError> {
    let result = svc::clear_row_grouping(&mut engine.stores, sheet_id, start_row, end_row)?;

    Ok(result)
}

pub(super) fn clear_column_grouping(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
    start_col: u32,
    end_col: u32,
) -> Result<MutationResult, ComputeError> {
    let result = svc::clear_column_grouping(&mut engine.stores, sheet_id, start_col, end_col)?;

    Ok(result)
}

pub(super) fn clear_all_grouping(
    engine: &mut ComputeEngine,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    let result = svc::clear_all_grouping(&mut engine.stores, sheet_id)?;

    Ok(result)
}
