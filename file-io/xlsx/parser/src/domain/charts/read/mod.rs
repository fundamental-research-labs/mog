//! Chart/SmartArt/Connector parsing functions for XLSX files.
//!
//! Extracted from parse_helpers.rs — temporarily duplicated until parse_helpers.rs
//! is removed during cleanup.

mod chart_ex;
mod connectors;
mod conversion;
mod extraction;
mod smartart;
mod xml_parsing;

use crate::zip::XlsxArchive;

use xml_parsing::{
    chart_rel_id_target_map, extract_chart_refs_from_drawing, extract_drawing_path_for_sheet,
    typed_drawing_relationships,
};

use conversion::convert_chart_to_chart_spec;

const EMUS_PER_PIXEL: f64 = 9525.0;

pub(super) fn emu_to_pixels(emu: i64) -> f64 {
    emu.max(0) as f64 / EMUS_PER_PIXEL
}

#[cfg(test)]
mod tests {
    use super::emu_to_pixels;

    #[test]
    fn emu_to_pixels_preserves_small_extents_without_minimum_clamp() {
        assert_eq!(emu_to_pixels(42 * 9525), 42.0);
        assert_eq!(emu_to_pixels(0), 0.0);
        assert_eq!(emu_to_pixels(-9525), 0.0);
    }
}

// Re-export the 5 public functions
pub use chart_ex::parse_chart_ex_for_sheet;
pub use connectors::parse_connectors_for_sheet;
pub use extraction::extract_chart_spec_from_chart_space;
pub(crate) use extraction::{
    extract_chart_format, extract_chart_line, extract_chart_rich_text, parse_chart_a1_ref,
    synthesize_rectangular_data_range,
};
pub use smartart::parse_smartart_for_sheet;
pub use xml_parsing::ChartRefInfo;

// =============================================================================
// Charts (per-sheet)
// =============================================================================

/// Parse charts for a given sheet by reading the drawing XML and resolving chart parts.
pub fn parse_charts_for_sheet(
    archive: &XlsxArchive,
    sheet_num: usize,
) -> Vec<domain_types::ChartSpec> {
    use crate::domain::charts::Chart;

    let mut charts = Vec::new();

    // Step 1: Read sheet .rels to find drawing reference
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return charts,
    };

    let drawing_path = match extract_drawing_path_for_sheet(sheet_num, &rels_xml) {
        Some(path) => path,
        None => return charts,
    };

    // Step 2: Read the drawing XML
    let drawing_xml = match archive.read_file(&drawing_path) {
        Ok(xml) => xml,
        Err(_) => return charts,
    };

    // Step 3: Read the drawing .rels to resolve chart rIds
    let drawing_filename = drawing_path.rsplit('/').next().unwrap_or(&drawing_path);
    let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);
    let drawing_rels_xml = archive.read_file(&drawing_rels_path).unwrap_or_default();
    let drawing_relationships = typed_drawing_relationships(&drawing_path, &drawing_rels_xml);
    let rels_map = chart_rel_id_target_map(&drawing_relationships);

    // Step 4: Find chart references in drawing XML (graphicFrame elements)
    let chart_refs = extract_chart_refs_from_drawing(&drawing_xml, &rels_map);

    // Step 5: Parse each chart and convert to ChartSpec
    for chart_ref in chart_refs {
        let chart_path = chart_ref.target.clone();
        let chart_xml = match archive.read_file(&chart_path) {
            Ok(xml) => xml,
            Err(_) => continue,
        };

        let parsed = Chart::parse(&chart_xml);
        let output = convert_chart_to_chart_spec(&parsed, &chart_ref);
        charts.push(output);
    }

    charts
}

/// Parse the full Drawing and rich Chart structs for a given sheet.
///
/// Returns `(Option<Drawing>, Vec<Chart>)` where the Drawing contains all anchored
/// objects (pictures, shapes, charts, connectors) and the Vec<Chart> contains fully
/// parsed chart data in the same order as chart GraphicFrame anchors appear in the drawing.
pub fn parse_drawing_and_charts_for_sheet(
    archive: &XlsxArchive,
    sheet_num: usize,
) -> (
    Option<crate::domain::drawings::types::Drawing>,
    Vec<crate::domain::charts::Chart>,
) {
    use crate::domain::charts::Chart;
    use crate::domain::drawings::{parse_drawing, resolve_drawing_hyperlink_targets};

    // Step 1: Read sheet .rels to find drawing reference
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return (None, Vec::new()),
    };

    let drawing_path = match extract_drawing_path_for_sheet(sheet_num, &rels_xml) {
        Some(path) => path,
        None => return (None, Vec::new()),
    };

    // Step 2: Read the drawing XML
    let drawing_xml = match archive.read_file(&drawing_path) {
        Ok(xml) => xml,
        Err(_) => return (None, Vec::new()),
    };

    // Step 3: Parse the Drawing struct with all anchors
    let mut drawing = parse_drawing(&drawing_xml);

    // Store raw drawing XML for verbatim round-trip passthrough.
    // Used as fallback when the structured write path can't represent all content.
    // Step 4: Read drawing .rels to resolve chart rIds and preserve for round-trip
    let drawing_filename = drawing_path.rsplit('/').next().unwrap_or(&drawing_path);
    let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);
    let rels_file_result = archive.read_file(&drawing_rels_path);
    drawing.has_rels_file = rels_file_result.is_ok();
    let drawing_rels_xml = rels_file_result.unwrap_or_default();
    if drawing.has_rels_file {
        drawing.raw_drawing_rels_xml = Some(drawing_rels_xml.clone());
    }
    let drawing_relationships = typed_drawing_relationships(&drawing_path, &drawing_rels_xml);
    let rels_map = chart_rel_id_target_map(&drawing_relationships);

    // Store drawing OPC relationships for round-trip fidelity (image refs, etc.)
    drawing.opc_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_xml);
    resolve_drawing_hyperlink_targets(&mut drawing);

    // Step 5: Find chart references and parse each chart
    let chart_refs = extract_chart_refs_from_drawing(&drawing_xml, &rels_map);

    // Store raw drawing XML for verbatim round-trip passthrough (after borrowing above).
    drawing.raw_drawing_xml = Some(drawing_xml);
    let mut charts = Vec::with_capacity(chart_refs.len());

    for chart_ref in chart_refs {
        let chart_path = chart_ref.target;
        let chart_xml = match archive.read_file(&chart_path) {
            Ok(xml) => xml,
            Err(_) => continue,
        };
        let mut chart = Chart::parse(&chart_xml);
        chart.raw_chart_xml = Some(chart_xml);
        chart.original_path = Some(chart_path.clone());

        // Read chart auxiliary files (.rels, style, colors) for round-trip passthrough.
        // The chart's .rels file is at xl/charts/_rels/chartN.xml.rels
        let chart_filename = chart_path.rsplit('/').next().unwrap_or("");
        let chart_dir = chart_path
            .rsplit_once('/')
            .map(|(d, _)| d)
            .unwrap_or("xl/charts");
        let chart_rels_path = format!("{}/_rels/{}.rels", chart_dir, chart_filename);

        if let Ok(rels_bytes) = archive.read_file(&chart_rels_path) {
            chart.auxiliary_files = read_chart_auxiliary_files(archive, &chart_path, &rels_bytes);
            chart.chart_rels_bytes = Some((chart_rels_path, rels_bytes));
        }

        charts.push(chart);
    }

    (Some(drawing), charts)
}

fn read_chart_auxiliary_files(
    archive: &XlsxArchive,
    chart_path: &str,
    chart_rels_bytes: &[u8],
) -> Vec<(String, Vec<u8>)> {
    let mut auxiliary_files = Vec::new();
    let mut seen_paths = std::collections::BTreeSet::new();

    for rel in crate::domain::workbook::read::parse_all_rels(chart_rels_bytes) {
        if target_mode_is_external(rel.target_mode.as_deref()) {
            continue;
        }
        let Ok(aux_path) =
            crate::infra::opc::resolve_relationship_target(Some(chart_path), &rel.target)
        else {
            continue;
        };
        let aux_path = aux_path.trim_start_matches('/').to_string();
        let Ok(aux_bytes) = archive.read_file(&aux_path) else {
            continue;
        };
        push_auxiliary_file(
            &mut auxiliary_files,
            &mut seen_paths,
            aux_path.clone(),
            aux_bytes,
        );

        if rel.rel_type == crate::infra::opc::REL_CHART_USER_SHAPES {
            read_user_shapes_relationship_closure(
                archive,
                &aux_path,
                &mut auxiliary_files,
                &mut seen_paths,
            );
        }
    }

    auxiliary_files
}

fn read_user_shapes_relationship_closure(
    archive: &XlsxArchive,
    user_shapes_path: &str,
    auxiliary_files: &mut Vec<(String, Vec<u8>)>,
    seen_paths: &mut std::collections::BTreeSet<String>,
) {
    let rels_path = relationships_path_for_part(user_shapes_path);
    let Ok(rels_bytes) = archive.read_file(&rels_path) else {
        return;
    };
    push_auxiliary_file(
        auxiliary_files,
        seen_paths,
        rels_path.clone(),
        rels_bytes.clone(),
    );

    for rel in crate::domain::workbook::read::parse_all_rels(&rels_bytes) {
        if rel.rel_type != crate::infra::opc::REL_IMAGE
            || target_mode_is_external(rel.target_mode.as_deref())
        {
            continue;
        }
        let Ok(media_path) =
            crate::infra::opc::resolve_relationship_target(Some(user_shapes_path), &rel.target)
        else {
            continue;
        };
        let media_path = media_path.trim_start_matches('/').to_string();
        let Ok(media_bytes) = archive.read_file(&media_path) else {
            continue;
        };
        push_auxiliary_file(auxiliary_files, seen_paths, media_path, media_bytes);
    }
}

fn push_auxiliary_file(
    auxiliary_files: &mut Vec<(String, Vec<u8>)>,
    seen_paths: &mut std::collections::BTreeSet<String>,
    path: String,
    bytes: Vec<u8>,
) {
    if seen_paths.insert(path.clone()) {
        auxiliary_files.push((path, bytes));
    }
}

fn relationships_path_for_part(part_path: &str) -> String {
    let part_path = part_path.trim_start_matches('/');
    let Some((dir, file_name)) = part_path.rsplit_once('/') else {
        return format!("_rels/{part_path}.rels");
    };
    format!("{dir}/_rels/{file_name}.rels")
}

fn target_mode_is_external(target_mode: Option<&str>) -> bool {
    target_mode.is_some_and(|mode| mode.eq_ignore_ascii_case("External"))
}
