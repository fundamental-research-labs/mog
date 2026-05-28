//! ChartEx parsing (modern chart types).

use crate::zip::XlsxArchive;

use crate::infra::opc::DrawingRelationships;

use super::xml_parsing::{
    extract_drawing_path_for_sheet, extract_rel_id_target_map_bytes, internal_target_path,
    resolve_relative_path, typed_drawing_relationships,
};

/// Parse ChartEx parts for a given sheet by reading the drawing .rels.
///
/// ChartEx parts use the relationship type
/// `http://schemas.microsoft.com/office/2014/relationships/chartEx`
/// and are stored at `xl/charts/chartExN.xml`.
pub fn parse_chart_ex_for_sheet(
    archive: &XlsxArchive,
    sheet_num: usize,
) -> Vec<crate::output::results::ParsedChartEx> {
    use crate::domain::charts::chart_ex::read::parse_chart_ex;

    let mut result = Vec::new();

    // Step 1: Read sheet .rels to find drawing reference
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return result,
    };

    let drawing_path = match extract_drawing_path_for_sheet(sheet_num, &rels_xml) {
        Some(path) => path,
        None => return result,
    };

    // Step 2: Read the drawing .rels
    let drawing_filename = drawing_path.rsplit('/').next().unwrap_or(&drawing_path);
    let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);
    let drawing_rels_xml = match archive.read_file(&drawing_rels_path) {
        Ok(xml) => xml,
        Err(_) => return result,
    };

    // Step 3: Find chartEx relationship targets
    let drawing_relationships = typed_drawing_relationships(&drawing_path, &drawing_rels_xml);

    for rel in DrawingRelationships::new(&drawing_relationships).chart_ex() {
        let Some(chart_ex_path) = internal_target_path(rel) else {
            continue;
        };

        // Read and parse the chartEx XML
        let chart_ex_xml = match archive.read_file(&chart_ex_path) {
            Ok(xml) => xml,
            Err(_) => continue,
        };
        let chart_space = parse_chart_ex(&chart_ex_xml);

        // Read .rels and auxiliary files
        let chart_ex_filename = chart_ex_path.rsplit('/').next().unwrap_or("");
        let chart_ex_dir = chart_ex_path
            .rsplit_once('/')
            .map(|(d, _)| d)
            .unwrap_or("xl/charts");
        let chart_ex_rels_path = format!("{}/_rels/{}.rels", chart_ex_dir, chart_ex_filename);

        let mut auxiliary_files = Vec::new();
        let chart_rels_bytes = if let Ok(rels_bytes) = archive.read_file(&chart_ex_rels_path) {
            let aux_targets = extract_rel_id_target_map_bytes(&rels_bytes);
            for target in aux_targets.values() {
                let aux_path = resolve_relative_path(chart_ex_dir, target);
                if let Ok(aux_bytes) = archive.read_file(&aux_path) {
                    auxiliary_files.push((aux_path, aux_bytes));
                }
            }
            Some((chart_ex_rels_path, rels_bytes))
        } else {
            None
        };

        result.push(crate::output::results::ParsedChartEx {
            chart_space,
            original_path: chart_ex_path,
            original_xml: chart_ex_xml,
            chart_rels_bytes,
            auxiliary_files,
        });
    }

    result
}
