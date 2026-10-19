//! Bounded OPC logical/physical part identity, not generic ZIP path decoding.

/// ECMA-376 Part 2 (2021), 6.2.2 and 7.3.4: ASCII case is insignificant;
/// non-ASCII logical characters map to UTF-8 percent escapes in ZIP names.
/// Existing ASCII escapes remain escaped: `%20` never aliases a raw space.
pub(crate) fn part_name_identity(name: &str) -> Result<String, &'static str> {
    let name = name.strip_prefix('/').unwrap_or(name);
    if name.is_empty() || name.len() > u16::MAX as usize {
        return Err("empty or oversized OPC part name");
    }
    if name.split('/').any(|segment| {
        segment.is_empty() || segment == "." || segment == ".." || segment.ends_with('.')
    }) {
        return Err("invalid OPC part segment");
    }

    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = name.as_bytes();
    let mut key = String::with_capacity(bytes.len());
    let mut position = 0;
    while position < bytes.len() {
        let byte = bytes[position];
        if byte == b'%' {
            let mut escaped = Vec::new();
            while position < bytes.len() && bytes[position] == b'%' {
                let pair = bytes.get(position + 1..position + 3)
                    .ok_or("incomplete OPC percent escape")?;
                let high = (pair[0] as char).to_digit(16).ok_or("invalid OPC percent escape")?;
                let low = (pair[1] as char).to_digit(16).ok_or("invalid OPC percent escape")?;
                let value = ((high << 4) | low) as u8;
                if value.is_ascii_control() || matches!(value, b'/' | b'\\')
                    || value.is_ascii_alphanumeric() || matches!(value, b'-' | b'.' | b'_' | b'~')
                {
                    return Err("encoded separator, control or unreserved OPC character");
                }
                escaped.push(value);
                key.push('%');
                key.push(HEX[(value >> 4) as usize] as char);
                key.push(HEX[(value & 15) as usize] as char);
                position += 3;
            }
            std::str::from_utf8(&escaped).map_err(|_| "invalid percent-encoded OPC UTF-8")?;
            continue;
        }
        if byte.is_ascii_control() || matches!(byte, b' ' | b'\\' | b'?' | b'#' | b':') {
            return Err("unsupported literal OPC character");
        }
        if byte.is_ascii() {
            key.push(byte.to_ascii_lowercase() as char);
        } else {
            key.push('%');
            key.push(HEX[(byte >> 4) as usize] as char);
            key.push(HEX[(byte & 15) as usize] as char);
        }
        position += 1;
    }
    if key.len() > u16::MAX as usize {
        return Err("oversized physical OPC part name");
    }
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::part_name_identity;

    #[test]
    fn unicode_and_percent_spelling_share_opc_identity() {
        let expected = "xl/worksheets/r%c3%a9sum%c3%a9.xml";
        for name in [
            "/xl/worksheets/Résumé.xml",
            "xl/worksheets/R%C3%A9sum%C3%A9.xml",
            "XL/WORKSHEETS/R%c3%a9sum%c3%a9.XML",
        ] {
            assert_eq!(part_name_identity(name).unwrap(), expected);
        }
        assert_eq!(part_name_identity("xl/Sheet%201.xml").unwrap(), "xl/sheet%201.xml");
        assert!(part_name_identity("xl/Sheet 1.xml").is_err());
    }

    #[test]
    fn invalid_names_cannot_become_traversal_or_escape_aliases() {
        for name in ["", "/", "//x", "x/../y", "x/./y", "x//y", "x%2fy", "x%5Cy", "x%2e", "x%41", "x%ff", "x%c3%20", "x%", "x%zz", "x\\y"] {
            assert!(part_name_identity(name).is_err(), "{name}");
        }
        assert!(part_name_identity(&"x".repeat(u16::MAX as usize + 1)).is_err());
    }
}
