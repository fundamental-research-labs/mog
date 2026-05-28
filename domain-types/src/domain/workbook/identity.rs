//! Mog workbook identity metadata.

use serde::{Deserialize, Serialize};

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

/// Workbook sheet package classification resolved from workbook.xml and
/// xl/_rels/workbook.xml.rels before any worksheet XML is parsed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkbookSheetKind {
    #[default]
    Worksheet,
    Chartsheet,
    Dialogsheet,
    MacroSheet,
    Unsupported,
    Invalid,
}

/// Stable diagnostic reference attached to workbook package inventory entries.
///
/// The full import diagnostic stream remains the detailed user-facing report;
/// inventory entries keep compact references so package identity problems stay
/// attached to the affected workbook tab across parser/output boundaries.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageDiagnosticRef {
    pub code: String,
    pub message: String,
}

/// Durable workbook-order sheet inventory.
///
/// `ParseOutput.sheets` remains position-keyed to editable worksheet payloads.
/// This inventory is the workbook/package identity contract: workbook order,
/// workbook relationship identity, resolved package path, content type, sheet
/// kind, and the optional editable-sheet index are explicit instead of inferred
/// from vector position or `xl/worksheets/sheetN.xml`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSheetPackageInfo {
    pub workbook_order: u32,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<u32>,
    pub visibility: ooxml_types::workbook::SheetState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workbook_r_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relationship_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalized_part_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    pub kind: WorkbookSheetKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editable_sheet_index: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<PackageDiagnosticRef>,
}

impl Default for WorkbookSheetPackageInfo {
    fn default() -> Self {
        Self {
            workbook_order: 0,
            name: String::new(),
            sheet_id: None,
            visibility: ooxml_types::workbook::SheetState::Visible,
            workbook_r_id: None,
            relationship_type: None,
            target_mode: None,
            original_target: None,
            normalized_part_path: None,
            content_type: None,
            kind: WorkbookSheetKind::Invalid,
            editable_sheet_index: None,
            diagnostics: Vec::new(),
        }
    }
}
