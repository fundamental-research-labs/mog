use domain_types::ParseDiagnostics;

use crate::output::results::FullParseResult;

pub(super) fn append_dropped_import_diagnostics(
    result: &FullParseResult,
    diagnostics: &mut ParseDiagnostics,
) {
    let mut dropped = Vec::new();

    if let Some(ext) = result.extensions.as_ref() {
        if !ext.workbook_namespaces.all().is_empty() {
            dropped.push("workbook namespace declarations");
        }
        if !ext
            .sheet_namespaces
            .iter()
            .all(|namespaces| namespaces.all().is_empty())
        {
            dropped.push("worksheet namespace declarations");
        }
        append_suppressed_auxiliary_diagnostics(ext.imported_parts.paths(), &mut dropped);
    }

    if result
        .sheets
        .iter()
        .any(|sheet| !sheet.raw_vml_drawings.is_empty())
    {
        dropped.push("raw VML drawing sidecars");
    }
    if result
        .sheets
        .iter()
        .any(|sheet| !sheet.comments_root_namespace_attrs.is_empty())
    {
        dropped.push("comments root namespace declarations");
    }
    if result
        .sheets
        .iter()
        .any(|sheet| !sheet.table_xml_passthroughs.is_empty())
    {
        dropped.push("table XML passthrough package parts");
    }
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.header_footer_xml.is_some())
    {
        dropped.push("worksheet header/footer XML");
    }
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.worksheet_controls_xml.is_some())
    {
        dropped.push("worksheet controls XML sidecar");
    }
    if result
        .sheets
        .iter()
        .any(|sheet| sheet.ext_lst_xml.is_some())
    {
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
    if result.imported_calc_chain_entry_count > 0 {
        dropped.push("calculation chain cache");
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

fn append_suppressed_auxiliary_diagnostics<'a>(
    paths: impl Iterator<Item = &'a str>,
    dropped: &mut Vec<&'static str>,
) {
    for path in paths {
        if path.starts_with("xl/webextensions/") {
            dropped.push("active web extension package parts");
        } else if path == "xl/vbaProject.bin" {
            dropped.push("VBA project active content");
        } else if path == "xl/volatileDependencies.xml" {
            dropped.push("volatile dependency calculation sidecar");
        } else if path.starts_with("xl/timelineCaches/") || path.starts_with("xl/timelines/") {
            dropped.push("timeline package parts");
        } else if path.starts_with("xl/featurePropertyBag/") {
            dropped.push("feature property bag package parts");
        }
    }
}
