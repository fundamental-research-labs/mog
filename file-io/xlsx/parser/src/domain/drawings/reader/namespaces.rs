//! Namespace capture helpers for drawing roots.

/// Extract namespace declarations (xmlns:prefix="uri" and xmlns="uri") from a
/// drawing XML root element. Attribute order and prefixes are preserved.
pub(crate) fn root_namespace_attrs(xml: &[u8]) -> Vec<(String, String)> {
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let start = xml_str.find("?>").map_or(0, |decl_end| decl_end + 2);
    let root_start = match xml_str[start..].find('<') {
        Some(p) => start + p,
        None => return Vec::new(),
    };
    let root_end = match xml_str[root_start..].find('>') {
        Some(p) => root_start + p,
        None => return Vec::new(),
    };
    let root_tag = &xml_str[root_start..=root_end];

    let mut attrs = Vec::new();
    let mut pos = 0;
    while let Some(xmlns_pos) = root_tag[pos..].find("xmlns") {
        let abs_pos = pos + xmlns_pos;
        let after = &root_tag[abs_pos..];

        let (attr_name, rest) = if after.len() > 5 && after.as_bytes()[5] == b':' {
            let after_colon = &after[6..];
            let end = after_colon
                .find(|c: char| c == '=' || c.is_whitespace())
                .unwrap_or(after_colon.len());
            let prefix = &after_colon[..end];
            (format!("xmlns:{prefix}"), &after[6 + end..])
        } else if after.len() > 5
            && (after.as_bytes()[5] == b'=' || after.as_bytes()[5].is_ascii_whitespace())
        {
            ("xmlns".to_string(), &after[5..])
        } else {
            pos = abs_pos + 5;
            continue;
        };

        if let Some(eq_pos) = rest.find('=') {
            let after_eq = rest[eq_pos + 1..].trim_start();
            if let Some(quote) = after_eq.chars().next() {
                if quote == '"' || quote == '\'' {
                    let value_start = quote.len_utf8();
                    if let Some(value_end) = after_eq[value_start..].find(quote) {
                        attrs.push((
                            attr_name,
                            after_eq[value_start..value_start + value_end].to_string(),
                        ));
                    }
                }
            }
        }

        pos = abs_pos + 5;
    }

    attrs
}
