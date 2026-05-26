//! ChartEx parsing (modern chart types).

use crate::zip::XlsxArchive;

use super::xml_parsing::{
    extract_drawing_target, extract_rel_id_target_map_bytes, resolve_relative_path,
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
    use crate::domain::charts::chart_ex_read::parse_chart_ex;

    let mut result = Vec::new();

    // Step 1: Read sheet .rels to find drawing reference
    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return result,
    };

    let drawing_target = match extract_drawing_target(&rels_xml) {
        Some(t) => t,
        None => return result,
    };

    // Step 2: Read the drawing .rels
    let drawing_path = resolve_relative_path("xl/worksheets", &drawing_target);
    let drawing_filename = drawing_path.rsplit('/').next().unwrap_or(&drawing_path);
    let drawing_rels_path = format!("xl/drawings/_rels/{}.rels", drawing_filename);
    let drawing_rels_xml = match archive.read_file(&drawing_rels_path) {
        Ok(xml) => xml,
        Err(_) => return result,
    };

    // Step 3: Find chartEx relationship targets
    let chartex_rel_type = b"http://schemas.microsoft.com/office/2014/relationships/chartEx";
    let all_rels = crate::domain::workbook::read::parse_all_rels(&drawing_rels_xml);

    for rel in &all_rels {
        if !rel
            .rel_type
            .as_bytes()
            .windows(chartex_rel_type.len())
            .any(|w| w == chartex_rel_type.as_slice())
        {
            continue;
        }

        // Resolve chartEx path relative to drawings directory
        let chart_ex_path = resolve_relative_path("xl/drawings", &rel.target);

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
            chart_rels_bytes,
            auxiliary_files,
        });
    }

    result
}
