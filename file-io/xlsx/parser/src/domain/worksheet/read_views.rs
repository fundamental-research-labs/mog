use crate::infra::scanner::{extract_quoted_value, find_attr_simd, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr_opt, parse_string_attr, parse_u32_attr};
use crate::output::results::{Pane, PaneState, SheetPane};
use ooxml_types::worksheet::{PivotAxis, PivotSelection, Selection, SheetView, SheetViewType};

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
    let Some(sheet_views_block) = first_element_block(xml, b"sheetViews") else {
        return Vec::new();
    };
    let xml = sheet_views_block;
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
            let end = crate::infra::scanner::find_closing_tag(xml, b"sheetView", view_start)
                .unwrap_or(xml.len());
            (&xml[view_end + 1..end], end)
        };

        sv.pane = parse_first_pane(block);
        parse_pivot_selections(block, &mut sv);
        parse_selections(block, &mut sv);
        sv.ext_lst_xml = direct_child_element_xml(block, b"extLst");
        views.push(sv);

        search_offset = if is_self_closing {
            view_end + 1
        } else {
            sheetview_block_end + b"</sheetView>".len()
        };
    }

    views
}

/// Parse direct-child `<extLst>` XML under the `<sheetViews>` container.
pub fn parse_sheet_views_ext_lst(xml: &[u8]) -> Option<String> {
    let block = first_element_block(xml, b"sheetViews")?;
    let open_end = find_gt_simd(block, 0)? + 1;
    let close_start = block.len().saturating_sub(b"</sheetViews>".len());
    if open_end > close_start {
        return None;
    }
    direct_child_element_xml(&block[open_end..close_start], b"extLst")
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

fn parse_pivot_selections(block: &[u8], sv: &mut SheetView) {
    let mut pos = 0;
    while let Some(sel_start) = find_tag_simd(block, b"pivotSelection", pos) {
        let open_end = find_gt_simd(block, sel_start)
            .map(|p| p + 1)
            .unwrap_or(block.len());
        let sel_elem = &block[sel_start..open_end];
        let is_self_closing = open_end >= 2 && block[open_end - 2] == b'/';
        let close_start = if is_self_closing {
            open_end
        } else {
            crate::infra::scanner::find_closing_tag(block, b"pivotSelection", sel_start)
                .unwrap_or(open_end)
        };
        let pivot_area = if is_self_closing || close_start <= open_end {
            None
        } else {
            let inner = &block[open_end..close_start];
            if find_tag_simd(inner, b"pivotArea", 0).is_some() {
                std::str::from_utf8(inner).ok().map(|s| s.to_string())
            } else {
                None
            }
        };

        sv.pivot_selection.push(PivotSelection {
            pane: attr_value(sel_elem, b"pane=\"")
                .as_deref()
                .map(Pane::from_ooxml),
            show_header: attr_bool(sel_elem, b"showHeader=\""),
            label: attr_bool(sel_elem, b"label=\""),
            data: attr_bool(sel_elem, b"data=\""),
            extendable: attr_bool(sel_elem, b"extendable=\""),
            count: attr_value(sel_elem, b"count=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            axis: attr_value(sel_elem, b"axis=\"")
                .as_deref()
                .and_then(PivotAxis::from_ooxml),
            dimension: attr_value(sel_elem, b"dimension=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            start: attr_value(sel_elem, b"start=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            min: attr_value(sel_elem, b"min=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            max: attr_value(sel_elem, b"max=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            active_row: attr_value(sel_elem, b"activeRow=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            active_col: attr_value(sel_elem, b"activeCol=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            previous_row: attr_value(sel_elem, b"previousRow=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            previous_col: attr_value(sel_elem, b"previousCol=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            click: attr_value(sel_elem, b"click=\"")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(0),
            id: attr_value(sel_elem, b"r:id=\"").or_else(|| attr_value(sel_elem, b"id=\"")),
            pivot_area,
        });

        pos = if is_self_closing {
            open_end
        } else {
            close_start + b"</pivotSelection>".len()
        };
    }
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

fn attr_bool(element: &[u8], attr: &[u8]) -> bool {
    matches!(attr_value(element, attr).as_deref(), Some("1" | "true"))
}

fn attr_value(element: &[u8], attr: &[u8]) -> Option<String> {
    let pos = find_attr_simd(element, attr, 0)?;
    let (start, end) = extract_quoted_value(element, pos + attr.len())?;
    std::str::from_utf8(&element[start..end])
        .ok()
        .map(|s| s.to_string())
}

fn first_element_block<'a>(xml: &'a [u8], tag: &[u8]) -> Option<&'a [u8]> {
    let start = find_tag_simd(xml, tag, 0)?;
    let (_, end) = crate::infra::xml_fragment::extract_element_bounds(xml, start)?;
    Some(&xml[start..end])
}

fn direct_child_element_xml(xml: &[u8], tag: &[u8]) -> Option<String> {
    let mut pos = 0;
    while let Some(start) = find_tag_simd(xml, tag, pos) {
        if element_depth_before(xml, start) == 0 {
            let (_, end) = crate::infra::xml_fragment::extract_element_bounds(xml, start)?;
            return std::str::from_utf8(&xml[start..end])
                .ok()
                .map(str::to_string);
        }
        pos = start + 1;
    }
    None
}

fn element_depth_before(xml: &[u8], end: usize) -> i32 {
    let mut depth = 0i32;
    let mut pos = 0usize;
    while pos < end {
        let Some(rel) = memchr::memchr(b'<', &xml[pos..end]) else {
            break;
        };
        let start = pos + rel;
        if start + 1 >= end {
            break;
        }
        if matches!(xml[start + 1], b'?' | b'!') {
            pos = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(end);
            continue;
        }
        if xml[start + 1] == b'/' {
            depth = (depth - 1).max(0);
            pos = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(end);
            continue;
        }
        let tag_end = find_gt_simd(xml, start).unwrap_or(end);
        let self_closing = tag_end > start && xml[tag_end.saturating_sub(1)] == b'/';
        if !self_closing {
            depth += 1;
        }
        pos = tag_end + 1;
    }
    depth
}
