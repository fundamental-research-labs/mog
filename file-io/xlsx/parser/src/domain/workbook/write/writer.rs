use domain_types::domain::workbook::{
    FileSharing, FileVersion, WorkbookProperties, WorkbookWebPublishing,
};

use super::{CalcSettings, DefinedNameDef, SheetDef, SheetState, WorkbookView};

/// The workbook writer.
///
/// Generates `xl/workbook.xml` content for XLSX files.
#[derive(Debug, Clone, Default)]
pub struct WorkbookWriter {
    /// File version metadata.
    pub(super) file_version: Option<FileVersion>,
    /// File sharing metadata.
    pub(super) file_sharing: Option<FileSharing>,
    /// Workbook properties.
    pub(super) workbook_properties: Option<WorkbookProperties>,
    /// Workbook web publishing metadata.
    pub(super) web_publishing: Option<WorkbookWebPublishing>,
    /// Sheet definitions.
    pub(super) sheets: Vec<SheetDef>,
    /// Defined names.
    pub(super) defined_names: Vec<DefinedNameDef>,
    /// Workbook views.
    pub(super) workbook_views: Vec<WorkbookView>,
    /// Raw XML for the <customWorkbookViews> element.
    pub(super) custom_workbook_views_xml: Option<Vec<u8>>,
    /// Calculation settings.
    pub(super) calc_settings: Option<CalcSettings>,
    /// Structured workbook protection (converted to XML on write).
    pub(super) workbook_protection: Option<domain_types::WorkbookProtection>,
    /// Raw XML for the <pivotCaches> element.
    pub(super) pivot_caches_xml: Option<String>,
    /// Generated workbook extension entries.
    pub(super) ext_lst_entries: Vec<String>,
    /// Workbook relationship ids for `<externalReferences>` in formula ordinal order.
    pub(super) external_reference_r_ids: Vec<String>,
    /// Captured namespace declarations for round-trip fidelity.
    pub(super) root_namespaces: Option<crate::infra::xml_namespaces::NamespaceMap>,
    /// Workbook root `conformance` attribute from import/domain state.
    pub(super) conformance: Option<String>,
    /// Workbook direct-child ordering and inert payload evidence from import.
    pub(super) workbook_xml_fidelity: Option<domain_types::WorkbookXmlFidelity>,
}

impl WorkbookWriter {
    /// Create a new workbook writer.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a sheet definition.
    ///
    /// The sheet ID is auto-assigned based on the number of sheets.
    pub fn add_sheet(&mut self, name: &str, r_id: &str) -> &mut Self {
        let sheet_id = self.sheets.len() as u32 + 1;
        self.sheets.push(SheetDef::new(name, sheet_id, r_id));
        self
    }

    /// Add a sheet definition with specific state.
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

    /// Add a defined name (workbook scope).
    pub fn add_defined_name(&mut self, name: &str, value: &str) -> &mut Self {
        self.defined_names.push(DefinedNameDef::new(name, value));
        self
    }

    /// Add a defined name with full options.
    pub fn add_defined_name_full(&mut self, def: DefinedNameDef) -> &mut Self {
        self.defined_names.push(def);
        self
    }

    /// Add print area for a sheet.
    ///
    /// Creates a `_xlnm.Print_Area` defined name.
    pub fn add_print_area(&mut self, sheet_index: u32, range: &str) -> &mut Self {
        self.defined_names.push(DefinedNameDef {
            name: "_xlnm.Print_Area".to_string(),
            value: range.to_string(),
            local_sheet_id: Some(sheet_index),
            ..DefinedNameDef::new("", "")
        });
        self
    }

    /// Add print titles (repeat rows/columns) for a sheet.
    ///
    /// Creates a `_xlnm.Print_Titles` defined name.
    pub fn add_print_titles(&mut self, sheet_index: u32, value: &str) -> &mut Self {
        self.defined_names.push(DefinedNameDef {
            name: "_xlnm.Print_Titles".to_string(),
            value: value.to_string(),
            local_sheet_id: Some(sheet_index),
            ..DefinedNameDef::new("", "")
        });
        self
    }

    /// Set workbook view.
    pub fn set_view(&mut self, view: WorkbookView) -> &mut Self {
        self.workbook_views = vec![view];
        self
    }

    /// Set all workbook views for round-trip fidelity of multiple `<workbookView>` elements.
    pub fn set_views(&mut self, views: Vec<WorkbookView>) -> &mut Self {
        self.workbook_views = views;
        self
    }

    /// Set raw workbook-level custom views XML.
    pub fn set_custom_workbook_views_xml(&mut self, xml: Vec<u8>) -> &mut Self {
        self.custom_workbook_views_xml = Some(xml);
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

    /// Set workbook web publishing metadata.
    pub fn set_web_publishing(&mut self, web_publishing: WorkbookWebPublishing) -> &mut Self {
        self.web_publishing = Some(web_publishing);
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

    pub fn add_ext_lst_entry(&mut self, ext_xml: String) -> &mut Self {
        self.ext_lst_entries.push(ext_xml);
        self
    }

    /// Set calculation settings.
    pub fn set_calc_settings(&mut self, settings: CalcSettings) -> &mut Self {
        self.calc_settings = Some(settings);
        self
    }

    /// Get the number of sheets.
    pub fn sheet_count(&self) -> usize {
        self.sheets.len()
    }

    /// Set root namespace declarations for round-trip fidelity.
    pub fn set_root_namespaces(
        &mut self,
        ns: crate::infra::xml_namespaces::NamespaceMap,
    ) -> &mut Self {
        self.root_namespaces = Some(ns);
        self
    }

    /// Set workbook root conformance.
    pub fn set_conformance(&mut self, conformance: Option<String>) -> &mut Self {
        self.conformance = conformance;
        self
    }

    pub fn set_workbook_xml_fidelity(
        &mut self,
        fidelity: domain_types::WorkbookXmlFidelity,
    ) -> &mut Self {
        self.workbook_xml_fidelity = (!fidelity.is_empty()).then_some(fidelity);
        self
    }

    /// Generate workbook.xml content.
    pub fn to_xml(&self) -> Vec<u8> {
        super::root::write_workbook(self)
    }
}
