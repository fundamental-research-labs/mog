use std::collections::HashMap;

use super::api::ExpandedName;

/// Seed defaults for the most common ECMA-376 elements. Consumers extend
/// by merging into `XmlDiffOptions::attribute_defaults`.
pub(super) fn common_attribute_defaults() -> HashMap<(ExpandedName, ExpandedName), String> {
    let mut m = HashMap::new();

    const MAIN_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    m.insert(
        (
            ExpandedName::new(MAIN_NS, "color"),
            ExpandedName::unbound("indexed"),
        ),
        "0".to_string(),
    );

    m.insert(
        (
            ExpandedName::new(MAIN_NS, "color"),
            ExpandedName::unbound("auto"),
        ),
        "false".to_string(),
    );

    const CHART_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
    for tag in &["delete", "auto", "noMultiLvlLbl"] {
        m.insert(
            (
                ExpandedName::new(CHART_NS, (*tag).to_string()),
                ExpandedName::unbound("val"),
            ),
            "0".to_string(),
        );
    }

    m
}
