/// Decode XML entities in byte slices.
///
/// Handles the five predefined XML entities and OOXML `_xHHHH_` escapes.
/// Unknown entities are passed through as-is.
pub fn decode_xml_entities(bytes: &[u8]) -> String {
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
                if let Some((ch, len)) = parse_numeric_char_ref(&bytes[i..]) {
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
        } else if bytes[i] == b'_' {
            if i + 7 <= bytes.len()
                && bytes[i + 1] == b'x'
                && bytes[i + 6] == b'_'
                && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
            {
                if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 2..i + 6]) {
                    if let Ok(code_point) = u32::from_str_radix(hex_str, 16) {
                        if let Some(ch) = char::from_u32(code_point) {
                            result.push(ch);
                            i += 7;
                            continue;
                        }
                    }
                }
            }
            result.push('_');
            i += 1;
        } else {
            let byte = bytes[i];
            let seq_len = if byte & 0x80 == 0 {
                1
            } else if byte & 0xE0 == 0xC0 {
                2
            } else if byte & 0xF0 == 0xE0 {
                3
            } else if byte & 0xF8 == 0xF0 {
                4
            } else {
                1
            };

            let end = (i + seq_len).min(bytes.len());
            if let Ok(s) = std::str::from_utf8(&bytes[i..end]) {
                result.push_str(s);
            } else {
                result.push(char::REPLACEMENT_CHARACTER);
            }
            i = end;
        }
    }

    result
}

fn parse_numeric_char_ref(bytes: &[u8]) -> Option<(char, usize)> {
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

/// Decode XML entities in a string.
pub fn decode_xml_entities_string(s: &str) -> String {
    decode_xml_entities(s.as_bytes())
}
