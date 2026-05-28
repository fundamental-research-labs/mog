use memchr::memchr;

/// Decode XML entities in source bytes and write to destination buffer
///
/// Handles:
/// - &amp; -> &
/// - &lt; -> <
/// - &gt; -> >
/// - &quot; -> "
/// - &apos; -> '
/// - &#NN; -> character (decimal)
/// - &#xHH; -> character (hexadecimal)
pub fn decode_xml_entities(src: &[u8], dst: &mut Vec<u8>) {
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'&' {
            // Try to decode entity
            if let Some((decoded, advance)) = decode_entity(&src[i..]) {
                dst.extend_from_slice(decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'_' {
            // OOXML escape: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
            if let Some((decoded, advance)) = decode_ooxml_escape(&src[i..]) {
                dst.extend_from_slice(&decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'\r' {
            dst.push(b'\n');
            i += if i + 1 < src.len() && src[i + 1] == b'\n' {
                2
            } else {
                1
            };
            continue;
        }
        dst.push(src[i]);
        i += 1;
    }
}

/// Try to decode a single XML entity starting at the given position
/// Returns (decoded_bytes, bytes_consumed) or None if not a valid entity
fn decode_entity(src: &[u8]) -> Option<(&'static [u8], usize)> {
    if src.len() < 3 || src[0] != b'&' {
        return None;
    }

    // Named entities
    if src.starts_with(b"&amp;") {
        return Some((b"&", 5));
    }
    if src.starts_with(b"&lt;") {
        return Some((b"<", 4));
    }
    if src.starts_with(b"&gt;") {
        return Some((b">", 4));
    }
    if src.starts_with(b"&quot;") {
        return Some((b"\"", 6));
    }
    if src.starts_with(b"&apos;") {
        return Some((b"'", 6));
    }

    None
}

/// Decode an OOXML escape sequence: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
/// e.g. _x000a_ = newline, _x000d_ = carriage return
fn decode_ooxml_escape(src: &[u8]) -> Option<(Vec<u8>, usize)> {
    if src.len() < 7 || src[0] != b'_' || src[1] != b'x' || src[6] != b'_' {
        return None;
    }
    if !src[2..6].iter().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let hex_str = std::str::from_utf8(&src[2..6]).ok()?;
    let code_point = u32::from_str_radix(hex_str, 16).ok()?;
    let ch = char::from_u32(code_point)?;
    let mut buf = [0u8; 4];
    let encoded = ch.encode_utf8(&mut buf);
    Some((encoded.as_bytes().to_vec(), 7))
}

/// Decode a numeric character reference (&#NN; or &#xHH;)
/// Returns the decoded character as UTF-8 bytes and the number of bytes consumed
fn decode_numeric_entity(src: &[u8]) -> Option<(Vec<u8>, usize)> {
    if !src.starts_with(b"&#") {
        return None;
    }

    let semicolon_pos = memchr(b';', src)?;
    if semicolon_pos < 3 {
        return None;
    }

    let is_hex = src[2] == b'x' || src[2] == b'X';
    let num_start = if is_hex { 3 } else { 2 };
    let num_bytes = &src[num_start..semicolon_pos];

    let code_point = if is_hex {
        u32::from_str_radix(std::str::from_utf8(num_bytes).ok()?, 16).ok()?
    } else {
        std::str::from_utf8(num_bytes).ok()?.parse().ok()?
    };

    let ch = char::from_u32(code_point)?;
    let mut buf = [0u8; 4];
    let encoded = ch.encode_utf8(&mut buf);

    Some((encoded.as_bytes().to_vec(), semicolon_pos + 1))
}

/// Decode XML entities including numeric character references
pub fn decode_xml_entities_full(src: &[u8], dst: &mut Vec<u8>) {
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'&' {
            // Try named entity first
            if let Some((decoded, advance)) = decode_entity(&src[i..]) {
                dst.extend_from_slice(decoded);
                i += advance;
                continue;
            }
            // Try numeric entity
            if let Some((decoded, advance)) = decode_numeric_entity(&src[i..]) {
                dst.extend_from_slice(&decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'_' {
            // OOXML escape: _xHHHH_ (underscore, 'x', 4 hex digits, underscore)
            if let Some((decoded, advance)) = decode_ooxml_escape(&src[i..]) {
                dst.extend_from_slice(&decoded);
                i += advance;
                continue;
            }
        } else if src[i] == b'\r' {
            dst.push(b'\n');
            i += if i + 1 < src.len() && src[i + 1] == b'\n' {
                2
            } else {
                1
            };
            continue;
        }
        dst.push(src[i]);
        i += 1;
    }
}
