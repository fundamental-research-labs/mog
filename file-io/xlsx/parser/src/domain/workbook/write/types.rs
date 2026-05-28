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
    /// Function group ID for XLM macro/function categorisation
    pub function_group_id: Option<u32>,
    /// Keyboard shortcut key for macro/function names
    pub shortcut_key: Option<String>,
    /// Whether to publish this name to the server (SharePoint)
    pub publish_to_server: bool,
    /// Whether this name is a workbook parameter (for web queries)
    pub workbook_parameter: bool,
    /// Whether xml:space="preserve" should be emitted
    pub xml_space_preserve: bool,
}

impl DefinedNameDef {
    /// Create a new workbook-scoped defined name.
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
            function_group_id: None,
            shortcut_key: None,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
        }
    }

    /// Create a sheet-scoped defined name.
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
            function_group_id: None,
            shortcut_key: None,
            publish_to_server: false,
            workbook_parameter: false,
            xml_space_preserve: false,
        }
    }
}
