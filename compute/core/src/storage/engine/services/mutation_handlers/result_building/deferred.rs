use cell_types::SheetId;

use super::sheet_hydration::parse_saved_view_selection;
use crate::mirror::CellMirror;
use crate::snapshot::{
    ChangeKind, FilterChange, FloatingObjectChange, FloatingObjectChangeKind, MergeChange,
    MutationResult, NamedRangeChange, RecalcResult, ScrollPositionChange, SheetChange,
    SheetChangeField, SheetSettingsChange, ViewSelectionChange, WorkbookSettings,
    WorkbookSettingsChange,
};
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::filters;
use domain_types::units::{
    CharWidth, Points, char_width_to_pixels, platform_mdw, points_to_pixels,
};

fn workbook_settings_for_deferred(
    data: &crate::storage::engine::construction::DeferredHydrationData,
) -> WorkbookSettings {
    let mut settings = WorkbookSettings::default();
    settings.selected_sheet_ids = selected_sheet_ids_for_deferred(data);
    settings
}

fn selected_sheet_ids_for_deferred(
    data: &crate::storage::engine::construction::DeferredHydrationData,
) -> Option<Vec<String>> {
    if let Some(active_sheet_id) = data
        .parse_output
        .workbook_views
        .first()
        .and_then(|view| data.workbook_snap.sheets.get(view.active_tab as usize))
        .map(|sheet| sheet.id.clone())
    {
        return Some(vec![active_sheet_id]);
    }

    let selected_sheet_ids = data
        .parse_output
        .sheets
        .iter()
        .enumerate()
        .filter(|(_, sheet)| sheet.view.tab_selected)
        .filter_map(|(index, _)| data.workbook_snap.sheets.get(index))
        .map(|sheet| sheet.id.clone())
        .collect::<Vec<_>>();

    (!selected_sheet_ids.is_empty()).then_some(selected_sheet_ids)
}

/// Build a minimal [`MutationResult`] for deferred-hydration mode.
///
/// In deferred mode, Yrs is empty. We read sheet metadata from the stored
/// `DeferredHydrationData` (which holds the `ParseOutput` and `WorkbookSnapshot`)
/// to populate sheet changes, settings, and dimension data. This is enough for
/// the UI to show sheet tabs, apply dimensions, and render the viewport.
pub(in crate::storage::engine) fn build_mutation_result_for_deferred(
    stores: &EngineStores,
    _mirror: &CellMirror,
    deferred: Option<&crate::storage::engine::construction::DeferredHydrationData>,
) -> MutationResult {
    let mut result = MutationResult::from_recalc(RecalcResult::empty());

    let data = match deferred {
        Some(d) => d,
        None => {
            tracing::info!("[PERF] build_mutation_result_for_deferred: no deferred data");
            return result;
        }
    };
    tracing::info!(
        sheet_count = data.workbook_snap.sheets.len(),
        "[PERF] build_mutation_result_for_deferred: building"
    );

    // Emit SheetChange + settings for each sheet from parse output data.
    // In deferred mode Yrs is empty, so all metadata comes from ParseOutput.
    for (i, sheet_snap) in data.workbook_snap.sheets.iter().enumerate() {
        let sheet_data = &data.parse_output.sheets[i];
        let is_hidden = sheet_data.visibility != ooxml_types::workbook::SheetState::Visible;

        // Creation event (populates sheetOrder in kernel mirror)
        result.sheet_changes.push(SheetChange {
            sheet_id: sheet_snap.id.clone(),
            field: SheetChangeField::Sheet,
            kind: ChangeKind::Set,
            name: Some(sheet_data.name.clone()),
            old_name: None,
            index: Some(i as i32),
            old_index: None,
            hidden: None,
            source_sheet_id: None,
            frozen_rows: None,
            old_frozen_rows: None,
            frozen_cols: None,
            old_frozen_cols: None,
            color: None,
            old_color: None,
        });

        // Visibility event (for hidden sheets)
        if is_hidden {
            result.sheet_changes.push(SheetChange {
                sheet_id: sheet_snap.id.clone(),
                field: SheetChangeField::Visibility,
                kind: ChangeKind::Set,
                name: None,
                old_name: None,
                index: None,
                old_index: None,
                hidden: Some(true),
                source_sheet_id: None,
                frozen_rows: None,
                old_frozen_rows: None,
                frozen_cols: None,
                old_frozen_cols: None,
                color: None,
                old_color: None,
            });
        }

        // Frozen panes
        if let Some(ref fp) = sheet_data.frozen_pane
            && (fp.rows > 0 || fp.cols > 0)
        {
            result.sheet_changes.push(SheetChange {
                sheet_id: sheet_snap.id.clone(),
                field: SheetChangeField::Frozen,
                kind: ChangeKind::Set,
                name: None,
                old_name: None,
                index: None,
                old_index: None,
                hidden: None,
                source_sheet_id: None,
                frozen_rows: Some(fp.rows),
                old_frozen_rows: None,
                frozen_cols: Some(fp.cols),
                old_frozen_cols: None,
                color: None,
                old_color: None,
            });
        }

        // Merge changes from parse_output
        for m in &sheet_data.merges {
            result.merge_changes.push(MergeChange {
                sheet_id: sheet_snap.id.clone(),
                kind: ChangeKind::Set,
                start_row: m.start_row,
                start_col: m.start_col,
                end_row: m.end_row,
                end_col: m.end_col,
            });
        }

        // Floating objects are hydrated into the critical Yrs document even in
        // deferred mode. Emit the same Created patches as the full hydration
        // path so TS-side object projections are populated before first paint.
        if let Ok(sid) = SheetId::from_uuid_str(&sheet_snap.id) {
            let doc = stores.storage.doc();
            let sheets = stores.storage.sheets();
            let grid = stores.grid_indexes.get(&sid);
            let layout = stores.layout_indexes.get(&sid);
            let all_objects_json =
                crate::storage::sheet::floating_objects::get_all_floating_objects(
                    doc, sheets, &sid,
                );
            let mut bounds_map = std::collections::HashMap::with_capacity(all_objects_json.len());
            for (object_id, obj_json) in &all_objects_json {
                if let Some(bounds) =
                    crate::storage::sheet::floating_objects::compute_object_pixel_bounds(
                        grid, layout, obj_json,
                    )
                {
                    bounds_map.insert(object_id.clone(), bounds);
                }
            }

            for obj in crate::storage::sheet::floating_objects::get_all_floating_objects_typed(
                doc, sheets, &sid,
            ) {
                let object_id = obj.common.id.clone();
                let object_type = Some(obj.kind());
                let bounds = bounds_map.get(&object_id).cloned();
                result.floating_object_changes.push(FloatingObjectChange {
                    sheet_id: sheet_snap.id.clone(),
                    object_id,
                    kind: FloatingObjectChangeKind::Created,
                    object_type,
                    data: Some(obj),
                    bounds,
                });
            }

            // Filters are hydrated and normalized for the materialized critical
            // sheet before the deferred import result is built. Surface those
            // runtime FilterStates with the same "created" shape as normal
            // sheet hydration; metadata-only sheets do not have grid indexes
            // or runtime filter state yet.
            if grid.is_some() {
                for filter in filters::get_filters_in_sheet(doc, sheets, &sid) {
                    result.filter_changes.push(FilterChange {
                        sheet_id: sheet_snap.id.clone(),
                        filter_id: filter.id,
                        filter_kind: Some(
                            match &filter.filter_kind {
                                filters::FilterKind::AutoFilter => "autoFilter",
                                filters::FilterKind::TableFilter => "tableFilter",
                                filters::FilterKind::AdvancedFilter => "advancedFilter",
                            }
                            .to_string(),
                        ),
                        table_id: filter.table_id,
                        capability: None,
                        unsupported_reasons: Vec::new(),
                        has_active_filter: Some(!filter.column_filters.is_empty()),
                        clearable: Some(filter.filter_kind != filters::FilterKind::AdvancedFilter),
                        diagnostics: Vec::new(),
                        action: Some("created".to_string()),
                        hidden_row_count: None,
                        visible_row_count: None,
                        kind: ChangeKind::Set,
                    });
                }
            }
        }

        // Sheet settings with real data from parse output view
        let default_row_height = sheet_data
            .dimensions
            .default_row_height
            .map(|height| points_to_pixels(Points(height)).0)
            .unwrap_or(20.0);
        let default_col_width = sheet_data
            .dimensions
            .default_col_width
            .map(|width| char_width_to_pixels(CharWidth(width), platform_mdw()).0)
            .unwrap_or(64.0);
        let sheet_settings = domain_types::domain::sheet::SheetSettings {
            show_gridlines: sheet_data.view.show_gridlines,
            show_row_headers: sheet_data.view.show_row_col_headers,
            show_column_headers: sheet_data.view.show_row_col_headers,
            is_protected: sheet_data.protection.is_some(),
            protection_password_hash: None,
            show_zero_values: sheet_data.view.show_zeros,
            gridline_color: None,
            right_to_left: sheet_data.view.right_to_left,
            show_formulas: sheet_data.view.show_formulas,
            zoom_scale: sheet_data.view.zoom_scale,
            protection_options: None,
            default_row_height,
            default_col_width,
            custom_properties: None,
        };
        let settings_value =
            serde_json::to_value(&sheet_settings).expect("SheetSettings must serialize to JSON");
        result.settings_changes.push(SheetSettingsChange {
            sheet_id: sheet_snap.id.clone(),
            kind: ChangeKind::Set,
            changed_key: "*hydration*".to_string(),
            settings: settings_value,
        });

        if let Some((active_cell, ranges)) = parse_saved_view_selection(
            sheet_data.view.active_cell.as_deref(),
            sheet_data.view.sqref.as_deref(),
        ) {
            result.view_selection_changes.push(ViewSelectionChange {
                sheet_id: sheet_snap.id.clone(),
                active_cell,
                ranges,
            });
        }

        result.scroll_position_changes.push(ScrollPositionChange {
            sheet_id: sheet_snap.id.clone(),
            top_row: sheet_data.view.scroll_row,
            left_col: sheet_data.view.scroll_col,
        });
    }

    // Emit workbook settings. Deferred hydration has no populated Yrs
    // workbook settings map yet, so project workbook-level parse metadata that
    // the first-paint UI contract needs onto the canonical defaults.
    let workbook_settings_value = serde_json::to_value(workbook_settings_for_deferred(data))
        .expect("WorkbookSettings defaults must serialize to JSON");
    let changed_keys = match &workbook_settings_value {
        serde_json::Value::Object(map) => map.keys().cloned().collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    result
        .workbook_settings_changes
        .push(WorkbookSettingsChange {
            kind: ChangeKind::Set,
            changed_keys,
            settings: workbook_settings_value,
        });

    // Emit named ranges
    for nr in &data.parse_output.named_ranges {
        if !nr.hidden {
            result.named_range_changes.push(NamedRangeChange {
                name: nr.name.clone(),
                kind: ChangeKind::Set,
            });
        }
    }

    result
}
