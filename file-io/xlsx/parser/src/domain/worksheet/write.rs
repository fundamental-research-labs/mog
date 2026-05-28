//! Worksheet structural XML write helpers.
//!
//! This module contains the write-side counterparts to the parse functions in
//! `domain/worksheet/read.rs`.  Each function writes one structural section of
//! a `xl/worksheets/sheetN.xml` file:
//!
//! | Function | XML element |
//! |---|---|
//! | [`write_dimensions`] | `<dimension>` |
//! | [`write_sheet_views`] | `<sheetViews>` / frozen panes |
//! | [`write_sheet_format_pr`] | `<sheetFormatPr>` |
//! | [`write_cols`] | `<cols>` |
//! | [`write_merge_cells`] | `<mergeCells>` |
//!
//! These helpers are called by `write/sheet.rs` during worksheet orchestration.
//! The orchestrator owns the `<sheetData>` cell iteration loop and calls these
//! helpers for the surrounding structural sections.

use crate::domain::print::write::format_f64;
use crate::infra::a1::to_a1;
use crate::write::sheet::SheetFormatPr;
use crate::write::xml_writer::XmlWriter;
use ooxml_types::worksheet::{
    ColWidth, MergeRange, OutlineProperties, Selection, SheetPane, SheetView,
};

// ============================================================================
// Public write helpers
// ============================================================================

/// Write the `<dimension>` element.
///
/// `dimension` is the pre-computed dimension `(start_row, start_col, end_row,
/// end_col)` in 0-indexed coordinates. Empty sheets emit the canonical `A1`
/// extent instead of relying on imported worksheet dimension text.
pub fn write_dimensions(w: &mut XmlWriter, dimension: Option<(u32, u32, u32, u32)>) {
    let (start_row, start_col, end_row, end_col) = dimension.unwrap_or((0, 0, 0, 0));
    let start_ref = to_a1(start_row, start_col);
    let end_ref = to_a1(end_row, end_col);
    let ref_str = if start_ref == end_ref {
        start_ref
    } else {
        format!("{start_ref}:{end_ref}")
    };
    w.start_element("dimension")
        .attr("ref", &ref_str)
        .self_close();
}

/// Write modeled worksheet properties currently represented in `SheetData`.
pub fn write_sheet_properties(w: &mut XmlWriter, outline_properties: Option<&OutlineProperties>) {
    let Some(outline_properties) = outline_properties else {
        return;
    };

    w.start_element("sheetPr").end_attrs();
    w.start_element("outlinePr");
    if outline_properties.apply_styles {
        w.attr("applyStyles", "1");
    }
    if !outline_properties.summary_below {
        w.attr("summaryBelow", "0");
    }
    if !outline_properties.summary_right {
        w.attr("summaryRight", "0");
    }
    if !outline_properties.show_outline_symbols {
        w.attr("showOutlineSymbols", "0");
    }
    w.self_close();
    w.end_element("sheetPr");
}

/// Write the `<sheetViews>` element including frozen-pane and selection children.
///
/// Accepts a slice of `SheetView` to support multiple `<sheetView>` elements for
/// round-trip fidelity. If the slice is empty, a single default view is emitted.
pub fn write_sheet_views(w: &mut XmlWriter, views: &[SheetView]) {
    let default_view = SheetView::default();
    let effective_views: &[SheetView] = if views.is_empty() {
        std::slice::from_ref(&default_view)
    } else {
        views
    };

    w.start_element("sheetViews").end_attrs();

    for sv in effective_views {
        write_single_sheet_view(w, sv);
    }

    w.end_element("sheetViews");
}

/// Write a single `<sheetView>` element with all its attributes and children.
fn write_single_sheet_view(w: &mut XmlWriter, sv: &SheetView) {
    w.start_element("sheetView");

    // Attributes in ECMA-376 canonical order (CT_SheetView):
    if sv.window_protection {
        w.attr("windowProtection", "1");
    }
    if sv.show_formulas {
        w.attr("showFormulas", "1");
    }
    if !sv.show_grid_lines {
        w.attr("showGridLines", "0");
    }
    if !sv.show_row_col_headers {
        w.attr("showRowColHeaders", "0");
    }
    if !sv.show_zeros {
        w.attr("showZeros", "0");
    }
    if sv.right_to_left {
        w.attr("rightToLeft", "1");
    }
    if sv.tab_selected {
        w.attr("tabSelected", "1");
    }
    if !sv.show_ruler {
        w.attr("showRuler", "0");
    }
    if !sv.show_outline_symbols {
        w.attr("showOutlineSymbols", "0");
    }
    if !sv.default_grid_color {
        w.attr("defaultGridColor", "0");
    }
    if !sv.show_white_space {
        w.attr("showWhiteSpace", "0");
    }
    // View type — omit when normal (spec default)
    if !sv.view.is_default() {
        w.attr("view", sv.view.to_ooxml());
    }
    // Top-left cell
    if let Some(ref tlc) = sv.top_left_cell {
        w.attr("topLeftCell", tlc);
    }
    // colorId — only emit when non-default (64 is the spec default)
    if sv.color_id != 64 {
        w.attr_num("colorId", sv.color_id);
    }
    // Zoom scales — only emit when non-default
    if sv.zoom_scale != 100 {
        w.attr_num("zoomScale", sv.zoom_scale);
    }
    if sv.zoom_scale_normal != 0 {
        w.attr_num("zoomScaleNormal", sv.zoom_scale_normal);
    }
    if let Some(zoom) = sv.zoom_scale_page_layout_view {
        w.attr_num("zoomScalePageLayoutView", zoom);
    }
    if let Some(zoom) = sv.zoom_scale_sheet_layout_view {
        w.attr_num("zoomScaleSheetLayoutView", zoom);
    }
    // workbookViewId — always required, last attribute per spec
    w.attr_num("workbookViewId", sv.workbook_view_id);

    // Determine whether there are any child elements.
    let has_children = sv.pane.is_some() || !sv.selections.is_empty();

    if !has_children {
        // No children — emit self-closing form to match Excel's output.
        w.self_close();
    } else {
        w.end_attrs();

        // Pane child element
        if let Some(ref pane) = sv.pane {
            write_pane(w, pane);
        }

        // Selection child elements
        if !sv.selections.is_empty() {
            for sel in &sv.selections {
                write_selection(w, sel);
            }
        }

        w.end_element("sheetView");
    }
}

/// Write the `<sheetFormatPr>` element.
pub fn write_sheet_format_pr(w: &mut XmlWriter, fmt: &SheetFormatPr) {
    w.start_element("sheetFormatPr");

    if let Some(bcw) = fmt.base_col_width {
        w.attr_num("baseColWidth", bcw);
    }
    if let Some(dcw) = fmt.default_col_width {
        w.attr("defaultColWidth", &format_f64(dcw));
    }
    w.attr("defaultRowHeight", &format_f64(fmt.default_row_height));

    if fmt.custom_height {
        w.attr("customHeight", "1");
    }
    if fmt.zero_height {
        w.attr("zeroHeight", "1");
    }
    if let Some(lvl) = fmt.outline_level_row {
        if lvl > 0 {
            w.attr_num("outlineLevelRow", lvl as u32);
        }
    }
    if let Some(lvl) = fmt.outline_level_col {
        if lvl > 0 {
            w.attr_num("outlineLevelCol", lvl as u32);
        }
    }

    if let Some(descent) = fmt.default_row_descent {
        w.attr("x14ac:dyDescent", &format_f64(descent));
    }

    w.self_close();
}

/// Write the `<cols>` element.  Does nothing if `cols` is empty.
pub fn write_cols(w: &mut XmlWriter, cols: &[ColWidth]) {
    if cols.is_empty() {
        return;
    }

    w.start_element("cols").end_attrs();

    for col in cols {
        w.start_element("col")
            .attr_num("min", col.min)
            .attr_num("max", col.max)
            .attr("width", &format_f64(col.width.unwrap_or(0.0)));

        // Emit attributes in Excel's canonical order:
        // min, max, width, style, hidden, bestFit, customWidth, outlineLevel, collapsed
        if let Some(style) = col.style {
            w.attr_num("style", style);
        }
        if col.hidden {
            w.attr("hidden", "1");
        }
        if col.best_fit {
            w.attr("bestFit", "1");
        }
        if col.custom_width {
            w.attr("customWidth", "1");
        }
        if let Some(lvl) = col.outline_level {
            if lvl > 0 {
                w.attr_num("outlineLevel", lvl as u32);
            }
        }
        if col.collapsed {
            w.attr("collapsed", "1");
        }

        w.self_close();
    }

    w.end_element("cols");
}

/// Write the `<mergeCells>` element.  Does nothing if `merges` is empty.
///
/// The writer always emits the optional `count="N"` attribute canonically
/// instead of preserving imported lexical variance.
pub fn write_merge_cells(w: &mut XmlWriter, merges: &[MergeRange]) {
    if merges.is_empty() {
        return;
    }

    w.start_element("mergeCells");
    w.attr("count", &merges.len().to_string());
    w.end_attrs();

    for merge in merges {
        w.start_element("mergeCell")
            .attr("ref", merge.to_ref())
            .self_close();
    }

    w.end_element("mergeCells");
}

// ============================================================================
// Private helpers
// ============================================================================

/// Write a single `<pane>` element inside `<sheetView>`.
fn write_pane(w: &mut XmlWriter, pane: &SheetPane) {
    w.start_element("pane");

    // For frozen panes, write integer values; for splits, write f64.
    if pane.x_split != 0.0 {
        if pane.is_frozen() {
            w.attr_num("xSplit", pane.cols());
        } else {
            w.attr_num("xSplit", pane.x_split);
        }
    }
    if pane.y_split != 0.0 {
        if pane.is_frozen() {
            w.attr_num("ySplit", pane.rows());
        } else {
            w.attr_num("ySplit", pane.y_split);
        }
    }

    if let Some(ref tlc) = pane.top_left_cell {
        w.attr("topLeftCell", tlc);
    }
    w.attr("activePane", pane.effective_active_pane().to_ooxml());
    w.attr("state", pane.effective_state().to_ooxml());
    w.self_close();
}

/// Write a single `<selection>` element inside `<sheetView>`.
fn write_selection(w: &mut XmlWriter, sel: &Selection) {
    w.start_element("selection");
    // Only emit pane when explicitly set (default is topLeft, omitting matches original).
    if let Some(pane) = sel.pane {
        w.attr("pane", pane.to_ooxml());
    }
    if let Some(ref ac) = sel.active_cell {
        w.attr("activeCell", ac);
    }
    if let Some(id) = sel.active_cell_id {
        w.attr_num("activeCellId", id);
    }
    if let Some(ref sq) = sel.sqref {
        w.attr("sqref", sq);
    }
    w.self_close();
}

#[cfg(test)]
mod tests {
    use super::*;
    use ooxml_types::worksheet::ColWidth;

    #[test]
    fn test_write_cols_with_style() {
        let mut w = XmlWriter::new();
        let cols = vec![ColWidth::range(1, 9, 9.0).with_style(15)];
        write_cols(&mut w, &cols);
        let xml = String::from_utf8(w.into_bytes()).unwrap();
        assert!(
            xml.contains("style=\"15\""),
            "Expected style=\"15\" in output, got: {xml}"
        );
    }

    #[test]
    fn test_write_cols_without_style() {
        let mut w = XmlWriter::new();
        let cols = vec![ColWidth::range(1, 9, 9.0)];
        write_cols(&mut w, &cols);
        let xml = String::from_utf8(w.into_bytes()).unwrap();
        assert!(
            !xml.contains("style="),
            "Expected no style attribute, got: {xml}"
        );
    }
}
