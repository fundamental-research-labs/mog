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
        .filter(|entry| entry.uri == Some(X14_DV_CF_EXT_URI))
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
                if raw_entry.uri == Some(X14_DV_CF_EXT_URI) && !generated_x14_children.is_empty() {
                    merged_entries.push(merge_x14_children(raw_entry.xml, &generated_x14_children));
                    for (idx, entry) in generated_entries.iter().enumerate() {
                        if entry.uri == Some(X14_DV_CF_EXT_URI) {
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
            if entry.uri == Some(X14_DV_CF_EXT_URI) {
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

fn generated_x14_child_xml(ext_xml: &str) -> Vec<String> {
    let search_xml = ext_body(ext_xml).unwrap_or(ext_xml);
    X14_GENERATED_CHILDREN
        .iter()
        .filter_map(|local_name| extract_first_child_by_local_name(search_xml, local_name))
        .map(ToOwned::to_owned)
        .collect()
}

fn ext_body(ext_xml: &str) -> Option<&str> {
    let start_end = ext_xml.find('>')? + 1;
    let end_start = ext_xml.rfind("</ext>")?;
    (start_end <= end_start).then_some(&ext_xml[start_end..end_start])
}

fn merge_x14_children(raw_ext_xml: &str, generated_children: &[String]) -> String {
    let Some(start_end) = raw_ext_xml.find('>').map(|pos| pos + 1) else {
        return raw_ext_xml.to_string();
    };
    let Some(end_start) = raw_ext_xml.rfind("</ext>") else {
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
            pos = xml[start..]
                .find('>')
                .map_or(xml.len(), |end| start + end + 1);
            continue;
        }
        let tag_end = xml[start..].find('>').map(|end| start + end + 1)?;
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
    if tag_end > start && xml.as_bytes().get(tag_end.wrapping_sub(2)) == Some(&b'/') {
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

fn is_self_closing_ext_lst(xml: &str) -> bool {
    let trimmed = xml.trim();
    trimmed.starts_with("<extLst") && trimmed.ends_with("/>")
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
    while let Some(rel_start) = find_ext_start(inner, pos) {
        let start = rel_start;
        let Some(start_tag_end_rel) = inner[start..].find('>') else {
            break;
        };
        let start_tag_end = start + start_tag_end_rel + 1;
        let start_tag = &inner[start..start_tag_end];
        let Some(close_rel) = inner[start_tag_end..].find("</ext>") else {
            break;
        };
        let end = start_tag_end + close_rel + "</ext>".len();
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

fn find_ext_lst_start_tag(xml: &str) -> Option<(usize, usize)> {
    let candidates = ["<extLst", ":extLst"];
    candidates
        .iter()
        .filter_map(|needle| {
            let start = xml.find(needle)?;
            let element_start = if *needle == ":extLst" {
                xml[..start].rfind('<')?
            } else {
                start
            };
            let end = xml[element_start..]
                .find('>')
                .map(|pos| element_start + pos + 1)?;
            Some((end, element_start))
        })
        .min_by_key(|(_, element_start)| *element_start)
}

fn find_ext_lst_end_tag(xml: &str, element_start: usize) -> Option<usize> {
    let root_tag = &xml[element_start
        ..xml[element_start..]
            .find('>')
            .map(|pos| element_start + pos)?];
    let name_start = root_tag.find('<')? + 1;
    let name_end = root_tag[name_start..]
        .find(|c: char| c.is_whitespace() || c == '>')
        .map(|pos| name_start + pos)
        .unwrap_or(root_tag.len());
    let root_name = &root_tag[name_start..name_end];
    let close = format!("</{root_name}>");
    xml.rfind(&close)
}

fn find_ext_start(xml: &str, pos: usize) -> Option<usize> {
    let mut search_pos = pos;
    while let Some(rel) = xml[search_pos..].find("<ext") {
        let start = search_pos + rel;
        let after = xml.as_bytes().get(start + "<ext".len()).copied();
        if matches!(after, Some(b' ' | b'>' | b'/')) {
            return Some(start);
        }
        search_pos = start + "<ext".len();
    }
    None
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
