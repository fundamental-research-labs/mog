//! Workbook-level OOXML properties.

use serde::{Deserialize, Serialize};

// ============================================================================
// Object Display Mode
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ObjectDisplayMode {
    #[default]
    All,
    Placeholders,
    None,
}

// ============================================================================
// Update Links
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateLinks {
    #[default]
    UserSet,
    Never,
    Always,
}

// ============================================================================
// Workbook Properties (full OOXML CT_WorkbookPr — all 18 fields)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookProperties {
    pub date1904: bool,
    pub show_objects: ObjectDisplayMode,
    pub show_border_unselected_tables: bool,
    pub filter_privacy: bool,
    pub prompted_solutions: bool,
    pub show_ink_annotation: bool,
    pub backup_file: bool,
    pub save_external_link_values: bool,
    pub update_links: UpdateLinks,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_name: Option<String>,
    pub hide_pivot_field_list: bool,
    pub show_pivot_chart_filter: bool,
    pub allow_refresh_query: bool,
    pub publish_items: bool,
    pub check_compatibility: bool,
    pub auto_compress_pictures: bool,
    pub refresh_all_connections: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_theme_version: Option<u32>,
}

impl Default for WorkbookProperties {
    fn default() -> Self {
        Self {
            date1904: false,
            show_objects: ObjectDisplayMode::All,
            show_border_unselected_tables: true,
            filter_privacy: false,
            prompted_solutions: false,
            show_ink_annotation: true,
            backup_file: false,
            save_external_link_values: true,
            update_links: UpdateLinks::UserSet,
            code_name: None,
            hide_pivot_field_list: false,
            show_pivot_chart_filter: false,
            allow_refresh_query: false,
            publish_items: false,
            check_compatibility: false,
            auto_compress_pictures: true,
            refresh_all_connections: false,
            default_theme_version: None,
        }
    }
}
