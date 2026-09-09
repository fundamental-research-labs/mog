use cell_types::SheetId;
use domain_types::{SheetData, domain::workbook::WorkbookView};

use crate::storage::engine::stores::EngineStores;

fn export_workbook_views(stores: &EngineStores) -> Vec<WorkbookView> {
    stores.storage.metadata.views.clone()
}

fn selected_sheet_indices_for_export(stores: &EngineStores, sheet_ids: &[SheetId]) -> Vec<usize> {
    let selected_sheet_ids =
        crate::storage::workbook::settings::get_settings(&stores.storage.metadata)
            .selected_sheet_ids
            .unwrap_or_default();

    selected_sheet_ids
        .iter()
        .filter_map(|selected_id| {
            sheet_ids
                .iter()
                .position(|sheet_id| sheet_id.to_uuid_string() == *selected_id)
        })
        .collect()
}

fn apply_selected_sheet_view_state(
    output_sheets: &mut [SheetData],
    workbook_views: &mut Vec<WorkbookView>,
    selected_sheet_indices: &[usize],
    inventory: &[domain_types::WorkbookSheetPackageInfo],
) {
    if selected_sheet_indices.is_empty() {
        return;
    }

    for (idx, sheet) in output_sheets.iter_mut().enumerate() {
        sheet.view.tab_selected = selected_sheet_indices.contains(&idx);
    }

    let active_tab = inventory
        .iter()
        .find(|entry| entry.editable_sheet_index == Some(selected_sheet_indices[0]))
        .map_or(selected_sheet_indices[0] as u32, |entry| {
            entry.workbook_order
        });
    if workbook_views.is_empty() {
        if active_tab != 0 {
            workbook_views.push(WorkbookView {
                active_tab,
                ..Default::default()
            });
        }
        return;
    }

    workbook_views[0].active_tab = active_tab;
}

pub(super) fn export_workbook_views_for_sheets(
    stores: &EngineStores,
    sheet_ids: &[SheetId],
    output_sheets: &mut [SheetData],
    inventory: &[domain_types::WorkbookSheetPackageInfo],
    imported_order_to_export_order: &std::collections::HashMap<u32, u32>,
) -> Vec<WorkbookView> {
    let mut workbook_views = export_workbook_views(stores);
    if !inventory.is_empty() {
        for view in &mut workbook_views {
            view.active_tab = imported_order_to_export_order
                .get(&view.active_tab)
                .copied()
                .unwrap_or_default();
            view.first_sheet = imported_order_to_export_order
                .get(&view.first_sheet)
                .copied()
                .unwrap_or_default();
        }
    }
    let selected_sheet_indices = selected_sheet_indices_for_export(stores, sheet_ids);
    apply_selected_sheet_view_state(
        output_sheets,
        &mut workbook_views,
        &selected_sheet_indices,
        inventory,
    );
    workbook_views
}
