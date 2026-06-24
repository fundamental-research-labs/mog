use cell_types::SheetId;
use compute_document::schema::KEY_WORKBOOK_SETTINGS;
use domain_types::{SheetData, domain::workbook::WorkbookView};
use yrs::{Any, Map, Out, Transact};

use crate::storage::engine::stores::EngineStores;

fn export_workbook_views(stores: &EngineStores) -> Vec<WorkbookView> {
    let doc = stores.storage.doc();
    let txn = doc.transact();
    let workbook = stores.storage.workbook_map();

    let settings_map = match workbook.get(&txn, KEY_WORKBOOK_SETTINGS) {
        Some(Out::YMap(m)) => m,
        _ => return Vec::new(),
    };

    let Some(Out::Any(Any::String(json))) = settings_map.get(&txn, "workbookViews") else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<WorkbookView>>(&json).unwrap_or_default()
}

fn selected_sheet_indices_for_export(stores: &EngineStores, sheet_ids: &[SheetId]) -> Vec<usize> {
    let selected_sheet_ids = crate::storage::workbook::settings::get_settings(
        stores.storage.doc(),
        stores.storage.workbook_map(),
    )
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
) {
    if selected_sheet_indices.is_empty() {
        return;
    }

    for (idx, sheet) in output_sheets.iter_mut().enumerate() {
        sheet.view.tab_selected = selected_sheet_indices.contains(&idx);
    }

    let active_tab = selected_sheet_indices[0] as u32;
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
) -> Vec<WorkbookView> {
    let mut workbook_views = export_workbook_views(stores);
    let selected_sheet_indices = selected_sheet_indices_for_export(stores, sheet_ids);
    apply_selected_sheet_view_state(output_sheets, &mut workbook_views, &selected_sheet_indices);
    workbook_views
}
