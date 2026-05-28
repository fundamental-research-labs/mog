/// Escape XML special characters in content.
pub(super) fn escape_xml_content(text: &str, out: &mut Vec<u8>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\r' && i + 2 < bytes.len() && bytes[i + 1] == b'\r' && bytes[i + 2] == b'\n' {
            out.extend_from_slice(b"_x000D_\r\n");
            i += 3;
            continue;
        }
        if byte == b'_'
            && i + 6 < bytes.len()
            && bytes[i + 1] == b'x'
            && bytes[i + 6] == b'_'
            && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
        {
            out.extend_from_slice(b"_x005F_");
            i += 1;
            continue;
        }

        match byte {
            b'\r' => out.extend_from_slice(b"_x000D_"),
            b'&' => out.extend_from_slice(b"&amp;"),
            b'<' => out.extend_from_slice(b"&lt;"),
            b'>' => out.extend_from_slice(b"&gt;"),
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                use std::io::Write;
                write!(out, "_x{byte:04X}_").ok();
            }
            _ => out.push(byte),
        }
        i += 1;
    }
}

/// Escape XML special characters in attribute values.
pub(super) fn escape_xml_attr(text: &str, out: &mut Vec<u8>) {
    for ch in text.chars() {
        match ch {
            '&' => out.extend_from_slice(b"&amp;"),
            '<' => out.extend_from_slice(b"&lt;"),
            '>' => out.extend_from_slice(b"&gt;"),
            '"' => out.extend_from_slice(b"&quot;"),
            '\'' => out.extend_from_slice(b"&apos;"),
            _ => {
                let mut buf = [0u8; 4];
                let encoded = ch.encode_utf8(&mut buf);
                out.extend_from_slice(encoded.as_bytes());
            }
        }
    }
}

pub(super) fn needs_preserve_space(text: &str) -> bool {
    text.starts_with(' ')
        || text.ends_with(' ')
        || text.starts_with('\t')
        || text.ends_with('\t')
        || text.ends_with('\n')
        || text.ends_with('\r')
        || text.starts_with('\n')
        || text.starts_with('\r')
}
