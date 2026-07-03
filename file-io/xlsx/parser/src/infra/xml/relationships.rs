use std::collections::{HashMap, HashSet};

const RELATIONSHIP_ATTR_LOCAL_NAMES: [&str; 9] = [
    "id", "embed", "link", "dm", "lo", "qs", "cs", "blip", "relid",
];
const OOXML_RELATIONSHIPS_NS: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const OFFICE_VML_NS: &str = "urn:schemas-microsoft-com:office:office";

/// Returns true when raw XML contains a namespaced relationship-bearing
/// attribute such as `r:id`, `r:embed`, `r:link`, SmartArt `r:dm`/`r:lo`
/// attributes, `o:relid`, or an equivalent prefixed attribute.
pub fn raw_xml_contains_relationship_attr(raw_xml: &str) -> bool {
    RELATIONSHIP_ATTR_LOCAL_NAMES
        .iter()
        .any(|local_name| raw_xml_contains_prefixed_attr(raw_xml, local_name))
}

pub fn relationship_attr_values(raw_xml: &str) -> Vec<String> {
    let mut values = Vec::new();
    visit_relationship_attrs(raw_xml, |value| values.push(value.to_string()));
    values
}

pub fn relationship_attr_values_with_known_namespaces(raw_xml: &str) -> Vec<String> {
    let relationship_prefixes = namespace_prefixes(raw_xml, &[OOXML_RELATIONSHIPS_NS]);
    let office_prefixes = namespace_prefixes(raw_xml, &[OFFICE_VML_NS]);
    if relationship_prefixes.is_empty() && office_prefixes.is_empty() {
        return Vec::new();
    }

    let mut values = Vec::new();
    visit_relationship_attrs_with_name(raw_xml, |prefix, local_name, value| {
        if relationship_prefixes.contains(prefix)
            || (local_name == "relid" && office_prefixes.contains(prefix))
        {
            values.push(value.to_string());
        }
    });
    values
}

pub fn remap_relationship_attrs(raw_xml: &str, resolved_ids: &HashMap<String, String>) -> String {
    if resolved_ids.is_empty() || !raw_xml_contains_relationship_attr(raw_xml) {
        return raw_xml.to_string();
    }

    let mut out = String::with_capacity(raw_xml.len());
    let bytes = raw_xml.as_bytes();
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(eq_offset) = bytes[cursor..].iter().position(|b| *b == b'=') else {
            out.push_str(&raw_xml[cursor..]);
            break;
        };
        let eq_pos = cursor + eq_offset;
        let mut name_start = eq_pos;
        while name_start > 0
            && (bytes[name_start - 1].is_ascii_alphanumeric()
                || matches!(bytes[name_start - 1], b':' | b'_' | b'-' | b'.'))
        {
            name_start -= 1;
        }
        let local_name = raw_xml[name_start..eq_pos]
            .rsplit_once(':')
            .map(|(_, local)| local)
            .unwrap_or("");
        if !RELATIONSHIP_ATTR_LOCAL_NAMES.contains(&local_name) {
            out.push_str(&raw_xml[cursor..=eq_pos]);
            cursor = eq_pos + 1;
            continue;
        }

        let mut value_start = eq_pos + 1;
        while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
            value_start += 1;
        }
        if value_start >= bytes.len() || !matches!(bytes[value_start], b'"' | b'\'') {
            out.push_str(&raw_xml[cursor..=eq_pos]);
            cursor = eq_pos + 1;
            continue;
        }
        let quote = bytes[value_start];
        let value_content_start = value_start + 1;
        let Some(value_len) = bytes[value_content_start..]
            .iter()
            .position(|b| *b == quote)
        else {
            out.push_str(&raw_xml[cursor..]);
            break;
        };
        let value_end = value_content_start + value_len;
        let value = &raw_xml[value_content_start..value_end];
        if let Some(remapped) = resolved_ids.get(value) {
            out.push_str(&raw_xml[cursor..value_content_start]);
            out.push_str(remapped);
            cursor = value_end;
        } else {
            out.push_str(&raw_xml[cursor..value_end]);
            cursor = value_end;
        }
    }

    out
}

fn raw_xml_contains_prefixed_attr(raw_xml: &str, local_name: &str) -> bool {
    let bytes = raw_xml.as_bytes();
    let pattern = format!(":{local_name}");
    let pattern = pattern.as_bytes();
    let mut pos = 0;

    while let Some(offset) = bytes[pos..]
        .windows(pattern.len())
        .position(|window| window == pattern)
    {
        let attr_pos = pos + offset;
        let after_name = attr_pos + pattern.len();
        let mut cursor = after_name;
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor < bytes.len() && bytes[cursor] == b'=' {
            return true;
        }
        pos = after_name;
    }

    false
}

fn visit_relationship_attrs(raw_xml: &str, mut visit: impl FnMut(&str)) {
    visit_relationship_attrs_with_name(raw_xml, |_, _, value| visit(value));
}

fn visit_relationship_attrs_with_name(raw_xml: &str, mut visit: impl FnMut(&str, &str, &str)) {
    let bytes = raw_xml.as_bytes();
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(eq_offset) = bytes[cursor..].iter().position(|b| *b == b'=') else {
            break;
        };
        let eq_pos = cursor + eq_offset;
        let mut name_start = eq_pos;
        while name_start > 0
            && (bytes[name_start - 1].is_ascii_alphanumeric()
                || matches!(bytes[name_start - 1], b':' | b'_' | b'-' | b'.'))
        {
            name_start -= 1;
        }
        let Some((prefix, local_name)) = raw_xml[name_start..eq_pos].rsplit_once(':') else {
            cursor = eq_pos + 1;
            continue;
        };
        if !RELATIONSHIP_ATTR_LOCAL_NAMES.contains(&local_name) {
            cursor = eq_pos + 1;
            continue;
        }

        let mut value_start = eq_pos + 1;
        while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
            value_start += 1;
        }
        if value_start >= bytes.len() || !matches!(bytes[value_start], b'"' | b'\'') {
            cursor = eq_pos + 1;
            continue;
        }
        let quote = bytes[value_start];
        let value_content_start = value_start + 1;
        let Some(value_len) = bytes[value_content_start..]
            .iter()
            .position(|b| *b == quote)
        else {
            break;
        };
        let value_end = value_content_start + value_len;
        visit(prefix, local_name, &raw_xml[value_content_start..value_end]);
        cursor = value_end + 1;
    }
}

fn namespace_prefixes(raw_xml: &str, namespace_uris: &[&str]) -> HashSet<String> {
    let mut prefixes = HashSet::new();
    let bytes = raw_xml.as_bytes();
    let mut cursor = 0;

    while let Some(offset) = raw_xml[cursor..].find("xmlns:") {
        let prefix_start = cursor + offset + "xmlns:".len();
        let mut prefix_end = prefix_start;
        while prefix_end < bytes.len() && is_xml_name_byte(bytes[prefix_end]) {
            prefix_end += 1;
        }
        if prefix_end == prefix_start {
            cursor = prefix_start;
            continue;
        }

        let mut value_start = prefix_end;
        while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
            value_start += 1;
        }
        if value_start >= bytes.len() || bytes[value_start] != b'=' {
            cursor = prefix_end;
            continue;
        }
        value_start += 1;
        while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
            value_start += 1;
        }
        if value_start >= bytes.len() || !matches!(bytes[value_start], b'"' | b'\'') {
            cursor = value_start;
            continue;
        }
        let quote = bytes[value_start];
        let value_content_start = value_start + 1;
        let Some(value_len) = bytes[value_content_start..]
            .iter()
            .position(|b| *b == quote)
        else {
            break;
        };
        let value_end = value_content_start + value_len;
        if namespace_uris.contains(&&raw_xml[value_content_start..value_end]) {
            prefixes.insert(raw_xml[prefix_start..prefix_end].to_string());
        }
        cursor = value_end + 1;
    }

    prefixes
}

fn is_xml_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.')
}
