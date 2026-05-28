use domain_types::{
    SheetData, SheetPaneConfig as DomainSheetPaneConfig, SheetView as DomainSheetView,
};
use ooxml_types::worksheet::Pane;

use super::super::to_a1;
use crate::write::sheet::{SheetPane, SheetWriter};
use crate::write::{Selection, SheetView};

pub(super) fn apply_sheet_views(writer: &mut SheetWriter, sheet_data: &SheetData) {
    if let Some(ref frozen) = sheet_data.frozen_pane {
        if frozen.rows > 0 || frozen.cols > 0 {
            writer.set_frozen(frozen.rows, frozen.cols);
        }
    }

    let view = &sheet_data.view;
    let has_scroll = view.scroll_row > 0 || view.scroll_col > 0;
    let has_zoom = view.zoom_scale.is_some();
    let has_selection =
        view.active_cell.is_some() || !view.selections.is_empty() || view.sqref.is_some();
    let has_view_settings = has_scroll
        || has_zoom
        || !view.show_gridlines
        || !view.show_row_col_headers
        || !view.show_zeros
        || !view.show_outline_symbols
        || view.show_formulas
        || view.right_to_left
        || !view.show_ruler
        || !view.show_white_space
        || !view.default_grid_color
        || view.window_protection
        || view.color_id.is_some()
        || view.tab_selected
        || has_selection
        || view.pane.is_some()
        || view.view.is_some()
        || view.zoom_scale_normal.is_some()
        || view.zoom_scale_page_layout_view.is_some()
        || view.zoom_scale_sheet_layout_view.is_some()
        || view.has_explicit_top_left_cell
        || view.ext_lst_xml.is_some()
        || sheet_data.sheet_views_ext_lst_xml.is_some()
        || !sheet_data.extra_sheet_views.is_empty();

    if !has_view_settings {
        if let Some(ext_lst_xml) = safe_view_ext_lst(sheet_data.sheet_views_ext_lst_xml.as_deref())
        {
            writer.set_sheet_views_ext_lst_xml(ext_lst_xml.to_owned());
        }
        return;
    }

    let mut sheet_view = SheetView::default();

    if view.scroll_row != 0 || view.scroll_col != 0 || view.has_explicit_top_left_cell {
        sheet_view.top_left_cell = Some(to_a1(view.scroll_row, view.scroll_col));
    }
    if let Some(zoom) = view.zoom_scale {
        sheet_view.zoom_scale = zoom;
    }
    if let Some(zoom_normal) = view.zoom_scale_normal {
        sheet_view.zoom_scale_normal = zoom_normal;
    }
    if let Some(ref view_type) = view.view {
        sheet_view.view = ooxml_types::worksheet::SheetViewType::from_ooxml(view_type);
    }
    if let Some(z) = view.zoom_scale_page_layout_view {
        sheet_view.zoom_scale_page_layout_view = Some(z);
    }
    if let Some(z) = view.zoom_scale_sheet_layout_view {
        sheet_view.zoom_scale_sheet_layout_view = Some(z);
    }
    sheet_view.workbook_view_id = view.workbook_view_id;
    if !view.show_gridlines {
        sheet_view.show_grid_lines = false;
    }
    if !view.show_row_col_headers {
        sheet_view.show_row_col_headers = false;
    }
    if !view.show_zeros {
        sheet_view.show_zeros = false;
    }
    if view.show_formulas {
        sheet_view.show_formulas = true;
    }
    if view.right_to_left {
        sheet_view.right_to_left = true;
    }
    if view.tab_selected {
        sheet_view.tab_selected = true;
    }
    if !view.show_outline_symbols {
        sheet_view.show_outline_symbols = false;
    }
    if !view.show_ruler {
        sheet_view.show_ruler = false;
    }
    if !view.show_white_space {
        sheet_view.show_white_space = false;
    }
    if !view.default_grid_color {
        sheet_view.default_grid_color = false;
    }
    if view.window_protection {
        sheet_view.window_protection = true;
    }
    if let Some(cid) = view.color_id {
        sheet_view.color_id = cid;
    }
    sheet_view.ext_lst_xml = safe_view_ext_lst(view.ext_lst_xml.as_deref()).map(str::to_owned);

    sheet_view.pane = view.pane.as_ref().map(domain_pane_to_ooxml);

    if sheet_view.pane.is_none() {
        if let Some(ref frozen) = sheet_data.frozen_pane {
            if frozen.rows > 0 || frozen.cols > 0 {
                let mut pane = SheetPane::frozen(frozen.rows, frozen.cols);
                if let Some(ref tlc) = frozen.top_left_cell {
                    pane.top_left_cell = Some(tlc.clone());
                }
                sheet_view.pane = Some(pane);
            }
        }
    }

    if sheet_view.pane.is_some() {
        let preserved_selections =
            compatible_selections_for_pane(&view.selections, sheet_view.pane.as_ref());
        if !preserved_selections.is_empty() {
            sheet_view.selections = preserved_selections;
        } else if view.active_cell.is_some() || view.sqref.is_some() {
            let active_pane = sheet_view.pane.as_ref().unwrap().effective_active_pane();
            let sel_active = view
                .active_cell
                .clone()
                .or_else(|| sheet_view.pane.as_ref().unwrap().top_left_cell.clone());
            let sel_sqref = view.sqref.clone().or_else(|| sel_active.clone());
            sheet_view.selections = vec![Selection {
                pane: Some(active_pane),
                active_cell: sel_active,
                active_cell_id: None,
                sqref: sel_sqref,
            }];
        }
    } else if !view.selections.is_empty() {
        let preserved_selections = compatible_selections_for_pane(&view.selections, None);
        if !preserved_selections.is_empty() {
            sheet_view.selections = preserved_selections;
        } else if let Some(ref ac) = view.active_cell {
            let sqref = view.sqref.as_deref().unwrap_or(ac.as_str());
            sheet_view.selections = vec![Selection {
                pane: None,
                active_cell: Some(ac.clone()),
                active_cell_id: None,
                sqref: Some(sqref.to_string()),
            }];
        }
    } else if let Some(ref ac) = view.active_cell {
        let sqref = view.sqref.as_deref().unwrap_or(ac.as_str());
        sheet_view.selections = vec![Selection {
            pane: None,
            active_cell: Some(ac.clone()),
            active_cell_id: None,
            sqref: Some(sqref.to_string()),
        }];
    }

    if sheet_data.extra_sheet_views.is_empty() {
        writer.set_view(sheet_view);
    } else {
        let mut all_views = vec![sheet_view];
        let current_pane = all_views[0].pane.clone();
        all_views.extend(
            sheet_data
                .extra_sheet_views
                .iter()
                .map(domain_view_to_ooxml)
                .map(|view| normalize_extra_sheet_view(&view, current_pane.as_ref())),
        );
        writer.set_views(all_views);
    }
    if let Some(ext_lst_xml) = safe_view_ext_lst(sheet_data.sheet_views_ext_lst_xml.as_deref()) {
        writer.set_sheet_views_ext_lst_xml(ext_lst_xml.to_owned());
    }
}

fn normalize_extra_sheet_view(view: &SheetView, current_pane: Option<&SheetPane>) -> SheetView {
    let mut view = view.clone();
    if !pane_shape_is_compatible(view.pane.as_ref(), current_pane) {
        view.pane = None;
    }
    view.selections = compatible_selections_for_pane(&view.selections, view.pane.as_ref());
    view
}

fn domain_pane_to_ooxml(pane: &DomainSheetPaneConfig) -> SheetPane {
    pane.to_ooxml()
}

fn domain_view_to_ooxml(view: &DomainSheetView) -> SheetView {
    let mut sheet_view = SheetView::default();
    if view.window_protection {
        sheet_view.window_protection = true;
    }
    if view.show_formulas {
        sheet_view.show_formulas = true;
    }
    if !view.show_gridlines {
        sheet_view.show_grid_lines = false;
    }
    if !view.show_row_col_headers {
        sheet_view.show_row_col_headers = false;
    }
    if !view.show_zeros {
        sheet_view.show_zeros = false;
    }
    if view.right_to_left {
        sheet_view.right_to_left = true;
    }
    if view.tab_selected {
        sheet_view.tab_selected = true;
    }
    if !view.show_ruler {
        sheet_view.show_ruler = false;
    }
    if !view.show_outline_symbols {
        sheet_view.show_outline_symbols = false;
    }
    if !view.default_grid_color {
        sheet_view.default_grid_color = false;
    }
    if !view.show_white_space {
        sheet_view.show_white_space = false;
    }
    if let Some(ref view_type) = view.view {
        sheet_view.view = ooxml_types::worksheet::SheetViewType::from_ooxml(view_type);
    }
    if view.scroll_row != 0 || view.scroll_col != 0 || view.has_explicit_top_left_cell {
        sheet_view.top_left_cell = Some(to_a1(view.scroll_row, view.scroll_col));
    }
    if let Some(color_id) = view.color_id {
        sheet_view.color_id = color_id;
    }
    if let Some(zoom) = view.zoom_scale {
        sheet_view.zoom_scale = zoom;
    }
    if let Some(zoom) = view.zoom_scale_normal {
        sheet_view.zoom_scale_normal = zoom;
    }
    sheet_view.zoom_scale_page_layout_view = view.zoom_scale_page_layout_view;
    sheet_view.zoom_scale_sheet_layout_view = view.zoom_scale_sheet_layout_view;
    sheet_view.workbook_view_id = view.workbook_view_id;
    sheet_view.pane = view.pane.as_ref().map(domain_pane_to_ooxml);
    sheet_view.selections = view.selections.clone();
    sheet_view.pivot_selection = view.pivot_selection.clone();
    sheet_view.ext_lst_xml = safe_view_ext_lst(view.ext_lst_xml.as_deref()).map(str::to_owned);
    sheet_view
}

fn safe_view_ext_lst(ext_lst_xml: Option<&str>) -> Option<&str> {
    let xml = ext_lst_xml?;
    let lowered = xml.to_ascii_lowercase();
    let has_relationship = lowered.contains("r:id")
        || lowered.contains("r:embed")
        || lowered.contains("r:link")
        || lowered.contains("relationshipid");
    let has_address_like_ref = lowered.contains(" sqref=")
        || lowered.contains(" ref=")
        || lowered.contains(" activecell=")
        || lowered.contains(" range=");
    (!has_relationship && !has_address_like_ref).then_some(xml)
}

fn compatible_selections_for_pane(
    selections: &[Selection],
    pane: Option<&SheetPane>,
) -> Vec<Selection> {
    selections
        .iter()
        .filter(|selection| selection_pane_is_compatible(selection.pane, pane))
        .cloned()
        .collect()
}

fn selection_pane_is_compatible(selection_pane: Option<Pane>, pane: Option<&SheetPane>) -> bool {
    let Some(selection_pane) = selection_pane else {
        return true;
    };
    let Some(pane) = pane else {
        return false;
    };

    let has_rows = pane.y_split != 0.0;
    let has_cols = pane.x_split != 0.0;
    match (has_rows, has_cols) {
        (true, true) => true,
        (true, false) => matches!(selection_pane, Pane::TopLeft | Pane::BottomLeft),
        (false, true) => matches!(selection_pane, Pane::TopLeft | Pane::TopRight),
        (false, false) => matches!(selection_pane, Pane::TopLeft),
    }
}

fn pane_shape_is_compatible(pane: Option<&SheetPane>, current_pane: Option<&SheetPane>) -> bool {
    match (pane, current_pane) {
        (None, _) => true,
        (Some(pane), None) => !pane.is_frozen(),
        (Some(pane), Some(current_pane)) => {
            (pane.x_split != 0.0) == (current_pane.x_split != 0.0)
                && (pane.y_split != 0.0) == (current_pane.y_split != 0.0)
        }
    }
}
