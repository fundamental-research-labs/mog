const RELATIONSHIP_ATTR_LOCAL_NAMES: [&str; 4] = ["id", "embed", "link", "relid"];

/// Returns true when raw XML contains a namespaced relationship-bearing
/// attribute such as `r:id`, `r:embed`, `r:link`, `o:relid`, or an equivalent
/// prefixed attribute.
pub fn raw_xml_contains_relationship_attr(raw_xml: &str) -> bool {
    RELATIONSHIP_ATTR_LOCAL_NAMES
        .iter()
        .any(|local_name| raw_xml_contains_prefixed_attr(raw_xml, local_name))
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
