use serde::{Deserialize, Serialize};

/// Cross-filter behavior for slicer items.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CrossFilterMode {
    /// No cross-filtering.
    None,
    /// Items with data appear at top.
    ShowItemsWithDataAtTop,
    /// Show items even without data.
    ShowItemsWithNoData,
}

/// Sort order for slicer items. Wire format: "ascending" | "descending" | "dataSourceOrder".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerSortOrder {
    Ascending,
    Descending,
    DataSourceOrder,
}

/// Visual preset for slicer styling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SlicerStylePreset {
    Light1,
    Light2,
    Light3,
    Light4,
    Light5,
    Light6,
    Dark1,
    Dark2,
    Dark3,
    Dark4,
    Dark5,
    Dark6,
    Other1,
    Other2,
}

/// Custom visual properties for a slicer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerCustomStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header_font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_border_radius: Option<f64>,
}

/// A named slicer style stored in the workbook-level style registry.
///
/// These styles live in a workbook-scoped collection and can be applied to any
/// slicer by name, similar to named table styles.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NamedSlicerStyle {
    /// Unique style name (user-assigned).
    pub name: String,
    /// Whether this is a built-in style (cannot be deleted).
    pub read_only: bool,
    /// The style definition.
    pub style: SlicerCustomStyle,
}

/// Visual style configuration for a slicer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlicerStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset: Option<SlicerStylePreset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom: Option<SlicerCustomStyle>,
    pub column_count: i32,
    pub button_height: i32,
    pub show_selection_indicator: bool,
    pub cross_filter: CrossFilterMode,
    pub custom_list_sort: bool,
    pub show_items_with_no_data: bool,
    pub sort_order: SlicerSortOrder,
}
