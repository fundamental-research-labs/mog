//! Workbook-level types (ECMA-376 Part 1, Section 18.2 — SpreadsheetML Workbook).
//!
//! Types modelling the contents of `xl/workbook.xml`: the top-level workbook
//! element, sheet references, book views, calculation properties, defined names,
//! file version and sharing metadata.
//!
//! `WorkbookProtection` is defined in [`crate::protection`] and re-used here.

// ============================================================================
// SheetState -- ST_SheetState
// ============================================================================

/// Sheet visibility state (ST_SheetState).
///
/// Controls whether a sheet tab is visible in the workbook UI.
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
pub enum SheetState {
    /// Sheet is visible (default).
    #[default]
    #[xml("visible")]
    Visible,
    /// Sheet is hidden but can be unhidden via the UI.
    #[xml("hidden")]
    Hidden,
    /// Sheet is hidden and cannot be unhidden via the UI (VBA only).
    #[xml("veryHidden")]
    VeryHidden,
}

// ============================================================================
// CalcMode -- ST_CalcMode
// ============================================================================

/// Calculation mode (ST_CalcMode).
///
/// Determines when the spreadsheet engine recalculates formulas.
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
pub enum CalcMode {
    /// Automatic recalculation (default).
    #[default]
    #[xml("auto")]
    Auto,
    /// Automatic except for data tables.
    #[xml("autoNoTable")]
    AutoNoTable,
    /// Manual recalculation only.
    #[xml("manual")]
    Manual,
}

// ============================================================================
// RefMode -- ST_RefMode
// ============================================================================

/// Cell reference style (ST_RefMode).
///
/// Controls whether formulas use A1-style or R1C1-style references.
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
pub enum RefMode {
    /// A1 reference style (default).
    #[default]
    #[xml("A1")]
    A1,
    /// R1C1 reference style.
    #[xml("R1C1")]
    R1C1,
}

// ============================================================================
// ObjectDisplayMode -- ST_Objects
// ============================================================================

/// Object display mode (ST_Objects).
///
/// Controls how embedded objects (charts, images, controls) are rendered.
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
pub enum ObjectDisplayMode {
    /// Show all objects (default).
    #[default]
    #[xml("all")]
    All,
    /// Show placeholders instead of objects.
    #[xml("placeholders")]
    Placeholders,
    /// Hide all objects.
    #[xml("none")]
    None,
}

// ============================================================================
// UpdateLinks -- ST_UpdateLinks
// ============================================================================

/// External link update behaviour (ST_UpdateLinks).
///
/// Controls how the application handles external link updates on open.
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
pub enum UpdateLinks {
    /// Prompt the user (default).
    #[default]
    #[xml("userSet")]
    UserSet,
    /// Never update external links automatically.
    #[xml("never")]
    Never,
    /// Always update external links automatically.
    #[xml("always")]
    Always,
}

// ============================================================================
// DdeValueType -- ST_DdeValueType
// ============================================================================

/// DDE value type (ST_DdeValueType, ECMA-376 §18.18.20).
///
/// Specifies the data type of a value exchanged via DDE (Dynamic Data Exchange).
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
pub enum DdeValueType {
    /// Nil / empty value (default).
    #[default]
    #[xml("nil")]
    Nil,
    /// Boolean value.
    #[xml("b")]
    Boolean,
    /// Numeric value.
    #[xml("n")]
    Number,
    /// Error value.
    #[xml("e")]
    Error,
    /// String value.
    #[xml("str")]
    Str,
}

// ============================================================================
// Visibility -- ST_Visibility
// ============================================================================

/// Window/view visibility (ST_Visibility).
///
/// Controls whether a workbook window is visible, hidden, or very hidden.
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
pub enum Visibility {
    /// Window is visible (default).
    #[default]
    #[xml("visible")]
    Visible,
    /// Window is hidden.
    #[xml("hidden")]
    Hidden,
    /// Window is very hidden (cannot be unhidden via the UI).
    #[xml("veryHidden")]
    VeryHidden,
}

// ============================================================================
// FileVersion -- CT_FileVersion
// ============================================================================

/// File version metadata (CT_FileVersion).
///
/// Records which application created or last edited the file.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FileVersion {
    /// Application name (e.g. "xl", "LibreOffice").
    pub app_name: Option<String>,
    /// Last-edited version identifier.
    pub last_edited: Option<String>,
    /// Lowest version that edited this file.
    pub lowest_edited: Option<String>,
    /// Build identifier of the application.
    pub rup_build: Option<String>,
    /// GUID code name for file identity tracking.
    pub code_name: Option<String>,
}

// ============================================================================
// FileSharing -- CT_FileSharing
// ============================================================================

/// File sharing settings (CT_FileSharing).
///
/// Controls read-only recommendations and shared-file password protection.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FileSharing {
    /// Whether opening the file should recommend read-only mode.
    pub read_only_recommended: bool,
    /// User name of the person who shared the file.
    pub user_name: Option<String>,
    /// Hash algorithm name for the sharing password.
    pub algorithm_name: Option<String>,
    /// Base64-encoded hash value.
    pub hash_value: Option<String>,
    /// Base64-encoded salt value.
    pub salt_value: Option<String>,
    /// Number of hash iterations (spin count).
    pub spin_count: Option<u32>,
    /// Legacy hex password hash for reservation password (ST_UnsignedShortHex).
    /// Modern files use algorithmName/hashValue/saltValue instead.
    pub reservation_password: Option<String>,
}

// ============================================================================
// SheetRef -- CT_Sheet
// ============================================================================

/// Reference to a sheet within the workbook (CT_Sheet).
///
/// Each `SheetRef` maps a sheet name and ID to its relationship target
/// (`r:id`) and visibility state.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SheetRef {
    /// Display name of the sheet tab.
    pub name: String,
    /// Unique sheet identifier within the workbook.
    pub sheet_id: u32,
    /// Visibility state of the sheet tab.
    pub state: SheetState,
    /// Relationship ID pointing to the sheet part.
    pub r_id: String,
}

impl Default for SheetRef {
    fn default() -> Self {
        Self {
            name: String::new(),
            sheet_id: 0,
            state: SheetState::Visible,
            r_id: String::new(),
        }
    }
}

// ============================================================================
// BookView -- CT_BookView
// ============================================================================

/// Workbook-level window/view settings (CT_BookView).
///
/// Describes the position, size, and display options for a workbook window.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BookView {
    /// Window visibility.
    pub visibility: Visibility,
    /// Whether the window is minimized.
    pub minimized: bool,
    /// Whether to show the horizontal scroll bar.
    pub show_horizontal_scroll: bool,
    /// Whether to show the vertical scroll bar.
    pub show_vertical_scroll: bool,
    /// Whether to show sheet tabs.
    pub show_sheet_tabs: bool,
    /// X position of the upper-left corner (in twips).
    pub x_window: Option<i32>,
    /// Y position of the upper-left corner (in twips).
    pub y_window: Option<i32>,
    /// Width of the window (in twips).
    pub window_width: Option<u32>,
    /// Height of the window (in twips).
    pub window_height: Option<u32>,
    /// Ratio of the sheet-tab bar width to the horizontal scroll bar width (0–1000).
    /// Stored as `Option<f64>` because some producers (e.g. Excel) emit fractional
    /// values like `877.5119617224872`, and `None` means "not specified" (omit from XML).
    pub tab_ratio: Option<f64>,
    /// Zero-based index of the first visible sheet tab.
    pub first_sheet: u32,
    /// Zero-based index of the active (selected) sheet tab.
    pub active_tab: u32,
    /// Whether to group dates in AutoFilter menus.
    pub auto_filter_date_grouping: bool,
    /// xr2:uid attribute for round-trip fidelity of extension namespaces.
    pub xr_uid: Option<String>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for BookView {
    fn default() -> Self {
        Self {
            visibility: Visibility::Visible,
            minimized: false,
            show_horizontal_scroll: true,
            show_vertical_scroll: true,
            show_sheet_tabs: true,
            x_window: None,
            y_window: None,
            window_width: None,
            window_height: None,
            tab_ratio: None,
            first_sheet: 0,
            active_tab: 0,
            auto_filter_date_grouping: true,
            xr_uid: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// WorkbookPr -- CT_WorkbookPr
// ============================================================================

/// Workbook properties (CT_WorkbookPr).
///
/// General-purpose property bag for workbook-level settings such as date
/// system, object display mode, and VBA code name.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WorkbookPr {
    /// Whether to use the 1904 date system (Mac legacy).
    pub date1904: bool,
    /// How embedded objects are displayed.
    pub show_objects: ObjectDisplayMode,
    /// Whether to show borders around unselected ListObject tables.
    pub show_border_unselected_tables: bool,
    /// Whether to strip personally-identifiable information on save.
    pub filter_privacy: bool,
    /// Whether prompted solutions are enabled.
    pub prompted_solutions: bool,
    /// Whether to show ink annotations.
    pub show_ink_annotation: bool,
    /// Whether to create a backup file on save.
    pub backup_file: bool,
    /// Whether to save external link values in the file.
    pub save_external_link_values: bool,
    /// External link update behaviour.
    pub update_links: UpdateLinks,
    /// VBA project code name for the workbook.
    pub code_name: Option<String>,
    /// Whether to hide the PivotTable field list pane.
    pub hide_pivot_field_list: bool,
    /// Whether to show the PivotChart filter button.
    pub show_pivot_chart_filter: bool,
    /// Whether to allow refresh of query data.
    pub allow_refresh_query: bool,
    /// Whether to publish items to a server.
    pub publish_items: bool,
    /// Whether to check compatibility on save.
    pub check_compatibility: bool,
    /// Whether to auto-compress pictures on save.
    pub auto_compress_pictures: bool,
    /// Whether to refresh all connections on open.
    pub refresh_all_connections: bool,
    /// Default theme version number.
    pub default_theme_version: Option<u32>,
}

impl Default for WorkbookPr {
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
// CalcPr -- CT_CalcPr
// ============================================================================

/// Calculation properties (CT_CalcPr).
///
/// Controls formula calculation behaviour: mode, iteration limits,
/// precision, and concurrency.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CalcPr {
    /// Calculation engine version identifier.
    pub calc_id: Option<u32>,
    /// Calculation mode.
    pub calc_mode: CalcMode,
    /// Whether to perform a full calculation when the file is opened.
    pub full_calc_on_load: bool,
    /// Cell reference style.
    pub ref_mode: RefMode,
    /// Whether iterative calculation is enabled.
    pub iterate: bool,
    /// Maximum number of iterations for iterative calculation.
    pub iterate_count: u32,
    /// Maximum change threshold for iterative calculation convergence.
    pub iterate_delta: f64,
    /// Whether to use full (15-digit) precision for calculations.
    pub full_precision: bool,
    /// Whether calculation was completed before the file was saved.
    pub calc_completed: bool,
    /// Whether to recalculate before saving.
    pub calc_on_save: bool,
    /// Whether to allow concurrent (multi-threaded) calculation.
    pub concurrent_calc: bool,
    /// Manual thread count override for concurrent calculation.
    pub concurrent_manual_count: Option<u32>,
    /// Whether to force a full recalculation on every calculate.
    pub force_full_calc: bool,
    /// Whether `iterateCount` was explicitly present in the source XML
    /// (even if it matched the spec default of 100). For round-trip fidelity.
    pub has_explicit_iterate_count: bool,
    /// Whether `iterateDelta` was explicitly present in the source XML
    /// (even if it matched the spec default of 0.001). For round-trip fidelity.
    pub has_explicit_iterate_delta: bool,
}

impl Default for CalcPr {
    fn default() -> Self {
        Self {
            calc_id: None,
            calc_mode: CalcMode::Auto,
            full_calc_on_load: false,
            ref_mode: RefMode::A1,
            iterate: false,
            iterate_count: 100,
            iterate_delta: 0.001,
            full_precision: true,
            calc_completed: true,
            calc_on_save: true,
            concurrent_calc: true,
            concurrent_manual_count: None,
            force_full_calc: false,
            has_explicit_iterate_count: false,
            has_explicit_iterate_delta: false,
        }
    }
}

// ============================================================================
// DefinedName -- CT_DefinedName
// ============================================================================

/// Defined name entry (CT_DefinedName).
///
/// A named formula, range, or constant that can be referenced by name in
/// formulas. Built-in names (e.g. `_xlnm.Print_Area`) use reserved prefixes.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DefinedName {
    /// The defined name (required).
    pub name: String,
    /// Optional comment describing the name.
    pub comment: Option<String>,
    /// Custom menu text.
    pub custom_menu: Option<String>,
    /// Description text.
    pub description: Option<String>,
    /// Help topic text.
    pub help: Option<String>,
    /// Status bar text.
    pub status_bar: Option<String>,
    /// Zero-based sheet index to scope the name locally, or `None` for workbook scope.
    pub local_sheet_id: Option<u32>,
    /// Whether the name is hidden from the UI.
    pub hidden: bool,
    /// Whether the name is a user-defined function.
    pub function: bool,
    /// Whether the name refers to a VBA procedure.
    pub vb_procedure: bool,
    /// Whether the name is an XLM (macro-sheet) function.
    pub xlm: bool,
    /// Function group ID for categorisation.
    pub function_group_id: Option<u32>,
    /// Keyboard shortcut key.
    pub shortcut_key: Option<String>,
    /// Whether to publish the name to a server.
    pub publish_to_server: bool,
    /// Whether the name is a workbook parameter.
    pub workbook_parameter: bool,
    /// The formula, range reference, or constant value (text content of the element).
    pub value: String,
}

// ============================================================================
// FunctionGroup -- CT_FunctionGroup
// ============================================================================

/// Function group entry (CT_FunctionGroup).
///
/// Categorises user-defined functions in the function wizard.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct FunctionGroup {
    /// Display name of the function group.
    pub name: Option<String>,
}

// ============================================================================
// ExternalReference -- CT_ExternalReference
// ============================================================================

/// External workbook reference (CT_ExternalReference).
///
/// Points to an external workbook via a relationship ID.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalReference {
    /// Relationship ID (`r:id`) pointing to the external workbook part.
    pub r_id: String,
}

// ============================================================================
// PivotCache -- CT_PivotCache
// ============================================================================

/// Pivot cache reference (CT_PivotCache).
///
/// Associates a pivot cache ID with its relationship target.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct PivotCache {
    /// Unique cache ID within the workbook.
    pub cache_id: u32,
    /// Relationship ID (`r:id`) pointing to the pivot cache definition part.
    pub r_id: String,
}

// ============================================================================
// FileRecoveryPr -- CT_FileRecoveryPr
// ============================================================================

/// File recovery properties (CT_FileRecoveryPr).
///
/// Controls auto-recovery and repair settings for the workbook.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FileRecoveryPr {
    /// Whether to auto-recover the workbook.
    pub auto_recover: bool,
    /// Whether the file needs repair on load.
    pub crash_save: bool,
    /// Whether the file requires data-integrity repair.
    pub data_extract_load: bool,
    /// Whether to repair the file on load.
    pub repair_load: bool,
}

impl Default for FileRecoveryPr {
    fn default() -> Self {
        Self {
            auto_recover: true,
            crash_save: false,
            data_extract_load: false,
            repair_load: false,
        }
    }
}

// ============================================================================
// Workbook -- CT_Workbook
// ============================================================================

/// Root workbook element (CT_Workbook).
///
/// Top-level container for `xl/workbook.xml`, holding sheet references,
/// views, calculation properties, defined names, and metadata.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Workbook {
    /// Application file version information.
    pub file_version: Option<FileVersion>,
    /// File sharing and read-only settings.
    pub file_sharing: Option<FileSharing>,
    /// General workbook properties.
    pub workbook_pr: Option<WorkbookPr>,
    /// Workbook-level protection (re-used from [`crate::protection`]).
    pub workbook_protection: Option<crate::protection::WorkbookProtection>,
    /// Workbook window/view definitions.
    pub book_views: Vec<BookView>,
    /// Ordered list of sheet references.
    pub sheets: Vec<SheetRef>,
    /// Defined names (named ranges, formulas, constants).
    pub defined_names: Vec<DefinedName>,
    /// Calculation properties.
    pub calc_pr: Option<CalcPr>,
    /// Conformance class — transitional or strict (CT_Workbook.@conformance).
    pub conformance: Option<String>,
    /// Number of built-in function groups (CT_FunctionGroups.@builtInGroupCount).
    /// Default: 16.
    pub built_in_group_count: Option<u32>,
    /// Function group definitions (CT_FunctionGroups).
    pub function_groups: Vec<FunctionGroup>,
    /// External workbook references (CT_ExternalReferences).
    pub external_references: Vec<ExternalReference>,
    /// Visible range for an OLE-embedded workbook (CT_OleSize).
    /// Stored as A1-style range string (e.g. "A1:F20").
    pub ole_size: Option<String>,
    /// Custom workbook views / personal views (CT_CustomWorkbookViews).
    /// Preserved as raw XML for round-tripping.
    pub custom_workbook_views: Option<crate::ExtensionList>,
    /// Pivot cache definitions (CT_PivotCaches).
    pub pivot_caches: Vec<PivotCache>,
    /// Smart tag properties (CT_SmartTagPr).
    /// Preserved as raw XML for round-tripping.
    pub smart_tag_pr: Option<crate::ExtensionList>,
    /// Smart tag type definitions (CT_SmartTagTypes).
    /// Preserved as raw XML for round-tripping.
    pub smart_tag_types: Option<crate::ExtensionList>,
    /// Web publishing settings (CT_WebPublishing).
    /// Preserved as raw XML for round-tripping.
    pub web_publishing: Option<crate::ExtensionList>,
    /// File recovery properties (CT_FileRecoveryPr).
    pub file_recovery_pr: Vec<FileRecoveryPr>,
    /// Web publish objects (CT_WebPublishObjects).
    /// Preserved as raw XML for round-tripping.
    pub web_publish_objects: Option<crate::ExtensionList>,
    /// Extension list for vendor-specific data (CT_ExtensionList).
    pub ext_lst: Option<crate::ExtensionList>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- SheetState ---

    #[test]
    fn sheet_state_roundtrip() {
        let variants = [
            SheetState::Visible,
            SheetState::Hidden,
            SheetState::VeryHidden,
        ];
        for v in &variants {
            assert_eq!(SheetState::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(SheetState::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- CalcMode ---

    #[test]
    fn calc_mode_roundtrip() {
        let variants = [CalcMode::Auto, CalcMode::AutoNoTable, CalcMode::Manual];
        for v in &variants {
            assert_eq!(CalcMode::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(CalcMode::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- RefMode ---

    #[test]
    fn ref_mode_roundtrip() {
        let variants = [RefMode::A1, RefMode::R1C1];
        for v in &variants {
            assert_eq!(RefMode::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(RefMode::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- ObjectDisplayMode ---

    #[test]
    fn object_display_mode_roundtrip() {
        let variants = [
            ObjectDisplayMode::All,
            ObjectDisplayMode::Placeholders,
            ObjectDisplayMode::None,
        ];
        for v in &variants {
            assert_eq!(ObjectDisplayMode::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(ObjectDisplayMode::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- UpdateLinks ---

    #[test]
    fn update_links_roundtrip() {
        let variants = [
            UpdateLinks::UserSet,
            UpdateLinks::Never,
            UpdateLinks::Always,
        ];
        for v in &variants {
            assert_eq!(UpdateLinks::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(UpdateLinks::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- Visibility ---

    #[test]
    fn visibility_roundtrip() {
        let variants = [
            Visibility::Visible,
            Visibility::Hidden,
            Visibility::VeryHidden,
        ];
        for v in &variants {
            assert_eq!(Visibility::from_ooxml(v.to_ooxml()), *v);
            assert_eq!(Visibility::from_bytes(v.to_ooxml().as_bytes()), *v);
        }
    }

    // --- DdeValueType ---

    #[test]
    fn dde_value_type_roundtrip() {
        let variants = [
            (DdeValueType::Nil, "nil"),
            (DdeValueType::Boolean, "b"),
            (DdeValueType::Number, "n"),
            (DdeValueType::Error, "e"),
            (DdeValueType::Str, "str"),
        ];
        for (variant, s) in &variants {
            assert_eq!(DdeValueType::from_ooxml(s), *variant, "from_ooxml({s})");
            assert_eq!(variant.to_ooxml(), *s, "to_ooxml for {s}");
            assert_eq!(
                DdeValueType::from_bytes(s.as_bytes()),
                *variant,
                "from_bytes({s})"
            );
        }
    }

    #[test]
    fn dde_value_type_unknown_defaults_to_nil() {
        assert_eq!(DdeValueType::from_ooxml("bogus"), DdeValueType::Nil);
        assert_eq!(DdeValueType::from_bytes(b"bogus"), DdeValueType::Nil);
    }

    // --- Unknown enum defaults ---

    #[test]
    fn unknown_enum_defaults() {
        assert_eq!(SheetState::from_ooxml("bogus"), SheetState::Visible);
        assert_eq!(SheetState::from_bytes(b"bogus"), SheetState::Visible);

        assert_eq!(CalcMode::from_ooxml("bogus"), CalcMode::Auto);
        assert_eq!(CalcMode::from_bytes(b"bogus"), CalcMode::Auto);

        assert_eq!(RefMode::from_ooxml("bogus"), RefMode::A1);
        assert_eq!(RefMode::from_bytes(b"bogus"), RefMode::A1);

        assert_eq!(
            ObjectDisplayMode::from_ooxml("bogus"),
            ObjectDisplayMode::All
        );
        assert_eq!(
            ObjectDisplayMode::from_bytes(b"bogus"),
            ObjectDisplayMode::All
        );

        assert_eq!(UpdateLinks::from_ooxml("bogus"), UpdateLinks::UserSet);
        assert_eq!(UpdateLinks::from_bytes(b"bogus"), UpdateLinks::UserSet);

        assert_eq!(Visibility::from_ooxml("bogus"), Visibility::Visible);
        assert_eq!(Visibility::from_bytes(b"bogus"), Visibility::Visible);
    }

    // --- Struct defaults ---

    #[test]
    fn workbook_default() {
        let wb = Workbook::default();
        assert!(wb.file_version.is_none());
        assert!(wb.file_sharing.is_none());
        assert!(wb.workbook_pr.is_none());
        assert!(wb.workbook_protection.is_none());
        assert!(wb.book_views.is_empty());
        assert!(wb.sheets.is_empty());
        assert!(wb.defined_names.is_empty());
        assert!(wb.calc_pr.is_none());
        assert!(wb.conformance.is_none());
        assert!(wb.built_in_group_count.is_none());
        assert!(wb.function_groups.is_empty());
        assert!(wb.external_references.is_empty());
        assert!(wb.ole_size.is_none());
        assert!(wb.custom_workbook_views.is_none());
        assert!(wb.pivot_caches.is_empty());
        assert!(wb.smart_tag_pr.is_none());
        assert!(wb.smart_tag_types.is_none());
        assert!(wb.web_publishing.is_none());
        assert!(wb.file_recovery_pr.is_empty());
        assert!(wb.web_publish_objects.is_none());
        assert!(wb.ext_lst.is_none());
    }

    #[test]
    fn book_view_defaults() {
        let bv = BookView::default();
        assert_eq!(bv.visibility, Visibility::Visible);
        assert!(!bv.minimized);
        assert!(bv.show_horizontal_scroll);
        assert!(bv.show_vertical_scroll);
        assert!(bv.show_sheet_tabs);
        assert_eq!(bv.tab_ratio, None);
        assert_eq!(bv.first_sheet, 0);
        assert_eq!(bv.active_tab, 0);
        assert!(bv.auto_filter_date_grouping);
        assert!(bv.x_window.is_none());
        assert!(bv.y_window.is_none());
        assert!(bv.window_width.is_none());
        assert!(bv.window_height.is_none());
        assert!(bv.ext_lst.is_none());
    }

    #[test]
    fn workbook_pr_show_border_unselected_tables_default() {
        let wp = WorkbookPr::default();
        assert!(wp.show_border_unselected_tables);
    }

    #[test]
    fn calc_pr_defaults() {
        let cp = CalcPr::default();
        assert!(cp.calc_id.is_none());
        assert_eq!(cp.calc_mode, CalcMode::Auto);
        assert!(!cp.full_calc_on_load);
        assert_eq!(cp.ref_mode, RefMode::A1);
        assert!(!cp.iterate);
        assert_eq!(cp.iterate_count, 100);
        assert!((cp.iterate_delta - 0.001).abs() < f64::EPSILON);
        assert!(cp.full_precision);
        assert!(cp.calc_completed);
        assert!(cp.calc_on_save);
        assert!(cp.concurrent_calc);
        assert!(cp.concurrent_manual_count.is_none());
        assert!(!cp.force_full_calc);
    }

    #[test]
    fn defined_name_default() {
        let dn = DefinedName::default();
        assert!(dn.name.is_empty());
        assert!(dn.comment.is_none());
        assert!(dn.custom_menu.is_none());
        assert!(dn.description.is_none());
        assert!(dn.help.is_none());
        assert!(dn.status_bar.is_none());
        assert!(dn.local_sheet_id.is_none());
        assert!(!dn.hidden);
        assert!(!dn.function);
        assert!(!dn.vb_procedure);
        assert!(!dn.xlm);
        assert!(dn.function_group_id.is_none());
        assert!(dn.shortcut_key.is_none());
        assert!(!dn.publish_to_server);
        assert!(!dn.workbook_parameter);
        assert!(dn.value.is_empty());
    }

    #[test]
    fn file_sharing_defaults() {
        let fs = FileSharing::default();
        assert!(!fs.read_only_recommended);
        assert!(fs.user_name.is_none());
        assert!(fs.algorithm_name.is_none());
        assert!(fs.hash_value.is_none());
        assert!(fs.salt_value.is_none());
        assert!(fs.spin_count.is_none());
        assert!(fs.reservation_password.is_none());
    }
}
