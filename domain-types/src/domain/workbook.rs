use serde::{Deserialize, Serialize};

// Re-export HashAlgorithm so consumers don't need a direct ooxml_types dep
pub use ooxml_types::protection::HashAlgorithm;

// ============================================================================
// Calculation Mode
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalcMode {
    #[default]
    Auto,
    AutoNoTable,
    Manual,
}

// ============================================================================
// Reference Mode
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefMode {
    #[default]
    A1,
    R1C1,
}

// ============================================================================
// Calculation Properties (full OOXML CalcPr)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculationProperties {
    // Core iterative calc
    pub iterate: bool,
    pub iterate_count: u32,
    pub iterate_delta: f64,

    // Calc behavior
    pub calc_mode: CalcMode,
    pub full_calc_on_load: bool,
    pub ref_mode: RefMode,
    pub full_precision: bool,
    pub calc_completed: bool,
    pub calc_on_save: bool,

    // Concurrency
    pub concurrent_calc: bool,
    pub concurrent_manual_count: Option<u32>,

    // Engine state
    pub calc_id: Option<u32>,
    pub force_full_calc: bool,

    // Round-trip fidelity flags
    pub has_explicit_iterate_count: bool,
    pub has_explicit_iterate_delta: bool,
}

impl Default for CalculationProperties {
    fn default() -> Self {
        Self {
            iterate: false,
            iterate_count: 100,
            iterate_delta: 0.001,
            calc_mode: CalcMode::Auto,
            full_calc_on_load: false,
            ref_mode: RefMode::A1,
            full_precision: true,
            calc_completed: true,
            calc_on_save: true,
            concurrent_calc: true,
            concurrent_manual_count: None,
            calc_id: None,
            force_full_calc: false,
            has_explicit_iterate_count: false,
            has_explicit_iterate_delta: false,
        }
    }
}

// ============================================================================
// Workbook Protection (full OOXML CT_WorkbookProtection — all 15 fields)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookProtection {
    // Lock flags
    pub lock_structure: bool,
    pub lock_windows: bool,
    pub lock_revision: bool,

    // Modern workbook password (SHA-based)
    pub workbook_algorithm_name: HashAlgorithm,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_hash_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_salt_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_spin_count: Option<u32>,

    // Modern revisions password (SHA-based)
    pub revisions_algorithm_name: HashAlgorithm,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_hash_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_salt_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_spin_count: Option<u32>,

    // Legacy passwords (XOR/CRC hash, pre-2007)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_password_character_set: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revisions_password_character_set: Option<String>,
}

impl Default for WorkbookProtection {
    fn default() -> Self {
        Self {
            lock_structure: false,
            lock_windows: false,
            lock_revision: false,
            workbook_algorithm_name: HashAlgorithm::None,
            workbook_hash_value: None,
            workbook_salt_value: None,
            workbook_spin_count: None,
            revisions_algorithm_name: HashAlgorithm::None,
            revisions_hash_value: None,
            revisions_salt_value: None,
            revisions_spin_count: None,
            workbook_password: None,
            workbook_password_character_set: None,
            revisions_password: None,
            revisions_password_character_set: None,
        }
    }
}

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
        }
    }
}

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
// Web Publishing
// ============================================================================

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookWebPublishing {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thicket: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_file_names: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vml: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_png: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_screen_size: Option<ooxml_types::web_publish::TargetScreenSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dpi: Option<u32>,
}

// ============================================================================
// Mog Workbook Identity Metadata
// ============================================================================

pub const MOG_WORKBOOK_ID_CUSTOM_PROPERTY: &str = "MogWorkbookId";
pub const MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA: &str = "https://schemas.mog.com/workbook-identity/1";
pub const MOG_WORKBOOK_ID_CUSTOM_XML_REL_TYPE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookLineage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicated_from: Option<WorkbookId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copied_from: Option<WorkbookId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MogWorkbookIdentityMetadata {
    pub schema: String,
    pub version: u32,
    pub workbook_id: WorkbookId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lineage: Option<WorkbookLineage>,
}

impl MogWorkbookIdentityMetadata {
    pub fn new(workbook_id: WorkbookId) -> Self {
        Self {
            schema: MOG_WORKBOOK_ID_CUSTOM_XML_SCHEMA.to_string(),
            version: 1,
            workbook_id,
            created_at: None,
            lineage: None,
        }
    }
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

// ============================================================================
// File Metadata (round-trip)
// ============================================================================

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_edited: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lowest_edited: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rup_build: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSharing {
    pub read_only_recommended: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reservation_password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub algorithm_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub salt_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spin_count: Option<u32>,
}

// ============================================================================
// From/Into: ooxml_types → domain_types
// ============================================================================

impl From<ooxml_types::workbook::CalcMode> for CalcMode {
    fn from(v: ooxml_types::workbook::CalcMode) -> Self {
        match v {
            ooxml_types::workbook::CalcMode::Auto => Self::Auto,
            ooxml_types::workbook::CalcMode::AutoNoTable => Self::AutoNoTable,
            ooxml_types::workbook::CalcMode::Manual => Self::Manual,
        }
    }
}

impl From<ooxml_types::workbook::RefMode> for RefMode {
    fn from(v: ooxml_types::workbook::RefMode) -> Self {
        match v {
            ooxml_types::workbook::RefMode::A1 => Self::A1,
            ooxml_types::workbook::RefMode::R1C1 => Self::R1C1,
        }
    }
}

impl From<ooxml_types::workbook::Visibility> for WorkbookViewVisibility {
    fn from(v: ooxml_types::workbook::Visibility) -> Self {
        match v {
            ooxml_types::workbook::Visibility::Visible => Self::Visible,
            ooxml_types::workbook::Visibility::Hidden => Self::Hidden,
            ooxml_types::workbook::Visibility::VeryHidden => Self::VeryHidden,
        }
    }
}

impl From<ooxml_types::workbook::ObjectDisplayMode> for ObjectDisplayMode {
    fn from(v: ooxml_types::workbook::ObjectDisplayMode) -> Self {
        match v {
            ooxml_types::workbook::ObjectDisplayMode::All => Self::All,
            ooxml_types::workbook::ObjectDisplayMode::Placeholders => Self::Placeholders,
            ooxml_types::workbook::ObjectDisplayMode::None => Self::None,
        }
    }
}

impl From<ooxml_types::workbook::UpdateLinks> for UpdateLinks {
    fn from(v: ooxml_types::workbook::UpdateLinks) -> Self {
        match v {
            ooxml_types::workbook::UpdateLinks::UserSet => Self::UserSet,
            ooxml_types::workbook::UpdateLinks::Never => Self::Never,
            ooxml_types::workbook::UpdateLinks::Always => Self::Always,
        }
    }
}

impl From<ooxml_types::workbook::CalcPr> for CalculationProperties {
    fn from(v: ooxml_types::workbook::CalcPr) -> Self {
        Self {
            iterate: v.iterate,
            iterate_count: v.iterate_count,
            iterate_delta: v.iterate_delta,
            calc_mode: v.calc_mode.into(),
            full_calc_on_load: v.full_calc_on_load,
            ref_mode: v.ref_mode.into(),
            full_precision: v.full_precision,
            calc_completed: v.calc_completed,
            calc_on_save: v.calc_on_save,
            concurrent_calc: v.concurrent_calc,
            concurrent_manual_count: v.concurrent_manual_count,
            calc_id: v.calc_id,
            force_full_calc: v.force_full_calc,
            has_explicit_iterate_count: v.has_explicit_iterate_count,
            has_explicit_iterate_delta: v.has_explicit_iterate_delta,
        }
    }
}

impl From<ooxml_types::protection::WorkbookProtection> for WorkbookProtection {
    fn from(v: ooxml_types::protection::WorkbookProtection) -> Self {
        Self {
            lock_structure: v.lock_structure,
            lock_windows: v.lock_windows,
            lock_revision: v.lock_revision,
            workbook_algorithm_name: v.workbook_algorithm_name,
            workbook_hash_value: v.workbook_hash_value,
            workbook_salt_value: v.workbook_salt_value,
            workbook_spin_count: v.workbook_spin_count,
            revisions_algorithm_name: v.revisions_algorithm_name,
            revisions_hash_value: v.revisions_hash_value,
            revisions_salt_value: v.revisions_salt_value,
            revisions_spin_count: v.revisions_spin_count,
            workbook_password: v.workbook_password,
            workbook_password_character_set: v.workbook_password_character_set,
            revisions_password: v.revisions_password,
            revisions_password_character_set: v.revisions_password_character_set,
        }
    }
}

impl From<ooxml_types::workbook::BookView> for WorkbookView {
    fn from(v: ooxml_types::workbook::BookView) -> Self {
        Self {
            active_tab: v.active_tab,
            first_sheet: v.first_sheet,
            visibility: v.visibility.into(),
            minimized: v.minimized,
            show_horizontal_scroll: v.show_horizontal_scroll,
            show_vertical_scroll: v.show_vertical_scroll,
            show_sheet_tabs: v.show_sheet_tabs,
            auto_filter_date_grouping: v.auto_filter_date_grouping,
            x_window: v.x_window,
            y_window: v.y_window,
            window_width: v.window_width,
            window_height: v.window_height,
            tab_ratio: v.tab_ratio,
            uid: v.xr_uid,
        }
    }
}

impl From<ooxml_types::workbook::WorkbookPr> for WorkbookProperties {
    fn from(v: ooxml_types::workbook::WorkbookPr) -> Self {
        Self {
            date1904: v.date1904,
            show_objects: v.show_objects.into(),
            show_border_unselected_tables: v.show_border_unselected_tables,
            filter_privacy: v.filter_privacy,
            prompted_solutions: v.prompted_solutions,
            show_ink_annotation: v.show_ink_annotation,
            backup_file: v.backup_file,
            save_external_link_values: v.save_external_link_values,
            update_links: v.update_links.into(),
            code_name: v.code_name,
            hide_pivot_field_list: v.hide_pivot_field_list,
            show_pivot_chart_filter: v.show_pivot_chart_filter,
            allow_refresh_query: v.allow_refresh_query,
            publish_items: v.publish_items,
            check_compatibility: v.check_compatibility,
            auto_compress_pictures: v.auto_compress_pictures,
            refresh_all_connections: v.refresh_all_connections,
            default_theme_version: v.default_theme_version,
        }
    }
}

impl From<ooxml_types::workbook::FileVersion> for FileVersion {
    fn from(v: ooxml_types::workbook::FileVersion) -> Self {
        Self {
            app_name: v.app_name,
            last_edited: v.last_edited,
            lowest_edited: v.lowest_edited,
            rup_build: v.rup_build,
            code_name: v.code_name,
        }
    }
}

impl From<ooxml_types::workbook::FileSharing> for FileSharing {
    fn from(v: ooxml_types::workbook::FileSharing) -> Self {
        Self {
            read_only_recommended: v.read_only_recommended,
            user_name: v.user_name,
            reservation_password: v.reservation_password,
            algorithm_name: v.algorithm_name,
            hash_value: v.hash_value,
            salt_value: v.salt_value,
            spin_count: v.spin_count,
        }
    }
}

// ============================================================================
// From/Into: domain_types → ooxml_types (export path)
// ============================================================================

impl From<CalcMode> for ooxml_types::workbook::CalcMode {
    fn from(v: CalcMode) -> Self {
        match v {
            CalcMode::Auto => Self::Auto,
            CalcMode::AutoNoTable => Self::AutoNoTable,
            CalcMode::Manual => Self::Manual,
        }
    }
}

impl From<RefMode> for ooxml_types::workbook::RefMode {
    fn from(v: RefMode) -> Self {
        match v {
            RefMode::A1 => Self::A1,
            RefMode::R1C1 => Self::R1C1,
        }
    }
}

impl From<WorkbookViewVisibility> for ooxml_types::workbook::Visibility {
    fn from(v: WorkbookViewVisibility) -> Self {
        match v {
            WorkbookViewVisibility::Visible => Self::Visible,
            WorkbookViewVisibility::Hidden => Self::Hidden,
            WorkbookViewVisibility::VeryHidden => Self::VeryHidden,
        }
    }
}

impl From<ObjectDisplayMode> for ooxml_types::workbook::ObjectDisplayMode {
    fn from(v: ObjectDisplayMode) -> Self {
        match v {
            ObjectDisplayMode::All => Self::All,
            ObjectDisplayMode::Placeholders => Self::Placeholders,
            ObjectDisplayMode::None => Self::None,
        }
    }
}

impl From<UpdateLinks> for ooxml_types::workbook::UpdateLinks {
    fn from(v: UpdateLinks) -> Self {
        match v {
            UpdateLinks::UserSet => Self::UserSet,
            UpdateLinks::Never => Self::Never,
            UpdateLinks::Always => Self::Always,
        }
    }
}

impl From<CalculationProperties> for ooxml_types::workbook::CalcPr {
    fn from(v: CalculationProperties) -> Self {
        Self {
            calc_id: v.calc_id,
            calc_mode: v.calc_mode.into(),
            full_calc_on_load: v.full_calc_on_load,
            ref_mode: v.ref_mode.into(),
            iterate: v.iterate,
            iterate_count: v.iterate_count,
            iterate_delta: v.iterate_delta,
            full_precision: v.full_precision,
            calc_completed: v.calc_completed,
            calc_on_save: v.calc_on_save,
            concurrent_calc: v.concurrent_calc,
            concurrent_manual_count: v.concurrent_manual_count,
            force_full_calc: v.force_full_calc,
            has_explicit_iterate_count: v.has_explicit_iterate_count,
            has_explicit_iterate_delta: v.has_explicit_iterate_delta,
        }
    }
}

impl From<WorkbookProtection> for ooxml_types::protection::WorkbookProtection {
    fn from(v: WorkbookProtection) -> Self {
        Self {
            lock_structure: v.lock_structure,
            lock_windows: v.lock_windows,
            lock_revision: v.lock_revision,
            workbook_algorithm_name: v.workbook_algorithm_name,
            workbook_hash_value: v.workbook_hash_value,
            workbook_salt_value: v.workbook_salt_value,
            workbook_spin_count: v.workbook_spin_count,
            revisions_algorithm_name: v.revisions_algorithm_name,
            revisions_hash_value: v.revisions_hash_value,
            revisions_salt_value: v.revisions_salt_value,
            revisions_spin_count: v.revisions_spin_count,
            workbook_password: v.workbook_password,
            workbook_password_character_set: v.workbook_password_character_set,
            revisions_password: v.revisions_password,
            revisions_password_character_set: v.revisions_password_character_set,
        }
    }
}

impl From<WorkbookView> for ooxml_types::workbook::BookView {
    fn from(v: WorkbookView) -> Self {
        Self {
            visibility: v.visibility.into(),
            minimized: v.minimized,
            show_horizontal_scroll: v.show_horizontal_scroll,
            show_vertical_scroll: v.show_vertical_scroll,
            show_sheet_tabs: v.show_sheet_tabs,
            x_window: v.x_window,
            y_window: v.y_window,
            window_width: v.window_width,
            window_height: v.window_height,
            tab_ratio: v.tab_ratio,
            first_sheet: v.first_sheet,
            active_tab: v.active_tab,
            auto_filter_date_grouping: v.auto_filter_date_grouping,
            xr_uid: v.uid,
            ext_lst: None,
        }
    }
}

impl From<WorkbookProperties> for ooxml_types::workbook::WorkbookPr {
    fn from(v: WorkbookProperties) -> Self {
        Self {
            date1904: v.date1904,
            show_objects: v.show_objects.into(),
            show_border_unselected_tables: v.show_border_unselected_tables,
            filter_privacy: v.filter_privacy,
            prompted_solutions: v.prompted_solutions,
            show_ink_annotation: v.show_ink_annotation,
            backup_file: v.backup_file,
            save_external_link_values: v.save_external_link_values,
            update_links: v.update_links.into(),
            code_name: v.code_name,
            hide_pivot_field_list: v.hide_pivot_field_list,
            show_pivot_chart_filter: v.show_pivot_chart_filter,
            allow_refresh_query: v.allow_refresh_query,
            publish_items: v.publish_items,
            check_compatibility: v.check_compatibility,
            auto_compress_pictures: v.auto_compress_pictures,
            refresh_all_connections: v.refresh_all_connections,
            default_theme_version: v.default_theme_version,
        }
    }
}

impl From<FileVersion> for ooxml_types::workbook::FileVersion {
    fn from(v: FileVersion) -> Self {
        Self {
            app_name: v.app_name,
            last_edited: v.last_edited,
            lowest_edited: v.lowest_edited,
            rup_build: v.rup_build,
            code_name: v.code_name,
        }
    }
}

impl From<FileSharing> for ooxml_types::workbook::FileSharing {
    fn from(v: FileSharing) -> Self {
        Self {
            read_only_recommended: v.read_only_recommended,
            user_name: v.user_name,
            algorithm_name: v.algorithm_name,
            hash_value: v.hash_value,
            salt_value: v.salt_value,
            spin_count: v.spin_count,
            reservation_password: v.reservation_password,
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calc_mode_roundtrip() {
        let ooxml = ooxml_types::workbook::CalcMode::Manual;
        let domain: CalcMode = ooxml.into();
        assert_eq!(domain, CalcMode::Manual);
        let back: ooxml_types::workbook::CalcMode = domain.into();
        assert_eq!(back, ooxml_types::workbook::CalcMode::Manual);
    }

    #[test]
    fn calc_pr_roundtrip() {
        let ooxml = ooxml_types::workbook::CalcPr {
            calc_id: Some(191029),
            calc_mode: ooxml_types::workbook::CalcMode::Manual,
            full_calc_on_load: true,
            ref_mode: ooxml_types::workbook::RefMode::R1C1,
            iterate: true,
            iterate_count: 200,
            iterate_delta: 0.01,
            full_precision: false,
            calc_completed: false,
            calc_on_save: false,
            concurrent_calc: false,
            concurrent_manual_count: Some(4),
            force_full_calc: true,
            has_explicit_iterate_count: true,
            has_explicit_iterate_delta: true,
        };
        let domain: CalculationProperties = ooxml.clone().into();
        assert_eq!(domain.iterate, true);
        assert_eq!(domain.iterate_count, 200);
        assert_eq!(domain.iterate_delta, 0.01);
        assert_eq!(domain.calc_mode, CalcMode::Manual);
        assert_eq!(domain.ref_mode, RefMode::R1C1);
        assert_eq!(domain.full_precision, false);
        assert_eq!(domain.concurrent_manual_count, Some(4));
        assert_eq!(domain.force_full_calc, true);
        assert_eq!(domain.has_explicit_iterate_count, true);
        assert_eq!(domain.has_explicit_iterate_delta, true);

        let back: ooxml_types::workbook::CalcPr = domain.into();
        assert_eq!(back.calc_id, Some(191029));
        assert_eq!(back.calc_mode, ooxml_types::workbook::CalcMode::Manual);
        assert_eq!(back.iterate_count, 200);
        assert_eq!(back.has_explicit_iterate_count, true);
        assert_eq!(back.has_explicit_iterate_delta, true);
    }

    #[test]
    fn workbook_protection_roundtrip_all_15_fields() {
        let ooxml = ooxml_types::protection::WorkbookProtection {
            lock_structure: true,
            lock_windows: false,
            lock_revision: true,
            workbook_algorithm_name: HashAlgorithm::Sha256,
            workbook_hash_value: Some("abc123".into()),
            workbook_salt_value: Some("salt1".into()),
            workbook_spin_count: Some(100000),
            revisions_algorithm_name: HashAlgorithm::Sha512,
            revisions_hash_value: Some("def456".into()),
            revisions_salt_value: Some("salt2".into()),
            revisions_spin_count: Some(50000),
            workbook_password: Some("ABCD".into()),
            workbook_password_character_set: Some("UTF-8".into()),
            revisions_password: Some("EFGH".into()),
            revisions_password_character_set: Some("UTF-16".into()),
        };
        let domain: WorkbookProtection = ooxml.clone().into();
        assert_eq!(domain.lock_structure, true);
        assert_eq!(domain.lock_revision, true);
        assert_eq!(domain.workbook_algorithm_name, HashAlgorithm::Sha256);
        assert_eq!(domain.workbook_hash_value.as_deref(), Some("abc123"));
        assert_eq!(domain.revisions_algorithm_name, HashAlgorithm::Sha512);
        assert_eq!(domain.revisions_hash_value.as_deref(), Some("def456"));
        assert_eq!(domain.workbook_password.as_deref(), Some("ABCD"));
        assert_eq!(domain.revisions_password.as_deref(), Some("EFGH"));
        assert_eq!(
            domain.workbook_password_character_set.as_deref(),
            Some("UTF-8")
        );
        assert_eq!(
            domain.revisions_password_character_set.as_deref(),
            Some("UTF-16")
        );

        let back: ooxml_types::protection::WorkbookProtection = domain.into();
        assert_eq!(back, ooxml);
    }

    #[test]
    fn book_view_roundtrip() {
        let ooxml = ooxml_types::workbook::BookView {
            visibility: ooxml_types::workbook::Visibility::Hidden,
            minimized: true,
            show_horizontal_scroll: false,
            show_vertical_scroll: false,
            show_sheet_tabs: false,
            x_window: Some(100),
            y_window: Some(200),
            window_width: Some(1920),
            window_height: Some(1080),
            tab_ratio: Some(800.0),
            first_sheet: 2,
            active_tab: 3,
            auto_filter_date_grouping: false,
            xr_uid: None,
            ext_lst: None,
        };
        let domain: WorkbookView = ooxml.into();
        assert_eq!(domain.visibility, WorkbookViewVisibility::Hidden);
        assert_eq!(domain.minimized, true);
        assert_eq!(domain.tab_ratio, Some(800.0));
        assert_eq!(domain.active_tab, 3);
        assert_eq!(domain.first_sheet, 2);
        assert_eq!(domain.x_window, Some(100));
    }

    #[test]
    fn workbook_pr_roundtrip() {
        let ooxml = ooxml_types::workbook::WorkbookPr {
            date1904: true,
            filter_privacy: true,
            code_name: Some("ThisWorkbook".into()),
            default_theme_version: Some(166925),
            ..Default::default()
        };
        let domain: WorkbookProperties = ooxml.clone().into();
        assert_eq!(domain.date1904, true);
        assert_eq!(domain.filter_privacy, true);
        assert_eq!(domain.code_name.as_deref(), Some("ThisWorkbook"));
        assert_eq!(domain.default_theme_version, Some(166925));

        let back: ooxml_types::workbook::WorkbookPr = domain.into();
        assert_eq!(back, ooxml);
    }

    #[test]
    fn file_version_roundtrip() {
        let ooxml = ooxml_types::workbook::FileVersion {
            app_name: Some("xl".into()),
            last_edited: Some("7".into()),
            lowest_edited: Some("6".into()),
            rup_build: Some("14420".into()),
            code_name: None,
        };
        let domain: FileVersion = ooxml.clone().into();
        let back: ooxml_types::workbook::FileVersion = domain.into();
        assert_eq!(back, ooxml);
    }

    #[test]
    fn file_sharing_roundtrip() {
        let ooxml = ooxml_types::workbook::FileSharing {
            read_only_recommended: true,
            user_name: Some("admin".into()),
            algorithm_name: Some("SHA-512".into()),
            hash_value: Some("hash".into()),
            salt_value: Some("salt".into()),
            spin_count: Some(100000),
            reservation_password: Some("DEAD".into()),
        };
        let domain: FileSharing = ooxml.clone().into();
        let back: ooxml_types::workbook::FileSharing = domain.into();
        assert_eq!(back, ooxml);
    }

    #[test]
    fn defaults_match_ooxml_spec() {
        let calc = CalculationProperties::default();
        assert_eq!(calc.iterate, false);
        assert_eq!(calc.iterate_count, 100);
        assert_eq!(calc.iterate_delta, 0.001);
        assert_eq!(calc.calc_mode, CalcMode::Auto);
        assert_eq!(calc.ref_mode, RefMode::A1);
        assert_eq!(calc.full_precision, true);
        assert_eq!(calc.calc_completed, true);
        assert_eq!(calc.calc_on_save, true);
        assert_eq!(calc.concurrent_calc, true);

        let view = WorkbookView::default();
        assert_eq!(view.tab_ratio, None);
        assert_eq!(view.show_horizontal_scroll, true);
        assert_eq!(view.show_sheet_tabs, true);

        let props = WorkbookProperties::default();
        assert_eq!(props.date1904, false);
        assert_eq!(props.show_objects, ObjectDisplayMode::All);
        assert_eq!(props.auto_compress_pictures, true);
        assert_eq!(props.save_external_link_values, true);
    }

    // ====================================================================
    // Serde round-trip tests (JSON serialize → deserialize → equality)
    // ====================================================================

    #[test]
    fn serde_roundtrip_calculation_properties_non_default() {
        let cp = CalculationProperties {
            iterate: true,
            iterate_count: 250,
            iterate_delta: 0.05,
            calc_mode: CalcMode::Manual,
            full_calc_on_load: true,
            ref_mode: RefMode::R1C1,
            full_precision: false,
            calc_completed: false,
            calc_on_save: false,
            concurrent_calc: false,
            concurrent_manual_count: Some(8),
            calc_id: Some(191029),
            force_full_calc: true,
            has_explicit_iterate_count: true,
            has_explicit_iterate_delta: true,
        };
        let json = serde_json::to_string(&cp).unwrap();
        let deserialized: CalculationProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(cp, deserialized);

        // Verify camelCase field names in JSON
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            v.get("iterateCount").is_some(),
            "expected camelCase iterateCount"
        );
        assert!(
            v.get("iterateDelta").is_some(),
            "expected camelCase iterateDelta"
        );
        assert!(v.get("calcMode").is_some(), "expected camelCase calcMode");
        assert!(
            v.get("fullCalcOnLoad").is_some(),
            "expected camelCase fullCalcOnLoad"
        );
        assert!(v.get("refMode").is_some(), "expected camelCase refMode");
        assert!(
            v.get("fullPrecision").is_some(),
            "expected camelCase fullPrecision"
        );
        assert!(
            v.get("concurrentManualCount").is_some(),
            "expected camelCase concurrentManualCount"
        );
        assert!(
            v.get("forceFullCalc").is_some(),
            "expected camelCase forceFullCalc"
        );
        assert!(
            v.get("hasExplicitIterateCount").is_some(),
            "expected camelCase hasExplicitIterateCount"
        );
    }

    #[test]
    fn serde_roundtrip_workbook_protection_all_fields() {
        let wp = WorkbookProtection {
            lock_structure: true,
            lock_windows: true,
            lock_revision: true,
            workbook_algorithm_name: HashAlgorithm::Sha256,
            workbook_hash_value: Some("wb_hash_abc".into()),
            workbook_salt_value: Some("wb_salt_xyz".into()),
            workbook_spin_count: Some(100000),
            revisions_algorithm_name: HashAlgorithm::Sha512,
            revisions_hash_value: Some("rev_hash_def".into()),
            revisions_salt_value: Some("rev_salt_uvw".into()),
            revisions_spin_count: Some(50000),
            workbook_password: Some("BEEF".into()),
            workbook_password_character_set: Some("UTF-16LE".into()),
            revisions_password: Some("CAFE".into()),
            revisions_password_character_set: Some("UTF-8".into()),
        };
        let json = serde_json::to_string(&wp).unwrap();
        let deserialized: WorkbookProtection = serde_json::from_str(&json).unwrap();
        assert_eq!(wp, deserialized);

        // Verify camelCase
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("lockStructure").is_some());
        assert!(v.get("lockWindows").is_some());
        assert!(v.get("workbookAlgorithmName").is_some());
        assert!(v.get("workbookHashValue").is_some());
        assert!(v.get("revisionsAlgorithmName").is_some());
        assert!(v.get("workbookPassword").is_some());
        assert!(v.get("revisionsPasswordCharacterSet").is_some());
    }

    #[test]
    fn serde_roundtrip_workbook_view_all_fields() {
        let wv = WorkbookView {
            active_tab: 5,
            first_sheet: 2,
            visibility: WorkbookViewVisibility::Hidden,
            minimized: true,
            show_horizontal_scroll: false,
            show_vertical_scroll: false,
            show_sheet_tabs: false,
            auto_filter_date_grouping: false,
            x_window: Some(-100),
            y_window: Some(200),
            window_width: Some(2560),
            window_height: Some(1440),
            tab_ratio: Some(800.0),
            uid: Some("{12345678-1234-1234-1234-123456789ABC}".into()),
        };
        let json = serde_json::to_string(&wv).unwrap();
        let deserialized: WorkbookView = serde_json::from_str(&json).unwrap();
        assert_eq!(wv, deserialized);

        // Verify camelCase
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("activeTab").is_some());
        assert!(v.get("firstSheet").is_some());
        assert!(v.get("showHorizontalScroll").is_some());
        assert!(v.get("autoFilterDateGrouping").is_some());
        assert!(v.get("tabRatio").is_some());
        assert!(v.get("xWindow").is_some());
        assert!(v.get("windowWidth").is_some());
    }

    #[test]
    fn serde_roundtrip_workbook_properties_date1904() {
        let wp = WorkbookProperties {
            date1904: true,
            show_objects: ObjectDisplayMode::Placeholders,
            show_border_unselected_tables: false,
            filter_privacy: true,
            prompted_solutions: true,
            show_ink_annotation: false,
            backup_file: true,
            save_external_link_values: false,
            update_links: UpdateLinks::Always,
            code_name: Some("ThisWorkbook".into()),
            hide_pivot_field_list: true,
            show_pivot_chart_filter: true,
            allow_refresh_query: true,
            publish_items: true,
            check_compatibility: true,
            auto_compress_pictures: false,
            refresh_all_connections: true,
            default_theme_version: Some(166925),
        };
        let json = serde_json::to_string(&wp).unwrap();
        let deserialized: WorkbookProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(wp, deserialized);

        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["date1904"], true);
        assert!(v.get("showObjects").is_some());
        assert!(v.get("updateLinks").is_some());
        assert!(v.get("codeName").is_some());
        assert!(v.get("defaultThemeVersion").is_some());
        assert!(v.get("autoCompressPictures").is_some());
    }

    #[test]
    fn serde_roundtrip_file_version_all_fields() {
        let fv = FileVersion {
            app_name: Some("xl".into()),
            last_edited: Some("7".into()),
            lowest_edited: Some("6".into()),
            rup_build: Some("24430".into()),
            code_name: Some("{12345}".into()),
        };
        let json = serde_json::to_string(&fv).unwrap();
        let deserialized: FileVersion = serde_json::from_str(&json).unwrap();
        assert_eq!(fv, deserialized);

        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("appName").is_some());
        assert!(v.get("lastEdited").is_some());
        assert!(v.get("lowestEdited").is_some());
        assert!(v.get("rupBuild").is_some());
    }

    #[test]
    fn serde_roundtrip_file_sharing_all_fields() {
        let fs = FileSharing {
            read_only_recommended: true,
            user_name: Some("admin".into()),
            reservation_password: Some("DEAD".into()),
            algorithm_name: Some("SHA-512".into()),
            hash_value: Some("hash_abc".into()),
            salt_value: Some("salt_xyz".into()),
            spin_count: Some(100000),
        };
        let json = serde_json::to_string(&fs).unwrap();
        let deserialized: FileSharing = serde_json::from_str(&json).unwrap();
        assert_eq!(fs, deserialized);

        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("readOnlyRecommended").is_some());
        assert!(v.get("userName").is_some());
        assert!(v.get("reservationPassword").is_some());
        assert!(v.get("algorithmName").is_some());
        assert!(v.get("spinCount").is_some());
    }

    // ====================================================================
    // Default → JSON → deserialize preserves OOXML spec defaults
    // ====================================================================

    #[test]
    fn default_calc_props_serde_roundtrip() {
        let original = CalculationProperties::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: CalculationProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn default_workbook_protection_serde_roundtrip() {
        let original = WorkbookProtection::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: WorkbookProtection = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn default_workbook_view_serde_roundtrip() {
        let original = WorkbookView::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: WorkbookView = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn default_workbook_properties_serde_roundtrip() {
        let original = WorkbookProperties::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: WorkbookProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn default_file_version_serde_roundtrip() {
        let original = FileVersion::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: FileVersion = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn default_file_sharing_serde_roundtrip() {
        let original = FileSharing::default();
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: FileSharing = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    // ====================================================================
    // Partial JSON deserialization (forward compatibility / #[serde(default)])
    // ====================================================================

    #[test]
    fn partial_json_file_version_empty() {
        // FileVersion has all Option fields with #[serde(default)] — empty JSON works
        let json = r#"{}"#;
        let fv: FileVersion = serde_json::from_str(json).unwrap();
        assert_eq!(fv, FileVersion::default());
    }

    #[test]
    fn partial_json_file_version_some_fields() {
        let json = r#"{"appName": "xl", "rupBuild": "14420"}"#;
        let fv: FileVersion = serde_json::from_str(json).unwrap();
        assert_eq!(fv.app_name.as_deref(), Some("xl"));
        assert_eq!(fv.rup_build.as_deref(), Some("14420"));
        assert_eq!(fv.last_edited, None);
        assert_eq!(fv.lowest_edited, None);
        assert_eq!(fv.code_name, None);
    }

    #[test]
    fn partial_json_workbook_protection_optional_fields_omitted() {
        // WorkbookProtection uses skip_serializing_if for Option fields.
        // Serialize a default (all Nones) then deserialize — the optional fields
        // should not be present in JSON, and deserialization should still work.
        let original = WorkbookProtection::default();
        let json = serde_json::to_string(&original).unwrap();
        // Verify optional fields are NOT in the JSON (skip_serializing_if)
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            v.get("workbookHashValue").is_none(),
            "None fields should be skipped"
        );
        assert!(v.get("workbookSaltValue").is_none());
        assert!(v.get("workbookSpinCount").is_none());
        assert!(v.get("revisionsPassword").is_none());
        // Deserialize back
        let deserialized: WorkbookProtection = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn partial_json_workbook_view_optional_fields_omitted() {
        // WorkbookView default has uid=None which is skip_serializing_if
        let original = WorkbookView::default();
        let json = serde_json::to_string(&original).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("uid").is_none(), "uid=None should be skipped");
        let deserialized: WorkbookView = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn partial_json_file_sharing_optional_fields_omitted() {
        // FileSharing default has most fields as None
        let original = FileSharing::default();
        let json = serde_json::to_string(&original).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(v.get("userName").is_none(), "None fields should be skipped");
        assert!(v.get("algorithmName").is_none());
        assert!(v.get("hashValue").is_none());
        assert!(v.get("saltValue").is_none());
        assert!(v.get("spinCount").is_none());
        let deserialized: FileSharing = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn partial_json_workbook_properties_optional_fields_omitted() {
        let original = WorkbookProperties::default();
        let json = serde_json::to_string(&original).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(
            v.get("codeName").is_none(),
            "codeName=None should be skipped"
        );
        assert!(
            v.get("defaultThemeVersion").is_none(),
            "defaultThemeVersion=None should be skipped"
        );
        let deserialized: WorkbookProperties = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    // ====================================================================
    // Enum serde: verify camelCase string representation
    // ====================================================================

    #[test]
    fn enum_serde_calc_mode() {
        assert_eq!(serde_json::to_string(&CalcMode::Auto).unwrap(), r#""auto""#);
        assert_eq!(
            serde_json::to_string(&CalcMode::AutoNoTable).unwrap(),
            r#""autoNoTable""#
        );
        assert_eq!(
            serde_json::to_string(&CalcMode::Manual).unwrap(),
            r#""manual""#
        );

        // Deserialize back
        assert_eq!(
            serde_json::from_str::<CalcMode>(r#""auto""#).unwrap(),
            CalcMode::Auto
        );
        assert_eq!(
            serde_json::from_str::<CalcMode>(r#""autoNoTable""#).unwrap(),
            CalcMode::AutoNoTable
        );
        assert_eq!(
            serde_json::from_str::<CalcMode>(r#""manual""#).unwrap(),
            CalcMode::Manual
        );
    }

    #[test]
    fn enum_serde_ref_mode() {
        // Note: camelCase of A1 is "a1", R1C1 is "r1C1"
        let a1_json = serde_json::to_string(&RefMode::A1).unwrap();
        let r1c1_json = serde_json::to_string(&RefMode::R1C1).unwrap();

        // Roundtrip is the important thing
        assert_eq!(
            serde_json::from_str::<RefMode>(&a1_json).unwrap(),
            RefMode::A1
        );
        assert_eq!(
            serde_json::from_str::<RefMode>(&r1c1_json).unwrap(),
            RefMode::R1C1
        );
    }

    #[test]
    fn enum_serde_object_display_mode() {
        assert_eq!(
            serde_json::to_string(&ObjectDisplayMode::All).unwrap(),
            r#""all""#
        );
        assert_eq!(
            serde_json::to_string(&ObjectDisplayMode::Placeholders).unwrap(),
            r#""placeholders""#
        );
        assert_eq!(
            serde_json::to_string(&ObjectDisplayMode::None).unwrap(),
            r#""none""#
        );

        assert_eq!(
            serde_json::from_str::<ObjectDisplayMode>(r#""all""#).unwrap(),
            ObjectDisplayMode::All
        );
        assert_eq!(
            serde_json::from_str::<ObjectDisplayMode>(r#""placeholders""#).unwrap(),
            ObjectDisplayMode::Placeholders
        );
        assert_eq!(
            serde_json::from_str::<ObjectDisplayMode>(r#""none""#).unwrap(),
            ObjectDisplayMode::None
        );
    }

    #[test]
    fn enum_serde_update_links() {
        assert_eq!(
            serde_json::to_string(&UpdateLinks::UserSet).unwrap(),
            r#""userSet""#
        );
        assert_eq!(
            serde_json::to_string(&UpdateLinks::Never).unwrap(),
            r#""never""#
        );
        assert_eq!(
            serde_json::to_string(&UpdateLinks::Always).unwrap(),
            r#""always""#
        );

        assert_eq!(
            serde_json::from_str::<UpdateLinks>(r#""userSet""#).unwrap(),
            UpdateLinks::UserSet
        );
        assert_eq!(
            serde_json::from_str::<UpdateLinks>(r#""never""#).unwrap(),
            UpdateLinks::Never
        );
        assert_eq!(
            serde_json::from_str::<UpdateLinks>(r#""always""#).unwrap(),
            UpdateLinks::Always
        );
    }

    #[test]
    fn enum_serde_workbook_view_visibility() {
        assert_eq!(
            serde_json::to_string(&WorkbookViewVisibility::Visible).unwrap(),
            r#""visible""#
        );
        assert_eq!(
            serde_json::to_string(&WorkbookViewVisibility::Hidden).unwrap(),
            r#""hidden""#
        );
        assert_eq!(
            serde_json::to_string(&WorkbookViewVisibility::VeryHidden).unwrap(),
            r#""veryHidden""#
        );

        assert_eq!(
            serde_json::from_str::<WorkbookViewVisibility>(r#""visible""#).unwrap(),
            WorkbookViewVisibility::Visible
        );
        assert_eq!(
            serde_json::from_str::<WorkbookViewVisibility>(r#""hidden""#).unwrap(),
            WorkbookViewVisibility::Hidden
        );
        assert_eq!(
            serde_json::from_str::<WorkbookViewVisibility>(r#""veryHidden""#).unwrap(),
            WorkbookViewVisibility::VeryHidden
        );
    }
}
