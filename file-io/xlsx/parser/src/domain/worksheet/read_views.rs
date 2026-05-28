use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr, parse_u32_attr};
use crate::output::results::{Pane, PaneState, SheetPane};
use ooxml_types::worksheet::{Selection, SheetView, SheetViewType};

/// Parse pane settings from worksheet XML.
pub fn parse_frozen_pane(xml: &[u8]) -> Option<SheetPane> {
    let pane_start = find_tag_simd(xml, b"pane", 0)?;
    let pane_end = find_gt_simd(xml, pane_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    Some(parse_pane_element(&xml[pane_start..pane_end]))
}

/// Parse all sheet view options from worksheet XML.
pub fn parse_sheet_views(xml: &[u8]) -> Vec<SheetView> {
    let mut views = Vec::new();
    let mut search_offset = 0;

    while let Some(view_start) = find_tag_simd(xml, b"sheetView", search_offset) {
        let after_tag = view_start + b"<sheetView".len();
        if after_tag < xml.len() && xml[after_tag] == b's' {
            search_offset = after_tag;
            continue;
        }

        let view_end = match find_gt_simd(xml, view_start) {
            Some(p) => p,
            None => break,
        };
        let element = &xml[view_start..view_end + 1];
        let mut sv = parse_sheet_view_attrs(element);

        let is_self_closing = view_end > 0 && xml[view_end - 1] == b'/';
        let (block, sheetview_block_end) = if is_self_closing {
            (&xml[view_end + 1..view_end + 1], view_end + 1)
        } else {
            let end =
                crate::infra::scanner::find_closing_tag(xml, b"sheetView", view_start)
                    .unwrap_or(xml.len());
            (&xml[view_end + 1..end], end)
        };

        sv.pane = parse_first_pane(block);
        parse_selections(block, &mut sv);
        views.push(sv);

        search_offset = if is_self_closing {
            view_end + 1
        } else {
            sheetview_block_end + b"</sheetView>".len()
        };
    }

    views
}

/// Parse sheet view options from worksheet XML (convenience wrapper).
pub fn parse_sheet_view(xml: &[u8]) -> Option<SheetView> {
    parse_sheet_views(xml).into_iter().next()
}

fn parse_sheet_view_attrs(element: &[u8]) -> SheetView {
    let mut sv = SheetView::default();

    if let Some(v) = parse_bool_attr_opt(element, b"showGridLines=\"") {
        sv.show_grid_lines = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showRowColHeaders=\"") {
        sv.show_row_col_headers = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showFormulas=\"") {
        sv.show_formulas = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showZeros=\"") {
        sv.show_zeros = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"tabSelected=\"") {
        sv.tab_selected = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"rightToLeft=\"") {
        sv.right_to_left = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showRuler=\"") {
        sv.show_ruler = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showOutlineSymbols=\"") {
        sv.show_outline_symbols = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"showWhiteSpace=\"") {
        sv.show_white_space = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"windowProtection=\"") {
        sv.window_protection = v;
    }
    if let Some(v) = parse_bool_attr_opt(element, b"defaultGridColor=\"") {
        sv.default_grid_color = v;
    }

    if let Some(v) = parse_string_attr(element, b"topLeftCell=\"") {
        if !v.is_empty() {
            sv.top_left_cell = Some(v);
        }
    }
    if let Some(v) = parse_string_attr(element, b"view=\"") {
        sv.view = SheetViewType::from_ooxml(&v);
    }

    if let Some(v) = parse_u32_attr(element, b"zoomScale=\"") {
        sv.zoom_scale = v;
    }
    if let Some(v) = parse_u32_attr(element, b"zoomScaleNormal=\"") {
        sv.zoom_scale_normal = v;
    }
    if let Some(v) = parse_u32_attr(element, b"zoomScalePageLayoutView=\"") {
        sv.zoom_scale_page_layout_view = Some(v);
    }
    if let Some(v) = parse_u32_attr(element, b"zoomScaleSheetLayoutView=\"") {
        sv.zoom_scale_sheet_layout_view = Some(v);
    }
    if let Some(v) = parse_u32_attr(element, b"workbookViewId=\"") {
        sv.workbook_view_id = v;
    }
    if let Some(v) = parse_u32_attr(element, b"colorId=\"") {
        sv.color_id = v;
    }

    sv
}

fn parse_first_pane(block: &[u8]) -> Option<ooxml_types::worksheet::SheetPane> {
    let pane_start = find_tag_simd(block, b"pane", 0)?;
    let pane_end = find_gt_simd(block, pane_start)
        .map(|p| p + 1)
        .unwrap_or(block.len());
    Some(parse_pane_element(&block[pane_start..pane_end]))
}

fn parse_pane_element(pane: &[u8]) -> SheetPane {
    let state = attr_value(pane, b"state=\"")
        .as_deref()
        .map(PaneState::from_ooxml)
        .unwrap_or(PaneState::Split);
    let x_split = attr_value(pane, b"xSplit=\"")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);
    let y_split = attr_value(pane, b"ySplit=\"")
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);
    let top_left_cell = attr_value(pane, b"topLeftCell=\"");
    let active_pane = attr_value(pane, b"activePane=\"")
        .as_deref()
        .map(Pane::from_ooxml)
        .unwrap_or(Pane::TopLeft);

    SheetPane::from_parsed(
        x_split,
        y_split,
        top_left_cell.as_deref(),
        active_pane,
        state,
    )
}

fn parse_selections(block: &[u8], sv: &mut SheetView) {
    let mut pos = 0;
    while let Some(sel_start) = find_tag_simd(block, b"selection", pos) {
        let sel_end = find_gt_simd(block, sel_start)
            .map(|p| p + 1)
            .unwrap_or(block.len());
        let sel_elem = &block[sel_start..sel_end];

        let pane = attr_value(sel_elem, b"pane=\"")
            .as_deref()
            .map(Pane::from_ooxml);
        let active_cell = attr_value(sel_elem, b"activeCell=\"");
        let active_cell_id =
            attr_value(sel_elem, b"activeCellId=\"").and_then(|v| v.parse::<u32>().ok());
        let sqref = attr_value(sel_elem, b"sqref=\"");

        sv.selections.push(Selection {
            pane,
            active_cell,
            active_cell_id,
            sqref,
        });

        pos = sel_end;
    }
}

fn attr_value(element: &[u8], attr: &[u8]) -> Option<String> {
    let pos = find_attr_simd(element, attr, 0)?;
    let (start, end) = extract_quoted_value(element, pos + attr.len())?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}
