use domain_types::ParseDiagnostics;

use crate::output::results::FullParseResult;
use crate::write::legacy_vml_ownership::{
    LegacyVmlRelationshipRole, classify_legacy_vml_part, legacy_vml_disposition_label,
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
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.worksheet_controls_xml.is_some())
    {
        dropped.push("worksheet controls XML sidecar".to_string());
    }
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.custom_properties_xml.is_some())
    {
        dropped.push("worksheet custom-property XML refs".to_string());
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
        if path.starts_with("xl/webextensions/") {
            continue;
        } else if path.starts_with("xl/activeX/") {
            dropped.push(format!("ActiveX active content suppressed at {}", path));
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
    let has_vba = result.extensions.as_ref().is_some_and(|extensions| {
        extensions
            .imported_parts
            .paths()
            .any(|path| path == "xl/vbaProject.bin")
    });
    if !has_vba {
        return;
    }
    diagnostics.errors.push(domain_types::ParseError {
        code: 9003,
        severity: "warning".to_string(),
        message:
            "Preserved XLSX active content without interpretation or execution: VBA project at xl/vbaProject.bin"
                .to_string(),
        part: Some("xl/vbaProject.bin".to_string()),
        row: None,
        col: None,
    });
    diagnostics.import_report = Some(diagnostics.clone().into_import_report());
}

fn append_workbook_disposition_diagnostics(result: &FullParseResult, dropped: &mut Vec<String>) {
    dropped.extend(
        result
            .unsupported_workbook_elements
            .iter()
            .map(|name| format!("workbook-level `{name}` XML")),
    );
    dropped.extend(
        result
            .unsupported_workbook_mce
            .iter()
            .map(|name| format!("unsupported workbook MCE `{name}`")),
    );
}

fn append_legacy_vml_diagnostics(result: &FullParseResult, dropped: &mut Vec<String>) {
    for sheet in &result.sheets {
        for (path, data, _) in &sheet.raw_vml_drawings {
            let role = legacy_vml_role_for_path(sheet, path);
            let disposition = classify_legacy_vml_part(data, role);
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
