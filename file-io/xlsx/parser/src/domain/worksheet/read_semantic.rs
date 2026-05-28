use domain_types::{WorksheetSemanticContainers, WorksheetSemanticXml};

pub fn parse_worksheet_semantic_containers(xml: &[u8]) -> WorksheetSemanticContainers {
    WorksheetSemanticContainers {
        custom_sheet_views: extract_semantic_xml(xml, b"customSheetViews"),
        ignored_errors: extract_semantic_xml(xml, b"ignoredErrors"),
        sheet_calc_pr: extract_semantic_xml(xml, b"sheetCalcPr"),
        protected_ranges: extract_semantic_xml(xml, b"protectedRanges"),
        scenarios: extract_semantic_xml(xml, b"scenarios"),
        data_consolidate: extract_semantic_xml(xml, b"dataConsolidate"),
        phonetic_pr: extract_semantic_xml(xml, b"phoneticPr"),
        smart_tags: extract_semantic_xml(xml, b"smartTags"),
        cell_watches: extract_semantic_xml(xml, b"cellWatches"),
    }
}

fn extract_semantic_xml(xml: &[u8], tag: &[u8]) -> Option<WorksheetSemanticXml> {
    let start = crate::infra::scanner::find_tag_simd(xml, tag, 0)?;
    let (_, end) = crate::infra::xml_fragment::extract_element_bounds(xml, start)?;
    let raw_xml = std::str::from_utf8(&xml[start..end]).ok()?.to_owned();
    Some(WorksheetSemanticXml::new(raw_xml))
}
