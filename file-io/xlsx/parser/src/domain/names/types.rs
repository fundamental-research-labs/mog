//! Defined-name model types and lookup helpers.

/// Excel built-in name types identified by the `_xlnm.` prefix.
///
/// These special names are used internally by Excel for various features
/// like printing, filtering, and database operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum BuiltInName {
    /// Print area definition: `_xlnm.Print_Area`
    PrintArea,
    /// Print titles (rows/columns to repeat): `_xlnm.Print_Titles`
    PrintTitles,
    /// Advanced filter criteria range: `_xlnm.Criteria`
    Criteria,
    /// AutoFilter database range: `_xlnm._FilterDatabase`
    FilterDatabase,
    /// Advanced filter extract range: `_xlnm.Extract`
    Extract,
    /// Consolidation source ranges: `_xlnm.Consolidate_Area`
    ConsolidateArea,
    /// Database range: `_xlnm.Database`
    Database,
    /// Sheet title: `_xlnm.Sheet_Title`
    SheetTitle,
    /// Recorder macro: `_xlnm.Recorder`
    Recorder,
    /// Auto_Open macro: `_xlnm.Auto_Open`
    AutoOpen,
    /// Auto_Close macro: `_xlnm.Auto_Close`
    AutoClose,
    /// Unknown built-in name (has `_xlnm.` prefix but unrecognized)
    Unknown,
}

impl BuiltInName {
    /// Parse a name string to detect if it's a built-in name.
    ///
    /// Returns `Some(BuiltInName)` if the name starts with `_xlnm.`,
    /// otherwise returns `None` for user-defined names.
    pub fn from_name(name: &str) -> Option<Self> {
        let suffix = name.strip_prefix("_xlnm.")?;

        Some(match suffix {
            "Print_Area" => BuiltInName::PrintArea,
            "Print_Titles" => BuiltInName::PrintTitles,
            "Criteria" => BuiltInName::Criteria,
            "_FilterDatabase" => BuiltInName::FilterDatabase,
            "Extract" => BuiltInName::Extract,
            "Consolidate_Area" => BuiltInName::ConsolidateArea,
            "Database" => BuiltInName::Database,
            "Sheet_Title" => BuiltInName::SheetTitle,
            "Recorder" => BuiltInName::Recorder,
            "Auto_Open" => BuiltInName::AutoOpen,
            "Auto_Close" => BuiltInName::AutoClose,
            _ => BuiltInName::Unknown,
        })
    }

    /// Check if this built-in name type is security-sensitive.
    ///
    /// Auto macros (`Auto_Open`, `Auto_Close`) can execute code automatically
    /// and should be treated with caution.
    #[inline]
    pub fn is_auto_macro(&self) -> bool {
        matches!(self, BuiltInName::AutoOpen | BuiltInName::AutoClose)
    }

    /// Get the canonical name string for this built-in name type.
    pub fn canonical_name(&self) -> &'static str {
        match self {
            BuiltInName::PrintArea => "_xlnm.Print_Area",
            BuiltInName::PrintTitles => "_xlnm.Print_Titles",
            BuiltInName::Criteria => "_xlnm.Criteria",
            BuiltInName::FilterDatabase => "_xlnm._FilterDatabase",
            BuiltInName::Extract => "_xlnm.Extract",
            BuiltInName::ConsolidateArea => "_xlnm.Consolidate_Area",
            BuiltInName::Database => "_xlnm.Database",
            BuiltInName::SheetTitle => "_xlnm.Sheet_Title",
            BuiltInName::Recorder => "_xlnm.Recorder",
            BuiltInName::AutoOpen => "_xlnm.Auto_Open",
            BuiltInName::AutoClose => "_xlnm.Auto_Close",
            BuiltInName::Unknown => "_xlnm.Unknown",
        }
    }
}

impl Default for BuiltInName {
    fn default() -> Self {
        BuiltInName::Unknown
    }
}

/// A defined name entry from the workbook.
///
/// Represents a named range, formula, or built-in name with all its attributes.
#[derive(Debug, Clone, Default)]
pub struct DefinedName {
    /// The name identifier (e.g., "SalesData", "_xlnm.Print_Area")
    pub name: String,

    /// The formula or reference string (e.g., "Sheet1!$A$1:$D$100")
    ///
    /// This is the content between `<definedName>` and `</definedName>` tags.
    /// For cell references, this uses Excel's A1 notation.
    /// Can also contain formulas, constants, or error values.
    pub refers_to: String,

    /// Comment/description for the name (optional)
    pub comment: Option<String>,

    /// Custom menu text (optional) - for XLM macros
    pub custom_menu: Option<String>,

    /// Description text (optional)
    pub description: Option<String>,

    /// Help topic text (optional)
    pub help: Option<String>,

    /// Status bar text (optional)
    pub status_bar: Option<String>,

    /// Local sheet ID if this name is sheet-scoped.
    ///
    /// - `None` = Workbook scope (available in all sheets)
    /// - `Some(id)` = Sheet scope (0-indexed sheet ID)
    pub local_sheet_id: Option<u32>,

    /// Whether this name is hidden from the UI
    pub hidden: bool,

    /// Whether this name is a function (XLM macro function)
    pub function: bool,

    /// Whether this is a VBA procedure name
    pub vb_procedure: bool,

    /// Whether this is an XLM macro
    pub xlm: bool,

    /// Function group ID for XLM function categorisation
    pub function_group_id: Option<u32>,

    /// Keyboard shortcut key for macro/function names
    pub shortcut_key: Option<String>,

    /// Whether to publish this name to the server (SharePoint)
    pub publish_to_server: bool,

    /// Whether this name is a workbook parameter (for web queries)
    pub workbook_parameter: bool,

    /// Whether xml:space="preserve" was set on this element
    pub xml_space_preserve: bool,
}

impl DefinedName {
    /// Create a new DefinedName with the given name and reference.
    pub fn new(name: impl Into<String>, refers_to: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            refers_to: refers_to.into(),
            ..Default::default()
        }
    }

    /// Check if this is a built-in Excel name.
    #[inline]
    pub fn built_in_type(&self) -> Option<BuiltInName> {
        BuiltInName::from_name(&self.name)
    }

    /// Check if this name is scoped to the workbook (global).
    #[inline]
    pub fn is_workbook_scope(&self) -> bool {
        self.local_sheet_id.is_none()
    }

    /// Check if this name is scoped to a specific sheet.
    #[inline]
    pub fn is_sheet_scope(&self) -> bool {
        self.local_sheet_id.is_some()
    }

    /// Check if this name represents a print area.
    #[inline]
    pub fn is_print_area(&self) -> bool {
        self.name == "_xlnm.Print_Area"
    }

    /// Check if this name represents print titles.
    #[inline]
    pub fn is_print_titles(&self) -> bool {
        self.name == "_xlnm.Print_Titles"
    }

    /// Check if this name represents an AutoFilter database.
    #[inline]
    pub fn is_filter_database(&self) -> bool {
        self.name == "_xlnm._FilterDatabase"
    }

    /// Check if this name is potentially dangerous (auto-executing macro).
    #[inline]
    pub fn is_potentially_dangerous(&self) -> bool {
        self.built_in_type()
            .map(|bt| bt.is_auto_macro())
            .unwrap_or(false)
            || self.xlm
    }
}

/// Collection of all defined names from a workbook.
///
/// Provides efficient lookup by name and filtering by scope.
#[derive(Debug, Clone, Default)]
pub struct DefinedNames {
    /// All defined names in document order
    names: Vec<DefinedName>,
}

impl DefinedNames {
    /// Create an empty DefinedNames collection.
    pub fn new() -> Self {
        Self { names: Vec::new() }
    }

    pub(super) fn push(&mut self, name: DefinedName) {
        self.names.push(name);
    }

    /// Get the number of defined names.
    #[inline]
    pub fn len(&self) -> usize {
        self.names.len()
    }

    /// Check if there are no defined names.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// Get all defined names as a slice.
    #[inline]
    pub fn all(&self) -> &[DefinedName] {
        &self.names
    }

    /// Get a defined name by its name (case-sensitive).
    pub fn get(&self, name: &str) -> Option<&DefinedName> {
        self.names.iter().find(|n| n.name == name)
    }

    /// Get a defined name with scope consideration.
    pub fn get_in_scope(&self, name: &str, sheet_id: Option<u32>) -> Option<&DefinedName> {
        if let Some(sid) = sheet_id {
            if let Some(n) = self
                .names
                .iter()
                .find(|n| n.name == name && n.local_sheet_id == Some(sid))
            {
                return Some(n);
            }
        }

        self.names
            .iter()
            .find(|n| n.name == name && n.local_sheet_id.is_none())
    }

    /// Get all names with workbook scope.
    pub fn workbook_scoped(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.is_workbook_scope())
    }

    /// Get all names scoped to a specific sheet.
    pub fn sheet_scoped(&self, sheet_id: u32) -> impl Iterator<Item = &DefinedName> {
        self.names
            .iter()
            .filter(move |n| n.local_sheet_id == Some(sheet_id))
    }

    /// Get all hidden names.
    pub fn hidden(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.hidden)
    }

    /// Get all visible (non-hidden) names.
    pub fn visible(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| !n.hidden)
    }

    /// Get the print area for a specific sheet.
    pub fn print_area(&self, sheet_id: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|n| n.is_print_area() && n.local_sheet_id == Some(sheet_id))
            .map(|n| n.refers_to.as_str())
    }

    /// Get the print titles for a specific sheet.
    pub fn print_titles(&self, sheet_id: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|n| n.is_print_titles() && n.local_sheet_id == Some(sheet_id))
            .map(|n| n.refers_to.as_str())
    }

    /// Get the AutoFilter database range for a specific sheet.
    pub fn filter_database(&self, sheet_id: u32) -> Option<&str> {
        self.names
            .iter()
            .find(|n| n.is_filter_database() && n.local_sheet_id == Some(sheet_id))
            .map(|n| n.refers_to.as_str())
    }

    /// Get all user-defined names (excluding built-in `_xlnm.` names).
    pub fn user_defined(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.built_in_type().is_none())
    }

    /// Get all built-in names (`_xlnm.` prefix).
    pub fn built_in(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.built_in_type().is_some())
    }

    /// Check if there are any potentially dangerous names (auto-macros, XLM).
    pub fn has_dangerous_names(&self) -> bool {
        self.names.iter().any(|n| n.is_potentially_dangerous())
    }

    /// Get all potentially dangerous names.
    pub fn dangerous_names(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter().filter(|n| n.is_potentially_dangerous())
    }

    /// Iterate over all defined names.
    pub fn iter(&self) -> impl Iterator<Item = &DefinedName> {
        self.names.iter()
    }
}

impl IntoIterator for DefinedNames {
    type Item = DefinedName;
    type IntoIter = std::vec::IntoIter<DefinedName>;

    fn into_iter(self) -> Self::IntoIter {
        self.names.into_iter()
    }
}

impl<'a> IntoIterator for &'a DefinedNames {
    type Item = &'a DefinedName;
    type IntoIter = std::slice::Iter<'a, DefinedName>;

    fn into_iter(self) -> Self::IntoIter {
        self.names.iter()
    }
}
