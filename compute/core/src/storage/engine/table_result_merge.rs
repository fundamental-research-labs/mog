use crate::snapshot::MutationResult;

pub(in crate::storage::engine) fn merge_mutation_result(
    target: &mut MutationResult,
    mut source: MutationResult,
) {
    target
        .recalc
        .changed_cells
        .append(&mut source.recalc.changed_cells);
    target
        .recalc
        .projection_changes
        .append(&mut source.recalc.projection_changes);
    target.recalc.errors.append(&mut source.recalc.errors);
    target
        .recalc
        .validation_annotations
        .append(&mut source.recalc.validation_annotations);
    target
        .recalc
        .old_values
        .extend(source.recalc.old_values.drain());

    target
        .authored_cell_changes
        .append(&mut source.authored_cell_changes);
    target.property_changes.append(&mut source.property_changes);
    target
        .dimension_changes
        .append(&mut source.dimension_changes);
    target.merge_changes.append(&mut source.merge_changes);
    target
        .visibility_changes
        .append(&mut source.visibility_changes);
    target.comment_changes.append(&mut source.comment_changes);
    target.filter_changes.append(&mut source.filter_changes);
    target.table_changes.append(&mut source.table_changes);
    target.sheet_changes.append(&mut source.sheet_changes);
    target.settings_changes.append(&mut source.settings_changes);
    target
        .page_break_changes
        .append(&mut source.page_break_changes);
    target
        .print_area_changes
        .append(&mut source.print_area_changes);
    target
        .print_titles_changes
        .append(&mut source.print_titles_changes);
    target
        .print_settings_changes
        .append(&mut source.print_settings_changes);
    target
        .split_config_changes
        .append(&mut source.split_config_changes);
    target
        .scroll_position_changes
        .append(&mut source.scroll_position_changes);
    target
        .view_selection_changes
        .append(&mut source.view_selection_changes);
    target
        .workbook_settings_changes
        .append(&mut source.workbook_settings_changes);
    target.cf_changes.append(&mut source.cf_changes);
    target
        .named_range_changes
        .append(&mut source.named_range_changes);
    target.grouping_changes.append(&mut source.grouping_changes);
    target
        .sparkline_changes
        .append(&mut source.sparkline_changes);
    target.sorting_changes.append(&mut source.sorting_changes);
    target
        .structure_changes
        .append(&mut source.structure_changes);
    target
        .floating_object_changes
        .append(&mut source.floating_object_changes);
    target
        .floating_object_group_changes
        .append(&mut source.floating_object_group_changes);
    target.pivot_changes.append(&mut source.pivot_changes);
    target.range_changes.append(&mut source.range_changes);
    target.old_values.extend(source.old_values.drain());

    if target.sheet_lifecycle_runtime_hint.is_none() {
        target.sheet_lifecycle_runtime_hint = source.sheet_lifecycle_runtime_hint;
    }
    if target.undo_description.is_none() {
        target.undo_description = source.undo_description;
    }
    if target.data.is_none() {
        target.data = source.data;
    }
}
