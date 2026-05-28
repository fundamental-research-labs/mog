use domain_types::ParseDiagnostics;

use crate::output::results::FullParseResult;

pub(super) fn append_dropped_import_diagnostics(
    result: &FullParseResult,
    diagnostics: &mut ParseDiagnostics,
) {
    let mut dropped = Vec::new();

    if !result.custom_xml_parts.is_empty() {
        dropped.push("custom XML package parts");
    }
    if let Some(ext) = result.extensions.as_ref() {
        if !ext.binary_passthrough.is_empty() {
            dropped.push("binary passthrough package parts");
        }
        if !ext.workbook_namespaces.all().is_empty() {
            dropped.push("workbook namespace declarations");
        }
        if !ext.workbook_preserved.is_empty() {
            dropped.push("workbook unknown XML elements");
        }
        if !ext
            .sheet_namespaces
            .iter()
            .all(|namespaces| namespaces.all().is_empty())
        {
            dropped.push("worksheet namespace declarations");
        }
        if !ext
            .sheet_preserved
            .iter()
            .all(|preserved| preserved.is_empty())
        {
            dropped.push("worksheet unknown XML elements");
        }
    }

    if result
        .sheets
        .iter()
        .any(|sheet| !sheet.raw_vml_drawings.is_empty())
    {
        dropped.push("raw VML drawing sidecars");
    }
    if result.sheets.iter().any(|sheet| sheet.ext_lst_xml.is_some()) {
        dropped.push("worksheet extension-list XML");
    }
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.custom_properties_xml.is_some())
    {
        dropped.push("worksheet custom-property XML refs");
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
        dropped.push("drawing lexical/package sidecars");
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
}
