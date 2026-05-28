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
    "dimension",
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



pub fn worksheet_preserved_xml_for_replay(raw_xml: &str) -> Option<String> {
    if raw_xml_contains_dropped_worksheet_semantic_child(raw_xml) {
        return None;
    }
    Some(raw_xml.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worksheet_dimension_is_modeled_not_raw_preserved() {
        let raw = r#"<dimension ref="A1:XFD1048576"/>"#;
        assert!(worksheet_preserved_xml_for_replay(raw).is_none());
    }

    #[test]
    fn unknown_worksheet_xml_replays() {
        let raw = r#"<thirdPartyFeature/>"#;
        assert_eq!(worksheet_preserved_xml_for_replay(raw).as_deref(), Some(raw));
    }
}
