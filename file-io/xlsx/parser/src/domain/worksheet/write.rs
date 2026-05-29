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
use ooxml_types::styles::ColorDef;
use ooxml_types::worksheet::{
    ColWidth, MergeRange, OutlineProperties, PageSetupProperties, Selection, SheetCalcPr,
    SheetPane, SheetProperties, SheetView,
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

/// Write the `<dimension>` element from an already-authored `ref` value.
pub fn write_dimension_ref(w: &mut XmlWriter, dimension_ref: &str) {
    w.start_element("dimension")
        .attr("ref", dimension_ref)
        .self_close();
}

/// Write modeled worksheet properties.
pub fn write_sheet_properties(w: &mut XmlWriter, sheet_properties: Option<&SheetProperties>) {
    let Some(sheet_properties) = sheet_properties else {
        return;
    };

    w.start_element("sheetPr");
    if sheet_properties.sync_horizontal {
        w.attr("syncHorizontal", "1");
    }
    if sheet_properties.sync_vertical {
        w.attr("syncVertical", "1");
    }
    if let Some(sync_ref) = &sheet_properties.sync_ref {
        w.attr("syncRef", sync_ref);
    }
    if sheet_properties.transition_evaluation {
        w.attr("transitionEvaluation", "1");
    }
    if sheet_properties.transition_entry {
        w.attr("transitionEntry", "1");
    }
    if !sheet_properties.published {
        w.attr("published", "0");
    }
    if let Some(code_name) = &sheet_properties.code_name {
        w.attr("codeName", code_name);
    }
    if sheet_properties.filter_mode {
        w.attr("filterMode", "1");
    }
    if !sheet_properties.enable_format_conditions_calculation {
        w.attr("enableFormatConditionsCalculation", "0");
    }
    w.end_attrs();

    if let Some(tab_color) = &sheet_properties.tab_color {
        write_color(w, "tabColor", tab_color);
    }
    if let Some(outline_properties) = &sheet_properties.outline_pr {
        write_outline_properties(w, outline_properties);
    }
    if let Some(page_setup_properties) = &sheet_properties.page_set_up_pr {
        write_page_setup_properties(w, page_setup_properties);
    }
    w.end_element("sheetPr");
}

fn write_outline_properties(w: &mut XmlWriter, outline_properties: &OutlineProperties) {
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
}

fn write_page_setup_properties(w: &mut XmlWriter, properties: &PageSetupProperties) {
    w.start_element("pageSetUpPr");
    if !properties.auto_page_breaks {
        w.attr("autoPageBreaks", "0");
    }
    if properties.fit_to_page {
        w.attr("fitToPage", "1");
    }
    w.self_close();
}

fn write_color(w: &mut XmlWriter, element_name: &str, color: &ColorDef) {
    w.start_element(element_name);
    match color {
        ColorDef::Indexed { id, tint } => {
            w.attr_num("indexed", *id);
            if let Some(tint) = tint {
                w.attr("tint", tint);
            }
        }
        ColorDef::Rgb { val, tint } => {
            w.attr("rgb", val);
            if let Some(tint) = tint {
                w.attr("tint", tint);
            }
        }
        ColorDef::Theme { id, tint } => {
            w.attr_num("theme", *id);
            if let Some(tint) = tint {
                w.attr("tint", tint);
            }
        }
        ColorDef::Auto { tint } => {
            w.attr("auto", "1");
            if let Some(tint) = tint {
                w.attr("tint", tint);
            }
        }
    }
    w.self_close();
}

/// Write the `<sheetViews>` element including frozen-pane and selection children.
///
/// Accepts a slice of `SheetView` to support multiple `<sheetView>` elements for
/// round-trip fidelity. If the slice is empty, a single default view is emitted.
pub fn write_sheet_views(w: &mut XmlWriter, views: &[SheetView], ext_lst_xml: Option<&str>) {
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

    if let Some(ext_lst_xml) = ext_lst_xml {
        w.raw_str(ext_lst_xml);
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
    let has_children = sv.pane.is_some()
        || !sv.pivot_selection.is_empty()
        || !sv.selections.is_empty()
        || sv.ext_lst_xml.is_some();

    if !has_children {
        // No children — emit self-closing form to match Excel's output.
        w.self_close();
    } else {
        w.end_attrs();

        // Pane child element
        if let Some(ref pane) = sv.pane {
            write_pane(w, pane);
        }

        for sel in &sv.pivot_selection {
            write_pivot_selection(w, sel);
        }

        // Selection child elements
        if !sv.selections.is_empty() {
            for sel in &sv.selections {
                write_selection(w, sel);
            }
        }

        if let Some(ext_lst_xml) = &sv.ext_lst_xml {
            w.raw_str(ext_lst_xml);
        }

        w.end_element("sheetView");
    }
}

/// Write typed worksheet calculation properties.
pub fn write_sheet_calc_pr(w: &mut XmlWriter, sheet_calc_pr: &SheetCalcPr) {
    w.start_element("sheetCalcPr");
    if sheet_calc_pr.full_calc_on_load {
        w.attr("fullCalcOnLoad", "1");
    }
    w.self_close();
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
    if fmt.thick_top {
        w.attr("thickTop", "1");
    }
    if fmt.thick_bottom {
        w.attr("thickBottom", "1");
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
            .attr_num("max", col.max);

        if let Some(width) = col.width {
            if let Some(width_str) = &col.width_str
                && width_str.parse::<f64>().ok() == Some(width)
            {
                w.attr("width", width_str);
            } else {
                w.attr("width", &format_f64(width));
            }
        }

        // Emit attributes in Excel's canonical order:
        // min, max, width, style, hidden, bestFit, customWidth, phonetic, outlineLevel, collapsed
        if let Some(style) = col.style {
            w.attr_num("style", style);
        }
        match col.hidden_attr {
            Some(true) => w.attr("hidden", "1"),
            Some(false) => w.attr("hidden", "0"),
            None if col.hidden => w.attr("hidden", "1"),
            None => w,
        };
        match col.best_fit_attr {
            Some(true) => w.attr("bestFit", "1"),
            Some(false) => w.attr("bestFit", "0"),
            None if col.best_fit => w.attr("bestFit", "1"),
            None => w,
        };
        match col.custom_width_attr {
            Some(true) => w.attr("customWidth", "1"),
            Some(false) => w.attr("customWidth", "0"),
            None if col.custom_width => w.attr("customWidth", "1"),
            None => w,
        };
        match col.phonetic_attr {
            Some(true) => w.attr("phonetic", "1"),
            Some(false) => w.attr("phonetic", "0"),
            None if col.phonetic => w.attr("phonetic", "1"),
            None => w,
        };
        if let Some(lvl) = col.outline_level {
            w.attr_num("outlineLevel", lvl as u32);
        }
        match col.collapsed_attr {
            Some(true) => w.attr("collapsed", "1"),
            Some(false) => w.attr("collapsed", "0"),
            None if col.collapsed => w.attr("collapsed", "1"),
            None => w,
        };

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

fn write_pivot_selection(w: &mut XmlWriter, sel: &ooxml_types::worksheet::PivotSelection) {
    w.start_element("pivotSelection");
    if let Some(pane) = sel.pane {
        w.attr("pane", pane.to_ooxml());
    }
    if sel.show_header {
        w.attr("showHeader", "1");
    }
    if sel.label {
        w.attr("label", "1");
    }
    if sel.data {
        w.attr("data", "1");
    }
    if sel.extendable {
        w.attr("extendable", "1");
    }
    if sel.count != 0 {
        w.attr_num("count", sel.count);
    }
    if let Some(axis) = sel.axis {
        w.attr("axis", axis.to_ooxml());
    }
    if sel.dimension != 0 {
        w.attr_num("dimension", sel.dimension);
    }
    if sel.start != 0 {
        w.attr_num("start", sel.start);
    }
    if sel.min != 0 {
        w.attr_num("min", sel.min);
    }
    if sel.max != 0 {
        w.attr_num("max", sel.max);
    }
    if sel.active_row != 0 {
        w.attr_num("activeRow", sel.active_row);
    }
    if sel.active_col != 0 {
        w.attr_num("activeCol", sel.active_col);
    }
    if sel.previous_row != 0 {
        w.attr_num("previousRow", sel.previous_row);
    }
    if sel.previous_col != 0 {
        w.attr_num("previousCol", sel.previous_col);
    }
    if sel.click != 0 {
        w.attr_num("click", sel.click);
    }
    if let Some(id) = &sel.id {
        w.attr("r:id", id);
    }
    if let Some(pivot_area) = &sel.pivot_area {
        w.end_attrs();
        w.raw_str(pivot_area);
        w.end_element("pivotSelection");
    } else {
        w.self_close();
    }
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
    use ooxml_types::styles::ColorDef;
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

    #[test]
    fn test_write_sheet_properties() {
        let mut props = SheetProperties {
            code_name: Some("SheetCode".to_string()),
            filter_mode: true,
            published: false,
            sync_horizontal: true,
            sync_vertical: true,
            sync_ref: Some("A1:B2".to_string()),
            transition_evaluation: true,
            transition_entry: true,
            enable_format_conditions_calculation: false,
            tab_color: Some(ColorDef::Rgb {
                val: "FFFF0000".to_string(),
                tint: None,
            }),
            page_set_up_pr: Some(PageSetupProperties {
                fit_to_page: true,
                auto_page_breaks: false,
            }),
            ..Default::default()
        };
        props.outline_pr = Some(OutlineProperties {
            apply_styles: true,
            summary_below: false,
            summary_right: false,
            show_outline_symbols: false,
        });

        let mut w = XmlWriter::new();
        write_sheet_properties(&mut w, Some(&props));
        let xml = String::from_utf8(w.into_bytes()).unwrap();

        assert!(xml.contains(r#"<sheetPr syncHorizontal="1" syncVertical="1" syncRef="A1:B2" transitionEvaluation="1" transitionEntry="1" published="0" codeName="SheetCode" filterMode="1" enableFormatConditionsCalculation="0">"#));
        assert!(xml.contains(r#"<tabColor rgb="FFFF0000"/>"#));
        assert!(xml.contains(r#"<outlinePr applyStyles="1" summaryBelow="0" summaryRight="0" showOutlineSymbols="0"/>"#));
        assert!(xml.contains(r#"<pageSetUpPr autoPageBreaks="0" fitToPage="1"/>"#));
    }
}
