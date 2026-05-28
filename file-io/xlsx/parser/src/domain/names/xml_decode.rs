//! XML text decoding for defined-name content and optional attributes.

/// Decode XML entities in a byte slice.
///
/// Handles: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`
pub(super) fn decode_xml_entities(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len());
    let mut i = 0;

    while i < bytes.len() {
        if bytes[i] == b'&' {
            if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&lt;" {
                result.push('<');
                i += 4;
            } else if i + 4 <= bytes.len() && &bytes[i..i + 4] == b"&gt;" {
                result.push('>');
                i += 4;
            } else if i + 5 <= bytes.len() && &bytes[i..i + 5] == b"&amp;" {
                result.push('&');
                i += 5;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&quot;" {
                result.push('"');
                i += 6;
            } else if i + 6 <= bytes.len() && &bytes[i..i + 6] == b"&apos;" {
                result.push('\'');
                i += 6;
            } else if i + 2 < bytes.len() && bytes[i + 1] == b'#' {
                if let Some((ch, len)) = parse_char_reference_names(&bytes[i..]) {
                    result.push(ch);
                    i += len;
                } else {
                    result.push('&');
                    i += 1;
                }
            } else {
                result.push('&');
                i += 1;
            }
        } else if bytes[i] < 0x80 {
            result.push(bytes[i] as char);
            i += 1;
        } else {
            let remaining = &bytes[i..];
            if let Ok(s) = std::str::from_utf8(remaining) {
                if let Some(c) = s.chars().next() {
                    result.push(c);
                    i += c.len_utf8();
                } else {
                    i += 1;
                }
            } else {
                result.push('\u{FFFD}');
                i += 1;
            }
        }
    }

    result
}

/// Parse a numeric character reference (&#NNN; or &#xHHH;).
fn parse_char_reference_names(bytes: &[u8]) -> Option<(char, usize)> {
    if bytes.len() < 4 || bytes[0] != b'&' || bytes[1] != b'#' {
        return None;
    }

    let is_hex = bytes[2] == b'x' || bytes[2] == b'X';
    let num_start = if is_hex { 3 } else { 2 };

    let mut end = num_start;
    while end < bytes.len() && bytes[end] != b';' {
        end += 1;
    }

    if end >= bytes.len() || bytes[end] != b';' {
        return None;
    }

    let num_bytes = &bytes[num_start..end];
    let code_point = if is_hex {
        u32::from_str_radix(std::str::from_utf8(num_bytes).ok()?, 16).ok()?
    } else {
        std::str::from_utf8(num_bytes).ok()?.parse::<u32>().ok()?
    };

    char::from_u32(code_point).map(|ch| (ch, end + 1))
}
