use super::*;

/// Sheet view output, converted from the canonical `ooxml_types::worksheet::SheetView`.
///
/// Uses camelCase serialization for backward compatibility with TS consumers.
/// Only non-default values are serialized.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetViewOutput {
    #[serde(skip_serializing_if = "is_true")]
    pub show_grid_lines: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_row_col_headers: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub show_formulas: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_zeros: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub tab_selected: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub right_to_left: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_ruler: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_outline_symbols: bool,
    #[serde(skip_serializing_if = "is_true")]
    pub show_white_space: bool,
    #[serde(skip_serializing_if = "is_false")]
    pub window_protection: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_left_cell: Option<String>,
    #[serde(skip_serializing_if = "is_true")]
    pub default_grid_color: bool,
    #[serde(skip_serializing_if = "is_default_color_id")]
    pub color_id: u32,
    #[serde(skip_serializing_if = "is_default_zoom_scale")]
    pub zoom_scale: u32,
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub zoom_scale_normal: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale_page_layout_view: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_scale_sheet_layout_view: Option<u32>,
    pub workbook_view_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub view: Option<String>,
    /// Preserved pane configuration (frozen or split) for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane: Option<ooxml_types::worksheet::SheetPane>,
    /// Preserved selection elements for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selections: Vec<ooxml_types::worksheet::Selection>,
    /// Preserved pivotSelection elements for round-trip fidelity.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pivot_selection: Vec<ooxml_types::worksheet::PivotSelection>,
    /// Direct-child `<extLst>` XML owned by this view scope.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst_xml: Option<String>,
}

impl From<ooxml_types::worksheet::SheetView> for SheetViewOutput {
    fn from(sv: ooxml_types::worksheet::SheetView) -> Self {
        let view = if sv.view.is_default() {
            None
        } else {
            Some(sv.view.to_ooxml().to_string())
        };
        Self {
            show_grid_lines: sv.show_grid_lines,
            show_row_col_headers: sv.show_row_col_headers,
            show_formulas: sv.show_formulas,
            show_zeros: sv.show_zeros,
            tab_selected: sv.tab_selected,
            right_to_left: sv.right_to_left,
            show_ruler: sv.show_ruler,
            show_outline_symbols: sv.show_outline_symbols,
            show_white_space: sv.show_white_space,
            window_protection: sv.window_protection,
            top_left_cell: sv.top_left_cell,
            default_grid_color: sv.default_grid_color,
            color_id: sv.color_id,
            zoom_scale: sv.zoom_scale,
            zoom_scale_normal: sv.zoom_scale_normal,
            zoom_scale_page_layout_view: sv.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: sv.zoom_scale_sheet_layout_view,
            workbook_view_id: sv.workbook_view_id,
            view,
            pane: sv.pane,
            pivot_selection: sv.pivot_selection,
            selections: sv.selections,
            ext_lst_xml: sv.ext_lst_xml,
        }
    }
}

impl From<SheetViewOutput> for ooxml_types::worksheet::SheetView {
    fn from(sv: SheetViewOutput) -> Self {
        let view = sv
            .view
            .as_deref()
            .map(ooxml_types::worksheet::SheetViewType::from_ooxml)
            .unwrap_or_default();
        Self {
            show_grid_lines: sv.show_grid_lines,
            show_row_col_headers: sv.show_row_col_headers,
            show_formulas: sv.show_formulas,
            show_zeros: sv.show_zeros,
            tab_selected: sv.tab_selected,
            right_to_left: sv.right_to_left,
            show_ruler: sv.show_ruler,
            show_outline_symbols: sv.show_outline_symbols,
            show_white_space: sv.show_white_space,
            window_protection: sv.window_protection,
            top_left_cell: sv.top_left_cell,
            default_grid_color: sv.default_grid_color,
            color_id: sv.color_id,
            zoom_scale: sv.zoom_scale,
            zoom_scale_normal: sv.zoom_scale_normal,
            zoom_scale_page_layout_view: sv.zoom_scale_page_layout_view,
            zoom_scale_sheet_layout_view: sv.zoom_scale_sheet_layout_view,
            workbook_view_id: sv.workbook_view_id,
            view,
            pane: sv.pane,
            pivot_selection: sv.pivot_selection,
            selections: sv.selections,
            ext_lst_xml: sv.ext_lst_xml,
        }
    }
}
