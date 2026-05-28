#![allow(clippy::string_slice)]

/// Extract namespace declarations and `mc:Ignorable` from the requested root element.
///
/// UTF-8 boundary guard: string slices in this helper use byte offsets produced
/// by ASCII-only XML syntax and ASCII attribute names.
pub(super) fn parse_root_attrs(xml: &[u8], root_name: &str) -> Vec<(String, String)> {
    let xml_str = match std::str::from_utf8(xml) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let start = if let Some(decl_end) = xml_str.find("?>") {
        decl_end + 2
    } else {
        0
    };

    let root_needle = format!("<{root_name}");
    let root_start = match xml_str[start..].find(&root_needle) {
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
            (format!("xmlns:{}", prefix), &after[6 + end..])
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
                    let value_start = &after_eq[1..];
                    if let Some(end_quote) = value_start.find(quote) {
                        let uri = &value_start[..end_quote];
                        attrs.push((attr_name, uri.to_string()));
                    }
                }
            }
        }

        pos = abs_pos + 5;
    }

    pos = 0;
    while let Some(mc_pos) = root_tag[pos..].find("mc:Ignorable") {
        let abs_pos = pos + mc_pos;
        let after = &root_tag[abs_pos + 12..];

        if let Some(eq_pos) = after.find('=') {
            let after_eq = after[eq_pos + 1..].trim_start();
            if let Some(quote) = after_eq.chars().next() {
                if quote == '"' || quote == '\'' {
                    let value_start = &after_eq[1..];
                    if let Some(end_quote) = value_start.find(quote) {
                        let value = &value_start[..end_quote];
                        attrs.push(("mc:Ignorable".to_string(), value.to_string()));
                    }
                }
            }
        }

        pos = abs_pos + 12;
    }

    attrs
}
