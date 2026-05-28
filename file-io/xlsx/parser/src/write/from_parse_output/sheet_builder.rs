//! Sheet building: SheetData → SheetWriter.

use std::collections::HashSet;

use domain_types::{
    AuthoredStyleRun, CellData as DomainCellData, CellValue as DomainValue, SheetData,
    SheetPaneConfig as DomainSheetPaneConfig, SheetView as DomainSheetView,
};
use domain_types::{DataTableRegion, OutlineGroup};

use super::super::{SharedStringsWriter, to_a1};
use crate::write::sheet::{CellData, CellValue, ColWidth, SheetFormatPr, SheetPane, SheetWriter};
use crate::write::{Selection, SheetView};
use ooxml_types::worksheet::Pane;
use value_types::CellError;

/// Build a `SheetWriter` from a `SheetData`.
///
/// `data_table_body_positions` is the set of `(row, col)` body-cell positions
/// of any Data Table region that lives on this sheet (i.e. every position in
/// each region rectangle except the master at `(start_row, start_col)`). The
/// data model carries body-cell formulas symmetrically (every region cell
/// owns a synthesized `=TABLE(r2, r1)` text — see `convert_cell` in the
/// `to_parse_output` reader pipeline), but the OOXML representation is
/// asymmetric for compactness: only the master emits `<f t="dataTable">`,
/// while body cells round-trip as `<v>`-only. Body-cell formula text is
/// suppressed here at the write boundary so the asymmetry is restored.
pub(super) fn build_sheet(
    sheet_data: &SheetData,
    shared_strings: &mut SharedStringsWriter,
    data_table_body_positions: &HashSet<(u32, u32)>,
    data_table_regions: &[DataTableRegion],
    emit_cell_metadata_refs: bool,
) -> SheetWriter {
    let mut writer = SheetWriter::new();
    if let Some(sheet_properties) = &sheet_data.sheet_properties {
        let mut sheet_properties = sheet_properties.clone();
        if let Some(print_settings) = &sheet_data.print_settings
            && let Some(page_setup_properties) = &print_settings.page_setup_properties
        {
            sheet_properties.page_set_up_pr = Some(ooxml_types::worksheet::PageSetupProperties {
                auto_page_breaks: page_setup_properties.auto_page_breaks,
                fit_to_page: page_setup_properties.fit_to_page,
            });
        }
        writer.set_sheet_properties(sheet_properties);
    } else if let Some(outline_properties) = &sheet_data.outline_properties {
        let mut sheet_properties = ooxml_types::worksheet::SheetProperties {
            outline_pr: Some(outline_properties.clone()),
            ..Default::default()
        };
        if let Some(print_settings) = &sheet_data.print_settings
            && let Some(page_setup_properties) = &print_settings.page_setup_properties
        {
            sheet_properties.page_set_up_pr = Some(ooxml_types::worksheet::PageSetupProperties {
                auto_page_breaks: page_setup_properties.auto_page_breaks,
                fit_to_page: page_setup_properties.fit_to_page,
            });
        }
        writer.set_sheet_properties(sheet_properties);
    } else if let Some(print_settings) = &sheet_data.print_settings
        && let Some(page_setup_properties) = &print_settings.page_setup_properties
    {
        writer.set_sheet_properties(ooxml_types::worksheet::SheetProperties {
            page_set_up_pr: Some(ooxml_types::worksheet::PageSetupProperties {
                auto_page_breaks: page_setup_properties.auto_page_breaks,
                fit_to_page: page_setup_properties.fit_to_page,
            }),
            ..Default::default()
        });
    }

    // ── Sheet format properties (default row height, column width) ─────
    {
        let dims = &sheet_data.dimensions;
        let mut fmt = SheetFormatPr::default();
        if let Some(h) = dims.default_row_height {
            fmt.default_row_height = h;
        }
        fmt.custom_height = dims.custom_height;
        if let Some(w) = dims.default_col_width {
            fmt.default_col_width = Some(w);
        }
        if let Some(d) = dims.default_row_descent {
            fmt.default_row_descent = Some(d);
        }
        fmt.base_col_width = dims.base_col_width;
        fmt.zero_height = dims.zero_height;
        fmt.outline_level_row = dims.outline_level_row;
        fmt.outline_level_col = dims.outline_level_col;
        writer.set_sheet_format_pr(fmt);
    }

    // ── Column widths + col styles ─────────────────────────────────────
    // Build a lookup of col_styles for merging with col widths.
    let col_style_map: std::collections::HashMap<u32, u32> = sheet_data
        .col_styles
        .iter()
        .map(|cs| (cs.col, cs.style_id + 1))
        .collect();

    // Build per-column outline level lookup from outline groups so that
    // outline levels participate in coalescing (columns with different outline
    // levels must not be merged into a single range).
    let mut col_outline_levels: std::collections::HashMap<u32, u8> =
        std::collections::HashMap::new();
    let mut col_outline_hidden: std::collections::HashMap<u32, bool> =
        std::collections::HashMap::new();
    let mut col_collapsed: std::collections::HashMap<u32, bool> = std::collections::HashMap::new();
    let mut max_col_outline_level: u8 = 0;
    for group in &sheet_data.outline_groups {
        if group.is_row {
            continue;
        }
        let level = (group.level as u8).min(7);
        max_col_outline_level = max_col_outline_level.max(level);
        for c in group.start..=group.end {
            let entry = col_outline_levels.entry(c).or_insert(0);
            *entry = (*entry).max(level);
            if group.hidden {
                col_outline_hidden.insert(c, true);
            }
        }
        if group.collapsed {
            if group.collapsed_on_member {
                // Collapsed was originally on group member columns themselves
                for c in group.start..=group.end {
                    col_collapsed.insert(c, true);
                }
            } else {
                // Standard OOXML: collapsed on the column after the group
                col_collapsed.insert(group.end + 1, true);
            }
        }
    }

    // Build enriched column entries (width + style + outline), then coalesce consecutive
    // columns with identical properties into OOXML ranges (min..max).
    struct ColEntry {
        col_0: u32,
        width: f64,
        custom_width: bool,
        hidden: bool,
        best_fit: bool,
        style: Option<u32>,
        has_width: bool,
        outline_level: Option<u8>,
        collapsed: bool,
    }

    let mut col_entries: Vec<ColEntry> = Vec::new();
    let mut emitted_cols = std::collections::HashSet::new();

    for col_dim in &sheet_data.dimensions.col_widths {
        let style = col_style_map.get(&col_dim.col).copied();
        let outline_level = col_outline_levels.get(&col_dim.col).copied();
        // Outline hidden overrides col_dim hidden (they come from the same source)
        let hidden = col_dim.hidden
            || col_outline_hidden
                .get(&col_dim.col)
                .copied()
                .unwrap_or(false);
        let is_collapsed =
            col_collapsed.get(&col_dim.col).copied().unwrap_or(false) || col_dim.collapsed;
        col_entries.push(ColEntry {
            col_0: col_dim.col,
            width: col_dim.width,
            custom_width: col_dim.custom_width,
            hidden,
            best_fit: col_dim.best_fit,
            style,
            has_width: true,
            outline_level,
            collapsed: is_collapsed,
        });
        emitted_cols.insert(col_dim.col);
    }

    // Emit col_styles for columns not already emitted via col_widths.
    // Use the sheet's default column width so that the <col> element has a proper
    // width attribute (OOXML requires width on <col>). Without this, style-only
    // columns would get width="0" which corrupts the file.
    let default_cw = sheet_data.dimensions.default_col_width.unwrap_or(8.43);
    for cs in &sheet_data.col_styles {
        if !emitted_cols.contains(&cs.col) {
            let outline_level = col_outline_levels.get(&cs.col).copied();
            let hidden = col_outline_hidden.get(&cs.col).copied().unwrap_or(false);
            let is_collapsed = col_collapsed.get(&cs.col).copied().unwrap_or(false);
            col_entries.push(ColEntry {
                col_0: cs.col,
                width: default_cw,
                custom_width: false,
                hidden,
                best_fit: false,
                style: Some(cs.style_id + 1),
                has_width: true,
                outline_level,
                collapsed: is_collapsed,
            });
            emitted_cols.insert(cs.col);
        }
    }

    // Emit columns that only have outline levels (no width or style).
    // Use the sheet's default column width so the <col> element is valid
    // (OOXML requires a width attribute). Without this, columns whose width
    // matches the default get omitted from col_widths during Yrs export,
    // then re-appear here with width="0" which corrupts the file.
    for (&col, &level) in &col_outline_levels {
        if !emitted_cols.contains(&col) {
            let hidden = col_outline_hidden.get(&col).copied().unwrap_or(false);
            let is_collapsed = col_collapsed.get(&col).copied().unwrap_or(false);
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                custom_width: false,
                hidden,
                best_fit: false,
                style: None,
                has_width: true,
                outline_level: Some(level),
                collapsed: is_collapsed,
            });
            emitted_cols.insert(col);
        }
    }

    // Emit columns that only have a collapsed flag (column after outline group end).
    for (&col, &is_collapsed) in &col_collapsed {
        if is_collapsed && !emitted_cols.contains(&col) {
            col_entries.push(ColEntry {
                col_0: col,
                width: default_cw,
                custom_width: false,
                hidden: false,
                best_fit: false,
                style: None,
                has_width: true,
                outline_level: None,
                collapsed: true,
            });
        }
    }

    // Sort by column index so coalescing works on adjacent columns.
    col_entries.sort_by_key(|e| e.col_0);

    // Coalesce consecutive columns with identical properties into ranges.
    let mut i = 0;
    while i < col_entries.len() {
        let start_idx = i;
        let start = &col_entries[start_idx];
        let mut max_col_0 = start.col_0;

        // Extend range while the next column is consecutive and identical.
        while i + 1 < col_entries.len() {
            let next = &col_entries[i + 1];
            if next.col_0 == max_col_0 + 1
                && next.width == start.width
                && next.custom_width == start.custom_width
                && next.hidden == start.hidden
                && next.best_fit == start.best_fit
                && next.style == start.style
                && next.has_width == start.has_width
                && next.outline_level == start.outline_level
                && next.collapsed == start.collapsed
            {
                max_col_0 = next.col_0;
                i += 1;
            } else {
                break;
            }
        }

        let min_1 = start.col_0 + 1;
        let max_1 = max_col_0 + 1;
        let mut cw = ColWidth::range(min_1, max_1, start.width);
        cw.custom_width = start.custom_width;
        cw.hidden = start.hidden;
        cw.best_fit = start.best_fit;
        cw.style = start.style;
        cw.outline_level = start.outline_level;
        cw.collapsed = start.collapsed;
        if !start.has_width {
            cw.width = None; // No custom width, only style.
        }
        writer.add_col(cw);

        i += 1;
    }

    // ── Trailing column ranges (beyond data region) ──────────────────────
    // These represent <col max="16384"> ranges preserved from the original XLSX.
    // They are stored as opaque metadata through Yrs and emitted after the
    // regular (data-region) column entries.
    for tcr in &sheet_data.dimensions.trailing_col_ranges {
        let mut cw = ColWidth::range(tcr.min, tcr.max, tcr.width);
        cw.custom_width = tcr.custom_width;
        cw.hidden = tcr.hidden;
        cw.best_fit = tcr.best_fit;
        cw.collapsed = tcr.collapsed;
        if let Some(sid) = tcr.style_id {
            cw.style = Some(sid + 1);
        }
        writer.add_col(cw);
    }

    // ── Row heights + row styles ────────────────────────────────────────
    for row_dim in &sheet_data.dimensions.row_heights {
        // Only set height when the row has a meaningful height value.
        // Descent-only rows (height==0, not custom, not hidden) should only get descent set.
        // Hidden rows with height==0 don't need an explicit ht="0" — the hidden attribute
        // alone is sufficient (especially when sheetFormatPr has zeroHeight="1").
        let has_height = row_dim.custom_height || row_dim.height > 0.0;
        if has_height {
            if row_dim.custom_height {
                writer.set_row_height(row_dim.row, row_dim.height);
            } else {
                writer.set_row_height_no_custom(row_dim.row, row_dim.height);
            }
        }
        if row_dim.hidden || row_dim.explicit_hidden {
            writer.set_row_hidden(row_dim.row, row_dim.hidden);
        }
        if let Some(d) = row_dim.descent {
            writer.set_row_descent(row_dim.row, d);
        }
        if row_dim.custom_format {
            writer.set_row_custom_format(row_dim.row, true);
        }
        if let Some(level) = row_dim.outline_level {
            writer.set_row_outline_level(row_dim.row, level);
        } else if row_dim.explicit_outline_level_zero {
            writer.set_row_outline_level(row_dim.row, 0);
        }
        if let Some(collapsed) = row_dim.collapsed {
            writer.set_row_collapsed(row_dim.row, collapsed);
        }
        if row_dim.thick_top {
            writer.set_row_thick_top(row_dim.row, true);
        }
        if row_dim.thick_bot {
            writer.set_row_thick_bot(row_dim.row, true);
        }
        if let Some(spans) = &row_dim.xml_hints.spans {
            writer.set_row_spans(row_dim.row, spans.clone());
        }
        if row_dim.xml_hints.bare_empty {
            writer.mark_bare_empty_row(row_dim.row);
        }
    }
    for rs in &sheet_data.row_styles {
        writer.set_row_style(rs.row, rs.style_id + 1);
    }

    // ── Cells ───────────────────────────────────────────────────────────
    let data_table_master_formulas = data_table_master_formula_map(data_table_regions);
    let authored_style_at = |row: u32, col: u32| -> Option<u32> {
        sheet_data
            .authored_style_runs
            .iter()
            .filter(|run| {
                row >= run.start_row
                    && row <= run.end_row
                    && col >= run.start_col
                    && col <= run.end_col
            })
            .map(|run| run.style_id)
            .next_back()
    };
    for cell in &sheet_data.cells {
        let key = (cell.row, cell.col);
        let is_data_table_master = data_table_master_formulas.contains_key(&key)
            || cell.cell_formula.as_ref().is_some_and(|formula| {
                formula.t == ooxml_types::worksheet::CellFormulaType::DataTable
            });
        // Data Table body cells carry a synthesized `=TABLE(r2, r1)` formula
        // in the data model (see `to_parse_output::cells::convert_cell`).
        // The OOXML representation only emits `<f t="dataTable">` on the
        // master cell — body cells round-trip as `<v>`-only. Suppress the
        // formula text at the write boundary so the writer falls into the
        // plain-value `convert_cell` arm and emits `<v>` only.
        let writer_cell = if data_table_body_positions.contains(&key)
            || is_data_table_body_formula(cell, is_data_table_master)
        {
            let mut sanitized = cell.clone();
            sanitized.formula = None;
            sanitized.cell_formula = None;
            if sanitized.style_id.is_none() {
                sanitized.style_id = authored_style_at(sanitized.row, sanitized.col);
            }
            convert_cell_with_metadata_refs(&sanitized, shared_strings, emit_cell_metadata_refs)
        } else {
            let mut canonical = cell.clone();
            if canonical.style_id.is_none() {
                canonical.style_id = authored_style_at(canonical.row, canonical.col);
            }
            canonical.cell_formula = current_formula_metadata(&canonical).cloned();
            if let Some(cell_formula) = data_table_master_formulas.get(&key) {
                canonical.cell_formula = Some(cell_formula.clone());
                if canonical.formula.is_none() {
                    canonical.formula = Some(data_table_formula_text(cell_formula));
                }
            }
            convert_cell_with_metadata_refs(&canonical, shared_strings, emit_cell_metadata_refs)
        };
        writer.add_cell(writer_cell);
    }
    for run in &sheet_data.authored_style_runs {
        writer.add_authored_style_run(AuthoredStyleRun {
            start_row: run.start_row,
            start_col: run.start_col,
            end_row: run.end_row,
            end_col: run.end_col,
            style_id: run.style_id + 1,
        });
    }

    // ── Apply default descent to all data rows ─────────────────────────
    // Excel always writes x14ac:dyDescent on every <row> element when the
    // sheet-level sheetFormatPr declares a default descent. Rows that already
    // have an explicit per-row descent (set above from RowDimension entries)
    // are left untouched; all other data rows inherit the sheet default.
    if let Some(default_descent) = sheet_data.dimensions.default_row_descent {
        let rows_with_descent: std::collections::HashSet<u32> = sheet_data
            .dimensions
            .row_heights
            .iter()
            .filter(|rd| rd.descent.is_some())
            .map(|rd| rd.row)
            .collect();
        let data_rows: std::collections::HashSet<u32> =
            sheet_data.cells.iter().map(|c| c.row).collect();
        for row in data_rows {
            if !rows_with_descent.contains(&row) {
                writer.set_row_descent(row, default_descent);
            }
        }
    }

    // ── Merges ──────────────────────────────────────────────────────────
    for merge in &sheet_data.merges {
        writer.add_merge(
            merge.start_row,
            merge.start_col,
            merge.end_row,
            merge.end_col,
        );
    }

    // ── Frozen pane ─────────────────────────────────────────────────────
    if let Some(ref frozen) = sheet_data.frozen_pane {
        if frozen.rows > 0 || frozen.cols > 0 {
            writer.set_frozen(frozen.rows, frozen.cols);
        }
    }

    // ── Sheet view (zoom, scroll, gridlines, etc.) ──────────────────────
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
        || !sheet_data.extra_sheet_views.is_empty();

    if has_view_settings {
        let mut sheet_view = SheetView::default();

        // Emit topLeftCell when the scroll position is non-default, or when the
        // original file had an explicit topLeftCell attribute (even if it was "A1").
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

        sheet_view.pane = view.pane.as_ref().map(domain_pane_to_ooxml);

        // Re-apply legacy frozen pane projection when no typed pane is present.
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
            // Non-frozen sheet with preserved selections
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
            // Non-frozen sheet with a preserved active cell selection
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
            // Combine primary view with extra views for round-trip fidelity.
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
    }

    writer
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
    sheet_view
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

fn data_table_master_formula_map(
    regions: &[DataTableRegion],
) -> std::collections::HashMap<(u32, u32), ooxml_types::worksheet::CellFormula> {
    use ooxml_types::worksheet::{CellFormula, CellFormulaType};

    regions
        .iter()
        .map(|region| {
            let flags = region.ooxml_flags.clone().unwrap_or_default();
            let cell_formula = CellFormula {
                t: CellFormulaType::DataTable,
                r#ref: Some(format!(
                    "{}:{}",
                    crate::infra::a1::to_a1(region.start_row, region.start_col),
                    crate::infra::a1::to_a1(region.end_row, region.end_col),
                )),
                // Domain DataTableRegion refs are normalized: col_input_ref
                // came from OOXML r1, row_input_ref came from OOXML r2.
                r1: flags.r1.clone().or_else(|| {
                    region
                        .col_input_ref
                        .as_ref()
                        .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
                }),
                r2: flags.r2.clone().or_else(|| {
                    region
                        .row_input_ref
                        .as_ref()
                        .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
                }),
                aca: flags.aca,
                ca: flags.ca,
                bx: flags.bx,
                dt2d: flags.dt2d,
                dtr: flags.dtr,
                del1: flags.del1,
                del2: flags.del2,
                ..Default::default()
            };
            ((region.start_row, region.start_col), cell_formula)
        })
        .collect()
}

fn data_table_formula_text(cell_formula: &ooxml_types::worksheet::CellFormula) -> String {
    let row_arg = cell_formula
        .r2
        .clone()
        .unwrap_or_else(|| "\"\"".to_string());
    let col_arg = cell_formula
        .r1
        .clone()
        .unwrap_or_else(|| "\"\"".to_string());
    format!("TABLE({row_arg},{col_arg})")
}

fn current_formula_metadata(cell: &DomainCellData) -> Option<&ooxml_types::worksheet::CellFormula> {
    cell.cell_formula
        .as_ref()
        .filter(|formula| current_formula_metadata_matches_current_cell(cell, formula))
}

fn current_formula_metadata_matches_current_cell(
    cell: &DomainCellData,
    formula: &ooxml_types::worksheet::CellFormula,
) -> bool {
    use ooxml_types::worksheet::CellFormulaType;

    if !formula_metadata_matches_current_cell(cell, formula) {
        return false;
    }

    match formula.t {
        CellFormulaType::Shared => formula
            .r#ref
            .as_deref()
            .is_some_and(|r| single_cell_ref_matches(r, cell.row, cell.col)),
        CellFormulaType::Array => current_array_formula_ref_matches(cell, formula),
        _ => true,
    }
}

fn current_array_formula_ref_matches(
    cell: &DomainCellData,
    formula: &ooxml_types::worksheet::CellFormula,
) -> bool {
    let Some(ref_text) = formula.r#ref.as_deref() else {
        return false;
    };

    if single_cell_ref_matches(ref_text, cell.row, cell.col) {
        return true;
    }

    cell.array_ref.as_deref().is_some_and(|array_ref| {
        formulas_match(array_ref, ref_text) && range_starts_at(ref_text, cell.row, cell.col)
    })
}

fn formula_metadata_matches_current_cell(
    cell: &DomainCellData,
    formula: &ooxml_types::worksheet::CellFormula,
) -> bool {
    let Some(current_formula) = cell.formula.as_deref() else {
        return false;
    };

    use ooxml_types::worksheet::CellFormulaType;
    match formula.t {
        CellFormulaType::DataTable => formulas_match(
            current_formula,
            formula
                .text
                .is_empty()
                .then(|| data_table_formula_text(formula))
                .as_deref()
                .unwrap_or(&formula.text),
        ),
        CellFormulaType::Shared | CellFormulaType::Array if !formula.text.is_empty() => {
            formulas_match(current_formula, &formula.text)
        }
        CellFormulaType::Shared | CellFormulaType::Array => false,
        _ => true,
    }
}

fn range_starts_at(ref_text: &str, row: u32, col: u32) -> bool {
    crate::infra::a1::parse_a1_range(ref_text)
        .is_some_and(|(start_row, start_col, _, _)| start_row == row && start_col == col)
}

fn formulas_match(current: &str, imported: &str) -> bool {
    formula_identity_text(current) == formula_identity_text(imported)
}

fn formula_identity_text(formula: &str) -> &str {
    formula.strip_prefix('=').unwrap_or(formula)
}

fn single_cell_ref_matches(ref_text: &str, row: u32, col: u32) -> bool {
    if let Some((start_row, start_col, end_row, end_col)) =
        crate::infra::a1::parse_a1_range(ref_text)
    {
        start_row == row && end_row == row && start_col == col && end_col == col
    } else {
        crate::infra::a1::parse_a1_cell(ref_text)
            .is_some_and(|(ref_row, ref_col)| ref_row == row && ref_col == col)
    }
}

fn is_data_table_body_formula(cell: &DomainCellData, is_data_table_master: bool) -> bool {
    if is_data_table_master {
        return false;
    }
    cell.formula
        .as_deref()
        .map(|formula| {
            let formula = formula.trim_start();
            let formula = formula.strip_prefix('=').unwrap_or(formula);
            formula
                .get(..6)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("TABLE("))
        })
        .unwrap_or(false)
}

/// Convert a domain `CellData` into a writer `CellData`.
#[cfg(test)]
pub(super) fn convert_cell(
    cell: &DomainCellData,
    shared_strings: &mut SharedStringsWriter,
) -> CellData {
    convert_cell_with_metadata_refs(cell, shared_strings, true)
}

fn convert_cell_with_metadata_refs(
    cell: &DomainCellData,
    shared_strings: &mut SharedStringsWriter,
    emit_cell_metadata_refs: bool,
) -> CellData {
    let style_index = cell.style_id.map(|id| id + 1);

    let mut is_empty_string_cell = false;
    let authored_numeric_value = matching_authored_numeric_value(cell);
    let value = match (&cell.value, &cell.formula) {
        // Formula cells
        (_, Some(formula)) => {
            let cached = match &cell.value {
                DomainValue::Number(n) => Some(Box::new(CellValue::Number(n.get()))),
                DomainValue::Text(s) => {
                    // Formula cells with text cached values should use t="str" (FormulaString),
                    // not t="s" (shared string reference). OOXML uses t="str" for inline
                    // string results of formula evaluation.
                    Some(Box::new(CellValue::FormulaString(s.as_ref().to_string())))
                }
                DomainValue::Boolean(b) => Some(Box::new(CellValue::Boolean(*b))),
                DomainValue::Error(_, _) if authored_numeric_value.is_some() => {
                    // The semantic value is #NUM!, but the source authored an
                    // untyped numeric cached value such as <v>NaN</v>. Keep the
                    // semantic value finite-safe in the domain model while
                    // restoring the authored numeric cell shape at the XLSX edge.
                    Some(Box::new(CellValue::Number(0.0)))
                }
                DomainValue::Error(e, _) => {
                    Some(Box::new(CellValue::Error(e.as_str().to_string())))
                }
                _ if cell.has_empty_cached_value => {
                    // Preserve explicit empty <v/> from the original XML.
                    // Use Number(0.0) — the writer will use the original_value ""
                    // to emit an empty <v></v> instead of <v>0</v>.
                    Some(Box::new(CellValue::Number(0.0)))
                }
                _ => None,
            };
            CellValue::Formula {
                formula: formula.clone(),
                cached_value: cached,
                cell_formula: cell.cell_formula.clone(),
            }
        }
        // Plain value cells
        (DomainValue::Number(n), None) => CellValue::Number(n.get()),
        (DomainValue::Text(s), None) => {
            // Preserve t="str" (inline/formula string) during round-trip.
            // CELL_TYPE_FORMULA_STRING (6) means the original cell had t="str",
            // which stores the string value directly in <v>, NOT as a shared
            // string reference. Converting to CellValue::String would change
            // t="str" to t="s" and put the value in the SST — breaking round-trip.
            if cell.formula_result_type == Some(6) {
                CellValue::FormulaString(s.as_ref().to_string())
            } else if s.is_empty() && cell.original_sst_index.is_none() {
                // Cell originally had t="s" but no <v> element (self-closing).
                // Emit as Empty with explicit_type="s" to preserve the original form.
                // We set explicit_type below after the match.
                is_empty_string_cell = true;
                CellValue::Empty
            } else if let Some(rich) = current_rich_string(cell, s.as_ref()) {
                let sst_idx = shared_strings.add_rich_shared_string(rich);
                CellValue::String(sst_idx)
            } else {
                // Use the original SST index when it still resolves to this text
                // in the seeded SST. If the cell was edited after import, the
                // stale index must not override the current resolved value.
                let sst_idx = if let Some(orig_idx) = cell.original_sst_index {
                    shared_strings
                        .add_imported_hint_if_text_matches(orig_idx as usize, s.as_ref())
                        .unwrap_or_else(|| shared_strings.add(s.as_ref()))
                } else {
                    shared_strings.add(s.as_ref())
                };
                CellValue::String(sst_idx)
            }
        }
        (DomainValue::Boolean(b), None) => CellValue::Boolean(*b),
        (DomainValue::Error(CellError::Num, _), None) if authored_numeric_value.is_some() => {
            // See formula branch above: emit the authored numeric lexeme, not
            // an OOXML error cell, when the domain metadata proves the source
            // cell was an untyped non-finite numeric value.
            CellValue::Number(0.0)
        }
        (DomainValue::Error(e, _), None) => CellValue::Error(e.as_str().to_string()),
        // Null / Array / anything else → empty
        _ => CellValue::Empty,
    };

    // Map formula_result_type to the OOXML type string for round-trip fidelity.
    // This preserves t="str" / t="e" / t="b" on formula cells with no cached value.
    let formula_type_hint = cell.formula_result_type.and_then(|t| match t {
        6 => Some("str".to_string()), // CELL_TYPE_FORMULA_STRING
        4 => Some("e".to_string()),   // CELL_TYPE_ERROR
        3 => Some("b".to_string()),   // CELL_TYPE_BOOL
        _ => None,
    });

    CellData {
        row: cell.row,
        col: cell.col,
        value,
        style_index,
        // For formula cells with explicit empty <v/>, use "" as original_value
        // so the writer emits <v></v> (equivalent to <v/>) instead of <v>0</v>.
        original_value: if cell.has_empty_cached_value {
            Some(String::new())
        } else {
            authored_numeric_value
        },
        force_recalc: false,
        cm: emit_cell_metadata_refs && cell.cm,
        vm: emit_cell_metadata_refs.then_some(cell.vm).flatten(),
        preserve_space_formula: false,
        preserve_space_value: false,
        explicit_type: if is_empty_string_cell {
            Some("s".to_string())
        } else {
            None
        },
        formula_type_hint,
    }
}

fn current_rich_string(cell: &DomainCellData, text: &str) -> Option<domain_types::RichSharedString> {
    let rich = cell.rich_string.as_ref()?;
    (rich.plain_text == text).then(|| rich.clone())
}

fn matching_authored_numeric_value(cell: &DomainCellData) -> Option<String> {
    let original = cell.original_value.as_ref()?;
    let parsed = original.parse::<f64>().ok()?;

    match &cell.value {
        DomainValue::Number(current) if parsed.is_finite() && parsed == current.get() => {
            Some(original.clone())
        }
        DomainValue::Error(CellError::Num, _) if !parsed.is_finite() => Some(original.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use value_types::FiniteF64;

    fn text_cell(value: &str, original_sst_index: Option<u32>) -> DomainCellData {
        DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Text(Arc::from(value)),
            original_sst_index,
            original_value: original_sst_index.map(|idx| idx.to_string()),
            ..Default::default()
        }
    }

    fn number_cell(value: f64, original_value: Option<&str>) -> DomainCellData {
        DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Number(FiniteF64::must(value)),
            original_value: original_value.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn original_numeric_value_is_preserved_when_it_matches_current_value() {
        let mut shared_strings = SharedStringsWriter::new();
        let converted = convert_cell(
            &number_cell(7.039265000250605e27, Some("7.039265000250605e+27")),
            &mut shared_strings,
        );

        assert_eq!(
            converted.original_value.as_deref(),
            Some("7.039265000250605e+27")
        );
    }

    #[test]
    fn authored_non_finite_numeric_value_is_preserved_for_canonical_num_error() {
        let mut shared_strings = SharedStringsWriter::new();
        let cell = DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Error(CellError::Num, None),
            original_value: Some("NaN".to_string()),
            ..Default::default()
        };

        let converted = convert_cell(&cell, &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::Number(_)));
        assert_eq!(converted.original_value.as_deref(), Some("NaN"));
    }

    #[test]
    fn stale_non_finite_numeric_value_is_ignored_for_non_num_error() {
        let mut shared_strings = SharedStringsWriter::new();
        let cell = DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Error(CellError::Value, None),
            original_value: Some("NaN".to_string()),
            ..Default::default()
        };

        let converted = convert_cell(&cell, &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::Error(e) if e == "#VALUE!"));
        assert_eq!(converted.original_value, None);
    }

    #[test]
    fn stale_original_numeric_value_is_ignored() {
        let mut shared_strings = SharedStringsWriter::new();
        let converted = convert_cell(&number_cell(2.0, Some("1.0")), &mut shared_strings);

        assert_eq!(converted.original_value, None);
    }

    #[test]
    fn original_sst_index_preserves_empty_shared_string_cell() {
        let mut shared_strings = SharedStringsWriter::with_capacity(1);
        shared_strings.add_imported_hint(0, "", None, None);
        let converted = convert_cell(&text_cell("", Some(0)), &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::String(0)));
        assert_eq!(converted.explicit_type, None);
        assert_eq!(shared_strings.total_count(), 1);
    }

    #[test]
    fn original_sst_index_out_of_range_falls_back() {
        let mut shared_strings = SharedStringsWriter::with_capacity(1);
        shared_strings.add_imported_hint(0, "old", None, None);
        let converted = convert_cell(&text_cell("current", Some(99)), &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::String(0)));
        assert!(!matches!(&converted.value, CellValue::String(99)));
    }

    #[test]
    fn original_sst_index_text_mismatch_falls_back() {
        let mut shared_strings = SharedStringsWriter::with_capacity(1);
        shared_strings.add_imported_hint(0, "old", None, None);
        let converted = convert_cell(&text_cell("new", Some(0)), &mut shared_strings);

        assert!(matches!(&converted.value, CellValue::String(0)));
    }

    #[test]
    fn explicit_empty_formula_cached_value_converts_to_empty_original_value() {
        let mut shared_strings = SharedStringsWriter::new();
        let cell = DomainCellData {
            row: 0,
            col: 0,
            value: DomainValue::Null,
            formula: Some("A2".to_string()),
            has_empty_cached_value: true,
            ..Default::default()
        };

        let converted = convert_cell(&cell, &mut shared_strings);

        assert_eq!(converted.original_value.as_deref(), Some(""));
        assert!(matches!(
            converted.value,
            CellValue::Formula {
                cached_value: Some(_),
                ..
            }
        ));
    }
}

/// Apply outline groups to the sheet writer.
///
/// Each `OutlineGroup` defines a range of rows or columns with a nesting level.
/// This function computes the max outline level per row/col across all groups,
/// then sets outline_level, hidden, and collapsed attributes on each row/col.
///
/// For collapsed groups, the OOXML spec says: the row/col *after* the group end
/// gets `collapsed="1"`. Rows/cols within a hidden group get `hidden="1"`.
/// Apply outline groups to the sheet writer — rows only.
/// Column outline levels are handled during column coalescing in `build_sheet`.
pub(super) fn apply_outline_groups_rows_only(writer: &mut SheetWriter, groups: &[OutlineGroup]) {
    use std::collections::HashMap;

    let mut row_levels: HashMap<u32, u8> = HashMap::new();
    let mut row_hidden: HashMap<u32, bool> = HashMap::new();
    let mut row_collapsed: HashMap<u32, bool> = HashMap::new();

    let mut max_row_level: u8 = 0;

    for group in groups {
        if !group.is_row {
            continue;
        }
        let level = (group.level as u8).min(7); // OOXML max is 7
        max_row_level = max_row_level.max(level);
        for r in group.start..=group.end {
            let entry = row_levels.entry(r).or_insert(0);
            *entry = (*entry).max(level);
            if group.hidden {
                row_hidden.insert(r, true);
            }
        }
        if group.collapsed {
            if group.collapsed_on_member {
                for r in group.start..=group.end {
                    row_collapsed.insert(r, true);
                }
            } else {
                row_collapsed.insert(group.end + 1, true);
            }
        }
    }

    // Apply row outline attributes
    for (&row, &level) in &row_levels {
        writer.set_row_outline_level(row, level);
    }
    for (&row, &hidden) in &row_hidden {
        if hidden {
            writer.set_row_hidden(row, true);
        }
    }
    for (&row, &collapsed) in &row_collapsed {
        writer.set_row_collapsed(row, collapsed);
    }

    if max_row_level > 0 {
        writer.set_sheet_format_outline_level_row(max_row_level);
    }
}
