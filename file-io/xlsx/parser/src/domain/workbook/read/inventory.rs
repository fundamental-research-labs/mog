use super::SheetInfo;
use crate::domain::content_types::read::{
    CONTENT_TYPE_CHARTSHEET, CONTENT_TYPE_WORKSHEET, ContentTypes,
};
use crate::domain::workbook::types::SheetState;
use crate::infra::opc::{REL_WORKSHEET, resolve_relationship_target};
use crate::zip::XlsxArchive;
use domain_types::{PackageDiagnosticRef, WorkbookSheetKind, WorkbookSheetPackageInfo};

const REL_CHARTSHEET: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet";
const REL_DIALOGSHEET: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/dialogsheet";
const REL_MACRO_SHEET: &str = "http://schemas.microsoft.com/office/2006/relationships/xlMacrosheet";
const CONTENT_TYPE_DIALOGSHEET: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.dialogsheet+xml";
const CONTENT_TYPE_MACRO_SHEET: &str = "application/vnd.ms-excel.macrosheet+xml";

/// Parser-facing package context for sheet-owned parts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SheetPackageContext {
    pub workbook_order: usize,
    pub editable_sheet_index: Option<usize>,
    pub sheet_name: String,
    pub sheet_id: Option<u32>,
    pub visibility: SheetState,
    pub workbook_r_id: Option<String>,
    pub owner_part_path: Option<String>,
    pub owner_rels_path: Option<String>,
    pub original_target: Option<String>,
    pub relationship_type: Option<String>,
    pub content_type: Option<String>,
    pub kind: WorkbookSheetKind,
}

impl SheetPackageContext {
    #[must_use]
    pub fn from_inventory_entry(entry: &WorkbookSheetPackageInfo) -> Self {
        Self {
            workbook_order: entry.workbook_order as usize,
            editable_sheet_index: entry.editable_sheet_index,
            sheet_name: entry.name.clone(),
            sheet_id: entry.sheet_id,
            visibility: entry.visibility,
            workbook_r_id: entry.workbook_r_id.clone(),
            owner_part_path: entry.normalized_part_path.clone(),
            owner_rels_path: entry
                .normalized_part_path
                .as_deref()
                .map(crate::write::package_graph::part_relationships_path),
            original_target: entry.original_target.clone(),
            relationship_type: entry.relationship_type.clone(),
            content_type: entry.content_type.clone(),
            kind: entry.kind,
        }
    }
}

/// Build durable workbook sheet inventory from workbook sheet entries,
/// workbook relationships, content types, and package membership.
pub fn build_workbook_sheet_inventory(
    sheet_infos: &[SheetInfo],
    workbook_relationships: &[ooxml_types::shared::OpcRelationship],
    content_types: Option<&ContentTypes>,
    archive: &XlsxArchive<'_>,
) -> Vec<WorkbookSheetPackageInfo> {
    let mut inventory = Vec::with_capacity(sheet_infos.len());
    let mut editable_sheet_index = 0usize;
    let mut resolved_targets = std::collections::HashSet::<String>::new();

    for (workbook_order, sheet) in sheet_infos.iter().enumerate() {
        let mut diagnostics = Vec::new();
        let relationship = workbook_relationships
            .iter()
            .find(|rel| rel.id == sheet.r_id);
        let relationship_id_count = workbook_relationships
            .iter()
            .filter(|rel| rel.id == sheet.r_id)
            .count();

        let mut normalized_part_path = None;
        let mut content_type = None;

        if sheet.r_id.is_empty() {
            diagnostics.push(package_diag(
                "workbook_sheet_missing_relationship_id",
                "workbook sheet entry is missing r:id",
            ));
        }

        let relationship_type = relationship.map(|rel| rel.rel_type.clone());
        let target_mode = relationship.and_then(|rel| rel.target_mode.clone());
        let original_target = relationship.map(|rel| rel.target.clone());

        if relationship.is_none() && !sheet.r_id.is_empty() {
            diagnostics.push(package_diag(
                "workbook_sheet_missing_relationship",
                format!("workbook relationship {} was not found", sheet.r_id),
            ));
        }
        if relationship_id_count > 1 {
            diagnostics.push(package_diag(
                "workbook_sheet_duplicate_relationship_id",
                format!(
                    "workbook relationship {} appears {relationship_id_count} times",
                    sheet.r_id
                ),
            ));
        }

        if let Some(rel) = relationship {
            if rel
                .target_mode
                .as_deref()
                .is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
            {
                diagnostics.push(package_diag(
                    "workbook_sheet_external_target",
                    format!(
                        "workbook sheet relationship {} targets an external resource",
                        rel.id
                    ),
                ));
            } else {
                match resolve_relationship_target(Some("xl/workbook.xml"), &rel.target) {
                    Ok(path) => {
                        if !resolved_targets.insert(path.clone()) {
                            diagnostics.push(package_diag(
                                "workbook_sheet_duplicate_target",
                                format!("multiple workbook sheets target {path}"),
                            ));
                        }
                        if !archive.contains(&path) {
                            diagnostics.push(package_diag(
                                "workbook_sheet_missing_target_part",
                                format!("workbook sheet target {path} is missing from the package"),
                            ));
                        }
                        content_type = content_types
                            .and_then(|types| types.get_type(&path))
                            .map(str::to_string);
                        normalized_part_path = Some(path);
                    }
                    Err(err) => diagnostics.push(package_diag(
                        "workbook_sheet_invalid_target",
                        format!("workbook sheet target {} is invalid: {:?}", rel.target, err),
                    )),
                }
            }
        }

        let kind = classify_sheet_kind(relationship_type.as_deref(), content_type.as_deref());
        if matches!(
            kind,
            WorkbookSheetKind::Chartsheet
                | WorkbookSheetKind::Dialogsheet
                | WorkbookSheetKind::MacroSheet
                | WorkbookSheetKind::Unsupported
        ) {
            diagnostics.push(package_diag(
                "workbook_sheet_unsupported_kind",
                format!("workbook sheet {} is classified as {:?}", sheet.name, kind),
            ));
        }
        if matches!(kind, WorkbookSheetKind::Invalid) {
            diagnostics.push(package_diag(
                "workbook_sheet_invalid_kind",
                format!(
                    "workbook sheet {} has relationship type {:?} and content type {:?}",
                    sheet.name, relationship_type, content_type
                ),
            ));
        }

        let editable_index = (kind == WorkbookSheetKind::Worksheet
            && normalized_part_path.is_some()
            && !diagnostics
                .iter()
                .any(|diag| diag.code == "workbook_sheet_external_target"))
        .then(|| {
            let index = editable_sheet_index;
            editable_sheet_index += 1;
            index
        });

        inventory.push(WorkbookSheetPackageInfo {
            workbook_order: workbook_order as u32,
            name: sheet.name.clone(),
            sheet_id: (sheet.sheet_id != 0).then_some(sheet.sheet_id),
            visibility: sheet.state,
            workbook_r_id: (!sheet.r_id.is_empty()).then(|| sheet.r_id.clone()),
            relationship_type,
            target_mode,
            original_target,
            normalized_part_path,
            content_type,
            kind,
            editable_sheet_index: editable_index,
            diagnostics,
        });
    }

    inventory
}

#[must_use]
pub fn sheet_package_contexts(inventory: &[WorkbookSheetPackageInfo]) -> Vec<SheetPackageContext> {
    inventory
        .iter()
        .filter(|entry| entry.editable_sheet_index.is_some())
        .map(SheetPackageContext::from_inventory_entry)
        .collect()
}

fn classify_sheet_kind(
    relationship_type: Option<&str>,
    content_type: Option<&str>,
) -> WorkbookSheetKind {
    match (relationship_type, content_type) {
        (Some(REL_WORKSHEET), Some(CONTENT_TYPE_WORKSHEET) | None) => WorkbookSheetKind::Worksheet,
        (Some(REL_CHARTSHEET), Some(CONTENT_TYPE_CHARTSHEET) | None) => {
            WorkbookSheetKind::Chartsheet
        }
        (Some(REL_DIALOGSHEET), Some(CONTENT_TYPE_DIALOGSHEET) | None) => {
            WorkbookSheetKind::Dialogsheet
        }
        (Some(REL_MACRO_SHEET), Some(CONTENT_TYPE_MACRO_SHEET) | None) => {
            WorkbookSheetKind::MacroSheet
        }
        (Some(REL_WORKSHEET), Some(_)) => WorkbookSheetKind::Invalid,
        (Some(REL_CHARTSHEET), Some(_))
        | (Some(REL_DIALOGSHEET), Some(_))
        | (Some(REL_MACRO_SHEET), Some(_)) => WorkbookSheetKind::Invalid,
        (Some(_), _) => WorkbookSheetKind::Unsupported,
        (None, _) => WorkbookSheetKind::Invalid,
    }
}

fn package_diag(code: impl Into<String>, message: impl Into<String>) -> PackageDiagnosticRef {
    PackageDiagnosticRef {
        code: code.into(),
        message: message.into(),
    }
}
