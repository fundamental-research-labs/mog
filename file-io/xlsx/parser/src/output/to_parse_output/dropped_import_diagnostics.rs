use domain_types::ParseDiagnostics;

use crate::output::results::FullParseResult;
use crate::write::legacy_vml_ownership::{
    LegacyVmlDisposition, LegacyVmlRelationshipRole, classify_legacy_vml_part,
    legacy_vml_disposition_label,
};

pub(super) fn append_dropped_import_diagnostics(
    result: &FullParseResult,
    diagnostics: &mut ParseDiagnostics,
) {
    let mut dropped: Vec<String> = Vec::new();
    append_feature_property_diagnostics(result, diagnostics);
    append_quarantined_active_content_diagnostics(result, diagnostics);

    if let Some(ext) = result.extensions.as_ref() {
        append_suppressed_auxiliary_diagnostics(ext.imported_parts.paths(), &mut dropped);
    }
    if let Some(inventory) = result.package_inventory.as_ref() {
        for diagnostic in &inventory.diagnostics {
            if diagnostic
                .part
                .as_deref()
                .is_some_and(|part| part.starts_with("xl/revisions/"))
            {
                dropped.push("shared workbook revision history".to_string());
            }
        }
    }

    append_workbook_disposition_diagnostics(result, &mut dropped);
    append_legacy_vml_diagnostics(result, &mut dropped);
    if result
        .sheets
        .iter()
        .any(|sheet| !sheet.table_xml_passthroughs.is_empty())
    {
        dropped.push("table XML passthrough package parts".to_string());
    }
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.header_footer_xml.is_some())
    {
        dropped.push("worksheet header/footer XML".to_string());
    }
    if result.sheets.iter().any(|sheet| {
        sheet.parsed_drawing.as_ref().is_some_and(|drawing| {
            drawing.raw_drawing_xml.is_some()
                || drawing.raw_drawing_rels_xml.is_some()
                || !drawing.root_namespace_attrs.is_empty()
                || !drawing.opc_rels.is_empty()
                || drawing.has_rels_file
        })
    }) {
        dropped.push("drawing lexical/package sidecars".to_string());
    }
    if result.imported_calc_chain_entry_count > 0 {
        dropped.push("calculation chain cache".to_string());
    }

    if dropped.is_empty() {
        return;
    }

    dropped.sort_unstable();
    dropped.dedup();
    diagnostics.errors.push(domain_types::ParseError {
        code: 9001,
        severity: "warning".to_string(),
        message: format!(
            "Dropped XLSX import data with no modeled ParseOutput owner: {}",
            dropped.join(", ")
        ),
        part: None,
        row: None,
        col: None,
    });
    diagnostics.import_report = Some(diagnostics.clone().into_import_report());
}

fn append_feature_property_diagnostics(
    result: &FullParseResult,
    diagnostics: &mut ParseDiagnostics,
) {
    let initial_count = diagnostics.errors.len();
    for diagnostic in &result.feature_properties.diagnostics {
        diagnostics.errors.push(domain_types::ParseError {
            code: 9002,
            severity: match diagnostic.severity {
                domain_types::DataFeatureDiagnosticSeverity::Info => "info",
                domain_types::DataFeatureDiagnosticSeverity::Warning => "warning",
                domain_types::DataFeatureDiagnosticSeverity::Error => "error",
            }
            .to_string(),
            message: diagnostic.summary.clone(),
            part: diagnostic.package_path.clone(),
            row: None,
            col: None,
        });
    }
    if diagnostics.errors.len() != initial_count {
        diagnostics.import_report = Some(diagnostics.clone().into_import_report());
    }
}

fn append_suppressed_auxiliary_diagnostics<'a>(
    paths: impl Iterator<Item = &'a str>,
    dropped: &mut Vec<String>,
) {
    for path in paths {
        if path.starts_with("xl/webextensions/") || path.starts_with("xl/activeX/") {
            continue;
        } else if path == "xl/volatileDependencies.xml" {
            dropped.push("volatile dependency calculation sidecar".to_string());
        } else if path.starts_with("xl/featurePropertyBag/") {
            dropped.push("feature property bag package parts".to_string());
        }
    }
}

fn append_quarantined_active_content_diagnostics(
    result: &FullParseResult,
    diagnostics: &mut ParseDiagnostics,
) {
    let mut active_paths = Vec::new();
    if let Some(extensions) = result.extensions.as_ref() {
        active_paths.extend(
            extensions
                .imported_parts
                .paths()
                .filter(|path| *path == "xl/vbaProject.bin" || path.starts_with("xl/activeX/"))
                .map(str::to_string),
        );
    }
    if let Some(inventory) = result.package_inventory.as_ref() {
        active_paths.extend(
            inventory
                .diagnostics
                .iter()
                .filter(|diagnostic| diagnostic.code == "active_content_quarantined")
                .filter_map(|diagnostic| diagnostic.part.clone()),
        );
    }
    active_paths.sort();
    active_paths.dedup();
    if active_paths.is_empty() {
        return;
    }
    for path in active_paths {
        diagnostics.errors.push(domain_types::ParseError {
            code: 9003,
            severity: "warning".to_string(),
            message: format!(
                "Preserved XLSX active content without interpretation or execution: quarantined package part at {path}"
            ),
            part: Some(path),
            row: None,
            col: None,
        });
    }
    diagnostics.import_report = Some(diagnostics.clone().into_import_report());
}

fn append_workbook_disposition_diagnostics(result: &FullParseResult, dropped: &mut Vec<String>) {
    // `unsupported_workbook_elements` predates WorkbookXmlFidelity and lists
    // every schema-known child without a typed parser. Fidelity now preserves
    // relationship-free inert children, so consult its slots before reporting
    // a legacy inventory entry; otherwise a valid preserved or regenerated
    // `<extLst>`/`<functionGroups>` is incorrectly reported as dropped.
    for name in &result.unsupported_workbook_elements {
        let kind = workbook_xml_child_kind(name);
        let covered_by_fidelity = kind.is_some_and(|kind| {
            fidelity_handles_child(&result.workbook_xml_fidelity, kind)
                || fidelity_reports_omission(&result.workbook_xml_fidelity, kind)
        });
        if !covered_by_fidelity {
            dropped.push(format!("workbook-level `{name}` XML"));
        }
    }

    for name in &result.unsupported_workbook_mce {
        let kind = workbook_xml_child_kind(name);
        let covered_by_fidelity = kind.is_some_and(|kind| {
            fidelity_handles_child(&result.workbook_xml_fidelity, kind)
                || fidelity_reports_omission(&result.workbook_xml_fidelity, kind)
        });
        if !covered_by_fidelity {
            dropped.push(format!("unsupported workbook MCE `{name}`"));
        }
    }

    append_workbook_xml_fidelity_diagnostics(&result.workbook_xml_fidelity, dropped);
}

fn workbook_xml_child_kind(name: &str) -> Option<domain_types::WorkbookXmlChildKind> {
    use domain_types::WorkbookXmlChildKind;

    Some(match name {
        "functionGroups" => WorkbookXmlChildKind::FunctionGroups,
        "oleSize" => WorkbookXmlChildKind::OleSize,
        "smartTagPr" => WorkbookXmlChildKind::SmartTagPr,
        "smartTagTypes" => WorkbookXmlChildKind::SmartTagTypes,
        "fileRecoveryPr" => WorkbookXmlChildKind::FileRecoveryPr,
        "webPublishObjects" => WorkbookXmlChildKind::WebPublishObjects,
        "extLst" => WorkbookXmlChildKind::ExtLst,
        "mc:AlternateContent" => WorkbookXmlChildKind::AlternateContent,
        // `mc:MustUnderstand` is a root attribute, not a child slot.
        "mc:MustUnderstand" => return None,
        _ => return None,
    })
}

fn fidelity_handles_child(
    fidelity: &domain_types::WorkbookXmlFidelity,
    kind: domain_types::WorkbookXmlChildKind,
) -> bool {
    fidelity.slots.iter().any(|slot| {
        slot.kind == kind
            && matches!(
                slot.fallback_action,
                domain_types::WorkbookXmlFallbackAction::Regenerate
                    | domain_types::WorkbookXmlFallbackAction::Preserve
            )
    })
}

fn fidelity_reports_omission(
    fidelity: &domain_types::WorkbookXmlFidelity,
    kind: domain_types::WorkbookXmlChildKind,
) -> bool {
    let Some(expected_local_name) = workbook_xml_local_name(kind) else {
        return false;
    };

    fidelity.diagnostics.iter().any(|diagnostic| {
        if !matches!(
            diagnostic.action,
            domain_types::WorkbookXmlFallbackAction::Omit
                | domain_types::WorkbookXmlFallbackAction::Block
        ) {
            return false;
        }
        let local_name = diagnostic
            .artifact
            .rsplit('/')
            .next()
            .unwrap_or(diagnostic.artifact.as_str());
        local_name == expected_local_name
    })
}

fn workbook_xml_local_name(kind: domain_types::WorkbookXmlChildKind) -> Option<&'static str> {
    Some(match kind {
        domain_types::WorkbookXmlChildKind::FunctionGroups => "functionGroups",
        domain_types::WorkbookXmlChildKind::OleSize => "oleSize",
        domain_types::WorkbookXmlChildKind::SmartTagPr => "smartTagPr",
        domain_types::WorkbookXmlChildKind::SmartTagTypes => "smartTagTypes",
        domain_types::WorkbookXmlChildKind::FileRecoveryPr => "fileRecoveryPr",
        domain_types::WorkbookXmlChildKind::WebPublishObjects => "webPublishObjects",
        domain_types::WorkbookXmlChildKind::ExtLst => "extLst",
        domain_types::WorkbookXmlChildKind::AlternateContent => "AlternateContent",
        _ => return None,
    })
}

fn append_workbook_xml_fidelity_diagnostics(
    fidelity: &domain_types::WorkbookXmlFidelity,
    dropped: &mut Vec<String>,
) {
    for diagnostic in &fidelity.diagnostics {
        if !matches!(
            diagnostic.action,
            domain_types::WorkbookXmlFallbackAction::Omit
                | domain_types::WorkbookXmlFallbackAction::Block
        ) {
            continue;
        }
        let local_name = diagnostic
            .artifact
            .rsplit('/')
            .next()
            .unwrap_or(diagnostic.artifact.as_str());
        if local_name == "AlternateContent" {
            dropped.push("unsupported workbook MCE `mc:AlternateContent`".to_string());
        } else {
            dropped.push(format!("workbook-level `{local_name}` XML"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fidelity_diagnostics_report_only_omitted_children() {
        let fidelity = domain_types::WorkbookXmlFidelity {
            slots: vec![domain_types::WorkbookXmlChildSlot {
                kind: domain_types::WorkbookXmlChildKind::ExtLst,
                owner_policy: domain_types::WorkbookXmlOwnerPolicy::ExtensionOwnerRegistry,
                provenance_status: domain_types::WorkbookXmlProvenanceStatus::SafeInert,
                fallback_action: domain_types::WorkbookXmlFallbackAction::Preserve,
                payload_id: Some("workbook-child-1".to_string()),
                reason: None,
            }],
            raw_children: vec![domain_types::WorkbookXmlRawChild {
                payload_id: "workbook-child-1".to_string(),
                kind: domain_types::WorkbookXmlChildKind::ExtLst,
                q_name: "extLst".to_string(),
                local_name: "extLst".to_string(),
                xml: b"<extLst/>".to_vec(),
                relationship_ids: Vec::new(),
            }],
            diagnostics: Vec::new(),
        };
        let mut dropped = Vec::new();

        append_workbook_xml_fidelity_diagnostics(&fidelity, &mut dropped);

        assert!(dropped.is_empty());
    }

    #[test]
    fn fidelity_diagnostics_name_alternate_content_and_unknown_children() {
        let fidelity = domain_types::WorkbookXmlFidelity {
            diagnostics: vec![
                domain_types::WorkbookXmlFidelityDiagnostic {
                    artifact: "xl/workbook.xml/AlternateContent".to_string(),
                    owner_policy: domain_types::WorkbookXmlOwnerPolicy::MceFailClosed,
                    provenance_status: domain_types::WorkbookXmlProvenanceStatus::Unsupported,
                    action: domain_types::WorkbookXmlFallbackAction::Omit,
                    reason: "branch selection is not modeled".to_string(),
                    relationship_ids: Vec::new(),
                    semantics_changed: true,
                },
                domain_types::WorkbookXmlFidelityDiagnostic {
                    artifact: "xl/workbook.xml/revisionPtr".to_string(),
                    owner_policy: domain_types::WorkbookXmlOwnerPolicy::Unsupported,
                    provenance_status: domain_types::WorkbookXmlProvenanceStatus::Unsupported,
                    action: domain_types::WorkbookXmlFallbackAction::Omit,
                    reason: "no owner".to_string(),
                    relationship_ids: Vec::new(),
                    semantics_changed: true,
                },
            ],
            ..Default::default()
        };
        let mut dropped = Vec::new();

        append_workbook_xml_fidelity_diagnostics(&fidelity, &mut dropped);

        assert_eq!(
            dropped,
            vec![
                "unsupported workbook MCE `mc:AlternateContent`".to_string(),
                "workbook-level `revisionPtr` XML".to_string(),
            ]
        );
    }

    #[test]
    fn non_omission_fidelity_diagnostics_are_not_reported_as_dropped() {
        let fidelity = domain_types::WorkbookXmlFidelity {
            slots: vec![domain_types::WorkbookXmlChildSlot {
                kind: domain_types::WorkbookXmlChildKind::ExtLst,
                owner_policy: domain_types::WorkbookXmlOwnerPolicy::ExtensionOwnerRegistry,
                provenance_status: domain_types::WorkbookXmlProvenanceStatus::Current,
                fallback_action: domain_types::WorkbookXmlFallbackAction::Regenerate,
                payload_id: None,
                reason: None,
            }],
            diagnostics: vec![domain_types::WorkbookXmlFidelityDiagnostic {
                artifact: "xl/workbook.xml/extLst".to_string(),
                owner_policy: domain_types::WorkbookXmlOwnerPolicy::ExtensionOwnerRegistry,
                provenance_status: domain_types::WorkbookXmlProvenanceStatus::SafeInert,
                action: domain_types::WorkbookXmlFallbackAction::Preserve,
                reason: "raw payload retained".to_string(),
                relationship_ids: Vec::new(),
                semantics_changed: false,
            }],
            ..Default::default()
        };
        let mut dropped = Vec::new();

        append_workbook_xml_fidelity_diagnostics(&fidelity, &mut dropped);
        assert!(fidelity_handles_child(
            &fidelity,
            domain_types::WorkbookXmlChildKind::ExtLst
        ));
        assert!(!fidelity_reports_omission(
            &fidelity,
            domain_types::WorkbookXmlChildKind::ExtLst
        ));
        assert!(dropped.is_empty());
    }
}

fn append_legacy_vml_diagnostics(result: &FullParseResult, dropped: &mut Vec<String>) {
    for sheet in &result.sheets {
        for (path, data, _) in &sheet.raw_vml_drawings {
            let role = legacy_vml_role_for_path(sheet, path);
            let disposition = classify_legacy_vml_part(data, role);
            if matches!(disposition, LegacyVmlDisposition::Modeled { .. }) {
                continue;
            }
            dropped.push(format!(
                "legacy VML {}: {}",
                path,
                legacy_vml_disposition_label(&disposition)
            ));
        }
    }
}

fn legacy_vml_role_for_path(
    sheet: &crate::output::results::FullParsedSheet,
    path: &str,
) -> LegacyVmlRelationshipRole {
    let legacy_path = sheet
        .legacy_drawing_r_id
        .as_ref()
        .and_then(|rid| vml_path_for_relationship(sheet, rid));
    if legacy_path.as_deref() == Some(path) {
        return LegacyVmlRelationshipRole::LegacyDrawing;
    }

    let hf_path = sheet
        .legacy_drawing_hf_r_id
        .as_ref()
        .and_then(|rid| vml_path_for_relationship(sheet, rid));
    if hf_path.as_deref() == Some(path) {
        return LegacyVmlRelationshipRole::LegacyDrawingHeaderFooter;
    }

    LegacyVmlRelationshipRole::Unreferenced
}

fn vml_path_for_relationship(
    sheet: &crate::output::results::FullParsedSheet,
    r_id: &str,
) -> Option<String> {
    sheet
        .sheet_opc_rels
        .iter()
        .find(|rel| rel.id == r_id && rel.rel_type == crate::infra::opc::REL_VML_DRAWING)
        .map(|rel| opc_target_to_zip_path(&rel.target, "xl"))
}

fn opc_target_to_zip_path(target: &str, base_dir: &str) -> String {
    if target.starts_with('/') {
        target.trim_start_matches('/').to_string()
    } else if target.starts_with("../") {
        format!("{}/{}", base_dir, target.trim_start_matches("../"))
    } else if target.starts_with("xl/") {
        target.to_string()
    } else {
        format!("{}/{}", base_dir, target)
    }
}
