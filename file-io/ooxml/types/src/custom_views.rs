//! Custom view types (ECMA-376 Part 1, Section 18.2 / 18.3).
//!
//! Types modelling custom workbook views, custom sheet views, and custom
//! properties used for per-user view persistence.

// ============================================================================
// ShowComments — ST_Comments
// ============================================================================

/// Comment display mode (ST_Comments).
///
/// Controls how comments are displayed in a custom view.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum ShowComments {
    /// No comments displayed.
    #[xml("commNone")]
    None,
    /// Show comment indicator only (small triangle) -- XSD default.
    #[default]
    #[xml("commIndicator")]
    Indicator,
    /// Show both indicator and comment text.
    #[xml("commIndAndComment")]
    IndicatorAndComment,
}

// ============================================================================
// CustomWorkbookView — CT_CustomWorkbookView
// ============================================================================

/// Custom workbook view (CT_CustomWorkbookView).
///
/// A named, per-user workbook window configuration with independent display
/// settings, window position, and active sheet selection.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomWorkbookView {
    /// Display name for this custom view (required).
    pub name: String,
    /// GUID identifying this custom view (required).
    pub guid: String,
    /// Whether to auto-update the view. Default: `false`.
    pub auto_update: bool,
    /// Merge interval in minutes for shared workbook updates.
    pub merge_interval: Option<u32>,
    /// Whether unsaved changes exist for this view. Default: `false`.
    pub change_saved_state: bool,
    /// Whether to synchronise only. Default: `false`.
    pub only_sync: bool,
    /// Whether this is a personal (non-shared) view. Default: `false`.
    pub personal_view: bool,
    /// Whether to include print settings. Default: `true`.
    pub include_print_settings: bool,
    /// Whether to include hidden rows and columns. Default: `true`.
    pub include_hidden_rows_cols: bool,
    /// Whether the window is maximised. Default: `false`.
    pub maximize: bool,
    /// Whether the window is minimised. Default: `false`.
    pub minimize: bool,
    /// Whether to show the horizontal scroll bar. Default: `true`.
    pub show_horizontal_scroll: bool,
    /// Whether to show the vertical scroll bar. Default: `true`.
    pub show_vertical_scroll: bool,
    /// Whether to show sheet tabs. Default: `true`.
    pub show_sheet_tabs: bool,
    /// X position of the window.
    pub x_window: Option<i32>,
    /// Y position of the window.
    pub y_window: Option<i32>,
    /// Width of the window (required).
    pub window_width: u32,
    /// Height of the window (required).
    pub window_height: u32,
    /// Ratio of the sheet-tab bar width to the horizontal scroll bar width. Default: 600.
    pub tab_ratio: Option<u32>,
    /// Index of the active sheet in this view (required).
    pub active_sheet_id: u32,
    /// Whether to show the formula bar. Default: `true`.
    pub show_formula_bar: bool,
    /// Whether to show the status bar. Default: `true`.
    pub show_status_bar: bool,
    /// Comment display mode. Default: None (commNone).
    pub show_comments: ShowComments,
    /// Object display mode. Default: All.
    pub show_objects: crate::workbook::ObjectDisplayMode,
    /// Extension list for vendor-specific data.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for CustomWorkbookView {
    fn default() -> Self {
        Self {
            name: String::new(),
            guid: String::new(),
            auto_update: false,
            merge_interval: None,
            change_saved_state: false,
            only_sync: false,
            personal_view: false,
            include_print_settings: true,
            include_hidden_rows_cols: true,
            maximize: false,
            minimize: false,
            show_horizontal_scroll: true,
            show_vertical_scroll: true,
            show_sheet_tabs: true,
            x_window: None,
            y_window: None,
            window_width: 0,
            window_height: 0,
            tab_ratio: Some(600),
            active_sheet_id: 0,
            show_formula_bar: true,
            show_status_bar: true,
            show_comments: ShowComments::Indicator,
            show_objects: crate::workbook::ObjectDisplayMode::All,
            ext_lst: None,
        }
    }
}

// ============================================================================
// CustomSheetView — CT_CustomSheetView
// ============================================================================

/// Custom sheet view (CT_CustomSheetView).
///
/// A per-user view configuration for a worksheet with independent display
/// settings such as zoom, grid lines, and visibility state.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CustomSheetView {
    /// GUID identifying this custom view (required).
    pub guid: String,
    /// Zoom percentage (10–400). Default: 100.
    pub scale: Option<u32>,
    /// Colour ID for the sheet tab. Default: 64.
    pub color_id: Option<u32>,
    /// Whether to show page breaks. Default: `false`.
    pub show_page_breaks: bool,
    /// Whether to show formulas instead of values. Default: `false`.
    pub show_formulas: bool,
    /// Whether to show grid lines. Default: `true`.
    pub show_grid_lines: bool,
    /// Whether to show row and column headers. Default: `true`.
    pub show_row_col: bool,
    /// Whether to show outline symbols. Default: `true`.
    pub outline_symbols: bool,
    /// Whether to show zero values. Default: `true`.
    pub zero_values: bool,
    /// Whether to fit the sheet to the page. Default: `false`.
    pub fit_to_page: bool,
    /// Whether a print area is defined. Default: `false`.
    pub print_area: bool,
    /// Whether a filter is active. Default: `false`.
    pub filter: bool,
    /// Whether to show auto-filter drop-downs. Default: `false`.
    pub show_auto_filter: bool,
    /// Whether hidden rows are present. Default: `false`.
    pub hidden_rows: bool,
    /// Whether hidden columns are present. Default: `false`.
    pub hidden_columns: bool,
    /// Visibility state of the sheet. Default: Visible.
    pub state: crate::workbook::SheetState,
    /// Whether the filter shows only unique values. Default: `false`.
    pub filter_unique: bool,
    /// View type (ST_SheetViewType): "normal", "pageBreakPreview", "pageLayout".
    pub view: Option<String>,
    /// Whether to show the ruler in page-layout view. Default: `true`.
    pub show_ruler: bool,
    /// Top-left cell reference for the view pane.
    pub top_left_cell: Option<String>,
    /// Pane split settings (CT_Pane).
    pub pane: Option<crate::worksheet::SheetPane>,
    /// Selection state (CT_Selection).
    pub selection: Option<crate::worksheet::Selection>,
    /// Row page breaks (CT_PageBreak).
    pub row_breaks: Option<crate::print::PageBreak>,
    /// Column page breaks (CT_PageBreak).
    pub col_breaks: Option<crate::print::PageBreak>,
    /// Page margin settings (CT_PageMargins).
    pub page_margins: Option<crate::print::PageMargins>,
    /// Print options (CT_PrintOptions).
    pub print_options: Option<crate::print::PrintOptions>,
    /// Page setup (CT_PageSetup).
    pub page_setup: Option<crate::print::PageSetup>,
    /// Header and footer settings (CT_HeaderFooter).
    pub header_footer: Option<crate::print::HeaderFooter>,
    /// Auto-filter settings (CT_AutoFilter).
    pub auto_filter: Option<crate::worksheet::AutoFilter>,
    /// Extension list for vendor-specific data.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for CustomSheetView {
    fn default() -> Self {
        Self {
            guid: String::new(),
            scale: Some(100),
            color_id: Some(64),
            show_page_breaks: false,
            show_formulas: false,
            show_grid_lines: true,
            show_row_col: true,
            outline_symbols: true,
            zero_values: true,
            fit_to_page: false,
            print_area: false,
            filter: false,
            show_auto_filter: false,
            hidden_rows: false,
            hidden_columns: false,
            state: crate::workbook::SheetState::Visible,
            filter_unique: false,
            view: None,
            show_ruler: true,
            top_left_cell: None,
            pane: None,
            selection: None,
            row_breaks: None,
            col_breaks: None,
            page_margins: None,
            print_options: None,
            page_setup: None,
            header_footer: None,
            auto_filter: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// CustomProperty — CT_CustomProperty
// ============================================================================

/// Custom property (CT_CustomProperty).
///
/// Associates a named property with a relationship target.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomProperty {
    /// Property name (required).
    pub name: String,
    /// Relationship ID to the property data (required).
    pub r_id: String,
}

// ============================================================================
// CustomProperties — CT_CustomProperties (wrapper)
// ============================================================================

/// Collection of custom properties (CT_CustomProperties).
///
/// Wrapper around a list of [`CustomProperty`] entries.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct CustomProperties {
    /// Custom property entries.
    pub properties: Vec<CustomProperty>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- ShowComments enum ---

    #[test]
    fn show_comments_roundtrip() {
        let variants = [
            (ShowComments::None, "commNone"),
            (ShowComments::Indicator, "commIndicator"),
            (ShowComments::IndicatorAndComment, "commIndAndComment"),
        ];
        for (variant, s) in &variants {
            assert_eq!(ShowComments::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                ShowComments::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
            assert_eq!(variant.as_str(), *s, "as_str for {s}");
        }
    }

    #[test]
    fn show_comments_unknown_defaults() {
        // `#[default]` is on `Indicator` (the XSD default), so XmlEnum's
        // `_ => Self::default()` fallback yields `Indicator` on unknown
        // tokens. The original hand-written parser returned `None` on
        // unknown; that behavior changed (silently) with the xml-derive
        // migration, and this test's prior assertion was never updated.
        assert_eq!(ShowComments::from_ooxml("bogus"), ShowComments::Indicator);
        assert_eq!(ShowComments::from_bytes(b"bogus"), ShowComments::Indicator);
    }

    // --- CustomWorkbookView ---

    #[test]
    fn custom_workbook_view_defaults() {
        let v = CustomWorkbookView::default();
        assert!(v.name.is_empty());
        assert!(v.guid.is_empty());
        assert!(!v.auto_update);
        assert!(v.merge_interval.is_none());
        assert!(!v.change_saved_state);
        assert!(!v.only_sync);
        assert!(!v.personal_view);
        assert!(v.include_print_settings);
        assert!(v.include_hidden_rows_cols);
        assert!(!v.maximize);
        assert!(!v.minimize);
        assert!(v.show_horizontal_scroll);
        assert!(v.show_vertical_scroll);
        assert!(v.show_sheet_tabs);
        assert!(v.x_window.is_none());
        assert!(v.y_window.is_none());
        assert_eq!(v.window_width, 0);
        assert_eq!(v.window_height, 0);
        assert_eq!(v.tab_ratio, Some(600));
        assert_eq!(v.active_sheet_id, 0);
        assert!(v.show_formula_bar);
        assert!(v.show_status_bar);
        assert_eq!(v.show_comments, ShowComments::Indicator);
        assert_eq!(v.show_objects, crate::workbook::ObjectDisplayMode::All);
        assert!(v.ext_lst.is_none());
    }

    // --- CustomSheetView ---

    #[test]
    fn custom_sheet_view_defaults() {
        let v = CustomSheetView::default();
        assert!(v.guid.is_empty());
        assert_eq!(v.scale, Some(100));
        assert_eq!(v.color_id, Some(64));
        assert!(!v.show_page_breaks);
        assert!(!v.show_formulas);
        assert!(v.show_grid_lines);
        assert!(v.show_row_col);
        assert!(v.outline_symbols);
        assert!(v.zero_values);
        assert!(!v.fit_to_page);
        assert!(!v.print_area);
        assert!(!v.filter);
        assert!(!v.show_auto_filter);
        assert!(!v.hidden_rows);
        assert!(!v.hidden_columns);
        assert_eq!(v.state, crate::workbook::SheetState::Visible);
        assert!(!v.filter_unique);
        assert!(v.view.is_none());
        assert!(v.show_ruler);
        assert!(v.top_left_cell.is_none());
        assert!(v.pane.is_none());
        assert!(v.selection.is_none());
        assert!(v.row_breaks.is_none());
        assert!(v.col_breaks.is_none());
        assert!(v.page_margins.is_none());
        assert!(v.print_options.is_none());
        assert!(v.page_setup.is_none());
        assert!(v.header_footer.is_none());
        assert!(v.auto_filter.is_none());
        assert!(v.ext_lst.is_none());
    }

    // --- CustomProperty ---

    #[test]
    fn custom_property_defaults() {
        let p = CustomProperty::default();
        assert!(p.name.is_empty());
        assert!(p.r_id.is_empty());
    }

    // --- CustomProperties ---

    #[test]
    fn custom_properties_default() {
        let cp = CustomProperties::default();
        assert!(cp.properties.is_empty());
    }
}
