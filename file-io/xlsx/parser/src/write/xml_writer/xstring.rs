use std::io::Write;

#[inline]
pub(super) fn append_escaped_xstring_attr(buffer: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\r' && i + 2 < bytes.len() && bytes[i + 1] == b'\r' && bytes[i + 2] == b'\n' {
            buffer.extend_from_slice(b"_x000D_\r\n");
            i += 3;
            continue;
        }
        if is_literal_xstring_escape(bytes, i) {
            buffer.extend_from_slice(b"_x005f_");
            i += 1;
            continue;
        }

        match byte {
            b'\n' => buffer.extend_from_slice(b"_x000a_"),
            b'\r' => buffer.extend_from_slice(b"_x000d_"),
            b'\t' => buffer.extend_from_slice(b"_x0009_"),
            b'&' => buffer.extend_from_slice(b"&amp;"),
            b'<' => buffer.extend_from_slice(b"&lt;"),
            b'>' => buffer.extend_from_slice(b"&gt;"),
            b'"' => buffer.extend_from_slice(b"&quot;"),
            b'\'' => buffer.extend_from_slice(b"&apos;"),
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                write!(buffer, "_x{byte:04x}_").ok();
            }
            _ => buffer.push(byte),
        }
        i += 1;
    }
}

#[inline]
pub(super) fn append_escaped_xstring_text(buffer: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\r' && i + 2 < bytes.len() && bytes[i + 1] == b'\r' && bytes[i + 2] == b'\n' {
            buffer.extend_from_slice(b"_x000D_\r\n");
            i += 3;
            continue;
        }
        if is_literal_xstring_escape(bytes, i) {
            buffer.extend_from_slice(b"_x005F_");
            i += 1;
            continue;
        }

        match byte {
            b'\r' => buffer.extend_from_slice(b"_x000D_"),
            b'&' => buffer.extend_from_slice(b"&amp;"),
            b'<' => buffer.extend_from_slice(b"&lt;"),
            b'>' => buffer.extend_from_slice(b"&gt;"),
            0x00..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F => {
                write!(buffer, "_x{byte:04X}_").ok();
            }
            _ => buffer.push(byte),
        }
        i += 1;
    }
}

#[inline]
fn is_literal_xstring_escape(bytes: &[u8], i: usize) -> bool {
    bytes[i] == b'_'
        && i + 6 < bytes.len()
        && bytes[i + 1] == b'x'
        && bytes[i + 6] == b'_'
        && bytes[i + 2..i + 6].iter().all(|b| b.is_ascii_hexdigit())
}
