use crate::infra::opc::{
    PackageOwner, WorkbookRelationships, WorksheetRelationships, parse_owned_relationships,
};

use super::super::types::{SlicerAnchor, SlicerCacheDef, SlicerDef};
use super::anchors::parse_slicer_anchors_from_drawing;
use super::cache::parse_slicer_cache;
use super::part::parse_slicer_part;

/// Parse slicers and drawing anchors for a given sheet.
pub fn parse_slicers_for_sheet(
    archive: &crate::zip::XlsxArchive,
    sheet_num: usize,
) -> (Vec<SlicerDef>, Vec<SlicerAnchor>) {
    let mut all_slicers = Vec::new();
    let mut all_anchors = Vec::new();

    let rels_path = format!("xl/worksheets/_rels/sheet{}.xml.rels", sheet_num);
    let rels_xml = match archive.read_file(&rels_path) {
        Ok(xml) => xml,
        Err(_) => return (all_slicers, all_anchors),
    };

    let sheet_relationships = parse_owned_relationships(
        PackageOwner::Worksheet {
            sheet_index: sheet_num,
            path: format!("xl/worksheets/sheet{}.xml", sheet_num),
        },
        &rels_xml,
    );
    let worksheet_relationships = WorksheetRelationships::new(&sheet_relationships);

    for rel in worksheet_relationships.slicers() {
        let Some(full_path) = rel.target.path() else {
            continue;
        };
        if let Ok(slicer_xml) = archive.read_file(full_path) {
            let mut parsed = parse_slicer_part(&slicer_xml);
            all_slicers.append(&mut parsed);
        }
    }

    if let Some(drawing_rel) = worksheet_relationships.drawing() {
        if let Some(drawing_path) = drawing_rel.target.path() {
            if let Ok(drawing_xml) = archive.read_file(drawing_path) {
                let mut anchors = parse_slicer_anchors_from_drawing(&drawing_xml);
                all_anchors.append(&mut anchors);
            }
        }
    }

    (all_slicers, all_anchors)
}

/// Parse all slicer cache definitions from workbook relationships.
pub fn parse_all_slicer_caches(archive: &crate::zip::XlsxArchive) -> Vec<SlicerCacheDef> {
    let mut caches = Vec::new();

    let rels_xml = match archive.read_file("xl/_rels/workbook.xml.rels") {
        Ok(xml) => xml,
        Err(_) => return caches,
    };

    let workbook_relationships = parse_owned_relationships(PackageOwner::Workbook, &rels_xml);
    let workbook_relationships = WorkbookRelationships::new(&workbook_relationships);

    for rel in workbook_relationships.slicer_caches() {
        let Some(full_path) = rel.target.path() else {
            continue;
        };
        if let Ok(cache_xml) = archive.read_file(full_path) {
            if let Some(cache) = parse_slicer_cache(&cache_xml) {
                caches.push(cache);
            }
        }
    }

    caches
}
