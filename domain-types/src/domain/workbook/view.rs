//! Workbook window and visibility settings.

use serde::{Deserialize, Serialize};

// ============================================================================
// Workbook View Visibility
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookViewVisibility {
    #[default]
    Visible,
    Hidden,
    VeryHidden,
}

// ============================================================================
// Workbook View (unified from 3 scattered definitions)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookView {
    pub active_tab: u32,
    pub first_sheet: u32,
    pub visibility: WorkbookViewVisibility,
    pub minimized: bool,

    // Scrollbars & tabs
    pub show_horizontal_scroll: bool,
    pub show_vertical_scroll: bool,
    pub show_sheet_tabs: bool,
    pub auto_filter_date_grouping: bool,

    // Window geometry
    pub x_window: Option<i32>,
    pub y_window: Option<i32>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    /// Tab strip width ratio in permille (default 600 = 60%). None means not specified in source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_ratio: Option<f64>,

    // Round-trip
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uid: Option<String>,
    #[serde(default, skip)]
    pub ext_lst_raw: Option<String>,
}

impl Default for WorkbookView {
    fn default() -> Self {
        Self {
            active_tab: 0,
            first_sheet: 0,
            visibility: WorkbookViewVisibility::Visible,
            minimized: false,
            show_horizontal_scroll: true,
            show_vertical_scroll: true,
            show_sheet_tabs: true,
            auto_filter_date_grouping: true,
            x_window: None,
            y_window: None,
            window_width: None,
            window_height: None,
            tab_ratio: None,
            uid: None,
            ext_lst_raw: None,
        }
    }
}
