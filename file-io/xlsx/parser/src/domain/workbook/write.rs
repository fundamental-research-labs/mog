//! Workbook XML writer
//!
//! Generates `xl/workbook.xml` - the main workbook file that defines:
//! - Sheet list (names, rIds, states)
//! - Defined names (named ranges, print areas, etc.)
//! - Workbook views
//! - Calculation settings
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::WorkbookWriter;
//!
//! let xml = WorkbookWriter::new()
//!     .add_sheet("Sheet1", "rId1")
//!     .add_sheet("Sheet2", "rId2")
//!     .add_defined_name("MyRange", "Sheet1!$A$1:$D$10")
//!     .to_xml();
//! ```

use crate::write::xml_writer::XmlWriter;
use domain_types::domain::workbook::{
    FileSharing, FileVersion, ObjectDisplayMode, UpdateLinks, WorkbookProperties,
};

/// Spreadsheet ML namespace
const SPREADSHEET_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
/// Relationships namespace
const RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ============================================================================
// Types
// ============================================================================

/// Re-export `BookView` from ooxml-types as the canonical workbook view type.
pub type WorkbookView = ooxml_types::workbook::BookView;

/// Sheet visibility state — re-exported from `ooxml_types` (single source of truth).
pub use ooxml_types::workbook::SheetState;

/// Convert `SheetState` to OOXML attribute value (None = visible = omit attribute).
fn sheet_state_to_xml_value(state: SheetState) -> Option<&'static str> {
    match state {
        SheetState::Visible => None, // Visible is default, no attribute needed
        SheetState::Hidden => Some("hidden"),
        SheetState::VeryHidden => Some("veryHidden"),
    }
}

/// Sheet definition in workbook
#[derive(Debug, Clone)]
pub struct SheetDef {
    /// Display name of the sheet
    pub name: String,
    /// Unique sheet ID within the workbook
    pub sheet_id: u32,
    /// Relationship ID linking to workbook.xml.rels (e.g., "rId1")
    pub r_id: String,
    /// Sheet visibility state
    pub state: SheetState,
}

impl SheetDef {
    /// Create a new visible sheet definition
    pub fn new(name: impl Into<String>, sheet_id: u32, r_id: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            sheet_id,
            r_id: r_id.into(),
            state: SheetState::Visible,
        }
    }

    /// Create a sheet definition with a specific state
    pub fn with_state(
        name: impl Into<String>,
        sheet_id: u32,
        r_id: impl Into<String>,
        state: SheetState,
    ) -> Self {
        Self {
            name: name.into(),
            sheet_id,
            r_id: r_id.into(),
            state,
        }
    }
}

/// Defined name (named range, print area, etc.)
///
/// Covers all OOXML CT_DefinedName attributes for round-trip fidelity.
#[derive(Debug, Clone)]
pub struct DefinedNameDef {
    /// The name (e.g., "MyRange", "_xlnm.Print_Area")
    pub name: String,
    /// The value/formula (e.g., "Sheet1!$A$1:$D$10")
    pub value: String,
    /// Local sheet index (None for workbook scope)
    pub local_sheet_id: Option<u32>,
    /// Whether the name is hidden
    pub hidden: bool,
    /// Optional comment
    pub comment: Option<String>,
    /// Description text (optional)
    pub description: Option<String>,
    /// Help topic text (optional)
    pub help: Option<String>,
    /// Status bar text (optional)
    pub status_bar: Option<String>,
    /// Custom menu text (optional, for XLM macros)
    pub custom_menu: Option<String>,
    /// Whether this name is a function (XLM macro function)
    pub function: bool,
    /// Whether this is a VBA procedure name
    pub vb_procedure: bool,
    /// Whether this is an XLM macro
    pub xlm: bool,
    /// Whether to publish this name to the server (SharePoint)
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (for web queries)
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted
    pub xml_space_preserve: bool,
}

impl DefinedNameDef {
    /// Create a new workbook-scoped defined name
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            local_sheet_id: None,
            hidden: false,
            comment: None,
            description: None,
            help: None,
            status_bar: None,
            custom_menu: None,
            function: false,
            vb_procedure: false,
            xlm: false,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
        }
    }

    /// Create a sheet-scoped defined name
    pub fn with_sheet_scope(
        name: impl Into<String>,
        value: impl Into<String>,
        sheet_index: u32,
    ) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
            local_sheet_id: Some(sheet_index),
            hidden: false,
            comment: None,
            description: None,
            help: None,
            status_bar: None,
            custom_menu: None,
            function: false,
            vb_procedure: false,
            xlm: false,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
        }
    }
}

/// Re-export `CalcPr` from ooxml-types as the canonical calculation settings type.
pub type CalcSettings = ooxml_types::workbook::CalcPr;

/// Re-export `CalcMode` from ooxml-types as the canonical calc mode type.
pub use ooxml_types::workbook::CalcMode;

/// Convert `domain_types::CalculationProperties` into an `ooxml_types::CalcPr` for the workbook writer.
pub fn calc_settings_from_domain(calc_props: &domain_types::CalculationProperties) -> CalcSettings {
    let ooxml_calc_pr: ooxml_types::workbook::CalcPr = calc_props.clone().into();
    // Override calc_id: if not set in domain, use 191029 (legacy default).
    ooxml_types::workbook::CalcPr {
        calc_id: calc_props.calc_id.or(Some(191029)),
        ..ooxml_calc_pr
    }
}

fn object_display_mode_to_xml(mode: ObjectDisplayMode) -> &'static str {
    match mode {
        ObjectDisplayMode::All => "all",
        ObjectDisplayMode::Placeholders => "placeholders",
        ObjectDisplayMode::None => "none",
    }
}

fn update_links_to_xml(update_links: UpdateLinks) -> &'static str {
    match update_links {
        UpdateLinks::UserSet => "userSet",
        UpdateLinks::Never => "never",
        UpdateLinks::Always => "always",
    }
}

// ============================================================================
// WorkbookWriter
// ============================================================================

/// The workbook writer
///
/// Generates `xl/workbook.xml` content for XLSX files.
#[derive(Debug, Clone, Default)]
pub struct WorkbookWriter {
    /// File version metadata.
    file_version: Option<FileVersion>,
    /// File sharing metadata.
    file_sharing: Option<FileSharing>,
    /// Workbook properties.
    workbook_properties: Option<WorkbookProperties>,
    /// Sheet definitions
    sheets: Vec<SheetDef>,
    /// Defined names
    defined_names: Vec<DefinedNameDef>,
    /// Workbook views
    workbook_views: Vec<WorkbookView>,
    /// Calculation settings
    calc_settings: Option<CalcSettings>,
    /// Structured workbook protection (converted to XML on write).
    workbook_protection: Option<domain_types::WorkbookProtection>,
    /// Raw XML for the <pivotCaches> element.
    pivot_caches_xml: Option<String>,
    /// Workbook relationship ids for `<externalReferences>` in formula ordinal order.
    external_reference_r_ids: Vec<String>,
    /// Tier 2: Captured namespace declarations for round-trip fidelity
    preserved_namespaces: Option<crate::roundtrip::namespaces::NamespaceMap>,
    /// Tier 2: Captured unknown child elements for round-trip fidelity
    preserved_elements: Option<crate::roundtrip::unknown_elements::PreservedElements>,
}

impl WorkbookWriter {
    /// Create a new workbook writer
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a sheet definition
    ///
    /// The sheet ID is auto-assigned based on the number of sheets.
    ///
    /// # Arguments
    /// * `name` - Display name of the sheet
    /// * `r_id` - Relationship ID (e.g., "rId1")
    pub fn add_sheet(&mut self, name: &str, r_id: &str) -> &mut Self {
        let sheet_id = self.sheets.len() as u32 + 1;
        self.sheets.push(SheetDef::new(name, sheet_id, r_id));
        self
    }

    /// Add a sheet definition with specific state
    ///
    /// # Arguments
    /// * `name` - Display name of the sheet
    /// * `r_id` - Relationship ID (e.g., "rId1")
    /// * `state` - Sheet visibility state
    pub fn add_sheet_with_state(&mut self, name: &str, r_id: &str, state: SheetState) -> &mut Self {
        let sheet_id = self.sheets.len() as u32 + 1;
        self.sheets
            .push(SheetDef::with_state(name, sheet_id, r_id, state));
        self
    }

    /// Add a pre-built sheet definition (preserves original sheetId).
    pub fn add_sheet_def(&mut self, def: SheetDef) -> &mut Self {
        self.sheets.push(def);
        self
    }

    /// Add a defined name (workbook scope)
    ///
    /// # Arguments
    /// * `name` - The name (e.g., "MyRange")
    /// * `value` - The value/formula (e.g., "Sheet1!$A$1:$D$10")
    pub fn add_defined_name(&mut self, name: &str, value: &str) -> &mut Self {
        self.defined_names.push(DefinedNameDef::new(name, value));
        self
    }

    /// Add a defined name with full options
    ///
    /// # Arguments
    /// * `def` - Complete defined name definition
    pub fn add_defined_name_full(&mut self, def: DefinedNameDef) -> &mut Self {
        self.defined_names.push(def);
        self
    }

    /// Add print area for a sheet
    ///
    /// Creates a `_xlnm.Print_Area` defined name.
    ///
    /// # Arguments
    /// * `sheet_index` - 0-based sheet index
    /// * `range` - The range reference (e.g., "Sheet1!$A$1:$G$20")
    pub fn add_print_area(&mut self, sheet_index: u32, range: &str) -> &mut Self {
        self.defined_names.push(DefinedNameDef {
            name: "_xlnm.Print_Area".to_string(),
            value: range.to_string(),
            local_sheet_id: Some(sheet_index),
            ..DefinedNameDef::new("", "")
        });
        self
    }

    /// Add print titles (repeat rows/columns) for a sheet
    ///
    /// Creates a `_xlnm.Print_Titles` defined name.
    ///
    /// # Arguments
    /// * `sheet_index` - 0-based sheet index
    /// * `value` - The row/column references (e.g., "Sheet1!$1:$1" for repeat row 1)
    pub fn add_print_titles(&mut self, sheet_index: u32, value: &str) -> &mut Self {
        self.defined_names.push(DefinedNameDef {
            name: "_xlnm.Print_Titles".to_string(),
            value: value.to_string(),
            local_sheet_id: Some(sheet_index),
            ..DefinedNameDef::new("", "")
        });
        self
    }

    /// Set workbook view
    ///
    /// # Arguments
    /// * `view` - Workbook view settings
    pub fn set_view(&mut self, view: WorkbookView) -> &mut Self {
        // Replace existing views or add if empty
        self.workbook_views = vec![view];
        self
    }

    /// Set all workbook views for round-trip fidelity of multiple `<workbookView>` elements.
    pub fn set_views(&mut self, views: Vec<WorkbookView>) -> &mut Self {
        self.workbook_views = views;
        self
    }

    /// Set workbook protection from a domain type.
    ///
    /// The protection is converted to XML on write using the `WorkbookProtectionWrite` trait.
    pub fn set_workbook_protection(&mut self, prot: domain_types::WorkbookProtection) -> &mut Self {
        self.workbook_protection = Some(prot);
        self
    }

    /// Set file version metadata.
    pub fn set_file_version(&mut self, file_version: FileVersion) -> &mut Self {
        self.file_version = Some(file_version);
        self
    }

    /// Set file sharing metadata.
    pub fn set_file_sharing(&mut self, file_sharing: FileSharing) -> &mut Self {
        self.file_sharing = Some(file_sharing);
        self
    }

    /// Set workbook properties.
    pub fn set_workbook_properties(
        &mut self,
        workbook_properties: WorkbookProperties,
    ) -> &mut Self {
        self.workbook_properties = Some(workbook_properties);
        self
    }

    /// Set the raw `<pivotCaches>` XML element for workbook.xml.
    pub fn set_pivot_caches_xml(&mut self, xml: String) -> &mut Self {
        self.pivot_caches_xml = Some(xml);
        self
    }

    /// Set workbook external reference relationship ids in formula ordinal order.
    pub fn set_external_reference_r_ids(&mut self, r_ids: Vec<String>) -> &mut Self {
        self.external_reference_r_ids = r_ids;
        self
    }

    /// Set calculation settings
    ///
    /// # Arguments
    /// * `settings` - Calculation settings
    pub fn set_calc_settings(&mut self, settings: CalcSettings) -> &mut Self {
        self.calc_settings = Some(settings);
        self
    }

    /// Get the number of sheets
    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    /// Set preserved namespace declarations for round-trip fidelity.
    pub fn set_preserved_namespaces(
        &mut self,
        ns: crate::roundtrip::namespaces::NamespaceMap,
    ) -> &mut Self {
        self.preserved_namespaces = Some(ns);
        self
    }

    /// Set preserved unknown elements for round-trip fidelity.
    pub fn set_preserved_elements(
        &mut self,
        elements: crate::roundtrip::unknown_elements::PreservedElements,
    ) -> &mut Self {
        self.preserved_elements = Some(elements);
        self
    }

    fn should_skip_preserved_element(&self, raw_xml: &str) -> bool {
        (self.pivot_caches_xml.is_some() && raw_xml.contains("<pivotCaches"))
            || raw_xml.contains("<fileVersion")
            || raw_xml.contains("<fileSharing")
            || raw_xml.contains("<workbookPr")
            || raw_xml.contains("<externalReferences")
    }

    /// Generate workbook.xml content
    pub fn to_xml(&self) -> Vec<u8> {
        let mut w = XmlWriter::new();

        // XML declaration
        w.write_declaration();

        // <workbook> root element with namespaces
        w.start_element("workbook")
            .attr("xmlns", SPREADSHEET_NS)
            .attr("xmlns:r", RELATIONSHIPS_NS);

        // Tier 2: Emit captured extension namespace declarations
        // Build mc:Ignorable from preserved namespaces
        if let Some(ref ns) = self.preserved_namespaces {
            use crate::write::mc_builder::McIgnorableBuilder;

            let mut mc_builder = McIgnorableBuilder::new();
            mc_builder.add_from_namespace_map(ns);

            // Emit xmlns:mc and mc:Ignorable right after xmlns:r, matching Excel's attribute
            // ordering where mc:Ignorable appears before the extension xmlns: declarations.
            if !mc_builder.is_empty() {
                w.attr(
                    "xmlns:mc",
                    "http://schemas.openxmlformats.org/markup-compatibility/2006",
                );
                if let Some(ignorable) = mc_builder.build() {
                    w.attr("mc:Ignorable", &ignorable);
                }
            }

            // Emit extension namespace declarations (skip default, r, and mc which are already emitted)
            for decl in ns.all() {
                if let Some(ref prefix) = decl.prefix {
                    if prefix != "r" && prefix != "mc" {
                        w.attr(&format!("xmlns:{}", prefix), &decl.uri);
                    }
                }
            }
        }

        w.end_attrs();

        // Tier 2: Emit preserved elements with position First
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_first("workbook") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        self.write_file_version(&mut w);

        // Emit preserved elements after fileVersion (e.g., workbookPr if preserved)
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "fileVersion") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        self.write_file_sharing(&mut w);
        self.write_workbook_properties(&mut w);

        // Emit preserved elements after workbookPr (e.g., mc:AlternateContent, xr:revisionPtr)
        // These appear before <bookViews> in Excel's canonical order:
        // fileVersion → fileSharing → workbookPr → alternateContent → bookViews → sheets → …
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "workbookPr") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Emit any explicitly BeforeElement("bookViews") elements
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_before("workbook", "bookViews") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // <bookViews>
        self.write_book_views(&mut w);

        // Emit preserved elements after bookViews
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "bookViews") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // <sheets>
        self.write_sheets(&mut w);

        // Emit preserved elements after sheets
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "sheets") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // <workbookProtection> (between sheets and definedNames per OOXML spec)
        if let Some(ref prot) = self.workbook_protection {
            use crate::domain::protection::write::WorkbookProtectionWrite;
            let ooxml_prot: ooxml_types::protection::WorkbookProtection = prot.clone().into();
            ooxml_prot.write_to(&mut w);
        }

        // <externalReferences>
        self.write_external_references(&mut w);

        // <definedNames>
        self.write_defined_names(&mut w);

        // Emit preserved elements after definedNames
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "definedNames") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // <calcPr>
        self.write_calc_settings(&mut w);

        // Emit preserved elements after calcPr
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "calcPr") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // <pivotCaches>
        if let Some(ref pivot_caches) = self.pivot_caches_xml {
            w.raw_str(pivot_caches);
        }

        // Emit preserved elements after pivotCaches
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_after("workbook", "pivotCaches") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Tier 2: Emit preserved elements with position Last
        if let Some(ref preserved) = self.preserved_elements {
            for elem in preserved.get_last("workbook") {
                if self.should_skip_preserved_element(&elem.raw_xml) {
                    continue;
                }
                w.raw_str(&elem.raw_xml);
            }
        }

        // Close </workbook>
        w.end_element("workbook");

        w.finish()
    }

    fn write_file_version(&self, w: &mut XmlWriter) {
        let Some(file_version) = &self.file_version else {
            return;
        };

        w.start_element("fileVersion")
            .attr_if("appName", file_version.app_name.as_deref())
            .attr_if("lastEdited", file_version.last_edited.as_deref())
            .attr_if("lowestEdited", file_version.lowest_edited.as_deref())
            .attr_if("rupBuild", file_version.rup_build.as_deref())
            .attr_if("codeName", file_version.code_name.as_deref())
            .self_close();
    }

    fn write_file_sharing(&self, w: &mut XmlWriter) {
        let Some(file_sharing) = &self.file_sharing else {
            return;
        };

        let mut elem = w.start_element("fileSharing");
        if file_sharing.read_only_recommended {
            elem = elem.attr_bool("readOnlyRecommended", true);
        }
        elem.attr_if("userName", file_sharing.user_name.as_deref())
            .attr_if(
                "reservationPassword",
                file_sharing.reservation_password.as_deref(),
            )
            .attr_if("algorithmName", file_sharing.algorithm_name.as_deref())
            .attr_if("hashValue", file_sharing.hash_value.as_deref())
            .attr_if("saltValue", file_sharing.salt_value.as_deref())
            .attr_num_if("spinCount", file_sharing.spin_count)
            .self_close();
    }

    fn write_workbook_properties(&self, w: &mut XmlWriter) {
        let Some(properties) = &self.workbook_properties else {
            return;
        };
        let defaults = WorkbookProperties::default();

        let mut elem = w.start_element("workbookPr");
        if properties.date1904 != defaults.date1904 {
            elem = elem.attr_bool("date1904", properties.date1904);
        }
        if properties.show_objects != defaults.show_objects {
            elem = elem.attr(
                "showObjects",
                object_display_mode_to_xml(properties.show_objects),
            );
        }
        if properties.show_border_unselected_tables != defaults.show_border_unselected_tables {
            elem = elem.attr_bool(
                "showBorderUnselectedTables",
                properties.show_border_unselected_tables,
            );
        }
        if properties.filter_privacy != defaults.filter_privacy {
            elem = elem.attr_bool("filterPrivacy", properties.filter_privacy);
        }
        if properties.prompted_solutions != defaults.prompted_solutions {
            elem = elem.attr_bool("promptedSolutions", properties.prompted_solutions);
        }
        if properties.show_ink_annotation != defaults.show_ink_annotation {
            elem = elem.attr_bool("showInkAnnotation", properties.show_ink_annotation);
        }
        if properties.backup_file != defaults.backup_file {
            elem = elem.attr_bool("backupFile", properties.backup_file);
        }
        if properties.save_external_link_values != defaults.save_external_link_values {
            elem = elem.attr_bool(
                "saveExternalLinkValues",
                properties.save_external_link_values,
            );
        }
        if properties.update_links != defaults.update_links {
            elem = elem.attr("updateLinks", update_links_to_xml(properties.update_links));
        }
        elem = elem.attr_if("codeName", properties.code_name.as_deref());
        if properties.hide_pivot_field_list != defaults.hide_pivot_field_list {
            elem = elem.attr_bool("hidePivotFieldList", properties.hide_pivot_field_list);
        }
        if properties.show_pivot_chart_filter != defaults.show_pivot_chart_filter {
            elem = elem.attr_bool("showPivotChartFilter", properties.show_pivot_chart_filter);
        }
        if properties.allow_refresh_query != defaults.allow_refresh_query {
            elem = elem.attr_bool("allowRefreshQuery", properties.allow_refresh_query);
        }
        if properties.publish_items != defaults.publish_items {
            elem = elem.attr_bool("publishItems", properties.publish_items);
        }
        if properties.check_compatibility != defaults.check_compatibility {
            elem = elem.attr_bool("checkCompatibility", properties.check_compatibility);
        }
        if properties.auto_compress_pictures != defaults.auto_compress_pictures {
            elem = elem.attr_bool("autoCompressPictures", properties.auto_compress_pictures);
        }
        if properties.refresh_all_connections != defaults.refresh_all_connections {
            elem = elem.attr_bool("refreshAllConnections", properties.refresh_all_connections);
        }
        elem.attr_num_if("defaultThemeVersion", properties.default_theme_version)
            .self_close();
    }

    fn write_external_references(&self, w: &mut XmlWriter) {
        if self.external_reference_r_ids.is_empty() {
            return;
        }
        w.start_element("externalReferences").end_attrs();
        for r_id in &self.external_reference_r_ids {
            w.start_element("externalReference")
                .attr("r:id", r_id)
                .self_close();
        }
        w.end_element("externalReferences");
    }

    /// Write bookViews section
    fn write_book_views(&self, w: &mut XmlWriter) {
        let views = if self.workbook_views.is_empty() {
            // Use default view if none specified
            vec![WorkbookView::default()]
        } else {
            self.workbook_views.clone()
        };

        w.start_element("bookViews").end_attrs();

        for view in &views {
            w.start_element("workbookView");

            // Position and size
            if let Some(x) = view.x_window {
                w.attr_num("xWindow", x);
            }
            if let Some(y) = view.y_window {
                w.attr_num("yWindow", y);
            }
            if let Some(width) = view.window_width {
                w.attr_num("windowWidth", width);
            }
            if let Some(height) = view.window_height {
                w.attr_num("windowHeight", height);
            }

            // First sheet (only write if not 0) — Excel canonical order: firstSheet before activeTab
            if view.first_sheet != 0 {
                w.attr_num("firstSheet", view.first_sheet);
            }

            // Active tab (only write if not 0)
            if view.active_tab != 0 {
                w.attr_num("activeTab", view.active_tab);
            }

            // Tab ratio (only write if explicitly set)
            if let Some(ratio) = view.tab_ratio {
                w.attr_num("tabRatio", ratio);
            }

            // Scroll bars and tabs (only write if false, since true is default)
            if !view.show_horizontal_scroll {
                w.attr_bool("showHorizontalScroll", false);
            }
            if !view.show_vertical_scroll {
                w.attr_bool("showVerticalScroll", false);
            }
            if !view.show_sheet_tabs {
                w.attr_bool("showSheetTabs", false);
            }

            // autoFilterDateGrouping (only write if false; true is default)
            if !view.auto_filter_date_grouping {
                w.attr_bool("autoFilterDateGrouping", false);
            }

            if let Some(uid) = &view.xr_uid {
                w.attr("xr2:uid", uid);
            }

            w.self_close();
        }

        w.end_element("bookViews");
    }

    /// Write sheets section
    fn write_sheets(&self, w: &mut XmlWriter) {
        if self.sheets.is_empty() {
            // Must have at least one sheet placeholder
            w.start_element("sheets").end_attrs();
            w.start_element("sheet")
                .attr("name", "Sheet1")
                .attr_num("sheetId", 1)
                .attr("r:id", "rId1")
                .self_close();
            w.end_element("sheets");
            return;
        }

        w.start_element("sheets").end_attrs();

        // Excel canonical attribute order: name, sheetId, state, r:id
        for sheet in &self.sheets {
            w.start_element("sheet")
                .attr("name", &sheet.name)
                .attr_num("sheetId", sheet.sheet_id);

            // Add state attribute if not visible (before r:id per spec)
            if let Some(state) = sheet_state_to_xml_value(sheet.state) {
                w.attr("state", state);
            }

            w.attr("r:id", &sheet.r_id).self_close();
        }

        w.end_element("sheets");
    }

    /// Write definedNames section
    ///
    /// Emits all OOXML CT_DefinedName attributes for full round-trip fidelity.
    /// Attribute order follows the XSD sequence: name, comment, customMenu,
    /// description, help, statusBar, localSheetId, hidden, function,
    /// vbProcedure, xlm, publishToServer, workbookParameter.
    fn write_defined_names(&self, w: &mut XmlWriter) {
        if self.defined_names.is_empty() {
            return;
        }

        w.start_element("definedNames").end_attrs();

        for def in &self.defined_names {
            w.start_element("definedName").attr("name", &def.name);

            // Comment
            if let Some(comment) = &def.comment {
                w.attr("comment", comment);
            }

            // Custom menu text
            if let Some(custom_menu) = &def.custom_menu {
                w.attr("customMenu", custom_menu);
            }

            // Description
            if let Some(description) = &def.description {
                w.attr("description", description);
            }

            // Help topic
            if let Some(help) = &def.help {
                w.attr("help", help);
            }

            // Status bar text
            if let Some(status_bar) = &def.status_bar {
                w.attr("statusBar", status_bar);
            }

            // Local sheet scope
            if let Some(sheet_id) = def.local_sheet_id {
                w.attr_num("localSheetId", sheet_id);
            }

            // Hidden flag
            if def.hidden {
                w.attr_bool("hidden", true);
            }

            // Function flag (XLM macro function)
            if def.function {
                w.attr_bool("function", true);
            }

            // VBA procedure flag
            if def.vb_procedure {
                w.attr_bool("vbProcedure", true);
            }

            // XLM macro flag
            if def.xlm {
                w.attr_bool("xlm", true);
            }

            // Publish to server flag
            if def.publish_to_server {
                w.attr_bool("publishToServer", true);
            }

            // Workbook parameter flag
            if def.workbook_parameter {
                w.attr_bool("workbookParameter", true);
            }

            // xml:space="preserve" — preserves whitespace in the value content
            if def.xml_space_preserve {
                w.attr("xml:space", "preserve");
            }

            w.end_attrs().text(&def.value).end_element("definedName");
        }

        w.end_element("definedNames");
    }

    /// Write calcPr section
    ///
    /// Emits all OOXML CT_CalcPr attributes for full round-trip fidelity.
    /// Attributes with spec-defined defaults are only emitted when they
    /// differ from the default (e.g. calcOnSave="0" is emitted, but
    /// calcOnSave="1" is not since true is the default).
    fn write_calc_settings(&self, w: &mut XmlWriter) {
        let settings = self.calc_settings.as_ref().cloned().unwrap_or_default();

        // Use the stored calcId, falling back to 0 (recalc on open).
        let calc_id = settings.calc_id.unwrap_or(0);
        w.start_element("calcPr").attr_num("calcId", calc_id);

        // Calc mode (only write if not auto)
        if settings.calc_mode != CalcMode::Auto {
            w.attr("calcMode", settings.calc_mode.to_ooxml());
        }

        // Full calc on load
        if settings.full_calc_on_load {
            w.attr_bool("fullCalcOnLoad", true);
        }

        // Reference mode (only write if not A1, which is the default)
        if settings.ref_mode != ooxml_types::workbook::RefMode::A1 {
            w.attr("refMode", settings.ref_mode.to_ooxml());
        }

        // Iterative calculation flag
        if settings.iterate {
            w.attr_bool("iterate", true);
        }

        // iterateCount / iterateDelta — emit when they differ from
        // the OOXML defaults (100 / 0.001), or when they were explicitly
        // present in the source XML (for round-trip fidelity).
        if settings.iterate_count != 100 || settings.has_explicit_iterate_count {
            w.attr_num("iterateCount", settings.iterate_count);
        }
        if (settings.iterate_delta - 0.001).abs() > f64::EPSILON
            || settings.has_explicit_iterate_delta
        {
            w.attr_num("iterateDelta", settings.iterate_delta);
        }

        // fullPrecision — default is true, only emit when explicitly false
        if !settings.full_precision {
            w.attr_bool("fullPrecision", false);
        }

        // calcCompleted — default is true, only emit when false
        if !settings.calc_completed {
            w.attr_bool("calcCompleted", false);
        }

        // calcOnSave — default is true, only emit when explicitly false
        if !settings.calc_on_save {
            w.attr_bool("calcOnSave", false);
        }

        // concurrentCalc — default is true, only emit when explicitly false
        if !settings.concurrent_calc {
            w.attr_bool("concurrentCalc", false);
        }

        // concurrentManualCount — emit when present
        if let Some(cmc) = settings.concurrent_manual_count {
            w.attr_num("concurrentManualCount", cmc);
        }

        // forceFullCalc — default false, emit when true
        if settings.force_full_calc {
            w.attr_bool("forceFullCalc", true);
        }

        w.self_close();
    }
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // Basic workbook tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_empty_workbook() {
        let writer = WorkbookWriter::new();
        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Should have XML declaration
        assert!(xml.contains("<?xml version=\"1.0\""));

        // Should have workbook element with namespaces
        assert!(xml.contains("<workbook"));
        assert!(
            xml.contains("xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"")
        );
        assert!(xml.contains(
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\""
        ));

        // Should have default sheet
        assert!(xml.contains("<sheets>"));
        assert!(xml.contains("name=\"Sheet1\""));
        assert!(xml.contains("</sheets>"));

        // Should have bookViews
        assert!(xml.contains("<bookViews>"));
        assert!(xml.contains("</bookViews>"));

        // Should have calcPr
        assert!(xml.contains("<calcPr"));
    }

    #[test]
    fn test_single_sheet() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("MySheet", "rId1");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("name=\"MySheet\""));
        assert!(xml.contains("sheetId=\"1\""));
        assert!(xml.contains("r:id=\"rId1\""));
    }

    #[test]
    fn test_multiple_sheets() {
        let mut writer = WorkbookWriter::new();
        writer
            .add_sheet("Sheet1", "rId1")
            .add_sheet("Data", "rId2")
            .add_sheet("Summary", "rId3");

        assert_eq!(writer.sheet_count(), 3);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("name=\"Sheet1\""));
        assert!(xml.contains("name=\"Data\""));
        assert!(xml.contains("name=\"Summary\""));

        // Check sheet IDs are sequential
        assert!(xml.contains("sheetId=\"1\""));
        assert!(xml.contains("sheetId=\"2\""));
        assert!(xml.contains("sheetId=\"3\""));
    }

    #[test]
    fn test_sheet_name_with_special_characters() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Sales & Marketing <2024>", "rId1");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Name should be XML-escaped
        assert!(xml.contains("name=\"Sales &amp; Marketing &lt;2024&gt;\""));
    }

    // -------------------------------------------------------------------------
    // Sheet state tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_hidden_sheet() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Visible", "rId1").add_sheet_with_state(
            "Hidden",
            "rId2",
            SheetState::Hidden,
        );

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Visible sheet should not have state attribute (name first, matching Excel's canonical order)
        assert!(xml.contains("name=\"Visible\" sheetId=\"1\" r:id=\"rId1\""));

        // Hidden sheet should have state="hidden" (before r:id per spec)
        assert!(xml.contains("name=\"Hidden\" sheetId=\"2\" state=\"hidden\" r:id=\"rId2\""));
    }

    #[test]
    fn test_very_hidden_sheet() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet_with_state("VeryHidden", "rId1", SheetState::VeryHidden);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("state=\"veryHidden\""));
    }

    // -------------------------------------------------------------------------
    // Defined name tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_defined_name_workbook_scope() {
        let mut writer = WorkbookWriter::new();
        writer
            .add_sheet("Sheet1", "rId1")
            .add_defined_name("MyRange", "Sheet1!$A$1:$D$10");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("<definedNames>"));
        assert!(xml.contains("<definedName name=\"MyRange\">Sheet1!$A$1:$D$10</definedName>"));
        assert!(xml.contains("</definedNames>"));
    }

    #[test]
    fn test_defined_name_sheet_scope() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Sheet1", "rId1");

        let def = DefinedNameDef::with_sheet_scope("LocalRange", "Sheet1!$A$1", 0);
        writer.add_defined_name_full(def);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("localSheetId=\"0\""));
    }

    #[test]
    fn test_defined_name_hidden() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Sheet1", "rId1");

        let def = DefinedNameDef {
            name: "HiddenName".to_string(),
            value: "Sheet1!$A$1".to_string(),
            hidden: true,
            ..DefinedNameDef::new("", "")
        };
        writer.add_defined_name_full(def);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("hidden=\"1\""));
    }

    #[test]
    fn test_print_area() {
        let mut writer = WorkbookWriter::new();
        writer
            .add_sheet("Sheet1", "rId1")
            .add_print_area(0, "Sheet1!$A$1:$G$20");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("name=\"_xlnm.Print_Area\""));
        assert!(xml.contains("localSheetId=\"0\""));
        assert!(xml.contains("Sheet1!$A$1:$G$20"));
    }

    #[test]
    fn test_print_titles() {
        let mut writer = WorkbookWriter::new();
        writer
            .add_sheet("Sheet1", "rId1")
            .add_print_titles(0, "Sheet1!$1:$2");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("name=\"_xlnm.Print_Titles\""));
        assert!(xml.contains("Sheet1!$1:$2"));
    }

    // -------------------------------------------------------------------------
    // Workbook view tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_default_view() {
        let writer = WorkbookWriter::new();
        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("<workbookView"));
        // Default view has no window attributes
        assert!(!xml.contains("windowWidth="));
        assert!(!xml.contains("windowHeight="));
    }

    #[test]
    fn test_custom_view() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Sheet1", "rId1");
        writer.add_sheet("Sheet2", "rId2");

        let view = WorkbookView {
            active_tab: 1,
            first_sheet: 0,
            show_horizontal_scroll: true,
            show_vertical_scroll: true,
            show_sheet_tabs: false,
            window_width: Some(20000),
            window_height: Some(10000),
            x_window: Some(100),
            y_window: Some(50),
            ..Default::default()
        };
        writer.set_view(view);

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("activeTab=\"1\""));
        assert!(xml.contains("windowWidth=\"20000\""));
        assert!(xml.contains("windowHeight=\"10000\""));
        assert!(xml.contains("xWindow=\"100\""));
        assert!(xml.contains("yWindow=\"50\""));
        assert!(xml.contains("showSheetTabs=\"0\""));
    }

    // -------------------------------------------------------------------------
    // Calculation settings tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_default_calc_settings() {
        let writer = WorkbookWriter::new();
        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("<calcPr calcId=\"0\"/>"));
    }

    #[test]
    fn test_manual_calc_mode() {
        let mut writer = WorkbookWriter::new();
        writer.set_calc_settings(CalcSettings {
            calc_mode: CalcMode::Manual,
            ..Default::default()
        });

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("calcMode=\"manual\""));
    }

    #[test]
    fn test_iterative_calculation() {
        let mut writer = WorkbookWriter::new();
        writer.set_calc_settings(CalcSettings {
            calc_mode: CalcMode::Auto,
            full_calc_on_load: true,
            iterate: true,
            iterate_count: 200,
            iterate_delta: 0.01,
            ..Default::default()
        });

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        assert!(xml.contains("fullCalcOnLoad=\"1\""));
        assert!(xml.contains("iterate=\"1\""));
        assert!(xml.contains("iterateCount=\"200\""));
        assert!(xml.contains("iterateDelta=\"0.01\""));
    }

    // -------------------------------------------------------------------------
    // XML output format tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_complete_workbook_xml() {
        let mut writer = WorkbookWriter::new();
        writer
            .add_sheet("Sheet1", "rId1")
            .add_sheet("Sheet2", "rId2")
            .add_sheet_with_state("Hidden", "rId3", SheetState::Hidden)
            .add_defined_name("MyRange", "Sheet1!$A$1:$D$10")
            .add_print_area(0, "Sheet1!$A$1:$G$20");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Verify overall structure
        assert!(xml.starts_with("<?xml version=\"1.0\""));
        assert!(xml.contains("<workbook"));
        // fileVersion and workbookPr are no longer emitted by default
        assert!(xml.contains("<bookViews>"));
        assert!(xml.contains("<sheets>"));
        assert!(xml.contains("<definedNames>"));
        assert!(xml.contains("<calcPr"));
        assert!(xml.contains("</workbook>"));

        // Verify order: sheets should appear before definedNames
        let sheets_pos = xml.find("<sheets>").unwrap();
        let defined_pos = xml.find("<definedNames>").unwrap();
        assert!(sheets_pos < defined_pos);
    }

    #[test]
    fn test_no_defined_names() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Sheet1", "rId1");

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // Should not have definedNames element
        assert!(!xml.contains("<definedNames>"));
    }

    // -------------------------------------------------------------------------
    // Type tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_sheet_def_new() {
        let sheet = SheetDef::new("Test", 1, "rId1");
        assert_eq!(sheet.name, "Test");
        assert_eq!(sheet.sheet_id, 1);
        assert_eq!(sheet.r_id, "rId1");
        assert_eq!(sheet.state, SheetState::Visible);
    }

    #[test]
    fn test_defined_name_def_new() {
        let def = DefinedNameDef::new("Range", "Sheet1!$A$1");
        assert_eq!(def.name, "Range");
        assert_eq!(def.value, "Sheet1!$A$1");
        assert!(def.local_sheet_id.is_none());
        assert!(!def.hidden);
    }

    #[test]
    fn test_sheet_state_to_xml() {
        assert_eq!(sheet_state_to_xml_value(SheetState::Visible), None);
        assert_eq!(sheet_state_to_xml_value(SheetState::Hidden), Some("hidden"));
        assert_eq!(
            sheet_state_to_xml_value(SheetState::VeryHidden),
            Some("veryHidden")
        );
    }

    #[test]
    fn test_calc_mode_to_xml() {
        assert_eq!(CalcMode::Auto.to_ooxml(), "auto");
        assert_eq!(CalcMode::Manual.to_ooxml(), "manual");
        assert_eq!(CalcMode::AutoNoTable.to_ooxml(), "autoNoTable");
    }

    // -------------------------------------------------------------------------
    // Edge case tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_unicode_sheet_name() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("\u{65E5}\u{672C}\u{8A9E}", "rId1"); // Japanese characters

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("name=\"\u{65E5}\u{672C}\u{8A9E}\""));
    }

    #[test]
    fn test_defined_name_with_comment() {
        let mut writer = WorkbookWriter::new();
        writer.add_sheet("Sheet1", "rId1");

        let def = DefinedNameDef {
            name: "MyRange".to_string(),
            value: "Sheet1!$A$1".to_string(),
            comment: Some("This is a test range".to_string()),
            ..DefinedNameDef::new("", "")
        };
        writer.add_defined_name_full(def);

        let xml = String::from_utf8(writer.to_xml()).unwrap();
        assert!(xml.contains("comment=\"This is a test range\""));
    }

    #[test]
    fn test_workbook_view_defaults() {
        let view = WorkbookView::default();
        assert_eq!(view.active_tab, 0);
        assert_eq!(view.first_sheet, 0);
        assert!(view.show_horizontal_scroll);
        assert!(view.show_vertical_scroll);
        assert!(view.show_sheet_tabs);
        assert_eq!(view.window_width, None);
        assert_eq!(view.window_height, None);
    }

    #[test]
    fn test_calc_settings_defaults() {
        let settings = CalcSettings::default();
        assert!(settings.calc_id.is_none());
        assert_eq!(settings.calc_mode, CalcMode::Auto);
        assert!(!settings.full_calc_on_load);
        assert!(!settings.iterate);
        assert_eq!(settings.iterate_count, 100);
        assert!((settings.iterate_delta - 0.001).abs() < f64::EPSILON);
    }

    #[test]
    fn test_calc_id_roundtrip() {
        let mut writer = WorkbookWriter::new();
        writer.set_calc_settings(CalcSettings {
            calc_id: Some(0),
            iterate_count: 200,
            iterate_delta: 0.01,
            ..Default::default()
        });

        let xml = String::from_utf8(writer.to_xml()).unwrap();

        // calc_id should be the value we set
        assert!(xml.contains("calcId=\"0\""));
        // Non-default iterateCount and iterateDelta should be emitted even without iterate=true
        assert!(xml.contains("iterateCount=\"200\""));
        assert!(xml.contains("iterateDelta=\"0.01\""));
        // iterate flag should NOT be present
        assert!(!xml.contains("iterate=\"1\""));
    }
}
