const X14_DV_CF_EXT_URI: &str = "{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}";
const X14_GENERATED_CHILDREN: &[&str] = &["dataValidations", "conditionalFormattings"];

pub(super) fn merge_ext_lst_entries(
    raw_ext_lst: Option<&str>,
    generated_parts: &[String],
) -> String {
    if raw_ext_lst.is_none() && generated_parts.is_empty() {
        return String::new();
    }

    if let Some(raw_xml) = raw_ext_lst
        && generated_parts.is_empty()
        && is_self_closing_ext_lst(raw_xml)
    {
        return raw_xml.to_string();
    }

    let generated_entries: Vec<ExtEntry<'_>> = generated_parts
        .iter()
        .flat_map(|part| split_ext_entries(part))
        .collect();
    let generated_x14_children = generated_entries
        .iter()
        .filter(|entry| is_x14_dv_cf_ext_uri(entry.uri))
        .flat_map(|entry| generated_x14_child_xml(entry.xml))
        .collect::<Vec<_>>();
    let mut generated_used = vec![false; generated_entries.len()];
    let mut merged_entries = Vec::new();
    let mut merged_x14_entry = false;

    if let Some(raw_xml) = raw_ext_lst {
        if !is_self_closing_ext_lst(raw_xml) {
            for raw_entry in split_ext_entries(raw_xml) {
                if crate::infra::xml::raw_xml_contains_relationship_attr(raw_entry.xml) {
                    continue;
                }
                if is_x14_dv_cf_ext_uri(raw_entry.uri) && !generated_x14_children.is_empty() {
                    if merged_x14_entry {
                        continue;
                    }
                    merged_entries.push(merge_x14_children(raw_entry.xml, &generated_x14_children));
                    for (idx, entry) in generated_entries.iter().enumerate() {
                        if is_x14_dv_cf_ext_uri(entry.uri) {
                            generated_used[idx] = true;
                        }
                    }
                    merged_x14_entry = true;
                    continue;
                }

                if let Some(uri) = raw_entry.uri
                    && let Some((idx, generated_entry)) = generated_entries
                        .iter()
                        .enumerate()
                        .find(|(idx, entry)| !generated_used[*idx] && entry.uri == Some(uri))
                {
                    generated_used[idx] = true;
                    merged_entries.push(generated_entry.xml.to_string());
                    continue;
                }
                merged_entries.push(raw_entry.xml.to_string());
            }
        }
    }

    if !generated_x14_children.is_empty() && !merged_x14_entry {
        merged_entries.push(synthetic_x14_ext(&generated_x14_children));
        for (idx, entry) in generated_entries.iter().enumerate() {
            if is_x14_dv_cf_ext_uri(entry.uri) {
                generated_used[idx] = true;
            }
        }
    }

    for (idx, generated_entry) in generated_entries.iter().enumerate() {
        if !generated_used[idx] {
            merged_entries.push(generated_entry.xml.to_string());
        }
    }

    if merged_entries.is_empty() {
        return String::new();
    }

    combine_ext_lst_entries(&merged_entries)
}

pub fn strip_modeled_x14_data_validations_from_ext_lst(raw_ext_lst: &str) -> Option<String> {
    if !raw_ext_lst.contains("dataValidations") {
        return Some(raw_ext_lst.to_string());
    }

    let mut changed = false;
    let mut entries = Vec::new();
    for entry in split_ext_entries(raw_ext_lst) {
        if !is_x14_dv_cf_ext_uri(entry.uri) {
            entries.push(entry.xml.to_string());
            continue;
        }

        match remove_child_from_ext_entry(entry.xml, "dataValidations") {
            RemoveChildResult::Unchanged => entries.push(entry.xml.to_string()),
            RemoveChildResult::Removed(updated) => {
                changed = true;
                entries.push(updated);
            }
            RemoveChildResult::Empty => {
                changed = true;
            }
        }
    }

    if !changed {
        return Some(raw_ext_lst.to_string());
    }
    (!entries.is_empty()).then(|| combine_ext_lst_entries(&entries))
}

enum RemoveChildResult {
    Unchanged,
    Removed(String),
    Empty,
}

fn remove_child_from_ext_entry(ext_xml: &str, local_name: &str) -> RemoveChildResult {
    let Some(start) = ext_xml.find('<') else {
        return RemoveChildResult::Unchanged;
    };
    let Some(start_end) = find_tag_end(ext_xml, start) else {
        return RemoveChildResult::Unchanged;
    };
    let Some(tag_name) = tag_name_from_start(&ext_xml[start..start_end]) else {
        return RemoveChildResult::Unchanged;
    };
    if is_self_closing_start_tag(&ext_xml[start..start_end]) {
        return RemoveChildResult::Unchanged;
    }
    let close = format!("</{tag_name}>");
    let Some(end_start) = ext_xml.rfind(&close) else {
        return RemoveChildResult::Unchanged;
    };

    let mut body = ext_xml[start_end..end_start].to_string();
    let mut changed = false;
    while let Some((child_start, child_end)) =
        find_first_child_bounds_by_local_name(&body, local_name)
    {
        body.replace_range(child_start..child_end, "");
        changed = true;
    }
    if !changed {
        return RemoveChildResult::Unchanged;
    }
    if body.trim().is_empty() {
        return RemoveChildResult::Empty;
    }

    let mut updated = String::new();
    updated.push_str(&ext_xml[..start_end]);
    updated.push_str(&body);
    updated.push_str(&ext_xml[end_start..]);
    RemoveChildResult::Removed(updated)
}

fn is_x14_dv_cf_ext_uri(uri: Option<&str>) -> bool {
    uri.is_some_and(|uri| uri.eq_ignore_ascii_case(X14_DV_CF_EXT_URI))
}

fn generated_x14_child_xml(ext_xml: &str) -> Vec<String> {
    let search_xml = ext_body(ext_xml).unwrap_or(ext_xml);
    X14_GENERATED_CHILDREN
        .iter()
        .filter_map(|local_name| extract_first_child_by_local_name(search_xml, local_name))
        .map(ToOwned::to_owned)
        .collect()
}

fn ext_body(ext_xml: &str) -> Option<&str> {
    let start_end = find_tag_end(ext_xml, ext_xml.find('<')?)?;
    let tag_name = tag_name_from_start(&ext_xml[..start_end])?;
    if is_self_closing_start_tag(&ext_xml[..start_end]) {
        return Some("");
    }
    let close = format!("</{tag_name}>");
    let end_start = ext_xml.rfind(&close)?;
    (start_end <= end_start).then_some(&ext_xml[start_end..end_start])
}

fn merge_x14_children(raw_ext_xml: &str, generated_children: &[String]) -> String {
    let Some(start) = raw_ext_xml.find('<') else {
        return raw_ext_xml.to_string();
    };
    let Some(start_end) = find_tag_end(raw_ext_xml, start) else {
        return raw_ext_xml.to_string();
    };
    let Some(tag_name) = tag_name_from_start(&raw_ext_xml[start..start_end]) else {
        return raw_ext_xml.to_string();
    };
    let close = format!("</{tag_name}>");
    let Some(end_start) = raw_ext_xml.rfind(&close) else {
        return raw_ext_xml.to_string();
    };

    let mut body = raw_ext_xml[start_end..end_start].to_string();
    for child in generated_children {
        let local_name = local_name_from_start_tag(child).unwrap_or_default();
        body = replace_or_append_child(&body, local_name, child);
    }

    let mut merged = String::new();
    merged.push_str(&raw_ext_xml[..start_end]);
    merged.push_str(&body);
    merged.push_str(&raw_ext_xml[end_start..]);
    merged
}

fn replace_or_append_child(body: &str, local_name: &str, generated_child: &str) -> String {
    if let Some((start, end)) = find_first_child_bounds_by_local_name(body, local_name) {
        let mut out = String::new();
        out.push_str(&body[..start]);
        out.push_str(generated_child);
        out.push_str(&body[end..]);
        out
    } else {
        let mut out = body.to_string();
        out.push_str(generated_child);
        out
    }
}

fn synthetic_x14_ext(children: &[String]) -> String {
    let mut xml = String::from(
        r#"<ext uri="{CCE6A557-97BC-4B89-ADB6-D9C93CAAB3DF}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">"#,
    );
    for child in children {
        xml.push_str(child);
    }
    xml.push_str("</ext>");
    xml
}

fn extract_first_child_by_local_name<'a>(xml: &'a str, local_name: &str) -> Option<&'a str> {
    let (start, end) = find_first_child_bounds_by_local_name(xml, local_name)?;
    Some(&xml[start..end])
}

fn find_first_child_bounds_by_local_name(xml: &str, local_name: &str) -> Option<(usize, usize)> {
    let mut pos = 0;
    while let Some(rel) = xml[pos..].find('<') {
        let start = pos + rel;
        if matches!(xml.as_bytes().get(start + 1), Some(b'/' | b'!' | b'?')) {
            pos = find_tag_end(xml, start).unwrap_or(xml.len());
            continue;
        }
        let tag_end = find_tag_end(xml, start)?;
        let tag_name = tag_name_from_start(&xml[start..tag_end])?;
        if local_name_from_tag_name(tag_name) == local_name {
            let end = element_end(xml, start, tag_end, tag_name)?;
            return Some((start, end));
        }
        pos = element_end(xml, start, tag_end, tag_name)?;
    }
    None
}

fn element_end(xml: &str, start: usize, tag_end: usize, tag_name: &str) -> Option<usize> {
    if is_self_closing_start_tag(&xml[start..tag_end]) {
        return Some(tag_end);
    }
    let close = format!("</{tag_name}>");
    xml[tag_end..]
        .find(&close)
        .map(|rel| tag_end + rel + close.len())
}

fn local_name_from_start_tag(xml: &str) -> Option<&str> {
    tag_name_from_start(xml).map(local_name_from_tag_name)
}

fn tag_name_from_start(start_tag: &str) -> Option<&str> {
    let name_start = start_tag.find('<')? + 1;
    let name_end = start_tag[name_start..]
        .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
        .map(|pos| name_start + pos)
        .unwrap_or(start_tag.len());
    Some(&start_tag[name_start..name_end])
}

fn local_name_from_tag_name(name: &str) -> &str {
    name.rsplit_once(':')
        .map_or(name, |(_, local_name)| local_name)
}

fn find_tag_end(xml: &str, start: usize) -> Option<usize> {
    let mut quote = None;
    for (rel, byte) in xml.as_bytes().get(start..)?.iter().enumerate() {
        match (*byte, quote) {
            (b'"' | b'\'', None) => quote = Some(*byte),
            (b, Some(q)) if b == q => quote = None,
            (b'>', None) => return Some(start + rel + 1),
            _ => {}
        }
    }
    None
}

fn is_self_closing_start_tag(start_tag: &str) -> bool {
    start_tag
        .trim_end()
        .strip_suffix('>')
        .is_some_and(|tag| tag.trim_end().ends_with('/'))
}

fn is_self_closing_ext_lst(xml: &str) -> bool {
    let trimmed = xml.trim();
    let Some(tag_end) = find_tag_end(trimmed, 0) else {
        return false;
    };
    tag_name_from_start(&trimmed[..tag_end])
        .is_some_and(|name| local_name_from_tag_name(name) == "extLst")
        && is_self_closing_start_tag(&trimmed[..tag_end])
}

fn combine_ext_lst_entries(parts: &[String]) -> String {
    let mut xml = String::from("<extLst>");
    for part in parts {
        if let Some(inner) = ext_lst_inner(part) {
            xml.push_str(inner);
        } else {
            xml.push_str(part);
        }
    }
    xml.push_str("</extLst>");
    xml
}

fn ext_lst_inner(xml: &str) -> Option<&str> {
    let (start_tag_end, element_start) = find_ext_lst_start_tag(xml)?;
    let end = find_ext_lst_end_tag(xml, element_start)?;
    (start_tag_end <= end).then_some(&xml[start_tag_end..end])
}

#[derive(Clone, Copy)]
struct ExtEntry<'a> {
    xml: &'a str,
    uri: Option<&'a str>,
}

fn split_ext_entries(xml: &str) -> Vec<ExtEntry<'_>> {
    let inner = ext_lst_inner(xml).unwrap_or(xml);
    let mut entries = Vec::new();
    let mut pos = 0;
    while let Some((start, end)) = find_child_bounds_by_local_name_from(inner, "ext", pos) {
        let Some(start_tag_end) = find_tag_end(inner, start) else {
            pos = end;
            continue;
        };
        let start_tag = &inner[start..start_tag_end];
        entries.push(ExtEntry {
            xml: &inner[start..end],
            uri: parse_ext_uri(start_tag),
        });
        pos = end;
    }
    if entries.is_empty() && !inner.trim().is_empty() {
        entries.push(ExtEntry {
            xml: inner,
            uri: None,
        });
    }
    entries
}

fn find_child_bounds_by_local_name_from(
    xml: &str,
    local_name: &str,
    mut pos: usize,
) -> Option<(usize, usize)> {
    while let Some(rel) = xml.get(pos..)?.find('<') {
        let start = pos + rel;
        if matches!(xml.as_bytes().get(start + 1), Some(b'/' | b'!' | b'?')) {
            pos = find_tag_end(xml, start).unwrap_or(xml.len());
            continue;
        }
        let tag_end = find_tag_end(xml, start)?;
        let tag_name = tag_name_from_start(&xml[start..tag_end])?;
        let end = element_end(xml, start, tag_end, tag_name)?;
        if local_name_from_tag_name(tag_name) == local_name {
            return Some((start, end));
        }
        pos = end;
    }
    None
}

fn find_ext_lst_start_tag(xml: &str) -> Option<(usize, usize)> {
    find_first_child_bounds_by_local_name(xml, "extLst").and_then(|(start, _)| {
        let end = find_tag_end(xml, start)?;
        Some((end, start))
    })
}

fn find_ext_lst_end_tag(xml: &str, element_start: usize) -> Option<usize> {
    let start_tag_end = find_tag_end(xml, element_start)?;
    let root_name = tag_name_from_start(&xml[element_start..start_tag_end])?;
    if is_self_closing_start_tag(&xml[element_start..start_tag_end]) {
        return Some(start_tag_end);
    }
    let close = format!("</{root_name}>");
    xml.rfind(&close)
}

fn parse_ext_uri(start_tag: &str) -> Option<&str> {
    let uri_pos = start_tag.find("uri")?;
    let after_uri = &start_tag[uri_pos + "uri".len()..];
    let eq_pos = after_uri.find('=')?;
    let value = after_uri[eq_pos + 1..].trim_start();
    let quote = value.as_bytes().first().copied()?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let value = &value[1..];
    let end = value.find(quote as char)?;
    Some(&value[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    const X14_EXT_URI_LOWER_VARIANT: &str = "{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}";

    fn x14_dv_ext(uri: &str, sqref: &str, formula: &str) -> String {
        format!(
            r#"<ext uri="{uri}"><x14:dataValidations xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main" count="1"><x14:dataValidation type="list"><x14:formula1><xm:f>{formula}</xm:f></x14:formula1><xm:sqref>{sqref}</xm:sqref></x14:dataValidation></x14:dataValidations></ext>"#
        )
    }

    fn x14_cf_ext(uri: &str) -> String {
        format!(
            r#"<ext uri="{uri}"><x14:conditionalFormattings xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormatting/></x14:conditionalFormattings></ext>"#
        )
    }

    #[test]
    fn known_x14_dv_cf_uri_is_case_insensitive_only_for_owned_guid() {
        assert!(is_x14_dv_cf_ext_uri(Some(X14_DV_CF_EXT_URI)));
        assert!(is_x14_dv_cf_ext_uri(Some(X14_EXT_URI_LOWER_VARIANT)));
        assert!(!is_x14_dv_cf_ext_uri(Some(
            "{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3D0}"
        )));
        assert!(!is_x14_dv_cf_ext_uri(Some(
            "CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF"
        )));
    }

    #[test]
    fn lower_case_raw_x14_uri_merges_with_generated_current_children() {
        let raw = format!(
            r#"<extLst>{}</extLst>"#,
            x14_dv_ext(X14_EXT_URI_LOWER_VARIANT, "A1:A3", "old")
        );
        let generated = vec![x14_dv_ext(X14_DV_CF_EXT_URI, "B1:B3", "current")];

        let merged = merge_ext_lst_entries(Some(&raw), &generated);
        let entries = split_ext_entries(&merged);

        assert_eq!(
            entries
                .iter()
                .filter(|entry| is_x14_dv_cf_ext_uri(entry.uri))
                .count(),
            1
        );
        assert!(merged.contains(&format!(r#"uri="{X14_EXT_URI_LOWER_VARIANT}""#)));
        assert!(merged.contains("<xm:f>current</xm:f>"));
        assert!(merged.contains("<xm:sqref>B1:B3</xm:sqref>"));
        assert!(!merged.contains("<xm:f>old</xm:f>"));
        assert!(!merged.contains("<xm:sqref>A1:A3</xm:sqref>"));
    }

    #[test]
    fn x14_data_validations_and_conditional_formatting_share_one_wrapper() {
        let raw = format!(
            r#"<extLst>{}</extLst>"#,
            x14_dv_ext(X14_EXT_URI_LOWER_VARIANT, "A1", "old")
        );
        let generated = vec![
            x14_dv_ext(X14_DV_CF_EXT_URI, "C1", "fresh"),
            x14_cf_ext(X14_DV_CF_EXT_URI),
        ];

        let merged = merge_ext_lst_entries(Some(&raw), &generated);
        let entries = split_ext_entries(&merged);

        assert_eq!(
            entries
                .iter()
                .filter(|entry| is_x14_dv_cf_ext_uri(entry.uri))
                .count(),
            1
        );
        assert!(merged.contains("<x14:dataValidations"));
        assert!(merged.contains("<x14:conditionalFormattings"));
        assert!(merged.contains("<xm:f>fresh</xm:f>"));
        assert!(!merged.contains("<xm:f>old</xm:f>"));
    }

    #[test]
    fn duplicate_raw_x14_wrappers_are_not_replayed_after_current_merge() {
        let raw = format!(
            r#"<extLst>{}{}</extLst>"#,
            x14_dv_ext(X14_EXT_URI_LOWER_VARIANT, "A1", "old-one"),
            x14_dv_ext(X14_DV_CF_EXT_URI, "A2", "old-two")
        );
        let generated = vec![x14_dv_ext(X14_DV_CF_EXT_URI, "D1", "current")];

        let merged = merge_ext_lst_entries(Some(&raw), &generated);
        let entries = split_ext_entries(&merged);

        assert_eq!(
            entries
                .iter()
                .filter(|entry| is_x14_dv_cf_ext_uri(entry.uri))
                .count(),
            1
        );
        assert!(merged.contains("<xm:f>current</xm:f>"));
        assert!(!merged.contains("<xm:f>old-one</xm:f>"));
        assert!(!merged.contains("<xm:f>old-two</xm:f>"));
    }

    #[test]
    fn modeled_x14_data_validations_are_removed_from_raw_ext_lst() {
        let raw = format!(
            r#"<extLst>{}<ext uri="{{raw}}"><raw:payload xmlns:raw="urn:raw"/></ext></extLst>"#,
            x14_dv_ext(X14_DV_CF_EXT_URI, "A1", "old")
        );

        let stripped = strip_modeled_x14_data_validations_from_ext_lst(&raw)
            .expect("raw extension should keep unknown sibling");

        assert!(!stripped.contains("x14:dataValidations"));
        assert!(stripped.contains(r#"<raw:payload"#));
    }

    #[test]
    fn modeled_x14_data_validation_child_removal_preserves_x14_cf_sibling() {
        let raw = format!(
            r#"<extLst><ext uri="{X14_DV_CF_EXT_URI}">{}{} </ext></extLst>"#,
            r#"<x14:dataValidations xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"/>"#,
            r#"<x14:conditionalFormattings xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:conditionalFormatting/></x14:conditionalFormattings>"#
        );

        let stripped = strip_modeled_x14_data_validations_from_ext_lst(&raw)
            .expect("x14 conditional formatting sibling should remain");

        assert!(!stripped.contains("x14:dataValidations"));
        assert!(stripped.contains("x14:conditionalFormattings"));
        assert!(stripped.contains(&format!(r#"uri="{X14_DV_CF_EXT_URI}""#)));
    }

    #[test]
    fn modeled_x14_data_validations_only_ext_lst_becomes_none() {
        let raw = format!(
            r#"<extLst>{}</extLst>"#,
            x14_dv_ext(X14_DV_CF_EXT_URI, "A1", "old")
        );

        assert!(strip_modeled_x14_data_validations_from_ext_lst(&raw).is_none());
    }

    #[test]
    fn unknown_guid_like_extensions_keep_exact_uri_matching() {
        let raw = r#"<extLst><ext uri="{11111111-2222-3333-4444-5555555555aa}"><raw:payload xmlns:raw="urn:raw"/></ext></extLst>"#;
        let generated = vec![
            r#"<ext uri="{11111111-2222-3333-4444-5555555555AA}"><gen:payload xmlns:gen="urn:gen"/></ext>"#
                .to_string(),
        ];

        let merged = merge_ext_lst_entries(Some(raw), &generated);
        let entries = split_ext_entries(&merged);

        assert_eq!(entries.len(), 2);
        assert!(merged.contains("<raw:payload"));
        assert!(merged.contains("<gen:payload"));
    }

    #[test]
    fn unsafe_raw_x14_wrapper_regenerates_canonical_wrapper_from_live_children() {
        let raw = format!(
            r#"<extLst><ext uri="{X14_EXT_URI_LOWER_VARIANT}" r:id="rIdUnsafe" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{}</ext></extLst>"#,
            r#"<x14:dataValidations xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"/>"#
        );
        let generated = vec![x14_dv_ext(X14_DV_CF_EXT_URI, "E1:E2", "current")];

        let merged = merge_ext_lst_entries(Some(&raw), &generated);
        let entries = split_ext_entries(&merged);

        assert_eq!(
            entries
                .iter()
                .filter(|entry| is_x14_dv_cf_ext_uri(entry.uri))
                .count(),
            1
        );
        assert!(merged.contains(&format!(r#"uri="{X14_DV_CF_EXT_URI}""#)));
        assert!(!merged.contains("rIdUnsafe"));
        assert!(merged.contains("<xm:f>current</xm:f>"));
    }
}
