use std::collections::HashMap;

const RELATIONSHIP_ATTR_LOCAL_NAMES: [&str; 9] = [
    "id", "embed", "link", "dm", "lo", "qs", "cs", "blip", "relid",
];

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
        let Some((_, local_name)) = raw_xml[name_start..eq_pos].rsplit_once(':') else {
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
        visit(&raw_xml[value_content_start..value_end]);
        cursor = value_end + 1;
    }
}
