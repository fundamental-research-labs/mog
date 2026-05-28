//! Policy for raw XML that may survive through round-trip context.
//!
//! Preserved XML is only for unknown extension content. Known OOXML semantic
//! children listed here are either modeled elsewhere or intentionally dropped
//! until a typed owner is added.

pub const DROPPED_WORKBOOK_SEMANTIC_CHILDREN: &[&str] = &[
    "fileRecoveryPr",  // Recovery metadata is file-authoring policy, not sheet state.
    "smartTagPr",      // Smart Tags are legacy app metadata until typed ownership lands.
    "smartTagTypes",   // Smart Tag definitions must not be replayed opaquely.
    "webPublishItems", // Web publish settings are omitted until workbook web export is modeled.
    "extLst",          // Workbook extension owners must be typed before replay.
];

pub const DROPPED_WORKSHEET_SEMANTIC_CHILDREN: &[&str] = &[
    "dimension",        // Export derives worksheet extent from modeled cells.
    "customSheetViews", // View state can conflict with modeled sheet views.
    "ignoredErrors",    // Error-suppression policy needs typed cell/range ownership.
    "sheetCalcPr",      // Sheet calculation settings must follow typed calc state.
    "protectedRanges",  // Range permissions need typed protection ownership.
    "scenarios",        // What-if scenarios are domain state, not opaque XML.
    "dataConsolidate",  // Consolidation settings affect data semantics.
    "phoneticPr",       // Phonetic display policy needs typed text ownership.
    "smartTags",        // Smart Tags are legacy app metadata.
    "cellWatches",      // Watch-window metadata can reference stale cells.
    "webPublishItems",  // Web publish settings are omitted until modeled.
];

pub const DROPPED_WORKSHEET_EXT_URIS: &[&str] = &[
    // x14:sparklineGroups
    "{05C60535-1F16-4fd2-B633-F4F36F0B64E0}",
    // x14:dataValidations
    "{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}",
    // x14:id links from standard conditional-format rules to x14 CF owners.
    "{B025F937-C7B1-47D3-B67F-A62EFF666E3E}",
];

pub const DROPPED_WORKSHEET_EXT_CHILDREN: &[&str] = &[
    "dataValidations",
    "conditionalFormatting",
    "conditionalFormattings",
    "sparklineGroups",
    "id",
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
    let bytes = raw_xml.as_bytes();
    let local = local_name.as_bytes();
    let mut pos = 0;
    while let Some(rel) = memchr::memchr(b'<', &bytes[pos..]) {
        let lt = pos + rel;
        let mut name_start = lt + 1;
        if name_start >= bytes.len() {
            return false;
        }
        if matches!(bytes[name_start], b'/' | b'!' | b'?') {
            pos = name_start + 1;
            continue;
        }
        while name_start < bytes.len() && bytes[name_start].is_ascii_whitespace() {
            name_start += 1;
        }
        let mut name_end = name_start;
        while name_end < bytes.len() {
            let b = bytes[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }
        let tag = &bytes[name_start..name_end];
        let tag_local = match memchr::memrchr(b':', tag) {
            Some(colon) => &tag[colon + 1..],
            None => tag,
        };
        if tag_local == local {
            return true;
        }
        pos = name_end.saturating_add(1);
    }
    false
}

pub fn worksheet_preserved_xml_for_replay(raw_xml: &str) -> Option<String> {
    if raw_xml_contains_dropped_worksheet_semantic_child(raw_xml) {
        return None;
    }
    if !raw_xml_contains_element(raw_xml, "extLst") {
        return Some(raw_xml.to_string());
    }

    filter_ext_lst_entries(raw_xml, is_dropped_worksheet_ext_entry)
}

pub fn raw_xml_contains_dropped_worksheet_ext_owner(raw_xml: &str) -> bool {
    is_dropped_worksheet_ext_entry(raw_xml)
}

fn is_dropped_worksheet_ext_entry(raw_xml: &str) -> bool {
    DROPPED_WORKSHEET_EXT_URIS
        .iter()
        .any(|uri| raw_xml.contains(uri))
        || DROPPED_WORKSHEET_EXT_CHILDREN
            .iter()
            .any(|name| raw_xml_contains_element(raw_xml, name))
}

fn filter_ext_lst_entries(
    raw_xml: &str,
    should_drop_entry: impl Fn(&str) -> bool,
) -> Option<String> {
    if !raw_xml_contains_element(raw_xml, "extLst") {
        return Some(raw_xml.to_string());
    }

    let bytes = raw_xml.as_bytes();
    let root_start = find_opening_tag(bytes, "extLst", 0)?;
    let root_start_tag_end = memchr::memchr(b'>', &bytes[root_start..])? + root_start + 1;
    if bytes[root_start_tag_end.saturating_sub(2)] == b'/' {
        return None;
    }
    let root_end = crate::roundtrip::unknown_elements::extract_element_bounds(bytes, root_start)?.1;
    let close_start = find_last_closing_tag(bytes, "extLst", root_start_tag_end, root_end)?;

    let mut kept = String::new();
    let mut pos = root_start_tag_end;
    while pos < close_start {
        let Some(ext_start) = find_opening_tag(bytes, "ext", pos) else {
            break;
        };
        if ext_start >= close_start {
            break;
        }
        let Some((_, ext_end)) =
            crate::roundtrip::unknown_elements::extract_element_bounds(bytes, ext_start)
        else {
            break;
        };
        if ext_end > root_end {
            break;
        }
        if let Ok(entry) = std::str::from_utf8(&bytes[ext_start..ext_end]) {
            if !should_drop_entry(entry) {
                kept.push_str(entry);
            }
        }
        pos = ext_end;
    }

    if kept.is_empty() {
        return None;
    }

    let start_tag = std::str::from_utf8(&bytes[root_start..root_start_tag_end]).ok()?;
    let end_tag = std::str::from_utf8(&bytes[close_start..root_end]).ok()?;
    Some(format!("{start_tag}{kept}{end_tag}"))
}

fn find_opening_tag(xml: &[u8], local_name: &str, from: usize) -> Option<usize> {
    let local = local_name.as_bytes();
    let mut pos = from;
    while let Some(rel) = memchr::memchr(b'<', &xml[pos..]) {
        let lt = pos + rel;
        let name_start = lt + 1;
        if name_start >= xml.len() || matches!(xml[name_start], b'/' | b'!' | b'?') {
            pos = name_start.saturating_add(1);
            continue;
        }
        let mut name_end = name_start;
        while name_end < xml.len() {
            let b = xml[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/') {
                break;
            }
            name_end += 1;
        }
        let tag = &xml[name_start..name_end];
        let tag_local = match memchr::memrchr(b':', tag) {
            Some(colon) => &tag[colon + 1..],
            None => tag,
        };
        if tag_local == local {
            return Some(lt);
        }
        pos = name_end.saturating_add(1);
    }
    None
}

fn find_last_closing_tag(xml: &[u8], local_name: &str, from: usize, to: usize) -> Option<usize> {
    let local = local_name.as_bytes();
    let mut pos = from;
    let mut last = None;
    while let Some(rel) = memchr::memchr(b'<', &xml[pos..to]) {
        let lt = pos + rel;
        let name_start = lt + 2;
        if lt + 1 >= to || xml[lt + 1] != b'/' || name_start >= to {
            pos = lt + 1;
            continue;
        }
        let mut name_end = name_start;
        while name_end < to {
            let b = xml[name_end];
            if matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'>') {
                break;
            }
            name_end += 1;
        }
        let tag = &xml[name_start..name_end];
        let tag_local = match memchr::memrchr(b':', tag) {
            Some(colon) => &tag[colon + 1..],
            None => tag,
        };
        if tag_local == local {
            last = Some(lt);
        }
        pos = name_end.saturating_add(1);
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn element_detection_matches_tag_local_name_only() {
        assert!(raw_xml_contains_element("<x:ignoredErrors/>", "ignoredErrors"));
        assert!(raw_xml_contains_element("<ignoredErrors/>", "ignoredErrors"));
        assert!(!raw_xml_contains_element(
            r#"<x:ext uri="ignoredErrors"/>"#,
            "ignoredErrors"
        ));
    }

    #[test]
    fn worksheet_ext_lst_keeps_unknown_extensions() {
        let raw = r#"<extLst><ext uri="{unknown}"><x:future/></ext></extLst>"#;
        let filtered = worksheet_preserved_xml_for_replay(raw).unwrap();
        assert!(filtered.contains("{unknown}"));
        assert!(filtered.contains("<x:future/>"));
    }

    #[test]
    fn worksheet_ext_lst_drops_x14_owned_extensions() {
        let raw = r#"<extLst><ext uri="{unknown}"><x:future/></ext><ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"><x14:sparklineGroups/></ext><ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}"><x14:dataValidations/></ext><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}"><x14:id>{id}</x14:id></ext></extLst>"#;
        let filtered = worksheet_preserved_xml_for_replay(raw).unwrap();
        assert!(filtered.contains("{unknown}"));
        assert!(!filtered.contains("sparklineGroups"));
        assert!(!filtered.contains("dataValidations"));
        assert!(!filtered.contains("B025F937"));
    }

    #[test]
    fn worksheet_ext_lst_with_only_owned_extensions_is_dropped() {
        let raw = r#"<extLst><ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}"><x14:dataValidations/></ext></extLst>"#;
        assert!(worksheet_preserved_xml_for_replay(raw).is_none());
    }
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
