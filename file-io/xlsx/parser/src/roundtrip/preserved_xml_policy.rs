//! Policy for raw XML that may survive through round-trip context.
//!
//! Preserved XML is only for unknown extension content. Known OOXML semantic
//! children listed here are either modeled elsewhere or intentionally dropped
//! until a typed owner is added.

pub const DROPPED_WORKBOOK_SEMANTIC_CHILDREN: &[&str] = &[
    "fileRecoveryPr",
    "smartTagPr",
    "smartTagTypes",
    "webPublishItems",
    "extLst",
];

pub const DROPPED_WORKSHEET_SEMANTIC_CHILDREN: &[&str] = &[
    "customSheetViews",
    "ignoredErrors",
    "sheetCalcPr",
    "protectedRanges",
    "scenarios",
    "dataConsolidate",
    "phoneticPr",
    "smartTags",
    "cellWatches",
    "webPublishItems",
];

pub fn is_dropped_workbook_semantic_child(local_name: &str) -> bool {
    DROPPED_WORKBOOK_SEMANTIC_CHILDREN.contains(&local_name)
}

pub fn is_dropped_worksheet_semantic_child(local_name: &str) -> bool {
    DROPPED_WORKSHEET_SEMANTIC_CHILDREN.contains(&local_name)
}

pub fn raw_xml_contains_dropped_workbook_semantic_child(raw_xml: &str) -> bool {
    DROPPED_WORKBOOK_SEMANTIC_CHILDREN
        .iter()
        .any(|name| raw_xml_contains_element(raw_xml, name))
}

pub fn raw_xml_contains_dropped_worksheet_semantic_child(raw_xml: &str) -> bool {
    DROPPED_WORKSHEET_SEMANTIC_CHILDREN
        .iter()
        .any(|name| raw_xml_contains_element(raw_xml, name))
}

pub fn raw_xml_contains_element(raw_xml: &str, local_name: &str) -> bool {
    raw_xml.contains(&format!("<{local_name}"))
        || raw_xml.contains(&format!(":{local_name}"))
}

